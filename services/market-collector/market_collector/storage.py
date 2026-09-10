from __future__ import annotations

import json
import os
import re
import sqlite3
import sys
import threading
import time
import zlib
from collections import defaultdict
from contextlib import closing
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Mapping, Protocol, Sequence, runtime_checkable
from zoneinfo import ZoneInfo

SHANGHAI = ZoneInfo("Asia/Shanghai")
IDENTIFIER = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,47}$")


def parse_iso(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


def isoformat_z(value: datetime) -> str:
    return value.astimezone(SHANGHAI).replace(microsecond=0).isoformat()


def bucket_start_iso(value: str, step_seconds: int = 300) -> str:
    dt = parse_iso(value)
    epoch = int(dt.timestamp())
    floored = epoch - (epoch % step_seconds)
    return isoformat_z(datetime.fromtimestamp(floored, timezone.utc))


def canonical_timestamp(value: str) -> str:
    return isoformat_z(parse_iso(value))


def logical_shard_for_symbol(symbol: str, shard_count: int) -> int:
    if shard_count < 1:
        raise ValueError("logical shard count must be positive")
    return zlib.crc32(str(symbol).encode("utf-8")) % shard_count


def validate_fund_reference_record(record: Mapping[str, Any]) -> tuple[str, str, str, str, str, dict[str, Any]]:
    data_kind = str(record.get("data_kind") or "")
    if data_kind not in {"fund_fee", "fund_limit"}:
        raise ValueError(f"invalid fund reference data_kind: {data_kind!r}")
    symbol = str(record.get("symbol") or "")
    if not re.fullmatch(r"\d{6}", symbol):
        raise ValueError(f"invalid fund reference symbol: {symbol!r}")
    snapshot_date = str(record.get("snapshot_date") or "")
    try:
        datetime.strptime(snapshot_date, "%Y-%m-%d")
    except ValueError as exc:
        raise ValueError(f"invalid fund reference snapshot_date: {snapshot_date!r}") from exc
    fetched_at = canonical_timestamp(str(record.get("fetched_at") or ""))
    expected_source = "worker:" + data_kind.replace("_", "-")
    source = str(record.get("source") or "")
    if source != expected_source:
        raise ValueError(f"invalid fund reference source for {data_kind}: {source!r}")
    payload = record.get("payload")
    if not isinstance(payload, dict):
        raise ValueError("fund reference payload must be an object")
    payload_symbol = str(payload.get("code") or symbol)
    if payload_symbol != symbol:
        raise ValueError(f"fund reference payload code mismatch: {payload_symbol!r} != {symbol!r}")
    return data_kind, symbol, snapshot_date, fetched_at, source, dict(payload)


@runtime_checkable
class MarketStore(Protocol):
    backend_name: str

    def initialize(self) -> None:
        ...

    def write_cycle(
        self,
        records: list[dict[str, Any]],
        raw_retention_hours: int,
        bucket_retention_days: int,
    ) -> None:
        ...

    def read_raw_samples(self, symbol: str, session: str = "trading") -> list[dict[str, Any]]:
        ...

    def write_fund_reference_snapshots(
        self,
        records: list[dict[str, Any]],
        retention_days: int,
    ) -> None:
        ...

    def read_latest_fund_references(
        self,
        data_kind: str,
        symbols: Sequence[str],
    ) -> dict[str, dict[str, Any]]:
        ...

    def read_fund_reference_history(
        self,
        data_kind: str,
        days: int,
    ) -> list[dict[str, Any]]:
        ...


@dataclass(frozen=True)
class ReplicaOutboxItem:
    replica_id: str
    symbol: str
    collected_at: str
    record: dict[str, Any]
    raw_retention_hours: int
    bucket_retention_days: int


@dataclass(frozen=True)
class FundReferenceOutboxItem:
    replica_id: str
    data_kind: str
    symbol: str
    snapshot_date: str
    record: dict[str, Any]
    retention_days: int


class SQLiteStore:
    backend_name = "sqlite"

    def __init__(self, path: str) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA busy_timeout=5000")
        return connection

    def initialize(self) -> None:
        with closing(self.connect()) as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS raw_samples (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    symbol TEXT NOT NULL,
                    collected_at TEXT NOT NULL,
                    session TEXT NOT NULL,
                    price_timestamp TEXT,
                    iopv_timestamp TEXT,
                    price REAL,
                    iopv REAL,
                    computed_premium_percent REAL,
                    vendor_premium_percent REAL,
                    mismatch_pp REAL,
                    quality_status TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    UNIQUE(symbol, collected_at)
                );

                CREATE TABLE IF NOT EXISTS buckets_5m (
                    symbol TEXT NOT NULL,
                    bucket_start TEXT NOT NULL,
                    session TEXT NOT NULL,
                    sample_count INTEGER NOT NULL,
                    first_sample_at TEXT NOT NULL,
                    last_sample_at TEXT NOT NULL,
                    price REAL,
                    iopv REAL,
                    computed_premium_percent REAL,
                    vendor_premium_percent REAL,
                    mismatch_pp REAL,
                    quality_status TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    PRIMARY KEY (symbol, bucket_start)
                );

                CREATE TABLE IF NOT EXISTS buckets_1m (
                    symbol TEXT NOT NULL,
                    bucket_start TEXT NOT NULL,
                    session TEXT NOT NULL,
                    sample_count INTEGER NOT NULL,
                    first_sample_at TEXT NOT NULL,
                    last_sample_at TEXT NOT NULL,
                    price REAL,
                    iopv REAL,
                    computed_premium_percent REAL,
                    vendor_premium_percent REAL,
                    mismatch_pp REAL,
                    quality_status TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    PRIMARY KEY (symbol, bucket_start)
                );

                CREATE TABLE IF NOT EXISTS replica_outbox (
                    replica_id TEXT NOT NULL,
                    symbol TEXT NOT NULL,
                    collected_at TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    raw_retention_hours INTEGER NOT NULL,
                    bucket_retention_days INTEGER NOT NULL,
                    enqueued_at TEXT NOT NULL,
                    PRIMARY KEY (replica_id, symbol, collected_at)
                );

                CREATE TABLE IF NOT EXISTS fund_reference_snapshots (
                    data_kind TEXT NOT NULL,
                    symbol TEXT NOT NULL,
                    snapshot_date TEXT NOT NULL,
                    fetched_at TEXT NOT NULL,
                    source TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    PRIMARY KEY (data_kind, symbol, snapshot_date)
                );

                CREATE INDEX IF NOT EXISTS idx_fund_reference_latest
                ON fund_reference_snapshots (data_kind, symbol, snapshot_date DESC);

                CREATE TABLE IF NOT EXISTS fund_reference_outbox (
                    replica_id TEXT NOT NULL,
                    data_kind TEXT NOT NULL,
                    symbol TEXT NOT NULL,
                    snapshot_date TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    retention_days INTEGER NOT NULL,
                    enqueued_at TEXT NOT NULL,
                    PRIMARY KEY (replica_id, data_kind, symbol, snapshot_date)
                );
                """
            )

    def write_cycle(
        self,
        records: list[dict[str, Any]],
        raw_retention_hours: int,
        bucket_retention_days: int,
        _connection: sqlite3.Connection | None = None,
    ) -> None:
        if not records:
            return
        if _connection is None:
            with closing(self.connect()) as conn:
                self.write_cycle(
                    records,
                    raw_retention_hours,
                    bucket_retention_days,
                    _connection=conn,
                )
                conn.commit()
            return
        conn = _connection
        if conn is not None:
            for record in records:
                payload_json = json.dumps(record, ensure_ascii=False, sort_keys=True)
                cursor = conn.execute(
                    """
                    INSERT OR IGNORE INTO raw_samples (
                        symbol, collected_at, session, price_timestamp, iopv_timestamp, price, iopv,
                        computed_premium_percent, vendor_premium_percent, mismatch_pp, quality_status, payload_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        record["symbol"],
                        record["collected_at"],
                        record["session"],
                        record.get("price_timestamp"),
                        record.get("iopv_timestamp"),
                        record.get("price"),
                        record.get("iopv"),
                        record.get("computed_premium_percent"),
                        record.get("vendor_premium_percent"),
                        record.get("mismatch_pp"),
                        record["quality"]["status"],
                        payload_json,
                    ),
                )
                if cursor.rowcount == 0:
                    continue
                if record["session"] != "trading":
                    continue
                for table, step_seconds in (("buckets_5m", 300), ("buckets_1m", 60)):
                    self._upsert_bucket(conn, table, record, bucket_start_iso(record["collected_at"], step_seconds))
            cutoff_raw = isoformat_z(datetime.now(timezone.utc) - timedelta(hours=raw_retention_hours))
            cutoff_bucket = isoformat_z(datetime.now(timezone.utc) - timedelta(days=bucket_retention_days))
            conn.execute("DELETE FROM raw_samples WHERE collected_at < ?", (cutoff_raw,))
            conn.execute("DELETE FROM buckets_5m WHERE bucket_start < ?", (cutoff_bucket,))
            conn.execute("DELETE FROM buckets_1m WHERE bucket_start < ?", (cutoff_bucket,))

    def _upsert_bucket(
        self,
        conn: sqlite3.Connection,
        table: str,
        record: dict[str, Any],
        bucket_start: str,
    ) -> None:
        """单样本 upsert 到分钟桶表（5m/1m 同逻辑，仅 bucket_start 粒度不同）。"""
        payload_json = json.dumps(record, ensure_ascii=False, sort_keys=True)
        existing = conn.execute(
            f"SELECT * FROM {table} WHERE symbol = ? AND bucket_start = ?",
            (record["symbol"], bucket_start),
        ).fetchone()
        if existing is None:
            conn.execute(
                f"""
                INSERT INTO {table} (
                    symbol, bucket_start, session, sample_count, first_sample_at, last_sample_at,
                    price, iopv, computed_premium_percent, vendor_premium_percent, mismatch_pp,
                    quality_status, payload_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    record["symbol"],
                    bucket_start,
                    record["session"],
                    1,
                    record["collected_at"],
                    record["collected_at"],
                    record.get("price"),
                    record.get("iopv"),
                    record.get("computed_premium_percent"),
                    record.get("vendor_premium_percent"),
                    record.get("mismatch_pp"),
                    record["quality"]["status"],
                    payload_json,
                ),
            )
            return
        sample_count = int(existing["sample_count"]) + 1
        first_sample_at = min(str(existing["first_sample_at"]), record["collected_at"])
        last_sample_at = max(str(existing["last_sample_at"]), record["collected_at"])
        use_new = record["collected_at"] >= str(existing["last_sample_at"])
        conn.execute(
            f"""
            UPDATE {table}
            SET session = ?,
                sample_count = ?,
                first_sample_at = ?,
                last_sample_at = ?,
                price = ?,
                iopv = ?,
                computed_premium_percent = ?,
                vendor_premium_percent = ?,
                mismatch_pp = ?,
                quality_status = ?,
                payload_json = ?
            WHERE symbol = ? AND bucket_start = ?
            """,
            (
                record["session"] if use_new else existing["session"],
                sample_count,
                first_sample_at,
                last_sample_at,
                record.get("price") if use_new else existing["price"],
                record.get("iopv") if use_new else existing["iopv"],
                record.get("computed_premium_percent") if use_new else existing["computed_premium_percent"],
                record.get("vendor_premium_percent") if use_new else existing["vendor_premium_percent"],
                record.get("mismatch_pp") if use_new else existing["mismatch_pp"],
                record["quality"]["status"] if use_new else existing["quality_status"],
                payload_json if use_new else existing["payload_json"],
                record["symbol"],
                bucket_start,
            ),
        )

    def read_raw_samples(self, symbol: str, session: str = "trading") -> list[dict[str, Any]]:
        with closing(self.connect()) as conn:
            rows = conn.execute(
                """
                SELECT payload_json
                FROM raw_samples
                WHERE symbol = ? AND session = ?
                ORDER BY collected_at ASC
                """,
                (symbol, session),
            ).fetchall()
        samples: list[dict[str, Any]] = []
        for row in rows:
            try:
                payload = json.loads(str(row["payload_json"]))
            except (TypeError, ValueError, json.JSONDecodeError):
                continue
            if isinstance(payload, dict):
                samples.append(payload)
        return samples

    def write_fund_reference_snapshots(
        self,
        records: list[dict[str, Any]],
        retention_days: int,
        _connection: sqlite3.Connection | None = None,
    ) -> None:
        if not records:
            return
        if _connection is None:
            with closing(self.connect()) as conn:
                self.write_fund_reference_snapshots(records, retention_days, _connection=conn)
                conn.commit()
            return
        rows = []
        for record in records:
            data_kind, symbol, snapshot_date, fetched_at, source, payload = validate_fund_reference_record(record)
            rows.append((
                data_kind,
                symbol,
                snapshot_date,
                fetched_at,
                source,
                json.dumps(payload, ensure_ascii=False, sort_keys=True),
            ))
        _connection.executemany(
            """
            INSERT INTO fund_reference_snapshots (
                data_kind, symbol, snapshot_date, fetched_at, source, payload_json
            ) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(data_kind, symbol, snapshot_date) DO UPDATE SET
                fetched_at = excluded.fetched_at,
                source = excluded.source,
                payload_json = excluded.payload_json
            """,
            rows,
        )
        cutoff = (datetime.now(SHANGHAI).date() - timedelta(days=max(1, int(retention_days)))).isoformat()
        _connection.execute(
            "DELETE FROM fund_reference_snapshots WHERE snapshot_date < ?",
            (cutoff,),
        )

    def read_latest_fund_references(
        self,
        data_kind: str,
        symbols: Sequence[str],
    ) -> dict[str, dict[str, Any]]:
        if data_kind not in {"fund_fee", "fund_limit"}:
            return {}
        normalized = list(dict.fromkeys(str(symbol) for symbol in symbols if re.fullmatch(r"\d{6}", str(symbol))))
        if not normalized:
            return {}
        placeholders = ",".join("?" for _ in normalized)
        with closing(self.connect()) as conn:
            rows = conn.execute(
                f"""
                SELECT symbol, source, payload_json
                FROM fund_reference_snapshots
                WHERE data_kind = ? AND symbol IN ({placeholders})
                ORDER BY snapshot_date DESC, fetched_at DESC
                """,
                [data_kind, *normalized],
            ).fetchall()
        expected_source = "worker:" + data_kind.replace("_", "-")
        latest: dict[str, dict[str, Any]] = {}
        for row in rows:
            symbol = str(row["symbol"])
            if symbol in latest or str(row["source"]) != expected_source:
                continue
            try:
                payload = json.loads(str(row["payload_json"]))
            except (TypeError, ValueError, json.JSONDecodeError):
                continue
            if isinstance(payload, dict) and str(payload.get("code") or symbol) == symbol:
                latest[symbol] = payload
        return latest

    def read_fund_reference_history(
        self,
        data_kind: str,
        days: int,
    ) -> list[dict[str, Any]]:
        if data_kind not in {"fund_fee", "fund_limit"}:
            return []
        cutoff = (datetime.now(SHANGHAI).date() - timedelta(days=max(1, int(days)))).isoformat()
        with closing(self.connect()) as conn:
            rows = conn.execute(
                """
                SELECT symbol, snapshot_date, source, payload_json
                FROM fund_reference_snapshots
                WHERE data_kind = ? AND snapshot_date >= ?
                ORDER BY snapshot_date ASC, fetched_at ASC
                """,
                (data_kind, cutoff),
            ).fetchall()
        expected_source = "worker:" + data_kind.replace("_", "-")
        out: list[dict[str, Any]] = []
        for row in rows:
            if str(row["source"]) != expected_source:
                continue
            try:
                payload = json.loads(str(row["payload_json"]))
            except (TypeError, ValueError, json.JSONDecodeError):
                continue
            if isinstance(payload, dict):
                out.append({
                    "symbol": str(row["symbol"]),
                    "snapshot_date": str(row["snapshot_date"]),
                    "payload": payload,
                })
        return out

    def enqueue_fund_reference_replicas(
        self,
        replica_id: str,
        records: list[dict[str, Any]],
        retention_days: int,
        _connection: sqlite3.Connection | None = None,
    ) -> None:
        if not records:
            return
        enqueued_at = isoformat_z(datetime.now(timezone.utc))
        rows = []
        for record in records:
            data_kind, symbol, snapshot_date, fetched_at, source, payload = validate_fund_reference_record(record)
            normalized_record = {
                "data_kind": data_kind,
                "symbol": symbol,
                "snapshot_date": snapshot_date,
                "fetched_at": fetched_at,
                "source": source,
                "payload": payload,
            }
            rows.append((
                replica_id,
                data_kind,
                symbol,
                snapshot_date,
                json.dumps(normalized_record, ensure_ascii=False, sort_keys=True),
                max(1, int(retention_days)),
                enqueued_at,
            ))
        if _connection is None:
            with closing(self.connect()) as conn:
                self.enqueue_fund_reference_replicas(
                    replica_id, records, retention_days, _connection=conn
                )
                conn.commit()
            return
        _connection.executemany(
            """
            INSERT INTO fund_reference_outbox (
                replica_id, data_kind, symbol, snapshot_date,
                payload_json, retention_days, enqueued_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(replica_id, data_kind, symbol, snapshot_date) DO UPDATE SET
                payload_json = excluded.payload_json,
                retention_days = excluded.retention_days,
                enqueued_at = excluded.enqueued_at
            """,
            rows,
        )

    def write_fund_references_and_enqueue_replicas(
        self,
        records: list[dict[str, Any]],
        replica_ids: Sequence[str],
        retention_days: int,
    ) -> None:
        if not records:
            return
        with closing(self.connect()) as conn:
            self.write_fund_reference_snapshots(records, retention_days, _connection=conn)
            for replica_id in replica_ids:
                self.enqueue_fund_reference_replicas(
                    replica_id, records, retention_days, _connection=conn
                )
            conn.commit()

    def load_fund_reference_outbox(
        self,
        replica_id: str,
        limit: int = 500,
    ) -> list[FundReferenceOutboxItem]:
        with closing(self.connect()) as conn:
            rows = conn.execute(
                """
                SELECT replica_id, data_kind, symbol, snapshot_date,
                       payload_json, retention_days
                FROM fund_reference_outbox
                WHERE replica_id = ?
                ORDER BY enqueued_at ASC, snapshot_date ASC, data_kind ASC, symbol ASC
                LIMIT ?
                """,
                (replica_id, max(1, int(limit))),
            ).fetchall()
        items: list[FundReferenceOutboxItem] = []
        for row in rows:
            try:
                record = json.loads(str(row["payload_json"]))
            except (TypeError, ValueError, json.JSONDecodeError):
                continue
            if not isinstance(record, dict):
                continue
            items.append(FundReferenceOutboxItem(
                replica_id=str(row["replica_id"]),
                data_kind=str(row["data_kind"]),
                symbol=str(row["symbol"]),
                snapshot_date=str(row["snapshot_date"]),
                record=record,
                retention_days=int(row["retention_days"]),
            ))
        return items

    def delete_fund_reference_outbox(self, items: Sequence[FundReferenceOutboxItem]) -> None:
        if not items:
            return
        with closing(self.connect()) as conn:
            conn.executemany(
                """
                DELETE FROM fund_reference_outbox
                WHERE replica_id = ? AND data_kind = ? AND symbol = ? AND snapshot_date = ?
                """,
                [
                    (item.replica_id, item.data_kind, item.symbol, item.snapshot_date)
                    for item in items
                ],
            )
            conn.commit()

    def fund_reference_outbox_count(self, replica_id: str | None = None) -> int:
        with closing(self.connect()) as conn:
            if replica_id is None:
                row = conn.execute("SELECT count(*) FROM fund_reference_outbox").fetchone()
            else:
                row = conn.execute(
                    "SELECT count(*) FROM fund_reference_outbox WHERE replica_id = ?",
                    (replica_id,),
                ).fetchone()
        return int(row[0]) if row else 0

    def enqueue_replica_cycle(
        self,
        replica_id: str,
        records: list[dict[str, Any]],
        raw_retention_hours: int,
        bucket_retention_days: int,
        _connection: sqlite3.Connection | None = None,
    ) -> None:
        if not records:
            return
        enqueued_at = isoformat_z(datetime.now(timezone.utc))
        rows = [
            (
                replica_id,
                str(record["symbol"]),
                str(record["collected_at"]),
                json.dumps(record, ensure_ascii=False, sort_keys=True),
                raw_retention_hours,
                bucket_retention_days,
                enqueued_at,
            )
            for record in records
        ]
        if _connection is None:
            with closing(self.connect()) as conn:
                self.enqueue_replica_cycle(
                    replica_id,
                    records,
                    raw_retention_hours,
                    bucket_retention_days,
                    _connection=conn,
                )
                conn.commit()
            return
        _connection.executemany(
            """
            INSERT INTO replica_outbox (
                replica_id, symbol, collected_at, payload_json,
                raw_retention_hours, bucket_retention_days, enqueued_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(replica_id, symbol, collected_at) DO UPDATE SET
                payload_json = excluded.payload_json,
                raw_retention_hours = excluded.raw_retention_hours,
                bucket_retention_days = excluded.bucket_retention_days
            """,
            rows,
        )

    def write_cycle_and_enqueue_replicas(
        self,
        records: list[dict[str, Any]],
        replica_ids: Sequence[str],
        raw_retention_hours: int,
        bucket_retention_days: int,
    ) -> None:
        if not records:
            return
        with closing(self.connect()) as conn:
            self.write_cycle(
                records,
                raw_retention_hours,
                bucket_retention_days,
                _connection=conn,
            )
            for replica_id in replica_ids:
                self.enqueue_replica_cycle(
                    replica_id,
                    records,
                    raw_retention_hours,
                    bucket_retention_days,
                    _connection=conn,
                )
            conn.commit()

    def load_replica_outbox(self, replica_id: str, limit: int = 500) -> list[ReplicaOutboxItem]:
        with closing(self.connect()) as conn:
            rows = conn.execute(
                """
                SELECT replica_id, symbol, collected_at, payload_json,
                       raw_retention_hours, bucket_retention_days
                FROM replica_outbox
                WHERE replica_id = ?
                ORDER BY enqueued_at ASC, collected_at ASC
                LIMIT ?
                """,
                (replica_id, max(1, int(limit))),
            ).fetchall()
        items: list[ReplicaOutboxItem] = []
        for row in rows:
            try:
                record = json.loads(str(row["payload_json"]))
            except (TypeError, ValueError, json.JSONDecodeError):
                continue
            if not isinstance(record, dict):
                continue
            items.append(ReplicaOutboxItem(
                replica_id=str(row["replica_id"]),
                symbol=str(row["symbol"]),
                collected_at=str(row["collected_at"]),
                record=record,
                raw_retention_hours=int(row["raw_retention_hours"]),
                bucket_retention_days=int(row["bucket_retention_days"]),
            ))
        return items

    def delete_replica_outbox(self, items: Sequence[ReplicaOutboxItem]) -> None:
        if not items:
            return
        with closing(self.connect()) as conn:
            conn.executemany(
                """
                DELETE FROM replica_outbox
                WHERE replica_id = ? AND symbol = ? AND collected_at = ?
                """,
                [(item.replica_id, item.symbol, item.collected_at) for item in items],
            )
            conn.commit()

    def replica_outbox_count(self, replica_id: str | None = None) -> int:
        with closing(self.connect()) as conn:
            if replica_id is None:
                row = conn.execute("SELECT count(*) FROM replica_outbox").fetchone()
            else:
                row = conn.execute(
                    "SELECT count(*) FROM replica_outbox WHERE replica_id = ?",
                    (replica_id,),
                ).fetchone()
        return int(row[0]) if row else 0


@dataclass(frozen=True)
class TiDBTargetConfig:
    target_id: str
    slots: tuple[int, ...]
    host: str
    port: int
    user: str
    database: str
    password_file: str = ""
    password_env: str = ""
    ssl_ca: str = "/etc/ssl/certs/ca-certificates.crt"

    def password(self) -> str:
        if self.password_env:
            value = os.environ.get(self.password_env, "")
            if value:
                return value
        if self.password_file:
            return Path(self.password_file).read_text(encoding="utf-8").strip()
        raise ValueError(f"TiDB target {self.target_id} requires password_file or password_env")


def _identifier(value: Any, label: str) -> str:
    normalized = str(value or "").strip()
    if not IDENTIFIER.fullmatch(normalized):
        raise ValueError(f"invalid {label}: {normalized!r}")
    return normalized


def _chunks(values: Sequence[Any], size: int) -> list[Sequence[Any]]:
    return [values[index:index + size] for index in range(0, len(values), size)]


class ShardedTiDBStore:
    backend_name = "tidb"

    def __init__(
        self,
        config: Mapping[str, Any],
        connect_factory: Callable[..., Any] | None = None,
    ) -> None:
        self.replica_id = _identifier(config.get("replica_id") or "tidb", "replica_id")
        self.logical_shards = int(config.get("logical_shards") or 5)
        if not 1 <= self.logical_shards <= 64:
            raise ValueError("logical_shards must be between 1 and 64")
        self.table_prefix = _identifier(config.get("table_prefix") or "market_collector", "table_prefix")
        self.cleanup_interval_sec = max(60, int(config.get("cleanup_interval_sec") or 3600))
        raw_targets = config.get("targets") or []
        if not isinstance(raw_targets, list) or not raw_targets:
            raise ValueError("TiDB storage requires at least one target")
        targets: list[TiDBTargetConfig] = []
        assigned_slots: dict[int, str] = {}
        target_ids: set[str] = set()
        for index, raw in enumerate(raw_targets):
            if not isinstance(raw, Mapping):
                raise ValueError("each TiDB target must be an object")
            target_id = _identifier(raw.get("id") or f"tidb_{index + 1}", "TiDB target id")
            if target_id in target_ids:
                raise ValueError(f"duplicate TiDB target id: {target_id}")
            target_ids.add(target_id)
            slots_value = raw.get("slots")
            if slots_value is None and len(raw_targets) == 1:
                slots_value = list(range(self.logical_shards))
            slots = tuple(sorted({int(slot) for slot in (slots_value or [])}))
            if not slots:
                raise ValueError(f"TiDB target {target_id} has no logical slots")
            for slot in slots:
                if not 0 <= slot < self.logical_shards:
                    raise ValueError(f"TiDB target {target_id} has invalid logical slot {slot}")
                if slot in assigned_slots:
                    raise ValueError(
                        f"logical slot {slot} is assigned to both {assigned_slots[slot]} and {target_id}"
                    )
                assigned_slots[slot] = target_id
            targets.append(TiDBTargetConfig(
                target_id=target_id,
                slots=slots,
                host=str(raw.get("host") or "").strip(),
                port=int(raw.get("port") or 4000),
                user=str(raw.get("user") or "").strip(),
                database=_identifier(raw.get("database") or "ai_dca_market", "TiDB database"),
                password_file=str(raw.get("password_file") or "").strip(),
                password_env=str(raw.get("password_env") or "").strip(),
                ssl_ca=str(raw.get("ssl_ca") or "/etc/ssl/certs/ca-certificates.crt").strip(),
            ))
        expected_slots = set(range(self.logical_shards))
        missing_slots = sorted(expected_slots - set(assigned_slots))
        if missing_slots:
            raise ValueError(f"unassigned TiDB logical slots: {missing_slots}")
        for target in targets:
            if not target.host or not target.user:
                raise ValueError(f"TiDB target {target.target_id} requires host and user")
        self.targets = {target.target_id: target for target in targets}
        self.slot_targets = assigned_slots
        self._connect_factory = connect_factory
        self._connections: dict[str, Any] = {}
        self._lock = threading.RLock()
        self._initialized = False
        self._last_cleanup = 0.0
        self._last_reference_cleanup = 0.0

    def shard_for_symbol(self, symbol: str) -> int:
        return logical_shard_for_symbol(symbol, self.logical_shards)

    def target_for_symbol(self, symbol: str) -> TiDBTargetConfig:
        return self.targets[self.slot_targets[self.shard_for_symbol(symbol)]]

    def shard_layout(self) -> dict[int, str]:
        return dict(sorted(self.slot_targets.items()))

    def _table_names(self, slot: int) -> tuple[str, str]:
        return (
            f"{self.table_prefix}_raw_samples_{slot:02d}",
            f"{self.table_prefix}_buckets_5m_{slot:02d}",
        )

    def _bucket_table_names(self, slot: int) -> list[tuple[str, int]]:
        """分钟桶表 + 桶宽秒数；5m 供原有链路，1m 供首页溢价差/详情日 K 分时。"""
        return [
            (f"{self.table_prefix}_buckets_5m_{slot:02d}", 300),
            (f"{self.table_prefix}_buckets_1m_{slot:02d}", 60),
        ]

    def _reference_table_name(self, slot: int) -> str:
        return f"{self.table_prefix}_fund_reference_{slot:02d}"

    def _default_connect_factory(self, **kwargs: Any) -> Any:
        import pymysql
        return pymysql.connect(**kwargs)

    def _new_connection(self, target: TiDBTargetConfig) -> Any:
        factory = self._connect_factory or self._default_connect_factory
        return factory(
            host=target.host,
            port=target.port,
            user=target.user,
            password=target.password(),
            database=target.database,
            ssl_verify_cert=True,
            ssl_verify_identity=True,
            ssl_ca=target.ssl_ca,
            connect_timeout=15,
            read_timeout=20,
            write_timeout=20,
            autocommit=False,
            charset="utf8mb4",
        )

    def _connection(self, target: TiDBTargetConfig) -> Any:
        connection = self._connections.get(target.target_id)
        if connection is not None:
            try:
                connection.ping(reconnect=True)
                return connection
            except Exception:
                try:
                    connection.close()
                except Exception:
                    pass
                self._connections.pop(target.target_id, None)
        connection = self._new_connection(target)
        self._connections[target.target_id] = connection
        return connection

    def _drop_connection(self, target_id: str) -> None:
        connection = self._connections.pop(target_id, None)
        if connection is not None:
            try:
                connection.close()
            except Exception:
                pass

    def close(self) -> None:
        with self._lock:
            for target_id in list(self._connections):
                self._drop_connection(target_id)

    def initialize(self) -> None:
        with self._lock:
            for target in self.targets.values():
                connection = self._connection(target)
                try:
                    with connection.cursor() as cursor:
                        for slot in target.slots:
                            raw_table, _bucket_table = self._table_names(slot)
                            reference_table = self._reference_table_name(slot)
                            cursor.execute(f"""
                                CREATE TABLE IF NOT EXISTS `{raw_table}` (
                                    symbol VARCHAR(32) NOT NULL,
                                    collected_at VARCHAR(35) NOT NULL,
                                    session VARCHAR(32) NOT NULL,
                                    price_timestamp VARCHAR(35) NULL,
                                    iopv_timestamp VARCHAR(35) NULL,
                                    price DOUBLE NULL,
                                    iopv DOUBLE NULL,
                                    computed_premium_percent DOUBLE NULL,
                                    vendor_premium_percent DOUBLE NULL,
                                    mismatch_pp DOUBLE NULL,
                                    quality_status VARCHAR(32) NOT NULL,
                                    payload_json JSON NOT NULL,
                                    PRIMARY KEY (symbol, collected_at),
                                    KEY idx_session_collected (session, collected_at)
                                )
                            """)
                            bucket_ddl = """
                                CREATE TABLE IF NOT EXISTS `{bucket_table}` (
                                    symbol VARCHAR(32) NOT NULL,
                                    bucket_start VARCHAR(35) NOT NULL,
                                    session VARCHAR(32) NOT NULL,
                                    sample_count BIGINT NOT NULL,
                                    first_sample_at VARCHAR(35) NOT NULL,
                                    last_sample_at VARCHAR(35) NOT NULL,
                                    price DOUBLE NULL,
                                    iopv DOUBLE NULL,
                                    computed_premium_percent DOUBLE NULL,
                                    vendor_premium_percent DOUBLE NULL,
                                    mismatch_pp DOUBLE NULL,
                                    quality_status VARCHAR(32) NOT NULL,
                                    payload_json JSON NOT NULL,
                                    PRIMARY KEY (symbol, bucket_start)
                                )
                            """
                            for bucket_table, _step in self._bucket_table_names(slot):
                                cursor.execute(bucket_ddl.format(bucket_table=bucket_table))
                            cursor.execute(f"""
                                CREATE TABLE IF NOT EXISTS `{reference_table}` (
                                    data_kind VARCHAR(32) NOT NULL,
                                    symbol VARCHAR(32) NOT NULL,
                                    snapshot_date DATE NOT NULL,
                                    fetched_at VARCHAR(35) NOT NULL,
                                    source VARCHAR(64) NOT NULL,
                                    payload_json JSON NOT NULL,
                                    PRIMARY KEY (data_kind, symbol, snapshot_date),
                                    KEY idx_fund_reference_latest (
                                        data_kind, symbol, snapshot_date
                                    )
                                )
                            """)
                    connection.commit()
                except Exception:
                    try:
                        connection.rollback()
                    except Exception:
                        pass
                    self._drop_connection(target.target_id)
                    raise
            self._initialized = True

    def _existing_keys(
        self,
        cursor: Any,
        raw_table: str,
        records: Sequence[dict[str, Any]],
    ) -> set[tuple[str, str]]:
        existing: set[tuple[str, str]] = set()
        for chunk in _chunks(records, 200):
            placeholders = ",".join(["(%s,%s)"] * len(chunk))
            params: list[str] = []
            for record in chunk:
                params.extend([str(record["symbol"]), canonical_timestamp(str(record["collected_at"]))])
            cursor.execute(
                f"SELECT symbol, collected_at FROM `{raw_table}` "
                f"WHERE (symbol, collected_at) IN ({placeholders})",
                params,
            )
            existing.update((str(row[0]), str(row[1])) for row in cursor.fetchall())
        return existing

    def _write_slot(self, cursor: Any, slot: int, records: Sequence[dict[str, Any]]) -> None:
        raw_table, _bucket_table = self._table_names(slot)
        unique_records: dict[tuple[str, str], dict[str, Any]] = {}
        for record in records:
            key = (str(record["symbol"]), canonical_timestamp(str(record["collected_at"])))
            unique_records[key] = record
        candidates = list(unique_records.values())
        existing = self._existing_keys(cursor, raw_table, candidates)
        new_records = [
            record for key, record in unique_records.items()
            if key not in existing
        ]
        if not new_records:
            return
        raw_rows = []
        for record in new_records:
            raw_rows.append((
                str(record["symbol"]),
                canonical_timestamp(str(record["collected_at"])),
                str(record["session"]),
                record.get("price_timestamp"),
                record.get("iopv_timestamp"),
                record.get("price"),
                record.get("iopv"),
                record.get("computed_premium_percent"),
                record.get("vendor_premium_percent"),
                record.get("mismatch_pp"),
                str((record.get("quality") or {}).get("status") or "missing"),
                json.dumps(record, ensure_ascii=False, sort_keys=True),
            ))
        cursor.executemany(
            f"""
            INSERT IGNORE INTO `{raw_table}` (
                symbol, collected_at, session, price_timestamp, iopv_timestamp,
                price, iopv, computed_premium_percent, vendor_premium_percent,
                mismatch_pp, quality_status, payload_json
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            raw_rows,
        )
        def build_bucket_rows(step_seconds: int) -> list[tuple]:
            grouped: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
            for record in new_records:
                if record.get("session") != "trading":
                    continue
                collected_at = canonical_timestamp(str(record["collected_at"]))
                grouped[(str(record["symbol"]), bucket_start_iso(collected_at, step_seconds))].append(record)
            bucket_rows = []
            for (symbol, bucket_start), samples in grouped.items():
                ordered = sorted(samples, key=lambda item: parse_iso(str(item["collected_at"])))
                latest = ordered[-1]
                bucket_rows.append((
                    symbol,
                    bucket_start,
                    str(latest["session"]),
                    len(ordered),
                    canonical_timestamp(str(ordered[0]["collected_at"])),
                    canonical_timestamp(str(latest["collected_at"])),
                    latest.get("price"),
                    latest.get("iopv"),
                    latest.get("computed_premium_percent"),
                    latest.get("vendor_premium_percent"),
                    latest.get("mismatch_pp"),
                    str((latest.get("quality") or {}).get("status") or "missing"),
                    json.dumps(latest, ensure_ascii=False, sort_keys=True),
                ))
            return bucket_rows

        for bucket_table, step_seconds in self._bucket_table_names(slot):
            bucket_rows = build_bucket_rows(step_seconds)
            if not bucket_rows:
                continue
            cursor.executemany(
                f"""
                INSERT INTO `{bucket_table}` (
                    symbol, bucket_start, session, sample_count, first_sample_at, last_sample_at,
                    price, iopv, computed_premium_percent, vendor_premium_percent, mismatch_pp,
                    quality_status, payload_json
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE
                    session = IF(VALUES(last_sample_at) >= last_sample_at, VALUES(session), session),
                    price = IF(VALUES(last_sample_at) >= last_sample_at, VALUES(price), price),
                    iopv = IF(VALUES(last_sample_at) >= last_sample_at, VALUES(iopv), iopv),
                    computed_premium_percent = IF(
                        VALUES(last_sample_at) >= last_sample_at,
                        VALUES(computed_premium_percent), computed_premium_percent
                    ),
                    vendor_premium_percent = IF(
                        VALUES(last_sample_at) >= last_sample_at,
                        VALUES(vendor_premium_percent), vendor_premium_percent
                    ),
                    mismatch_pp = IF(VALUES(last_sample_at) >= last_sample_at, VALUES(mismatch_pp), mismatch_pp),
                    quality_status = IF(
                        VALUES(last_sample_at) >= last_sample_at,
                        VALUES(quality_status), quality_status
                    ),
                    payload_json = IF(
                        VALUES(last_sample_at) >= last_sample_at,
                        VALUES(payload_json), payload_json
                    ),
                    sample_count = sample_count + VALUES(sample_count),
                    first_sample_at = LEAST(first_sample_at, VALUES(first_sample_at)),
                    last_sample_at = GREATEST(last_sample_at, VALUES(last_sample_at))
                """,
                bucket_rows,
            )

    def write_cycle(
        self,
        records: list[dict[str, Any]],
        raw_retention_hours: int,
        bucket_retention_days: int,
    ) -> None:
        if not records:
            return
        with self._lock:
            if not self._initialized:
                self.initialize()
            by_target: dict[str, dict[int, list[dict[str, Any]]]] = defaultdict(lambda: defaultdict(list))
            for record in records:
                slot = self.shard_for_symbol(str(record["symbol"]))
                by_target[self.slot_targets[slot]][slot].append(record)
            cleanup_due = time.monotonic() - self._last_cleanup >= self.cleanup_interval_sec
            for target_id, slot_records in by_target.items():
                target = self.targets[target_id]
                connection = self._connection(target)
                try:
                    connection.begin()
                    with connection.cursor() as cursor:
                        for slot, grouped_records in slot_records.items():
                            self._write_slot(cursor, slot, grouped_records)
                        if cleanup_due:
                            cutoff_raw = isoformat_z(
                                datetime.now(timezone.utc) - timedelta(hours=raw_retention_hours)
                            )
                            cutoff_bucket = isoformat_z(
                                datetime.now(timezone.utc) - timedelta(days=bucket_retention_days)
                            )
                            for slot in target.slots:
                                raw_table, _bucket_table = self._table_names(slot)
                                cursor.execute(
                                    f"DELETE FROM `{raw_table}` WHERE collected_at < %s",
                                    (cutoff_raw,),
                                )
                                for bucket_table, _step in self._bucket_table_names(slot):
                                    cursor.execute(
                                        f"DELETE FROM `{bucket_table}` WHERE bucket_start < %s",
                                        (cutoff_bucket,),
                                    )
                    connection.commit()
                except Exception:
                    try:
                        connection.rollback()
                    except Exception:
                        pass
                    self._drop_connection(target_id)
                    self._initialized = False
                    raise
            if cleanup_due:
                self._last_cleanup = time.monotonic()

    def read_raw_samples(self, symbol: str, session: str = "trading") -> list[dict[str, Any]]:
        with self._lock:
            if not self._initialized:
                self.initialize()
            slot = self.shard_for_symbol(symbol)
            target = self.targets[self.slot_targets[slot]]
            raw_table, _ = self._table_names(slot)
            connection = self._connection(target)
            with connection.cursor() as cursor:
                cursor.execute(
                    f"""
                    SELECT payload_json
                    FROM `{raw_table}`
                    WHERE symbol = %s AND session = %s
                    ORDER BY collected_at ASC
                    """,
                    (symbol, session),
                )
                rows = cursor.fetchall()
        samples: list[dict[str, Any]] = []
        for row in rows:
            raw = row[0]
            if isinstance(raw, dict):
                samples.append(raw)
                continue
            try:
                payload = json.loads(raw.decode("utf-8") if isinstance(raw, bytes) else str(raw))
            except (TypeError, ValueError, json.JSONDecodeError):
                continue
            if isinstance(payload, dict):
                samples.append(payload)
        return samples

    def write_fund_reference_snapshots(
        self,
        records: list[dict[str, Any]],
        retention_days: int,
    ) -> None:
        if not records:
            return
        validated = [validate_fund_reference_record(record) for record in records]
        with self._lock:
            if not self._initialized:
                self.initialize()
            by_target: dict[str, dict[int, list[tuple[str, str, str, str, str, dict[str, Any]]]]] = defaultdict(
                lambda: defaultdict(list)
            )
            for item in validated:
                slot = self.shard_for_symbol(item[1])
                by_target[self.slot_targets[slot]][slot].append(item)
            cleanup_due = time.monotonic() - self._last_reference_cleanup >= self.cleanup_interval_sec
            for target_id, slot_records in by_target.items():
                target = self.targets[target_id]
                connection = self._connection(target)
                try:
                    connection.begin()
                    with connection.cursor() as cursor:
                        for slot, grouped_records in slot_records.items():
                            table = self._reference_table_name(slot)
                            cursor.executemany(
                                f"""
                                INSERT INTO `{table}` (
                                    data_kind, symbol, snapshot_date,
                                    fetched_at, source, payload_json
                                ) VALUES (%s, %s, %s, %s, %s, %s)
                                ON DUPLICATE KEY UPDATE
                                    fetched_at = VALUES(fetched_at),
                                    source = VALUES(source),
                                    payload_json = VALUES(payload_json)
                                """,
                                [
                                    (
                                        data_kind,
                                        symbol,
                                        snapshot_date,
                                        fetched_at,
                                        source,
                                        json.dumps(payload, ensure_ascii=False, sort_keys=True),
                                    )
                                    for data_kind, symbol, snapshot_date, fetched_at, source, payload
                                    in grouped_records
                                ],
                            )
                        if cleanup_due:
                            cutoff = (
                                datetime.now(SHANGHAI).date()
                                - timedelta(days=max(1, int(retention_days)))
                            ).isoformat()
                            for slot in target.slots:
                                table = self._reference_table_name(slot)
                                cursor.execute(
                                    f"DELETE FROM `{table}` WHERE snapshot_date < %s",
                                    (cutoff,),
                                )
                    connection.commit()
                except Exception:
                    try:
                        connection.rollback()
                    except Exception:
                        pass
                    self._drop_connection(target_id)
                    self._initialized = False
                    raise
            if cleanup_due:
                self._last_reference_cleanup = time.monotonic()

    def read_latest_fund_references(
        self,
        data_kind: str,
        symbols: Sequence[str],
    ) -> dict[str, dict[str, Any]]:
        if data_kind not in {"fund_fee", "fund_limit"}:
            return {}
        normalized = list(dict.fromkeys(str(symbol) for symbol in symbols if re.fullmatch(r"\d{6}", str(symbol))))
        if not normalized:
            return {}
        latest: dict[str, dict[str, Any]] = {}
        expected_source = "worker:" + data_kind.replace("_", "-")
        with self._lock:
            if not self._initialized:
                self.initialize()
            by_target: dict[str, dict[int, list[str]]] = defaultdict(lambda: defaultdict(list))
            for symbol in normalized:
                slot = self.shard_for_symbol(symbol)
                by_target[self.slot_targets[slot]][slot].append(symbol)
            for target_id, slot_symbols in by_target.items():
                connection = self._connection(self.targets[target_id])
                with connection.cursor() as cursor:
                    for slot, grouped_symbols in slot_symbols.items():
                        table = self._reference_table_name(slot)
                        placeholders = ",".join(["%s"] * len(grouped_symbols))
                        cursor.execute(
                            f"""
                            SELECT symbol, source, payload_json
                            FROM `{table}`
                            WHERE data_kind = %s AND symbol IN ({placeholders})
                            ORDER BY snapshot_date DESC, fetched_at DESC
                            """,
                            [data_kind, *grouped_symbols],
                        )
                        for row in cursor.fetchall():
                            symbol = str(row[0])
                            if symbol in latest or str(row[1]) != expected_source:
                                continue
                            raw = row[2]
                            try:
                                payload = raw if isinstance(raw, dict) else json.loads(
                                    raw.decode("utf-8") if isinstance(raw, bytes) else str(raw)
                                )
                            except (TypeError, ValueError, json.JSONDecodeError):
                                continue
                            if isinstance(payload, dict) and str(payload.get("code") or symbol) == symbol:
                                latest[symbol] = payload
        return latest

    def read_fund_reference_history(
        self,
        data_kind: str,
        days: int,
    ) -> list[dict[str, Any]]:
        if data_kind not in {"fund_fee", "fund_limit"}:
            return []
        cutoff = (datetime.now(SHANGHAI).date() - timedelta(days=max(1, int(days)))).isoformat()
        out: list[dict[str, Any]] = []
        with self._lock:
            if not self._initialized:
                self.initialize()
            for target in self.targets.values():
                connection = self._connection(target)
                with connection.cursor() as cursor:
                    for slot in target.slots:
                        table = self._reference_table_name(slot)
                        cursor.execute(
                            f"""
                            SELECT symbol, snapshot_date, source, payload_json
                            FROM `{table}`
                            WHERE data_kind = %s AND snapshot_date >= %s
                            ORDER BY snapshot_date ASC, fetched_at ASC
                            """,
                            (data_kind, cutoff),
                        )
                        for row in cursor.fetchall():
                            if str(row[2]) != "worker:" + data_kind.replace("_", "-"):
                                continue
                            raw = row[3]
                            try:
                                payload = raw if isinstance(raw, dict) else json.loads(
                                    raw.decode("utf-8") if isinstance(raw, bytes) else str(raw)
                                )
                            except (TypeError, ValueError, json.JSONDecodeError):
                                continue
                            if isinstance(payload, dict):
                                out.append({
                                    "symbol": str(row[0]),
                                    "snapshot_date": str(row[1]),
                                    "payload": payload,
                                })
        return out


class DualWriteStore:
    def __init__(
        self,
        primary: SQLiteStore,
        replicas: Sequence[MarketStore],
        *,
        outbox_batch_size: int = 500,
        flush_batches_per_cycle: int = 4,
        strict_initialize: bool = False,
    ) -> None:
        if not replicas:
            raise ValueError("dual storage requires at least one replica")
        self.primary = primary
        self.replicas = list(replicas)
        self.backend_name = primary.backend_name
        self.outbox_batch_size = max(1, int(outbox_batch_size))
        self.flush_batches_per_cycle = max(1, int(flush_batches_per_cycle))
        self.strict_initialize = strict_initialize

    @staticmethod
    def _replica_id(replica: MarketStore) -> str:
        return str(getattr(replica, "replica_id", replica.backend_name))

    def initialize(self) -> None:
        self.primary.initialize()
        for replica in self.replicas:
            try:
                replica.initialize()
                self._flush_replica(replica)
                self._flush_fund_reference_replica(replica)
            except Exception as exc:
                print(
                    f"[storage] replica initialize failed id={self._replica_id(replica)}: {exc}",
                    file=sys.stderr,
                )
                if self.strict_initialize:
                    raise

    def _flush_replica(self, replica: MarketStore) -> None:
        replica_id = self._replica_id(replica)
        for _ in range(self.flush_batches_per_cycle):
            items = self.primary.load_replica_outbox(replica_id, self.outbox_batch_size)
            if not items:
                return
            grouped: dict[tuple[int, int], list[ReplicaOutboxItem]] = defaultdict(list)
            for item in items:
                grouped[(item.raw_retention_hours, item.bucket_retention_days)].append(item)
            for (raw_retention_hours, bucket_retention_days), group in grouped.items():
                replica.write_cycle(
                    [item.record for item in group],
                    raw_retention_hours=raw_retention_hours,
                    bucket_retention_days=bucket_retention_days,
                )
                self.primary.delete_replica_outbox(group)

    def _flush_fund_reference_replica(self, replica: MarketStore) -> None:
        replica_id = self._replica_id(replica)
        for _ in range(self.flush_batches_per_cycle):
            items = self.primary.load_fund_reference_outbox(replica_id, self.outbox_batch_size)
            if not items:
                return
            grouped: dict[int, list[FundReferenceOutboxItem]] = defaultdict(list)
            for item in items:
                grouped[item.retention_days].append(item)
            for retention_days, group in grouped.items():
                replica.write_fund_reference_snapshots(
                    [item.record for item in group],
                    retention_days=retention_days,
                )
                self.primary.delete_fund_reference_outbox(group)

    def write_cycle(
        self,
        records: list[dict[str, Any]],
        raw_retention_hours: int,
        bucket_retention_days: int,
    ) -> None:
        replica_ids = [self._replica_id(replica) for replica in self.replicas]
        self.primary.write_cycle_and_enqueue_replicas(
            records,
            replica_ids,
            raw_retention_hours,
            bucket_retention_days,
        )
        for replica in self.replicas:
            replica_id = self._replica_id(replica)
            try:
                self._flush_replica(replica)
                self._flush_fund_reference_replica(replica)
            except Exception as exc:
                print(
                    f"[storage] replica write deferred id={replica_id} "
                    f"pending={self.primary.replica_outbox_count(replica_id)}: {exc}",
                    file=sys.stderr,
                )

    def read_raw_samples(self, symbol: str, session: str = "trading") -> list[dict[str, Any]]:
        return self.primary.read_raw_samples(symbol, session)

    def write_fund_reference_snapshots(
        self,
        records: list[dict[str, Any]],
        retention_days: int,
    ) -> None:
        replica_ids = [self._replica_id(replica) for replica in self.replicas]
        self.primary.write_fund_references_and_enqueue_replicas(
            records,
            replica_ids,
            retention_days,
        )
        for replica in self.replicas:
            replica_id = self._replica_id(replica)
            try:
                self._flush_fund_reference_replica(replica)
            except Exception as exc:
                print(
                    f"[storage] fund reference replica write deferred id={replica_id} "
                    f"pending={self.primary.fund_reference_outbox_count(replica_id)}: {exc}",
                    file=sys.stderr,
                )

    def read_latest_fund_references(
        self,
        data_kind: str,
        symbols: Sequence[str],
    ) -> dict[str, dict[str, Any]]:
        return self.primary.read_latest_fund_references(data_kind, symbols)

    def read_fund_reference_history(
        self,
        data_kind: str,
        days: int,
    ) -> list[dict[str, Any]]:
        return self.primary.read_fund_reference_history(data_kind, days)


def build_store(config: Mapping[str, Any]) -> MarketStore:
    backend = str(config.get("storage_backend") or "sqlite").strip().lower()
    if backend == "sqlite":
        database_path = config.get("database_path")
        if not database_path:
            raise ValueError("database_path is required for the sqlite storage backend")
        return SQLiteStore(str(database_path))
    storage_config = config.get("storage") or {}
    if not isinstance(storage_config, Mapping):
        raise ValueError("storage configuration must be an object")
    tidb_config = storage_config.get("tidb") or config.get("tidb") or {}
    if not isinstance(tidb_config, Mapping):
        raise ValueError("TiDB storage configuration must be an object")
    if backend == "tidb":
        return ShardedTiDBStore(tidb_config)
    if backend == "dual":
        database_path = config.get("database_path")
        if not database_path:
            raise ValueError("database_path is required for the dual storage backend")
        primary = SQLiteStore(str(database_path))
        replica = ShardedTiDBStore(tidb_config)
        return DualWriteStore(
            primary,
            [replica],
            outbox_batch_size=int(storage_config.get("outbox_batch_size") or 500),
            flush_batches_per_cycle=int(storage_config.get("flush_batches_per_cycle") or 4),
            strict_initialize=storage_config.get("strict_initialize") is True,
        )
    raise ValueError(f"unsupported storage backend: {backend}")
