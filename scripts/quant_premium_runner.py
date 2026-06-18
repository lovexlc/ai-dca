#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import sys
import time
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, time as day_time
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo


DEFAULT_MARKETS_API_BASE = "https://api.freebacktrack.tech/api/markets"
SHANGHAI_TZ = ZoneInfo("Asia/Shanghai")
EXCHANGE_PREFIXES = {"15", "50", "51", "52", "53", "54", "56", "58"}


def number(value: Any, fallback: float = 0.0) -> float:
    try:
        out = float(value)
    except (TypeError, ValueError):
        return fallback
    return out if math.isfinite(out) else fallback


def first_number(*values: Any, positive: bool = False) -> float:
    for value in values:
        out = number(value, math.nan)
        if not math.isfinite(out):
            continue
        if positive and out <= 0:
            continue
        return out
    return 0.0


def round_to(value: Any, digits: int = 2) -> float:
    return round(number(value), digits)


def normalize_code(value: Any) -> str:
    raw = str(value or "").strip().upper()
    if raw.startswith(("SH", "SZ", "BJ")):
        raw = raw[2:]
    return raw if raw.isdigit() and len(raw) == 6 else ""


def now_shanghai() -> datetime:
    return datetime.now(SHANGHAI_TZ)


def date_key(dt: datetime) -> str:
    return dt.astimezone(SHANGHAI_TZ).date().isoformat()


def is_trading_session(dt: datetime | None = None) -> bool:
    current = (dt or now_shanghai()).astimezone(SHANGHAI_TZ)
    if current.weekday() >= 5:
        return False
    t = current.time()
    return (day_time(9, 30) <= t <= day_time(11, 30)) or (day_time(13, 0) <= t <= day_time(15, 0))


@dataclass
class Quote:
    code: str
    name: str
    price: float
    bid: float
    ask: float
    bid_size: float
    ask_size: float
    iopv: float
    premium_pct: float
    as_of: str = ""
    source: str = ""


def normalize_quote(raw: dict[str, Any], fallback_code: str = "") -> Quote | None:
    order_book = raw.get("orderBook") if isinstance(raw.get("orderBook"), dict) else {}
    code = normalize_code(raw.get("code") or raw.get("symbol") or fallback_code)
    if not code:
        return None
    price = first_number(raw.get("price"), raw.get("currentPrice"), raw.get("close"), raw.get("latestPrice"), positive=True)
    bid = first_number(order_book.get("bidPrice"), raw.get("bid"), raw.get("bidPrice"), price, positive=True)
    ask = first_number(order_book.get("askPrice"), raw.get("ask"), raw.get("askPrice"), price, positive=True)
    iopv = first_number(
        raw.get("iopv"),
        raw.get("navBase"),
        raw.get("estimatedNav"),
        raw.get("latestNav"),
        raw.get("unitNav"),
        positive=True,
    )
    explicit_premium = first_number(raw.get("premiumPercent"), raw.get("premiumPct"), raw.get("premium_rate"))
    if explicit_premium:
        premium_pct = explicit_premium
    elif price > 0 and iopv > 0:
        premium_pct = ((price - iopv) / iopv) * 100
    else:
        premium_pct = math.nan
    return Quote(
        code=code,
        name=str(raw.get("name") or code),
        price=round_to(price, 4),
        bid=round_to(bid, 4),
        ask=round_to(ask, 4),
        bid_size=first_number(order_book.get("bidVolume"), raw.get("bidSize"), raw.get("bidVolume")),
        ask_size=first_number(order_book.get("askVolume"), raw.get("askSize"), raw.get("askVolume")),
        iopv=round_to(iopv, 4),
        premium_pct=round_to(premium_pct, 4) if math.isfinite(premium_pct) else math.nan,
        as_of=str(raw.get("asOf") or raw.get("quoteAt") or raw.get("updatedAt") or ""),
        source=str(raw.get("source") or order_book.get("source") or ""),
    )


