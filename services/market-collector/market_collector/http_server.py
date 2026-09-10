from __future__ import annotations

import argparse
import json
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable
from urllib.error import HTTPError
from urllib.parse import parse_qs, unquote, urlencode, urlparse
from urllib.request import Request, urlopen

from .aggregates import MarketDataService

SYMBOL_PATH = re.compile(r"^/symbols/(?P<symbol>\d{6})$")
KLINE_PATH = re.compile(r"^/klines/(?P<symbol>\d{6})$")
NAV_PATH = re.compile(r"^/nav/(?P<symbol>\d{6})$")
PREMIUM_PATH = re.compile(r"^/premium/(?P<symbol>\d{6})$")
DATASET_PATH = re.compile(r"^/datasets/(?P<dataset>[a-z0-9-]+)/(?P<key>[^/]+)$")
WEB_QUOTE_PATH = re.compile(r"^/quote/(?P<symbol>[^/]+)$")
WEB_KLINE_PATH = re.compile(r"^/kline/(?P<symbol>[^/]+)$")
WEB_FINANCIALS_PATH = re.compile(r"^/financials/(?P<symbol>[^/]+)$")
WEB_DETAIL_PATH = re.compile(r"^/(?:financials|xueqiu-fund-data|profile)/[^/]+$")
WEB_EXACT_PATHS = {
    "/indices", "/sectors", "/quotes", "/search", "/summary", "/news",
    "/earnings", "/fund-metrics", "/fund-fee", "/fund-limit", "/fund-limit/overview", "/market-summary", "/taco", "/movers",
    "/list-rows", "/exchange-fund-list", "/nav-history",
}
MAX_REQUEST_BODY_BYTES = 256 * 1024
UPSTREAM_REQUEST_SLOTS = threading.BoundedSemaphore(6)
SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
SEC_COMPANY_FACTS_URL = "https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json"
SEC_HEADERS = {
    "accept": "application/json",
    "user-agent": "ai-dca market collector admin@freebacktrack.tech",
}
FINANCIALS_CACHE_TTL_SEC = 6 * 3600
SEC_TICKERS_CACHE_TTL_SEC = 24 * 3600
SEC_FINANCIAL_FIELDS = {
    "income": {
        "totalRevenue": (
            "RevenueFromContractWithCustomerExcludingAssessedTax",
            "Revenues",
            "SalesRevenueNet",
        ),
        "grossProfit": ("GrossProfit",),
        "operatingIncome": ("OperatingIncomeLoss",),
        "netIncome": ("NetIncomeLoss", "ProfitLoss"),
    },
    "balance": {
        "totalAssets": ("Assets",),
        "totalLiab": ("Liabilities",),
        "totalStockholderEquity": (
            "StockholdersEquity",
            "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
        ),
        "cash": (
            "CashAndCashEquivalentsAtCarryingValue",
            "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
        ),
    },
    "cashflow": {
        "totalCashFromOperatingActivities": ("NetCashProvidedByUsedInOperatingActivities",),
        "capitalExpenditures": ("PaymentsToAcquirePropertyPlantAndEquipment",),
        "changeInCash": (
            "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalentsPeriodIncreaseDecreaseIncludingExchangeRateEffect",
            "CashAndCashEquivalentsPeriodIncreaseDecrease",
        ),
    },
}

_FINANCIALS_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_SEC_TICKERS_CACHE: tuple[float, dict[str, str]] = (0.0, {})
_SEC_CACHE_LOCK = threading.Lock()

ProxyRequest = Callable[[str, str, dict[str, Any] | None], tuple[int, dict[str, Any]]]
FinancialsRequest = Callable[[str, bool], dict[str, Any]]


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _int_param(query: dict[str, list[str]], name: str, default: int, maximum: int = 3000) -> int:
    try:
        return max(1, min(int((query.get(name) or [default])[0]), maximum))
    except (TypeError, ValueError):
        return default


def _normalize_web_route(path: str) -> str:
    if path == "/api/holdings/nav-history":
        return "/nav-history"
    for prefix in ("/api/market-collector", "/api/markets"):
        if path == prefix:
            return "/"
        if path.startswith(prefix + "/"):
            return path[len(prefix):]
    return path


