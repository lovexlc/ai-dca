#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import math
import sys
import time
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import akshare as ak

SHANGHAI_TZ = ZoneInfo("Asia/Shanghai")
BENCHMARK_CODE = "nas-daq100"
BENCHMARK_NAME = "NASDAQ 100 Index"
BENCHMARK_CURRENCY = "$"
BENCHMARK_SYMBOL = "^NDX"
DEFAULT_SOURCE_CANDIDATES = [
    Path("data/all_nasdq.json"),
    Path("data/all_nasdaq.json"),
    Path("data/all_qdii.json"),
]
NUMERIC_FIELDS = {
    "开盘": "open",
    "收盘": "close",
    "最高": "high",
    "最低": "low",
    "成交量": "volume",
    "成交额": "amount",
    "均价": "avg_price",
    "振幅": "amplitude",
    "涨跌幅": "pct_change",
    "涨跌额": "change",
    "换手率": "turnover_rate",
}

SINA_NUMERIC_FIELDS = {
    "open": "open",
    "close": "close",
    "high": "high",
    "low": "low",
    "volume": "volume",
    "amount": "amount",
}


@dataclass(frozen=True)
class Fund:
    code: str
    name: str
    index_key: str = "nasdaq100"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Fetch Nasdaq ETF 1-minute bars from Sina via AkShare and store them under data/{fund_code}/{date}.json."
    )
    parser.add_argument("--source-file", type=Path, help="Optional JSON file that contains the Nasdaq ETF list.")
    parser.add_argument("--output-dir", type=Path, default=Path("data"), help="Root output directory.")
    parser.add_argument(
        "--target-date",
        default=datetime.now(SHANGHAI_TZ).date().isoformat(),
        help="Target trading date in Asia/Shanghai, format: YYYY-MM-DD.",
    )
    parser.add_argument("--period", default="1", help="Minute period for AkShare, defaults to 1.")
    parser.add_argument("--adjust", default="", help="AkShare adjust argument, defaults to empty string.")
    parser.add_argument("--sleep-seconds", type=float, default=0.3, help="Delay between upstream requests.")
    parser.add_argument("--max-retries", type=int, default=3, help="Maximum retries for a single fund request.")
    parser.add_argument("--retry-delay", type=float, default=1.0, help="Base retry delay in seconds.")
    parser.add_argument("--skip-existing", action="store_true", help="Skip files that already exist for the target date.")
    return parser.parse_args()


def parse_target_date(raw_value: str) -> str:
    return date.fromisoformat(raw_value).isoformat()


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def resolve_source_file(explicit_path: Path | None) -> Path:
    if explicit_path:
        if not explicit_path.exists():
            raise FileNotFoundError(f"Source file not found: {explicit_path}")
        return explicit_path

    for candidate in DEFAULT_SOURCE_CANDIDATES:
        if candidate.exists():
            return candidate

    raise FileNotFoundError("No source file found. Expected one of: data/all_nasdq.json, data/all_nasdaq.json, data/all_qdii.json")


def dedupe_funds(funds: list[Fund]) -> list[Fund]:
    seen: set[str] = set()
    unique: list[Fund] = []
    for fund in funds:
        if fund.code in seen:
            continue
        seen.add(fund.code)
        unique.append(fund)
    return unique


def extract_funds(payload: Any) -> list[Fund]:
    if isinstance(payload, list):
        funds = []
        for item in payload:
            if isinstance(item, str):
                funds.append(Fund(code=item.strip(), name=item.strip()))
            elif isinstance(item, dict):
                funds.append(
                    Fund(
                        code=str(item.get("code", "")).strip(),
                        name=str(item.get("name", item.get("code", ""))).strip(),
                        index_key=str(item.get("index_key", "nasdaq100")).strip() or "nasdaq100",
                    )
                )
        return dedupe_funds([fund for fund in funds if fund.code])

    if not isinstance(payload, dict):
        raise ValueError("Unsupported source payload.")

    dataset = str(payload.get("dataset", "")).strip()
    raw_etfs = payload.get("etfs") or payload.get("funds") or []

    if dataset == "all_qdii":
        raw_etfs = [item for item in raw_etfs if str(item.get("index_key", "")).strip() == "nasdaq100"]

    funds = [
        Fund(
            code=str(item.get("code", "")).strip(),
            name=str(item.get("name", item.get("code", ""))).strip(),
            index_key=str(item.get("index_key", "nasdaq100")).strip() or "nasdaq100",
        )
        for item in raw_etfs
        if isinstance(item, dict)
    ]
    return dedupe_funds([fund for fund in funds if fund.code])


def load_funds(explicit_path: Path | None) -> tuple[Path, list[Fund]]:
    source_path = resolve_source_file(explicit_path)
    funds = extract_funds(read_json(source_path))
    if not funds:
        raise ValueError(f"No funds found in {source_path}")
    return source_path, funds