def normalize_quote_map(raw: dict[str, Any]) -> dict[str, Quote]:
    quotes: dict[str, Quote] = {}
    for key, value in (raw or {}).items():
        if not isinstance(value, dict):
            continue
        quote = normalize_quote(value, str(key))
        if quote:
            quotes[quote.code] = quote
    return quotes


def fund_kind(code: str) -> str:
    clean = normalize_code(code)
    if clean and clean[:2] in EXCHANGE_PREFIXES:
        return "exchange"
    return "otc"


def fetch_fund_metrics(codes: list[str], base_url: str, timeout_sec: float = 4.0) -> dict[str, Quote]:
    try:
        import requests
    except ImportError as exc:
        raise RuntimeError("requests is required: pip install -r requirements-quant.txt") from exc

    clean_codes = [code for code in (normalize_code(c) for c in codes) if code]
    if not clean_codes:
        return {}
    url = base_url.rstrip("/") + "/fund-metrics?refresh=1"
    payload = {
        "codes": clean_codes,
        "refresh": True,
        "fundKinds": {code: fund_kind(code) for code in clean_codes},
    }
    response = requests.post(url, json=payload, headers={"accept": "application/json"}, timeout=timeout_sec)
    response.raise_for_status()
    data = response.json()
    items = data.get("items") if isinstance(data, dict) else data
    raw_map: dict[str, Any] = {}
    for item in items if isinstance(items, list) else []:
        if isinstance(item, dict):
            code = normalize_code(item.get("code") or item.get("symbol"))
            if code:
                raw_map[code] = item
    return normalize_quote_map(raw_map)


def load_yaml_config(path: str | Path) -> dict[str, Any]:
    try:
        import yaml
    except ImportError as exc:
        raise SystemExit("PyYAML is required: pip install -r requirements-quant.txt") from exc
    with Path(path).open("r", encoding="utf-8") as handle:
        data = yaml.safe_load(handle) or {}
    if not isinstance(data, dict):
        raise SystemExit(f"config must be a YAML mapping: {path}")
    return data


