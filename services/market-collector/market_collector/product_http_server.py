"""HTTP entry point that serves quote metrics from local snapshot files."""
from __future__ import annotations

import argparse
import json
import os
from http.server import ThreadingHTTPServer
from pathlib import Path
from typing import Any

from .aggregates import MarketDataService
from .http_server import build_handler
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
    server = ThreadingHTTPServer(
        (args.host, args.port),
        build_handler(
            Path(args.data_dir),
            data_service,
            xueqiu_request=xueqiu_request,
            offline=args.offline,
        ),
    )
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