def coerce_number(value: Any) -> int | float | None:
    if value is None:
        return None

    if isinstance(value, bool):
        return int(value)

    if isinstance(value, (int, float)):
        if isinstance(value, float) and math.isnan(value):
            return None
        return int(value) if float(value).is_integer() else float(value)

    text = str(value).strip().replace(",", "").replace("%", "")
    if not text:
        return None

    number = float(text)
    return int(number) if number.is_integer() else number


def normalize_datetime(raw_value: Any, target_date: str) -> str:
    text = str(raw_value or "").strip()
    if not text:
        return ""

    if len(text) == 5 and text.count(":") == 1:
        return f"{target_date} {text}:00"

    if len(text) == 8 and text.count(":") == 2:
        return f"{target_date} {text}"

    return text.replace("/", "-")


def normalize_records(records: list[dict[str, Any]], target_date: str) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []

    for row in records:
        bar_time = normalize_datetime(row.get("时间") or row.get("datetime") or row.get("date"), target_date)
        if not bar_time or not bar_time.startswith(target_date):
            continue

        bar: dict[str, Any] = {"datetime": bar_time}
        for source_name, output_name in NUMERIC_FIELDS.items():
            if source_name not in row:
                continue
            parsed = coerce_number(row.get(source_name))
            if parsed is not None:
                bar[output_name] = parsed

        normalized.append(bar)

    return normalized


def normalize_sina_records(records: list[dict[str, Any]], target_date: str) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []

    for row in records:
        bar_time = normalize_datetime(row.get("day") or row.get("datetime") or row.get("date"), target_date)
        if not bar_time or not bar_time.startswith(target_date):
            continue

        bar: dict[str, Any] = {"datetime": bar_time}
        for source_name, output_name in SINA_NUMERIC_FIELDS.items():
            parsed = coerce_number(row.get(source_name))
            if parsed is not None:
                bar[output_name] = parsed

        amount = coerce_number(bar.get("amount"))
        volume = coerce_number(bar.get("volume"))
        if amount is not None and volume not in (None, 0):
            avg_price = round(float(amount) / float(volume), 6)
            bar["avg_price"] = int(avg_price) if float(avg_price).is_integer() else avg_price

        normalized.append(bar)

    return normalized


def to_sina_symbol(fund_code: str) -> str:
    code = str(fund_code).strip()
    if not code:
        raise ValueError("Fund code is required.")

    if code.startswith(("5", "6", "9")):
        return f"sh{code}"

    return f"sz{code}"


def fetch_minute_bars(fund: Fund, target_date: str, period: str, adjust: str) -> list[dict[str, Any]]:
    frame = ak.stock_zh_a_minute(
        symbol=to_sina_symbol(fund.code),
        period=period,
        adjust=adjust,
    )

    if frame is None or frame.empty:
        return []

    return normalize_sina_records(frame.to_dict(orient="records"), target_date)


def fetch_minute_bars_with_retry(
    fund: Fund,
    target_date: str,
    period: str,
    adjust: str,
    max_retries: int,
    retry_delay: float,
) -> list[dict[str, Any]]:
    attempts = max(1, max_retries)
    last_error: Exception | None = None

    for attempt in range(1, attempts + 1):
        try:
            return fetch_minute_bars(fund, target_date, period, adjust)
        except Exception as exc:  # pragma: no cover - network/runtime failure path
            last_error = exc
            if attempt >= attempts:
                break

            sleep_seconds = max(retry_delay, 0) * attempt
            print(
                f"  retry {attempt}/{attempts - 1} for {fund.code} after error: {exc}. "
                f"Sleeping {sleep_seconds:.1f}s...",
                file=sys.stderr,
            )
            if sleep_seconds > 0:
                time.sleep(sleep_seconds)

    assert last_error is not None
    raise last_error


def write_output(output_root: Path, fund: Fund, target_date: str, source_path: Path, period: str, adjust: str, bars: list[dict[str, Any]]) -> Path:
    fund_dir = output_root / fund.code
    fund_dir.mkdir(parents=True, exist_ok=True)
    output_path = fund_dir / f"{target_date}.json"
    payload = {
        "dataset": "nasdaq_etf_minute",
        "fund_code": fund.code,
        "fund_name": fund.name,
        "index_key": fund.index_key,
        "date": target_date,
        "period": period,
        "adjust": adjust,
        "timezone": "Asia/Shanghai",
        "source": "akshare.stock_zh_a_minute",
        "fund_list_source": source_path.as_posix(),
        "generated_at": datetime.now(SHANGHAI_TZ).isoformat(),
        "bars": bars,
    }
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return output_path


def build_output_path(output_root: Path, fund_code: str, target_date: str) -> Path:
    return output_root / fund_code / f"{target_date}.json"