def normalize_config(raw: dict[str, Any]) -> dict[str, Any]:
    runtime = dict(raw.get("runtime") or {})
    account = dict(raw.get("account") or {})
    raw_symbols = raw.get("symbols") if isinstance(raw.get("symbols"), list) else []
    symbols = []
    class_map: dict[str, str] = {}
    for item in raw_symbols:
        if not isinstance(item, dict):
            continue
        code = normalize_code(item.get("code"))
        if not code:
            continue
        cls = str(item.get("class") or "").strip().upper()
        if cls not in {"H", "L"}:
            cls = ""
        symbols.append({"code": code, "name": str(item.get("name") or code), "class": cls})
        if cls:
            class_map[code] = cls

    rules = []
    for index, item in enumerate(raw.get("rules") if isinstance(raw.get("rules"), list) else []):
        if not isinstance(item, dict):
            continue
        benchmark_codes = [code for code in (normalize_code(c) for c in item.get("benchmark_codes", [])) if code]
        enabled_codes = [code for code in (normalize_code(c) for c in item.get("enabled_codes", [])) if code]
        if not benchmark_codes or not enabled_codes:
            continue
        rule_class = dict(class_map)
        for code, cls in (item.get("premium_class") or {}).items():
            clean = normalize_code(code)
            label = str(cls or "").strip().upper()
            if clean and label in {"H", "L"}:
                rule_class[clean] = label
        rules.append({
            "id": str(item.get("id") or f"rule-{index + 1}")[:64],
            "name": str(item.get("name") or f"rule-{index + 1}")[:80],
            "enabled": item.get("enabled", True) is not False,
            "benchmark_codes": benchmark_codes,
            "enabled_codes": enabled_codes,
            "premium_class": rule_class,
            "intra_sell_lower_pct": number(item.get("intra_sell_lower_pct"), 1.0),
            "intra_buy_other_pct": number(item.get("intra_buy_other_pct"), 3.0),
            "max_order_cash": max(0.0, number(item.get("max_order_cash"), number(account.get("max_order_cash"), 16000))),
            "min_order_cash": max(0.0, number(item.get("min_order_cash"), number(account.get("min_order_cash"), 1000))),
            "cooldown_sec": max(0.0, number(item.get("cooldown_sec"), number(runtime.get("cooldown_sec"), 60))),
        })

    positions: dict[str, dict[str, Any]] = {}
    raw_positions = account.get("positions") or {}
    if isinstance(raw_positions, list):
        raw_positions = {item.get("code"): item for item in raw_positions if isinstance(item, dict)}
    for code_raw, item in raw_positions.items():
        if not isinstance(item, dict):
            continue
        code = normalize_code(item.get("code") or code_raw)
        if not code:
            continue
        positions[code] = {
            "name": str(item.get("name") or code),
            "shares": max(0.0, number(item.get("shares"))),
            "cost_price": max(0.0, number(item.get("cost_price"))),
        }

    return {
        "runtime": {
            "poll_interval_sec": max(0.2, number(runtime.get("poll_interval_sec"), 1.0)),
            "markets_api_base": str(runtime.get("markets_api_base") or DEFAULT_MARKETS_API_BASE),
            "output_dir": str(runtime.get("output_dir") or "data/quant"),
            "only_trading_session": runtime.get("only_trading_session", True) is not False,
            "max_daily_triggers": max(1, int(number(runtime.get("max_daily_triggers"), 20))),
            "request_timeout_sec": max(1.0, number(runtime.get("request_timeout_sec"), 4.0)),
        },
        "symbols": symbols,
        "rules": rules,
        "account": {
            "cash": max(0.0, number(account.get("cash"), 100000)),
            "fee_rate": max(0.0, number(account.get("fee_rate"), 0.01)),
            "min_fee": max(0.0, number(account.get("min_fee"), 0.0)),
            "tick_size": max(0.0001, number(account.get("tick_size"), 0.001)),
            "slippage_ticks": max(0.0, number(account.get("slippage_ticks"), 1)),
            "lot_size": max(1, int(number(account.get("lot_size"), 100))),
            "positions": positions,
        },
    }


def collect_codes(config: dict[str, Any]) -> list[str]:
    codes = {item["code"] for item in config.get("symbols", [])}
    for rule in config.get("rules", []):
        codes.update(rule.get("benchmark_codes", []))
        codes.update(rule.get("enabled_codes", []))
    return sorted(codes)


def classify_rule(bench_class: str, cand_class: str, gap: float, sell_lower: float, buy_other: float) -> str:
    if not math.isfinite(gap):
        return "none"
    if bench_class == "L" and cand_class == "H" and gap < sell_lower:
        return "A"
    if bench_class == "H" and cand_class == "L" and gap > buy_other:
        return "B"
    return "none"


