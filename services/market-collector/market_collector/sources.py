from __future__ import annotations

import codecs
import json
import math
import re
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Any, Callable
from zoneinfo import ZoneInfo

TENCENT_QUOTE_URL = "https://qt.gtimg.cn/"
EASTMONEY_LIST_URL = "https://push2delay.eastmoney.com/api/qt/clist/get"
EASTMONEY_ULIST_URL = "https://push2delay.eastmoney.com/api/qt/ulist.np/get"
EASTMONEY_PUSH_TOKEN = "bd1d9ddb04089700cf9c27f6f7426281"
EASTMONEY_FS = "b:MK0021,b:MK0022,b:MK0023,b:MK0024,b:MK0827"
EASTMONEY_FIELDS = "f12,f14,f2,f3,f124,f402,f441"
SHANGHAI = ZoneInfo("Asia/Shanghai")

QuoteFetcher = Callable[[str, float], bytes]


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def isoformat_z(value: datetime) -> str:
    return value.astimezone(SHANGHAI).replace(microsecond=0).isoformat()


def to_float(value: Any) -> float | None:
    if value in (None, "", "-"):
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def to_positive_float(value: Any) -> float | None:
    result = to_float(value)
    return result if result is not None and result > 0 else None


def round4(value: float | None) -> float | None:
    return round(value, 4) if value is not None and math.isfinite(value) else None


def normalize_symbol(value: Any) -> str:
    raw = str(value or "").strip()
    if raw.lower().startswith(("sh", "sz", "bj")):
        raw = raw[2:]
    return raw if raw.isdigit() and len(raw) == 6 else ""


def tencent_symbol(symbol: str) -> str:
    code = normalize_symbol(symbol)
    prefix = "sh" if code.startswith(("5", "6")) else "sz"
    return prefix + code


def eastmoney_secid(symbol: str) -> str:
    # 东方财富 secid：沪市（5/6 开头）= 1.code，深市（0/1/3 开头，含 LOF）= 0.code
    code = normalize_symbol(symbol)
    market = "1" if code.startswith(("5", "6")) else "0"
    return f"{market}.{code}"


