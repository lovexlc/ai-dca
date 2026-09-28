"""159659 / 159632 溢价套利模拟盘。

标的：159659（招商纳斯达克100ETF QDII）、159632（华安纳斯达克100ETF QDII）。

策略（两套并行模拟，仅执行时延不同）：
- 本金 100 万 CNY。启动时买入当时溢价更低的那只。
- spread = premium(159659) - premium(159632)，单位百分点。
- spread > 0.3 时全额切换到 159632；spread < 0.1 时全额切换到 159659。
- 每次只持有一只基金；切换时全额切换。
- 以 100 手为单位（1 手=100 股，即 10000 股的整数倍），金额不足时向下取整。
- 买卖用实时买卖盘：买入按卖盘（卖一→卖五）逐档吃单，卖出按买盘
  （买一→买五）逐档吃单；某档数量不足就吃完该档继续下一档。

执行时延：
- quant：信号触发后 1 秒执行（用 1 秒后的行情成交）。
- manual：信号触发后 3 秒执行（用 3 秒后的行情成交）。

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

SYMBOLS = ("159659", "159632")
INITIAL_CAPITAL = 1_000_000.0
LOT_SHARES = 100 * 100  # 100 手 = 10000 股
SPREAD_UPPER = 0.3  # spread > 0.3 -> 切到 159632
SPREAD_LOWER = 0.1  # spread < 0.1 -> 切到 159659

TENCENT_URL = "https://qt.gtimg.cn/q=sz159659,sz159632"

TRADING_WINDOWS = (
    (day_time(9, 30), day_time(11, 30)),
    (day_time(13, 0), day_time(15, 0)),
)

HTTP_HOST = "127.0.0.1"
HTTP_PORT = 18081


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
            "bids": row.get("bids", []),
            "asks": row.get("asks", []),
            "suspended": row.get("suspended", False),
        }
    return snapshot


# ---------------------------------------------------------------------------
# 撮合模拟
# ---------------------------------------------------------------------------

def sweep_book(levels: list[tuple[float, int]], shares: int) -> tuple[int, float]:
    """按盘口逐档吃单。

    levels: [(price, available_shares)]，买入时传 asks（卖一→卖五），
    卖出时传 bids（买一→买五）。
    返回 (实际成交股数, 总金额)。档位吃完仍不足则部分成交。
    """
    remaining = shares
    filled = 0
    amount = 0.0
    for price, available in levels:
        if remaining <= 0:
            break
        take = min(remaining, available)
        filled += take
        amount += take * price
        remaining -= take
    return filled, round(amount, 2)


def round_down_lots(shares: int) -> int:
    """向下取整到 100 手（10000 股）的整数倍。"""
    return (shares // LOT_SHARES) * LOT_SHARES


def max_buyable_shares(cash: float, ask_price: float) -> int:
    """按卖一价估算可买股数，向下取整到 100 手。金额不足返回 0。"""
    if not ask_price or ask_price <= 0 or cash <= 0:
        return 0
    return round_down_lots(int(cash // ask_price))


class PaperPortfolio:
    """单个模拟组合：现金 + 持仓 + 成交记录。"""

    def __init__(self, name: str, capital: float = INITIAL_CAPITAL):
        self.name = name
        self.cash = round(capital, 2)
        self.holdings: dict[str, int] = {}  # symbol -> shares
        self.trades: list[dict[str, Any]] = []
        self.initial_capital = capital

    def holding_symbol(self) -> str | None:
        for symbol, shares in self.holdings.items():
            if shares > 0:
                return symbol
        return None

    def market_value(self, snapshot: dict[str, dict[str, Any]]) -> float:
        total = self.cash
        for symbol, shares in self.holdings.items():
            price = (snapshot.get(symbol) or {}).get("price")
            if price:
                total += shares * price
        return round(total, 2)

    def buy(self, symbol: str, quote: dict[str, Any], timestamp: str) -> dict[str, Any]:
        """全额买入（按 100 手向下取整），扫卖盘。返回成交记录。"""
        asks = quote.get("asks") or []
        if not asks:
            return self._record("buy", symbol, 0, 0.0, 0.0, timestamp, "no_ask_depth")
        shares = max_buyable_shares(self.cash, asks[0][0])
        if shares <= 0:
            return self._record("buy", symbol, 0, 0.0, 0.0, timestamp, "insufficient_cash")
        filled, cost = sweep_book(asks, shares)
        filled = round_down_lots(filled)
        if filled <= 0:
            return self._record("buy", symbol, 0, 0.0, 0.0, timestamp, "no_fill")
        # 按实际成交均价重算（取整后金额微调）
        _, cost = sweep_book(asks, filled)
        self.cash = round(self.cash - cost, 2)
        self.holdings[symbol] = self.holdings.get(symbol, 0) + filled
        return self._record("buy", symbol, filled, round(cost / filled, 4), cost, timestamp, "ok")

    def sell(self, symbol: str, quote: dict[str, Any], timestamp: str) -> dict[str, Any]:
        """全额卖出持仓，扫买盘。返回成交记录。"""
        shares = self.holdings.get(symbol, 0)
        if shares <= 0:
            return self._record("sell", symbol, 0, 0.0, 0.0, timestamp, "no_position")
        bids = quote.get("bids") or []
        if not bids:
            return self._record("sell", symbol, 0, 0.0, 0.0, timestamp, "no_bid_depth")
        filled, proceeds = sweep_book(bids, shares)
        self.cash = round(self.cash + proceeds, 2)
        self.holdings[symbol] = shares - filled
        status = "ok" if filled >= shares else "partial_fill"
        return self._record(
            "sell", symbol, filled,
            round(proceeds / filled, 4) if filled else 0.0,
            proceeds, timestamp, status,
        )

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
        }
        self.trades.append(trade)
        return trade

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "cash": self.cash,
            "holdings": dict(self.holdings),
            "initial_capital": self.initial_capital,
            "trade_count": len(self.trades),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "PaperPortfolio":
        portfolio = cls(data.get("name", ""), data.get("initial_capital", INITIAL_CAPITAL))
        portfolio.cash = data.get("cash", INITIAL_CAPITAL)
        portfolio.holdings = dict(data.get("holdings", {}))
        return portfolio


# ---------------------------------------------------------------------------
# 策略引擎
# ---------------------------------------------------------------------------

def signal_target(holding: str | None, spread: float | None) -> str | None:
    """根据价差信号返回目标标的，无信号返回 None。

    spread = premium(159659) - premium(159632)。
    spread > 0.3 -> 159632 更便宜，切过去；spread < 0.1 -> 159659 更便宜。
    """
    if spread is None:
        return None
    if holding == "159659" and spread > SPREAD_UPPER:
        return "159632"
    if holding == "159632" and spread < SPREAD_LOWER:
        return "159659"
    if holding is None:
        # 启动时买溢价更低者：spread > 0 说明 159659 溢价更高 -> 买 159632
        return "159632" if spread > 0 else "159659"
    return None


class PaperEngine:
    """双组合模拟引擎：quant（1s 时延）+ manual（3s 时延）。"""

    def __init__(self, data_dir: Path):
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.portfolios = {
            "quant": self._load_portfolio("quant", delay_sec=1),
            "manual": self._load_portfolio("manual", delay_sec=3),
        }
        # portfolio -> {"execute_at": ts, "target": symbol, "signal_at": ts, "spread": x}
        self.pending: dict[str, dict[str, Any]] = {}
        self.last_snapshot: dict[str, dict[str, Any]] = {}
        self.last_tick: str | None = None
        self._lock = threading.Lock()

    def _state_path(self, name: str) -> Path:
        return self.data_dir / f"portfolio-{name}.json"

    def _load_portfolio(self, name: str, delay_sec: int) -> dict[str, Any]:
        path = self._state_path(name)
        if path.exists():
            try:
                data = json.loads(path.read_text())
                portfolio = PaperPortfolio.from_dict(data)
            except Exception:
                portfolio = PaperPortfolio(name)
        else:
            portfolio = PaperPortfolio(name)
        return {"portfolio": portfolio, "delay_sec": delay_sec}

    def save(self) -> None:
        for name, entry in self.portfolios.items():
            portfolio = entry["portfolio"]
            payload = portfolio.to_dict()
            payload["trades"] = portfolio.trades[-500:]
            self._state_path(name).write_text(json.dumps(payload, ensure_ascii=False, indent=2))

    def load_trades(self) -> None:
        for name, entry in self.portfolios.items():
            path = self._state_path(name)
            if path.exists():
                try:
                    data = json.loads(path.read_text())
                    entry["portfolio"].trades = data.get("trades", [])
                except Exception:
                    pass

    def tick(self, snapshot: dict[str, dict[str, Any]], now_ts: float) -> list[dict[str, Any]]:
        """处理一轮行情。返回本轮产生的成交记录。"""
        events: list[dict[str, Any]] = []
        with self._lock:
            self.last_snapshot = snapshot
            stamp = shanghai_now().isoformat()
            self.last_tick = stamp
            prem_a = (snapshot.get("159659") or {}).get("premium")
            prem_b = (snapshot.get("159632") or {}).get("premium")
            spread = round(prem_a - prem_b, 4) if prem_a is not None and prem_b is not None else None

            for name, entry in self.portfolios.items():
                portfolio: PaperPortfolio = entry["portfolio"]
                delay = entry["delay_sec"]
                # 先执行到期的预约（用本轮行情成交）
                pending = self.pending.get(name)
                if pending and now_ts >= pending["execute_at"]:
                    del self.pending[name]
                    target = pending["target"]
                    holding = portfolio.holding_symbol()
                    if holding and holding != target:
                        quote = snapshot.get(holding) or {}
                        events.append(portfolio.sell(holding, quote, stamp))
                    if target != portfolio.holding_symbol():
                        quote = snapshot.get(target) or {}
                        buy_event = portfolio.buy(target, quote, stamp)
                        buy_event["signal_spread"] = pending.get("spread")
                        buy_event["signal_at"] = pending.get("signal_stamp")
                        buy_event["exec_delay_sec"] = delay
                        events.append(buy_event)
                # 再根据本轮信号预约：无预约则新建；目标变化则替换（重新计时）
                holding = portfolio.holding_symbol()
                target = signal_target(holding, spread)
                if target is not None and target != holding:
                    pending = self.pending.get(name)
                    if pending is None or pending["target"] != target:
                        self.pending[name] = {
                            "execute_at": now_ts + delay,
                            "target": target,
                            "signal_at": now_ts,
                            "spread": spread,
                            "signal_stamp": stamp,
                        }
            if events:
                self.save()
        return events

    def status(self) -> dict[str, Any]:
        with self._lock:
            snapshot = self.last_snapshot
            out: dict[str, Any] = {
                "timestamp": self.last_tick,
                "in_trading_hours": in_trading_hours(),
                "portfolios": {},
                "pending": dict(self.pending),
                "quotes": {
                    symbol: {
                        "price": (row or {}).get("price"),
                        "iopv": (row or {}).get("iopv"),
                        "premium": (row or {}).get("premium"),
                    }
                    for symbol, row in snapshot.items()
                },
            }
            for name, entry in self.portfolios.items():
                portfolio: PaperPortfolio = entry["portfolio"]
                market_value = portfolio.market_value(snapshot) if snapshot else portfolio.cash
                out["portfolios"][name] = {
                    **portfolio.to_dict(),
                    "market_value": market_value,
                    "pnl": round(market_value - portfolio.initial_capital, 2),
                    "pnl_pct": round((market_value - portfolio.initial_capital) / portfolio.initial_capital * 100, 4),
                    "exec_delay_sec": entry["delay_sec"],
                }
            return out

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
    while True:
        try:
            if not in_trading_hours():
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
    parser = argparse.ArgumentParser(description="159659/159632 premium arbitrage paper trading.")
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
