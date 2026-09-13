from __future__ import annotations

import json
import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from market_collector.aggregates import MarketDataService, TimedCache, UpstreamCircuitOpen
from market_collector.calendar_cn import quote_snapshot_cache_ttl
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

    def test_quotes_load_local_snapshot_once_for_a_batch(self) -> None:
        exchange_calls = 0
        otc_calls = 0
        original_exchange = self.service._load_exchange_quote_map
        original_otc = self.service._load_otc_quote_map

        def counted_exchange_load():
            nonlocal exchange_calls
            exchange_calls += 1
            return original_exchange()

        def counted_otc_load():
            nonlocal otc_calls
            otc_calls += 1
            return original_otc()

        self.service._load_exchange_quote_map = counted_exchange_load
        self.service._load_otc_quote_map = counted_otc_load
        quotes = self.service.quotes(["513100", "000834", "513100"])

        self.assertEqual(set(quotes), {"513100", "000834"})
        self.assertEqual(exchange_calls, 1)
        self.assertEqual(otc_calls, 1)

    def test_quote_snapshot_cache_ttl_tracks_a_share_sessions(self) -> None:
        tz = ZoneInfo("Asia/Shanghai")
        self.assertEqual(quote_snapshot_cache_ttl(datetime(2026, 9, 14, 10, 0, tzinfo=tz)), 2)
        self.assertEqual(quote_snapshot_cache_ttl(datetime(2026, 9, 14, 12, 0, tzinfo=tz)), 59 * 60)
        self.assertEqual(quote_snapshot_cache_ttl(datetime(2026, 9, 18, 15, 1, tzinfo=tz)), 66 * 3600 + 28 * 60)

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

    def test_timed_cache_coalesces_concurrent_loads(self) -> None:
        cache = TimedCache()
        calls = 0
        calls_lock = threading.Lock()

        def loader():
            nonlocal calls
            with calls_lock:
                calls += 1
            time.sleep(0.05)
            return {"value": 1}

        with ThreadPoolExecutor(max_workers=8) as executor:
            values = list(executor.map(lambda _index: cache.get_or_load("same", 60, loader), range(8)))

        self.assertEqual(calls, 1)
        self.assertTrue(all(value == {"value": 1} for value in values))

    def test_timed_cache_uses_stale_value_during_source_failure(self) -> None:
        cache = TimedCache()
        self.assertEqual(cache.get_or_load("daily", 60, lambda: {"candles": [1]}), {"candles": [1]})
        cache._items["daily"] = (0.0, {"candles": [1]})
        calls = 0

        def fail():
            nonlocal calls
            calls += 1
            raise OSError("source unavailable")

        first = cache.get_or_load(
            "daily", 60, fail, stale_if_error=True, failure_ttl_sec=30,
        )
        second = cache.get_or_load(
            "daily", 60, fail, stale_if_error=True, failure_ttl_sec=30,
        )

        self.assertEqual(first, {"candles": [1]})
        self.assertEqual(second, {"candles": [1]})
        self.assertEqual(calls, 1)

    def test_nav_histories_limit_concurrency_and_isolate_failures(self) -> None:
        active = 0
        peak = 0
        lock = threading.Lock()
        today = datetime.now(ZoneInfo("Asia/Shanghai")).date().isoformat()

        def fetch_json(url: str, _timeout: float) -> dict:
            nonlocal active, peak
            code = url.split("/history/", 1)[1].split("?", 1)[0]
            with lock:
                active += 1
                peak = max(peak, active)
            try:
                time.sleep(0.03)
                if code == "000003":
                    raise OSError("danjuan unavailable")
                return {"data": {"items": [{"date": today, "nav": 1.2}], "total_items": 1}}
            finally:
                with lock:
                    active -= 1

        service = MarketDataService(
            self.store,
            self.data_dir,
            fetch_json=fetch_json,
            danjuan_concurrency=2,
        )
        result = service.nav_histories(["000001", "000002", "000003", "000004"], 30)

        self.assertEqual([item["code"] for item in result], ["000001", "000002", "000003", "000004"])
        self.assertEqual([item["ok"] for item in result], [True, True, False, True])
        self.assertEqual(peak, 2)

    def test_eastmoney_kline_limit_and_circuit_breaker(self) -> None:
        active = 0
        peak = 0
        lock = threading.Lock()

        def successful_fetch(_url: str, _timeout: float) -> dict:
            nonlocal active, peak
            with lock:
                active += 1
                peak = max(peak, active)
            try:
                time.sleep(0.03)
                return {"data": {"klines": [
                    "2026-09-11,2.00,2.10,2.12,1.98,1000,2100,7.00,5.00,0.10,2.00",
                ]}}
            finally:
                with lock:
                    active -= 1

        service = MarketDataService(
            self.store,
            self.data_dir,
            fetch_json=successful_fetch,
            eastmoney_concurrency=2,
        )
        with ThreadPoolExecutor(max_workers=5) as executor:
            payloads = list(executor.map(service.daily_price_klines, ["513100", "513500", "159501", "159660", "513390"]))

        self.assertTrue(all(payload["candles"] for payload in payloads))
        self.assertEqual(peak, 2)

        failures = 0

        def failing_fetch(_url: str, _timeout: float) -> dict:
            nonlocal failures
            failures += 1
            raise OSError("eastmoney unavailable")

        failing_service = MarketDataService(
            self.store,
            self.data_dir,
            fetch_json=failing_fetch,
            eastmoney_concurrency=2,
        )
        for symbol in ["513100", "513500", "159501"]:
            with self.assertRaises(OSError):
                failing_service.daily_price_klines(symbol)
        with self.assertRaises(UpstreamCircuitOpen):
            failing_service.daily_price_klines("159660")
        self.assertEqual(failures, 3)

    def test_daily_combined_keeps_nav_when_price_source_fails(self) -> None:
        def fail_price(_symbol: str, _limit: int):
            raise OSError("price unavailable")

        self.service.daily_price_klines = fail_price
        payload = self.service.daily_combined("513100", 10)

        self.assertEqual(payload["candles"], [])
        self.assertEqual(len(payload["navCandles"]), 2)
        self.assertEqual(payload["quality"], {"status": "degraded", "issues": ["price"]})
        self.assertIn("price", payload["sourceErrors"])

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
