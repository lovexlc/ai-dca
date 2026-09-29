"""纳指100ETF 全市场轮动多Q并行模拟盘。

标的宇宙（6 只纳斯达克100ETF，名称以 workers/notify/src/nasdaqRadar.js 为准）：
- 159696 易方达 / 159659 招商 / 513300 华夏
- 159660 汇添富 / 513870 富国 / 159632 华安

策略（多Q并行，每盘独立 100 万 CNY 起步）：
- 每盘只持有一只基金，全仓切换。
- signal_target：空仓买入全市场溢价最低者；持仓时若
  （持仓溢价 − 全市场最低溢价）> Q，则切换到溢价最低者；否则持有不动。
- tick 记录的 spread 为全市场极差 = max溢价 − min溢价（仅展示用）。
- 以 1 手（100 股）为单位下单，金额不足时向下取整，不足 100 股不下单。
- 买卖用实时买卖盘：买入按卖盘（卖一→卖五）逐档吃单，卖出按买盘
  （买一→买五）逐档吃单；某档数量不足就吃完该档继续下一档。
- 手续费万 0.5（0.00005），买卖双边从现金计提。
- 买入按订单股数相对可见卖盘深度计提冲击成本（平方根模型，上限 1%）。

组合配置：
- quant-q01 / q02 / q03：Q=0.1/0.2/0.3，信号触发当即执行。
- manual-q01：Q=0.1，信号触发后 3 秒执行（用 3 秒后的行情成交）。

行情：
- 腾讯 qt.gtimg.cn：价格 + 买卖五档（每秒）。
- 东财 push2 ulist.np：IOPV（f441），premium = (price - iopv) / iopv * 100。

运行：
    python -m market_collector.paper_trade --root services/market-collector

只在 A 股交易时段运行（工作日且非休市日，9:30-11:30，13:00-15:00），
其余时间空转等待。状态落盘 JSON，另起 HTTP（127.0.0.1:18081）供查询。
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import threading
import time
import urllib.parse
from collections import deque
from datetime import datetime, time as day_time, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any

from .calendar_cn import SHANGHAI, is_trading_day
from .netutil import fetch_url
from .sources import EASTMONEY_ULIST_URL, eastmoney_secid, to_float, to_positive_float

SYMBOLS = ("159696", "159659", "513300", "159660", "513870", "159632")
SYMBOL_NAMES = {
    "159696": "易方达纳斯达克100ETF",
    "159659": "招商纳斯达克100ETF",
    "513300": "华夏纳斯达克100ETF",
    "159660": "汇添富纳斯达克100ETF",
    "513870": "富国纳斯达克100ETF",
    "159632": "华安纳斯达克100ETF",
}
INITIAL_CAPITAL = 1_000_000.0
LOT_SHARES = 100  # 1 手 = 100 股/笔
MIN_ORDER_SHARES = 100  # 最小 1 手/笔：不足 100 股不下单
FEE_RATE = 0.00005  # 手续费万 0.5，买卖双边
HISTORY_MAXLEN = 20000  # 净值/价差历史保留点数（1s 一 tick，约覆盖一个交易日以上）

# 多Q并行组合配置：每盘独立 100 万起步。
PORTFOLIO_SPECS: tuple[dict[str, Any], ...] = (
    {"key": "quant-q01", "label": "实时Q0.1", "delay_sec": 0, "q": 0.1},
    {"key": "quant-q02", "label": "实时Q0.2", "delay_sec": 0, "q": 0.2},
    {"key": "quant-q03", "label": "实时Q0.3", "delay_sec": 0, "q": 0.3},
    {"key": "manual-q01", "label": "手动Q0.1", "delay_sec": 3, "q": 0.1},
)


def tencent_symbol(code: str) -> str:
    """腾讯行情代码：沪市（51/52 开头）加 sh 前缀，深市加 sz。"""
    return ("sh" if code.startswith(("51", "52")) else "sz") + code


TENCENT_URL = "https://qt.gtimg.cn/q=" + ",".join(tencent_symbol(s) for s in SYMBOLS)

TRADING_WINDOWS = (
    (day_time(9, 30), day_time(11, 30)),
    (day_time(13, 0), day_time(15, 0)),
)

HTTP_HOST = "127.0.0.1"
HTTP_PORT = 18081

# 休市期间也定期抓展示用行情（腾讯休市返回昨收价），保证量化看板有最新价格/溢价可看；
# 不跑策略逻辑，只更新快照。
OFFHOURS_SNAPSHOT_SEC = 300
# 休市无 IOPV 时，用 collector 日线溢价兜底（最新一个日线点的 premiumPercent）。
COLLECTOR_PREMIUM_URL = os.environ.get(
    "PAPER_TRADE_PREMIUM_URL",
    "https://fast.freebacktrack.tech/api/market-collector/premium/{symbol}?interval=1d&limit=1",
)


def shanghai_now() -> datetime:
    return datetime.now(timezone.utc).astimezone(SHANGHAI)


def in_trading_hours(value: datetime | None = None) -> bool:
    current = (value or shanghai_now()).astimezone(SHANGHAI)
    if not is_trading_day(current):
        return False
    clock = current.time().replace(tzinfo=None)
    return any(start <= clock < end for start, end in TRADING_WINDOWS)


# ---------------------------------------------------------------------------
# 行情解析
# ---------------------------------------------------------------------------

def parse_tencent_depth(text: str) -> dict[str, dict[str, Any]]:
    """解析腾讯行情中的买卖五档。

    fields[9]/[10] 起为买一价/量 … fields[17]/[18] 买五价/量，
    fields[19]/[20] 起为卖一价/量 … fields[27]/[28] 卖五价/量。
    量单位为手，统一换算成股。
    """
    rows: dict[str, dict[str, Any]] = {}
    pattern = re.compile(r'v_([^=]+)="([^"]*)";?')
    for key, payload in pattern.findall(text or ""):
        fields = str(payload).split("~")
        if len(fields) < 29:
            continue
        code = "".join(ch for ch in str(fields[2] or key) if ch.isdigit())[-6:]
        if code not in SYMBOLS:
            continue
        price = to_positive_float(fields[3])

        def level(idx_price: int, idx_vol: int) -> tuple[float, int] | None:
            p = to_positive_float(fields[idx_price]) if idx_price < len(fields) else None
            v = to_float(fields[idx_vol]) if idx_vol < len(fields) else None
            if p is None or v is None or v <= 0:
                return None
            return (p, int(v * 100))

        bids = [lv for i in range(5) if (lv := level(9 + i * 2, 10 + i * 2))]
        asks = [lv for i in range(5) if (lv := level(19 + i * 2, 20 + i * 2))]
        rows[code] = {
            "symbol": code,
            "price": price,
            "bids": bids,  # 买盘：买一→买五，[(price, shares)]
            "asks": asks,  # 卖盘：卖一→卖五，[(price, shares)]
            "suspended": str(fields[40]).strip() == "S" if len(fields) > 40 else False,
        }
    return rows


def parse_eastmoney_iopv(payload: dict) -> dict[str, float]:
    """从东财 ulist.np 响应中提取 IOPV（f441）。"""
    result: dict[str, float] = {}
    try:
        diff = payload.get("data", {}).get("diff", [])
    except AttributeError:
        return result
    for item in diff:
        code = "".join(ch for ch in str(item.get("f12", "")) if ch.isdigit())[-6:]
        if code in SYMBOLS:
            iopv = to_positive_float(item.get("f441"))
            if iopv:
                result[code] = iopv
    return result


def fetch_market_snapshot(timeout_sec: float = 5.0) -> dict[str, dict[str, Any]]:
    """抓一轮行情：腾讯价格+盘口，东财 IOPV，计算溢价。"""
    captured = shanghai_now().isoformat()
    try:
        raw = fetch_url(TENCENT_URL, timeout_sec)
        depth = parse_tencent_depth(raw.decode("utf-8", "replace"))
    except Exception:
        depth = {}
    iopv_map: dict[str, float] = {}
    try:
        params = urllib.parse.urlencode({
            "secids": ",".join(eastmoney_secid(s) for s in SYMBOLS),
            "fields": "f12,f441",
            "fltt": 2,
            "invt": 2,
        })
        raw = fetch_url(EASTMONEY_ULIST_URL + "?" + params, timeout_sec)
        iopv_map = parse_eastmoney_iopv(json.loads(raw.decode("utf-8", "replace")))
    except Exception:
        pass
    snapshot: dict[str, dict[str, Any]] = {}
    for symbol in SYMBOLS:
        row = depth.get(symbol, {})
        price = row.get("price")
        iopv = iopv_map.get(symbol)
        premium = None
        if price and iopv and iopv > 0:
            premium = round((price - iopv) / iopv * 100, 4)
        snapshot[symbol] = {
            "symbol": symbol,
            "captured_at": captured,
            "price": price,
            "iopv": iopv,
            "premium": premium,
            "premium_source": "iopv" if premium is not None else None,
            "bids": row.get("bids", []),
            "asks": row.get("asks", []),
            "suspended": row.get("suspended", False),
        }
    return snapshot


def fetch_latest_premium(symbol: str, timeout_sec: float = 5.0) -> dict[str, Any] | None:
    """取该标的最新日线溢价点（休市无 IOPV 时的兜底）。

    返回 {"premium": 溢价百分比, "price": 最新价, "date": 日期}，失败返回 None。
    """
    try:
        raw = fetch_url(COLLECTOR_PREMIUM_URL.format(symbol=symbol), timeout_sec)
        payload = json.loads(raw.decode("utf-8", "replace"))
        points = payload.get("points") or []
    except Exception:
        return None
    if not points:
        return None
    pt = points[-1]
    premium = to_positive_float(pt.get("premiumPercent"))
    if premium is None:
        return None
    return {
        "premium": premium,
        "price": to_positive_float(pt.get("price")),
        "date": pt.get("date") or pt.get("time"),
    }


# ---------------------------------------------------------------------------
# 撮合模拟
# ---------------------------------------------------------------------------

def sweep_book(levels: list[tuple[float, int]], shares: int) -> tuple[int, float, int]:
    """按盘口逐档吃单。

    levels: [(price, available_shares)]，买入时传 asks（卖一→卖五），
    卖出时传 bids（买一→买五）。
    返回 (实际成交股数, 总金额, 吃掉的档位数)。档位吃完仍不足则部分成交。
    """
    remaining = shares
    filled = 0
    amount = 0.0
    levels_consumed = 0
    for price, available in levels:
        if remaining <= 0:
            break
        take = min(remaining, available)
        if take > 0:
            levels_consumed += 1
        filled += take
        amount += take * price
        remaining -= take
    return filled, round(amount, 2), levels_consumed


def round_order_shares(shares: int) -> int:
    """下单股数向下取整到 100 股（1 手）的整数倍，不足 100 股返回 0。"""
    shares = int(shares)
    if shares < MIN_ORDER_SHARES:
        return 0
    return (shares // LOT_SHARES) * LOT_SHARES


def max_buyable_shares(cash: float, ask_price: float) -> int:
    """按卖一价估算可买股数，按下单粒度取整。金额不足 100 股返回 0。"""
    if not ask_price or ask_price <= 0 or cash <= 0:
        return 0
    return round_order_shares(int(cash // ask_price))


def buy_price_impact(order_shares: int, asks: list[tuple[float, int]]) -> float:
    """估算买入对价格的冲击比例（如 0.003 表示成交均价上浮 0.3%）。

    订单股数相对可见卖盘深度越大，冲击越大。平方根模型，上限 1%。
    吃掉 1 倍可见深度约 0.3%，4 倍约 0.6%。
    """
    if not asks or order_shares <= 0:
        return 0.0
    visible = sum(shares for _, shares in asks if shares and shares > 0)
    if visible <= 0:
        return 0.01
    ratio = order_shares / visible
    return min(0.003 * math.sqrt(ratio), 0.01)


class PaperPortfolio:
    """单个模拟组合：现金 + 持仓 + 成交记录。q 为该盘的轮动阈值（百分点）。"""

    def __init__(self, name: str, capital: float = INITIAL_CAPITAL, q: float | None = None):
        self.name = name
        self.q = q
        self.cash = round(capital, 2)
        self.holdings: dict[str, int] = {}  # symbol -> shares
        self.trades: list[dict[str, Any]] = []
        self.initial_capital = capital
        self.total_fees = 0.0  # 累计手续费
        self.total_impact_cost = 0.0  # 累计冲击成本（金额）
        self.rotation_count = 0  # 轮换次数（完整切换计 1）

    def holding_symbol(self) -> str | None:
        for symbol, shares in self.holdings.items():
            if shares > 0:
                return symbol
        return None

    def last_price(self, symbol: str) -> float | None:
        """该标的最近一次成交均价（用于盘后/快照缺失时估值兜底）。"""
        for trade in reversed(self.trades):
            if trade.get("symbol") == symbol and trade.get("avg_price"):
                return float(trade["avg_price"])
        return None

    def market_value(self, snapshot: dict[str, dict[str, Any]]) -> float:
        total = self.cash
        for symbol, shares in self.holdings.items():
            price = (snapshot.get(symbol) or {}).get("price")
            if not price:
                price = self.last_price(symbol)
            if price:
                total += shares * price
        return round(total, 2)

    def _price_buy_lot(self, asks: list[tuple[float, int]], filled: int
                       ) -> tuple[float, float, float, float, float]:
        """给定成交股数，算买入均价/冲击/费用。返回
        (avg_price, impact_pct, impact_cost, fee, total_cost)。"""
        _, base_cost, _ = sweep_book(asks, filled)
        base_avg = base_cost / filled if filled else 0.0
        impact_pct = buy_price_impact(filled, asks)
        avg_price = base_avg * (1 + impact_pct)
        amount = round(avg_price * filled, 2)
        impact_cost = round(amount - base_cost, 2)
        fee = round(amount * FEE_RATE, 2)
        return avg_price, impact_pct, impact_cost, fee, round(amount + fee, 2)

    def buy(self, symbol: str, quote: dict[str, Any], timestamp: str) -> dict[str, Any]:
        """全额买入（100 股/笔向下取整），扫卖盘。返回成交记录。

        扫卖盘后按订单规模计提买入冲击：大单推高价格，成交均价上浮。
        手续费万 0.5 双边，从现金计提。
        """
        asks = quote.get("asks") or []
        counter_price = asks[0][0] if asks else None
        if not asks:
            return self._record("buy", symbol, 0, 0.0, 0.0, timestamp, "no_ask_depth")
        shares = max_buyable_shares(self.cash, asks[0][0])
        if shares <= 0:
            return self._record("buy", symbol, 0, 0.0, 0.0, timestamp, "insufficient_cash")
        filled, _, levels = sweep_book(asks, shares)
        filled = round_order_shares(filled)
        if filled <= 0:
            return self._record("buy", symbol, 0, 0.0, 0.0, timestamp, "no_fill")
        avg_price, impact_pct, impact_cost, fee, total = self._price_buy_lot(asks, filled)
        # 冲击＋手续费后若超出现金，缩减到能负担的下单粒度
        if total > self.cash:
            affordable = round_order_shares(int(self.cash // (avg_price * (1 + FEE_RATE)))) if avg_price > 0 else 0
            if affordable <= 0:
                return self._record("buy", symbol, 0, 0.0, 0.0, timestamp, "insufficient_cash_impact")
            filled = affordable
            _, _, levels = sweep_book(asks, filled)
            avg_price, impact_pct, impact_cost, fee, total = self._price_buy_lot(asks, filled)
        self.cash = round(self.cash - total, 2)
        self.total_fees = round(self.total_fees + fee, 2)
        self.total_impact_cost = round(self.total_impact_cost + impact_cost, 2)
        self.holdings[symbol] = self.holdings.get(symbol, 0) + filled
        trade = self._record("buy", symbol, filled, round(avg_price, 4),
                             round(avg_price * filled, 2), timestamp, "ok")
        trade["impact_pct"] = round(impact_pct * 100, 4)
        trade["impact_cost"] = impact_cost
        trade["fee"] = fee
        trade["counter_price"] = counter_price
        trade["levels_consumed"] = levels
        return trade

    def sell(self, symbol: str, quote: dict[str, Any], timestamp: str) -> dict[str, Any]:
        """全额卖出持仓，扫买盘。返回成交记录。手续费万 0.5 从 proceeds 计提。"""
        shares = self.holdings.get(symbol, 0)
        if shares <= 0:
            return self._record("sell", symbol, 0, 0.0, 0.0, timestamp, "no_position")
        bids = quote.get("bids") or []
        counter_price = bids[0][0] if bids else None
        if not bids:
            return self._record("sell", symbol, 0, 0.0, 0.0, timestamp, "no_bid_depth")
        filled, proceeds, levels = sweep_book(bids, shares)
        fee = round(proceeds * FEE_RATE, 2)
        self.cash = round(self.cash + proceeds - fee, 2)
        self.total_fees = round(self.total_fees + fee, 2)
        self.holdings[symbol] = shares - filled
        status = "ok" if filled >= shares else "partial_fill"
        trade = self._record(
            "sell", symbol, filled,
            round(proceeds / filled, 4) if filled else 0.0,
            proceeds, timestamp, status,
        )
        trade["fee"] = fee
        trade["impact_cost"] = 0.0
        trade["counter_price"] = counter_price
        trade["levels_consumed"] = levels
        return trade

    def _record(self, side: str, symbol: str, shares: int, avg_price: float,
                amount: float, timestamp: str, status: str) -> dict[str, Any]:
        trade = {
            "portfolio": self.name,
            "timestamp": timestamp,
            "side": side,
            "symbol": symbol,
            "shares": shares,
            "avg_price": avg_price,
            "amount": amount,
            "cash_after": self.cash,
            "status": status,
            "fee": 0.0,
            "impact_cost": 0.0,
            "counter_price": None,
            "levels_consumed": 0,
        }
        self.trades.append(trade)
        return trade

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "q": self.q,
            "cash": self.cash,
            "holdings": dict(self.holdings),
            "initial_capital": self.initial_capital,
            "trade_count": len(self.trades),
            "total_fees": self.total_fees,
            "total_impact_cost": self.total_impact_cost,
            "rotation_count": self.rotation_count,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "PaperPortfolio":
        portfolio = cls(data.get("name", ""), data.get("initial_capital", INITIAL_CAPITAL))
        portfolio.q = data.get("q")
        portfolio.cash = data.get("cash", INITIAL_CAPITAL)
        portfolio.holdings = dict(data.get("holdings", {}))
        portfolio.total_fees = float(data.get("total_fees", 0.0) or 0.0)
        portfolio.total_impact_cost = float(data.get("total_impact_cost", 0.0) or 0.0)
        portfolio.rotation_count = int(data.get("rotation_count", 0) or 0)
        return portfolio


# ---------------------------------------------------------------------------
# 策略引擎
# ---------------------------------------------------------------------------

def cheapest_symbol(premiums: dict[str, float | None]) -> str | None:
    """全市场溢价最低的标的；无有效溢价返回 None；并列时取宇宙顺序靠前者。"""
    valid = [
        (premium, index, symbol)
        for index, symbol in enumerate(SYMBOLS)
        if (premium := premiums.get(symbol)) is not None
    ]
    if not valid:
        return None
    return min(valid)[2]


def signal_target(holding: str | None, premiums: dict[str, float | None], q: float) -> str | None:
    """根据全市场溢价返回目标标的，无信号返回 None（持有不动）。

    - 空仓：买入全市场溢价最低者。
    - 持仓：若（持仓溢价 − 全市场最低溢价）> q，切换到溢价最低者；
      持仓即为最低或溢价不足 q 时不动。
    - 溢价数据缺失（全市场无有效溢价，或持仓自身溢价缺失）时不产生信号。
    """
    cheapest = cheapest_symbol(premiums)
    if cheapest is None:
        return None
    if holding is None:
        return cheapest
    holding_premium = premiums.get(holding)
    if holding_premium is None:
        return None
    if holding_premium - premiums[cheapest] > q:
        return cheapest
    return None


def signal_reason(holding: str | None, premiums: dict[str, float | None],
                   target: str, q: float) -> str:
    """生成成交事件里的交易原因文案（中文），分支与 signal_target 严格对应。

    百分比数值统一保留 4 位小数。
    """
    cheapest = cheapest_symbol(premiums)
    if cheapest is None:
        return "溢价数据缺失"
    if holding is None:
        target_premium = premiums.get(target)
        if target_premium is None:
            return "溢价数据缺失"
        return f"启动建仓：买入全市场溢价最低的{target}（{target_premium:.4f}%）"
    holding_premium = premiums.get(holding)
    cheapest_premium = premiums.get(cheapest)
    if holding_premium is None or cheapest_premium is None:
        return "溢价数据缺失"
    gap = holding_premium - cheapest_premium
    return (
        f"{holding}溢价{holding_premium:.4f}%较全市场最低{cheapest}({cheapest_premium:.4f}%)"
        f"高出{gap:.4f}pp（>Q阈值{q:.4f}%）：{holding}→{cheapest}"
    )


class PaperEngine:
    """多Q并行模拟引擎：4 个新盘独立轮动，归档盘只读不参与 tick。"""

    # 快照持久化节流：磁盘最多 10 秒写一次，TiDB 最多 60 秒写一次
    SNAPSHOT_DISK_INTERVAL_SEC = 10
    SNAPSHOT_TIDB_INTERVAL_SEC = 60

    def __init__(self, data_dir: Path):
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.portfolios = {
            spec["key"]: self._load_portfolio(
                spec["key"], delay_sec=spec["delay_sec"], q=spec.get("q"))
            for spec in PORTFOLIO_SPECS
        }
        # portfolio -> {"execute_at": ts, "target": symbol, "signal_at": ts, "spread": x}
        self.pending: dict[str, dict[str, Any]] = {}
        self.last_snapshot: dict[str, dict[str, Any]] = {}
        self.last_tick: str | None = None
        self.tick_seq = 0
        # 净值/价差历史：每 tick 追加，供看板画曲线
        self.nav_history: deque = deque(maxlen=HISTORY_MAXLEN)
        self.spread_history: deque = deque(maxlen=HISTORY_MAXLEN)
        self._lock = threading.Lock()
        self._last_snapshot_disk_save = 0.0
        self._last_snapshot_tidb_save = 0.0
        self._tidb_config: dict[str, Any] | None = None
        self._tidb_table_ready = False
        # 启动时恢复快照：先磁盘，磁盘缺失再试 TiDB
        self._load_snapshot_disk() or self._load_snapshot_tidb()

    def _state_path(self, name: str) -> Path:
        return self.data_dir / f"portfolio-{name}.json"

    def _load_portfolio(self, name: str, delay_sec: int, q: float | None = None) -> dict[str, Any]:
        path = self._state_path(name)
        if path.exists():
            try:
                data = json.loads(path.read_text())
                portfolio = PaperPortfolio.from_dict(data)
            except Exception:
                portfolio = PaperPortfolio(name, q=q)
        else:
            portfolio = PaperPortfolio(name, q=q)
        # 阈值以配置为准，避免与历史状态漂移
        portfolio.q = q
        return {"portfolio": portfolio, "delay_sec": delay_sec, "q": q}

    def save(self) -> None:
        for name, entry in self.portfolios.items():
            portfolio = entry["portfolio"]
            payload = portfolio.to_dict()
            payload["trades"] = portfolio.trades[-500:]
            self._state_path(name).write_text(json.dumps(payload, ensure_ascii=False, indent=2))
        # 成交时强制落快照（双写）
        self._save_snapshot_disk(force=True)
        self._save_snapshot_tidb(force=True)

    def load_trades(self) -> None:
        for name, entry in self.portfolios.items():
            path = self._state_path(name)
            if path.exists():
                try:
                    data = json.loads(path.read_text())
                    entry["portfolio"].trades = data.get("trades", [])
                except Exception:
                    pass

    # ------------------------------------------------------------------
    # 快照持久化：磁盘为主，TiDB 为备
    # ------------------------------------------------------------------

    def _snapshot_path(self) -> Path:
        return self.data_dir / "snapshot.json"

    def _save_snapshot_disk(self, force: bool = False) -> None:
        """快照写磁盘（节流）。"""
        now = time.time()
        if not force and now - self._last_snapshot_disk_save < self.SNAPSHOT_DISK_INTERVAL_SEC:
            return
        if not self.last_snapshot:
            return
        try:
            payload = {
                "snapshot": self.last_snapshot,
                "tick": self.last_tick,
                "tick_seq": self.tick_seq,
                "nav_history": list(self.nav_history),
                "spread_history": list(self.spread_history),
                "saved_at": datetime.now(SHANGHAI).isoformat(),
            }
            # 先写临时文件再原子重命名，避免写一半被读到
            tmp = self._snapshot_path().with_suffix(".json.tmp")
            tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
            tmp.replace(self._snapshot_path())
            self._last_snapshot_disk_save = now
        except Exception as exc:
            print(f"[paper-trade] snapshot disk save failed: {exc}", flush=True)

    def _load_snapshot_disk(self) -> bool:
        """从磁盘恢复快照。成功返回 True。"""
        try:
            path = self._snapshot_path()
            if not path.exists():
                return False
            data = json.loads(path.read_text(encoding="utf-8"))
            snapshot = data.get("snapshot") or {}
            if not snapshot:
                return False
            self.last_snapshot = snapshot
            self.last_tick = data.get("tick")
            self.tick_seq = int(data.get("tick_seq") or 0)
            self.nav_history = deque(data.get("nav_history") or [], maxlen=HISTORY_MAXLEN)
            self.spread_history = deque(data.get("spread_history") or [], maxlen=HISTORY_MAXLEN)
            print(f"[paper-trade] snapshot restored from disk (tick={self.last_tick})", flush=True)
            return True
        except Exception as exc:
            print(f"[paper-trade] snapshot disk load failed: {exc}", flush=True)
            return False

    def _get_tidb_config(self) -> dict[str, Any] | None:
        """懒加载 TiDB 配置。找不到则返回 None（仅用磁盘）。"""
        if self._tidb_config is not None:
            return self._tidb_config
        # 按优先级尝试多个位置
        candidates = [
            Path(__file__).parent.parent / "config.json",
            Path(self.data_dir).parent.parent / "config.json",
        ]
        import os
        env_path = os.environ.get("MARKET_COLLECTOR_CONFIG")
        if env_path:
            candidates.insert(0, Path(env_path))
        for path in candidates:
            try:
                if path.exists():
                    cfg = json.loads(path.read_text(encoding="utf-8"))
                    tidb = (cfg.get("storage") or {}).get("tidb") or cfg.get("tidb") or {}
                    targets = tidb.get("targets") or []
                    if targets:
                        self._tidb_config = targets[0]
                        return self._tidb_config
            except Exception:
                continue
        # 明确标记为"已尝试但无配置"，避免重复查找
        self._tidb_config = {}
        return None

    def _ensure_tidb_table(self, conn) -> None:
        """建表（幂等）。"""
        if self._tidb_table_ready:
            return
        with conn.cursor() as cur:
            cur.execute(
                """CREATE TABLE IF NOT EXISTS paper_trade_snapshot (
                    id INT PRIMARY KEY DEFAULT 1,
                    snapshot_json MEDIUMTEXT NOT NULL,
                    tick VARCHAR(64),
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    CONSTRAINT chk_single_row CHECK (id = 1)
                )"""
            )
        self._tidb_table_ready = True

    def _save_snapshot_tidb(self, force: bool = False) -> None:
        """快照写 TiDB（节流，best-effort）。"""
        now = time.time()
        if not force and now - self._last_snapshot_tidb_save < self.SNAPSHOT_TIDB_INTERVAL_SEC:
            return
        if not self.last_snapshot:
            return
        target = self._get_tidb_config()
        if not target:
            return
        try:
            import os
            import pymysql
            password = target.get("password") or ""
            pw_env = str(target.get("password_env") or "").strip()
            if pw_env:
                password = os.environ.get(pw_env) or password
            pw_file = str(target.get("password_file") or "").strip()
            if not password and pw_file and Path(pw_file).exists():
                password = Path(pw_file).read_text(encoding="utf-8").strip()
            conn = pymysql.connect(
                host=target["host"],
                port=int(target.get("port") or 4000),
                user=target["user"],
                password=password,
                database=target.get("database") or "ai_dca_market",
                ssl_verify_cert=True,
                ssl_verify_identity=True,
                ssl_ca=target.get("ssl_ca") or "/etc/ssl/certs/ca-certificates.crt",
                autocommit=True,
                charset="utf8mb4",
                connect_timeout=5,
            )
            try:
                self._ensure_tidb_table(conn)
                with conn.cursor() as cur:
                    cur.execute(
                        """INSERT INTO paper_trade_snapshot (id, snapshot_json, tick)
                           VALUES (1, %s, %s)
                           ON DUPLICATE KEY UPDATE
                             snapshot_json = VALUES(snapshot_json),
                             tick = VALUES(tick)""",
                        (json.dumps(self.last_snapshot, ensure_ascii=False), self.last_tick),
                    )
                self._last_snapshot_tidb_save = now
            finally:
                conn.close()
        except Exception as exc:
            print(f"[paper-trade] snapshot tidb save failed: {exc}", flush=True)

    def _load_snapshot_tidb(self) -> bool:
        """从 TiDB 恢复快照（磁盘缺失时的兜底）。成功返回 True。"""
        target = self._get_tidb_config()
        if not target:
            return False
        try:
            import os
            import pymysql
            password = target.get("password") or ""
            pw_env = str(target.get("password_env") or "").strip()
            if pw_env:
                password = os.environ.get(pw_env) or password
            pw_file = str(target.get("password_file") or "").strip()
            if not password and pw_file and Path(pw_file).exists():
                password = Path(pw_file).read_text(encoding="utf-8").strip()
            conn = pymysql.connect(
                host=target["host"],
                port=int(target.get("port") or 4000),
                user=target["user"],
                password=password,
                database=target.get("database") or "ai_dca_market",
                ssl_verify_cert=True,
                ssl_verify_identity=True,
                ssl_ca=target.get("ssl_ca") or "/etc/ssl/certs/ca-certificates.crt",
                autocommit=True,
                charset="utf8mb4",
                connect_timeout=5,
            )
            try:
                with conn.cursor() as cur:
                    cur.execute("SELECT snapshot_json, tick FROM paper_trade_snapshot WHERE id = 1")
                    row = cur.fetchone()
                if not row:
                    return False
                snapshot = json.loads(row[0]) if isinstance(row[0], str) else row[0]
                if not snapshot:
                    return False
                self.last_snapshot = snapshot
                self.last_tick = row[1]
                print(f"[paper-trade] snapshot restored from tidb (tick={self.last_tick})", flush=True)
                return True
            finally:
                conn.close()
        except Exception as exc:
            print(f"[paper-trade] snapshot tidb load failed: {exc}", flush=True)
            return False

    def _execute_switch(self, portfolio: PaperPortfolio, holding: str | None, target: str,
                        snapshot: dict[str, dict[str, Any]], stamp: str,
                        signal_premiums: dict[str, float | None], signal_at: str,
                        delay: int, q: float | None) -> list[dict[str, Any]]:
        """执行一次切换：卖出旧标的、买入新标的。完整切换计一次轮换。"""
        events: list[dict[str, Any]] = []
        reason = signal_reason(holding, signal_premiums, target, q or 0.0)
        if holding and holding != target:
            quote = snapshot.get(holding) or {}
            sell_event = portfolio.sell(holding, quote, stamp)
            sell_event["reason"] = reason
            events.append(sell_event)
        if target != portfolio.holding_symbol():
            quote = snapshot.get(target) or {}
            buy_event = portfolio.buy(target, quote, stamp)
            holding_premium = signal_premiums.get(holding)
            target_premium = signal_premiums.get(target)
            buy_event["signal_gap"] = (
                round(holding_premium - target_premium, 4)
                if holding_premium is not None and target_premium is not None
                else None
            )
            buy_event["signal_at"] = signal_at
            buy_event["exec_delay_sec"] = delay
            buy_event["reason"] = reason
            events.append(buy_event)
            # 建仓不算轮换，只有"卖旧买新"的完整切换才计
            if holding and buy_event.get("status") == "ok":
                portfolio.rotation_count += 1
        return events

    def tick(self, snapshot: dict[str, dict[str, Any]], now_ts: float) -> list[dict[str, Any]]:
        """处理一轮行情。返回本轮产生的成交记录。"""
        events: list[dict[str, Any]] = []
        with self._lock:
            self.last_snapshot = snapshot
            stamp = shanghai_now().isoformat()
            self.last_tick = stamp
            self.tick_seq += 1
            # 快照双写持久化（节流）
            self._save_snapshot_disk()
            self._save_snapshot_tidb()
            premiums = {
                symbol: (snapshot.get(symbol) or {}).get("premium")
                for symbol in SYMBOLS
            }
            # 全市场极差（max − min），仅展示用
            valid_premiums = [p for p in premiums.values() if p is not None]
            spread = (
                round(max(valid_premiums) - min(valid_premiums), 4)
                if len(valid_premiums) >= 2 else None
            )

            for name, entry in self.portfolios.items():
                portfolio: PaperPortfolio = entry["portfolio"]
                delay = entry["delay_sec"]
                q = entry.get("q")
                # 先执行到期的预约（用本轮行情成交）
                pending = self.pending.get(name)
                if pending and now_ts >= pending["execute_at"]:
                    del self.pending[name]
                    events.extend(self._execute_switch(
                        portfolio, portfolio.holding_symbol(), pending["target"],
                        snapshot, stamp, pending.get("premiums"),
                        pending.get("signal_stamp"), delay, q))
                # 再根据本轮信号预约：无预约则新建；目标变化则替换（重新计时）
                # delay 为 0（实时盘）时当即用本轮行情执行，不预约
                holding = portfolio.holding_symbol()
                target = signal_target(holding, premiums, q or 0.0)
                if target is not None and target != holding:
                    if delay <= 0:
                        events.extend(self._execute_switch(
                            portfolio, holding, target, snapshot, stamp, premiums, stamp, 0, q))
                    else:
                        pending = self.pending.get(name)
                        if pending is None or pending["target"] != target:
                            self.pending[name] = {
                                "execute_at": now_ts + delay,
                                "target": target,
                                "signal_at": now_ts,
                                "premiums": premiums,
                                "signal_stamp": stamp,
                            }
            # 记录净值/价差历史（锁内，快照已更新）；净值序列按组合 key 扩展
            point: dict[str, Any] = {"t": stamp}
            for name, entry in self.portfolios.items():
                point[name] = entry["portfolio"].market_value(snapshot)
            self.nav_history.append(point)
            if spread is not None:
                self.spread_history.append({"t": stamp, "spread": spread})
            if events:
                self.save()
        return events

    def refresh_offhours(self, snapshot: dict[str, dict[str, Any]]) -> None:
        """休市刷新展示用行情：只更新快照，不触发任何策略/成交逻辑。

        腾讯休市仍返回昨收价；东财休市无 IOPV，缺失字段用上次快照的值补齐；
        溢价仍缺失时用 collector 日线溢价兜底（premium_source 记为 "nav"）。
        """
        with self._lock:
            prev = {s: dict(r) for s, r in (self.last_snapshot or {}).items()}
        # 需要兜底的标的：本轮和上轮都没有溢价。网络 IO 在锁外做。
        need_nav = [
            s for s in SYMBOLS
            if (prev.get(s) or {}).get("premium") is None
            and ((snapshot or {}).get(s) or {}).get("premium") is None
        ]
        nav_fallback: dict[str, dict[str, Any]] = {}
        for symbol in need_nav:
            latest = fetch_latest_premium(symbol)
            if latest:
                nav_fallback[symbol] = latest
        with self._lock:
            merged: dict[str, dict[str, Any]] = {}
            for symbol in SYMBOLS:
                row = (snapshot or {}).get(symbol) or {}
                old = prev.get(symbol) or {}
                new_row = dict(old)
                for key in ("price", "bids", "asks", "suspended"):
                    value = row.get(key)
                    if value is not None and value != []:
                        new_row[key] = value
                iopv = row.get("iopv")
                if iopv is not None:
                    new_row["iopv"] = iopv
                    if row.get("premium") is not None:
                        new_row["premium"] = row["premium"]
                        new_row["premium_source"] = "iopv"
                if new_row.get("premium") is None and symbol in nav_fallback:
                    latest = nav_fallback[symbol]
                    new_row["premium"] = latest["premium"]
                    new_row["premium_source"] = "nav"
                    if new_row.get("price") is None and latest.get("price"):
                        new_row["price"] = latest["price"]
                new_row["symbol"] = symbol
                new_row["captured_at"] = row.get("captured_at") or old.get("captured_at")
                merged[symbol] = new_row
            for symbol, old in prev.items():
                merged.setdefault(symbol, old)
            if any((r.get("price") is not None) for r in merged.values()):
                self.last_snapshot = merged
                self.last_tick = shanghai_now().isoformat()
                self._save_snapshot_disk()

    def status(self) -> dict[str, Any]:
        with self._lock:
            snapshot = self.last_snapshot
            out: dict[str, Any] = {
                "timestamp": self.last_tick,
                "tick_seq": self.tick_seq,
                "in_trading_hours": in_trading_hours(),
                "strategy": {
                    "symbols": list(SYMBOLS),
                    "symbol_names": dict(SYMBOL_NAMES),
                    "portfolios": [
                        {
                            "key": spec["key"],
                            "label": spec["label"],
                            "q_threshold": spec.get("q"),
                            "delay_sec": spec["delay_sec"],
                        }
                        for spec in PORTFOLIO_SPECS
                    ],
                    "lot_shares": LOT_SHARES,
                    "min_order_shares": MIN_ORDER_SHARES,
                    "fee_rate": FEE_RATE,
                    "initial_capital": INITIAL_CAPITAL,
                },
                "portfolios": {},
                "pending": dict(self.pending),
                "quotes": {
                    symbol: {
                        "symbol": symbol,
                        "price": (row or {}).get("price"),
                        "iopv": (row or {}).get("iopv"),
                        "premium": (row or {}).get("premium"),
                        "premium_source": (row or {}).get("premium_source"),
                        "quote_ts": (row or {}).get("captured_at"),
                        "bids": (row or {}).get("bids", []),
                        "asks": (row or {}).get("asks", []),
                    }
                    for symbol, row in snapshot.items()
                },
            }
            for name, entry in self.portfolios.items():
                portfolio: PaperPortfolio = entry["portfolio"]
                market_value = portfolio.market_value(snapshot or {})
                out["portfolios"][name] = {
                    **portfolio.to_dict(),
                    "market_value": market_value,
                    "pnl": round(market_value - portfolio.initial_capital, 2),
                    "pnl_pct": round((market_value - portfolio.initial_capital) / portfolio.initial_capital * 100, 4),
                    "q_threshold": entry.get("q"),
                    "exec_delay_sec": entry["delay_sec"],
                }
            return out

    def history(self, limit: int = 2000) -> dict[str, Any]:
        """返回净值/价差历史序列（看板画曲线用）。"""
        with self._lock:
            nav = list(self.nav_history)[-limit:]
            spread = list(self.spread_history)[-limit:]
            return {"nav": nav, "spread": spread, "tick_seq": self.tick_seq}

    def recent_trades(self, portfolio: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
        with self._lock:
            trades: list[dict[str, Any]] = []
            for name, entry in self.portfolios.items():
                if portfolio and name != portfolio:
                    continue
                trades.extend(entry["portfolio"].trades)
            trades.sort(key=lambda t: t.get("timestamp", ""), reverse=True)
            return trades[:limit]


# ---------------------------------------------------------------------------
# HTTP 查询接口
# ---------------------------------------------------------------------------

class _Handler(BaseHTTPRequestHandler):
    engine: PaperEngine | None = None

    def _send(self, payload: Any, code: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed.query)
        if parsed.path == "/api/paper-trade/status":
            self._send(self.engine.status() if self.engine else {})
        elif parsed.path == "/api/paper-trade/history":
            try:
                limit = int((query.get("limit") or ["2000"])[0])
            except (TypeError, ValueError):
                limit = 2000
            limit = max(1, min(limit, HISTORY_MAXLEN))
            self._send(self.engine.history(limit) if self.engine else {"nav": [], "spread": []})
        elif parsed.path == "/api/paper-trade/trades":
            portfolio = (query.get("portfolio") or [None])[0]
            limit = int((query.get("limit") or ["100"])[0])
            self._send(self.engine.recent_trades(portfolio, limit) if self.engine else [])
        elif parsed.path == "/health":
            self._send({"ok": True, "service": "paper-trade"})
        else:
            self._send({"error": "not_found"}, 404)

    def log_message(self, *args: Any) -> None:  # 安静日志
        pass


def serve_http(engine: PaperEngine, host: str = HTTP_HOST, port: int = HTTP_PORT) -> None:
    _Handler.engine = engine
    server = HTTPServer((host, port), _Handler)
    print(f"[paper-trade] http api on {host}:{port}", flush=True)
    server.serve_forever()


# ---------------------------------------------------------------------------
# 主循环
# ---------------------------------------------------------------------------

def run_forever(root: str, data_dir: str | None = None) -> None:
    data_path = Path(data_dir) if data_dir else Path(root) / "data" / "paper-trade"
    engine = PaperEngine(data_path)
    engine.load_trades()
    http_thread = threading.Thread(target=serve_http, args=(engine,), daemon=True)
    http_thread.start()
    print("[paper-trade] started, waiting for trading hours", flush=True)
    last_offhours_fetch = 0.0
    while True:
        try:
            if not in_trading_hours():
                # 休市期间也定期抓一次展示用行情，保证看板有最新价格/溢价；不跑策略
                now_ts = time.time()
                if now_ts - last_offhours_fetch >= OFFHOURS_SNAPSHOT_SEC:
                    last_offhours_fetch = now_ts
                    try:
                        snapshot = fetch_market_snapshot()
                    except Exception as exc:
                        print(f"[paper-trade] off-hours fetch failed: {exc}", flush=True)
                        snapshot = None
                    if snapshot:
                        try:
                            engine.refresh_offhours(snapshot)
                        except Exception as exc:
                            print(f"[paper-trade] off-hours refresh failed: {exc}", flush=True)
                time.sleep(10)
                continue
            tick_start = time.monotonic()
            now_ts = time.time()
            try:
                snapshot = fetch_market_snapshot()
            except Exception as exc:
                print(f"[paper-trade] fetch failed: {exc}", flush=True)
                time.sleep(1)
                continue
            events = engine.tick(snapshot, now_ts)
            for event in events:
                print(f"[paper-trade] {json.dumps(event, ensure_ascii=False)}", flush=True)
            elapsed = time.monotonic() - tick_start
            time.sleep(max(0.0, 1.0 - elapsed))
        except Exception as exc:  # 单轮异常不杀进程
            print(f"[paper-trade] tick error: {exc}", flush=True)
            time.sleep(1)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="纳指100ETF 全市场轮动多Q并行模拟盘。")
    parser.add_argument("--root", default="services/market-collector")
    parser.add_argument("--data-dir", default=None)
    parser.add_argument("--once", action="store_true", help="抓一轮行情打印后退出（调试用）。")
    args = parser.parse_args(argv)
    if args.once:
        snapshot = fetch_market_snapshot()
        print(json.dumps(snapshot, ensure_ascii=False, indent=2))
        return 0
    run_forever(args.root, args.data_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
