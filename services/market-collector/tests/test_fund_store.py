"""fund_store fund_history 写入行为：净值同步不得覆盖真实市价 close。"""
from __future__ import annotations

import json
import unittest
from unittest.mock import patch

from market_collector.fund_store import FundStore


class FakeCursor:
    def __init__(self) -> None:
        self.calls: list[tuple[str, list]] = []

    def __enter__(self) -> "FakeCursor":
        return self

    def __exit__(self, *args) -> None:
        return None

    def executemany(self, sql: str, rows) -> None:
        self.calls.append((sql, list(rows)))


class FakeConn:
    def __init__(self, cursor: FakeCursor) -> None:
        self._cursor = cursor
        self.commits = 0
        self.rollbacks = 0

    def ping(self, reconnect: bool = True) -> None:
        return None

    def cursor(self) -> FakeCursor:
        return self._cursor

    def commit(self) -> None:
        self.commits += 1

    def rollback(self) -> None:
        self.rollbacks += 1


def make_store() -> tuple[FundStore, FakeCursor, FakeConn]:
    cursor = FakeCursor()
    conn = FakeConn(cursor)
    store = FundStore([])
    store._conn = conn
    store._targets = [{"host": "fake"}]  # 让 _tidb 走已注入连接
    return store, cursor, conn


class FundDetailUpsertTest(unittest.TestCase):
    def test_details_persist_channel_limits(self) -> None:
        store, cursor, _conn = make_store()
        n = store.upsert_details([{
            "code": "040046",
            "name": "华安纳斯达克",
            "fund_type": "otc",
            "exchange": "otc",
            "buy_status": "limit_large",
            "buy_status_text": "暂停大额申购",
            "max_purchase_per_day": 100,
            "channel_limits": {"direct": 100, "distributor": 10},
            "limit_channel": "app",
            "limit_channel_text": "本公司直销机构",
            "limit_schema_version": 2,
        }])
        self.assertEqual(n, 1)
        sql, rows = cursor.calls[0]
        self.assertIn("channel_limits", sql)
        self.assertIn("limit_channel_text", sql)
        self.assertEqual(json.loads(rows[0][10]), {"direct": 100, "distributor": 10})
        self.assertEqual(rows[0][11], "app")
        self.assertEqual(rows[0][12], "本公司直销机构")
        self.assertEqual(rows[0][13], 2)


class FundHistoryUpsertTest(unittest.TestCase):
    def test_nav_upsert_preserves_real_close(self) -> None:
        store, cursor, _conn = make_store()
        n = store.upsert_history([
            {"code": "513100", "date": "2026-08-14", "nav": 1.234, "source": "holdings-nav-history"},
            {"code": "", "date": "2026-08-14", "nav": 1.0},       # 缺 code 跳过
            {"code": "513100", "date": "2026-08-14", "nav": 0},   # nav<=0 跳过
        ])
        self.assertEqual(n, 1)
        sql, rows = cursor.calls[0]
        # 已有真实市价源的行，净值刷新保留 close 与 source
        self.assertIn("close=IF(VALUES(source)='holdings-nav-history' AND source<>'holdings-nav-history', close, VALUES(close))", sql)
        self.assertIn("source=IF(VALUES(source)='holdings-nav-history' AND source<>'holdings-nav-history', source, VALUES(source))", sql)
        self.assertEqual(rows[0][0], "513100")
        self.assertEqual(rows[0][1], "2026-08-14")
        self.assertEqual(rows[0][2], 1.234)
        self.assertEqual(rows[0][3], 1.234)  # 新行 close 仍按 nav 占位

    def test_close_upsert_only_touches_price_columns(self) -> None:
        store, cursor, _conn = make_store()
        n = store.upsert_history_close([
            {"code": "159632", "date": "2026-08-14", "close": 2.345, "source": "markets-worker"},
            {"code": "159632", "date": "2026-08-14", "close": None},  # 无效 close 跳过
            {"code": "159632", "date": "", "close": 2.0},             # 缺 date 跳过
        ])
        self.assertEqual(n, 1)
        sql, rows = cursor.calls[0]
        # INSERT 段 nav 写 NULL（净值同步后补），UPDATE 段只动 close/source/updated_at
        self.assertIn("VALUES (%s,%s,NULL,%s,%s,%s)", sql)
        self.assertIn("ON DUPLICATE KEY UPDATE close=VALUES(close),source=VALUES(source),updated_at=VALUES(updated_at)", sql)
        self.assertNotIn("nav=VALUES(nav)", sql.split("ON DUPLICATE KEY UPDATE")[1])
        self.assertEqual(rows[0][:3], ("159632", "2026-08-14", 2.345))
        self.assertEqual(rows[0][3], "markets-worker")


if __name__ == "__main__":
    unittest.main()