def load_latest_snapshot(output_path: Path) -> dict[str, Any] | None:
    payload = read_json(output_path)
    bars = payload.get("bars") or []
    if not bars:
        return None

    last_bar = bars[-1]
    current_price = coerce_number(last_bar.get("close") or last_bar.get("收盘") or last_bar.get("open") or last_bar.get("开盘"))
    if current_price is None:
        return None

    return {
        "code": str(payload.get("fund_code", "")).strip(),
        "name": str(payload.get("fund_name", "")).strip(),
        "index_key": str(payload.get("index_key", "nasdaq100")).strip() or "nasdaq100",
        "date": str(payload.get("date", output_path.stem)).strip(),
        "datetime": str(last_bar.get("datetime") or last_bar.get("时间") or payload.get("date", output_path.stem)).strip(),
        "current_price": current_price,
        "output_path": output_path.as_posix(),
    }


def build_benchmark_snapshot(output_root: Path) -> dict[str, Any] | None:
    benchmark_dir = output_root / BENCHMARK_CODE
    minute_path = benchmark_dir / "intraday-1m.json"

    if not minute_path.exists():
        return None

    snapshot = load_latest_snapshot(minute_path)
    if not snapshot:
        return None

    fifteen_path = benchmark_dir / "intraday-15m.json"
    daily_path = benchmark_dir / "daily-sina.json"
    return {
        **snapshot,
        "name": snapshot.get("name") or BENCHMARK_NAME,
        "currency": BENCHMARK_CURRENCY,
        "output_path": minute_path.as_posix(),
        "output_path_15m": fifteen_path.as_posix() if fifteen_path.exists() else "",
        "daily_output_path": daily_path.as_posix() if daily_path.exists() else "",
        "source_symbol": BENCHMARK_SYMBOL,
    }


def write_latest_price_manifest(output_root: Path, source_path: Path, funds: list[Fund]) -> Path:
    snapshots: list[dict[str, Any]] = []

    for fund in funds:
        fund_dir = output_root / fund.code
        if not fund_dir.exists():
            continue

        candidates = sorted(path for path in fund_dir.glob("*.json") if path.is_file())
        if not candidates:
            continue

        snapshot = load_latest_snapshot(candidates[-1])
        if snapshot:
            snapshots.append(snapshot)

    benchmark_snapshot = build_benchmark_snapshot(output_root)
    if benchmark_snapshot:
        snapshots = [item for item in snapshots if item["code"] != BENCHMARK_CODE]
        snapshots.append(benchmark_snapshot)

    snapshots.sort(key=lambda item: (0 if item["code"] == BENCHMARK_CODE else 1, item["code"]))
    manifest = {
        "dataset": "nasdaq_latest_prices",
        "generated_at": datetime.now(SHANGHAI_TZ).isoformat(),
        "fund_list_source": source_path.as_posix(),
        "count": len(snapshots),
        "funds": snapshots,
        "by_code": {item["code"]: item for item in snapshots},
    }

    manifest_path = output_root / "nasdaq_latest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return manifest_path


def main() -> int:
    args = parse_args()
    target_date = parse_target_date(args.target_date)
    source_path, funds = load_funds(args.source_file)

    print(f"Using fund list: {source_path}")
    print(f"Target date: {target_date}")
    print(f"Funds: {len(funds)}")

    ready_files: list[Path] = []
    new_files = 0
    warnings: list[str] = []

    for index, fund in enumerate(funds, start=1):
        print(f"[{index}/{len(funds)}] Fetching {fund.code} {fund.name}")
        output_path = build_output_path(args.output_dir, fund.code, target_date)
        if args.skip_existing and output_path.exists():
            print(f"  skip existing file -> {output_path}")
            ready_files.append(output_path)
            continue

        try:
            bars = fetch_minute_bars_with_retry(
                fund=fund,
                target_date=target_date,
                period=args.period,
                adjust=args.adjust,
                max_retries=args.max_retries,
                retry_delay=args.retry_delay,
            )
        except Exception as exc:  # pragma: no cover - network/runtime failure path
            warnings.append(f"{fund.code}: {exc}")
            print(f"  warning: {fund.code} fetch failed: {exc}", file=sys.stderr)
            continue

        if not bars:
            print(f"  no bars returned for {fund.code} on {target_date}")
        else:
            output_path = write_output(args.output_dir, fund, target_date, source_path, args.period, args.adjust, bars)
            ready_files.append(output_path)
            new_files += 1
            print(f"  wrote {len(bars)} bars -> {output_path}")

        if args.sleep_seconds > 0 and index < len(funds):
            time.sleep(args.sleep_seconds)

    manifest_path = write_latest_price_manifest(args.output_dir, source_path, funds)
    summary = {
        "target_date": target_date,
        "new_files": new_files,
        "ready_files": len(ready_files),
        "manifest_path": manifest_path.as_posix(),
        "warnings": warnings,
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))

    if not ready_files and warnings:
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