def _is_web_api_route(route: str) -> bool:
    return route in WEB_EXACT_PATHS or bool(
        WEB_QUOTE_PATH.fullmatch(route)
        or WEB_KLINE_PATH.fullmatch(route)
        or WEB_DETAIL_PATH.fullmatch(route)
    )


def proxy_market_request(
    method: str, path: str, body: dict[str, Any] | None, timeout_sec: float = 25.0,
) -> tuple[int, dict[str, Any]]:
    route = _normalize_web_route(urlparse(path).path.rstrip("/") or "/")
    return HTTPStatus.NOT_IMPLEMENTED, {
        "error": "collector_market_route_missing",
        "path": route,
        "detail": "Market routes must be implemented by the CN market collector.",
    }

def _fetch_sec_json(url: str, timeout_sec: float = 20.0) -> dict[str, Any]:
    request = Request(url, method="GET", headers=SEC_HEADERS)
    with UPSTREAM_REQUEST_SLOTS:
        with urlopen(request, timeout=timeout_sec) as response:
            return _json_payload(response.read())


def _sec_ticker_map(force_refresh: bool = False) -> dict[str, str]:
    global _SEC_TICKERS_CACHE
    now = time.time()
    with _SEC_CACHE_LOCK:
        expires_at, cached = _SEC_TICKERS_CACHE
        if not force_refresh and expires_at > now and cached:
            return cached
    payload = _fetch_sec_json(SEC_TICKERS_URL)
    mapping = {
        str(item.get("ticker") or "").upper(): str(item.get("cik_str") or "").zfill(10)
        for item in payload.values()
        if isinstance(item, dict) and item.get("ticker") and item.get("cik_str") is not None
    }
    if not mapping:
        raise ValueError("SEC ticker mapping is empty")
    with _SEC_CACHE_LOCK:
        _SEC_TICKERS_CACHE = (now + SEC_TICKERS_CACHE_TTL_SEC, mapping)
    return mapping


def _sec_fact_entries(company_facts: dict[str, Any], tags: tuple[str, ...]) -> list[dict[str, Any]]:
    us_gaap = ((company_facts.get("facts") or {}).get("us-gaap") or {})
    entries: list[dict[str, Any]] = []
    for tag in tags:
        fact = us_gaap.get(tag)
        values = ((fact or {}).get("units") or {}).get("USD")
        if isinstance(values, list):
            entries.extend(item for item in values if isinstance(item, dict))
    return entries


def _is_sec_period(entry: dict[str, Any], period: str, statement: str) -> bool:
    form = str(entry.get("form") or "")
    frame = str(entry.get("frame") or "")
    if period == "annual":
        return form == "10-K" and str(entry.get("fp") or "") == "FY"
    if form != "10-Q":
        return False
    if statement == "balance":
        return bool(re.fullmatch(r"CY\d{4}Q[1-4]I", frame))
    return bool(re.fullmatch(r"CY\d{4}Q[1-4]", frame))


def _normalize_sec_financials(company_facts: dict[str, Any], symbol: str) -> dict[str, Any]:
    statements: dict[str, dict[str, list[dict[str, Any]]]] = {}
    for statement, fields in SEC_FINANCIAL_FIELDS.items():
        statements[statement] = {}
        for period in ("annual", "quarterly"):
            rows_by_end: dict[str, dict[str, Any]] = {}
            filed_by_field: dict[tuple[str, str], str] = {}
            for field, tags in fields.items():
                for entry in _sec_fact_entries(company_facts, tags):
                    if not _is_sec_period(entry, period, statement):
                        continue
                    end = str(entry.get("end") or "")
                    try:
                        value = float(entry.get("val"))
                        end_date = int(datetime.fromisoformat(end).replace(tzinfo=timezone.utc).timestamp())
                    except (TypeError, ValueError):
                        continue
                    filed = str(entry.get("filed") or "")
                    field_key = (end, field)
                    if field_key in filed_by_field and filed_by_field[field_key] >= filed:
                        continue
                    filed_by_field[field_key] = filed
                    if field == "capitalExpenditures":
                        value = -abs(value)
                    row = rows_by_end.setdefault(end, {"period": end, "endDate": end_date, "fields": {}})
                    row["fields"][field] = value
            statements[statement][period] = sorted(
                (row for row in rows_by_end.values() if row["fields"]),
                key=lambda row: row["endDate"],
            )[-8:]
    if not any(
        rows
        for statement in statements.values()
        for rows in statement.values()
    ):
        raise ValueError("SEC company facts contain no supported financial rows")
    return {
        "symbol": symbol,
        "market": "us",
        "statements": statements,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": "sec-companyfacts",
        "cached": False,
    }


