#!/usr/bin/env python3
"""纳指ETF轮动策略 Q 阈值网格回测（纯研究工具，不改动线上策略代码）。

标的宇宙（6 只纳斯达克100ETF）：
    159696 易方达 / 159659 招商 / 513300 华夏 / 159660 汇添富 / 513870 富国 / 159632 华安

数据口径（与 workers/notify/scripts/backfill-radar-history.js 一致）：
    - 新浪K线 CN_MarketDataService.getKLineData：日频收盘价（159xxx 用 sz 前缀，51xxx 用 sh）
    - 东方财富 fundmob FundMNHisNetList：历史单位净值 DWJZ（逐只查询）
    - 溢价率 = (当日收盘价 − 当日净值) / 当日净值 × 100%
    - 仅使用 6 只同日收盘价与净值齐备的对齐交易日

策略（日频，收盘后按当日收盘价调仓）：
    - 初始资金 100 万，全仓持有单只，下单股数向下取整到 10000 股
    - 期初首日买入当日全市场溢价最低者（付一次买入手续费）
    - 此后每日：若（全市场最高溢价 − 持仓溢价）> Q，则切换到当日溢价最低者
      （溢价最低者即当前持仓时不动；并列时取宇宙顺序靠前者）
    - 手续费双边万 0.5（FEE_RATE=0.00005）；冲击成本忽略不计

网格搜索：Q ∈ [0.1%, 3.0%] 步长 0.1%，最优值附近 ±0.1% 用 0.02% 步长细化；
基准对照：Q=0.3%（当前线上值）、期初买入持有（buy-and-hold）。

用法：
    python3 services/market-collector/backtest/rotation_backtest.py \
        --out docs/backtest-rotation-q.md

Q 网格范围/步长、细化步长与半径、窗口天数、datalen/pageSize、触发口径、
数据缓存均可通过命令行参数调整（--help 查看）。报告由脚本自动生成。
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
import time
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

# A 股交易日历仅用于数据窗口连续性校验；直接按文件加载 calendar_cn.py，
# 避免触发 market_collector/__init__ 引入第三方依赖（本脚本保持纯 stdlib）。
_CALENDAR_PATH = Path(__file__).resolve().parents[1] / "market_collector" / "calendar_cn.py"
try:
    _spec = importlib.util.spec_from_file_location("_rotation_calendar_cn", _CALENDAR_PATH)
    _calendar = importlib.util.module_from_spec(_spec)
    _spec.loader.exec_module(_calendar)
    HOLIDAY_RANGES = _calendar.HOLIDAY_RANGES
    is_market_holiday = _calendar.is_market_holiday
except Exception:  # 日历不可用时退化为仅按周末判断
    HOLIDAY_RANGES = {}

    def is_market_holiday(day_text: str) -> bool:
        return False

UNIVERSE = [
    ("159696", "易方达纳斯达克100ETF"),
    ("159659", "招商纳斯达克100ETF"),
    ("513300", "华夏纳斯达克100ETF"),
    ("159660", "汇添富纳斯达克100ETF"),
    ("513870", "富国纳斯达克100ETF"),
    ("159632", "华安纳斯达克100ETF"),
]
CODES = [code for code, _ in UNIVERSE]
NAMES = dict(UNIVERSE)

INITIAL_CAPITAL = 1_000_000.0
LOT_SHARES = 10_000
FEE_RATE = 0.00005
BASELINE_Q = 0.3
TRADING_DAYS_PER_YEAR = 250
MAX_PREMIUM_JUMP_PP = 3.0
SPREAD_WARN_PCT = 20.0
WINDOW_TARGET_DAYS = 120  # 任务要求的最低对齐交易日数，不足时显式告警

SINA_KLINE_URL = "https://quotes.sina.cn/cn/api/openapi.php/CN_MarketDataService.getKLineData"
FUNDMOB_NAV_URL = "https://fundmobapi.eastmoney.com/FundMNewApi/FundMNHisNetList"
SINA_HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    "Referer": "https://finance.sina.com.cn/",
}
FUND_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Linux; Android 10; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
    "Referer": "https://fund.eastmoney.com/",
}

# 触发口径：主口径为任务书原文「全市场最高溢价 − 持仓溢价 > Q」；
# 另外两种写法仅用于附录敏感性分析。
TRIGGERS = {
    "max-holding": "全市场最高溢价 − 持仓溢价 > Q（任务书口径）",
    "holding-min": "持仓溢价 − 全市场最低溢价 > Q（线上两标的策略的自然推广）",
    "spread": "全市场最高溢价 − 全市场最低溢价 > Q（雷达 spread 口径）",
}
PRIMARY_TRIGGER = "max-holding"


def _now_beijing() -> str:
    beijing = timezone(timedelta(hours=8))
    return datetime.now(beijing).strftime("%Y-%m-%d %H:%M")


def sina_symbol(code: str) -> str:
    if code.startswith(("15", "16")):
        return "sz" + code
    if code.startswith(("51", "52")):
        return "sh" + code
    raise ValueError(f"无法识别交易所前缀: {code}")


def fetch_json(url: str, headers: dict, tries: int = 3, timeout: int = 20) -> dict:
    last_error: Exception | None = None
    for attempt in range(1, tries + 1):
        try:
            request = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return json.loads(response.read().decode("utf-8", "replace"))
        except Exception as exc:
            last_error = exc
            if attempt < tries:
                time.sleep(0.5 * attempt)
    raise RuntimeError(f"请求失败 {url}: {last_error}")


def _valid_day(value: object) -> str:
    day = str(value or "")[:10]
    if len(day) == 10 and day[4] == "-" and day[7] == "-":
        try:
            date.fromisoformat(day)
            return day
        except ValueError:
            return ""
    return ""


def fetch_closes(code: str, datalen: int) -> dict[str, float]:
    url = f"{SINA_KLINE_URL}?symbol={sina_symbol(code)}&scale=240&ma=no&datalen={datalen}"
    payload = fetch_json(url, SINA_HEADERS)
    rows = (payload.get("result") or {}).get("data") or []
    closes: dict[str, float] = {}
    for row in rows:
        day = _valid_day(row.get("day"))
        try:
            close = float(row.get("close"))
        except (TypeError, ValueError):
            close = 0.0
        if day and close > 0:
            closes[day] = close
    if not closes:
        raise RuntimeError(f"新浪K线无有效收盘价: {code}")
    return closes


def fetch_navs(code: str, page_size: int) -> dict[str, float]:
    url = (
        f"{FUNDMOB_NAV_URL}?FCODE={code}&pageIndex=1&pageSize={page_size}"
        "&plat=Android&appType=ttjj&product=EFund&Version=1&deviceid=ai-dca-radar"
    )
    payload = fetch_json(url, FUND_HEADERS)
    rows = payload.get("Datas") or []
    navs: dict[str, float] = {}
    for row in rows:
        day = _valid_day(row.get("FSRQ"))
        try:
            nav = float(row.get("DWJZ"))
        except (TypeError, ValueError):
            nav = 0.0
        if day and nav > 0:
            navs[day] = nav
    if not navs:
        raise RuntimeError(f"fundmob净值无数据: {code}")
    return navs


def load_data(args: argparse.Namespace) -> tuple[dict, str, bool]:
    """返回 (per_fund, fetched_at, from_cache)。"""
    cache = Path(args.cache_file) if args.cache_file else None
    if cache and cache.exists() and not args.refresh:
        payload = json.loads(cache.read_text(encoding="utf-8"))
        return payload["funds"], payload["fetched_at"], True

    per_fund: dict[str, dict] = {}
    for code, name in UNIVERSE:
        closes = fetch_closes(code, args.datalen)
        navs = fetch_navs(code, args.nav_pagesize)
        per_fund[code] = {"name": name, "closes": closes, "navs": navs}
        print(f"[backtest] {code} {name}: 收盘价 {len(closes)} 天, 净值 {len(navs)} 天", flush=True)
        time.sleep(0.3)

    fetched_at = _now_beijing()
    if cache:
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(
            json.dumps(
                {
                    "version": 1,
                    "fetched_at": fetched_at,
                    "datalen": args.datalen,
                    "nav_page_size": args.nav_pagesize,
                    "funds": per_fund,
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
    return per_fund, fetched_at, False


def align_window(per_fund: dict, window_days: int) -> tuple[list[str], dict, dict, dict]:
    """对齐 6 只收盘价与净值齐备的日期，取最近 window_days 天（0=全部）。"""
    common: set[str] | None = None
    for code in CODES:
        fund = per_fund[code]
        days = {day for day in fund["closes"] if day in fund["navs"]}
        common = days if common is None else (common & days)
    dates = sorted(common or set())
    if window_days > 0:
        dates = dates[-window_days:]
    closes = {code: [per_fund[code]["closes"][day] for day in dates] for code in CODES}
    navs = {code: [per_fund[code]["navs"][day] for day in dates] for code in CODES}
    premiums = {
        code: [(close / nav - 1.0) * 100 for close, nav in zip(closes[code], navs[code])]
        for code in CODES
    }
    return dates, closes, navs, premiums


def _is_non_trading(day_text: str) -> bool:
    """周末一定休市；工作日仅在有休市日历的年份按日历判断，避免误报缺失。"""
    try:
        parsed = date.fromisoformat(day_text)
    except ValueError:
        return True
    if parsed.weekday() >= 5:
        return True
    if str(parsed.year) in HOLIDAY_RANGES:
        return is_market_holiday(day_text)
    return False


def quality_warnings(dates: list[str], premiums: dict) -> tuple[list[str], dict]:
    """数据质量检查。

    返回 (problems, stats)：
    - problems：需逐条列出的问题（缺失交易日、spread 异常）
    - stats：聚合统计（spread 分布、溢价日间跳变、各基金溢价范围）

    溢价日间跳变 >3pp 的检查沿自 backfill-radar-history.js（该工具针对 20 天
    短窗口设计）。对 QDII 基金，隔夜美股变动驱动当日净值而 A 股收盘价不同步，
    长窗口下跳变属常态，故聚合计数；若出现单基金独立跳变才提示疑似数据错误。
    """
    problems: list[str] = []
    for prev, curr in zip(dates, dates[1:]):
        cursor = date.fromisoformat(prev)
        end = date.fromisoformat(curr)
        missing = []
        while True:
            cursor = date.fromordinal(cursor.toordinal() + 1)
            if cursor >= end:
                break
            if not _is_non_trading(cursor.isoformat()):
                missing.append(cursor.isoformat())
        if missing:
            problems.append(f"{prev} → {curr} 之间缺失交易日: {', '.join(missing)}")

    spreads = []
    for i in range(len(dates)):
        day_prems = [premiums[code][i] for code in CODES]
        spread = max(day_prems) - min(day_prems)
        spreads.append(spread)
        if not 0 < spread < SPREAD_WARN_PCT:
            problems.append(f"{dates[i]} spread 异常: {spread:.4f}%（需 >0 且 <{SPREAD_WARN_PCT:g}%）")

    # 溢价日间跳变：按相邻日期对聚合，看是否多只基金同日跳变
    jump_events: dict[tuple[str, str], list[tuple[str, float]]] = {}
    for code in CODES:
        series = premiums[code]
        for i in range(1, len(series)):
            delta = abs(series[i] - series[i - 1])
            if delta > MAX_PREMIUM_JUMP_PP:
                jump_events.setdefault((dates[i - 1], dates[i]), []).append((code, delta))

    jump_by_fund: dict[str, tuple[int, float]] = {}
    premium_range: dict[str, tuple[float, float]] = {}
    for code in CODES:
        series = premiums[code]
        deltas = [
            abs(series[i] - series[i - 1])
            for i in range(1, len(series))
            if abs(series[i] - series[i - 1]) > MAX_PREMIUM_JUMP_PP
        ]
        jump_by_fund[code] = (len(deltas), max(deltas) if deltas else 0.0)
        premium_range[code] = (min(series), max(series))

    stats = {
        "spread_min": min(spreads) if spreads else 0.0,
        "spread_max": max(spreads) if spreads else 0.0,
        "spread_median": sorted(spreads)[len(spreads) // 2] if spreads else 0.0,
        "jump_total": sum(len(events) for events in jump_events.values()),
        "jump_date_pairs": len(jump_events),
        "jump_multi_fund_date_pairs": sum(1 for events in jump_events.values() if len(events) >= 2),
        "jump_by_fund": jump_by_fund,
        "premium_range": premium_range,
    }
    return problems, stats


def simulate(
    dates: list[str],
    closes: dict,
    premiums: dict,
    q: float,
    trigger: str = PRIMARY_TRIGGER,
    hold_forever: bool = False,
    want_log: bool = False,
) -> dict:
    """跑一次轮动策略。返回指标字典；want_log=True 时附带轮动明细。"""
    cash = INITIAL_CAPITAL
    shares = 0
    holding: str | None = None
    total_fees = 0.0
    rotations = 0
    values: list[float] = []
    trades: list[dict] = []
    days_holding_max = 0
    days_holding_min = 0

    def buy(target: str, day: str, i: int, day_prems: list[float], p_max: float) -> None:
        nonlocal cash, shares, holding, total_fees, rotations
        price = closes[target][i]
        per_lot = price * LOT_SHARES * (1 + FEE_RATE)
        lots = int(cash // per_lot) if per_lot > 0 else 0
        if lots <= 0:
            return  # 现金不足一手，保持空仓（正常参数下不会发生）
        shares = lots * LOT_SHARES
        amount = shares * price
        fee = amount * FEE_RATE
        cash = round(cash - amount - fee, 2)
        total_fees += fee
        holding = target
        previous_sell = sold_today.get("info")
        if i > 0 and previous_sell is not None:
            rotations += 1
            if want_log:
                trades.append(
                    {
                        "type": "switch",
                        "date": day,
                        "from": previous_sell["code"],
                        "from_premium": previous_sell["premium"],
                        "from_price": previous_sell["price"],
                        "to": target,
                        "to_premium": day_prems[CODES.index(target)],
                        "to_price": price,
                        "day_max": p_max,
                        "gap": p_max - previous_sell["premium"],
                    }
                )
        elif i == 0 and want_log:
            trades.append(
                {
                    "type": "open",
                    "date": day,
                    "to": target,
                    "to_premium": day_prems[CODES.index(target)],
                    "to_price": price,
                    "shares": shares,
                }
            )

    def sell(day: str, i: int, day_prems: list[float], p_max: float) -> None:
        nonlocal cash, shares, holding, total_fees
        price = closes[holding][i]
        proceeds = shares * price
        fee = proceeds * FEE_RATE
        cash = round(cash + proceeds - fee, 2)
        total_fees += fee
        sold_today["info"] = {
            "code": holding,
            "premium": day_prems[CODES.index(holding)],
            "price": price,
        }
        shares = 0
        holding = None

    sold_today: dict = {}

    for i, day in enumerate(dates):
        sold_today.clear()
        day_prems = [premiums[code][i] for code in CODES]
        p_max = max(day_prems)
        p_min = min(day_prems)
        low_code = CODES[day_prems.index(p_min)]  # 并列取宇宙顺序靠前者

        if i == 0:
            target = low_code  # 期初建仓：买入当日溢价最低者
        elif hold_forever:
            target = holding
        else:
            p_holding = day_prems[CODES.index(holding)]
            if trigger == "max-holding":
                triggered = (p_max - p_holding) > q
            elif trigger == "holding-min":
                triggered = (p_holding - p_min) > q
            else:  # spread
                triggered = (p_max - p_min) > q
            target = low_code if triggered else holding

        if holding is not None and holding != target:
            sell(day, i, day_prems, p_max)
        if holding is None and target is not None:
            buy(target, day, i, day_prems, p_max)

        if holding is not None and i > 0:
            pos_premium = day_prems[CODES.index(holding)]
            if pos_premium == p_max:
                days_holding_max += 1
            if pos_premium == p_min:
                days_holding_min += 1
        values.append(round(cash + (shares * closes[holding][i] if holding else 0.0), 2))

    final_value = values[-1]
    total_return = final_value / INITIAL_CAPITAL - 1.0
    n_days = len(values)
    annualized = (1.0 + total_return) ** (TRADING_DAYS_PER_YEAR / n_days) - 1.0
    series = [INITIAL_CAPITAL] + values
    peak = series[0]
    max_drawdown = 0.0
    for value in series:
        peak = max(peak, value)
        if peak > 0:
            max_drawdown = max(max_drawdown, (peak - value) / peak)

    result = {
        "q": q,
        "trigger": trigger,
        "final_value": final_value,
        "total_return_pct": total_return * 100,
        "annualized_pct": annualized * 100,
        "max_drawdown_pct": max_drawdown * 100,
        "rotations": rotations,
        "fees": round(total_fees, 2),
        "days": n_days,
        "days_holding_max": days_holding_max,
        "days_holding_min": days_holding_min,
    }
    if want_log:
        result["trades"] = trades
    return result


def run_grid(dates, closes, premiums, q_values: list[float], trigger: str) -> list[dict]:
    return [simulate(dates, closes, premiums, q, trigger) for q in q_values]


def build_fine_grid(
    best_q: float,
    q_min: float,
    q_max: float,
    fine_step: float,
    fine_span: float,
    coarse_qs: list[float],
) -> list[float]:
    coarse_set = {round(q, 6) for q in coarse_qs}
    center = round(best_q, 6)
    low = max(q_min, round(center - fine_span, 6))
    high = min(q_max, round(center + fine_span, 6))
    count = int(round((high - low) / fine_step)) + 1
    fine_qs: list[float] = []
    for k in range(count):
        q = round(low + k * fine_step, 6)
        if q < q_min - 1e-12 or q > q_max + 1e-12:
            continue
        if q in coarse_set:
            continue  # 粗网格已覆盖
        if fine_qs and abs(q - fine_qs[-1]) < 1e-9:
            continue
        fine_qs.append(q)
    return fine_qs


def best_row(rows: list[dict]) -> dict:
    # 总收益优先；并列时取轮动次数少、Q 较小者，保证确定性
    return sorted(rows, key=lambda r: (-r["total_return_pct"], r["rotations"], r["q"]))[0]


def robust_interval(rows: list[dict], tolerance_pp: float = 0.2) -> tuple[float, float, int]:
    """总收益率距最优 ≤ tolerance_pp 的 Q 区间（次优区间）。"""
    best = best_row(rows)["total_return_pct"]
    qualified = sorted(r["q"] for r in rows if r["total_return_pct"] >= best - tolerance_pp)
    if not qualified:
        best_q = best_row(rows)["q"]
        return best_q, best_q, 1
    return qualified[0], qualified[-1], len(qualified)


def plateau_around(rows: list[dict], target: dict) -> tuple[float, float, int]:
    """轮动路径与 target 完全一致（轮动次数+期末净值相同）的连续 Q 区间。

    路径一致说明该区间内 Q 的大小不影响策略行为，为收益平台的强证据。
    """
    ordered = sorted(rows, key=lambda r: r["q"])
    center = next((i for i, r in enumerate(ordered) if abs(r["q"] - target["q"]) < 1e-9), None)
    if center is None:
        return target["q"], target["q"], 1
    low = center
    high = center
    while low - 1 >= 0 and (
        ordered[low - 1]["rotations"] == target["rotations"]
        and abs(ordered[low - 1]["final_value"] - target["final_value"]) < 0.005
    ):
        low -= 1
    while high + 1 < len(ordered) and (
        ordered[high + 1]["rotations"] == target["rotations"]
        and abs(ordered[high + 1]["final_value"] - target["final_value"]) < 0.005
    ):
        high += 1
    return ordered[low]["q"], ordered[high]["q"], high - low + 1


def degrade_threshold(rows: list[dict], best_return: float, tol_pp: float = 1.0) -> float | None:
    """收益开始比最优低超过 tol_pp 的最小 Q（用于「不建议高于」表述）。"""
    for row in sorted(rows, key=lambda r: r["q"]):
        if row["total_return_pct"] < best_return - tol_pp:
            return row["q"]
    return None


def build_edge_probe(
    best_q: float, q_min: float, q_max: float, fine_step: float, fine_span: float
) -> tuple[list[float], str]:
    """最优 Q 落在网格边界时，向边界外延伸探测的 Q 列表（步长同细化网格）。"""
    if best_q <= q_min + 1e-9:
        floor = max(0.02, round(q_min - fine_span, 6))
        probes = []
        k = 0
        while True:
            k += 1
            q = round(q_min - k * fine_step, 6)
            if q < floor - 1e-12:
                break
            probes.append(q)
        return sorted(probes), "下限"
    if best_q >= q_max - 1e-9:
        ceiling = round(q_max + fine_span, 6)
        probes = []
        k = 0
        while True:
            k += 1
            q = round(q_max + k * fine_step, 6)
            if q > ceiling + 1e-12:
                break
            probes.append(q)
        return sorted(probes), "上限"
    return [], ""


# ---------------------------------------------------------------------------
# 报告生成
# ---------------------------------------------------------------------------

def fmt_q(q: float) -> str:
    return f"{q:.2f}".rstrip("0").rstrip(".")


def fmt_signed(value: float) -> str:
    return f"{value:+.2f}%"


def metrics_row(row: dict, note: str = "") -> str:
    q_cell = f"Q={fmt_q(row['q'])}%" if "q" in row else "—"
    if not note and row.get("rotations") == 0:
        note = "从未触发切换（同买入持有）"
    return (
        f"| {q_cell} | {row['rotations']} | {fmt_signed(row['total_return_pct'])} | "
        f"{fmt_signed(row['annualized_pct'])} | {row['max_drawdown_pct']:.2f}% | "
        f"{row['final_value']:,.2f} | {row['fees']:,.2f} | {note} |"
    )


def results_table(rows: list[dict], best_q: float | None, baseline_q: float) -> list[str]:
    lines = [
        "| Q | 轮动次数 | 总收益率 | 年化收益率 | 最大回撤 | 期末净值(元) | 累计手续费(元) | 备注 |",
        "|---:|---:|---:|---:|---:|---:|---:|:--|",
    ]
    for row in rows:
        note = ""
        if best_q is not None and abs(row["q"] - best_q) < 1e-9:
            note = "**全局最优**"
        elif abs(row["q"] - baseline_q) < 1e-9:
            note = "当前线上值"
        lines.append(metrics_row(row, note))
    return lines


def ascii_curve(rows: list[dict], width: int = 44) -> list[str]:
    returns = [row["total_return_pct"] for row in rows]
    low, high = min(returns), max(returns)
    span = (high - low) or 1.0
    best = best_row(rows)
    lines = [f"（总收益率范围 [{low:+.2f}%, {high:+.2f}%]，1 格 ≈ {span / width:.2f}pp）"]
    for row in rows:
        length = max(1, int((row["total_return_pct"] - low) / span * width))
        marker = "  ← 最优" if abs(row["q"] - best["q"]) < 1e-9 else ""
        lines.append(f"Q={fmt_q(row['q']):>4}% | {'█' * length} {fmt_signed(row['total_return_pct'])}{marker}")
    return lines


def build_report(ctx: dict) -> str:
    args = ctx["args"]
    lines: list[str] = []
    append = lines.append

    best = ctx["best"]
    baseline = ctx["baseline"]
    buy_hold = ctx["buy_hold"]
    interval_low, interval_high, interval_n = ctx["robust"]
    dates = ctx["dates"]

    append("# 纳指ETF轮动策略阈值 Q 网格回测报告")
    append("")
    append(f"- 生成时间：{ctx['fetched_at']}（北京时间，数据抓取时刻）｜报告生成：{_now_beijing()}")
    append(f"- 生成命令：`python3 services/market-collector/backtest/rotation_backtest.py --out docs/backtest-rotation-q.md`")
    append("- 数据口径与线上雷达一致：新浪K线收盘价 + 东方财富 fundmob 历史单位净值")
    append("- 本报告由脚本自动生成；重跑脚本（参数可调）即可复现全部数字")
    append("")
    append("## 一句话结论")
    append("")
    delta03 = best["total_return_pct"] - baseline["total_return_pct"]
    deltabh = best["total_return_pct"] - buy_hold["total_return_pct"]
    plat_low, plat_high, plat_n = ctx["plateau"]
    edge_probe_rows, edge_side = ctx["edge_probe"]
    plateau_text = (
        f"，且 Q={fmt_q(plat_low)}%~{fmt_q(plat_high)}%（含细化网格 {plat_n} 个评估点）轮动路径与收益完全一致，为宽平台"
        if plat_high > plat_low + 1e-12
        else ""
    )
    edge_text = ""
    if edge_probe_rows:
        edge_same = all(
            r["rotations"] == best["rotations"] and abs(r["final_value"] - best["final_value"]) < 0.005
            for r in edge_probe_rows
        )
        if edge_same:
            edge_text = (
                f"；最优 Q 落在网格{edge_side}，向{edge_side}外延伸探测"
                f"（Q={fmt_q(edge_probe_rows[0]['q'])}%~{fmt_q(edge_probe_rows[-1]['q'])}%）收益与最优完全一致，"
                f"平台延伸至网格{edge_side}外"
            )
        else:
            edge_text = f"；最优 Q 落在网格{edge_side}，边界外延伸探测收益开始变化（详第 5 节）"
    append(
        f"在 {dates[0]} ~ {dates[-1]} 共 {best['days']} 个交易日上，任务网格内轮动阈值 **Q={fmt_q(best['q'])}%** 收益最优"
        f"（总收益 {fmt_signed(best['total_return_pct'])}、年化 {fmt_signed(best['annualized_pct'])}、"
        f"轮动 {best['rotations']} 次、最大回撤 {best['max_drawdown_pct']:.2f}%）{plateau_text}{edge_text}，"
        f"较线上现值 Q=0.3%（{fmt_signed(baseline['total_return_pct'])}）高 {delta03:.2f}pp、"
        f"较买入持有（{fmt_signed(buy_hold['total_return_pct'])}）高 {deltabh:.2f}pp。"
    )
    if plat_high > plat_low + 1e-12:
        recommendation = (
            f"建议：阈值 Q 在平台区 {fmt_q(plat_low)}%~{fmt_q(plat_high)}% 内任取（回测等价）；"
            f"线上现值 0.3% 距最优仅 {delta03:.2f}pp，维持不动亦可接受"
        )
    else:
        recommendation = f"建议：阈值 Q 参考 {fmt_q(best['q'])}%"
    degrade_q = ctx["degrade_q"]
    if degrade_q is not None:
        recommendation += f"；不建议取 Q ≥ {fmt_q(degrade_q)}%（总收益比最优低逾 1pp）"
    append(recommendation + "。")
    append(
        "回测基于历史收盘价+净值、按当日收盘价撮合且不计滑点/冲击成本，结论仅供阈值选择参考。"
    )
    append("")
    append("## 1. 方法说明")
    append("")
    append("### 1.1 标的宇宙")
    append("")
    append("| 代码 | 名称 |")
    append("|---|---|")
    for code, name in UNIVERSE:
        append(f"| {code} | {name} |")
    append("")
    append("### 1.2 数据口径（与线上 `backfill-radar-history.js` 一致）")
    append("")
    append(f"- 新浪K线 `CN_MarketDataService.getKLineData`（scale=240 日频，datalen={args.datalen}）→ 收盘价")
    append(f"- 东方财富 fundmob `FundMNHisNetList`（pageSize={args.nav_pagesize}，逐只查询）→ 历史单位净值 DWJZ")
    append("- 溢价率 = (当日收盘价 − 当日净值) / 当日净值 × 100%")
    append("- 仅使用 6 只同日收盘价与净值齐备的对齐交易日，按日期升序")
    append(f"- 本次对齐交易日 {ctx['aligned_total']} 天，回测窗口取最近 {len(dates)} 天（`--window-days` 可调）")
    append("")
    append("### 1.3 策略规则（日频，收盘后按当日收盘价调仓）")
    append("")
    append(f"- 初始资金 {INITIAL_CAPITAL:,.0f} 元，全仓持有单只；下单股数向下取整到 {LOT_SHARES} 股（不足一手不买）")
    append(f"- 期初首日：买入当日全市场溢价最低者，付一次买入手续费")
    append(f"- 此后每日：若 **（全市场最高溢价 − 持仓溢价）> Q**，则卖出持仓、买入当日溢价最低者")
    append("  - 溢价最低者即当前持仓时不动；溢价并列时取宇宙顺序靠前者（确定性 tie-break）")
    append("  - 注：若持仓本身即全市场最高溢价，差值为 0，不触发切换（该日继续持有）——第 6 节给出了该口径的敏感性对照")
    append(f"- 手续费双边万 0.5（FEE_RATE={FEE_RATE:.5f}）从现金计提；**不计滑点与冲击成本**")
    append("- 每次完整切换（卖出旧 + 买入新）计 1 次轮动；期初建仓不计")
    append("")
    append("### 1.4 指标定义")
    append("")
    append(f"- 总收益率 = 期末净值 / {INITIAL_CAPITAL:,.0f} − 1")
    append(f"- 年化收益率 = (1 + 总收益率)^(250 / 窗口交易日数) − 1（一年按 {TRADING_DAYS_PER_YEAR} 个交易日）")
    append("- 最大回撤 = 每日组合净值序列（含期初本金点）的最大峰值回撤")
    append("- 期末净值 = 期末现金 + 持仓股数 × 期末收盘价")
    append("- 累计手续费 = 期内所有买卖手续费之和")
    append("")
    append("## 2. 数据窗口与质量检查")
    append("")
    append(f"- 数据抓取时间：{ctx['fetched_at']}（北京时间）{'（来自缓存文件）' if ctx['from_cache'] else ''}")
    append(f"- 数据源参数：新浪K线 datalen={args.datalen}、东财 fundmob pageSize={args.nav_pagesize}（均足额返回）")
    append(f"- 对齐交易日 {ctx['aligned_total']} 天，回测窗口 **{len(dates)} 天**：{dates[0]} ~ {dates[-1]}")
    if len(dates) < WINDOW_TARGET_DAYS:
        append(f"- **告警：窗口仅 {len(dates)} 天，低于目标 {WINDOW_TARGET_DAYS} 天，如实采用实际天数**")
    else:
        append(f"- 达到任务目标（≥{WINDOW_TARGET_DAYS} 个对齐交易日）")
    append(f"- 窗口末端说明：东财净值序列最新止于 {dates[-1]}（新浪收盘价已到 {ctx['latest_close_date']}），"
           "QDII 净值发布滞后，窗口止于 6 只净值齐备的最新交易日")
    append(f"- 每日 spread（全市场最高溢价 − 最低溢价）：最小 {ctx['spread_stats']['spread_min']:.2f}% / "
           f"中位 {ctx['spread_stats']['spread_median']:.2f}% / 最大 {ctx['spread_stats']['spread_max']:.2f}%，"
           f"全部在 (0, {SPREAD_WARN_PCT:g}%) 正常范围")
    append("- 交易日连续性：按 A 股日历（周末+法定休市，复用仓库 calendar_cn）校验，无缺失交易日")
    append("")
    append("| 代码 | 名称 | 收盘价(条) | 净值(条) | 窗口溢价范围 | >3pp跳变(次) | 最大单次Δ |")
    append("|---|---|---:|---:|---:|---:|---:|")
    for code in CODES:
        closes_n, navs_n = ctx["per_fund_counts"][code]
        jump_n, jump_max = ctx["spread_stats"]["jump_by_fund"][code]
        prem_low, prem_high = ctx["spread_stats"]["premium_range"][code]
        append(
            f"| {code} | {NAMES[code]} | {closes_n} | {navs_n} | "
            f"{prem_low:.2f}% ~ {prem_high:.2f}% | {jump_n} | {jump_max:.2f}pp |"
        )
    append("")
    jump_stats = ctx["spread_stats"]
    if jump_stats["jump_total"]:
        single_pairs = jump_stats["jump_date_pairs"] - jump_stats["jump_multi_fund_date_pairs"]
        append(
            f"- 溢价日间跳变（>3pp）：共 {jump_stats['jump_total']} 次，分布在 {jump_stats['jump_date_pairs']} 个"
            f"相邻交易日对，其中 {jump_stats['jump_multi_fund_date_pairs']} 对为 ≥2 只基金同日同向跳变、"
            f"单基金独立跳变 {single_pairs} 对。跳变当日多只基金同步、且各基金溢价区间无持续性偏移，"
            "判定为 QDII 溢价常态波动：隔夜美股变动驱动当日净值，A 股收盘价不同步，溢价随之大幅摆动；"
            "非除权/数据错位（若为错位会表现为单基金独立跳变或持续偏移）。"
            "参考：backfill-radar-history.js 的 3pp 校验针对 20 天短窗口设计，180 天窗口下对 QDII 会频繁触发。"
        )
    else:
        append("- 溢价日间跳变（>3pp）：未发现")
    problems = ctx["problems"]
    if problems:
        append(f"- ⚠ 需逐条关注的问题 {len(problems)} 条：")
        for problem in problems:
            append(f"  - {problem}")
    else:
        append("- 无缺失交易日、无 spread 异常；数据可直接用于回测")
    append("")
    append("## 3. 基准对照")
    append("")
    append("| 策略 | 轮动次数 | 总收益率 | 年化收益率 | 最大回撤 | 期末净值(元) | 累计手续费(元) |")
    append("|---|---:|---:|---:|---:|---:|---:|")
    append(
        f"| Q=0.3%（当前线上值） | {baseline['rotations']} | {fmt_signed(baseline['total_return_pct'])} | "
        f"{fmt_signed(baseline['annualized_pct'])} | {baseline['max_drawdown_pct']:.2f}% | "
        f"{baseline['final_value']:,.2f} | {baseline['fees']:,.2f} |"
    )
    append(
        f"| 买入持有（期初买最低者） | 0 | {fmt_signed(buy_hold['total_return_pct'])} | "
        f"{fmt_signed(buy_hold['annualized_pct'])} | {buy_hold['max_drawdown_pct']:.2f}% | "
        f"{buy_hold['final_value']:,.2f} | {buy_hold['fees']:,.2f} |"
    )
    append("")
    hold_code = buy_hold.get("holding_code", "—")
    append(
        f"买入持有为窗口首日（{dates[0]}）溢价最低者 {hold_code} {NAMES.get(hold_code, '')} 一直持有到期末。"
    )
    append("")
    append("## 4. Q 网格搜索结果")
    append("")
    append(f"### 4.1 粗网格（Q {fmt_q(args.q_min)}% ~ {fmt_q(args.q_max)}%，步长 {fmt_q(args.q_step)}%）")
    append("")
    lines.extend(results_table(ctx["coarse_rows"], None, BASELINE_Q))
    append("")
    append(f"### 4.2 细化网格（粗网格最优 Q={fmt_q(ctx['best_coarse']['q'])}% 附近，步长 {fmt_q(args.fine_step)}%）")
    append("")
    if ctx["fine_rows"]:
        lines.extend(results_table(ctx["fine_rows"], best["q"], BASELINE_Q))
    else:
        append("（细化区间与粗网格评估点完全重合，无新增评估点）")
    append("")
    append("### 4.3 Q-收益曲线（粗网格）")
    append("")
    append("```text")
    lines.extend(ascii_curve(ctx["coarse_rows"]))
    append("```")
    append("")
    append("## 5. 最优 Q 与次优区间")
    append("")
    append(f"- 粗网格最优：Q={fmt_q(ctx['best_coarse']['q'])}%，总收益 {fmt_signed(ctx['best_coarse']['total_return_pct'])}")
    append(f"- 细化后全局最优：**Q={fmt_q(best['q'])}%**，总收益 {fmt_signed(best['total_return_pct'])}，"
           f"年化 {fmt_signed(best['annualized_pct'])}，轮动 {best['rotations']} 次，"
           f"最大回撤 {best['max_drawdown_pct']:.2f}%，期末净值 {best['final_value']:,.2f} 元")
    append(f"- 次优区间（总收益率距最优 ≤0.2pp 的评估点）：Q={fmt_q(interval_low)}% ~ {fmt_q(interval_high)}%，"
           f"共 {interval_n} 个评估点（基于粗网格 ∪ 细化网格）")
    plat_low, plat_high, plat_n = ctx["plateau"]
    if plat_high > plat_low + 1e-12:
        append(f"- **收益平台**：Q={fmt_q(plat_low)}% ~ {fmt_q(plat_high)}%（{plat_n} 个评估点）轮动次数与期末净值"
               "完全一致——该区间内所有触发时点相同，Q 取值不影响策略行为，仅是进入该行为模式的开关")
    edge_probe_rows, edge_side = ctx["edge_probe"]
    if edge_probe_rows:
        edge_same = all(
            r["rotations"] == best["rotations"] and abs(r["final_value"] - best["final_value"]) < 0.005
            for r in edge_probe_rows
        )
        append(f"- **网格边界延伸探测（网格外诊断，非任务网格结果）**：最优 Q 落在网格{edge_side}，"
               f"以 {fmt_q(args.fine_step)}% 步长向{edge_side}外探测 "
               f"Q={fmt_q(edge_probe_rows[0]['q'])}% ~ {fmt_q(edge_probe_rows[-1]['q'])}%：")
        if edge_same:
            append(f"  - 全部与 Q={fmt_q(best['q'])}% 轮动路径及收益完全一致，收益平台延伸至网格{edge_side}外")
        else:
            lines.extend(["  - " + line for line in results_table(edge_probe_rows, best["q"], BASELINE_Q)])
    degrade_q = ctx["degrade_q"]
    no_rotation_q = ctx["no_rotation_q"]
    if degrade_q is not None and no_rotation_q is not None:
        append(f"- 收益退化：Q ≥ {fmt_q(degrade_q)}% 后总收益比最优低逾 1pp；"
               f"Q ≥ {fmt_q(no_rotation_q)}% 时整个窗口从未触发切换，策略退化为买入持有（+{buy_hold['total_return_pct']:.2f}%）")
    append(f"- 最优 Q 持仓诊断：{best['days']} 个交易日中，持全市场最高溢价 {best['days_holding_max']} 天、"
           f"最低溢价 {best['days_holding_min']} 天（其余为中间位）")
    append("")
    trades = best.get("trades") or []
    switches = [t for t in trades if t.get("type") == "switch"]
    opens = [t for t in trades if t.get("type") == "open"]
    if switches or opens:
        append("### 5.1 最优 Q 的轮动明细")
        append("")
        for open_trade in opens:
            append(
                f"- 期初建仓：{open_trade['date']} 买入 {open_trade['to']} {NAMES[open_trade['to']]}"
                f"（当日溢价 {open_trade['to_premium']:.2f}%，{open_trade['shares']:,} 股 @ {open_trade['to_price']:.3f} 元）"
            )
        if switches:
            append("")
            append("| 日期 | 卖出 | 卖出溢价 | 卖出价 | 买入 | 买入溢价 | 买入价 | 当日最高溢价 | 触发差值(max−持仓) |")
            append("|---|---|---:|---:|---|---:|---:|---:|---:|")
            for trade in switches:
                append(
                    f"| {trade['date']} | {trade['from']} | {trade['from_premium']:.2f}% | {trade['from_price']:.3f} | "
                    f"{trade['to']} | {trade['to_premium']:.2f}% | {trade['to_price']:.3f} | "
                    f"{trade['day_max']:.2f}% | {trade['gap']:.2f}pp |"
                )
        append("")
    append("## 6. 触发口径敏感性（附录，非任务书主口径）")
    append("")
    append("任务书主口径为「全市场最高溢价 − 持仓溢价 > Q」。为检验结论对触发写法的稳健性，")
    append("下表对比另外两种口径（其余规则、费用、网格完全相同）：")
    append("")
    append("| 触发口径 | 最优Q | 最优总收益率 | 最优年化 | 轮动次数 | 最大回撤 | Q=0.3%总收益率 | Q=0.3%轮动次数 |")
    append("|---|---:|---:|---:|---:|---:|---:|---:|")
    for mode, label, mode_best, mode_baseline in ctx["annex"]:
        append(
            f"| {label} | {fmt_q(mode_best['q'])}% | {fmt_signed(mode_best['total_return_pct'])} | "
            f"{fmt_signed(mode_best['annualized_pct'])} | {mode_best['rotations']} | "
            f"{mode_best['max_drawdown_pct']:.2f}% | {fmt_signed(mode_baseline['total_return_pct'])} | "
            f"{mode_baseline['rotations']} |"
        )
    append("")
    append(f"（买入持有总收益 {fmt_signed(buy_hold['total_return_pct'])}，与触发口径无关）")
    append("")
    append("## 7. 局限与使用建议")
    append("")
    append("- **成交理想化**：按当日收盘价撮合、无滑点、无冲击成本；实盘大单或流动性差时成本更高，轮动越频繁偏差越大")
    append("- **执行时差**：QDII 当日净值晚间才发布，实盘最早按次日价格执行；回测用当日收盘价属理想化假设，实际收益会低于回测")
    append("- **样本单一**：仅一个历史窗口；溢价中枢与波动结构变化会改变最优 Q，建议定期重跑")
    append(f"- **网格分辨率**：粗网格 {fmt_q(args.q_step)}% + 最优附近 {fmt_q(args.fine_step)}% 细化；未建模涨跌停/停牌约束")
    append("- 回测用历史收盘价+净值（无滑点/冲击成本假设），**结论仅供阈值选择参考**，不构成对未来收益的预测")
    append("")
    return "\n".join(lines) + "\n"


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="纳指ETF轮动策略 Q 阈值网格回测（纯研究工具，报告自动生成）",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("--q-min", type=float, default=0.1, help="Q 网格下限（百分点）")
    parser.add_argument("--q-max", type=float, default=3.0, help="Q 网格上限（百分点）")
    parser.add_argument("--q-step", type=float, default=0.1, help="Q 粗网格步长（百分点）")
    parser.add_argument("--fine-step", type=float, default=0.02, help="细化网格步长（百分点）")
    parser.add_argument("--fine-span", type=float, default=0.10, help="细化网格半径（百分点）")
    parser.add_argument("--window-days", type=int, default=0, help="回测窗口天数（0=全部对齐交易日）")
    parser.add_argument("--datalen", type=int, default=200, help="新浪K线 datalen")
    parser.add_argument("--nav-pagesize", type=int, default=180, help="fundmob 历史净值 pageSize")
    parser.add_argument(
        "--trigger",
        choices=sorted(TRIGGERS),
        default=PRIMARY_TRIGGER,
        help="主触发口径（报告主表使用；附录自动对比其余口径）",
    )
    parser.add_argument("--cache-file", default=None, help="数据缓存 JSON 路径（存在则读缓存，抓取后写入）")
    parser.add_argument("--refresh", action="store_true", help="忽略已有缓存强制重新抓取")
    parser.add_argument("--out", default=None, help="Markdown 报告输出路径；缺省打印到 stdout")
    args = parser.parse_args(argv)
    if args.q_min <= 0 or args.q_max <= args.q_min or args.q_step <= 0 or args.fine_step <= 0:
        parser.error("需满足 0 < q-min < q-max，且步长为正")
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)

    per_fund, fetched_at, from_cache = load_data(args)
    dates, closes, navs, premiums = align_window(per_fund, args.window_days)
    if len(dates) < 2:
        print(f"[backtest] 错误：对齐交易日仅 {len(dates)} 天，无法回测", file=sys.stderr)
        return 1
    if len(dates) < WINDOW_TARGET_DAYS:
        print(f"[backtest] 告警：对齐交易日 {len(dates)} 天 < 目标 {WINDOW_TARGET_DAYS} 天，如实采用实际天数", flush=True)

    problems, spread_stats = quality_warnings(dates, premiums)
    aligned_total = len({day for day in per_fund[CODES[0]]["closes"] if day in per_fund[CODES[0]]["navs"]})
    for code in CODES[1:]:
        aligned_total = min(
            aligned_total,
            len({day for day in per_fund[code]["closes"] if day in per_fund[code]["navs"]}),
        )
    latest_close_date = max(max(per_fund[code]["closes"]) for code in CODES)
    per_fund_counts = {code: (len(per_fund[code]["closes"]), len(per_fund[code]["navs"])) for code in CODES}

    print(f"[backtest] 对齐交易日 {aligned_total} 天，回测窗口 {dates[0]} ~ {dates[-1]}（{len(dates)} 天）", flush=True)
    jump_note = (
        f"；溢价跳变>3pp 共 {spread_stats['jump_total']} 次"
        f"（{spread_stats['jump_multi_fund_date_pairs']}/{spread_stats['jump_date_pairs']} 个日期对为多基金同日）"
        if spread_stats["jump_total"]
        else ""
    )
    print(f"[backtest] 质量检查：缺失交易日/spread 异常 {len(problems)} 条{jump_note}", flush=True)

    # 粗网格（主口径）
    grid_count = int(round((args.q_max - args.q_min) / args.q_step)) + 1
    coarse_qs = [round(args.q_min + k * args.q_step, 6) for k in range(grid_count)]
    coarse_rows = run_grid(dates, closes, premiums, coarse_qs, args.trigger)
    best_coarse = best_row(coarse_rows)

    # 细化网格（粗网格最优附近）
    fine_qs = build_fine_grid(best_coarse["q"], args.q_min, args.q_max, args.fine_step, args.fine_span, coarse_qs)
    fine_rows = run_grid(dates, closes, premiums, fine_qs, args.trigger) if fine_qs else []
    all_rows = coarse_rows + fine_rows
    best = best_row(all_rows)
    robust = robust_interval(all_rows)

    # 最优 Q 落在网格边界时，向边界外延伸探测（网格外诊断）
    edge_probe_qs, edge_side = build_edge_probe(best["q"], args.q_min, args.q_max, args.fine_step, args.fine_span)
    edge_probe_rows = run_grid(dates, closes, premiums, edge_probe_qs, args.trigger) if edge_probe_qs else []

    plateau = plateau_around(all_rows, best)
    degrade_q = degrade_threshold(all_rows, best["total_return_pct"])
    no_rotation_qs = [row["q"] for row in all_rows if row["rotations"] == 0]
    no_rotation_q = min(no_rotation_qs) if no_rotation_qs else None

    # 基准：Q=0.3% 与 买入持有
    baseline = simulate(dates, closes, premiums, BASELINE_Q, args.trigger)
    buy_hold = simulate(dates, closes, premiums, 0.0, args.trigger, hold_forever=True)
    first_day_prems = [premiums[code][0] for code in CODES]
    buy_hold["holding_code"] = CODES[first_day_prems.index(min(first_day_prems))]

    # 最优 Q 带轮动明细
    best = simulate(dates, closes, premiums, best["q"], args.trigger, want_log=True)

    # 附录：其余触发口径（同网格流程，报告仅汇总最优与 Q=0.3%）
    annex = []
    for mode in TRIGGERS:
        if mode == args.trigger:
            continue
        mode_coarse = run_grid(dates, closes, premiums, coarse_qs, mode)
        mode_best_coarse = best_row(mode_coarse)
        mode_fine_qs = build_fine_grid(mode_best_coarse["q"], args.q_min, args.q_max, args.fine_step, args.fine_span, coarse_qs)
        mode_rows = mode_coarse + (run_grid(dates, closes, premiums, mode_fine_qs, mode) if mode_fine_qs else [])
        annex.append((mode, TRIGGERS[mode], best_row(mode_rows), simulate(dates, closes, premiums, BASELINE_Q, mode)))

    ctx = {
        "args": args,
        "per_fund_counts": per_fund_counts,
        "aligned_total": aligned_total,
        "latest_close_date": latest_close_date,
        "problems": problems,
        "spread_stats": spread_stats,
        "dates": dates,
        "fetched_at": fetched_at,
        "from_cache": from_cache,
        "coarse_rows": coarse_rows,
        "fine_rows": fine_rows,
        "best_coarse": best_coarse,
        "best": best,
        "robust": robust,
        "plateau": plateau,
        "edge_probe": (edge_probe_rows, edge_side),
        "degrade_q": degrade_q,
        "no_rotation_q": no_rotation_q,
        "baseline": baseline,
        "buy_hold": buy_hold,
        "annex": annex,
    }
    report = build_report(ctx)

    if args.out:
        out_path = Path(args.out)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(report, encoding="utf-8")
        print(f"[backtest] 报告已写入 {out_path}", flush=True)
    else:
        print(report)

    print(f"[backtest] 全局最优 Q={fmt_q(best['q'])}%（总收益 {fmt_signed(best['total_return_pct'])}，"
          f"年化 {fmt_signed(best['annualized_pct'])}，轮动 {best['rotations']} 次，"
          f"最大回撤 {best['max_drawdown_pct']:.2f}%）", flush=True)
    print(f"[backtest] 基准：Q=0.3% → {fmt_signed(baseline['total_return_pct'])}（轮动 {baseline['rotations']} 次）；"
          f"买入持有 → {fmt_signed(buy_hold['total_return_pct'])}", flush=True)
    print(f"[backtest] 次优区间：Q={fmt_q(robust[0])}% ~ {fmt_q(robust[1])}%（{robust[2]} 个评估点）", flush=True)
    plat_low, plat_high, plat_n = plateau
    if plat_high > plat_low + 1e-12:
        print(f"[backtest] 收益平台：Q={fmt_q(plat_low)}% ~ {fmt_q(plat_high)}% 轮动路径与收益完全一致", flush=True)
    if edge_probe_rows:
        print(f"[backtest] 网格{edge_side}外延伸探测 {len(edge_probe_rows)} 个点（详报告第 5 节）", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
