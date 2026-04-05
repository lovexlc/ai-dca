#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import math
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

BENCHMARK_CODE = "nas-daq100"
BENCHMARK_NAME = "NASDAQ 100 Index"
BENCHMARK_SYMBOL = "^NDX"
BENCHMARK_CURRENCY = "$"
INDEX_KEY = "nasdaq100"
USER_AGENT = "Mozilla/5.0"


def utc_now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Fetch Nasdaq 100 benchmark bars from Yahoo chart API and merge them into data/nasdaq_latest.json."
    )
    parser.add_argument("--output-dir", type=Path, default=Path("data"), help="Root output directory.")
    parser.add_argument("--daily-range", default="2y", help="Yahoo range for daily bars. Default: 2y.")
    parser.add_argument("--daily-interval", default="1d", help="Yahoo interval for daily bars. Default: 1d.")
    parser.add_argument("--minute-range", default="7d", help="Yahoo range for 1-minute bars. Default: 7d.")
    parser.add_argument("--minute-interval", default="1m", help="Yahoo interval for 1-minute bars. Default: 1m.")
    parser.add_argument("--fifteen-range", default="60d", help="Yahoo range for 15-minute bars. Default: 60d.")
    parser.add_argument("--fifteen-interval", default="15m", help="Yahoo interval for 15-minute bars. Default: 15m.")
    return parser.parse_args()


def chart_url(symbol: str, interval: str, range_value: str) -> str:
    quoted_symbol = quote(symbol, safe="")
    return (
        f"https://query1.finance.yahoo.com/v8/finance/chart/{quoted_symbol}"
        f"?interval={interval}&range={range_value}&includePrePost=false&events=div%2Csplits"
    )


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def to_number(value: Any) -> float | int | None:
    if value is None:
        return None

    if isinstance(value, bool):
        return int(value)

    try:
        number = float(value)
    except (TypeError, ValueError):
        return None

    if math.isnan(number) or math.isinf(number):
        return None

    return int(number) if number.is_integer() else number


def fetch_chart(symbol: str, interval: str, range_value: str) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    request = Request(chart_url(symbol, interval, range_value), headers={"User-Agent": USER_AGENT})
    with urlopen(request, timeout=30) as response:  # noqa: S310
        payload = json.load(response)

    chart = payload.get("chart") or {}
    errors = chart.get("error")
    if errors:
        raise RuntimeError(str(errors))

    result = (chart.get("result") or [None])[0]
    if not result:
        raise RuntimeError("Yahoo chart response missing result.")

    meta = result.get("meta") or {}
    timezone_name = meta.get("exchangeTimezoneName") or "America/New_York"
    timezone = ZoneInfo(timezone_name)
    timestamps = result.get("timestamp") or []
    quote = ((result.get("indicators") or {}).get("quote") or [{}])[0]

    rows: list[dict[str, Any]] = []
    for index, raw_timestamp in enumerate(timestamps):
      try:
        timestamp = int(raw_timestamp)
      except (TypeError, ValueError):
        continue

      bar_time = datetime.fromtimestamp(timestamp, tz=timezone)
      open_price = to_number((quote.get("open") or [None])[index] if index < len(quote.get("open") or []) else None)
      close_price = to_number((quote.get("close") or [None])[index] if index < len(quote.get("close") or []) else None)
      high_price = to_number((quote.get("high") or [None])[index] if index < len(quote.get("high") or []) else None)
      low_price = to_number((quote.get("low") or [None])[index] if index < len(quote.get("low") or []) else None)
      volume = to_number((quote.get("volume") or [None])[index] if index < len(quote.get("volume") or []) else None)

      if not any(value is not None for value in (open_price, close_price, high_price, low_price)):
        continue

      rows.append(
        {
          "datetime": bar_time.strftime("%Y-%m-%d %H:%M:%S"),
          "date": bar_time.date().isoformat(),
          "open": open_price if open_price is not None else close_price,
          "close": close_price if close_price is not None else open_price,
          "high": high_price if high_price is not None else max(value for value in (open_price, close_price) if value is not None),
          "low": low_price if low_price is not None else min(value for value in (open_price, close_price) if value is not None),
          "volume": volume if volume is not None else 0,
        }
      )

    if not rows:
        raise RuntimeError(f"No bars returned for {symbol} {interval} {range_value}.")

    return meta, rows


def build_daily_payload(meta: dict[str, Any], rows: list[dict[str, Any]], requested_range: str, requested_interval: str) -> dict[str, Any]:
    bars = [
        {
            "date": row["date"],
            "open": row["open"],
            "close": row["close"],
            "high": row["high"],
            "low": row["low"],
            "volume": row["volume"],
        }
        for row in rows
    ]

    return {
        "dataset": "nasdaq100_index_daily_yahoo",
        "fund_code": BENCHMARK_CODE,
        "fund_name": BENCHMARK_NAME,
        "index_key": INDEX_KEY,
        "currency": BENCHMARK_CURRENCY,
        "range": {
            "start_date": bars[0]["date"],
            "end_date": bars[-1]["date"],
            "requested_range": requested_range,
            "requested_interval": requested_interval,
        },
        "requested_bars": len(bars),
        "source": "yahoo:chart",
        "source_symbol": BENCHMARK_SYMBOL,
        "timezone": meta.get("exchangeTimezoneName") or "America/New_York",
        "generated_at": utc_now_iso(),
        "bars": bars,
    }


