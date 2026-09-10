from __future__ import annotations

import sqlite3
import tempfile
import unittest
from contextlib import closing
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from market_collector.storage import (
    DualWriteStore,
    MarketStore,
    SQLiteStore,
    ShardedTiDBStore,
    bucket_start_iso,
    build_store,
    logical_shard_for_symbol,
)


# 写死的历史日期会被 write_cycle 的 raw/bucket retention 清理（如 2026-08-11 已超 168h/14d 窗口），
# 改用「昨天」的固定时刻生成时间戳，保证永远落在 retention 窗口内，测试不再随时间腐烂。
RECENT_DAY = (datetime.now(ZoneInfo("Asia/Shanghai")) - timedelta(days=1)).date().isoformat()


def recent(hhmmss: str) -> str:
    return f"{RECENT_DAY}T{hhmmss}+08:00"


def sample(symbol: str, collected_at: str, price: float) -> dict:
    return {
        "symbol": symbol,
        "name": symbol,
        "category": "cross_border_etf",
        "session": "trading",
        "collected_at": collected_at,
        "price_timestamp": collected_at,
        "iopv_timestamp": collected_at,
        "price_received_at": collected_at,
        "iopv_received_at": collected_at,
        "price": price,
        "iopv": 2.0,
        "computed_premium_percent": round((price - 2.0) / 2.0 * 100, 4),
        "vendor_premium_percent": round((price - 2.0) / 2.0 * 100, 4),
        "vendor_discount_percent_raw": round(-((price - 2.0) / 2.0 * 100), 4),
        "mismatch_pp": 0.0,
        "expires_at": "2026-08-11T10:01:00+08:00",
        "ttl_sec": 90,
        "sources": {"price": "tencent_batch", "iopv": "eastmoney_push2delay"},
        "quality": {"status": "ok", "issues": []},
        "debug": {"eastmoney_page": 1},
    }


def fund_reference(data_kind: str, symbol: str, snapshot_date: str = "2026-08-12") -> dict:
    return {
        "data_kind": data_kind,
        "symbol": symbol,
        "snapshot_date": snapshot_date,
        "fetched_at": snapshot_date + "T22:30:00+08:00",
        "source": "worker:" + data_kind.replace("_", "-"),
        "payload": {"code": symbol, "value": snapshot_date},
    }


