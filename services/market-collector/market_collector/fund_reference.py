from __future__ import annotations

import html
import json
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Any, Callable
from urllib.parse import quote
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

SHANGHAI = ZoneInfo("Asia/Shanghai")
DEFAULT_WORKER_URL = ""
LIMIT_SCHEMA_VERSION = 2

JsonRequest = Callable[[str, str, dict[str, Any] | None, float], dict[str, Any]]


def normalize_fund_code(value: Any) -> str:
    text = str(value or "").strip()
    digits = "".join(ch for ch in text if ch.isdigit())
    return digits[-6:] if len(digits) >= 6 else ""


def _fetch_bytes(url: str, timeout_sec: float, *, referer: str) -> bytes:
    request = Request(url, headers={
        "accept": "application/json,text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
        "referer": referer,
        "user-agent": "Mozilla/5.0 market-collector-fund-reference/2",
    })
    with urlopen(request, timeout=timeout_sec) as response:
        return response.read()


def _strip_tags(value: str) -> str:
    text = re.sub(r"<script\b[\s\S]*?</script>", " ", value or "", flags=re.I)
    text = re.sub(r"<style\b[\s\S]*?</style>", " ", text, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", html.unescape(text)).strip()


def _positive_number(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number == number and number not in (float("inf"), float("-inf")) and number > 0 else None


def _money(value: Any) -> float | None:
    text = str(value or "").replace(",", "").replace("，", "").strip()
    match = re.search(r"(-?\d+(?:\.\d+)?)\s*([万亿]?)", text)
    if not match:
        return None
    number = float(match.group(1))
    if match.group(2) == "万":
        number *= 10_000
    elif match.group(2) == "亿":
        number *= 100_000_000
    return number if number >= 0 else None


def _percent(value: Any) -> float | None:
    text = str(value or "").strip()
    match = re.search(r"(-?\d+(?:\.\d+)?)\s*[%％]", text)
    return float(match.group(1)) if match else None


def _walk_rows(value: Any) -> list[list[str]]:
    rows: list[list[str]] = []
    if isinstance(value, dict):
        if "name" in value or "value" in value:
            rows.append([str(value.get("name") or ""), str(value.get("value") or "")])
        for child in value.values():
            rows.extend(_walk_rows(child))
    elif isinstance(value, list):
        if value and all(not isinstance(item, (dict, list)) for item in value):
            rows.append([str(item or "") for item in value])
        else:
            for child in value:
                rows.extend(_walk_rows(child))
    return rows


def _rate_from_rows(rows: list[list[str]], labels: tuple[str, ...]) -> float | None:
    for row in rows:
        text = " ".join(row)
        if any(label in text for label in labels):
            rate = _percent(text)
            if rate is not None:
                return rate
    return None


def _parse_tables(raw_html: str) -> list[list[list[str]]]:
    tables: list[list[list[str]]] = []
    for table_html in re.findall(r"<table\b[\s\S]*?</table>", raw_html, flags=re.I):
        rows: list[list[str]] = []
        for tr in re.findall(r"<tr\b[\s\S]*?</tr>", table_html, flags=re.I):
            cells = [_strip_tags(cell) for cell in re.findall(r"<t[dh][^>]*>([\s\S]*?)</t[dh]>", tr, flags=re.I)]
            cells = [cell for cell in cells if cell]
            if cells:
                rows.append(cells)
        if rows:
            tables.append(rows)
    return tables


def _build_fee(code: str, source: str, *, purchase_rules: list[Any] | None = None,
               redeem_rules: list[Any] | None = None, operation_fees: list[Any] | None = None,
               management: float | None = None, custody: float | None = None,
               sales: float | None = None) -> dict[str, Any]:
    parts = [value for value in (management, custody, sales) if value is not None]
    return {
        "code": code,
        "fundType": "exchange" if code.startswith(("5", "15", "16")) else "otc",
        "source": source,
        "managementFeeRate": management,
        "custodyFeeRate": custody,
        "salesServiceFeeRate": sales,
        "annualFeeRate": round(sum(parts), 6) if parts else None,
        "purchaseRules": purchase_rules or [],
        "redeemRules": redeem_rules or [],
        "operationFees": operation_fees or [],
        "fetchedAt": datetime.now(SHANGHAI).replace(microsecond=0).isoformat(),
    }


def fetch_fund_fee(code: str, timeout_sec: float = 25.0) -> dict[str, Any]:
    normalized = normalize_fund_code(code)
    if not normalized:
        raise ValueError("invalid fund code")
    danjuan_error: Exception | None = None
    try:
        url = f"https://danjuanfunds.com/djapi/fund/detail/{quote(normalized)}"
        payload = json.loads(_fetch_bytes(url, timeout_sec, referer="https://danjuanfunds.com/").decode("utf-8", "replace"))
        rates = ((payload.get("data") or {}).get("fund_rates")) or {}
        if rates:
            operation = _walk_rows(rates.get("other_rate_table"))
            result = _build_fee(
                normalized, "danjuan",
                purchase_rules=_walk_rows(rates.get("declare_rate_table")),
                redeem_rules=_walk_rows(rates.get("withdraw_rate_table")),
                operation_fees=operation,
                management=_rate_from_rows(operation, ("管理费", "基金管理费")),
                custody=_rate_from_rows(operation, ("托管费", "基金托管费")),
                sales=_rate_from_rows(operation, ("销售服务费",)),
            )
            if result["annualFeeRate"] is not None or result["redeemRules"]:
                return result
    except Exception as exc:
        danjuan_error = exc

    url = f"https://fundf10.eastmoney.com/jjfl_{quote(normalized)}.html"
    raw = _fetch_bytes(url, timeout_sec, referer="https://fundf10.eastmoney.com/").decode("utf-8", "replace")
    tables = _parse_tables(raw)
    operation_rows = next((rows for rows in tables if re.search(r"管理费|托管费|销售服务费", " ".join(sum(rows, [])))), [])
    purchase_rows = next((rows for rows in tables if re.search(r"申购费率|申购金额|购买金额", " ".join(sum(rows, [])))), [])
    redeem_rows = next((rows for rows in tables if re.search(r"赎回费率|持有期限|赎回", " ".join(sum(rows, [])))), [])
    result = _build_fee(
        normalized, "eastmoney_f10",
        purchase_rules=purchase_rows,
        redeem_rules=redeem_rows,
        operation_fees=operation_rows,
        management=_rate_from_rows(operation_rows, ("管理费", "基金管理费")),
        custody=_rate_from_rows(operation_rows, ("托管费", "基金托管费")),
        sales=_rate_from_rows(operation_rows, ("销售服务费",)),
    )
    if result["annualFeeRate"] is None and not result["redeemRules"] and danjuan_error:
        raise danjuan_error
    return result


def _classify_buy_status(text: str) -> str | None:
    value = str(text or "")
    if re.search(r"暂停(申购|购买)|暂停交易", value):
        return "suspended"
    if re.search(r"限制大额|暂停大额|限额|单日累计.*上限", value):
        return "limit_large"
    if re.search(r"开放申购|正常申购|恢复.*申购|可申购", value):
        return "open"
    return None


def fetch_fund_limit(code: str, timeout_sec: float = 25.0) -> dict[str, Any]:
    normalized = normalize_fund_code(code)
    if not normalized:
        raise ValueError("invalid fund code")
    f10_url = f"https://fundf10.eastmoney.com/jjfl_{quote(normalized)}.html"
    detail_url = f"https://fund.eastmoney.com/{quote(normalized)}.html"
    f10_raw = _fetch_bytes(f10_url, timeout_sec, referer="https://fundf10.eastmoney.com/").decode("utf-8", "replace")
    detail_raw = _fetch_bytes(detail_url, timeout_sec, referer="https://fund.eastmoney.com/").decode("utf-8", "replace")
    f10_text = _strip_tags(f10_raw)
    detail_text = _strip_tags(detail_raw)

    def table_value(label: str) -> str | None:
        escaped = re.escape(label)
        match = re.search(rf"<td[^>]*\bth\b[^>]*>\s*{escaped}\s*</td>\s*<td[^>]*>([\s\S]*?)</td>", f10_raw, flags=re.I)
        return _strip_tags(match.group(1)) if match else None

    min_purchase = _money(table_value("申购起点") or table_value("首次购买") or table_value("单笔最低申购金额"))
    max_purchase = _money(table_value("日累计申购限额") or table_value("单日累计申购上限金额") or table_value("单笔最高申购金额"))
    bracket = re.search(r"单日累计(?:购买|申购)上限\s*([\d.,]+\s*[万亿]?\s*元?)", detail_text)
    if bracket:
        max_purchase = _money(bracket.group(1))
    status_text = ""
    status_match = re.search(r"交易状态[：:]?\s*([^\s（(，。；,;]+)", detail_text)
    if status_match:
        status_text = status_match.group(1)
    status = _classify_buy_status(status_text + " " + detail_text)
    if max_purchase is not None and status in (None, "open"):
        status = "limit_large"
    result = {
        "code": normalized,
        "buyStatus": status,
        "buyStatusText": status_text or None,
        "minPurchase": min_purchase,
        "maxPurchasePerDay": max_purchase,
        "channelLimits": {"all": max_purchase} if max_purchase is not None else {},
        "limitChannel": None,
        "limitChannelText": None,
        "limitSchemaVersion": LIMIT_SCHEMA_VERSION,
        "currency": "CNY",
        "source": "eastmoney_f10+detail",
        "fetchedAt": datetime.now(SHANGHAI).replace(microsecond=0).isoformat(),
    }
    return normalize_limit_payload(result)


def normalize_limit_payload(payload: dict[str, Any]) -> dict[str, Any]:
    data = dict(payload or {})
    raw_limits = data.get("channelLimits")
    limits: dict[str, float] = {}
    if isinstance(raw_limits, dict):
        for key in ("direct", "distributor", "all"):
            value = _positive_number(raw_limits.get(key))
            if value is not None:
                limits[key] = value
    if not limits:
        amount = _positive_number(data.get("maxPurchasePerDay"))
        if amount is not None:
            limits["all"] = amount
    if limits:
        data["channelLimits"] = limits
        primary = limits.get("direct") or limits.get("all") or limits.get("distributor")
        if primary is not None:
            data["maxPurchasePerDay"] = primary
        if limits.get("direct") is not None:
            data["limitChannel"] = "app"
        elif limits.get("distributor") is not None:
            data["limitChannel"] = "channel"
    data["limitSchemaVersion"] = LIMIT_SCHEMA_VERSION
    return data


def request_json(method: str, url: str, payload: dict[str, Any] | None, timeout_sec: float) -> dict[str, Any]:
    raise RuntimeError("Cloudflare market proxy disabled; collector uses direct public market sources")


def _snapshot_record(data_kind: str, code: str, payload: dict[str, Any], fetched_at: str, snapshot_date: str) -> dict[str, Any]:
    normalized_payload = dict(payload)
    normalized_payload["code"] = code
    # Keep the historical storage discriminator for backward compatibility. It is metadata only;
    # the network fetch above is collector-local and never calls api.freebacktrack.tech.
    return {
        "data_kind": data_kind,
        "symbol": code,
        "snapshot_date": snapshot_date,
        "fetched_at": fetched_at,
        "source": "worker:" + data_kind.replace("_", "-"),
        "payload": normalized_payload,
    }


def fetch_fund_references(
    symbols: list[str], *, worker_url: str = DEFAULT_WORKER_URL, timeout_sec: float = 25.0,
    concurrency: int = 4, client: JsonRequest = request_json, now: datetime | None = None,
    fee_symbols: list[str] | None = None, limit_symbols: list[str] | None = None,
) -> dict[str, Any]:
    del worker_url, client
    current = (now or datetime.now(timezone.utc)).astimezone(SHANGHAI)
    fetched_at = current.replace(microsecond=0).isoformat()
    snapshot_date = current.date().isoformat()
    fee_codes = list(dict.fromkeys(code for code in (normalize_fund_code(v) for v in (fee_symbols or symbols)) if code))
    limit_codes = list(dict.fromkeys(code for code in (normalize_fund_code(v) for v in (limit_symbols or symbols)) if code))
    records: list[dict[str, Any]] = []
    errors: list[str] = []

    def run(kind: str, code: str) -> tuple[str, str, dict[str, Any] | None, str | None]:
        try:
            payload = fetch_fund_fee(code, timeout_sec) if kind == "fund_fee" else fetch_fund_limit(code, timeout_sec)
            return kind, code, payload, None
        except Exception as exc:
            return kind, code, None, str(exc)

    jobs = [("fund_fee", code) for code in fee_codes] + [("fund_limit", code) for code in limit_codes]
    worker_count = max(1, min(int(concurrency or 4), 8, len(jobs) or 1))
    with ThreadPoolExecutor(max_workers=worker_count) as executor:
        futures = {executor.submit(run, kind, code): (kind, code) for kind, code in jobs}
        for future in as_completed(futures):
            kind, code, payload, error = future.result()
            if payload is None:
                errors.append(f"{kind}:{code}: {error or 'no data'}")
            else:
                records.append(_snapshot_record(kind, code, payload, fetched_at, snapshot_date))

    fee_success = sum(1 for row in records if row["data_kind"] == "fund_fee")
    limit_success = sum(1 for row in records if row["data_kind"] == "fund_limit")
    return {
        "kind": "market-collector-fund-reference-sync",
        "generated_at": fetched_at,
        "snapshot_date": snapshot_date,
        "requested_symbols": len(set(fee_codes + limit_codes)),
        "fee_success_count": fee_success,
        "fee_failure_count": len(fee_codes) - fee_success,
        "limit_success_count": limit_success,
        "limit_failure_count": len(limit_codes) - limit_success,
        "records": records,
        "errors": errors,
        "source": "market-collector-public-sources",
    }


def fetch_fund_limit_overview(worker_url: str = DEFAULT_WORKER_URL, timeout_sec: float = 25.0,
                              client: JsonRequest = request_json) -> dict[str, Any]:
    del worker_url, timeout_sec, client
    raise RuntimeError("fund limit overview is built from collector-owned snapshots")
