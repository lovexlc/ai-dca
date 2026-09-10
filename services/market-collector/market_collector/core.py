from __future__ import annotations

import copy
import json
import math
import threading
import time
from datetime import datetime, timedelta, time as day_time, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from .calendar_cn import is_trading_day
from .fund_reference import fetch_fund_references, fetch_fund_limit_overview
from .otc import OTC_SYMBOLS, atomic_write_json, fetch_otc_metrics
from .publish import build_publisher
from .sources import fetch_eastmoney_references, fetch_tencent_quotes, isoformat_z, normalize_symbol
from .storage import MarketStore, build_store

SHANGHAI = ZoneInfo("Asia/Shanghai")

SYMBOLS = [
    "513870", "513390", "513300", "513110", "513100", "159941", "159696", "159660",
    "159659", "159632", "159513", "159509", "159501", "159577", "161125", "161128", "161130",
    "513500", "513650", "159612", "159655", "513850", "563020",
]

DEFAULT_CONFIG: dict[str, Any] = {
    "symbols": SYMBOLS,
    "storage_backend": "sqlite",
    "database_path": "services/market-collector/data/market-collector.sqlite3",
    "output_dir": "services/market-collector/data/shadow",
    "request_timeout_sec": 10.0,
    "mismatch_tolerance_pp": 0.05,
    "raw_retention_hours": 168,
    "bucket_retention_days": 14,
    "schedules": {
        "trading": {"enabled": True, "interval_sec": 15, "ttl_sec": 90},
        "lunch": {"enabled": False, "interval_sec": 30, "ttl_sec": 900},
        "off_hours": {"enabled": False, "interval_sec": 30, "ttl_sec": 14400},
    },
    "otc": {
        "enabled": True,
        "times": ["19:30", "20:30", "21:30"],
        "symbols": OTC_SYMBOLS,
        "request_timeout_sec": 30,
    },
    "fund_reference_sync": {
        "enabled": False,
        "time": "22:30",
        "symbols": OTC_SYMBOLS,
        "worker_url": "",
        "request_timeout_sec": 25,
        "concurrency": 4,
        "retention_days": 400,
    },
    "publisher": {
        "backend": "file",
        "worker_url": "",
        "token_env": "MARKET_COLLECTOR_TOKEN",
        "outbox_dir": "services/market-collector/data/publish-outbox",
        "timeout_sec": 15,
    },
}


