from __future__ import annotations

import json
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .otc import OTC_SYMBOLS

EASTMONEY_SEARCH_URL = "https://searchapi.eastmoney.com/api/suggest/get"
EASTMONEY_SEARCH_TOKEN = "D43BF722C8E33BDC906FB84D85E326E8"
EXCHANGE_PREFIXES = {"15", "50", "51", "52", "54", "56", "58"}
FUND_VENUE_CACHE_TTL_SEC = 30 * 24 * 3600
FUND_VENUE_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
FUND_VENUE_CACHE_LOCK = threading.Lock()
UPSTREAM_REQUEST_SLOTS = threading.BoundedSemaphore(6)


def normalize_code(value: Any) -> str:
    text = str(value or "").strip()
    text = re.sub(r"^(?:sh|sz|bj|jj)", "", text, flags=re.IGNORECASE)
    digits = re.sub(r"\D", "", text)
    return digits if re.fullmatch(r"\d{6}", digits) else ""


def _text(value: Any) -> str:
    return str(value or "").strip()


def _category(*values: Any) -> str:
    text = " ".join(_text(value) for value in values).lower()
    if "qdii" in text:
        return "qdii"
    if "国内" in text or "境内" in text:
        return "domestic"
    return "unknown"


def _kind(venue: str, category: str) -> str:
    if venue == "exchange":
        return "exchange"
    if venue == "otc" and category == "qdii":
        return "qdii"
    if venue == "otc":
        return "otc"
    return ""


def _candidate_from_search_row(row: dict[str, Any], code: str) -> dict[str, Any] | None:
    row_code = normalize_code(row.get("Code"))
    if row_code != code:
        return None
    type_values = (
        row.get("Classify"),
        row.get("SecurityType"),
        row.get("SecurityTypeName"),
        row.get("SecurityTypeName2"),
        row.get("QuoteType"),
        row.get("TypeName"),
    )
    type_text = " ".join(_text(value) for value in type_values)
    if not re.search(r"基金|fund|lof|etf|qdii", type_text, flags=re.IGNORECASE):
        return None
    market = _text(row.get("MktNum") or row.get("MarketType"))
    is_exchange = bool(re.search(r"etf|lof|场内|封闭", type_text, flags=re.IGNORECASE)) or market in {"0", "1", "2"}
    venue = "exchange" if is_exchange else "otc"
    category = _category(row.get("Name"), *type_values)
    prefix = (
        "sh" if market == "1"
        else "sz" if market == "0"
        else "bj" if market == "2"
        else "sh" if code.startswith("6")
        else "bj" if code.startswith(("4", "8"))
        else "sz"
    )
    return {
        "code": code,
        "symbol": code if venue == "otc" else prefix + code,
        "name": _text(row.get("Name")) or code,
        "type": _text(row.get("Classify") or row.get("SecurityTypeName") or row.get("TypeName")),
        "exchange": "场外基金" if venue == "otc" else _text(row.get("SecurityTypeName")) or prefix,
        "assetType": "otc_fund" if venue == "otc" else "exchange_fund",
        "fundVenue": venue,
        "fundCategory": category,
        "fundKind": _kind(venue, category),
        "source": "eastmoney-search",
        "confidence": "upstream",
    }


def _catalog_candidate(code: str) -> dict[str, Any] | None:
    if code not in OTC_SYMBOLS:
        return None
    return {
        "code": code,
        "symbol": code,
        "name": code,
        "type": "OTC QDII catalog",
        "exchange": "场外基金",
        "assetType": "otc_fund",
        "fundVenue": "otc",
        "fundCategory": "qdii",
        "fundKind": "qdii",
        "source": "otc-catalog",
        "confidence": "catalog",
    }


def _prefix_candidate(code: str) -> dict[str, Any] | None:
    if code[:2] not in EXCHANGE_PREFIXES:
        return None
    return {
        "code": code,
        "symbol": code,
        "name": code,
        "type": "exchange fund prefix fallback",
        "exchange": "交易所基金",
        "assetType": "exchange_fund",
        "fundVenue": "exchange",
        "fundCategory": "unknown",
        "fundKind": "exchange",
        "source": "code-prefix-fallback",
        "confidence": "fallback",
    }


