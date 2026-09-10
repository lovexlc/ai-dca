import json
import tempfile
import unittest
from pathlib import Path
from market_collector.aggregates import HOME_BREADTH_SYMBOLS, MarketDataService

class Store:
    backend_name = "test"
    def read_fund_reference_history(self, kind, days): return []

class HomeSnapshotParityTest(unittest.TestCase):
    def test_breadth_only_counts_mini_program_pool(self):
        folder = Path(tempfile.mkdtemp())
        symbols = [{"symbol": code, "change_percent": 1, "computed_premium_percent": 2, "price": 1} for code in HOME_BREADTH_SYMBOLS]
        symbols += [{"symbol": "019736", "change_percent": -1, "computed_premium_percent": 9, "price": 1}]
        (folder / "latest.json").write_text(json.dumps({"generated_at": "2026-09-08T10:30:00+08:00", "symbols": symbols}))
        result = MarketDataService(Store(), folder).home_overview()
        self.assertEqual(result["breadth"]["riseCount"], len(HOME_BREADTH_SYMBOLS))
        self.assertEqual(result["breadth"]["fallCount"], 0)
        self.assertEqual(result["coverage"]["price"]["total"], 21)

    def test_limit_snapshot_matches_collection_contract(self):
        folder = Path(tempfile.mkdtemp())
        snapshot = {"asOf": "2026-09-08T08:14:00+08:00", "summary": {"totalByCurrency": {"CNY": 1670, "USD": 72}, "coveredFundCount": 2, "expectedFundCount": 2}, "records": [{"code": "019736", "fundName": "宝盈纳斯达克100", "currency": "CNY", "purchaseStatus": "limited", "limitAmount": 200}], "trend": [{"date": "2026-09-07", "totalByCurrency": {"CNY": 1400, "USD": 46}}, {"date": "2026-09-08", "totalByCurrency": {"CNY": 1670, "USD": 72}}], "recentEvents": [{"type": "relax", "code": "019736", "fundName": "宝盈纳斯达克100", "before": 10, "after": 200, "effectiveAt": "2026-09-08"}]}
        (folder / "fund-limit-overview.json").write_text(json.dumps(snapshot))
        result = MarketDataService(Store(), folder).fund_limit_overview()
        self.assertEqual([x["amount"] for x in result["currencyTotals"]], [1670, 72])
        self.assertEqual(result["events"][0]["type"], "relax")
        self.assertEqual(result["events"][0]["previousAmount"], 10)

if __name__ == "__main__": unittest.main()
