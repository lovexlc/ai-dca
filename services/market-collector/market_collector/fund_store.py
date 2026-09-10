"""fund_store — 4 张产品展示表的写入类。

collector 算好的行情/详情/历史/汇总数据写进这里，云函数直接读。
表职责单一（高内聚），与旧的 market_collector_datasets 文档表解耦。

表：
  fund_detail    code+限额+费率（每日同步）
  fund_quote     实时行情快照（盘中覆盖）
  fund_history   历史净值 K 线（增量 append，code+date 主键）
  fund_summary   收益区间+水位+回撤（每日预算）

只写 TiDB（产品数据可重建，无需 SQLite 主）。TiDB 不可用时不阻断
collector 主循环的 raw_samples 写入（那是另一套职责），只打印告警。
"""

from __future__ import annotations

import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Sequence
from zoneinfo import ZoneInfo

SHANGHAI = ZoneInfo("Asia/Shanghai")


def _shanghai_iso(value: datetime) -> str:
    return value.astimezone(SHANGHAI).replace(microsecond=0).isoformat()


def _num(value: Any) -> float | None:
    if value in (None, "", "-"):
        return None
    try:
        f = float(value)
        return f if f == f and f != float("inf") and f != float("-inf") else None
    except (TypeError, ValueError):
        return None


def _date_str(value: Any) -> str | None:
    if value is None:
        return None
    s = str(value)
    if hasattr(value, "isoformat"):
        s = value.isoformat()
    return s[:10] if s else None


def _json_or_none(value: Any) -> str | None:
    if value is None:
        return None
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