class StorageTest(unittest.TestCase):
    def test_bucket_floor_is_deterministic(self) -> None:
        self.assertEqual(bucket_start_iso("2026-08-11T10:04:59+08:00"), "2026-08-11T10:00:00+08:00")
        self.assertEqual(bucket_start_iso("2026-08-11T10:05:00+08:00"), "2026-08-11T10:05:00+08:00")

    def test_latest_sample_wins_inside_bucket(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = str(Path(temp_dir) / "collector.sqlite3")
            store = SQLiteStore(path)
            store.initialize()
            store.write_cycle(
                [
                    sample("513100", recent("10:01:00"), 2.10),
                    sample("513100", recent("10:04:59"), 2.20),
                ],
                raw_retention_hours=48,
                bucket_retention_days=14,
            )
            conn = sqlite3.connect(path)
            row = conn.execute(
                "SELECT sample_count, last_sample_at, price FROM buckets_5m WHERE symbol = ? AND bucket_start = ?",
                ("513100", recent("10:00:00")),
            ).fetchone()
            conn.close()

            self.assertEqual(row[0], 2)
            self.assertEqual(row[1], recent("10:04:59"))
            self.assertEqual(row[2], 2.2)

    def test_buckets_1m_written_alongside_5m(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = str(Path(temp_dir) / "collector.sqlite3")
            store = SQLiteStore(path)
            store.initialize()
            store.write_cycle(
                [
                    sample("513100", recent("10:01:10"), 2.10),
                    sample("513100", recent("10:01:50"), 2.15),
                    sample("513100", recent("10:02:30"), 2.20),
                ],
                raw_retention_hours=48,
                bucket_retention_days=14,
            )
            conn = sqlite3.connect(path)
            rows_1m = conn.execute(
                "SELECT bucket_start, sample_count, price FROM buckets_1m ORDER BY bucket_start",
            ).fetchall()
            rows_5m = conn.execute(
                "SELECT count(*) FROM buckets_5m",
            ).fetchone()[0]
            conn.close()

            self.assertEqual(len(rows_1m), 2)
            self.assertEqual(rows_1m[0][0], recent("10:01:00"))
            self.assertEqual(rows_1m[0][1], 2)
            self.assertEqual(rows_1m[0][2], 2.15)
            self.assertEqual(rows_1m[1][0], recent("10:02:00"))
            self.assertEqual(rows_1m[1][1], 1)
            self.assertEqual(rows_1m[1][2], 2.2)
            self.assertEqual(rows_5m, 1)

    def test_lunch_session_does_not_create_bucket(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = str(Path(temp_dir) / "collector.sqlite3")
            store = SQLiteStore(path)
            store.initialize()
            item = sample("513100", "2026-08-11T11:35:00+08:00", 2.10)
            item["session"] = "lunch"
            store.write_cycle([item], raw_retention_hours=168, bucket_retention_days=14)
            conn = sqlite3.connect(path)
            bucket_count = conn.execute("SELECT count(*) FROM buckets_5m").fetchone()[0]
            conn.close()

            self.assertEqual(bucket_count, 0)

    def test_duplicate_cycle_is_idempotent(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = str(Path(temp_dir) / "collector.sqlite3")
            store = SQLiteStore(path)
            store.initialize()
            item = sample("513100", recent("10:01:00"), 2.10)
            store.write_cycle([item], raw_retention_hours=168, bucket_retention_days=14)
            store.write_cycle([item], raw_retention_hours=168, bucket_retention_days=14)
            conn = sqlite3.connect(path)
            raw_count = conn.execute("SELECT count(*) FROM raw_samples").fetchone()[0]
            bucket_row = conn.execute("SELECT sample_count FROM buckets_5m").fetchone()
            conn.close()

            self.assertEqual(raw_count, 1)
            self.assertEqual(bucket_row[0], 1)

    def test_read_raw_samples_decodes_and_filters_by_session(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            store = SQLiteStore(str(Path(temp_dir) / "collector.sqlite3"))
            store.initialize()
            trading = sample("513100", recent("10:01:00"), 2.10)
            lunch = sample("513100", recent("11:31:00"), 2.20)
            lunch["session"] = "lunch"
            store.write_cycle([lunch, trading], raw_retention_hours=168, bucket_retention_days=14)

            self.assertEqual(store.read_raw_samples("513100"), [trading])
            self.assertEqual(store.read_raw_samples("513100", session="lunch"), [lunch])

    def test_sqlite_fund_reference_is_idempotent_and_reads_latest_valid_source(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = str(Path(temp_dir) / "collector.sqlite3")
            store = SQLiteStore(path)
            store.initialize()
            older = fund_reference("fund_fee", "000001", "2026-08-11")
            latest = fund_reference("fund_fee", "000001", "2026-08-12")
            store.write_fund_reference_snapshots([older, latest], retention_days=400)
            store.write_fund_reference_snapshots([latest], retention_days=400)
            with closing(store.connect()) as conn:
                conn.execute(
                    """
                    INSERT INTO fund_reference_snapshots (
                        data_kind, symbol, snapshot_date, fetched_at, source, payload_json
                    ) VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        "fund_fee", "000001", "2026-08-13",
                        "2026-08-13T22:30:00+08:00", "unexpected-source",
                        '{"code":"000001","value":"bad"}',
                    ),
                )
                conn.commit()
                count = conn.execute(
                    "SELECT count(*) FROM fund_reference_snapshots"
                ).fetchone()[0]

            self.assertEqual(count, 3)
            self.assertEqual(
                store.read_latest_fund_references("fund_fee", ["000001"]),
                {"000001": latest["payload"]},
            )

    def test_fund_reference_write_rejects_source_or_payload_code_mismatch(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            store = SQLiteStore(str(Path(temp_dir) / "collector.sqlite3"))
            store.initialize()
            wrong_source = fund_reference("fund_limit", "000001")
            wrong_source["source"] = "worker:fund-fee"
            with self.assertRaisesRegex(ValueError, "invalid fund reference source"):
                store.write_fund_reference_snapshots([wrong_source], retention_days=400)
            wrong_code = fund_reference("fund_limit", "000001")
            wrong_code["payload"]["code"] = "000002"
            with self.assertRaisesRegex(ValueError, "payload code mismatch"):
                store.write_fund_reference_snapshots([wrong_code], retention_days=400)

    def test_build_store_defaults_to_sqlite_contract(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = str(Path(temp_dir) / "collector.sqlite3")
            store = build_store({"database_path": path})

            self.assertIsInstance(store, SQLiteStore)
            self.assertIsInstance(store, MarketStore)
            self.assertEqual(store.backend_name, "sqlite")

    def test_build_store_rejects_unknown_backend(self) -> None:
        with self.assertRaisesRegex(ValueError, "unsupported storage backend: postgres"):
            build_store({"storage_backend": "postgres", "database_path": "unused"})

    def test_logical_shards_are_stable_and_support_five_targets(self) -> None:
        config = {
            "replica_id": "tidb",
            "logical_shards": 5,
            "targets": [
                {
                    "id": f"tidb_{slot + 1}",
                    "slots": [slot],
                    "host": f"gateway-{slot + 1}.example.com",
                    "user": "root",
                    "database": "ai_dca_market",
                    "password_file": "/not/read/during/configuration",
                }
                for slot in range(5)
            ],
        }
        store = ShardedTiDBStore(config)

        self.assertEqual(store.shard_layout(), {slot: f"tidb_{slot + 1}" for slot in range(5)})
        self.assertEqual(store.shard_for_symbol("513100"), logical_shard_for_symbol("513100", 5))
        self.assertEqual(
            store.target_for_symbol("513100").target_id,
            f"tidb_{store.shard_for_symbol('513100') + 1}",
        )

    def test_tidb_shards_require_complete_non_overlapping_slot_assignment(self) -> None:
        with self.assertRaisesRegex(ValueError, "assigned to both"):
            ShardedTiDBStore({
                "logical_shards": 2,
                "targets": [
                    {"id": "one", "slots": [0], "host": "one", "user": "root"},
                    {"id": "two", "slots": [0, 1], "host": "two", "user": "root"},
                ],
            })
        with self.assertRaisesRegex(ValueError, "unassigned TiDB logical slots"):
            ShardedTiDBStore({
                "logical_shards": 2,
                "targets": [
                    {"id": "one", "slots": [0], "host": "one", "user": "root"},
                ],
            })

    def test_dual_write_outbox_retries_replica_without_blocking_sqlite(self) -> None:
        class FakeReplica:
            backend_name = "tidb"
            replica_id = "tidb"

            def __init__(self) -> None:
                self.fail = True
                self.records: list[dict] = []

            def initialize(self) -> None:
                pass

            def write_cycle(self, records, raw_retention_hours, bucket_retention_days) -> None:
                if self.fail:
                    raise OSError("temporary TiDB outage")
                self.records.extend(records)

            def read_raw_samples(self, symbol, session="trading") -> list[dict]:
                return []

        with tempfile.TemporaryDirectory() as temp_dir:
            primary = SQLiteStore(str(Path(temp_dir) / "collector.sqlite3"))
            replica = FakeReplica()
            store = DualWriteStore(primary, [replica], outbox_batch_size=20)
            store.initialize()
            first = sample("513100", recent("10:01:00"), 2.10)
            second = sample("513100", recent("10:02:00"), 2.11)

            store.write_cycle([first], 168, 14)

            self.assertEqual(primary.read_raw_samples("513100"), [first])
            self.assertEqual(primary.replica_outbox_count("tidb"), 1)
            replica.fail = False

            store.write_cycle([second], 168, 14)

            self.assertEqual(replica.records, [first, second])
            self.assertEqual(primary.replica_outbox_count("tidb"), 0)
            self.assertEqual(store.read_raw_samples("513100"), [first, second])

    def test_primary_write_and_outbox_enqueue_are_atomic(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            primary = SQLiteStore(str(Path(temp_dir) / "collector.sqlite3"))
            primary.initialize()
            with closing(primary.connect()) as conn:
                conn.execute(
                    """
                    CREATE TRIGGER reject_replica_outbox
                    BEFORE INSERT ON replica_outbox
                    BEGIN
                        SELECT RAISE(ABORT, 'outbox unavailable');
                    END
                    """
                )
            item = sample("513100", "2026-08-11T10:01:00+08:00", 2.10)

            with self.assertRaisesRegex(sqlite3.IntegrityError, "outbox unavailable"):
                primary.write_cycle_and_enqueue_replicas([item], ["tidb"], 168, 14)

            self.assertEqual(primary.read_raw_samples("513100"), [])
            self.assertEqual(primary.replica_outbox_count("tidb"), 0)

    def test_fund_reference_primary_write_and_outbox_are_atomic(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            primary = SQLiteStore(str(Path(temp_dir) / "collector.sqlite3"))
            primary.initialize()
            with closing(primary.connect()) as conn:
                conn.execute(
                    """
                    CREATE TRIGGER reject_fund_reference_outbox
                    BEFORE INSERT ON fund_reference_outbox
                    BEGIN
                        SELECT RAISE(ABORT, 'fund outbox unavailable');
                    END
                    """
                )
            item = fund_reference("fund_limit", "000001")

            with self.assertRaisesRegex(sqlite3.IntegrityError, "fund outbox unavailable"):
                primary.write_fund_references_and_enqueue_replicas(
                    [item], ["tidb"], retention_days=400
                )

            self.assertEqual(primary.read_latest_fund_references("fund_limit", ["000001"]), {})
            self.assertEqual(primary.fund_reference_outbox_count("tidb"), 0)

    def test_dual_fund_reference_outbox_retries_replica(self) -> None:
        class FakeReplica:
            backend_name = "tidb"
            replica_id = "tidb"

            def __init__(self) -> None:
                self.fail = True
                self.references: list[dict] = []

            def initialize(self) -> None:
                pass

            def write_fund_reference_snapshots(self, records, retention_days) -> None:
                if self.fail:
                    raise OSError("temporary TiDB outage")
                self.references.extend(records)

            def write_cycle(self, records, raw_retention_hours, bucket_retention_days) -> None:
                pass

            def read_raw_samples(self, symbol, session="trading") -> list[dict]:
                return []

            def read_latest_fund_references(self, data_kind, symbols) -> dict:
                return {}

        with tempfile.TemporaryDirectory() as temp_dir:
            primary = SQLiteStore(str(Path(temp_dir) / "collector.sqlite3"))
            replica = FakeReplica()
            store = DualWriteStore(primary, [replica], outbox_batch_size=20)
            store.initialize()
            first = fund_reference("fund_fee", "000001")
            second = fund_reference("fund_limit", "000001")

            store.write_fund_reference_snapshots([first], retention_days=400)
            self.assertEqual(primary.fund_reference_outbox_count("tidb"), 1)
            self.assertEqual(
                store.read_latest_fund_references("fund_fee", ["000001"]),
                {"000001": first["payload"]},
            )
            replica.fail = False
            store.write_fund_reference_snapshots([second], retention_days=400)

            self.assertEqual(replica.references, [first, second])
            self.assertEqual(primary.fund_reference_outbox_count("tidb"), 0)

    def test_build_store_creates_dual_backend_with_single_target_owning_all_slots(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            store = build_store({
                "storage_backend": "dual",
                "database_path": str(Path(temp_dir) / "collector.sqlite3"),
                "storage": {
                    "tidb": {
                        "logical_shards": 5,
                        "targets": [{
                            "id": "tidb_1",
                            "host": "gateway.example.com",
                            "user": "root",
                            "password_file": "/not/read/during/configuration",
                        }],
                    },
                },
            })

            self.assertIsInstance(store, DualWriteStore)
            self.assertEqual(store.backend_name, "sqlite")
            self.assertEqual(store.replicas[0].shard_layout(), {slot: "tidb_1" for slot in range(5)})


if __name__ == "__main__":
    unittest.main()
