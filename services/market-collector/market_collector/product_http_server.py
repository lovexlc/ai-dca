"""HTTP entry point that serves quote metrics from local snapshot files."""
from __future__ import annotations

import argparse
from http.server import ThreadingHTTPServer
from pathlib import Path

from .aggregates import MarketDataService
from .http_server import build_handler
from .storage import build_store


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
    server = ThreadingHTTPServer(
        (args.host, args.port),
        build_handler(Path(args.data_dir), data_service, offline=args.offline),
    )
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