def deep_update(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    merged = copy.deepcopy(base)
    for key, value in (override or {}).items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = deep_update(merged[key], value)
        else:
            merged[key] = value
    return merged


def load_config(root: str, config_path: str | None = None) -> dict[str, Any]:
    config = copy.deepcopy(DEFAULT_CONFIG)
    if config_path:
        payload = json.loads(Path(config_path).read_text(encoding="utf-8"))
        config = deep_update(config, payload)
    root_path = Path(root)
    workspace_root = root_path.parent.parent if len(root_path.parents) >= 2 else root_path.parent
    config["database_path"] = str((workspace_root / str(config["database_path"])).resolve()) if not Path(str(config["database_path"])).is_absolute() else str(config["database_path"])
    config["output_dir"] = str((workspace_root / str(config["output_dir"])).resolve()) if not Path(str(config["output_dir"])).is_absolute() else str(config["output_dir"])
    publisher = config.get("publisher") or {}
    outbox_dir = publisher.get("outbox_dir")
    if outbox_dir and not Path(str(outbox_dir)).is_absolute():
        publisher["outbox_dir"] = str((workspace_root / str(outbox_dir)).resolve())
    config["symbols"] = [normalize_symbol(symbol) for symbol in config.get("symbols", []) if normalize_symbol(symbol)]
    return config


def classify_session(now: datetime | None = None) -> str:
    current = (now or datetime.now(timezone.utc)).astimezone(SHANGHAI)
    if not is_trading_day(current):
        return "off_hours"
    clock = current.time()
    if day_time(9, 30) <= clock < day_time(11, 30):
        return "trading"
    if day_time(11, 30) <= clock < day_time(13, 0):
        return "lunch"
    if day_time(13, 0) <= clock < day_time(15, 31):
        return "trading"
    return "off_hours"


def due_otc_slot(now: datetime, times: list[str], completed: set[str]) -> str | None:
    current = now.astimezone(SHANGHAI)
    if not is_trading_day(current):
        return None
    clock = current.strftime("%H:%M")
    if clock not in times:
        return None
    key = current.date().isoformat() + "T" + clock
    return None if key in completed else key


def due_daily_slot(now: datetime, scheduled_time: str, completed: set[str]) -> str | None:
    current = now.astimezone(SHANGHAI)
    try:
        scheduled_clock = datetime.strptime(str(scheduled_time), "%H:%M").time()
    except ValueError:
        return None
    key = current.date().isoformat()
    if current.time().replace(tzinfo=None) < scheduled_clock or key in completed:
        return None
    return key


def compute_premium(price: float | None, iopv: float | None) -> float | None:
    if price is None or iopv is None or iopv <= 0:
        return None
    return round(((price - iopv) / iopv) * 100, 4)


def symbol_category(symbol: str) -> str:
    return "lof" if symbol in {"161128", "161130"} else "cross_border_etf"


def build_symbol_record(
    symbol: str,
    price_row: dict[str, Any] | None,
    iopv_row: dict[str, Any] | None,
    collected_at: str,
    session: str,
    ttl_sec: int,
    mismatch_tolerance_pp: float,
) -> dict[str, Any]:
    price = price_row.get("price") if price_row else None
    iopv = iopv_row.get("iopv") if iopv_row else None
    vendor_premium = iopv_row.get("vendor_premium_percent") if iopv_row else None
    computed_premium = compute_premium(price, iopv)
    # LOF 无盘中 IOPV，computed_premium 为 null；fallback 到基金公司公布的场内折溢价率（f402）。
    if computed_premium is None and vendor_premium is not None:
        computed_premium = vendor_premium
    mismatch_pp = round(abs(computed_premium - vendor_premium), 4) if computed_premium is not None and vendor_premium is not None else None
    quality_issues: list[str] = []
    if price is None:
        quality_issues.append("missing_price")
    if iopv is None:
        quality_issues.append("missing_iopv")
    if vendor_premium is None:
        quality_issues.append("missing_vendor_premium")
    if mismatch_pp is not None and mismatch_pp > mismatch_tolerance_pp:
        quality_issues.append("premium_mismatch")
    quality_status = "ok" if not quality_issues else ("degraded" if len(quality_issues) < 3 else "missing")
    expires_at = isoformat_z(datetime.fromisoformat(collected_at.replace("Z", "+00:00")) + timedelta_seconds(ttl_sec))
    return {
        "symbol": symbol,
        "name": (price_row or iopv_row or {}).get("name") or symbol,
        "category": symbol_category(symbol),
        "session": session,
        "collected_at": collected_at,
        "price_timestamp": (price_row or {}).get("source_as_of") or (price_row or {}).get("received_at"),
        "iopv_timestamp": (iopv_row or {}).get("source_as_of") or (iopv_row or {}).get("received_at"),
        "price_received_at": (price_row or {}).get("received_at"),
        "iopv_received_at": (iopv_row or {}).get("received_at"),
        "price": price,
        "previous_close": (price_row or {}).get("previous_close"),
        "change": (price_row or {}).get("change"),
        "change_percent": (price_row or {}).get("change_percent"),
        "open": (price_row or {}).get("open"),
        "high": (price_row or {}).get("high"),
        "low": (price_row or {}).get("low"),
        "volume": (price_row or {}).get("volume"),
        "turnover": (price_row or {}).get("turnover"),
        "turnover_rate": (price_row or {}).get("turnover_rate"),
        "suspended": bool((price_row or {}).get("suspended")),
        "iopv": iopv,
        "computed_premium_percent": computed_premium,
        "vendor_premium_percent": vendor_premium,
        "vendor_discount_percent_raw": (iopv_row or {}).get("vendor_discount_percent_raw"),
        "mismatch_pp": mismatch_pp,
        "expires_at": expires_at,
        "ttl_sec": ttl_sec,
        "sources": {
            "price": (price_row or {}).get("source"),
            "iopv": (iopv_row or {}).get("source"),
        },
        "quality": {
            "status": quality_status,
            "issues": quality_issues,
        },
        "debug": {
            "eastmoney_page": (iopv_row or {}).get("page"),
        },
    }


def timedelta_seconds(seconds: int) -> Any:
    from datetime import timedelta
    return timedelta(seconds=seconds)


class MarketCollector:
    def __init__(self, config: dict[str, Any], store: MarketStore | None = None) -> None:
        self.config = config
        self.store = store if store is not None else build_store(config)
        self.publisher = build_publisher(config)
        self._otc_completed_slots: set[str] = set()
        self._fund_reference_completed_dates: set[str] = set()
        self._daily_kline_completed_dates: set[str] = set()
        self._data_service: MarketDataService | None = None
        # 高频行情：场内 ETF price 每 1s 刷新、iopv 每 5s 刷新，各自独立线程。
        # iopv 缓存由低频线程写入，高频线程读取后计算 premium_percent 写 fund_quote。
        self._iopv_cache: dict[str, dict[str, Any]] = {}
        self._iopv_lock = threading.Lock()
        self._high_freq_stop = threading.Event()
        # 高频写入用持久 autocommit 连接（executemany 在多行 + ON DUPLICATE KEY UPDATE
        # 场景下 TiDB 不生效，改 execute 逐行提交；复用连接避免每秒建连开销）。
        self._high_freq_conn: Any = None
        self._high_freq_conn_lock = threading.Lock()
        from .fund_store import build_fund_store, FundStore
        self.fund_store: FundStore | None = build_fund_store(config)
        if self.fund_store is not None:
            self.fund_store.initialize()
        self.store.initialize()

    def collect_otc_once(self, slot: str) -> dict[str, Any]:
        otc_config = self.config.get("otc") or {}
        payload = fetch_otc_metrics(
            symbols=list(otc_config.get("symbols") or OTC_SYMBOLS),
            timeout_sec=float(otc_config.get("request_timeout_sec") or 30),
        )
        payload["scheduled_slot"] = slot
        atomic_write_json(Path(str(self.config["output_dir"])) / "otc-latest.json", payload)
        return payload

    def run_due_otc(self, now: datetime) -> dict[str, Any] | None:
        otc_config = self.config.get("otc") or {}
        if otc_config.get("enabled", True) is False:
            return None
        slot = due_otc_slot(now, list(otc_config.get("times") or []), self._otc_completed_slots)
        if slot is None:
            return None
        payload = self.collect_otc_once(slot)
        self._otc_completed_slots.add(slot)
        current_date = now.astimezone(SHANGHAI).date().isoformat()
        self._otc_completed_slots = {key for key in self._otc_completed_slots if key.startswith(current_date)}
        return payload

    def collect_fund_references_once(self, now: datetime | None = None) -> dict[str, Any]:
        sync_config = self.config.get("fund_reference_sync") or {}
        otc_symbols = list(sync_config.get("symbols") or OTC_SYMBOLS)
        etf_symbols = list(self.config.get("symbols") or SYMBOLS)
        # fee 同时抓场内 + 场外：场内 ETF 取管理费/托管费/年费，场外取 redeemRules 卖出费率阶梯；
        # limit 只抓场外：场内 ETF 无限购概念。
        fee_symbols = list(dict.fromkeys(otc_symbols + etf_symbols))
        payload = fetch_fund_references(
            symbols=otc_symbols,
            worker_url="",
            timeout_sec=float(sync_config.get("request_timeout_sec") or 25),
            concurrency=int(sync_config.get("concurrency") or 4),
            now=now,
            fee_symbols=fee_symbols,
            limit_symbols=otc_symbols,
        )
        self.store.write_fund_reference_snapshots(
            list(payload.get("records") or []),
            retention_days=int(sync_config.get("retention_days") or 400),
        )
        output = dict(payload)
        output.pop("records", None)
        atomic_write_json(
            Path(str(self.config["output_dir"])) / "fund-reference-sync-latest.json",
            output,
        )
        return payload

    def run_due_fund_reference_sync(self, now: datetime) -> dict[str, Any] | None:
        sync_config = self.config.get("fund_reference_sync") or {}
        if sync_config.get("enabled", True) is False:
            return None
        slot = due_daily_slot(
            now,
            str(sync_config.get("time") or "22:30"),
            self._fund_reference_completed_dates,
        )
        if slot is None:
            return None
        payload = self.collect_fund_references_once(now)
        self._fund_reference_completed_dates.add(slot)
        self._fund_reference_completed_dates = {slot}
        print(
            "[fund-reference-sync] "
            f"date={slot} fee={payload.get('fee_success_count')}/{payload.get('requested_symbols')} "
            f"limit={payload.get('limit_success_count')}/{payload.get('requested_symbols')} "
            f"errors={len(payload.get('errors') or [])}"
        )
        return payload

    def collect_once(self) -> tuple[dict[str, Any], dict[str, Any]]:
        collected_at = isoformat_z(datetime.now(timezone.utc))
        session = classify_session(datetime.now(timezone.utc))
        ttl_sec = int((((self.config.get("schedules") or {}).get(session)) or {}).get("ttl_sec") or 300)
        symbols = list(self.config["symbols"])
        timeout_sec = float(self.config["request_timeout_sec"])
        source_errors: dict[str, str] = {}
        try:
            price_map = fetch_tencent_quotes(symbols, timeout_sec)
        except Exception as exc:
            price_map = {}
            source_errors["tencent_batch"] = str(exc)
        try:
            iopv_map, eastmoney_meta = fetch_eastmoney_references(symbols, timeout_sec)
        except Exception as exc:
            iopv_map, eastmoney_meta = {}, {"page_size": 100, "pages_visited": 0, "missing_symbols": symbols}
            source_errors["eastmoney_push2delay"] = str(exc)
        records = [
            build_symbol_record(
                symbol=symbol,
                price_row=price_map.get(symbol),
                iopv_row=iopv_map.get(symbol),
                collected_at=collected_at,
                session=session,
                ttl_sec=ttl_sec,
                mismatch_tolerance_pp=float(self.config["mismatch_tolerance_pp"]),
            )
            for symbol in symbols
        ]
        self.store.write_cycle(
            records,
            raw_retention_hours=int(self.config["raw_retention_hours"]),
            bucket_retention_days=int(self.config["bucket_retention_days"]),
        )
        healthy = sum(1 for item in records if item["quality"]["status"] == "ok")
        degraded = len(records) - healthy
        latest_payload = {
            "kind": "market-collector-shadow-latest",
            "generated_at": collected_at,
            "session": session,
            "symbols": records,
        }
        health_payload = {
            "kind": "market-collector-shadow-health",
            "generated_at": collected_at,
            "session": session,
            "schedule": (self.config.get("schedules") or {}).get(session),
            "healthy_symbols": healthy,
            "degraded_symbols": degraded,
            "source_errors": source_errors,
            "eastmoney_pagination": eastmoney_meta,
        }
        self.publisher.publish(latest_payload, health_payload)
        return latest_payload, health_payload

    def _ensure_data_service(self) -> MarketDataService:
        from .aggregates import MarketDataService
        if self._data_service is None:
            self._data_service = MarketDataService(self.store, self.config["output_dir"])
        return self._data_service

    # ── 4 张产品表的写入 ──
    def _publish_quotes(self) -> int:
        """盘中 5 分钟：ETF（从 raw_samples 最新）+ OTC（从 otc-latest）写 fund_quote。"""
        if self.fund_store is None:
            return 0
        data_service = self._ensure_data_service()
        rows: list[dict[str, Any]] = []
        # 场内 ETF：用 fund_metric 取数（含 iopv / premiumPercent），quote() 缺这俩字段
        for symbol in self.config["symbols"]:
            fm = data_service.fund_metric(symbol)
            if fm and fm.get("price"):
                rows.append({
                    "code": symbol,
                    "name": fm.get("name") or symbol,
                    "price": fm.get("price"),
                    "latestNav": None,
                    "latestNavDate": None,
                    "previousClose": fm.get("previousClose"),
                    "changePercent": fm.get("changePercent"),
                    "premiumPercent": fm.get("premiumPercent"),
                    "iopv": fm.get("iopv"),
                    "volume": fm.get("volume"),
                    "turnover": fm.get("turnover"),
                    "marketState": fm.get("marketState"),
                    "suspended": fm.get("suspended"),
                    "asOf": fm.get("asOf"),
                    "session": "exchange",
                })
        # 场外 OTC（净值作为最新价）—— 字段集与场内对齐，缺失填 None，
        # 避免 upsert_quotes 批量 SQL 因参数数量不一致而错位。
        for item in (data_service.otc_latest().get("items") or []):
            code = str(item.get("code") or item.get("symbol") or "")
            if not code:
                continue
            rows.append({
                "code": code,
                "name": item.get("name") or code,
                "price": item.get("latestNav") or item.get("price"),
                "latestNav": item.get("latestNav"),
                "latestNavDate": str(item.get("latestNavDate") or ""),
                "previousClose": item.get("previousClose") or item.get("previousNav"),
                "changePercent": item.get("changePercent"),
                "premiumPercent": None,
                "iopv": None,
                "volume": item.get("volume"),
                "turnover": item.get("turnover"),
                "marketState": item.get("marketState") or "CLOSED",
                "asOf": item.get("asOf") or item.get("updatedAt"),
                "session": "otc",
            })
        return self.fund_store.upsert_quotes(rows)

    def _publish_details(self) -> int:
        """每日：从 fund_reference 同步限额 + 费率写 fund_detail。"""
        if self.fund_store is None:
            return 0
        etf_symbols = list(self.config.get("symbols") or SYMBOLS)
        otc_symbols = list((self.config.get("fund_reference_sync") or {}).get("symbols") or OTC_SYMBOLS)
        all_codes = list(dict.fromkeys(etf_symbols + otc_symbols))
        rows: list[dict[str, Any]] = []
        for code in all_codes:
            fee = self.store.read_latest_fund_references("fund_fee", [code]).get(code) or {}
            lim = self.store.read_latest_fund_references("fund_limit", [code]).get(code) or {}
            if not fee and not lim:
                continue
            is_etf = code in etf_symbols
            rows.append({
                "code": code,
                "name": fee.get("fundName") or lim.get("fundName") or code,
                "full_name": fee.get("fullName"),
                "fund_type": ("exchange" if is_etf else "otc"),
                "exchange": ("exchange" if is_etf else "otc"),
                "region": "cn",
                "buy_status": lim.get("buyStatus"),
                "buy_status_text": lim.get("buyStatusText"),
                "max_purchase_per_day": lim.get("maxPurchasePerDay"),
                "channel_limits": lim.get("channelLimits") or {},
                "limit_channel": lim.get("limitChannel"),
                "limit_channel_text": lim.get("limitChannelText"),
                "limit_schema_version": lim.get("limitSchemaVersion") or 2,
                "currency": lim.get("currency") or "CNY",
                "min_purchase": lim.get("minPurchase"),
                "confirm_days": lim.get("confirmDays"),
                "management_fee_rate": fee.get("managementFeeRate"),
                "custody_fee_rate": fee.get("custodyFeeRate"),
                "annual_fee_rate": fee.get("annualFeeRate"),
                "sales_service_fee_rate": fee.get("salesServiceFeeRate"),
                "redeem_fee_rate": fee.get("redeemFeeRate"),
                "redeem_rules": fee.get("redeemRules"),
                "operation_fees": fee.get("operationFees"),
                "fund_size": fee.get("fundSize"),
            })
        return self.fund_store.upsert_details(rows)


    def _build_limit_events_from_snapshots(self, days: int = 30, name_map: dict[str, str] | None = None) -> list[dict[str, Any]]:
        """用 collector 自己的 fund_limit 历史快照生成有金额变化的 events。

        ocr-proxy 的 diff 依赖 KV 里 previous/current 两个快照，cron 时序或 KV 过期
        会导致 tighten/relax 事件丢失；且其 scope_changed 事件无金额，对用户无意义。
        collector 每日存 fund_limit 快照（fund_reference_snapshots 表），有完整历史，
        可以可靠地 diff 出每只基金的限额变化轨迹。
        """
        if self.store is None:
            return []
        names = name_map or {}
        try:
            history = self.store.read_fund_reference_history('fund_limit', days)
        except Exception as exc:
            print(f"[fund-store] read_fund_reference_history failed: {exc}", flush=True)
            return []
        if not history:
            return []
        by_symbol: dict[str, list[dict[str, Any]]] = {}
        for row in history:
            sym = str(row.get('symbol') or '')
            if not sym:
                continue
            by_symbol.setdefault(sym, []).append({
                'date': str(row.get('snapshot_date') or ''),
                'payload': row.get('payload') or {},
            })
        events: list[dict[str, Any]] = []
        for symbol, rows in by_symbol.items():
            rows.sort(key=lambda r: r['date'])
            for i in range(1, len(rows)):
                prev = rows[i - 1]
                curr = rows[i]
                prev_p = prev['payload']
                curr_p = curr['payload']
                prev_status = str(prev_p.get('buyStatus') or '').lower()
                curr_status = str(curr_p.get('buyStatus') or '').lower()
                prev_amount = None if prev_status == 'suspended' else self._finite_money(prev_p.get('maxPurchasePerDay'))
                curr_amount = None if curr_status == 'suspended' else self._finite_money(curr_p.get('maxPurchasePerDay'))
                currency = str(curr_p.get('currency') or prev_p.get('currency') or 'CNY').upper()
                fund_name = names.get(symbol) or str(curr_p.get('name') or curr_p.get('fundName') or symbol)
                effective_at = curr_p.get('effectiveDate') or curr.get('date') or None
                observed_at = curr.get('date') or None
                if prev_amount is not None and curr_amount is not None and prev_amount != curr_amount:
                    etype = 'tighten' if curr_amount < prev_amount else 'relax'
                    events.append({
                        'type': etype, 'code': symbol, 'fundName': fund_name,
                        'currency': currency, 'before': prev_amount, 'after': curr_amount,
                        'effectiveAt': effective_at, 'observedAt': observed_at,
                    })
                elif prev_status != 'suspended' and curr_status == 'suspended':
                    events.append({
                        'type': 'suspend', 'code': symbol, 'fundName': fund_name,
                        'currency': currency, 'before': prev_amount, 'after': None,
                        'effectiveAt': effective_at, 'observedAt': observed_at,
                    })
                elif prev_status == 'suspended' and curr_status != 'suspended' and curr_amount is not None:
                    events.append({
                        'type': 'resume', 'code': symbol, 'fundName': fund_name,
                        'currency': currency, 'before': 0, 'after': curr_amount,
                        'effectiveAt': effective_at, 'observedAt': observed_at,
                    })
                elif prev_amount is None and curr_amount is not None and prev_status != 'suspended':
                    events.append({
                        'type': 'new_limit', 'code': symbol, 'fundName': fund_name,
                        'currency': currency, 'before': 0, 'after': curr_amount,
                        'effectiveAt': effective_at, 'observedAt': observed_at,
                    })
        # 过滤无金额事件（before/after 都为 None 对用户无意义）
        events = [e for e in events if e.get('before') is not None or e.get('after') is not None]
        # 去重：同一 code+type+before+after 只保留最新一条（多日快照 diff 会产生重复）
        seen: set[str] = set()
        unique: list[dict[str, Any]] = []
        for e in events:
            key = '|'.join([str(e.get('code') or ''), str(e.get('type') or ''),
                            str(e.get('before')), str(e.get('after'))])
            if key in seen:
                continue
            seen.add(key)
            unique.append(e)
        return unique[:50]

    @staticmethod
    def _finite_money(value: Any) -> float | None:
        if value is None:
            return None
        try:
            n = float(value)
            return n if n > 0 and math.isfinite(n) else None
        except (TypeError, ValueError):
            return None



    def _build_limit_trend_from_snapshots(self, days: int = 30) -> list[dict[str, Any]]:
        # 用 fund_limit 历史快照重新计算每日总额，修正 ocr-proxy daily snapshot
        # 里 suspended 残留金额导致的断崖（8-16->8-19 CNY 从 30110 暴跌到 110）。
        # 只计 limit_large 且有金额的基金，suspended 的金额算 null 不计入总额。
        if self.store is None:
            return []
        try:
            history = self.store.read_fund_reference_history('fund_limit', days)
        except Exception:
            return []
        if not history:
            return []
        by_date: dict[str, dict[str, float]] = {}
        by_date_channel: dict[str, dict[str, dict[str, float]]] = {}
        by_date_count: dict[str, int] = {}
        for row in history:
            date = str(row.get('snapshot_date') or '')
            if not date:
                continue
            payload = row.get('payload') or {}
            status = str(payload.get('buyStatus') or '').lower()
            amount = None if status == 'suspended' else self._finite_money(payload.get('maxPurchasePerDay'))
            currency = str(payload.get('currency') or 'CNY').upper()
            if amount is not None and amount > 0 and status == 'limit_large':
                totals = by_date.setdefault(date, {})
                totals[currency] = totals.get(currency, 0.0) + amount
                channel_limits = payload.get('channelLimits') or {}
                direct = self._finite_money(channel_limits.get('direct') or channel_limits.get('all'))
                distributor = self._finite_money(channel_limits.get('distributor') or channel_limits.get('all'))
                if direct is not None or distributor is not None:
                    channel_totals = by_date_channel.setdefault(date, {}).setdefault(currency, {})
                    if direct is not None:
                        channel_totals['direct'] = channel_totals.get('direct', 0.0) + direct
                    if distributor is not None:
                        channel_totals['distributor'] = channel_totals.get('distributor', 0.0) + distributor
            by_date_count[date] = by_date_count.get(date, 0) + 1
        trend = []
        for date in sorted(by_date.keys()):
            trend.append({
                'date': date,
                'totalByCurrency': by_date[date],
                'channelTotals': by_date_channel.get(date, {}),
                'coveredFundCount': by_date_count.get(date, 0),
            })
        return trend

    def _publish_limit_overview(self) -> int:
        """Persist the quota overview produced from collector-owned snapshots."""
        if self.fund_store is None:
            return 0
        try:
            payload = self._ensure_data_service().fund_limit_overview()
        except Exception as exc:
            print(f"[fund-store] local fund-limit overview failed: {exc}", flush=True)
            return 0
        atomic_write_json(Path(str(self.config["output_dir"])) / "fund-limit-overview.json", payload)
        return self.fund_store.upsert_limit_overview(payload)

    def _fetch_nav_history_rows(self, codes: list[str]) -> list[dict[str, Any]]:
        """Read NAV history through the local collector data service and direct public sources."""
        data_service = self._ensure_data_service()
        today = datetime.now(SHANGHAI).date()
        out: list[dict[str, Any]] = []
        for code in codes:
            try:
                payload = data_service.nav_history(code, 1000)
            except Exception as exc:
                print(f"[fund-store] local nav-history fail {code}: {exc}", flush=True)
                continue
            for row in payload.get("items") or []:
                try:
                    nav = float(row.get("nav"))
                except (TypeError, ValueError):
                    continue
                nav_date = str(row.get("date") or "")[:10]
                if nav > 0 and nav_date:
                    out.append({"code": code, "date": nav_date, "nav": nav, "source": payload.get("source") or "market-collector"})
        return out

    def _fetch_history_close_rows(self, symbol: str, limit: int = 3000) -> list[dict[str, Any]]:
        """拉单只场内 ETF 真实日 K 收盘价（markets-worker 日 K，eastmoney 兜底）。"""
        data_service = self._ensure_data_service()
        payload = data_service.daily_price_klines(symbol, limit)
        source = str(payload.get("source") or "eastmoney-kline")
        out: list[dict[str, Any]] = []
        for candle in (payload.get("candles") or []):
            close = candle.get("c")
            try:
                close_f = float(close)
            except (TypeError, ValueError):
                continue
            if not (close_f > 0):
                continue
            out.append({"code": symbol, "date": str(candle.get("date") or "")[:10], "close": close_f, "source": source})
        return out

    def _publish_history_close(self, limit: int = 120) -> int:
        """写场内 ETF 真实日 K close 到 fund_history（净值同步不再覆盖）。

        按标的逐只 upsert：全量合并成一个事务跨远端 TiDB 容易超时回滚（已实测），
        逐只提交把事务控制在单标的历史量级，失败不影响其他标的。
        日常增量只需近几个月（limit=120）；全量回填用 --history-close-once（limit=3000）。
        """
        if self.fund_store is None:
            return 0
        etf_symbols = list(self.config.get("symbols") or SYMBOLS)
        total = 0
        for symbol in etf_symbols:
            try:
                rows = self._fetch_history_close_rows(symbol, limit)
            except Exception as exc:
                print(f"[fund-store] daily_price_klines {symbol} fail: {exc}", flush=True)
                continue
            n = self.fund_store.upsert_history_close(rows)
            if n == 0 and rows:
                # 写失败重试一次（读超时/锁等待多为瞬时）
                n = self.fund_store.upsert_history_close(rows)
            total += n
        return total

    def _publish_history_and_summary(self) -> tuple[int, int]:
        """每日：拉净值历史增量写 fund_history，再预算 fund_summary。"""
        if self.fund_store is None:
            return 0, 0
        etf_symbols = list(self.config.get("symbols") or SYMBOLS)
        otc_symbols = list((self.config.get("fund_reference_sync") or {}).get("symbols") or OTC_SYMBOLS)
        all_codes = list(dict.fromkeys(etf_symbols + otc_symbols))
        hist_rows = self._fetch_nav_history_rows(all_codes)
        hist_n = self.fund_store.upsert_history(hist_rows)
        # 净值之后写真实市价 close：同日净值行已就位，close 只更新价格列
        try:
            cn = self._publish_history_close()
            print(f"[fund-store] history close upsert={cn}", flush=True)
        except Exception as exc:
            print(f"[fund-store] history close failed: {exc}", flush=True)
        # 预算 summary
        import datetime as _dt
        RETURN_WINDOWS = [("return_1w", 7), ("return_1m", 31), ("return_3m", 93), ("return_6m", 186), ("return_1y", 365)]
        today_str = datetime.now(SHANGHAI).date().isoformat()
        def _num(v):
            if v in (None, ""):
                return None
            try:
                f = float(v); return f if f == f else None
            except (TypeError, ValueError):
                return None
        def pct(cur, base):
            a, b = _num(cur), _num(base)
            if a is None or b is None or b <= 0:
                return None
            return round((a - b) / b * 10000) / 100
        def hist_pct(closes, current):
            current = _num(current); cs = [x for x in (_num(c) for c in closes) if x is not None]
            if current is None or not cs:
                return None
            return round(sum(1 for x in cs if x <= current) / len(cs) * 10000) / 100
        def dd_pct(closes, current):
            current = _num(current); cs = [x for x in (_num(c) for c in closes) if x is not None and x > 0]
            if current is None or current <= 0 or len(cs) < 2:
                return None
            rm = -float("inf"); dds = []
            for cl in cs:
                if cl > rm:
                    rm = cl
                dds.append((cl / rm - 1) * 100)
            cur_dd = (current / rm - 1) * 100
            if cur_dd != cur_dd:
                return None
            return round(sum(1 for d in dds if d >= cur_dd) / len(dds) * 10000) / 100
        summary_rows: list[dict[str, Any]] = []
        for code in all_codes:
            pts = self.fund_store.read_history(code)
            if not pts:
                continue
            pts.sort(key=lambda x: x[0])
            dates = [d for (d, _n) in pts]; navs = [n for (_d, n) in pts]
            last_nav = navs[-1] if navs else None
            if not last_nav:
                continue
            last_t = int(_dt.datetime.fromisoformat(dates[-1] + "T00:00:00+08:00").timestamp())
            def cab(t):
                sel = None
                for d, n in pts:
                    tt = int(_dt.datetime.fromisoformat(d + "T00:00:00+08:00").timestamp())
                    if tt <= t:
                        sel = n
                    else:
                        break
                return sel
            r = {k: pct(last_nav, cab(last_t - days * 86400)) for k, days in RETURN_WINDOWS}
            year = dates[-1][:4]
            ytd_base = None
            for d, n in pts:
                if d >= year + "-01-01":
                    ytd_base = n; break
            r["ytd_return"] = pct(last_nav, ytd_base)
            r["return_base"] = pct(last_nav, navs[0])
            r["historical_percentile"] = hist_pct(navs, last_nav)
            r["drawdown_percentile"] = dd_pct(navs, last_nav)
            cutoff = last_t - 365 * 86400
            high = None; high_date = ""
            for d, n in pts:
                tt = int(_dt.datetime.fromisoformat(d + "T00:00:00+08:00").timestamp())
                if tt < cutoff:
                    continue
                if high is None or n > high:
                    high = n; high_date = d
            chd = round((last_nav / high - 1) * 10000) / 100 if high and high > 0 else None
            summary_rows.append({
                "code": code, "date": today_str, "latest_nav": last_nav,
                **r, "high_drawdown": chd, "close_high_drawdown": chd,
                "high_point": high, "high_point_date": high_date,
                "close_high_point": high, "close_high_point_date": high_date,
            })
        sum_n = self.fund_store.upsert_summaries(summary_rows)
        return hist_n, sum_n

    # ── 高频行情线程 ──
    def _refresh_iopv_cache(self) -> int:
        """低频线程：拉 eastmoney iopv，更新缓存（5s 一次）。返回命中数。"""
        symbols = list(self.config["symbols"])
        timeout = float(self.config.get("request_timeout_sec") or 10)
        try:
            iopv_map, _ = fetch_eastmoney_references(symbols, timeout)
        except Exception as exc:
            print(f"[high-freq] iopv fetch failed: {exc}", flush=True)
            return 0
        with self._iopv_lock:
            for symbol in symbols:
                row = iopv_map.get(symbol) or {}
                # LOF 无盘中 IOPV，但东方财富会公布场内折溢价率（vendor_premium_percent）。
                # 有 iopv 或 vendor_premium 都要缓存，高频线程才能算出 LOF 溢价。
                if row.get("iopv") is not None or row.get("vendor_premium_percent") is not None:
                    self._iopv_cache[symbol] = row
        return len(iopv_map)

    def _high_freq_publish_quotes(self) -> int:
        """高频线程：tencent 拉价 + 读 iopv 缓存 + 算 premium，upsert fund_quote（1s 一次）。"""
        if self.fund_store is None:
            return 0
        symbols = list(self.config["symbols"])
        timeout = float(self.config.get("request_timeout_sec") or 10)
        collected_at = isoformat_z(datetime.now(timezone.utc))
        try:
            price_map = fetch_tencent_quotes(symbols, timeout)
        except Exception as exc:
            print(f"[high-freq] tencent fetch failed: {exc}", flush=True)
            return 0
        iopv_snapshot: dict[str, dict[str, Any]] = {}
        with self._iopv_lock:
            iopv_snapshot = dict(self._iopv_cache)
        rows: list[dict[str, Any]] = []
        for symbol in symbols:
            pr = price_map.get(symbol) or {}
            if not pr.get("price"):
                continue
            ir = iopv_snapshot.get(symbol) or {}
            price = pr.get("price")
            iopv = ir.get("iopv")
            premium_percent = None
            if iopv and math.isfinite(iopv) and iopv > 0 and math.isfinite(price) and price > 0:
                premium_percent = round((price / iopv - 1) * 100, 4)
            elif ir.get("vendor_premium_percent") is not None:
                premium_percent = ir.get("vendor_premium_percent")
            rows.append({
                "code": symbol,
                "name": pr.get("name") or symbol,
                "price": price,
                "latestNav": None,
                "latestNavDate": None,
                "previousClose": pr.get("previous_close"),
                "change": pr.get("change"),
                "changePercent": pr.get("change_percent"),
                "premiumPercent": premium_percent,
                "iopv": iopv,
                "volume": pr.get("volume"),
                "turnover": pr.get("turnover"),
                "marketState": "OPEN",
                "asOf": collected_at,
                "session": "exchange",
                "suspended": bool(pr.get("suspended")),
            })
        if not rows:
            return 0
        return self._upsert_quotes_fast(rows)

    def _upsert_quotes_fast(self, rows: list[dict[str, Any]]) -> int:
        """高频写入：完全独立于 fund_store，直接从 config 读 TiDB target 建连接。

        fund_store.initialize() 会建立 autocommit=False 的连接并污染同用户会话状态，
        导致后续新建的 autocommit=True 连接写入无法跨连接可见（同连接可读、跨连接不可见）。
        本方法不依赖 self.fund_store，避免污染。
        """
        import pymysql
        import os
        from .fund_store import _shanghai_iso, _num, _date_str
        storage_cfg = (self.config.get("storage") or {}).get("tidb") or self.config.get("tidb") or {}
        raw_targets = storage_cfg.get("targets") or []
        if not raw_targets:
            return 0
        target = raw_targets[0]
        sql = """INSERT INTO fund_quote (code,name,price,latest_nav,latest_nav_date,previous_close,change_amount,change_percent,premium_percent,iopv,volume,turnover,market_state,as_of,session,suspended,updated_at) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
ON DUPLICATE KEY UPDATE name=VALUES(name),price=VALUES(price),latest_nav=VALUES(latest_nav),latest_nav_date=VALUES(latest_nav_date),previous_close=VALUES(previous_close),change_amount=VALUES(change_amount),change_percent=VALUES(change_percent),premium_percent=VALUES(premium_percent),iopv=VALUES(iopv),volume=VALUES(volume),turnover=VALUES(turnover),market_state=VALUES(market_state),as_of=VALUES(as_of),session=VALUES(session),suspended=VALUES(suspended),updated_at=VALUES(updated_at)"""
        import pymysql
        import os
        from .fund_store import _shanghai_iso, _num, _date_str
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
                host=target["host"],
                port=int(target.get("port") or 4000),
                user=target["user"],
                password=password,
                database=target.get("database") or "ai_dca_market",
                ssl_verify_cert=True,
                ssl_verify_identity=True,
                ssl_ca=target.get("ssl_ca") or "/etc/ssl/certs/ca-certificates.crt",
                autocommit=True,
                charset="utf8mb4",
            )
            with conn.cursor() as cur:
                for row in mapped:
                    cur.execute(sql, row)
            return len(mapped)
        except Exception as exc:
            print(f"[high-freq] write failed: {exc}", flush=True)
            return 0
        finally:
            if conn is not None:
                try:
                    conn.close()
                except Exception:
                    pass

    def _iopv_loop(self) -> None:
        """低频线程主循环：交易时段每 5s 刷新 iopv 缓存。"""
        while not self._high_freq_stop.is_set():
            now = datetime.now(timezone.utc)
            if classify_session(now) == "trading":
                try:
                    self._refresh_iopv_cache()
                except Exception as exc:
                    print(f"[high-freq] iopv loop error: {exc}", flush=True)
            self._high_freq_stop.wait(5.0)

    def _quote_loop(self) -> None:
        """高频线程主循环：交易时段每 1s 刷新 fund_quote。"""
        while not self._high_freq_stop.is_set():
            now = datetime.now(timezone.utc)
            if classify_session(now) == "trading":
                t0 = time.time()
                try:
                    n = self._high_freq_publish_quotes()
                    print(f"[quote-beat] upsert={n} dt={time.time()-t0:.2f}s {isoformat_z(now)}", flush=True)
                except Exception as exc:
                    print(f"[high-freq] quote loop error: {exc}", flush=True)
            self._high_freq_stop.wait(1.0)

    def run_forever(self) -> None:
        # 高频行情线程：quote 1s / iopv 5s，仅在交易时段运行
        quote_thread = threading.Thread(target=self._quote_loop, name="high-freq-quote", daemon=True)
        iopv_thread = threading.Thread(target=self._iopv_loop, name="high-freq-iopv", daemon=True)
        quote_thread.start()
        iopv_thread.start()
        while True:
            now = datetime.now(timezone.utc)
            otc_payload = self.run_due_otc(now)
            if otc_payload is not None:
                # OTC 净值刷新后：更新 fund_quote（场外净值）+ fund_summary（收益/水位）
                try:
                    n = self._publish_quotes()
                    _hn, sn = self._publish_history_and_summary()
                    print(f"[fund-store] otc refresh: quote={n} summary={sn}", flush=True)
                except Exception as exc:
                    print(f"[fund-store] otc refresh failed: {exc}", flush=True)
            if self.run_due_fund_reference_sync(now) is not None:
                # 晚间费率/限额同步后：更新 fund_detail + fund_history/summary
                try:
                    dn = self._publish_details()
                    lo = self._publish_limit_overview()
                    _hn, sn = self._publish_history_and_summary()
                    print(f"[fund-store] daily: detail={dn} limit={lo} summary={sn}", flush=True)
                except Exception as exc:
                    print(f"[fund-store] daily failed: {exc}", flush=True)
            session = classify_session(now)
            # 历史留档 + publisher latest.json（不影响高频 fund_quote）
            schedule = ((self.config.get("schedules") or {}).get(session)) or {}
            interval_sec = max(1, int(schedule.get("interval_sec") or 60))
            enabled = schedule.get("enabled", True) is not False
            if enabled:
                self.collect_once()
            time.sleep(interval_sec)
