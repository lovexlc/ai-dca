from __future__ import annotations

import threading
import time
import unittest
from urllib.parse import parse_qs, urlparse

from market_collector.xueqiu import (
    clear_xueqiu_cache,
    fetch_xueqiu_fund_data,
    sanitize_xueqiu_public_payload,
    to_xueqiu_symbol,
)


class XueqiuSourceTest(unittest.TestCase):
    def setUp(self) -> None:
        clear_xueqiu_cache()

    def tearDown(self) -> None:
        clear_xueqiu_cache()

    def test_symbol_mapping_covers_exchange_fund_markets(self):
        self.assertEqual(to_xueqiu_symbol("513100"), "SH513100")
        self.assertEqual(to_xueqiu_symbol("159501"), "SZ159501")
        self.assertEqual(to_xueqiu_symbol("830001"), "BJ830001")
        self.assertEqual(to_xueqiu_symbol("SH513100"), "SH513100")
        self.assertEqual(to_xueqiu_symbol("AAPL"), "")

    def test_public_sanitizer_drops_unlisted_fields(self):
        result = sanitize_xueqiu_public_payload("quote_detail", {
            "data": {"quote": {
                "symbol": "SH513100",
                "current": 2.2,
                "name": "纳指ETF",
                "secret_field": "must not escape",
            }},
        })
        self.assertEqual(result, {"quote": {"symbol": "SH513100", "current": 2.2, "name": "纳指ETF"}})

    def test_detail_requests_are_bounded_and_cached(self):
        active = 0
        peak = 0
        calls = []
        lock = threading.Lock()

        def fake_fetch(url, headers, timeout_sec):
            nonlocal active, peak
            parsed = urlparse(url)
            name = parsed.path.rsplit("/", 1)[-1]
            if name == "quote.json":
                key = "quote_detail"
                payload = {"data": {"quote": {"symbol": "SH513100", "current": 2.2, "name": "纳指ETF"}}}
            elif name == "flow.json":
                key = "capital_flow"
                payload = {"data": {"items": [{"timestamp": 1, "amount": 2, "secret": "drop"}]}}
            elif name == "history.json":
                key = "capital_history"
                payload = {"data": {"sum3": 3}}
            elif name == "pankou.json":
                key = "pankou"
                payload = {"data": {"bp1": 2.1, "bc1": 10}}
            elif name.endswith("indicator.json"):
                key = "finance_indicator" if "/finance/" in parsed.path else "f10_indicator"
                payload = {"data": {"list": [{"report_name": "2026Q2", "asset_liab_ratio": 10, "secret": "drop"}]}}
            elif name == "balance.json":
                key = "finance_balance"
                payload = {"data": {"list": [{"report_name": "2026Q2", "total_assets": 100}]}}
            elif name == "income.json":
                key = "finance_income"
                payload = {"data": {"list": [{"report_name": "2026Q2", "revenue": 100}]}}
            elif name == "cash_flow.json":
                key = "finance_cash_flow"
                payload = {"data": {"list": [{"report_name": "2026Q2", "ncf_from_oa": 20}]}}
            elif name == "kline.json":
                key = "kline"
                payload = {"data": {"item": [[1, 2, 3]]}}
            elif name == "quotec.json":
                key = "quotec"
                payload = {"data": {"quote": {"current": 2.2}}}
            else:
                raise AssertionError(url)
            with lock:
                calls.append(key)
                active += 1
                peak = max(peak, active)
            time.sleep(0.01)
            with lock:
                active -= 1
            return payload

        payload = fetch_xueqiu_fund_data(
            "513100",
            cookie="xq_a_token=test",
            fetch_json=fake_fetch,
            cache_ttl_sec=60,
        )
        self.assertEqual(payload["cached"], False)
        self.assertEqual(payload["symbol"], "SH513100")
        self.assertEqual(len(payload["results"]), 12)
        self.assertLessEqual(peak, 4)
        self.assertNotIn("raw", payload["results"]["quote_detail"])
        self.assertNotIn("secret", payload["results"]["quote_detail"]["data"]["quote"])

        cached = fetch_xueqiu_fund_data(
            "513100",
            cookie="xq_a_token=test",
            fetch_json=lambda *_args: self.fail("cached detail must not fetch upstream"),
            cache_ttl_sec=60,
        )
        self.assertTrue(cached["cached"])
        self.assertEqual(len(calls), 12)

    def test_worker_fallback_is_used_without_local_cookie(self):
        urls = []

        def fake_fetch(url, headers, timeout_sec):
            urls.append(url)
            return {
                "symbol": "SH513100",
                "code": "513100",
                "results": {"quote_detail": {"ok": True}},
                "cached": False,
            }

        payload = fetch_xueqiu_fund_data(
            "513100",
            cookie="",
            worker_url="https://worker.example/api/markets",
            fetch_json=fake_fetch,
            force_refresh=True,
        )
        self.assertEqual(payload["code"], "513100")
        self.assertEqual(urls, ["https://worker.example/api/markets/xueqiu-fund-data/513100?refresh=1"])
        self.assertFalse(payload["cached"])


if __name__ == "__main__":
    unittest.main()
