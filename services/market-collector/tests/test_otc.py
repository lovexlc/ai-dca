from __future__ import annotations

import unittest

from market_collector.otc import fetch_otc_metrics


class OtcCollectorTest(unittest.TestCase):
    def test_batch_snapshot_normalizes_timezone(self) -> None:
        calls = []

        def client(_url, payload, _timeout):
            calls.append(payload["codes"])
            return {"items": [{
                "ok": True, "code": code, "name": code,
                "latestNav": 1.23, "latestNavDate": "2026-08-10",
                "asOf": "2026-08-11T12:00:00Z",
            } for code in payload["codes"]]}

        symbols = [f"{index:06d}" for index in range(21)]
        payload = fetch_otc_metrics(symbols, client=client)
        self.assertEqual(len(calls), 2)
        self.assertEqual(payload["success_count"], 21)
        self.assertEqual(payload["failure_count"], 0)
        self.assertEqual(payload["items"][0]["asOf"], "2026-08-11T20:00:00+08:00")


if __name__ == "__main__":
    unittest.main()