def fetch_sec_financials(symbol: str, force_refresh: bool = False) -> dict[str, Any]:
    normalized = unquote(symbol).upper().replace(".", "-")
    if not re.fullmatch(r"[A-Z0-9^-]{1,16}", normalized):
        raise ValueError("invalid US symbol")
    now = time.time()
    with _SEC_CACHE_LOCK:
        expires_at, cached = _FINANCIALS_CACHE.get(normalized, (0.0, {}))
        if not force_refresh and expires_at > now and cached:
            return {**cached, "cached": True}
    cik = _sec_ticker_map(force_refresh)
    cik_value = cik.get(normalized)
    if not cik_value:
        raise ValueError("SEC CIK not found for " + normalized)
    payload = _normalize_sec_financials(
        _fetch_sec_json(SEC_COMPANY_FACTS_URL.format(cik=cik_value)),
        normalized,
    )
    with _SEC_CACHE_LOCK:
        _FINANCIALS_CACHE[normalized] = (now + FINANCIALS_CACHE_TTL_SEC, payload)
    return payload


def _local_symbol(raw_symbol: str) -> str:
    match = re.fullmatch(r"(?:sh|sz|bj)?(\d{6})", unquote(raw_symbol), re.IGNORECASE)
    return match.group(1) if match else ""