def evaluate_rules(config: dict[str, Any], quotes: dict[str, Quote], computed_at: datetime | None = None) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    now_iso = (computed_at or now_shanghai()).astimezone(SHANGHAI_TZ).isoformat()
    for rule in config.get("rules", []):
        if not rule.get("enabled", True):
            continue
        class_map = rule.get("premium_class") or {}
        for bench in rule.get("benchmark_codes", []):
            bench_class = class_map.get(bench, "")
            bench_quote = quotes.get(bench)
            for cand in rule.get("enabled_codes", []):
                if cand == bench:
                    continue
                cand_class = class_map.get(cand, "")
                cand_quote = quotes.get(cand)
                gap = math.nan
                reason = ""
                if bench_class not in {"H", "L"} or cand_class not in {"H", "L"}:
                    reason = "missing_class"
                elif bench_class == cand_class:
                    reason = "same_class"
                elif not bench_quote or not cand_quote:
                    reason = "missing_quote"
                elif not math.isfinite(bench_quote.premium_pct) or not math.isfinite(cand_quote.premium_pct):
                    reason = "missing_premium"
                else:
                    gap = bench_quote.premium_pct - cand_quote.premium_pct if bench_class == "H" else cand_quote.premium_pct - bench_quote.premium_pct
                    reason = "evaluated"
                kind = classify_rule(
                    bench_class,
                    cand_class,
                    gap,
                    number(rule.get("intra_sell_lower_pct"), 1.0),
                    number(rule.get("intra_buy_other_pct"), 3.0),
                )
                rows.append({
                    "computed_at": now_iso,
                    "rule_id": rule.get("id"),
                    "rule_name": rule.get("name"),
                    "pair_key": f"{rule.get('id')}:{bench}:{cand}",
                    "from_code": bench if kind != "none" else "",
                    "to_code": cand if kind != "none" else "",
                    "benchmark_code": bench,
                    "candidate_code": cand,
                    "benchmark_class": bench_class,
                    "candidate_class": cand_class,
                    "benchmark_premium_pct": None if not bench_quote or not math.isfinite(bench_quote.premium_pct) else bench_quote.premium_pct,
                    "candidate_premium_pct": None if not cand_quote or not math.isfinite(cand_quote.premium_pct) else cand_quote.premium_pct,
                    "gap_pct": None if not math.isfinite(gap) else round_to(gap, 4),
                    "threshold_pct": rule.get("intra_sell_lower_pct") if kind == "A" else rule.get("intra_buy_other_pct") if kind == "B" else None,
                    "kind": kind,
                    "triggered": kind != "none",
                    "reason": reason if kind == "none" else "triggered",
                })
    return rows


def initial_state(config: dict[str, Any]) -> dict[str, Any]:
    account = config["account"]
    return {
        "cash": round_to(account.get("cash"), 2),
        "positions": deepcopy(account.get("positions") or {}),
        "daily": {"date": "", "trigger_count": 0},
        "pair_cooldowns": {},
    }


def load_state(path: Path, config: dict[str, Any]) -> dict[str, Any]:
    if not path.exists():
        return initial_state(config)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return initial_state(config)
    base = initial_state(config)
    if isinstance(data, dict):
        base.update({k: data[k] for k in ("cash", "positions", "daily", "pair_cooldowns") if k in data})
    return base


