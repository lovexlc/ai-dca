from __future__ import annotations

import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from market_collector.core import DEFAULT_CONFIG, MarketCollector, deep_update, due_daily_slot
from market_collector.fund_reference import fetch_fund_fee, normalize_limit_payload


class FakeStore:
    backend_name = "sqlite"

    def __init__(self) -> None:
        self.reference_writes: list[dict] = []

    def initialize(self) -> None:
        pass

    def write_fund_reference_snapshots(self, records, retention_days) -> None:
        self.reference_writes.extend(records)


class FundReferenceTest(unittest.TestCase):
    def test_eastmoney_fee_parser_handles_unclosed_operation_table(self) -> None:
        html = """
        <div class='comm jjfl'>
          <table>
            <tr>
              <td class='th'>管理费率</td><td>0.60%（每年）</td>
              <td class='th'>托管费率</td><td>0.20%（每年）</td>
            </tr>
        """.encode("utf-8")

        def fake_fetch(url, _timeout, *, referer):
            if "danjuanfunds.com" in url:
                return b'{"data": {}}'
            self.assertIn("fundf10.eastmoney.com/jjfl_513100.html", url)
            self.assertEqual(referer, "https://fundf10.eastmoney.com/")
            return html

        with patch("market_collector.fund_reference._fetch_bytes", side_effect=fake_fetch):
            result = fetch_fund_fee("513100", timeout_sec=1)

        self.assertEqual(result["managementFeeRate"], 0.6)
        self.assertEqual(result["custodyFeeRate"], 0.2)
        self.assertEqual(result["annualFeeRate"], 0.8)
        self.assertEqual(result["operationFees"], [
            ["管理费率", "0.60%（每年）"],
            ["托管费率", "0.20%（每年）"],
        ])

    def test_tencent_quote_batch_is_coalesced_across_threads(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            config = deep_update(DEFAULT_CONFIG, {
                "output_dir": temp_dir,
                "publisher": {
                    "backend": "file",
                    "outbox_dir": str(Path(temp_dir) / "outbox"),
                },
            })
            collector = MarketCollector(config, store=FakeStore())
            active = 0
            peak = 0
            lock = threading.Lock()

            def fetch(symbols, _timeout):
                nonlocal active, peak
                with lock:
                    active += 1
                    peak = max(peak, active)
                try:
                    time.sleep(0.05)
                    return {symbol: {"price": 1.0} for symbol in symbols}
                finally:
                    with lock:
                        active -= 1

            with patch("market_collector.core.fetch_tencent_quotes", side_effect=fetch) as request:
                with ThreadPoolExecutor(max_workers=6) as executor:
                    values = list(executor.map(
                        lambda _index: collector._fetch_tencent_price_map(["513100", "513500"], 10),
                        range(6),
                    ))

            self.assertEqual(request.call_count, 1)
            self.assertEqual(peak, 1)
            self.assertTrue(all(set(value) == {"513100", "513500"} for value in values))

    def test_normalizes_direct_and_distributor_limits(self) -> None:
        payload = normalize_limit_payload({
            "code": "040046",
            "maxPurchasePerDay": 10,
            "channelLimits": {"direct": 100, "distributor": 10},
        })
        self.assertEqual(payload["channelLimits"], {"direct": 100.0, "distributor": 10.0})
        self.assertEqual(payload["maxPurchasePerDay"], 100.0)
        self.assertEqual(payload["limitChannel"], "app")
        self.assertEqual(payload["limitSchemaVersion"], 2)

    def test_daily_slot_is_due_after_time_and_only_once(self) -> None:
        completed = set()
        before = datetime(2026, 8, 12, 14, 29, tzinfo=timezone.utc)
        after = datetime(2026, 8, 12, 14, 31, tzinfo=timezone.utc)
        self.assertIsNone(due_daily_slot(before, "22:30", completed))
        self.assertEqual(due_daily_slot(after, "22:30", completed), "2026-08-12")
        completed.add("2026-08-12")
        self.assertIsNone(due_daily_slot(after, "22:30", completed))

    def test_scheduler_uses_local_collector_reference_function_once(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            config = deep_update(DEFAULT_CONFIG, {
                "output_dir": temp_dir,
                "fund_reference_sync": {
                    "enabled": True,
                    "symbols": ["000001"],
                    "time": "22:30",
                },
                "publisher": {
                    "backend": "file",
                    "outbox_dir": str(Path(temp_dir) / "outbox"),
                },
            })
            store = FakeStore()
            collector = MarketCollector(config, store=store)
            result = {
                "records": [{
                    "data_kind": "fund_fee",
                    "symbol": "000001",
                    "snapshot_date": "2026-08-12",
                    "fetched_at": "2026-08-12T22:31:00+08:00",
                    "source": "worker:fund-fee",
                    "payload": {"code": "000001", "source": "danjuan"},
                }],
                "requested_symbols": 1,
                "fee_success_count": 1,
                "limit_success_count": 0,
                "errors": [],
            }
            with patch("market_collector.core.fetch_fund_references", return_value=result) as fetch:
                collector.run_due_fund_reference_sync(datetime(2026, 8, 12, 14, 29, tzinfo=timezone.utc))
                self.assertEqual(fetch.call_count, 0)
                due = datetime(2026, 8, 12, 14, 31, tzinfo=timezone.utc)
                collector.run_due_fund_reference_sync(due)
                collector.run_due_fund_reference_sync(due)
                self.assertEqual(fetch.call_count, 1)
                kwargs = fetch.call_args.kwargs
                self.assertEqual(kwargs["worker_url"], "")
                self.assertEqual(len(store.reference_writes), 1)

    def test_default_config_has_no_cloud_market_worker_url(self) -> None:
        self.assertTrue(DEFAULT_CONFIG["fund_reference_sync"]["enabled"])
        self.assertEqual(DEFAULT_CONFIG["fund_reference_sync"]["worker_url"], "")
        self.assertEqual(DEFAULT_CONFIG["publisher"]["worker_url"], "")


if __name__ == "__main__":
    unittest.main()
