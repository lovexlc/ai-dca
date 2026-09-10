from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from market_collector.product_snapshot import (
    ProductSnapshotService,
    normalize_product_row,
)


class FakeMarketStore:
    pass


class FakeProductStore:
    def __init__(self, rows):
        self.rows = rows
        self.calls = 0

    def read_products(self):
        self.calls += 1
        return self.rows


class ProductSnapshotTest(unittest.TestCase):
    def test_summary_columns_match_test_snapshot_contract(self) -> None:
        item = normalize_product_row({
            "code": "513100",
            "name": "纳指ETF国泰",
            "price": 2.25,
            "as_of": "2026-09-07T09:30:00+08:00",
            "return_1w": 1.1,
            "return_1m": 2.2,
            "return_3m": 3.3,
            "return_6m": 6.6,
            "return_1y": 12.3,
            "return_base": 88.8,
            "ytd_return": 9.9,
            "historical_percentile": 73.5,
            "drawdown_percentile": 20.0,
            "high_drawdown": -8.0,
            "close_high_drawdown": -7.5,
            "high_point": 2.6,
            "high_point_date": "2026-08-01",
            "close_high_point": 2.55,
            "close_high_point_date": "2026-08-02",
        })
        self.assertEqual(item["return1m"], 2.2)
        self.assertEqual(item["return3m"], 3.3)
        self.assertEqual(item["return1y"], 12.3)
        self.assertEqual(item["historicalPercentile"], 73.5)
        self.assertEqual(item["currentYearPercent"], 9.9)
        self.assertEqual(item["highPoint"]["high"], 2.6)

    def test_quote_and_fund_metrics_use_one_cached_product_snapshot(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            data_dir = Path(temp_dir)
            (data_dir / "latest.json").write_text(
                json.dumps({"symbols": [{
                    "symbol": "513100",
                    "name": "纳指ETF国泰",
                    "price": 2.2,
                    "collected_at": "2026-09-07T09:29:00+08:00",
                }]}),
                encoding="utf-8",
            )
            products = FakeProductStore({
                "513100": {
                    "code": "513100",
                    "symbol": "513100",
                    "price": 2.25,
                    "return1m": 2.2,
                    "return3m": 3.3,
                    "return1y": 12.3,
                    "historicalPercentile": 73.5,
                    "asOf": "2026-09-07T09:30:00+08:00",
                }
            })
            service = ProductSnapshotService(FakeMarketStore(), data_dir, products)
            quote = service.quote("513100")
            items = service.fund_metrics(["513100"])
            self.assertEqual(quote["price"], 2.25)
            self.assertEqual(items[0]["return1m"], 2.2)
            self.assertEqual(products.calls, 1)


if __name__ == "__main__":
    unittest.main()