def _merge_present(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    return {**base, **{key: value for key, value in override.items() if value is not None}}


def _record_timestamp(record: dict[str, Any]) -> float | None:
    for key in ("asOf", "updatedAt", "price_timestamp", "collected_at", "quoteDate"):
        raw = str(record.get(key) or "").strip()
        if not raw:
            continue
        try:
            return datetime.fromisoformat(raw.replace("Z", "+00:00")).timestamp()
        except ValueError:
            continue
    return None


def _merge_fresh_record(upstream: dict[str, Any], local: dict[str, Any]) -> dict[str, Any]:
    upstream_at = _record_timestamp(upstream)
    local_at = _record_timestamp(local)
    if upstream_at is not None and (local_at is None or local_at < upstream_at):
        return upstream
    return _merge_present(upstream, local)


def _local_quote(data_service: MarketDataService, raw_symbol: str) -> dict[str, Any] | None:
    symbol = _local_symbol(raw_symbol)
    if not symbol:
        return None
    quote = data_service.quote(symbol)
    if not quote:
        return None
    return {
        **quote,
        "symbol": symbol,
        "code": symbol,
        "market": "cn",
        "source": "market-collector",
    }


def resolve_request(
    path: str,
    data_dir: Path,
    data_service: MarketDataService | None = None,
    *,
    method: str = "GET",
    body: dict[str, Any] | None = None,
    proxy_request: ProxyRequest = proxy_market_request,
    financials_request: FinancialsRequest = fetch_sec_financials,
    offline: bool = False,
) -> tuple[int, dict[str, Any]]:
    parsed = urlparse(path)
    route = _normalize_web_route(parsed.path.rstrip("/") or "/")
    query = parse_qs(parsed.query)
    if route == "/":
        return HTTPStatus.OK, {
            "service": "market-collector-shadow-api",
            "timezone": "Asia/Shanghai",
            "utc_offset": "+08:00",
            "endpoints": [
                "/health", "/latest", "/symbols/{code}",
                "/klines/{code}?interval=5m|1d&limit=500",
                "/nav/{code}?days=365", "/premium/{code}?interval=5m|1d&limit=500",
                "/fund-metrics?codes=513100,513500",
                "/otc/latest",
                "/aggregates/home-market-overview", "/aggregates/home-market-series",
                "/aggregates/fund-limit-overview", "/aggregates/home-market-collect",
                "/datasets/{dataset}/{key}",
                "/quotes?symbols=513100,QQQ", "/quote/{symbol}",
                "/kline/{symbol}?tf=5m|1d&limit=500", "POST /fund-metrics",
                "web compatibility routes are collector-local; no Cloudflare market fallback",
                "offline mode (--offline) serves /quotes, /quote, /fund-metrics purely from local cache",
            ],
        }

    filename = "health.json" if route == "/health" and method == "GET" else "latest.json" if route == "/latest" and method == "GET" else ""
    if filename:
        try:
            return HTTPStatus.OK, load_json(data_dir / filename)
        except (FileNotFoundError, json.JSONDecodeError, OSError) as exc:
            return HTTPStatus.SERVICE_UNAVAILABLE, {
                "error": "snapshot_unavailable",
                "detail": str(exc),
            }

    if route == "/otc/latest" and data_service:
        try:
            return HTTPStatus.OK, data_service.otc_latest()
        except (FileNotFoundError, json.JSONDecodeError, OSError) as exc:
            return HTTPStatus.SERVICE_UNAVAILABLE, {"error": "otc_snapshot_unavailable", "detail": str(exc)}

    match = SYMBOL_PATH.fullmatch(route)
    if match:
        symbol = match.group("symbol")
        try:
            payload = load_json(data_dir / "latest.json")
        except (FileNotFoundError, json.JSONDecodeError, OSError) as exc:
            return HTTPStatus.SERVICE_UNAVAILABLE, {
                "error": "snapshot_unavailable",
                "detail": str(exc),
            }
        record = next(
            (item for item in payload.get("symbols", []) if str(item.get("symbol")) == symbol),
            None,
        )
        if record is None:
            if data_service:
                record = data_service.fund_metric(symbol)
            if record is None:
                return HTTPStatus.NOT_FOUND, {"error": "symbol_not_found", "symbol": symbol}
        return HTTPStatus.OK, record

    if route.startswith(("/klines/", "/nav/", "/premium/", "/fund-metrics", "/aggregates/", "/datasets/")) and data_service is None:
        return HTTPStatus.SERVICE_UNAVAILABLE, {"error": "aggregate_service_unavailable"}

    match = KLINE_PATH.fullmatch(route)
    if match and data_service:
        interval = str((query.get("interval") or query.get("tf") or ["5m"])[0]).lower()
        if interval not in {"5m", "1d"}:
            return HTTPStatus.BAD_REQUEST, {"error": "unsupported_interval", "supported": ["5m", "1d"]}
        try:
            return HTTPStatus.OK, data_service.kline(match.group("symbol"), interval, _int_param(query, "limit", 500))
        except Exception as exc:
            return HTTPStatus.BAD_GATEWAY, {"error": "data_source_failed", "detail": str(exc)}

    match = NAV_PATH.fullmatch(route)
    if match and data_service:
        try:
            return HTTPStatus.OK, data_service.nav_history(match.group("symbol"), _int_param(query, "days", 365, 3650))
        except Exception as exc:
            return HTTPStatus.BAD_GATEWAY, {"error": "data_source_failed", "detail": str(exc)}

    match = PREMIUM_PATH.fullmatch(route)
    if match and data_service:
        interval = str((query.get("interval") or ["1d"])[0]).lower()
        if interval not in {"5m", "1d"}:
            return HTTPStatus.BAD_REQUEST, {"error": "unsupported_interval", "supported": ["5m", "1d"]}
        try:
            return HTTPStatus.OK, data_service.premium_series(match.group("symbol"), interval, _int_param(query, "limit", 500))
        except Exception as exc:
            return HTTPStatus.BAD_GATEWAY, {"error": "data_source_failed", "detail": str(exc)}

    match = WEB_QUOTE_PATH.fullmatch(route)
    if match and data_service and method == "GET":
        local = _local_quote(data_service, match.group("symbol"))
        if local is not None:
            return HTTPStatus.OK, local
        return HTTPStatus.NOT_FOUND, {"error": "symbol_not_found", "symbol": match.group("symbol")}

    if route == "/quotes" and data_service and method == "GET":
        requested = list(dict.fromkeys(
            code for raw in query.get("symbols", [])
            for code in re.split(r"[,\s]+", str(raw)) if code
        ))[:100]
        local_quotes = {}
        for symbol in requested:
            local = _local_quote(data_service, symbol)
            if local is not None:
                local_quotes[symbol] = local
        return HTTPStatus.OK, {
            "quotes": local_quotes,
            "generatedAt": max((str(item.get("asOf") or "") for item in local_quotes.values()), default=""),
            "source": "market-collector",
        }

    match = WEB_KLINE_PATH.fullmatch(route)
    if match and data_service and method == "GET":
        symbol = _local_symbol(match.group("symbol"))
        interval = str((query.get("tf") or query.get("interval") or ["1d"])[0]).lower()
        if symbol and interval in {"5m", "1d"} and data_service.fund_metric(symbol):
            try:
                return HTTPStatus.OK, data_service.kline(
                    symbol,
                    interval,
                    _int_param(query, "limit", 500),
                )
            except Exception:
                pass
        return HTTPStatus.NOT_FOUND, {"error": "symbol_not_found", "symbol": match.group("symbol")}

    if route == "/nav-history" and data_service:
        if method == "GET":
            code = str((query.get("code") or [""])[0]).strip()
            if not re.fullmatch(r"\d{6}", code):
                return HTTPStatus.BAD_REQUEST, {"error": "code_required"}
            try:
                return HTTPStatus.OK, data_service.nav_history(code, _int_param(query, "days", 365, 3650))
            except Exception as exc:
                return HTTPStatus.BAD_GATEWAY, {"error": "nav_history_failed", "detail": str(exc)}
        if method == "POST":
            codes = list(dict.fromkeys(str(code or "").strip() for code in (body or {}).get("codes") or [] if re.fullmatch(r"\d{6}", str(code or "").strip())))[:60]
            if not codes:
                return HTTPStatus.BAD_REQUEST, {"error": "codes_required"}
            items = []
            for code in codes:
                try:
                    items.append({"code": code, "ok": True, "data": data_service.nav_history(code, 1000)})
                except Exception as exc:
                    items.append({"code": code, "ok": False, "error": str(exc)})
            return HTTPStatus.OK, {"ok": True, "count": len(items), "items": items, "source": "market-collector"}
        return HTTPStatus.METHOD_NOT_ALLOWED, {"error": "method_not_allowed"}

    if route == "/fund-metrics" and data_service and method == "POST":
        codes = list(dict.fromkeys(str(code or "").strip() for code in (body or {}).get("codes") or [] if re.fullmatch(r"\d{6}", str(code or "").strip())))[:100]
        if not codes:
            return HTTPStatus.BAD_REQUEST, {"error": "codes_required"}
        try:
            items = [item for item in data_service.fund_metrics(codes) if isinstance(item, dict)]
        except Exception as exc:
            return HTTPStatus.SERVICE_UNAVAILABLE, {"error": "local_fund_metrics_failed", "detail": str(exc)}
        return HTTPStatus.OK, {"items": items, "successCount": len(items), "failureCount": len(codes) - len(items), "source": "market-collector"}

    if route == "/fund-metrics" and data_service:
        codes = []
        for value in query.get("codes") or []:
            codes.extend(part.strip() for part in value.split(","))
        codes = list(dict.fromkeys(code for code in codes if re.fullmatch(r"\d{6}", code)))
        if not codes:
            return HTTPStatus.BAD_REQUEST, {"error": "codes_required"}
        try:
            items = data_service.fund_metrics(codes)
        except Exception as exc:
            return HTTPStatus.BAD_GATEWAY, {"error": "data_source_failed", "detail": str(exc)}
        return HTTPStatus.OK, {
            "items": items, "successCount": len(items), "failureCount": len(codes) - len(items),
            "generatedAt": max((str(item.get("asOf") or "") for item in items), default=""),
        }

    if route == "/fund-fee" and data_service:
        if method == "GET":
            code = str((query.get("code") or query.get("symbol") or [""])[0]).strip()
            if not re.fullmatch(r"\d{6}", code):
                return HTTPStatus.BAD_REQUEST, {"error": "code_required"}
            record = data_service.dataset_record("fund-fee", code)
            if record is None:
                return HTTPStatus.NOT_FOUND, {"error": "fund_fee_not_found", "code": code}
            return HTTPStatus.OK, record.get("payload") or record
        if method == "POST":
            codes = list(dict.fromkeys(str(code or "").strip() for code in (body or {}).get("codes") or [] if re.fullmatch(r"\d{6}", str(code or "").strip())))[:100]
            if not codes:
                return HTTPStatus.BAD_REQUEST, {"error": "codes_required"}
            items = []
            for code in codes:
                record = data_service.dataset_record("fund-fee", code)
                if record is None:
                    items.append({"code": code, "ok": False, "error": "fund_fee_not_found"})
                else:
                    items.append({"code": code, "ok": True, "data": record.get("payload") or record})
            return HTTPStatus.OK, {"items": items, "successCount": sum(1 for item in items if item["ok"]), "failureCount": sum(1 for item in items if not item["ok"]), "source": "market-collector"}
        return HTTPStatus.METHOD_NOT_ALLOWED, {"error": "method_not_allowed"}

    if route == "/fund-limit" and data_service and method == "GET":
        code = str((query.get("code") or [""])[0]).strip()
        if not re.fullmatch(r"\d{6}", code):
            return HTTPStatus.BAD_REQUEST, {"error": "code_required"}
        record = data_service.dataset_record("fund-limit", code)
        if record is None:
            return HTTPStatus.NOT_FOUND, {"error": "fund_limit_not_found", "code": code}
        return HTTPStatus.OK, record.get("payload") or record

    if route == "/fund-limit/overview" and data_service and method == "GET":
        return HTTPStatus.OK, data_service.fund_limit_overview()

    if route == "/aggregates/home-market-overview" and data_service:
        return HTTPStatus.OK, data_service.home_overview()

    if route == "/aggregates/home-market-series" and data_service:
        return HTTPStatus.OK, data_service.home_series()

    if route == "/aggregates/fund-limit-overview" and data_service:
        return HTTPStatus.OK, data_service.fund_limit_overview()

    if route == "/aggregates/home-market-collect" and data_service:
        # On-demand refresh is deliberately collector-local: no CF Worker proxy.
        try:
            with ThreadPoolExecutor(max_workers=3) as executor:
                overview = executor.submit(data_service.home_overview)
                series = executor.submit(data_service.home_series)
                limits = executor.submit(data_service.fund_limit_overview)
                return HTTPStatus.OK, {
                    "overview": overview.result(),
                    "series": series.result(),
                    "limits": limits.result(),
                    "generatedAt": datetime.now(timezone.utc).isoformat(),
                    "source": "market-collector-local",
                }
        except Exception as exc:
            return HTTPStatus.SERVICE_UNAVAILABLE, {
                "error": "local_home_collect_failed", "detail": str(exc),
            }

    match = DATASET_PATH.fullmatch(route)
    if match and data_service:
        try:
            record = data_service.dataset_record(match.group("dataset"), unquote(match.group("key")))
        except Exception as exc:
            return HTTPStatus.BAD_GATEWAY, {"error": "data_source_failed", "detail": str(exc)}
        if record is None:
            return HTTPStatus.NOT_FOUND, {"error": "dataset_record_not_found"}
        return HTTPStatus.OK, record

    match = WEB_FINANCIALS_PATH.fullmatch(route)
    if match and method == "GET":
        force_refresh = str((query.get("refresh") or [""])[0]).lower() in {"1", "true", "yes"}
        try:
            return HTTPStatus.OK, financials_request(match.group("symbol"), force_refresh)
        except (HTTPError, OSError, TimeoutError, ValueError, json.JSONDecodeError) as exc:
            return HTTPStatus.BAD_GATEWAY, {"error": "financials_source_failed", "detail": str(exc)}

    if route == "/market-summary" and data_service and method == "GET":
        region = str((query.get("region") or query.get("market") or ["US"])[0]).upper()
        payload = data_service.market_summary(region)
        return (HTTPStatus.OK, payload) if payload is not None else (HTTPStatus.BAD_REQUEST, {"error": "unsupported_market"})
    if route == "/indices" and data_service and method == "GET":
        region = str((query.get("market") or query.get("region") or ["US"])[0]).upper()
        payload = data_service.market_summary(region) or {"items": []}
        return HTTPStatus.OK, {**payload, "source": "market-collector"}
    if route == "/summary" and data_service and method == "GET":
        return HTTPStatus.OK, data_service.home_overview()
    if route in {"/sectors", "/news", "/earnings", "/taco", "/list-rows", "/exchange-fund-list"}:
        return HTTPStatus.OK, {"items": [], "source": "market-collector", "capability": "local-empty"}
    if _is_web_api_route(route):
        return HTTPStatus.NOT_IMPLEMENTED, {"error": "collector_market_route_missing", "path": route, "detail": "Add this market capability to services/market-collector."}

    return HTTPStatus.NOT_FOUND, {"error": "route_not_found", "path": route}


def build_handler(
    data_dir: Path,
    data_service: MarketDataService | None = None,
    *,
    offline: bool = False,
) -> type[BaseHTTPRequestHandler]:
    class MarketCollectorHandler(BaseHTTPRequestHandler):
        server_version = "market-collector-api/1"
        sys_version = ""

        def do_OPTIONS(self) -> None:
            self.send_response(HTTPStatus.NO_CONTENT)
            self._send_common_headers(0)
            self.end_headers()

        def do_HEAD(self) -> None:
            self._serve(include_body=False)

        def do_GET(self) -> None:
            self._serve(include_body=True)

        def do_POST(self) -> None:
            try:
                content_length = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                content_length = 0
            if content_length > MAX_REQUEST_BODY_BYTES:
                self._send_payload(
                    HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                    {"error": "request_body_too_large"},
                    True,
                )
                return
            try:
                body = json.loads(self.rfile.read(content_length) or b"{}")
            except (json.JSONDecodeError, UnicodeDecodeError):
                self._send_payload(HTTPStatus.BAD_REQUEST, {"error": "invalid_json"}, True)
                return
            self._serve(
                include_body=True,
                method="POST",
                body=body if isinstance(body, dict) else {},
            )

        def _serve(
            self,
            include_body: bool,
            method: str = "GET",
            body: dict[str, Any] | None = None,
        ) -> None:
            status, payload = resolve_request(
                self.path,
                data_dir,
                data_service,
                method=method,
                body=body,
                offline=offline,
            )
            self._send_payload(status, payload, include_body)

        def _send_payload(
            self,
            status: int,
            payload: dict[str, Any],
            include_body: bool,
        ) -> None:
            body = (json.dumps(payload, ensure_ascii=False, sort_keys=True) + "\n").encode("utf-8")
            self.send_response(status)
            self._send_common_headers(len(body))
            self.end_headers()
            if include_body:
                self.wfile.write(body)

        def _send_common_headers(self, content_length: int) -> None:
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(content_length))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")

        def log_message(self, format: str, *args: Any) -> None:
            super().log_message(format, *args)

    return MarketCollectorHandler


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Read-only HTTP API for market collector shadow data.")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=18080)
    parser.add_argument(
        "--data-dir",
        default="/root/ai-dca/services/market-collector/data/shadow",
    )
    parser.add_argument(
        "--database",
        default="/root/ai-dca/services/market-collector/data/market-collector.sqlite3",
    )
    parser.add_argument("--storage-backend", default="sqlite")
    parser.add_argument(
        "--offline",
        action="store_true",
        default=False,
        help="Serve core market routes purely from the local collector cache without the upstream merge.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    from .storage import build_store

    store = build_store({"storage_backend": args.storage_backend, "database_path": args.database})
    store.initialize()
    data_service = MarketDataService(store, args.data_dir)
    server = ThreadingHTTPServer(
        (args.host, args.port),
        build_handler(Path(args.data_dir), data_service, offline=args.offline),
    )
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
