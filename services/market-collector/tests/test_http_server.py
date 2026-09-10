from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from market_collector.http_server import (
    _is_web_api_route,
    _merge_fresh_record,
    _normalize_sec_financials,
    _upstream_target,
    resolve_request,
)


class FakeMarketDataService:
    def quote(self, symbol: str):
        if symbol == "513100":
            return {"symbol": symbol, "price": 2.2, "asOf": "2026-08-11T10:00:00+08:00"}
        return None

    def fund_metric(self, symbol: str):
        return {"code": symbol} if symbol == "513100" else None

    def fund_metrics(self, symbols: list[str]):
        return [
            {
                "code": code,
                "price": 2.2,
                "source": "local",
                "updatedAt": "2026-08-11T10:00:00+08:00",
            }
            for code in symbols if code == "513100"
        ]

    def home_overview(self):
        return {"marketState": "open"}

    def home_series(self):
        return {"modes": {"price": {}, "premium": {}}}

    def fund_limit_overview(self):
        return {"currencyTotals": [], "events": []}

    def kline(self, symbol: str, interval: str, limit: int):
        return {
            "symbol": symbol,
            "interval": interval,
            "candles": [{"c": 2.2}] * min(limit, 2),
        }


class HttpServerTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.data_dir = Path(self.temp_dir.name)
        (self.data_dir / "health.json").write_text(
            json.dumps({"healthy_symbols": 19, "degraded_symbols": 2}),
            encoding="utf-8",
        )
        (self.data_dir / "latest.json").write_text(
            json.dumps({"symbols": [{"symbol": "513100", "price": 2.24}]}),
            encoding="utf-8",
        )
        (self.data_dir / "otc-latest.json").write_text(
            json.dumps({"items": [{"code": "000834", "latestNav": 6.2}]}),
            encoding="utf-8",
        )

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_health_and_latest_routes(self) -> None:
        status, service = resolve_request("/", self.data_dir)
        self.assertEqual(status, 200)
        self.assertEqual(service["utc_offset"], "+08:00")

        status, health = resolve_request("/health", self.data_dir)
        self.assertEqual(status, 200)
        self.assertEqual(health["healthy_symbols"], 19)

        status, latest = resolve_request("/latest?source=test", self.data_dir)
        self.assertEqual(status, 200)
        self.assertEqual(len(latest["symbols"]), 1)

    def test_symbol_route_and_missing_symbol(self) -> None:
        status, record = resolve_request("/symbols/513100", self.data_dir)
        self.assertEqual(status, 200)
        self.assertEqual(record["price"], 2.24)

        status, error = resolve_request("/symbols/510300", self.data_dir)
        self.assertEqual(status, 404)
        self.assertEqual(error["error"], "symbol_not_found")

    def test_missing_snapshot_returns_service_unavailable(self) -> None:
        (self.data_dir / "health.json").unlink()
        status, payload = resolve_request("/health", self.data_dir)
        self.assertEqual(status, 503)
        self.assertEqual(payload["error"], "snapshot_unavailable")

    def test_web_route_allowlist_excludes_mutating_admin_routes(self) -> None:
        self.assertTrue(_is_web_api_route("/news"))
        self.assertTrue(_is_web_api_route("/financials/AAPL"))
        self.assertTrue(_is_web_api_route("/fund-fee"))
        self.assertFalse(_is_web_api_route("/refresh"))
        self.assertFalse(_is_web_api_route("/ask"))
        self.assertFalse(_is_web_api_route("/kline-batch"))

    def test_fund_fee_uses_top_level_api_route(self) -> None:
        self.assertEqual(
            _upstream_target("/fund-fee"),
            "https://api.freebacktrack.tech/api/fund-fee",
        )
        self.assertEqual(
            _upstream_target("/news"),
            "https://api.freebacktrack.tech/api/markets/news",
        )

    def test_post_fund_fee_is_forwarded_by_compatibility_route(self) -> None:
        calls = []

        def proxy(method, path, body):
            calls.append((method, path, body))
            return 200, {"items": [{"code": "000834", "purchaseFeeRate": 0.12}]}

        status, payload = resolve_request(
            "/api/market-collector/fund-fee?refresh=1",
            self.data_dir,
            FakeMarketDataService(),
            method="POST",
            body={"codes": ["000834"]},
            proxy_request=proxy,
        )
        self.assertEqual(status, 200)
        self.assertEqual(payload["items"][0]["code"], "000834")
        self.assertEqual(calls, [
            ("POST", "/fund-fee?refresh=1", {"codes": ["000834"]}),
        ])

    def test_sec_company_facts_are_normalized_for_financial_panel(self) -> None:
        payload = _normalize_sec_financials({
            "facts": {"us-gaap": {
                "Revenues": {"units": {"USD": [
                    {
                        "form": "10-K", "fp": "FY", "frame": "CY2025",
                        "end": "2025-09-27", "filed": "2025-10-31", "val": 100,
                    },
                    {
                        "form": "10-Q", "fp": "Q1", "frame": "CY2026Q1",
                        "end": "2025-12-27", "filed": "2026-01-30", "val": 30,
                    },
                ]}},
                "Assets": {"units": {"USD": [
                    {
                        "form": "10-K", "fp": "FY", "frame": "CY2025Q4I",
                        "end": "2025-09-27", "filed": "2025-10-31", "val": 500,
                    },
                    {
                        "form": "10-Q", "fp": "Q1", "frame": "CY2026Q1I",
                        "end": "2025-12-27", "filed": "2026-01-30", "val": 520,
                    },
                ]}},
            }},
        }, "AAPL")
        self.assertEqual(payload["source"], "sec-companyfacts")
        self.assertEqual(payload["statements"]["income"]["annual"][0]["fields"]["totalRevenue"], 100)
        self.assertEqual(payload["statements"]["income"]["quarterly"][0]["fields"]["totalRevenue"], 30)
        self.assertEqual(payload["statements"]["balance"]["quarterly"][0]["fields"]["totalAssets"], 520)

    def test_financials_uses_sec_source_without_proxy(self) -> None:
        expected = {"symbol": "AAPL", "source": "sec-companyfacts", "statements": {}}

        def no_proxy(*_args):
            self.fail("working SEC financials source should not call compatibility proxy")

        status, payload = resolve_request(
            "/financials/AAPL?refresh=1",
            self.data_dir,
            FakeMarketDataService(),
            proxy_request=no_proxy,
            financials_request=lambda symbol, force: expected,
        )
        self.assertEqual(status, 200)
        self.assertEqual(payload, expected)

    def test_financials_falls_back_to_proxy_when_sec_is_unavailable(self) -> None:
        def unavailable(*_args):
            raise OSError("SEC unavailable")

        status, payload = resolve_request(
            "/financials/AAPL",
            self.data_dir,
            FakeMarketDataService(),
            proxy_request=lambda *_args: (503, {"error": "upstream_unavailable"}),
            financials_request=unavailable,
        )
        self.assertEqual(status, 503)
        self.assertEqual(payload["error"], "upstream_unavailable")

    def test_quotes_merge_local_freshness_with_upstream_metadata(self) -> None:
        calls = []

        def proxy(method, path, body):
            calls.append((method, path, body))
            return 200, {"quotes": {
                "513100": {
                    "symbol": "513100",
                    "price": 2.0,
                    "asOf": "2026-08-11T09:00:00+08:00",
                    "highPoint": {"price": 2.8},
                },
                "QQQ": {"symbol": "QQQ", "price": 600},
            }}

        status, payload = resolve_request(
            "/api/markets/quotes?symbols=513100,QQQ",
            self.data_dir,
            FakeMarketDataService(),
            proxy_request=proxy,
        )
        self.assertEqual(status, 200)
        self.assertEqual(payload["quotes"]["513100"]["price"], 2.2)
        self.assertEqual(payload["quotes"]["513100"]["highPoint"]["price"], 2.8)
        self.assertEqual(payload["quotes"]["QQQ"]["price"], 600)
        self.assertEqual(len(calls), 1)

    def test_quotes_degrade_to_local_without_upstream(self) -> None:
        status, payload = resolve_request(
            "/quotes?symbols=513100",
            self.data_dir,
            FakeMarketDataService(),
            proxy_request=lambda *_args: (502, {"error": "offline"}),
        )
        self.assertEqual(status, 200)
        self.assertEqual(payload["quotes"]["513100"]["source"], "market-collector")

    def test_post_fund_metrics_merges_local_and_upstream(self) -> None:
        def proxy(method, path, body):
            self.assertEqual(method, "POST")
            self.assertEqual(body["codes"], ["513100", "000834"])
            return 200, {"items": [
                {
                    "code": "513100",
                    "price": 2.0,
                    "asOf": "2026-08-11T09:00:00+08:00",
                    "highPoint": {"price": 2.8},
                },
                {"code": "000834", "latestNav": 6.2},
            ]}

        status, payload = resolve_request(
            "/fund-metrics",
            self.data_dir,
            FakeMarketDataService(),
            method="POST",
            body={"codes": ["513100", "000834"]},
            proxy_request=proxy,
        )
        self.assertEqual(status, 200)
        self.assertEqual(payload["successCount"], 2)
        self.assertEqual(payload["items"][0]["price"], 2.2)
        self.assertEqual(payload["items"][0]["highPoint"]["price"], 2.8)
        self.assertEqual(payload["items"][1]["latestNav"], 6.2)

    def test_newer_upstream_record_is_not_overwritten_by_stale_local_data(self) -> None:
        merged = _merge_fresh_record(
            {"price": 2.4, "asOf": "2026-08-11T11:00:00+08:00", "source": "upstream"},
            {"price": 2.2, "asOf": "2026-08-11T10:00:00+08:00", "source": "local"},
        )
        self.assertEqual(merged["price"], 2.4)
        self.assertEqual(merged["source"], "upstream")

    def test_invalid_local_timestamp_does_not_replace_timed_upstream_record(self) -> None:
        merged = _merge_fresh_record(
            {"price": 2.4, "asOf": "2026-08-11T11:00:00+08:00"},
            {"price": 2.2, "asOf": "invalid"},
        )
        self.assertEqual(merged["price"], 2.4)

    def test_local_kline_alias_avoids_proxy(self) -> None:
        def no_proxy(*_args):
            self.fail("local 1d kline should not call upstream proxy")

        status, payload = resolve_request(
            "/api/market-collector/kline/513100?tf=1d&limit=2",
            self.data_dir,
            FakeMarketDataService(),
            proxy_request=no_proxy,
        )
        self.assertEqual(status, 200)
        self.assertEqual(payload["interval"], "1d")
        self.assertEqual(len(payload["candles"]), 2)

    def test_unimplemented_web_route_preserves_proxy_status(self) -> None:
        status, payload = resolve_request(
            "/news?market=us",
            self.data_dir,
            FakeMarketDataService(),
            proxy_request=lambda method, path, body: (503, {"error": "cache_miss"}),
        )
        self.assertEqual(status, 503)
        self.assertEqual(payload["error"], "cache_miss")

    def test_home_aggregate_routes_are_local(self) -> None:
        service = FakeMarketDataService()
        for route in (
            "/api/market-collector/aggregates/home-market-overview",
            "/api/market-collector/aggregates/home-market-series",
            "/api/market-collector/aggregates/fund-limit-overview",
        ):
            status, payload = resolve_request(route, self.data_dir, service, proxy_request=lambda *_: self.fail("must not proxy"))
            self.assertEqual(status, 200)
            self.assertIsInstance(payload, dict)
        status, payload = resolve_request(
            "/api/market-collector/aggregates/home-market-collect", self.data_dir, service,
            proxy_request=lambda *_: self.fail("must not proxy"),
        )
        self.assertEqual(status, 200)
        self.assertEqual(payload["source"], "market-collector-local")


if __name__ == "__main__":
    unittest.main()
