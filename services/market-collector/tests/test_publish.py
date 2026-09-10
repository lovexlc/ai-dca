from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from market_collector.publish import ReplicatingPublisher


class FakeResponse:
    status = 200

    def __init__(self, payload: dict | None = None) -> None:
        self.payload = payload or {"ok": True}

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self) -> bytes:
        return json.dumps(self.payload).encode()


class PublishTests(unittest.TestCase):
    def payloads(self):
        latest = {"generated_at": "2026-08-11T09:30:00+08:00", "symbols": [{"symbol": "513100", "price": 2.1}]}
        health = {"generated_at": latest["generated_at"], "healthy_symbols": 1}
        return latest, health

    def test_replica_writes_files_and_posts_authenticated_envelope(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ, {"TEST_COLLECTOR_TOKEN": "secret"}):
            requests = []

            def opener(request, timeout):
                requests.append((request, timeout))
                return FakeResponse()

            publisher = ReplicatingPublisher(tmp, "https://worker.test/ingest", "TEST_COLLECTOR_TOKEN", f"{tmp}/outbox", opener=opener)
            latest, health = self.payloads()
            publisher.publish(latest, health)

            self.assertEqual(json.loads(Path(tmp, "latest.json").read_text()), latest)
            self.assertEqual(requests[0][0].headers["X-market-collector-token"], "secret")
            self.assertEqual(json.loads(requests[0][0].data), {"latest": latest, "health": health})
            self.assertEqual(list(Path(tmp, "outbox").glob("*.json")), [])

    def test_failed_replica_is_spooled_and_retried_before_next_payload(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ, {"TEST_COLLECTOR_TOKEN": "secret"}):
            def failing(_request, timeout):
                raise OSError(f"offline after {timeout}")

            publisher = ReplicatingPublisher(tmp, "https://worker.test/ingest", "TEST_COLLECTOR_TOKEN", f"{tmp}/outbox", opener=failing)
            latest, health = self.payloads()
            publisher.publish(latest, health)
            self.assertEqual(len(list(Path(tmp, "outbox").glob("*.json"))), 1)

            replayed = []

            def working(request, timeout):
                replayed.append(json.loads(request.data))
                return FakeResponse()

            publisher.opener = working
            later = {**latest, "generated_at": "2026-08-11T09:35:00+08:00"}
            publisher.publish(later, health)
            self.assertEqual([item["latest"]["generated_at"] for item in replayed], [latest["generated_at"], later["generated_at"]])
            self.assertEqual(list(Path(tmp, "outbox").glob("*.json")), [])


if __name__ == "__main__":
    unittest.main()
