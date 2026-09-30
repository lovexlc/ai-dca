"""HTTP entry point that serves quote metrics from local snapshot files."""
from __future__ import annotations

import argparse
import json
import os
import threading
from http.server import ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .aggregates import MarketDataService
from .http_server import MarketQuotesRequest, build_handler
from .storage import build_store
from .xueqiu import DEFAULT_XUEQIU_WORKER_URL, fetch_xueqiu_fund_data


def _xueqiu_request_from_config(config_path: str):
    settings: dict[str, Any] = {}
    try:
        payload = json.loads(Path(config_path).read_text(encoding="utf-8"))
        if isinstance(payload, dict) and isinstance(payload.get("xueqiu"), dict):
            settings = payload["xueqiu"]
    except (FileNotFoundError, OSError, json.JSONDecodeError):
        pass

    cookie_env = str(settings.get("cookie_env") or "XUEQIU_COOKIE").strip() or "XUEQIU_COOKIE"
    cookie = os.getenv(cookie_env, "").strip()
    cookie_file = str(settings.get("cookie_file") or os.getenv("XUEQIU_COOKIE_FILE", "")).strip()
    if not cookie and cookie_file:
        try:
            cookie = Path(cookie_file).read_text(encoding="utf-8").strip()
        except (FileNotFoundError, OSError):
            cookie = ""
    if not cookie:
        cookie = str(settings.get("cookie") or "").strip()

    if "worker_url" in settings:
        worker_url = str(settings.get("worker_url") or "").strip()
    else:
        worker_url = os.getenv("XUEQIU_WORKER_URL", DEFAULT_XUEQIU_WORKER_URL).strip()
    try:
        timeout_sec = max(1.0, min(float(settings.get("request_timeout_sec", 6.0)), 30.0))
    except (TypeError, ValueError):
        timeout_sec = 6.0
    try:
        max_concurrency = max(1, min(int(settings.get("concurrency", 4)), 4))
    except (TypeError, ValueError):
        max_concurrency = 4
    try:
        cache_ttl_sec = max(0, int(settings.get("cache_ttl_sec", 1800)))
    except (TypeError, ValueError):
        cache_ttl_sec = 1800

    def request(symbol: str, force_refresh: bool = False, include_raw: bool = False) -> dict[str, Any]:
        return fetch_xueqiu_fund_data(
            symbol,
            cookie=cookie,
            include_raw=include_raw,
            force_refresh=force_refresh,
            worker_url=worker_url,
            timeout_sec=timeout_sec,
            max_concurrency=max_concurrency,
            cache_ttl_sec=cache_ttl_sec,
        )

    return request

_MARKET_QUOTES_REQUEST_SLOTS = threading.BoundedSemaphore(4)


def _fetch_fundmob_premiums(symbols: list[str], timeout_sec: float = 8.0) -> dict[str, dict[str, Any]]:
    """fundmobapi fallback: fetch ZJL premium for symbols missing premium."""
    if not symbols:
        return {}
    try:
        from urllib.parse import urlencode as _urlencode
        params = _urlencode({
            "pageIndex": "1",
            "pageSize": str(len(symbols)),
            "plat": "Android",
            "appType": "ttjj",
            "product": "EFund",
            "Version": "1",
            "deviceid": "ai-dca-cn-host",
            "Fcodes": ",".join(symbols),
        })
        url = "https://fundmobapi.eastmoney.com/FundMNewApi/FundMNFInfo?" + params
        req = Request(url, method="GET", headers={
            "user-agent": "Mozilla/5.0 (Linux; Android 10; Mobile) AppleWebKit/537.36",
            "referer": "https://fund.eastmoney.com/",
            "accept": "application/json",
        })
        with urlopen(req, timeout=timeout_sec) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        result = {}
        for item in data.get("Datas", []) or []:
            code = str(item.get("FCODE", "")).strip()
            if not code:
                continue
            try:
                zjl = float(item.get("ZJL"))
                premium = round(-zjl, 2)
            except (TypeError, ValueError):
                premium = None
            try:
                nav = float(item.get("NAV"))
                nav = nav if nav > 0 else None
            except (TypeError, ValueError):
                nav = None
            result[code] = {"premiumPercent": premium, "latestNav": nav}
        return result
    except Exception:
        return {}


