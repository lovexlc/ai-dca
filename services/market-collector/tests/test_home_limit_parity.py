import tempfile
import unittest
from market_collector.aggregates import MarketDataService

class Store:
    backend_name = "test"
    def __init__(self, rows): self.rows = rows
    def read_fund_reference_history(self, kind, days): return self.rows

def row(code, day, **payload):
    return {"symbol": code, "snapshot_date": day, "fetched_at": day + "T22:30:00+08:00", "payload": payload}

class HomeLimitParityTest(unittest.TestCase):
    def test_multiple_currencies_records_and_events(self):
        rows = [
            row("022523", "2026-09-06", fundName="旧名称", currency="CNY", buyStatus="limit_large", maxPurchasePerDay=100),
            row("022523", "2026-09-07", fundName="旧名称", currency="CNY", buyStatus="limit_large", maxPurchasePerDay=50, limitChannel="app"),
            row("999999", "2026-09-06", fundName="美元基金", currency="USD", buyStatus="suspend", maxPurchasePerDay=20),
            row("999999", "2026-09-07", fundName="美元基金", currency="USD", buyStatus="limit_large", maxPurchasePerDay=30),
        ]
        result = MarketDataService(Store(rows), tempfile.mkdtemp()).fund_limit_overview()
        self.assertEqual([x["currency"] for x in result["currencyTotals"]], ["CNY", "USD"])
        self.assertEqual(len(result["records"]), 2)
        cny = next(x for x in result["records"] if x["code"] == "022523")
        self.assertEqual(cny["name"], "天弘标普500发起(QDII-FOF)D")
        self.assertEqual(cny["appLabel"], "基金公司 App")
        self.assertEqual(next(x for x in result["currencyTotals"] if x["currency"] == "USD")["amount"], 30)
        self.assertEqual({x["type"] for x in result["events"]}, {"tighten", "resume"})

if __name__ == "__main__": unittest.main()
