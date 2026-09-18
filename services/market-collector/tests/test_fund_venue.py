from __future__ import annotations

import json
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

from market_collector.fund_venue import FUND_VENUE_CACHE, classify_fund_venues


class FakeResponse:
    def __init__(self, payload):
        self.payload = json.dumps(payload).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return self.payload


class FundVenueTest(unittest.TestCase):
    def setUp(self) -> None:
        FUND_VENUE_CACHE.clear()

    def tearDown(self) -> None:
        FUND_VENUE_CACHE.clear()

    def test_search_and_catalog_classification(self):
        rows = {
            "539001": {
                "Code": "539001",
                "Name": "建信纳斯达克100指数(QDII)A人民币",
                "SecurityTypeName": "开放式基金",
                "TypeName": "FUND",
            },
            "513100": {
                "Code": "513100",
                "Name": "纳指ETF国泰",
                "SecurityTypeName": "ETF",
                "TypeName": "QDII-ETF",
                "MktNum": "1",
            },
            "161130": {
                "Code": "161130",
                "Name": "易方达纳斯达克100ETF联接(QDII-LOF)A人民币",
                "SecurityTypeName": "LOF",
                "TypeName": "QDII-LOF",
                "MktNum": "0",
            },
        }

        def fake_urlopen(request, timeout):
            self.assertEqual(timeout, 5.0)
            code = parse_qs(urlparse(request.full_url).query)["input"][0]
            return FakeResponse({"QuotationCodeTable": {"Data": [rows[code]]}})

        with patch("market_collector.fund_venue.urlopen", side_effect=fake_urlopen):
            payload = classify_fund_venues(["539001", "513100", "161130"])

        by_code = {item["code"]: item for item in payload["items"]}
        self.assertEqual(by_code["539001"]["fundVenue"], "otc")
        self.assertEqual(by_code["539001"]["fundKind"], "qdii")
        self.assertEqual(by_code["513100"]["fundVenue"], "exchange")
        self.assertEqual(by_code["161130"]["fundVenue"], "")
        self.assertTrue(by_code["161130"]["ambiguous"])
        self.assertEqual(
            {candidate["fundVenue"] for candidate in by_code["161130"]["candidates"]},
            {"exchange", "otc"},
        )
        self.assertEqual(payload["successCount"], 3)

    def test_known_prefix_fallback_works_when_search_is_unavailable(self):
        with patch("market_collector.fund_venue.urlopen", side_effect=OSError("upstream unavailable")):
            payload = classify_fund_venues(["539001", "513100"])

        by_code = {item["code"]: item for item in payload["items"]}
        self.assertEqual(by_code["539001"]["fundKind"], "qdii")
        self.assertEqual(by_code["513100"]["fundKind"], "exchange")
        self.assertEqual(payload["failureCount"], 0)


if __name__ == "__main__":
    unittest.main()
