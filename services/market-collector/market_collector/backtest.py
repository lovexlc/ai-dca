"""Collector-local premium-spread backtest engine.

The calculation mirrors the notify Worker backtest model while sourcing daily
price and NAV-aligned premium candles directly from MarketDataService.
"""
from __future__ import annotations

import math
import re
import statistics
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, time, timezone, timedelta
from typing import Any

DEFAULT_SELL_LOWER_GRID = (-1.0, -0.5, 0.0, 0.2, 0.5, 0.8, 1.0, 1.5)
DEFAULT_BUY_OTHER_GRID = (0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0)
MAX_CODES = 20
MAX_BARS = 3000
MIN_BARS = 10
CODE_PATTERN = re.compile(r"^\d{6}$")


class BacktestInputError(ValueError):
    """Raised when a backtest request cannot be executed safely."""


def _finite(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _round(value: Any, digits: int = 4) -> float | None:
    number = _finite(value)
    return round(number, digits) if number is not None else None


def _number_or(value: Any, fallback: float) -> float:
    number = _finite(value)
    return number if number is not None else fallback


def _codes(values: Any) -> list[str]:
    source = values if isinstance(values, list) else [values]
    output: list[str] = []
    for value in source:
        code = str(value or "").strip()
        if CODE_PATTERN.fullmatch(code) and code not in output:
            output.append(code)
        if len(output) >= MAX_CODES:
            break
    return output


def _iso_date(value: Any) -> str:
    raw = str(value or "")[:10]
    try:
        return date.fromisoformat(raw).isoformat()
    except ValueError:
        return ""


def _epoch_for_date(value: str) -> int:
    parsed = date.fromisoformat(value)
    return int(datetime.combine(parsed, time(15, 0), tzinfo=timezone(timedelta(hours=8))).timestamp())


def _normalize_candles(payload: dict[str, Any], start_date: str, end_date: str) -> list[dict[str, Any]]:
    by_date: dict[str, dict[str, Any]] = {}
    for raw in payload.get("candles") or []:
        candle_date = _iso_date(raw.get("date") or raw.get("day"))
        close = _finite(raw.get("c", raw.get("close", raw.get("price"))))
        if not candle_date or close is None or close <= 0:
            continue
        if start_date and candle_date < start_date:
            continue
        if end_date and candle_date > end_date:
            continue
        open_price = _finite(raw.get("o", raw.get("open"))) or close
        high_price = _finite(raw.get("h", raw.get("high"))) or close
        low_price = _finite(raw.get("l", raw.get("low"))) or close
        nav = _finite(raw.get("nav", raw.get("iopv")))
        premium = _finite(raw.get("premiumPercent", raw.get("premiumPct")))
        if premium is None and nav is not None and nav > 0:
            premium = ((close / nav) - 1) * 100
        timestamp = int(_finite(raw.get("t", raw.get("timestamp"))) or _epoch_for_date(candle_date))
        by_date[candle_date] = {
            "t": timestamp,
            "date": candle_date,
            "datetime": str(raw.get("datetime") or f"{candle_date} 15:00"),
            "o": open_price,
            "h": high_price,
            "l": low_price,
            "c": close,
            "open": open_price,
            "high": high_price,
            "low": low_price,
            "close": close,
            "nav": nav,
            "premiumPct": premium,
        }
    return [by_date[key] for key in sorted(by_date)]


def _requested_limit(start_date: str, end_date: str) -> int:
    start = date.fromisoformat(start_date)
    end = date.fromisoformat(end_date)
    return max(30, min(MAX_BARS, (end - start).days + 45))


def _load_market_data(data_service: Any, codes: list[str], start_date: str, end_date: str) -> tuple[dict[str, list[dict[str, Any]]], list[dict[str, str]]]:
    limit = _requested_limit(start_date, end_date)
    history: dict[str, list[dict[str, Any]]] = {}
    issues: list[dict[str, str]] = []
    with ThreadPoolExecutor(max_workers=min(6, len(codes))) as executor:
        futures = {
            executor.submit(data_service.kline, code, "1d", limit): code
            for code in codes
        }
        for future in as_completed(futures):
            code = futures[future]
            try:
                history[code] = _normalize_candles(future.result(), start_date, end_date)
            except Exception as exc:
                history[code] = []
                issues.append({"code": code, "error": str(exc)})
    return history, issues


def _average_premiums(history: dict[str, list[dict[str, Any]]], codes: list[str]) -> dict[str, float]:
    result: dict[str, float] = {}
    for code in codes:
        values = [
            float(item["premiumPct"])
            for item in history.get(code, [])
            if _finite(item.get("premiumPct")) is not None
        ]
        result[code] = round(statistics.fmean(values), 4) if values else 0.0
    return result


def _classify(history: dict[str, list[dict[str, Any]]], codes: list[str]) -> tuple[list[str], list[str], dict[str, float]]:
    averages = _average_premiums(history, codes)
    ordered = sorted(codes, key=lambda code: averages.get(code, 0), reverse=True)
    midpoint = math.ceil(len(ordered) / 2)
    return ordered[:midpoint], ordered[midpoint:], averages


def _trade_fee(amount: float, fee_rate: float, min_fee: float) -> float:
    return max(min_fee, amount * fee_rate) if amount > 0 else 0.0


def _buy_all(cash: float, code: str, price: float, fee_rate: float, min_fee: float, lot_size: int, *, ceil_lot: bool) -> tuple[float, dict[str, Any] | None, dict[str, float] | None]:
    if cash <= 0 or price <= 0:
        return cash, None, None
    raw_lots = cash / price / lot_size
    lots = math.ceil(raw_lots) if ceil_lot else math.floor(raw_lots)
    shares = max(0, lots * lot_size)
    if not ceil_lot:
        while shares > 0:
            amount = shares * price
            fee = _trade_fee(amount, fee_rate, min_fee)
            if amount + fee <= cash + 1e-8:
                break
            shares -= lot_size
    if shares <= 0:
        return cash, None, None
    amount = shares * price
    fee = _trade_fee(amount, fee_rate, min_fee)
    total_cost = amount + fee
    trade = {
        "type": "buy", "code": code, "price": round(price, 6),
        "shares": shares, "amount": round(amount, 2), "fee": round(fee, 2),
        "totalCost": round(total_cost, 2), "profit": 0,
    }
    return cash - total_cost, trade, {"shares": shares, "cost": total_cost}


def _sell_all(cash: float, code: str, price: float, position: dict[str, float], fee_rate: float, min_fee: float) -> tuple[float, dict[str, Any]]:
    shares = position["shares"]
    amount = shares * price
    fee = _trade_fee(amount, fee_rate, min_fee)
    net = amount - fee
    profit = net - position["cost"]
    return cash + net, {
        "type": "sell", "code": code, "price": round(price, 6),
        "shares": shares, "amount": round(amount, 2), "fee": round(fee, 2),
        "netProceeds": round(net, 2), "profit": round(profit, 2),
    }


def _run_hold(code: str, candles: list[dict[str, Any]], initial_cash: float, fee_rate: float, min_fee: float, lot_size: int) -> dict[str, Any] | None:
    if len(candles) < MIN_BARS:
        return None
    first = candles[0]
    cash, buy, position = _buy_all(initial_cash, code, first["close"], fee_rate, min_fee, lot_size, ceil_lot=False)
    if position is None:
        return None
    buy.update({"ts": first["t"], "date": first["date"], "datetime": first["datetime"]})
    peak = initial_cash
    max_drawdown = 0.0
    equity_curve: list[dict[str, Any]] = []
    for candle in candles:
        equity = cash + position["shares"] * candle["close"]
        peak = max(peak, equity)
        drawdown = ((equity - peak) / peak) * 100 if peak > 0 else 0.0
        max_drawdown = min(max_drawdown, drawdown)
        equity_curve.append({
            "t": candle["t"], "date": candle["date"],
            "equity": round(equity, 2), "drawdown": round(drawdown, 4),
        })
    final_value = equity_curve[-1]["equity"]
    return {
        "code": code,
        "finalValue": final_value,
        "totalReturnPct": round(((final_value - initial_cash) / initial_cash) * 100, 4),
        "maxDrawdownPct": round(max_drawdown, 2),
        "tradeCount": 1,
        "trades": [buy],
        "equityCurve": equity_curve,
    }


def _chart_candles(candles: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [{
        "t": item["t"], "date": item["date"], "datetime": item["datetime"],
        "o": round(item["open"], 4), "h": round(item["high"], 4),
        "l": round(item["low"], 4), "c": round(item["close"], 4),
        "open": round(item["open"], 4), "high": round(item["high"], 4),
        "low": round(item["low"], 4), "close": round(item["close"], 4),
    } for item in candles[-500:]]


def _run_rotation(
    history: dict[str, list[dict[str, Any]]],
    high_codes: list[str],
    low_codes: list[str],
    *,
    initial_side: str,
    lower_pct: float,
    upper_pct: float,
    initial_cash: float,
    fee_rate: float,
    min_fee: float,
    lot_size: int,
    averages: dict[str, float],
    data_issues: list[dict[str, str]],
) -> dict[str, Any]:
    codes = list(dict.fromkeys([*high_codes, *low_codes]))
    by_code_date = {code: {item["date"]: item for item in history.get(code, [])} for code in codes}
    anchor_code = max(codes, key=lambda code: len(history.get(code, [])), default="")
    anchors = history.get(anchor_code, [])
    premium_class = {**{code: "H" for code in high_codes}, **{code: "L" for code in low_codes}}
    cash = initial_cash
    position: dict[str, float] | None = None
    current_code = ""
    entry_gap: float | None = None
    peak = initial_cash
    max_drawdown = 0.0
    trades: list[dict[str, Any]] = []
    signals: list[dict[str, Any]] = []
    rows: list[dict[str, Any]] = []
    complete_price_rows = 0
    complete_premium_rows = 0

    for anchor in anchors:
        current = {
            code: by_code_date[code].get(anchor["date"])
            for code in codes
        }
        prices = {
            code: item["close"]
            for code, item in current.items()
            if item is not None and _finite(item.get("close")) is not None
        }
        premiums = {
            code: item["premiumPct"]
            for code, item in current.items()
            if item is not None and _finite(item.get("premiumPct")) is not None
        }
        if len(prices) == len(codes):
            complete_price_rows += 1
        if len(premiums) == len(codes):
            complete_premium_rows += 1
        if not prices:
            continue

        equity = cash + (position["shares"] * prices.get(current_code, 0) if position else 0)
        peak = max(peak, equity)
        drawdown = ((equity - peak) / peak) * 100 if peak > 0 else 0.0
        max_drawdown = min(max_drawdown, drawdown)

        high_list = [{"code": code, "premiumPct": premiums[code]} for code in high_codes if code in premiums]
        low_list = [{"code": code, "premiumPct": premiums[code]} for code in low_codes if code in premiums]
        can_trade = bool(high_list and low_list)

        if can_trade and (not current_code or current_code not in premiums):
            candidates = low_list if initial_side == "L" else high_list
            initial = (
                min(candidates, key=lambda item: item["premiumPct"])
                if initial_side == "L"
                else max(candidates, key=lambda item: item["premiumPct"])
            )
            current_code = initial["code"]
            cash, trade, position = _buy_all(
                cash, current_code, prices[current_code], fee_rate, min_fee, lot_size, ceil_lot=True
            )
            if trade:
                trade.update({"ts": anchor["t"], "date": anchor["date"], "datetime": anchor["datetime"]})
                trades.append(trade)

        current_class = premium_class.get(current_code, "")
        from_premium = premiums.get(current_code)
        target = None
        rule = "none"
        gap_pct = None
        threshold = None
        if position and from_premium is not None and current_class == "H" and low_list:
            candidate = max(low_list, key=lambda item: from_premium - item["premiumPct"])
            gap_pct = round(from_premium - candidate["premiumPct"], 4)
            target, rule, threshold = candidate, "B", upper_pct
        elif position and from_premium is not None and current_class == "L" and high_list:
            candidate = min(high_list, key=lambda item: item["premiumPct"] - from_premium)
            gap_pct = round(candidate["premiumPct"] - from_premium, 4)
            target, rule, threshold = candidate, "A", lower_pct

        triggered = bool(
            can_trade and target and gap_pct is not None
            and ((rule == "B" and gap_pct >= upper_pct) or (rule == "A" and gap_pct <= lower_pct))
            and target["code"] in prices
        )
        from_code = current_code
        if triggered and position:
            cash, sell = _sell_all(cash, from_code, prices[from_code], position, fee_rate, min_fee)
            sell.update({"ts": anchor["t"], "date": anchor["date"], "datetime": anchor["datetime"]})
            trades.append(sell)
            cash, buy, position = _buy_all(
                cash, target["code"], prices[target["code"]], fee_rate, min_fee, lot_size, ceil_lot=True
            )
            if buy:
                buy.update({"ts": anchor["t"], "date": anchor["date"], "datetime": anchor["datetime"]})
                trades.append(buy)
                current_code = target["code"]
            else:
                current_code = ""
                position = None
            signal = {
                "ts": anchor["t"], "date": anchor["date"], "datetime": anchor["datetime"],
                "fromCode": from_code, "toCode": target["code"],
                "fromClass": current_class, "toClass": premium_class.get(target["code"], ""),
                "rule": rule, "threshold": threshold, "gapPct": gap_pct,
                "targetReason": "max_gap" if rule == "B" else "min_gap",
                "entryGapPct": entry_gap, "profit": sell["profit"],
            }
            signals.append(signal)
            entry_gap = gap_pct if rule == "B" else None

        equity = cash + (position["shares"] * prices.get(current_code, 0) if position else 0)
        row = {
            "ts": anchor["t"], "date": anchor["date"], "datetime": anchor["datetime"],
            "fromCode": from_code, "toCode": target["code"] if target else from_code,
            "currentCode": current_code, "currentClass": premium_class.get(current_code, ""),
            "fromClass": current_class, "toClass": premium_class.get(target["code"], "") if target else current_class,
            "highPremiumPct": (
                from_premium if current_class == "H"
                else target.get("premiumPct") if target else None
            ),
            "lowPremiumPct": (
                target.get("premiumPct") if target and current_class == "H"
                else from_premium
            ),
            "gapPct": gap_pct, "rule": rule, "threshold": threshold,
            "targetReason": "max_gap" if rule == "B" else "min_gap" if rule == "A" else "",
            "signal": "switch" if triggered else "wait",
            "profit": signals[-1]["profit"] if triggered else 0,
            "equity": round(equity, 2), "cash": round(cash, 2),
            "positions": ({current_code: {"shares": position["shares"], "cost": round(position["cost"], 2)}} if position and current_code else {}),
        }
        rows.append(row)

    final_prices = {
        code: history[code][-1]["close"]
        for code in codes if history.get(code)
    }
    final_equity = cash + (position["shares"] * final_prices.get(current_code, 0) if position else 0)
    sample_count = len(rows)
    denominator = max(1, len(anchors))
    price_coverage = round(complete_price_rows / denominator * 100, 2)
    nav_coverage = round(complete_premium_rows / denominator * 100, 2)
    data_coverage = round(min(price_coverage, nav_coverage), 2)
    passed = sample_count >= MIN_BARS and price_coverage >= 60 and nav_coverage >= 60
    total_profit = round(final_equity - initial_cash, 2)
    total_return = round(total_profit / initial_cash * 100, 4)

    returns = []
    for previous, current_row in zip(rows, rows[1:]):
        previous_equity = _finite(previous.get("equity"))
        current_equity = _finite(current_row.get("equity"))
        if previous_equity and current_equity is not None:
            returns.append((current_equity - previous_equity) / previous_equity)
    sharpe = 0.0
    if len(returns) > 1:
        deviation = statistics.pstdev(returns)
        if deviation > 0:
            sharpe = round(statistics.fmean(returns) / deviation * math.sqrt(252), 2)
    sell_trades = [trade for trade in trades if trade["type"] == "sell"]
    win_rate = round(sum(trade.get("profit", 0) > 0 for trade in sell_trades) / len(sell_trades) * 100, 2) if sell_trades else 0.0

    markers = []
    for signal in signals[-120:]:
        bar = by_code_date.get(anchor_code, {}).get(signal["date"])
        if not bar:
            continue
        is_sell = signal["fromCode"] == anchor_code
        is_buy = signal["toCode"] == anchor_code
        side = "sell" if is_sell else "buy" if is_buy else "signal"
        markers.append({
            **signal,
            "side": side,
            "price": round(bar["high"] if is_sell else bar["low"] if is_buy else bar["close"], 4),
            "label": f"卖 {signal['fromCode']} → 买 {signal['toCode']}",
        })

    missing_codes = [code for code in codes if not history.get(code)]
    quality_reason = (
        "数据覆盖率满足回测门槛" if passed
        else f"缺少 {'、'.join(missing_codes)} 的 1d 历史 K 线" if missing_codes
        else "样本或 NAV/价格覆盖率不足"
    )
    result = {
        "ok": True, "status": "passed" if passed else "failed", "timeframe": "1d",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "effectiveHighCodes": high_codes, "effectiveLowCodes": low_codes,
        "avgPremiumByCode": averages,
        "summary": {
            "trades": len(signals), "signalCount": len(signals), "tradeCount": len(trades),
            "switchCount": len(signals), "totalProfit": total_profit,
            "totalReturnPct": total_return, "winRatePct": win_rate,
            "maxDrawdownPct": round(max_drawdown, 2), "sharpeRatio": sharpe,
            "finalEquity": round(final_equity, 2), "sampleCount": sample_count,
            "priceCoveragePct": price_coverage, "navCoveragePct": nav_coverage,
            "dataCoveragePct": data_coverage, "passed": passed,
            "from": rows[0]["date"] if rows else "", "to": rows[-1]["date"] if rows else "",
            "highCode": high_codes[0] if high_codes else "",
            "lowCode": low_codes[0] if low_codes else "",
        },
        "rows": rows[-500:], "signals": signals[-120:], "trades": trades,
        "chart": {
            "code": anchor_code, "timeframe": "1d", "candles": _chart_candles(anchors),
            "markers": markers, "highCode": high_codes[0] if high_codes else "",
            "lowCode": low_codes[0] if low_codes else "",
            "highCandles": _chart_candles(history.get(high_codes[0], [])) if high_codes else [],
            "lowCandles": _chart_candles(history.get(low_codes[0], [])) if low_codes else [],
        },
        "quality": {
            "passed": passed, "reason": quality_reason, "anchorCode": anchor_code,
            "anchorBars": len(anchors), "missingKlineCodes": missing_codes,
            "klineIssues": data_issues, "supportedTimeframes": ["1d"],
        },
        "strategy": {
            "highCodes": high_codes, "lowCodes": low_codes,
            "intraSellLowerPct": lower_pct, "intraBuyOtherPct": upper_pct,
            "initialSide": initial_side, "autoClassified": True,
        },
    }
    return result


def _rotation_view(result: dict[str, Any], lower: float, upper: float, initial_side: str) -> dict[str, Any] | None:
    if result.get("status") != "passed":
        return None
    summary = result["summary"]
    return {
        "finalValue": summary["finalEquity"],
        "totalReturnPct": summary["totalReturnPct"],
        "maxDrawdownPct": summary["maxDrawdownPct"],
        "tradeCount": summary["tradeCount"],
        "rotationCount": summary["switchCount"],
        "trades": result["trades"],
        "equityCurve": [row["equity"] for row in result["rows"]],
        "rows": result["rows"],
        "signals": result["signals"],
        "chart": result["chart"],
        "summary": summary,
        "thresholds": {"sellLowerThreshold": lower, "buyOtherThreshold": upper},
        "initialSide": initial_side,
        "effectiveHighCodes": result["effectiveHighCodes"],
        "effectiveLowCodes": result["effectiveLowCodes"],
        "autoClassified": True,
    }


def run_collector_backtest(data_service: Any, request: dict[str, Any]) -> dict[str, Any]:
    high_codes = _codes(request.get("highCodes"))
    low_codes = [code for code in _codes(request.get("lowCodes")) if code not in high_codes]
    symbol = str(request.get("symbol") or "").strip()
    codes = _codes([symbol, *high_codes, *low_codes])
    if not codes:
        raise BacktestInputError("至少需要一个 6 位基金代码")
    if len(codes) > MAX_CODES:
        raise BacktestInputError(f"单次回测最多支持 {MAX_CODES} 只基金")

    end_date = _iso_date(request.get("endDate")) or date.today().isoformat()
    start_date = _iso_date(request.get("startDate")) or (date.fromisoformat(end_date) - timedelta(days=365)).isoformat()
    if start_date > end_date:
        raise BacktestInputError("回测开始日期不能晚于结束日期")

    initial_cash = max(1.0, _number_or(request.get("initialCash"), 10000.0))
    costs = request.get("tradingCosts") if isinstance(request.get("tradingCosts"), dict) else {}
    fee_rate = max(0.0, _number_or(costs.get("feeRate"), 0.00005))
    min_fee = max(0.0, _number_or(costs.get("minFee"), 0.0))
    lot_size = max(1, int(_number_or(costs.get("lotSize"), 100)))

    history, issues = _load_market_data(data_service, codes, start_date, end_date)
    usable_codes = [code for code in codes if len(history.get(code, [])) >= MIN_BARS]
    if not usable_codes:
        details = "；".join(f"{item['code']}: {item['error']}" for item in issues)
        raise BacktestInputError(f"未获取到有效的历史行情{('；' + details) if details else ''}")

    holds = [
        item for code in codes
        if (item := _run_hold(code, history.get(code, []), initial_cash, fee_rate, min_fee, lot_size))
    ]
    has_pair = bool(high_codes and low_codes)
    rotation = None
    attempts: list[dict[str, Any]] = []
    if has_pair:
        pair_codes = list(dict.fromkeys([*high_codes, *low_codes]))
        missing = [code for code in pair_codes if len(history.get(code, [])) < MIN_BARS]
        if missing:
            raise BacktestInputError(f"缺少 {'、'.join(missing)} 的有效历史行情")
        effective_high, effective_low, averages = _classify(history, pair_codes)
        if not effective_high or not effective_low:
            raise BacktestInputError("H/L 标的不足，无法执行轮动回测")

        manual = str(request.get("mode") or "").lower() == "manual"
        lower_values = [_number_or(request.get("lowerPct"), -0.5)] if manual else list(DEFAULT_SELL_LOWER_GRID)
        upper_values = [_number_or(request.get("upperPct"), 0.5)] if manual else list(DEFAULT_BUY_OTHER_GRID)
        best_result = None
        best_meta = None
        for initial_side in ("L", "H"):
            for lower in lower_values:
                for upper in upper_values:
                    if upper - lower < 0.1:
                        continue
                    result = _run_rotation(
                        history, effective_high, effective_low,
                        initial_side=initial_side, lower_pct=float(lower), upper_pct=float(upper),
                        initial_cash=initial_cash, fee_rate=fee_rate, min_fee=min_fee,
                        lot_size=lot_size, averages=averages, data_issues=issues,
                    )
                    view = _rotation_view(result, float(lower), float(upper), initial_side)
                    if view is None:
                        continue
                    attempts.append({
                        "totalReturnPct": view["totalReturnPct"],
                        "maxDrawdownPct": view["maxDrawdownPct"],
                        "rotationCount": view["rotationCount"],
                        "initialSide": initial_side,
                        "thresholds": view["thresholds"],
                    })
                    if (
                        best_result is None
                        or view["totalReturnPct"] > best_meta["totalReturnPct"]
                        or (
                            view["totalReturnPct"] == best_meta["totalReturnPct"]
                            and abs(view["maxDrawdownPct"]) < abs(best_meta["maxDrawdownPct"])
                        )
                    ):
                        best_result, best_meta = view, view
        rotation = best_result

    hold = next((item for item in holds if item["code"] == symbol), None) or (holds[0] if holds else None)
    result_payload = {
        "rotation": rotation,
        "hold": hold,
        "holds": holds,
        "optimizationSummary": {
            "best": ({
                "totalReturnPct": rotation["totalReturnPct"],
                "maxDrawdownPct": rotation["maxDrawdownPct"],
                "rotationCount": rotation["rotationCount"],
                "initialSide": rotation["initialSide"],
                "thresholds": rotation["thresholds"],
            } if rotation else None),
            "attempts": attempts,
        },
        "config": {
            "highCodes": rotation["effectiveHighCodes"] if rotation else high_codes,
            "lowCodes": rotation["effectiveLowCodes"] if rotation else low_codes,
            "sellLowerThreshold": rotation["thresholds"]["sellLowerThreshold"] if rotation else _finite(request.get("lowerPct")),
            "buyOtherThreshold": rotation["thresholds"]["buyOtherThreshold"] if rotation else _finite(request.get("upperPct")),
            "initialCash": initial_cash,
            "investMode": "lump-sum",
            "dateRange": {"startDate": start_date, "endDate": end_date},
        },
    }
    return {
        "ok": True,
        "source": "market-collector-local",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "result": result_payload,
        "data": {
            "codes": codes,
            "barsByCode": {code: len(history.get(code, [])) for code in codes},
            "issues": issues,
        },
    }
