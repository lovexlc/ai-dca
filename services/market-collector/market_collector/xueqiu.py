"""Bounded, cached access to the public Xueqiu CN fund detail payload."""
from __future__ import annotations

import json
import os
import re
import threading
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Any, Callable

XUEQIU_STOCK_HOST = "https://stock.xueqiu.com"
XUEQIU_WEB_HOST = "https://xueqiu.com"
DEFAULT_XUEQIU_WORKER_URL = "https://api.freebacktrack.tech/api/markets"
XUEQIU_ENDPOINT_TIMEOUT_SEC = 6.0
XUEQIU_MAX_CONCURRENCY = 4
XUEQIU_CACHE_TTL_SEC = 1800
XUEQIU_RAW_CACHE_TTL_SEC = 300

XueqiuJsonFetcher = Callable[[str, dict[str, str], float], dict[str, Any]]

_XUEQIU_REQUEST_SLOTS = threading.BoundedSemaphore(XUEQIU_MAX_CONCURRENCY)
_CACHE_LOCK = threading.Lock()
_CACHE: dict[tuple[str, bool], tuple[float, dict[str, Any]]] = {}
_LOADING: dict[tuple[str, bool], threading.Event] = {}


class XueqiuCookieMissing(RuntimeError):
    """Raised when a direct Xueqiu request has no configured session cookie."""


class XueqiuUpstreamError(RuntimeError):
    """Raised when the optional Worker compatibility endpoint fails."""


def clear_xueqiu_cache() -> None:
    """Clear process-local detail responses, primarily useful for tests."""
    with _CACHE_LOCK:
        _CACHE.clear()
        _LOADING.clear()


def _to_cn_six_digits(value: Any) -> str:
    match = re.fullmatch(r"(?:sh|sz|bj)?(\d{6})", str(value or "").strip(), re.IGNORECASE)
    return match.group(1) if match else ""


def to_xueqiu_symbol(value: Any) -> str:
    raw = str(value or "").strip().lower()
    if re.fullmatch(r"(?:sh|sz|bj)\d{6}", raw):
        return raw.upper()
    code = _to_cn_six_digits(raw)
    if not code:
        return ""
    if code.startswith(("5", "6", "000")):
        market = "SH"
    elif code.startswith(("4", "8")):
        market = "BJ"
    else:
        market = "SZ"
    return market + code


def _build_url(base: str, path: str, params: dict[str, Any] | None = None) -> str:
    url = urllib.parse.urljoin(base.rstrip("/") + "/", path.lstrip("/"))
    if params:
        query = [(key, str(value)) for key, value in params.items() if value is not None]
        if query:
            url += "?" + urllib.parse.urlencode(query)
    return url


def _xueqiu_headers(cookie: str, referer_symbol: str = "") -> dict[str, str]:
    trimmed = str(cookie or "").strip()
    if not trimmed:
        raise XueqiuCookieMissing("XUEQIU_COOKIE missing")
    referer = f"{XUEQIU_WEB_HOST}/S/{referer_symbol}" if referer_symbol else f"{XUEQIU_WEB_HOST}/"
    return {
        "accept": "application/json, text/plain, */*",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
        "cookie": trimmed,
        "origin": XUEQIU_WEB_HOST,
        "referer": referer,
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
    }


