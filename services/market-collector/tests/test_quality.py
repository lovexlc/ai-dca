from __future__ import annotations

import unittest
from datetime import datetime, timezone

from market_collector.core import build_symbol_record, classify_session, due_otc_slot, load_config


class QualityRuleTest(unittest.TestCase):
    def test_trading_session_ttl_and_mismatch(self) -> None:
        record = build_symbol_record(
            symbol="513100",
            price_row={"price": 2.237, "name": "纳指ETF国泰", "source": "tencent_batch", "received_at": "2026-08-11T10:00:00+08:00", "source_as_of": "2026-08-11T10:00:00+08:00"},
            iopv_row={"iopv": 2.0048, "vendor_premium_percent": 11.58, "vendor_discount_percent_raw": -11.58, "source": "eastmoney_push2delay", "received_at": "2026-08-11T10:00:01+08:00", "source_as_of": "2026-08-11T10:00:01+08:00", "page": 24},
            collected_at="2026-08-11T10:00:02+08:00",
            session="trading",
            ttl_sec=90,
            mismatch_tolerance_pp=0.05,
        )

        self.assertEqual(record["computed_premium_percent"], 11.5822)
        self.assertAlmostEqual(record["mismatch_pp"], 0.0022, places=4)
        self.assertEqual(record["quality"]["status"], "ok")
        self.assertEqual(record["expires_at"], "2026-08-11T10:01:32+08:00")
        self.assertEqual(record["category"], "cross_border_etf")

    def test_missing_iopv_marks_record_degraded(self) -> None:
        record = build_symbol_record(
            symbol="161128",
            price_row={"price": 6.97, "name": "标普信息科技LOF", "source": "tencent_batch", "received_at": "2026-08-11T10:00:00+08:00", "source_as_of": "2026-08-11T10:00:00+08:00"},
            iopv_row={"iopv": None, "vendor_premium_percent": None, "vendor_discount_percent_raw": -1.89, "source": "eastmoney_push2delay", "received_at": "2026-08-11T10:00:01+08:00", "source_as_of": "2026-08-11T10:00:01+08:00", "page": 21},
            collected_at="2026-08-11T10:00:02+08:00",
            session="trading",
            ttl_sec=90,
            mismatch_tolerance_pp=0.05,
        )

        self.assertEqual(record["computed_premium_percent"], None)
        self.assertEqual(record["quality"]["status"], "degraded")
        self.assertIn("missing_iopv", record["quality"]["issues"])
        self.assertIn("missing_vendor_premium", record["quality"]["issues"])
        self.assertEqual(record["category"], "lof")

    def test_classify_session_covers_lunch_and_off_hours(self) -> None:
        lunch = datetime(2026, 8, 11, 3, 45, tzinfo=timezone.utc)
        off_hours = datetime(2026, 8, 11, 9, 30, tzinfo=timezone.utc)

        self.assertEqual(classify_session(lunch), "lunch")
        self.assertEqual(classify_session(off_hours), "off_hours")

    def test_exchange_schedule_uses_trading_days_and_1530_close(self) -> None:
        self.assertEqual(classify_session(datetime(2026, 8, 11, 1, 30, tzinfo=timezone.utc)), "trading")
        self.assertEqual(classify_session(datetime(2026, 8, 11, 7, 30, tzinfo=timezone.utc)), "trading")
        self.assertEqual(classify_session(datetime(2026, 8, 11, 7, 31, tzinfo=timezone.utc)), "off_hours")
        self.assertEqual(classify_session(datetime(2026, 10, 1, 2, 0, tzinfo=timezone.utc)), "off_hours")

    def test_otc_slots_run_once_on_trading_days(self) -> None:
        completed = set()
        now = datetime(2026, 8, 11, 11, 30, tzinfo=timezone.utc)
        slot = due_otc_slot(now, ["19:30", "20:30", "21:30"], completed)
        self.assertEqual(slot, "2026-08-11T19:30")
        completed.add(slot)
        self.assertIsNone(due_otc_slot(now, ["19:30", "20:30", "21:30"], completed))
        holiday = datetime(2026, 10, 1, 11, 30, tzinfo=timezone.utc)
        self.assertIsNone(due_otc_slot(holiday, ["19:30"], set()))

    def test_load_config_resolves_default_paths_from_repo_root(self) -> None:
        config = load_config("/root/ai-dca/services/market-collector")

        self.assertEqual(config["storage_backend"], "sqlite")
        self.assertEqual(config["database_path"], "/root/ai-dca/services/market-collector/data/market-collector.sqlite3")
        self.assertEqual(config["output_dir"], "/root/ai-dca/services/market-collector/data/shadow")


if __name__ == "__main__":
    unittest.main()