def save_state(path: Path, state: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def append_jsonl(path: Path, row: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")


def reset_daily_if_needed(state: dict[str, Any], dt: datetime) -> None:
    today = date_key(dt)
    daily = state.setdefault("daily", {})
    if daily.get("date") != today:
        daily["date"] = today
        daily["trigger_count"] = 0


def floor_to_lot(shares: float, lot_size: int) -> int:
    lot = max(1, int(lot_size))
    return int(max(0, shares) // lot) * lot


def fee(amount: float, account: dict[str, Any]) -> float:
    if amount <= 0:
        return 0.0
    raw = amount * number(account.get("fee_rate"), 0.0) / 100
    return round_to(max(raw, number(account.get("min_fee"), 0.0)), 2)


def simulate_order(
    state: dict[str, Any],
    trigger: dict[str, Any],
    quotes: dict[str, Quote],
    rule: dict[str, Any],
    config: dict[str, Any],
    timestamp: datetime,
) -> tuple[list[dict[str, Any]], str]:
    account = config["account"]
    from_code = trigger["from_code"]
    to_code = trigger["to_code"]
    sell_quote = quotes.get(from_code)
    buy_quote = quotes.get(to_code)
    if not sell_quote or not buy_quote:
        return [], "missing_quote"
    positions = state.setdefault("positions", {})
    position = positions.get(from_code) or {"shares": 0, "cost_price": 0, "name": from_code}
    tick = number(account.get("tick_size"), 0.001)
    slip = number(account.get("slippage_ticks"), 1) * tick
    lot = int(account.get("lot_size") or 100)
    sell_price = max(tick, round_to(sell_quote.bid - slip, 4))
    buy_price = max(tick, round_to(buy_quote.ask + slip, 4))
    max_cash = max(0.0, number(rule.get("max_order_cash"), 0.0))
    min_cash = max(0.0, number(rule.get("min_order_cash"), 0.0))
    bid_size = sell_quote.bid_size if sell_quote.bid_size > 0 else float("inf")
    ask_size = buy_quote.ask_size if buy_quote.ask_size > 0 else float("inf")
    sell_qty = floor_to_lot(min(number(position.get("shares")), bid_size, max_cash / sell_price if sell_price > 0 else 0), lot)
    sell_amount = round_to(sell_qty * sell_price, 2)
    sell_fee = fee(sell_amount, account)
    if sell_qty <= 0 or sell_amount < min_cash:
        return [], "insufficient_sell_position"
    available_cash = number(state.get("cash"), 0.0) + max(0.0, sell_amount - sell_fee)
    buy_qty = floor_to_lot(min(ask_size, max_cash / buy_price if buy_price > 0 else 0, available_cash / buy_price if buy_price > 0 else 0), lot)
    buy_amount = round_to(buy_qty * buy_price, 2)
    buy_fee = fee(buy_amount, account)
    if buy_qty <= 0 or buy_amount < min_cash or buy_amount + buy_fee > available_cash:
        return [], "insufficient_buy_cash"

    state["cash"] = round_to(number(state.get("cash")) + sell_amount - sell_fee - buy_amount - buy_fee, 2)
    next_sell_shares = max(0.0, number(position.get("shares")) - sell_qty)
    positions[from_code] = {
        **position,
        "name": position.get("name") or sell_quote.name,
        "shares": round_to(next_sell_shares, 4),
        "cost_price": number(position.get("cost_price")) if next_sell_shares > 0 else 0.0,
    }
    buy_position = positions.get(to_code) or {"shares": 0, "cost_price": 0, "name": buy_quote.name}
    current_cost = number(buy_position.get("shares")) * number(buy_position.get("cost_price"))
    next_buy_shares = number(buy_position.get("shares")) + buy_qty
    next_cost = (current_cost + buy_amount + buy_fee) / next_buy_shares if next_buy_shares > 0 else 0.0
    positions[to_code] = {
        **buy_position,
        "name": buy_position.get("name") or buy_quote.name,
        "shares": round_to(next_buy_shares, 4),
        "cost_price": round_to(next_cost, 4),
    }
    ts = timestamp.astimezone(SHANGHAI_TZ).isoformat()
    base = {
        "ts": ts,
        "rule_id": trigger["rule_id"],
        "rule_name": trigger["rule_name"],
        "pair_key": trigger["pair_key"],
        "gap_pct": trigger["gap_pct"],
        "threshold_pct": trigger["threshold_pct"],
        "trigger_kind": trigger["kind"],
        "status": "filled",
    }
    return [
        {**base, "side": "SELL", "code": from_code, "name": sell_quote.name, "price": sell_price, "quantity": sell_qty, "amount": sell_amount, "fee": sell_fee},
        {**base, "side": "BUY", "code": to_code, "name": buy_quote.name, "price": buy_price, "quantity": buy_qty, "amount": buy_amount, "fee": buy_fee},
    ], ""


def rule_by_id(config: dict[str, Any], rule_id: str) -> dict[str, Any] | None:
    return next((rule for rule in config.get("rules", []) if rule.get("id") == rule_id), None)


def run_tick(config: dict[str, Any], state: dict[str, Any], quotes: dict[str, Quote], computed_at: datetime | None = None) -> dict[str, Any]:
    now = (computed_at or now_shanghai()).astimezone(SHANGHAI_TZ)
    reset_daily_if_needed(state, now)
    evaluations = evaluate_rules(config, quotes, now)
    orders: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    max_daily = config["runtime"]["max_daily_triggers"]
    daily = state.setdefault("daily", {})
    cooldowns = state.setdefault("pair_cooldowns", {})
    for trigger in [row for row in evaluations if row.get("triggered")]:
        if daily.get("trigger_count", 0) >= max_daily:
            skipped.append({**trigger, "skip_reason": "daily_limit"})
            continue
        last_ts = cooldowns.get(trigger["pair_key"])
        if last_ts:
            try:
                elapsed = (now - datetime.fromisoformat(last_ts)).total_seconds()
            except ValueError:
                elapsed = float("inf")
            rule = rule_by_id(config, trigger["rule_id"]) or {}
            if elapsed < number(rule.get("cooldown_sec"), 0):
                skipped.append({**trigger, "skip_reason": "cooldown"})
                continue
        rule = rule_by_id(config, trigger["rule_id"]) or {}
        fills, reason = simulate_order(state, trigger, quotes, rule, config, now)
        if not fills:
            skipped.append({**trigger, "skip_reason": reason or "simulation_failed"})
            continue
        orders.extend(fills)
        cooldowns[trigger["pair_key"]] = now.isoformat()
        daily["trigger_count"] = int(daily.get("trigger_count", 0)) + 1
    return {
        "computed_at": now.isoformat(),
        "evaluations": evaluations,
        "triggers": [row for row in evaluations if row.get("triggered")],
        "orders": orders,
        "skipped": skipped,
        "cash": round_to(state.get("cash"), 2),
    }


def run_once(config: dict[str, Any], state: dict[str, Any]) -> dict[str, Any]:
    runtime = config["runtime"]
    quotes = fetch_fund_metrics(collect_codes(config), runtime["markets_api_base"], runtime["request_timeout_sec"])
    return run_tick(config, state, quotes, now_shanghai())


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run H/L ETF premium-spread simulation from a YAML config.")
    parser.add_argument("--config", required=True, help="Path to config/quant-premium.yaml")
    parser.add_argument("--once", action="store_true", help="Fetch once, evaluate once, then exit")
    parser.add_argument("--allow-off-session", action="store_true", help="Run even when outside A-share trading session")
    parser.add_argument("--output-dir", help="Override runtime.output_dir")
    parser.add_argument("--max-ticks", type=int, default=0, help="Stop after N loop ticks; useful for supervised runs")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    config = normalize_config(load_yaml_config(args.config))
    if args.output_dir:
        config["runtime"]["output_dir"] = args.output_dir
    runtime = config["runtime"]
    output_dir = Path(runtime["output_dir"])
    state_path = output_dir / "state.json"
    signals_path = output_dir / "signals.jsonl"
    orders_path = output_dir / "orders.jsonl"
    state = load_state(state_path, config)
    ticks = 0

    while True:
        current = now_shanghai()
        if runtime["only_trading_session"] and not args.allow_off_session and not is_trading_session(current):
            row = {"ts": current.isoformat(), "status": "waiting_session"}
            append_jsonl(signals_path, row)
            if args.once:
                print(json.dumps(row, ensure_ascii=False))
                return 0
            time.sleep(max(1.0, min(60.0, runtime["poll_interval_sec"])))
            continue

        try:
            result = run_once(config, state)
            append_jsonl(signals_path, {k: result[k] for k in ("computed_at", "evaluations", "triggers", "skipped", "cash")})
            for order in result["orders"]:
                append_jsonl(orders_path, order)
            save_state(state_path, state)
            print(json.dumps({
                "computed_at": result["computed_at"],
                "triggers": len(result["triggers"]),
                "orders": len(result["orders"]),
                "skipped": len(result["skipped"]),
                "cash": result["cash"],
            }, ensure_ascii=False))
        except Exception as exc:  # pragma: no cover - exercised manually against live markets.
            row = {"ts": current.isoformat(), "status": "error", "message": str(exc)}
            append_jsonl(signals_path, row)
            print(json.dumps(row, ensure_ascii=False), file=sys.stderr)
            if args.once:
                return 1

        ticks += 1
        if args.once or (args.max_ticks and ticks >= args.max_ticks):
            break
        time.sleep(runtime["poll_interval_sec"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