def default_fetch_json(url: str, headers: dict[str, str], timeout_sec: float) -> dict[str, Any]:
    """Fetch one JSON endpoint while sharing the collector's upstream slots."""
    request = urllib.request.Request(url, method="GET", headers=headers)
    with _XUEQIU_REQUEST_SLOTS:
        with urllib.request.urlopen(request, timeout=timeout_sec) as response:
            raw = response.read()
    try:
        payload = json.loads(raw.decode("utf-8", "replace"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise XueqiuUpstreamError("xueqiu response is not valid JSON") from exc
    if not isinstance(payload, dict):
        raise XueqiuUpstreamError("xueqiu response must be an object")
    if payload.get("error_code") not in (None, 0, "0"):
        description = str(payload.get("error_description") or "").strip()
        suffix = f" {description}" if description else ""
        raise XueqiuUpstreamError(f"xueqiu error_code={payload.get('error_code')}{suffix}")
    return payload


def _summarize_payload(data: dict[str, Any]) -> dict[str, Any]:
    root = data if isinstance(data, dict) else {}
    payload = root.get("data")
    summary: dict[str, Any] = {
        "topKeys": list(root.keys())[:30],
        "dataType": (
            "array" if isinstance(payload, list)
            else "object" if isinstance(payload, dict)
            else type(payload).__name__
        ),
    }
    if isinstance(payload, dict):
        summary["dataKeys"] = list(payload.keys())[:60]
        quote = payload.get("quote")
        if isinstance(quote, dict):
            summary["quoteKeys"] = list(quote.keys())[:120]
        if isinstance(payload.get("column"), list):
            summary["columns"] = payload["column"]
        if isinstance(payload.get("item"), list):
            summary["itemCount"] = len(payload["item"])
        for key in ("items", "list", "data", "indicator", "balance", "income", "cash_flow"):
            value = payload.get(key)
            if isinstance(value, list):
                summary[f"{key}Count"] = len(value)
            elif isinstance(value, dict):
                summary[f"{key}Keys"] = list(value.keys())[:80]
    elif isinstance(payload, list):
        summary["itemCount"] = len(payload)
    if root.get("error_code") or root.get("code"):
        summary["errorCode"] = root.get("error_code") or root.get("code")
        summary["errorMessage"] = root.get("error_description") or root.get("message") or ""
    return summary


def _pick_fields(source: Any, fields: tuple[str, ...]) -> dict[str, Any]:
    if not isinstance(source, dict):
        return {}
    return {field: source[field] for field in fields if field in source}


def _pick_list_fields(value: Any, fields: tuple[str, ...], limit: int = 5) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    return [_pick_fields(item, fields) for item in value[:limit]]


def sanitize_xueqiu_public_payload(name: str, data: dict[str, Any]) -> dict[str, Any] | None:
    """Keep the same small public shape used by the markets Worker."""
    payload = data.get("data") if isinstance(data, dict) else None
    payload = payload if isinstance(payload, dict) else {}
    if name == "quote_detail":
        quote = _pick_fields(payload.get("quote"), (
            "symbol", "code", "name", "current", "percent", "chg", "open", "high", "low", "volume",
            "amount", "market_capital", "marketCapital", "avg_volume", "avg_volume10", "avg_volume_10",
            "beta", "iopv", "unit_nav", "acc_unit_nav", "nav_date", "premium_rate",
            "current_year_percent", "total_shares", "volume_ratio", "found_date", "issue_date",
            "allTimeHigh", "all_time_high", "historyHigh", "history_high", "highest", "highestPrice",
            "highest_price", "maxPrice", "max_price", "high52w", "high_52w",
            "status", "type", "sub_type", "exchange",
        ))
        return {"quote": quote} if quote else None
    if name == "capital_flow":
        items = _pick_list_fields(payload.get("items"), ("timestamp", "amount", "main_net_inflows", "net_inflow"), 20)
        return {"items": items} if items else None
    if name == "capital_history":
        history = _pick_fields(payload, ("sum3", "sum5", "sum10", "sum20"))
        return history or None
    if name == "pankou":
        fields = tuple(field for level in range(1, 6) for field in (f"bp{level}", f"bc{level}", f"sp{level}", f"sc{level}"))
        pankou = _pick_fields(payload, fields)
        return pankou or None
    if name == "finance_indicator":
        rows = _pick_list_fields(payload.get("list"), ("report_name", "asset_liab_ratio", "operating_income_yoy", "total_capital_turnover"), 5)
        return {"list": rows} if rows else None
    if name == "finance_balance":
        rows = _pick_list_fields(payload.get("list"), ("report_name", "total_assets", "total_liab"), 5)
        return {"list": rows} if rows else None
    if name == "finance_income":
        rows = _pick_list_fields(payload.get("list"), ("report_name", "revenue", "net_profit", "total_compre_income"), 5)
        return {"list": rows} if rows else None
    if name == "finance_cash_flow":
        rows = _pick_list_fields(payload.get("list"), ("report_name", "ncf_from_oa"), 5)
        return {"list": rows} if rows else None
    return None


def _endpoint_specs(symbol: str) -> list[tuple[str, str, dict[str, Any]]]:
    begin = int(time.time() * 1000)
    kline_indicators = "kline,pe,pb,ps,pcf,market_capital,agt,ggt,balance"
    return [
        ("quote_detail", "/v5/stock/quote.json", {"extend": "detail", "symbol": symbol}),
        ("kline_day", "/v5/stock/chart/kline.json", {"symbol": symbol, "begin": begin, "period": "day", "type": "before", "count": -20, "indicator": kline_indicators}),
        ("kline_60m", "/v5/stock/chart/kline.json", {"symbol": symbol, "begin": begin, "period": "60m", "type": "before", "count": -20, "indicator": kline_indicators}),
        ("capital_flow", "/v5/stock/capital/flow.json", {"symbol": symbol}),
        ("capital_history", "/v5/stock/capital/history.json", {"symbol": symbol}),
        ("f10_indicator", "/v5/stock/f10/cn/indicator.json", {"symbol": symbol}),
        ("finance_indicator", "/v5/stock/finance/cn/indicator.json", {"symbol": symbol, "type": "all", "is_detail": True, "count": 5}),
        ("finance_balance", "/v5/stock/finance/cn/balance.json", {"symbol": symbol, "type": "all", "is_detail": True, "count": 5}),
        ("finance_income", "/v5/stock/finance/cn/income.json", {"symbol": symbol, "type": "all", "is_detail": True, "count": 5}),
        ("finance_cash_flow", "/v5/stock/finance/cn/cash_flow.json", {"symbol": symbol, "type": "all", "is_detail": True, "count": 5}),
        ("pankou", "/v5/stock/realtime/pankou.json", {"symbol": symbol}),
        ("quotec", "/v5/stock/realtime/quotec.json", {"symbol": symbol}),
    ]


def _safe_error(exc: Exception) -> str:
    message = str(exc).strip() or exc.__class__.__name__
    return message[:300]


def _fetch_worker_payload(
    code: str,
    *,
    worker_url: str,
    timeout_sec: float,
    fetch_json: XueqiuJsonFetcher,
    include_raw: bool,
    force_refresh: bool,
) -> dict[str, Any]:
    params = {"refresh": "1"} if force_refresh else {}
    if include_raw:
        params["raw"] = "1"
    url = _build_url(worker_url, f"xueqiu-fund-data/{urllib.parse.quote(code)}", params)
    try:
        payload = fetch_json(url, {"accept": "application/json", "user-agent": "market-collector/1"}, timeout_sec)
    except Exception as exc:
        raise XueqiuUpstreamError(f"xueqiu worker request failed: {_safe_error(exc)}") from exc
    if not isinstance(payload, dict) or not isinstance(payload.get("results"), dict):
        detail = payload.get("error") if isinstance(payload, dict) else "invalid payload"
        raise XueqiuUpstreamError(f"xueqiu worker unavailable: {detail or 'invalid payload'}")
    return payload


def fetch_xueqiu_fund_data(
    code: str,
    *,
    cookie: str = "",
    include_raw: bool = False,
    force_refresh: bool = False,
    worker_url: str | None = None,
    timeout_sec: float = XUEQIU_ENDPOINT_TIMEOUT_SEC,
    max_concurrency: int = XUEQIU_MAX_CONCURRENCY,
    cache_ttl_sec: int = XUEQIU_CACHE_TTL_SEC,
    fetch_json: XueqiuJsonFetcher = default_fetch_json,
) -> dict[str, Any]:
    """Return a Worker-compatible Xueqiu detail payload.

    Direct Xueqiu requests use a process-wide semaphore and at most four
    concurrent endpoints. When no Cookie is available, a dedicated Worker URL
    can provide the same sanitized payload without exposing credentials in CN.
    """
    normalized = _to_cn_six_digits(code)
    symbol = to_xueqiu_symbol(normalized)
    if not symbol:
        raise ValueError("xueqiu bad code " + str(code))
    cache_key = (normalized, bool(include_raw))
    while True:
        now = time.monotonic()
        with _CACHE_LOCK:
            cached = _CACHE.get(cache_key)
            if not force_refresh and cached and cached[0] > now:
                return {**cached[1], "cached": True}
            loading = _LOADING.get(cache_key)
            if loading is None or force_refresh:
                loading = threading.Event()
                if not force_refresh:
                    _LOADING[cache_key] = loading
                break
        loading.wait()

    try:
        trimmed_cookie = str(cookie or "").strip() or os.getenv("XUEQIU_COOKIE", "").strip()
        effective_timeout = max(1.0, min(float(timeout_sec), 30.0))
        if not trimmed_cookie:
            fallback_url = worker_url if worker_url is not None else os.getenv("XUEQIU_WORKER_URL", DEFAULT_XUEQIU_WORKER_URL)
            if fallback_url:
                payload = _fetch_worker_payload(
                    normalized,
                    worker_url=str(fallback_url).strip(),
                    timeout_sec=effective_timeout,
                    fetch_json=fetch_json,
                    include_raw=include_raw,
                    force_refresh=force_refresh,
                )
                with _CACHE_LOCK:
                    _CACHE[cache_key] = (now + (XUEQIU_RAW_CACHE_TTL_SEC if include_raw else cache_ttl_sec), payload)
                    if _LOADING.get(cache_key) is loading:
                        _LOADING.pop(cache_key, None)
                    loading.set()
                return {**payload, "cached": bool(payload.get("cached"))}
            raise XueqiuCookieMissing("XUEQIU_COOKIE missing")

        specs = _endpoint_specs(symbol)
        limit = max(1, min(int(max_concurrency), len(specs), XUEQIU_MAX_CONCURRENCY))
        results: dict[str, dict[str, Any]] = {}

        def fetch_one(name: str, path: str, params: dict[str, Any]) -> tuple[str, dict[str, Any]]:
            url = _build_url(XUEQIU_STOCK_HOST, path, params)
            try:
                data = fetch_json(url, _xueqiu_headers(trimmed_cookie, symbol), effective_timeout)
                public_data = sanitize_xueqiu_public_payload(name, data)
                result: dict[str, Any] = {
                    "ok": True,
                    "summary": _summarize_payload(data),
                }
                if public_data:
                    result["data"] = public_data
                if include_raw:
                    result["raw"] = data
                return name, result
            except Exception as exc:
                return name, {"ok": False, "error": _safe_error(exc)}

        with ThreadPoolExecutor(max_workers=limit) as executor:
            futures = [executor.submit(fetch_one, name, path, params) for name, path, params in specs]
            for future in as_completed(futures):
                name, result = future.result()
                results[name] = result

        payload = {
            "symbol": symbol,
            "code": normalized,
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "results": {name: results[name] for name, _path, _params in specs},
        }
        with _CACHE_LOCK:
            _CACHE[cache_key] = (now + (XUEQIU_RAW_CACHE_TTL_SEC if include_raw else cache_ttl_sec), payload)
            if _LOADING.get(cache_key) is loading:
                _LOADING.pop(cache_key, None)
            loading.set()
        return {**payload, "cached": False}
    except Exception:
        with _CACHE_LOCK:
            if _LOADING.get(cache_key) is loading:
                _LOADING.pop(cache_key, None)
            loading.set()
        raise