class FundStore:
    """4 张产品表的 TiDB 写入入口。"""

    def __init__(self, tidb_targets: Sequence[dict[str, Any]] | None = None) -> None:
        self._targets = list(tidb_targets or [])
        self._conn: Any = None
        self._lock = threading.RLock()

    def _tidb(self) -> Any:
        if not self._targets:
            return None
        with self._lock:
            if self._conn is not None:
                try:
                    self._conn.ping(reconnect=True)
                    return self._conn
                except Exception:
                    try:
                        self._conn.close()
                    except Exception:
                        pass
                    self._conn = None
            target = self._targets[0]
            import pymysql
            password = ""
            pw_file = str(target.get("password_file") or "").strip()
            pw_env = str(target.get("password_env") or "").strip()
            if pw_env:
                password = os.environ.get(pw_env, "")
            if not password and pw_file:
                password = Path(pw_file).read_text(encoding="utf-8").strip()
            self._conn = pymysql.connect(
                host=str(target.get("host") or "").strip(),
                port=int(target.get("port") or 4000),
                user=str(target.get("user") or "").strip(),
                password=password,
                database=str(target.get("database") or "ai_dca_market"),
                ssl_verify_cert=True,
                ssl_verify_identity=True,
                ssl_ca=str(target.get("ssl_ca") or "/etc/ssl/certs/ca-certificates.crt"),
                connect_timeout=15,
                read_timeout=30,
                write_timeout=30,
                autocommit=False,
                charset="utf8mb4",
            )
            return self._conn

    def initialize(self) -> None:
        conn = None
        try:
            conn = self._tidb()
        except Exception as exc:
            print(f"[fund-store] tidb init skipped: {exc}", flush=True)
            return
        if conn is None:
            return
        # 表由迁移脚本建好，这里只确认存在；不存在则按需创建。
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """CREATE TABLE IF NOT EXISTS fund_detail (
  code VARCHAR(16) NOT NULL PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  full_name VARCHAR(256) NULL,
  fund_type VARCHAR(32) NOT NULL,
  exchange VARCHAR(16) NOT NULL,
  region VARCHAR(16) NULL,
  currency VARCHAR(8) NOT NULL DEFAULT 'CNY',
  buy_status VARCHAR(32) NULL,
  buy_status_text VARCHAR(64) NULL,
  max_purchase_per_day DOUBLE NULL,
  channel_limits JSON NULL,
  limit_channel VARCHAR(16) NULL,
  limit_channel_text TEXT NULL,
  limit_schema_version INT NOT NULL DEFAULT 2,
  min_purchase DOUBLE NULL,
  confirm_days INT NULL,
  management_fee_rate DOUBLE NULL,
  custody_fee_rate DOUBLE NULL,
  annual_fee_rate DOUBLE NULL,
  sales_service_fee_rate DOUBLE NULL,
  redeem_fee_rate DOUBLE NULL,
  redeem_rules JSON NULL,
  operation_fees JSON NULL,
  fund_size DOUBLE NULL,
  updated_at VARCHAR(35) NULL,
  KEY idx_exchange (exchange)
)"""
                )
                cur.execute(
                    """CREATE TABLE IF NOT EXISTS fund_limit_overview_snapshot (
  snapshot_key VARCHAR(32) NOT NULL PRIMARY KEY,
  payload JSON NULL,
  updated_at VARCHAR(35) NULL
)"""
                )
                cur.execute(
                    """CREATE TABLE IF NOT EXISTS fund_quote (
  code VARCHAR(16) NOT NULL PRIMARY KEY,
  name VARCHAR(128) NULL,
  price DOUBLE NULL,
  latest_nav DOUBLE NULL,
  latest_nav_date VARCHAR(10) NULL,
  previous_close DOUBLE NULL,
  change_amount DOUBLE NULL,
  change_percent DOUBLE NULL,
  premium_percent DOUBLE NULL,
  iopv DOUBLE NULL,
  volume DOUBLE NULL,
  turnover DOUBLE NULL,
  market_state VARCHAR(16) NULL,
  as_of VARCHAR(35) NULL,
  session VARCHAR(16) NULL,
  suspended TINYINT(1) NOT NULL DEFAULT 0,
  updated_at VARCHAR(35) NULL,
  KEY idx_change_percent (change_percent),
  KEY idx_updated_at (updated_at)
)"""
                )
                cur.execute(
                    """CREATE TABLE IF NOT EXISTS fund_history (
  code VARCHAR(16) NOT NULL,
  date DATE NOT NULL,
  nav DOUBLE NULL,
  close DOUBLE NULL,
  source VARCHAR(32) NULL,
  updated_at VARCHAR(35) NULL,
  PRIMARY KEY (code, date),
  KEY idx_date (date)
)"""
                )
                cur.execute(
                    """CREATE TABLE IF NOT EXISTS fund_summary (
  code VARCHAR(16) NOT NULL,
  date DATE NOT NULL,
  latest_nav DOUBLE NULL,
  return_1w DOUBLE NULL,
  return_1m DOUBLE NULL,
  return_3m DOUBLE NULL,
  return_6m DOUBLE NULL,
  return_1y DOUBLE NULL,
  return_base DOUBLE NULL,
  ytd_return DOUBLE NULL,
  historical_percentile DOUBLE NULL,
  drawdown_percentile DOUBLE NULL,
  high_drawdown DOUBLE NULL,
  close_high_drawdown DOUBLE NULL,
  high_point DOUBLE NULL,
  high_point_date VARCHAR(10) NULL,
  close_high_point DOUBLE NULL,
  close_high_point_date VARCHAR(10) NULL,
  updated_at VARCHAR(35) NULL,
  PRIMARY KEY (code, date),
  KEY idx_date (date)
)"""
                )
            for alter in (
                "ALTER TABLE fund_detail ADD COLUMN channel_limits JSON NULL",
                "ALTER TABLE fund_detail ADD COLUMN limit_channel VARCHAR(16) NULL",
                "ALTER TABLE fund_detail ADD COLUMN limit_channel_text TEXT NULL",
                "ALTER TABLE fund_detail MODIFY COLUMN limit_channel_text TEXT NULL",
                "ALTER TABLE fund_detail ADD COLUMN limit_schema_version INT NOT NULL DEFAULT 2",
            ):
                try:
                    with conn.cursor() as alter_cursor:
                        alter_cursor.execute(alter)
                except Exception as exc:
                    if "duplicate" not in str(exc).lower() and "exists" not in str(exc).lower():
                        print(f"[fund-store] schema alter skipped: {exc}", flush=True)
            conn.commit()
        except Exception as exc:
            try:
                conn.rollback()
            except Exception:
                pass
            print(f"[fund-store] init create table failed: {exc}", flush=True)

    def _safe_executemany(self, sql: str, rows: Sequence[Sequence[Any]], label: str) -> int:
        if not rows:
            return 0
        conn = None
        try:
            conn = self._tidb()
        except Exception as exc:
            print(f"[fund-store] {label} tidb skipped: {exc}", flush=True)
            return 0
        if conn is None:
            return 0
        try:
            # 分批，避免单次过大被 TiDB 拒（max_allowed_packet / 超时）
            with conn.cursor() as cur:
                for i in range(0, len(rows), 50):
                    cur.executemany(sql, list(rows[i:i + 50]))
            conn.commit()
            return len(rows)
        except Exception as exc:
            try:
                conn.rollback()
            except Exception:
                pass
            print(f"[fund-store] {label} write failed: {exc}", flush=True)
            return 0

    # ---- fund_quote ----
    def upsert_quotes(self, rows: Sequence[dict[str, Any]]) -> int:
        now = _shanghai_iso(datetime.now(timezone.utc))
        mapped = []
        for r in rows:
            code = str(r.get("code") or r.get("symbol") or "").strip()
            if not code:
                continue
            mapped.append((
                code, r.get("name"), _num(r.get("price")),
                _num(r.get("latestNav") or r.get("navBase")),
                _date_str(r.get("latestNavDate")),
                _num(r.get("previousClose") or r.get("previous_close")),
                _num(r.get("change")),
                _num(r.get("changePercent") or r.get("change_percent")),
                _num(r.get("premiumPercent") or r.get("premium_percent")),
                _num(r.get("iopv")),
                _num(r.get("volume")),
                _num(r.get("turnover")),
                str(r.get("marketState") or "").strip() or None,
                r.get("asOf") or r.get("collected_at"),
                r.get("session"),
                1 if r.get("suspended") else 0,
                now,
            ))
        sql = """INSERT INTO fund_quote (code,name,price,latest_nav,latest_nav_date,previous_close,change_amount,change_percent,premium_percent,iopv,volume,turnover,market_state,as_of,session,suspended,updated_at) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
ON DUPLICATE KEY UPDATE name=VALUES(name),price=VALUES(price),latest_nav=VALUES(latest_nav),latest_nav_date=VALUES(latest_nav_date),previous_close=VALUES(previous_close),change_amount=VALUES(change_amount),change_percent=VALUES(change_percent),premium_percent=VALUES(premium_percent),iopv=VALUES(iopv),volume=VALUES(volume),turnover=VALUES(turnover),market_state=VALUES(market_state),as_of=VALUES(as_of),session=VALUES(session),suspended=VALUES(suspended),updated_at=VALUES(updated_at)"""
        return self._safe_executemany(sql, mapped, "fund_quote")

    def upsert_quotes_fast(self, rows: Sequence[dict[str, Any]]) -> int:
        """高频写入专用：每次新建 autocommit=True 独立连接，避免单例连接的 commit 在跨线程/跨连接场景下不生效。

        单例 _conn (autocommit=False) 在高频多线程场景下，commit 会出现“同连接读己写可见、跨连接不可见”的状态——
        表现是 upsert 返回行数但外部读不到 updated_at 变化。autocommit 独立连接每条语句即时提交，跨连接立即可见。
        代价是每秒建/关一次连接，TiDB Cloud 短连接开销可接受（<50ms）。
        """
        if not rows or not self._targets:
            return 0
        now = _shanghai_iso(datetime.now(timezone.utc))
        mapped = []
        for r in rows:
            code = str(r.get("code") or r.get("symbol") or "").strip()
            if not code:
                continue
            mapped.append((
                code, r.get("name"), _num(r.get("price")),
                _num(r.get("latestNav") or r.get("navBase")),
                _date_str(r.get("latestNavDate")),
                _num(r.get("previousClose") or r.get("previous_close")),
                _num(r.get("change")),
                _num(r.get("changePercent") or r.get("change_percent")),
                _num(r.get("premiumPercent") or r.get("premium_percent")),
                _num(r.get("iopv")),
                _num(r.get("volume")),
                _num(r.get("turnover")),
                str(r.get("marketState") or "").strip() or None,
                r.get("asOf") or r.get("collected_at"),
                r.get("session"),
                1 if r.get("suspended") else 0,
                now,
            ))
        if not mapped:
            return 0
        sql = """INSERT INTO fund_quote (code,name,price,latest_nav,latest_nav_date,previous_close,change_amount,change_percent,premium_percent,iopv,volume,turnover,market_state,as_of,session,suspended,updated_at) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
ON DUPLICATE KEY UPDATE name=VALUES(name),price=VALUES(price),latest_nav=VALUES(latest_nav),latest_nav_date=VALUES(latest_nav_date),previous_close=VALUES(previous_close),change_amount=VALUES(change_amount),change_percent=VALUES(change_percent),premium_percent=VALUES(premium_percent),iopv=VALUES(iopv),volume=VALUES(volume),turnover=VALUES(turnover),market_state=VALUES(market_state),as_of=VALUES(as_of),session=VALUES(session),suspended=VALUES(suspended),updated_at=VALUES(updated_at)"""
        target = self._targets[0]
        import pymysql
        password = ""
        pw_file = str(target.get("password_file") or "").strip()
        pw_env = str(target.get("password_env") or "").strip()
        if pw_env:
            password = os.environ.get(pw_env, "")
        if not password and pw_file:
            password = Path(pw_file).read_text(encoding="utf-8").strip()
        conn = None
        try:
            conn = pymysql.connect(
                host=str(target.get("host") or "").strip(),
                port=int(target.get("port") or 4000),
                user=str(target.get("user") or "").strip(),
                password=password,
                database=str(target.get("database") or "ai_dca_market"),
                ssl_verify_cert=True, ssl_verify_identity=True,
                ssl_ca=str(target.get("ssl_ca") or "/etc/ssl/certs/ca-certificates.crt"),
                connect_timeout=8, read_timeout=15, write_timeout=15,
                autocommit=True, charset="utf8mb4",
            )
            with conn.cursor() as cur:
                for i in range(0, len(mapped), 50):
                    cur.executemany(sql, list(mapped[i:i + 50]))
            return len(mapped)
        except Exception as exc:
            print(f"[fund-store] fund_quote fast write failed: {exc}", flush=True)
            return 0
        finally:
            if conn is not None:
                try:
                    conn.close()
                except Exception:
                    pass

    # ---- fund_detail ----
    def upsert_details(self, rows: Sequence[dict[str, Any]]) -> int:
        now = _shanghai_iso(datetime.now(timezone.utc))
        mapped = []
        for r in rows:
            code = str(r.get("code") or "").strip()
            if not code:
                continue
            mapped.append((
                code, r.get("name"), r.get("full_name"),
                r.get("fund_type"), r.get("exchange"), r.get("region"),
                r.get("currency") or "CNY",
                r.get("buy_status"), r.get("buy_status_text"),
                _num(r.get("max_purchase_per_day")),
                _json_or_none(r.get("channel_limits")),
                r.get("limit_channel"),
                r.get("limit_channel_text"),
                int(r.get("limit_schema_version") or 2),
                _num(r.get("min_purchase")),
                int(r["confirm_days"]) if _num(r.get("confirm_days")) is not None else None,
                _num(r.get("management_fee_rate")), _num(r.get("custody_fee_rate")),
                _num(r.get("annual_fee_rate")), _num(r.get("sales_service_fee_rate")),
                _num(r.get("redeem_fee_rate")),
                _json_or_none(r.get("redeem_rules")), _json_or_none(r.get("operation_fees")),
                _num(r.get("fund_size")), now,
            ))
        sql = """INSERT INTO fund_detail (code,name,full_name,fund_type,exchange,region,currency,buy_status,buy_status_text,max_purchase_per_day,channel_limits,limit_channel,limit_channel_text,limit_schema_version,min_purchase,confirm_days,management_fee_rate,custody_fee_rate,annual_fee_rate,sales_service_fee_rate,redeem_fee_rate,redeem_rules,operation_fees,fund_size,updated_at) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
ON DUPLICATE KEY UPDATE name=VALUES(name),full_name=VALUES(full_name),fund_type=VALUES(fund_type),exchange=VALUES(exchange),region=VALUES(region),currency=VALUES(currency),buy_status=VALUES(buy_status),buy_status_text=VALUES(buy_status_text),max_purchase_per_day=VALUES(max_purchase_per_day),channel_limits=VALUES(channel_limits),limit_channel=VALUES(limit_channel),limit_channel_text=VALUES(limit_channel_text),limit_schema_version=VALUES(limit_schema_version),min_purchase=VALUES(min_purchase),confirm_days=VALUES(confirm_days),management_fee_rate=VALUES(management_fee_rate),custody_fee_rate=VALUES(custody_fee_rate),annual_fee_rate=VALUES(annual_fee_rate),sales_service_fee_rate=VALUES(sales_service_fee_rate),redeem_fee_rate=VALUES(redeem_fee_rate),redeem_rules=VALUES(redeem_rules),operation_fees=VALUES(operation_fees),fund_size=VALUES(fund_size),updated_at=VALUES(updated_at)"""
        return self._safe_executemany(sql, mapped, "fund_detail")

    # ---- fund_history（增量 append）----
    def upsert_history(self, rows: Sequence[dict[str, Any]]) -> int:
        now = _shanghai_iso(datetime.now(timezone.utc))
        mapped = []
        for r in rows:
            code = str(r.get("code") or "").strip()
            d = _date_str(r.get("date"))
            if not code or not d:
                continue
            nav = _num(r.get("nav"))
            if nav is None or nav <= 0:
                continue
            mapped.append((code, d, nav, nav, r.get("source", "collector"), now))
        # close 语义：净值同步只在没有真实市价时把 close 当 nav 占位。
        # 已写入真实市价（source 为 eastmoney-kline 等价格源）的行，净值刷新不再覆盖 close/source。
        sql = """INSERT INTO fund_history (code,date,nav,close,source,updated_at) VALUES (%s,%s,%s,%s,%s,%s)
ON DUPLICATE KEY UPDATE nav=VALUES(nav),
  close=IF(VALUES(source)='holdings-nav-history' AND source<>'holdings-nav-history', close, VALUES(close)),
  source=IF(VALUES(source)='holdings-nav-history' AND source<>'holdings-nav-history', source, VALUES(source)),
  updated_at=VALUES(updated_at)"""
        return self._safe_executemany(sql, mapped, "fund_history")

    def upsert_history_close(self, rows: Sequence[dict[str, Any]]) -> int:
        """写真实日 K 收盘价（场内 ETF）。rows: {code, date, close, source?}。

        与 upsert_history 解耦：净值行可能尚未存在（nav 为 NULL 先占位，后续净值同步补上），
        已存在的行只更新 close/source，不动 nav。

        Bohrium→TiDB 单批 50 行 ≈4.6s（实测），大事务任一超过 read_timeout 整批回滚。
        因此这里逐批提交 + 逐批重试，不用共享的 _safe_executemany 大事务。
        """
        now = _shanghai_iso(datetime.now(timezone.utc))
        mapped = []
        for r in rows:
            code = str(r.get("code") or "").strip()
            d = _date_str(r.get("date"))
            close = _num(r.get("close"))
            if not code or not d or close is None or close <= 0:
                continue
            mapped.append((code, d, close, str(r.get("source") or "eastmoney-kline"), now))
        if not mapped:
            return 0
        sql = """INSERT INTO fund_history (code,date,nav,close,source,updated_at) VALUES (%s,%s,NULL,%s,%s,%s)
ON DUPLICATE KEY UPDATE close=VALUES(close),source=VALUES(source),updated_at=VALUES(updated_at)"""
        written = 0
        for i in range(0, len(mapped), 50):
            batch = mapped[i:i + 50]
            for attempt in (1, 2):
                conn = None
                try:
                    conn = self._tidb()
                except Exception as exc:
                    print(f"[fund-store] fund_history.close tidb skipped: {exc}", flush=True)
                if conn is None:
                    break
                try:
                    with conn.cursor() as cur:
                        cur.executemany(sql, batch)
                    conn.commit()
                    written += len(batch)
                    break
                except Exception as exc:
                    try:
                        conn.rollback()
                    except Exception:
                        pass
                    # 连接可能已坏，强制下次重建
                    try:
                        conn.close()
                    except Exception:
                        pass
                    if self._conn is conn:
                        self._conn = None
                    if attempt == 2:
                        print(f"[fund-store] fund_history.close batch write failed: {exc}", flush=True)
        return written

    # ---- fund_summary ----
    def upsert_summaries(self, rows: Sequence[dict[str, Any]]) -> int:
        now = _shanghai_iso(datetime.now(timezone.utc))
        mapped = []
        for r in rows:
            code = str(r.get("code") or "").strip()
            d = _date_str(r.get("date"))
            if not code or not d:
                continue
            mapped.append((
                code, d, _num(r.get("latest_nav")),
                _num(r.get("return_1w")), _num(r.get("return_1m")), _num(r.get("return_3m")),
                _num(r.get("return_6m")), _num(r.get("return_1y")), _num(r.get("return_base")),
                _num(r.get("ytd_return")),
                _num(r.get("historical_percentile")), _num(r.get("drawdown_percentile")),
                _num(r.get("high_drawdown")), _num(r.get("close_high_drawdown")),
                _num(r.get("high_point")), _date_str(r.get("high_point_date")),
                _num(r.get("close_high_point")), _date_str(r.get("close_high_point_date")),
                now,
            ))
        sql = """INSERT INTO fund_summary (code,date,latest_nav,return_1w,return_1m,return_3m,return_6m,return_1y,return_base,ytd_return,historical_percentile,drawdown_percentile,high_drawdown,close_high_drawdown,high_point,high_point_date,close_high_point,close_high_point_date,updated_at) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
ON DUPLICATE KEY UPDATE latest_nav=VALUES(latest_nav),return_1w=VALUES(return_1w),return_1m=VALUES(return_1m),return_3m=VALUES(return_3m),return_6m=VALUES(return_6m),return_1y=VALUES(return_1y),return_base=VALUES(return_base),ytd_return=VALUES(ytd_return),historical_percentile=VALUES(historical_percentile),drawdown_percentile=VALUES(drawdown_percentile),high_drawdown=VALUES(high_drawdown),close_high_drawdown=VALUES(close_high_drawdown),high_point=VALUES(high_point),high_point_date=VALUES(high_point_date),close_high_point=VALUES(close_high_point),close_high_point_date=VALUES(close_high_point_date),updated_at=VALUES(updated_at)"""
        return self._safe_executemany(sql, mapped, "fund_summary")

    # ---- 读历史净值（供 summary 预算）----
    def read_history(self, code: str) -> list[tuple[str, float]]:
        conn = None
        try:
            conn = self._tidb()
        except Exception:
            return []
        if conn is None:
            return []
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT date, nav FROM fund_history WHERE code=%s AND nav IS NOT NULL AND nav>0 ORDER BY date ASC",
                    (code,),
                )
                return [(str(r[0]), float(r[1])) for r in cur.fetchall() if r[1] is not None]
        except Exception as exc:
            print(f"[fund-store] read_history {code} failed: {exc}", flush=True)
            return []

    # ---- 场外限额聚合快照（单行 global，来自 ocr-proxy）----
    def upsert_limit_overview(self, payload: dict[str, Any]) -> int:
        now = _shanghai_iso(datetime.now(timezone.utc))
        conn = None
        try:
            conn = self._tidb()
        except Exception as exc:
            print(f"[fund-store] upsert_limit_overview tidb failed: {exc}", flush=True)
            return 0
        if conn is None:
            return 0
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """INSERT INTO fund_limit_overview_snapshot (snapshot_key, payload, updated_at)
                       VALUES ('global', %s, %s)
                       ON DUPLICATE KEY UPDATE payload=VALUES(payload), updated_at=VALUES(updated_at)""",
                    (_json_or_none(payload), now),
                )
            conn.commit()
            return cur.rowcount or 1
        except Exception as exc:
            print(f"[fund-store] upsert_limit_overview failed: {exc}", flush=True)
            try:
                conn.rollback()
            except Exception:
                pass
            return 0


def build_fund_store(config: dict[str, Any]) -> FundStore | None:
    """从 collector config 构造 FundStore（复用 tidb targets）。"""
    storage = config.get("storage") or {}
    tidb_config = storage.get("tidb") or config.get("tidb") or {}
    if not isinstance(tidb_config, dict):
        return None
    raw_targets = tidb_config.get("targets") or []
    if not isinstance(raw_targets, list):
        return None
    targets = [t for t in raw_targets if isinstance(t, dict)]
    return FundStore(targets) if targets else None