def default_fetch_bytes(url: str, timeout_sec: float) -> bytes:
    request = urllib.request.Request(
        url,
        headers={
            "user-agent": "Mozilla/5.0",
            "referer": "https://quote.eastmoney.com/",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout_sec) as response:
        return response.read()


def decode_tencent_payload(raw: bytes) -> str:
    try:
        return codecs.decode(raw, "gbk")
    except Exception:
        return raw.decode("utf-8", "replace")


def parse_tencent_quote_text(text: str, captured_at: str) -> dict[str, dict[str, Any]]:
    rows: dict[str, dict[str, Any]] = {}
    pattern = re.compile(r'v_([^=]+)="([^"]*)";?')
    for key, payload in pattern.findall(text or ""):
        fields = str(payload).split("~")
        if len(fields) < 6:
            continue
        code = normalize_symbol(fields[2] or key)
        price = to_positive_float(fields[3])
        previous_close = to_positive_float(fields[4])
        change = to_float(fields[31]) if len(fields) > 31 else None
        change_percent = to_float(fields[32]) if len(fields) > 32 else None
        open_price = to_positive_float(fields[5]) if len(fields) > 5 else None
        volume = to_float(fields[6]) if len(fields) > 6 else None
        turnover = None
        if len(fields) > 35:
            summary = str(fields[35] or "").split("/")
            turnover = to_float(summary[2]) if len(summary) > 2 else None
        if turnover is None and len(fields) > 37:
            turnover_fallback = to_float(fields[37])
            turnover = turnover_fallback * 10000 if turnover_fallback is not None else None
        turnover_rate = to_float(fields[38]) if len(fields) > 38 else None
        # field[40] 状态位："S"=停牌(Suspend)，空=正常交易
        status_flag = str(fields[40]).strip() if len(fields) > 40 else ""
        rows[code] = {
            "symbol": code,
            "name": fields[1] or code,
            "price": round4(price),
            "previous_close": round4(previous_close),
            "change": round4(change),
            "change_percent": round4(change_percent),
            "open": round4(open_price),
            "high": round4(to_positive_float(fields[33]) if len(fields) > 33 else None),
            "low": round4(to_positive_float(fields[34]) if len(fields) > 34 else None),
            "volume": volume,
            "turnover": turnover,
            "turnover_rate": round4(turnover_rate),
            "suspended": status_flag == "S",
            "source": "tencent_batch",
            "received_at": captured_at,
            "source_as_of": normalize_source_as_of(fields[30] if len(fields) > 30 else None, captured_at),
        }
    return rows


def parse_eastmoney_list_payload(payload: dict[str, Any], captured_at: str, page: int) -> dict[str, dict[str, Any]]:
    rows: dict[str, dict[str, Any]] = {}
    diff = (((payload or {}).get("data") or {}).get("diff")) or []
    for item in diff:
        code = normalize_symbol(item.get("f12"))
        if not code:
            continue
        price = to_positive_float(item.get("f2"))
        vendor_discount = to_float(item.get("f402"))
        iopv = to_positive_float(item.get("f441"))
        vendor_premium = -vendor_discount if vendor_discount is not None else None
        rows[code] = {
            "symbol": code,
            "name": str(item.get("f14") or code),
            "price": round4(price),
            "iopv": round4(iopv),
            "vendor_discount_percent_raw": round4(vendor_discount),
            "vendor_premium_percent": round4(vendor_premium),
            "source": "eastmoney_push2delay",
            "received_at": captured_at,
            "source_as_of": normalize_source_as_of(item.get("f124"), captured_at),
            "page": page,
        }
    return rows


def normalize_source_as_of(value: Any, fallback: str) -> str:
    if value in (None, "", "-"):
        return fallback
    raw = str(value).strip()
    if raw.isdigit() and len(raw) == 14:
        try:
            dt = datetime.strptime(raw, "%Y%m%d%H%M%S").replace(tzinfo=SHANGHAI)
            return isoformat_z(dt)
        except ValueError:
            return fallback
    numeric = to_float(raw)
    if numeric is None:
        return fallback
    if numeric < 1e12:
        numeric *= 1000
    return isoformat_z(datetime.fromtimestamp(numeric / 1000, timezone.utc))


def fetch_tencent_quotes(symbols: list[str], timeout_sec: float, fetch_bytes: QuoteFetcher = default_fetch_bytes) -> dict[str, dict[str, Any]]:
    captured_at = isoformat_z(utc_now())
    query = ",".join(tencent_symbol(symbol) for symbol in symbols)
    url = TENCENT_QUOTE_URL + "?q=" + urllib.parse.quote(query)
    payload = decode_tencent_payload(fetch_bytes(url, timeout_sec))
    return parse_tencent_quote_text(payload, captured_at)


def fetch_eastmoney_references(
    symbols: list[str],
    timeout_sec: float,
    fetch_bytes: QuoteFetcher = default_fetch_bytes,
    page_size: int = 100,
) -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    wanted = {normalize_symbol(symbol) for symbol in symbols if normalize_symbol(symbol)}
    found: dict[str, dict[str, Any]] = {}
    page = 1
    total = None
    while wanted:
        params = urllib.parse.urlencode(
            {
                "pn": page,
                "pz": page_size,
                "po": 1,
                "np": 1,
                "ut": EASTMONEY_PUSH_TOKEN,
                "fltt": 2,
                "invt": 2,
                "fid": "f3",
                "fs": EASTMONEY_FS,
                "fields": EASTMONEY_FIELDS,
            }
        )
        captured_at = isoformat_z(utc_now())
        payload = json.loads(fetch_bytes(EASTMONEY_LIST_URL + "?" + params, timeout_sec).decode("utf-8", "replace"))
        page_rows = parse_eastmoney_list_payload(payload, captured_at, page)
        for symbol in list(wanted):
            row = page_rows.get(symbol)
            if row:
                found[symbol] = row
                wanted.remove(symbol)
        total = to_float((((payload or {}).get("data") or {}).get("total")))
        if total is not None and page * page_size >= int(total):
            break
        if not page_rows:
            break
        page += 1
    # clist 按板块翻页可能漏掉不在基金板块里的标的（如深市 LOF 161128/161130），
    # 用 ulist.np 按 secid 列表补查，f402（基金公司公布的场内折溢价率）对 LOF 有值。
    if wanted:
        secids = [eastmoney_secid(symbol) for symbol in wanted if normalize_symbol(symbol)]
        ulist_missing = [normalize_symbol(symbol) for symbol in wanted if normalize_symbol(symbol)]
        for start in range(0, len(secids), 100):
            batch = secids[start:start + 100]
            params = urllib.parse.urlencode({
                "secids": ",".join(batch),
                "fields": EASTMONEY_FIELDS,
                "fltt": 2,
                "invt": 2,
            })
            captured_at = isoformat_z(utc_now())
            try:
                payload = json.loads(fetch_bytes(EASTMONEY_ULIST_URL + "?" + params, timeout_sec).decode("utf-8", "replace"))
            except Exception:
                continue
            page_rows = parse_eastmoney_list_payload(payload, captured_at, 0)
            for symbol in list(ulist_missing):
                row = page_rows.get(symbol)
                if row:
                    found[symbol] = row
                    wanted.discard(symbol)
    return found, {"page_size": page_size, "pages_visited": page, "missing_symbols": sorted(wanted)}
