from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from market_collector.http_server import _is_web_api_route, resolve_request


class FakeReferenceStore:
    def __init__(self):
        self.records = []

    def write_fund_reference_snapshots(self, records, retention_days):
        self.records.extend(records)


class FakeMarketDataService:
    def __init__(self):
        self.quote_batch_calls = 0
        self.nav_batch_calls = 0
        self.fees = {
            "513100": {"code": "513100", "annualFeeRate": 0.6, "source": "eastmoney_f10"},
        }
        self.limits = {
            "000834": {"code": "000834", "buyStatus": "limit_large", "maxPurchasePerDay": 1000, "source": "eastmoney_f10+detail"},
        }
        self.store = FakeReferenceStore()

    def quote(self, symbol: str):
        if symbol == "513100":
            return {"symbol": symbol, "price": 2.2, "asOf": "2026-09-10T10:00:00+08:00", "source": "local"}
        return None

    def quotes(self, symbols: list[str]):
        self.quote_batch_calls += 1
        return {
            symbol: quote
            for symbol in symbols
            if (quote := self.quote(symbol)) is not None
        }

    def fund_metric(self, symbol: str):
        return {"code": symbol, "price": 2.2, "source": "local"} if symbol == "513100" else None

    def fund_metrics(self, symbols: list[str]):
        return [self.fund_metric(code) for code in symbols if self.fund_metric(code) is not None]

    def nav_history(self, symbol: str, days: int):
        if symbol != "513100":
            raise ValueError("not found")
        return {
            "symbol": symbol,
            "items": [{"date": "2026-09-09", "nav": 2.0}],
            "source": "danjuan-nav-history",
        }

    def nav_histories(self, symbols: list[str], days: int):
        self.nav_batch_calls += 1
        items = []
        for symbol in symbols:
            try:
                items.append({"code": symbol, "ok": True, "data": self.nav_history(symbol, days)})
            except Exception as exc:
                items.append({"code": symbol, "ok": False, "error": str(exc)})
        return items

    def kline(self, symbol: str, interval: str, limit: int):
        return {"symbol": symbol, "interval": interval, "candles": [{"c": 2.2}] * min(limit, 2), "source": "local"}

    def home_overview(self):
        return {"marketState": "open", "source": "local"}

    def home_series(self):
        return {"modes": {"price": {}, "premium": {}}, "source": "local"}

    def fund_limit_overview(self):
        return {"currencyTotals": [], "records": [], "events": [], "source": "market-collector"}

    def market_summary(self, region: str):
        return {"region": region, "items": [], "source": "collector-indices"}

    def dataset_record(self, dataset: str, key: str):
        payload = None
        if dataset == "fund-fee":
            payload = self.fees.get(key)
        elif dataset == "fund-limit":
            payload = self.limits.get(key)
        elif dataset == "kline" and ":" in key:
            symbol, interval = key.split(":", 1)
            payload = self.kline(symbol, interval, 2)
        if payload is None:
            return None
        return {"_id": f"{dataset}:{key}", "payload": payload}


class HttpServerTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.data_dir = Path(self.temp_dir.name)
        (self.data_dir / "health.json").write_text(json.dumps({"healthy_symbols": 1}), encoding="utf-8")
        (self.data_dir / "latest.json").write_text(json.dumps({"symbols": [{"symbol": "513100", "price": 2.24}]}), encoding="utf-8")
        self.service = FakeMarketDataService()

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_health_and_symbol_snapshot_routes(self):
        status, health = resolve_request("/health", self.data_dir)
        self.assertEqual(status, 200)
        self.assertEqual(health["healthy_symbols"], 1)
        status, record = resolve_request("/symbols/513100", self.data_dir)
        self.assertEqual(status, 200)
        self.assertEqual(record["price"], 2.24)

    def test_market_web_allowlist_excludes_mutating_routes(self):
        self.assertTrue(_is_web_api_route("/news"))
        self.assertTrue(_is_web_api_route("/fund-fee"))
        self.assertTrue(_is_web_api_route("/fund-limit"))
        self.assertFalse(_is_web_api_route("/refresh"))
        self.assertFalse(_is_web_api_route("/ask"))

    def test_quotes_are_collector_local(self):
        def no_proxy(*_args):
            self.fail("market quote must never proxy to Cloudflare")
        status, payload = resolve_request(
            "/api/markets/quotes?symbols=513100,QQQ",
            self.data_dir,
            self.service,
            proxy_request=no_proxy,
        )
        self.assertEqual(status, 200)
        self.assertEqual(payload["quotes"]["513100"]["price"], 2.2)
        self.assertNotIn("QQQ", payload["quotes"])
        self.assertEqual(payload["source"], "market-collector")
        self.assertEqual(self.service.quote_batch_calls, 1)

    def test_fund_metrics_are_collector_local(self):
        def no_proxy(*_args):
            self.fail("fund metrics must never proxy to Cloudflare")
        status, payload = resolve_request(
            "/api/markets/fund-metrics",
            self.data_dir,
            self.service,
            method="POST",
            body={"codes": ["513100", "000834"]},
            proxy_request=no_proxy,
        )
        self.assertEqual(status, 200)
        self.assertEqual(payload["successCount"], 1)
        self.assertEqual(payload["items"][0]["code"], "513100")

    def test_nav_history_semantic_alias_is_local(self):
        def no_proxy(*_args):
            self.fail("NAV history is public market data and must stay local")
        status, payload = resolve_request(
            "/api/holdings/nav-history?code=513100&days=30",
            self.data_dir,
            self.service,
            proxy_request=no_proxy,
        )
        self.assertEqual(status, 200)
        self.assertEqual(payload["symbol"], "513100")
        self.assertEqual(payload["source"], "danjuan-nav-history")

    def test_nav_history_batch_uses_service_concurrency_boundary(self):
        status, payload = resolve_request(
            "/api/market-collector/nav-history",
            self.data_dir,
            self.service,
            method="POST",
            body={"codes": ["513100", "000834"]},
        )

        self.assertEqual(status, 200)
        self.assertEqual(payload["count"], 2)
        self.assertEqual([item["ok"] for item in payload["items"]], [True, False])
        self.assertEqual(self.service.nav_batch_calls, 1)

    def test_fund_fee_and_limit_are_local_snapshots(self):
        def no_proxy(*_args):
            self.fail("fund reference data must stay local")
        status, fee = resolve_request(
            "/api/market-collector/fund-fee?code=513100",
            self.data_dir,
            self.service,
            proxy_request=no_proxy,
        )
        self.assertEqual(status, 200)
        self.assertEqual(fee["code"], "513100")
        status, limit = resolve_request(
            "/api/market-collector/fund-limit?code=000834",
            self.data_dir,
            self.service,
            proxy_request=no_proxy,
        )
        self.assertEqual(status, 200)
        self.assertEqual(limit["maxPurchasePerDay"], 1000)
        status, overview = resolve_request(
            "/api/market-collector/fund-limit/overview",
            self.data_dir,
            self.service,
            proxy_request=no_proxy,
        )
        self.assertEqual(status, 200)
        self.assertEqual(overview["source"], "market-collector")

    def test_exchange_fee_null_snapshot_is_refreshed_from_collector_source(self):
        self.service.fees["513500"] = {"code": "513500", "annualFeeRate": None}
        fresh = {
            "code": "513500",
            "managementFeeRate": 0.6,
            "custodyFeeRate": 0.2,
            "annualFeeRate": 0.8,
            "fetchedAt": "2026-09-14T17:45:00+08:00",
        }
        with patch("market_collector.http_server.fetch_fund_fee", return_value=fresh) as fetch:
            status, payload = resolve_request(
                "/api/market-collector/fund-fee?code=513500",
                self.data_dir,
                self.service,
            )
        self.assertEqual(status, 200)
        self.assertEqual(payload["annualFeeRate"], 0.8)
        self.assertEqual(fetch.call_count, 1)
        self.assertEqual(self.service.store.records[0]["symbol"], "513500")

    def test_financials_uses_sec_and_never_cloud_market_fallback(self):
        expected = {"symbol": "AAPL", "source": "sec-companyfacts", "statements": {}}
        status, payload = resolve_request(
            "/financials/AAPL",
            self.data_dir,
            self.service,
            proxy_request=lambda *_args: self.fail("financials must not use Cloudflare market fallback"),
            financials_request=lambda _symbol, _force: expected,
        )
        self.assertEqual(status, 200)
        self.assertEqual(payload, expected)

    def test_xueqiu_fund_data_route_uses_collector_capability(self):
        calls = []

        def fake_xueqiu(symbol, force_refresh, include_raw):
            calls.append((symbol, force_refresh, include_raw))
            return {
                "symbol": "SH" + symbol,
                "code": symbol,
                "generatedAt": "2026-09-14T01:00:00+00:00",
                "results": {
                    "quote_detail": {
                        "ok": True,
                        "data": {"quote": {"symbol": "SH" + symbol, "current": 2.2}},
                    },
                },
            }

        status, payload = resolve_request(
            "/api/market-collector/xueqiu-fund-data/513100?refresh=1&raw=1",
            self.data_dir,
            self.service,
            proxy_request=lambda *_args: self.fail("xueqiu detail must not use the generic Cloudflare fallback"),
            xueqiu_request=fake_xueqiu,
        )
        self.assertEqual(status, 200)
        self.assertEqual(payload["code"], "513100")
        self.assertEqual(calls, [("513100", True, False)])

    def test_xueqiu_fund_data_route_rejects_non_cn_symbol(self):
        status, payload = resolve_request(
            "/xueqiu-fund-data/AAPL",
            self.data_dir,
            self.service,
            xueqiu_request=lambda *_args: self.fail("invalid symbol must not fetch"),
        )
        self.assertEqual(status, 400)
        self.assertEqual(payload["error"], "invalid_cn_symbol")

    def test_unimplemented_market_route_fails_closed_locally(self):
        status, payload = resolve_request(
            "/profile/UNKNOWN",
            self.data_dir,
            self.service,
            proxy_request=lambda *_args: self.fail("missing market capability must not proxy to Cloudflare"),
        )
        self.assertEqual(status, 501)
        self.assertEqual(payload["error"], "collector_market_route_missing")


if __name__ == "__main__":
    unittest.main()