def _dedupe_candidates(candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_venue: dict[str, dict[str, Any]] = {}
    for candidate in candidates:
        venue = _text(candidate.get("fundVenue"))
        if venue and venue not in by_venue:
            by_venue[venue] = candidate
    return list(by_venue.values())


def _build_item(code: str, candidates: list[dict[str, Any]], error: str = "") -> dict[str, Any]:
    unique = _dedupe_candidates(candidates)
    selected = unique[0] if len(unique) == 1 else None
    ambiguous = len(unique) > 1
    category = "qdii" if any(item.get("fundCategory") == "qdii" for item in unique) else (
        _text(selected.get("fundCategory")) if selected else "unknown"
    )
    return {
        "code": code,
        "name": _text(selected.get("name")) if selected else next(
            (_text(item.get("name")) for item in unique if _text(item.get("name"))),
            code,
        ),
        "fundVenue": _text(selected.get("fundVenue")) if selected else "",
        "fundCategory": category or "unknown",
        "fundKind": _text(selected.get("fundKind")) if selected else "",
        "assetType": _text(selected.get("assetType")) if selected else "",
        "ambiguous": ambiguous,
        "candidates": unique,
        "source": "+".join(_text(item.get("source")) for item in unique if _text(item.get("source"))),
        "confidence": _text(selected.get("confidence")) if selected else ("ambiguous" if ambiguous else "unknown"),
        "error": _text(error),
    }


def _read_cached(code: str) -> dict[str, Any] | None:
    now = time.time()
    with FUND_VENUE_CACHE_LOCK:
        entry = FUND_VENUE_CACHE.get(code)
        if not entry:
            return None
        expires_at, item = entry
        if expires_at <= now:
            FUND_VENUE_CACHE.pop(code, None)
            return None
        return {**item, "cache": "local"}


def _write_cached(item: dict[str, Any]) -> None:
    code = _text(item.get("code"))
    if not code:
        return
    with FUND_VENUE_CACHE_LOCK:
        FUND_VENUE_CACHE[code] = (time.time() + FUND_VENUE_CACHE_TTL_SEC, dict(item))


def _fetch_search_candidates(code: str, timeout_sec: float) -> list[dict[str, Any]]:
    query = urlencode({
        "input": code,
        "type": 14,
        "token": EASTMONEY_SEARCH_TOKEN,
        "count": 12,
    })
    request = Request(
        f"{EASTMONEY_SEARCH_URL}?{query}",
        method="GET",
        headers={
            "accept": "application/json",
            "referer": "https://quote.eastmoney.com/",
            "user-agent": "market-collector-fund-venue/1",
        },
    )
    with UPSTREAM_REQUEST_SLOTS:
        with urlopen(request, timeout=timeout_sec) as response:
            payload = json.loads(response.read().decode("utf-8", "replace"))
    rows = (((payload or {}).get("QuotationCodeTable") or {}).get("Data") or [])
    if not isinstance(rows, list):
        return []
    return [
        candidate
        for row in rows
        if isinstance(row, dict)
        if (candidate := _candidate_from_search_row(row, code)) is not None
    ]


def _classify_one(code: str, timeout_sec: float) -> dict[str, Any]:
    cached = _read_cached(code)
    if cached:
        return cached
    upstream_candidates: list[dict[str, Any]] = []
    upstream_error = ""
    try:
        upstream_candidates = _fetch_search_candidates(code, timeout_sec)
    except Exception as exc:
        upstream_error = str(exc)
    candidates = upstream_candidates + [_catalog_candidate(code), _prefix_candidate(code)]
    item = _build_item(code, [candidate for candidate in candidates if candidate], upstream_error)
    if item["candidates"]:
        _write_cached(item)
    return {**item, "cache": "live"}


def classify_fund_venues(
    codes: list[Any] | None = None,
    *,
    timeout_sec: float = 5.0,
) -> dict[str, Any]:
    normalized = list(dict.fromkeys(normalize_code(code) for code in (codes or [])))
    normalized = [code for code in normalized if code][:60]
    if not normalized:
        return {"items": [], "successCount": 0, "failureCount": 0, "source": "market-collector"}
    items: dict[str, dict[str, Any]] = {}
    with ThreadPoolExecutor(max_workers=min(5, len(normalized))) as executor:
        futures = {
            executor.submit(_classify_one, code, timeout_sec): code
            for code in normalized
        }
        for future in as_completed(futures):
            code = futures[future]
            try:
                items[code] = future.result()
            except Exception as exc:
                items[code] = _build_item(code, [], str(exc))
    ordered = [items[code] for code in normalized]
    return {
        "items": ordered,
        "successCount": sum(1 for item in ordered if item.get("candidates") or item.get("ambiguous")),
        "failureCount": sum(1 for item in ordered if not item.get("candidates") and not item.get("ambiguous")),
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": "market-collector+eastmoney-search",
    }


__all__ = ["classify_fund_venues", "normalize_code"]