def build_intraday_payload(meta: dict[str, Any], rows: list[dict[str, Any]], requested_range: str, requested_interval: str) -> dict[str, Any]:
    bars = [
        {
            "datetime": row["datetime"],
            "open": row["open"],
            "close": row["close"],
            "high": row["high"],
            "low": row["low"],
            "volume": row["volume"],
        }
        for row in rows
    ]

    latest_bar = bars[-1]
    return {
        "dataset": "nasdaq100_index_intraday_yahoo",
        "fund_code": BENCHMARK_CODE,
        "fund_name": BENCHMARK_NAME,
        "index_key": INDEX_KEY,
        "currency": BENCHMARK_CURRENCY,
        "date": latest_bar["datetime"][:10],
        "period": requested_interval,
        "range": requested_range,
        "timezone": meta.get("exchangeTimezoneName") or "America/New_York",
        "source": "yahoo:chart",
        "source_symbol": BENCHMARK_SYMBOL,
        "generated_at": utc_now_iso(),
        "bars": bars,
    }


def merge_latest_manifest(output_root: Path, minute_payload: dict[str, Any], fifteen_path: Path, daily_path: Path) -> Path:
    manifest_path = output_root / "nasdaq_latest.json"
    manifest = read_json(manifest_path) if manifest_path.exists() else {
        "dataset": "nasdaq_latest_prices",
        "generated_at": utc_now_iso(),
        "fund_list_source": "data/all_nasdq.json",
        "count": 0,
        "funds": [],
        "by_code": {},
    }

    funds = [item for item in (manifest.get("funds") or []) if str(item.get("code") or "").strip() != BENCHMARK_CODE]
    latest_bar = (minute_payload.get("bars") or [])[-1]
    benchmark_entry = {
        "code": BENCHMARK_CODE,
        "name": BENCHMARK_NAME,
        "index_key": INDEX_KEY,
        "currency": BENCHMARK_CURRENCY,
        "date": minute_payload.get("date") or str(latest_bar.get("datetime", ""))[:10],
        "datetime": latest_bar.get("datetime") or minute_payload.get("date") or "",
        "current_price": latest_bar.get("close") or latest_bar.get("open") or 0,
        "output_path": f"data/{BENCHMARK_CODE}/intraday-1m.json",
        "output_path_15m": fifteen_path.as_posix(),
        "daily_output_path": daily_path.as_posix(),
        "source_symbol": BENCHMARK_SYMBOL,
    }
    funds.append(benchmark_entry)

    def sort_key(item: dict[str, Any]) -> tuple[int, str]:
        code = str(item.get("code") or "")
        return (0 if code == BENCHMARK_CODE else 1, code)

    funds.sort(key=sort_key)
    manifest["generated_at"] = utc_now_iso()
    manifest["count"] = len(funds)
    manifest["funds"] = funds
    manifest["by_code"] = {item["code"]: item for item in funds if item.get("code")}
    write_json(manifest_path, manifest)
    return manifest_path


def main() -> int:
    args = parse_args()
    output_root = args.output_dir
    benchmark_dir = output_root / BENCHMARK_CODE

    daily_meta, daily_rows = fetch_chart(BENCHMARK_SYMBOL, args.daily_interval, args.daily_range)
    minute_meta, minute_rows = fetch_chart(BENCHMARK_SYMBOL, args.minute_interval, args.minute_range)
    fifteen_meta, fifteen_rows = fetch_chart(BENCHMARK_SYMBOL, args.fifteen_interval, args.fifteen_range)

    daily_path = benchmark_dir / "daily-sina.json"
    minute_path = benchmark_dir / "intraday-1m.json"
    fifteen_path = benchmark_dir / "intraday-15m.json"

    daily_payload = build_daily_payload(daily_meta, daily_rows, args.daily_range, args.daily_interval)
    minute_payload = build_intraday_payload(minute_meta, minute_rows, args.minute_range, args.minute_interval)
    fifteen_payload = build_intraday_payload(fifteen_meta, fifteen_rows, args.fifteen_range, args.fifteen_interval)

    write_json(daily_path, daily_payload)
    write_json(minute_path, minute_payload)
    write_json(fifteen_path, fifteen_payload)
    manifest_path = merge_latest_manifest(output_root, minute_payload, fifteen_path, daily_path)

    print(
        json.dumps(
            {
                "benchmark_code": BENCHMARK_CODE,
                "daily_bars": len(daily_payload["bars"]),
                "minute_bars": len(minute_payload["bars"]),
                "fifteen_minute_bars": len(fifteen_payload["bars"]),
                "daily_path": daily_path.as_posix(),
                "minute_path": minute_path.as_posix(),
                "fifteen_path": fifteen_path.as_posix(),
                "manifest_path": manifest_path.as_posix(),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
