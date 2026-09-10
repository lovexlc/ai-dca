from __future__ import annotations

import json
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from market_collector.aggregates import MarketDataService
from market_collector.http_server import resolve_request
from market_collector.storage import SQLiteStore


# 写死的历史日期会被 write_cycle 的 retention 清理（168h/14d 窗口），
# 改用「昨天」的固定时刻生成时间戳，保证样本永远可读。
RECENT_DAY = (datetime.now(ZoneInfo("Asia/Shanghai")) - timedelta(days=1)).date().isoformat()


def recent(hhmmss: str) -> str:
    return f"{RECENT_DAY}T{hhmmss}+08:00"


def record(collected_at: str, price: float, iopv: float, premium: float) -> dict:
    return {
        "symbol": "513100", "name": "纳指ETF国泰", "session": "trading",
        "collected_at": collected_at, "price_timestamp": collected_at, "iopv_timestamp": collected_at,
        "price": price, "iopv": iopv, "computed_premium_percent": premium,
        "vendor_premium_percent": premium, "mismatch_pp": 0,
        "previous_close": 2.0, "change_percent": 5.0,
        "quality": {"status": "ok", "issues": []},
    }


class RecordingStore:
    backend_name = "recording"

    def __init__(self, records: list[dict]) -> None:
        self.records = records
        self.read_calls: list[tuple[str, str]] = []

    def initialize(self) -> None:
        pass

    def write_cycle(self, records: list[dict], raw_retention_hours: int, bucket_retention_days: int) -> None:
        self.records.extend(records)

    def read_raw_samples(self, symbol: str, session: str = "trading") -> list[dict]:
        self.read_calls.append((symbol, session))
        return [item for item in self.records if item["symbol"] == symbol and item["session"] == session]


class AggregateServiceTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.database = self.root / "market.sqlite3"
        self.data_dir = self.root / "shadow"
        self.data_dir.mkdir()
        self.store = SQLiteStore(str(self.database))
        self.store.initialize()
        self.store.write_cycle([
            record(recent("09:30:05"), 2.10, 2.00, 5.0),
            record(recent("09:34:50"), 2.14, 2.01, 6.4677),
            record(recent("09:35:10"), 2.12, 2.02, 4.9505),
        ], 168, 14)
        (self.data_dir / "latest.json").write_text(json.dumps({
            "generated_at": recent("09:35:10"),
            "symbols": [record(recent("09:35:10"), 2.12, 2.02, 4.9505)],
        }), encoding="utf-8")
        (self.data_dir / "otc-latest.json").write_text(json.dumps({
            "generated_at": "2026-08-11T19:30:00+08:00",
            "items": [{"ok": True, "code": "000834", "fundKind": "qdii", "latestNav": 6.2}],
        }), encoding="utf-8")

        def fetch_json(url: str, _timeout: float) -> dict:
            if "/markets/kline/" in url:
                return {"name": "纳指ETF国泰", "candles": [
                    {"t": 1786291200, "o": 2.00, "c": 2.10, "h": 2.12, "l": 1.98, "v": 1000},
                    {"t": 1786377600, "o": 2.10, "c": 2.12, "h": 2.15, "l": 2.08, "v": 1100},
                ]}
            if "push2his" in url:
                return {"data": {"name": "纳指ETF国泰", "klines": [
                    "2026-08-10,2.00,2.10,2.12,1.98,1000,2100,7.00,5.00,0.10,2.00",
                    "2026-08-11,2.10,2.12,2.15,2.08,1100,2300,3.33,0.95,0.02,2.10",
                ]}}
            return {"items": [
                {"date": "2026-08-07", "nav": 2.0},
                {"date": "2026-08-10", "nav": 2.02},
            ], "generatedAt": "2026-08-11T09:40:00+08:00"}

        def post_json(_url: str, _payload: dict, _timeout: float) -> dict:
            return {"items": [{"code": "513100", "data": {"items": [
                {"date": "2026-08-07", "nav": 2.0},
                {"date": "2026-08-10", "nav": 2.02},
            ]}}]}

        self.service = MarketDataService(
            self.store, self.data_dir, fetch_json=fetch_json, post_json=post_json,
        )

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_intraday_ohlc_and_premium(self) -> None:
        payload = self.service.intraday_klines("513100")
        self.assertEqual(len(payload["candles"]), 2)
        first = payload["candles"][0]
        self.assertEqual(first["o"], 2.1)
        self.assertEqual(first["h"], 2.14)
        self.assertEqual(first["c"], 2.14)
        self.assertEqual(first["premiumClose"], 6.4677)
        self.assertTrue(first["time"].endswith("+08:00"))
        self.assertEqual(payload["source"], "market-collector-sqlite")

    def test_intraday_reads_through_storage_contract(self) -> None:
        store = RecordingStore([
            record("2026-08-11T09:34:50+08:00", 2.14, 2.01, 6.4677),
            record("2026-08-11T09:30:05+08:00", 2.10, 2.00, 5.0),
        ])
        service = MarketDataService(store, self.data_dir)

        payload = service.intraday_klines("513100")

        self.assertEqual(store.read_calls, [("513100", "trading")])
        self.assertEqual(payload["source"], "market-collector-recording")
        self.assertEqual(payload["candles"][0]["o"], 2.1)
        self.assertEqual(payload["candles"][0]["c"], 2.14)

    def test_home_series_uses_latest_day_one_minute_and_complete_groups(self) -> None:
        older = (datetime.fromisoformat(RECENT_DAY) - timedelta(days=1)).date().isoformat()
        old = record(f"{older}T14:59:00+08:00", 1.9, 1.8, 5.5555)
        self.store.write_cycle([old], 168, 14)

        payload = self.service.home_series()

        self.assertEqual(payload["tradingDate"], RECENT_DAY)
        self.assertEqual(payload["bucketMinutes"], 1)
        self.assertEqual(
            [group["key"] for group in payload["groups"]],
            ["all", "nasdaq-100", "sp500", "us-50", "nasdaq-tech"],
        )
        series = next(item for item in payload["modes"]["premium"]["series"] if item["code"] == "513100")
        self.assertEqual(len(series["points"]), 3)
        self.assertTrue(all(point["time"].startswith(RECENT_DAY) for point in series["points"]))
        self.assertEqual(payload["yesterday"]["tradingDate"], older)
        self.assertEqual(payload["yesterday"]["premiumMedianPercent"], 5.5555)

    def test_daily_combines_price_nav_and_t_minus_one_premium(self) -> None:
        payload = self.service.daily_combined("513100", 10)
        self.assertEqual(len(payload["candles"]), 2)
        self.assertEqual(payload["candles"][1]["navDate"], "2026-08-10")
        self.assertEqual(payload["candles"][1]["premiumPercent"], 4.9505)
        self.assertEqual(len(payload["navCandles"]), 2)

    def test_rest_and_cloudbase_dataset_routes(self) -> None:
        status, payload = resolve_request("/klines/513100?interval=5m", self.data_dir, self.service)
        self.assertEqual(status, 200)
        self.assertEqual(payload["interval"], "5m")

        status, record_payload = resolve_request("/datasets/kline/513100%3A1d", self.data_dir, self.service)
        self.assertEqual(status, 200)
        self.assertEqual(record_payload["_id"], "kline:513100:1d")
        self.assertEqual(record_payload["payload"]["interval"], "1d")

        status, metric_record = resolve_request("/datasets/fund-metric/513100", self.data_dir, self.service)
        self.assertEqual(status, 200)
        self.assertEqual(metric_record["payload"]["latestNav"], 2.02)
        self.assertEqual(metric_record["payload"]["previousNav"], 2.0)

        status, otc = resolve_request("/symbols/000834", self.data_dir, self.service)
        self.assertEqual(status, 200)
        self.assertEqual(otc["latestNav"], 6.2)

        status, otc_snapshot = resolve_request("/otc/latest", self.data_dir, self.service)
        self.assertEqual(status, 200)
        self.assertEqual(len(otc_snapshot["items"]), 1)


if __name__ == "__main__":
    unittest.main()
