from __future__ import annotations

import argparse
import sys

from .core import MarketCollector, load_config


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Shadow market collector for CN ETF price and IOPV data.")
    parser.add_argument("--root", default="services/market-collector", help="Package root directory.")
    parser.add_argument("--config", help="Optional JSON config path.")
    parser.add_argument("--once", action="store_true", help="Run one collection cycle and exit.")
    parser.add_argument(
        "--fund-reference-once",
        action="store_true",
        help="Fetch and store one fee/limit snapshot, then exit.",
    )
    parser.add_argument(
        "--history-close-once",
        action="store_true",
        help="Backfill real daily close prices into fund_history, then exit.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    config = load_config(args.root, args.config)
    collector = MarketCollector(config)
    if args.fund_reference_once:
        collector.collect_fund_references_once()
        return 0
    if args.history_close_once:
        n = collector._publish_history_close(limit=3000)
        print(f"[history-close] upserted {n} rows", flush=True)
        return 0
    if args.once:
        collector.collect_once()
        return 0
    collector.run_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