def _market_quotes_request_from_config(config_path: str) -> MarketQuotesRequest:
    payload: dict[str, Any] = {}
    try:
        loaded = json.loads(Path(config_path).read_text(encoding="utf-8"))
        if isinstance(loaded, dict):
            payload = loaded
    except (FileNotFoundError, OSError, json.JSONDecodeError):
        pass

    market_settings = payload.get("market_api") if isinstance(payload.get("market_api"), dict) else {}
    xueqiu_settings = payload.get("xueqiu") if isinstance(payload.get("xueqiu"), dict) else {}
    if "worker_url" in market_settings:
        worker_url = str(market_settings.get("worker_url") or "").strip()
    elif "worker_url" in xueqiu_settings:
        worker_url = str(xueqiu_settings.get("worker_url") or "").strip()
    else:
        worker_url = os.getenv("MARKETS_WORKER_URL", DEFAULT_XUEQIU_WORKER_URL).strip()
    try:
        timeout_sec = max(1.0, min(float(
            market_settings.get("request_timeout_sec", xueqiu_settings.get("request_timeout_sec", 6.0))
        ), 30.0))
    except (TypeError, ValueError):
        timeout_sec = 6.0

    def request(symbols: list[str]) -> dict[str, Any]:
        if not worker_url:
            return {}
        quotes: dict[str, Any] = {}
        for offset in range(0, len(symbols), 60):
            batch = symbols[offset:offset + 60]
            if not batch:
                continue
            query = urlencode({"symbols": ",".join(batch)})
            url = worker_url.rstrip("/") + "/quotes?" + query
            upstream_request = Request(url, method="GET", headers={
                "accept": "application/json",
                # Cloudflare 1010 会按浏览器签名拦截默认的 Python-urllib UA
                "user-agent": "ai-dca-market-collector/1.0",
            })
            with _MARKET_QUOTES_REQUEST_SLOTS:
                with urlopen(upstream_request, timeout=timeout_sec) as response:
                    result = json.loads(response.read().decode("utf-8"))
            quote_map = result.get("quotes") if isinstance(result, dict) else None
            if isinstance(quote_map, dict):
                quotes.update(quote_map)
        # fundmobapi fallback: fill missing premiumPercent
        try:
            missing = [s for s in symbols if not (quotes.get(s) or {}).get("premiumPercent")]
            if missing:
                premiums = _fetch_fundmob_premiums(missing, timeout_sec=min(timeout_sec, 8.0))
                for sym in missing:
                    # symbols may have sh/sz prefix; try both
                    digits = sym[-6:] if len(sym) >= 6 else sym
                    pm = premiums.get(digits) or premiums.get(sym)
                    if pm and pm.get("premiumPercent") is not None:
                        q = quotes.get(sym) or {}
                        q["premiumPercent"] = pm["premiumPercent"]
                        q["vendorPremiumPercent"] = pm["premiumPercent"]
                        if pm.get("latestNav") and not q.get("latestNav"):
                            q["latestNav"] = pm["latestNav"]
                        # clear the missing premium issue flag if present
                        quality = q.get("quality")
                        if isinstance(quality, dict):
                            issues = quality.get("issues")
                            if isinstance(issues, list):
                                quality["issues"] = [i for i in issues if i not in ("missing_iopv", "missing_vendor_premium")]
                        quotes[sym] = q
        except Exception:
            pass
        return quotes

    return request


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Read-only market collector API backed by local snapshots."
    )
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
    parser.add_argument("--config", required=True)
    parser.add_argument("--offline", action="store_true", default=False)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    store = build_store({
        "storage_backend": args.storage_backend,
        "database_path": args.database,
    })
    store.initialize()
    data_service = MarketDataService(store, args.data_dir)
    xueqiu_request = _xueqiu_request_from_config(args.config)
    market_quotes_request = _market_quotes_request_from_config(args.config)
    server = ThreadingHTTPServer(
        (args.host, args.port),
        build_handler(
            Path(args.data_dir),
            data_service,
            xueqiu_request=xueqiu_request,
            market_quotes_request=market_quotes_request,
            offline=args.offline,
        ),
    )
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
