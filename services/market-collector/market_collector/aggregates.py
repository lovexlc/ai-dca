from __future__ import annotations

import bisect
import json
import math
import re
import statistics
import threading
import time
import urllib.parse
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable
from zoneinfo import ZoneInfo

from .core import SYMBOLS, classify_session
from .storage import MarketStore, bucket_start_iso, parse_iso

SHANGHAI = ZoneInfo("Asia/Shanghai")
EASTMONEY_KLINE_URL = "https://push2his.eastmoney.com/api/qt/stock/kline/get"
DANJUAN_NAV_HISTORY_URL = "https://danjuanfunds.com/djapi/fund/nav/history/{code}"

GROUPS = [
    {"key": "all", "label": "全部", "order": 0, "codes": list(SYMBOLS)},
    {
        "key": "nasdaq-100", "label": "纳指 100", "order": 10,
        "codes": ["513870", "513390", "513300", "513110", "513100", "159941", "159696", "159660", "159659", "159632", "159513", "159501", "161130"],
    },
    {"key": "sp500", "label": "标普 500", "order": 20, "codes": ["161125", "513500", "513650", "159612", "159655"]},
    {"key": "us-50", "label": "美国50", "order": 30, "codes": ["159577", "513850"]},
    {"key": "nasdaq-tech", "label": "美国科技", "order": 40, "codes": ["159509", "161128"]},
]

HOME_BREADTH_SYMBOLS = {
    "513870", "513390", "513300", "513110", "513100", "159941", "159696", "159660",
    "159659", "159632", "159513", "159509", "159501", "159577", "161128", "161130",
    "513500", "513650", "159612", "159655", "513850",
}

FetchJson = Callable[[str, float], dict[str, Any]]
PostJson = Callable[[str, dict[str, Any], float], dict[str, Any]]


def _number(value: Any) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def _round4(value: Any) -> float | None:
    number = _number(value)
    return round(number, 4) if number is not None else None


def _fetch_json(url: str, timeout_sec: float) -> dict[str, Any]:
    request = urllib.request.Request(url, headers={
        "accept": "application/json",
        "user-agent": "Mozilla/5.0 market-collector/1",
        "referer": "https://quote.eastmoney.com/",
    })
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=timeout_sec) as response:
                return json.loads(response.read().decode("utf-8", "replace"))
        except Exception as exc:
            last_error = exc
            if attempt < 2:
                time.sleep(0.2 * (attempt + 1))
    assert last_error is not None
    raise last_error


def _post_json(url: str, payload: dict[str, Any], timeout_sec: float) -> dict[str, Any]:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(url, data=body, method="POST", headers={
        "accept": "application/json", "content-type": "application/json",
        "user-agent": "Mozilla/5.0 market-collector/1",
    })
    with urllib.request.urlopen(request, timeout=timeout_sec) as response:
        return json.loads(response.read().decode("utf-8", "replace"))



def _fetch_danjuan_nav_history(code: str, from_date: str, to_date: str, timeout_sec: float) -> list[dict[str, Any]]:
    normalized = str(code or "").strip()
    if not re.fullmatch(r"\d{6}", normalized):
        raise ValueError("invalid fund code")
    items: list[dict[str, Any]] = []
    page_size = 100
    for page in range(1, 51):
        params = urllib.parse.urlencode({"page": page, "size": page_size})
        request = urllib.request.Request(
            DANJUAN_NAV_HISTORY_URL.format(code=urllib.parse.quote(normalized)) + "?" + params,
            headers={
                "accept": "application/json, text/plain, */*",
                "referer": "https://danjuanfunds.com/",
                "user-agent": "Mozilla/5.0 market-collector/1",
            },
        )
        with urllib.request.urlopen(request, timeout=timeout_sec) as response:
            payload = json.loads(response.read().decode("utf-8", "replace"))
        rows = ((payload.get("data") or {}).get("items")) or []
        if not rows:
            break
        reached_before_range = False
        for row in rows:
            nav_date = str(row.get("date") or "")[:10]
            nav = _number(row.get("nav", row.get("value")))
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", nav_date):
                continue
            if nav_date < from_date:
                reached_before_range = True
                continue
            if nav_date > to_date or nav is None or nav <= 0:
                continue
            items.append({"date": nav_date, "nav": _round4(nav)})
        total = int((payload.get("data") or {}).get("total_items") or 0)
        if reached_before_range or (total > 0 and page * page_size >= total):
            break
    dedup = {item["date"]: item for item in items}
    return [dedup[key] for key in sorted(dedup)]

def _shanghai_iso(value: datetime) -> str:
    return value.astimezone(SHANGHAI).replace(microsecond=0).isoformat()


def _date_epoch(value: str) -> int:
    return int(datetime.fromisoformat(value + "T00:00:00+08:00").timestamp())


def _previous_date(value: str) -> str:
    return (date.fromisoformat(value) - timedelta(days=1)).isoformat()


def _market_state() -> tuple[str, str]:
    session = classify_session(datetime.now(timezone.utc))
    current = datetime.now(SHANGHAI)
    if current.weekday() >= 5:
        return "holiday", "A 股休市"
    if session == "trading":
        return "open", "A 股连续竞价"
    if session == "lunch":
        return "lunch_break", "A 股午间休市"
    if current.time() < datetime.strptime("09:30", "%H:%M").time():
        return "pre_open", "A 股待开市"
    return "closed", "A 股已收市"


class TimedCache:
    def __init__(self) -> None:
        self._items: dict[str, tuple[float, Any]] = {}
        self._lock = threading.Lock()

    def get_or_load(self, key: str, ttl_sec: int, loader: Callable[[], Any]) -> Any:
        now = time.monotonic()
        with self._lock:
            cached = self._items.get(key)
            if cached and cached[0] > now:
                return cached[1]
        value = loader()
        with self._lock:
            self._items[key] = (now + ttl_sec, value)
        return value


class MarketDataService:
    def __init__(
        self,
        store: MarketStore,
        data_dir: str | Path,
        fetch_json: FetchJson = _fetch_json,
        post_json: PostJson = _post_json,
        timeout_sec: float = 12.0,
    ) -> None:
        self.store = store
        self.data_dir = Path(data_dir)
        self.fetch_json = fetch_json
        self.post_json = post_json
        self.timeout_sec = timeout_sec
        self.cache = TimedCache()

    def _latest(self) -> dict[str, Any]:
        return json.loads((self.data_dir / "latest.json").read_text(encoding="utf-8"))

    def _latest_by_symbol(self) -> dict[str, dict[str, Any]]:
        records = {str(item.get("symbol")): item for item in self._latest().get("symbols", [])}
        try:
            otc_payload = json.loads((self.data_dir / "otc-latest.json").read_text(encoding="utf-8"))
        except (FileNotFoundError, OSError, json.JSONDecodeError):
            otc_payload = {}
        for item in otc_payload.get("items") or []:
            code = str(item.get("code") or item.get("symbol") or "")
            if code:
                records[code] = item
        return records

    def otc_latest(self) -> dict[str, Any]:
        return json.loads((self.data_dir / "otc-latest.json").read_text(encoding="utf-8"))

    def quote(self, symbol: str) -> dict[str, Any] | None:
        item = self._latest_by_symbol().get(symbol)
        if not item:
            return None
        return {
            "symbol": symbol,
            "name": item.get("name") or symbol,
            "price": item.get("price"),
            "close": item.get("price"),
            "previousClose": item.get("previous_close"),
            "change": item.get("change"),
            "changePercent": item.get("change_percent"),
            "open": item.get("open"),
            "high": item.get("high"),
            "low": item.get("low"),
            "volume": item.get("volume"),
            "turnover": item.get("turnover"),
            "turnoverRate": item.get("turnover_rate"),
            "marketState": "OPEN" if item.get("session") == "trading" else "CLOSED",
            "asOf": item.get("price_timestamp") or item.get("collected_at"),
            "quoteDate": str(item.get("collected_at") or "")[:10],
            "quality": item.get("quality"),
            "iopv": item.get("iopv"),
            "iopvDate": str(item.get("iopv_timestamp") or item.get("navDate") or "")[:10],
            "premiumPercent": item.get("computed_premium_percent", item.get("premiumPercent")),
            "vendorPremiumPercent": item.get("vendor_premium_percent"),
        }

    def fund_metric(self, symbol: str) -> dict[str, Any] | None:
        item = self._latest_by_symbol().get(symbol)
        if not item:
            return None
        if item.get("fundKind") or item.get("fundType"):
            result = dict(item)
            result["code"] = symbol
            result.setdefault("quality", {"status": "ok" if item.get("ok", True) else "degraded", "issues": []})
            return result
        return {
            "code": symbol,
            "name": item.get("name") or symbol,
            "price": item.get("price"),
            "previousClose": item.get("previous_close"),
            "changePercent": item.get("change_percent"),
            "premiumPercent": item.get("computed_premium_percent"),
            "vendorPremiumPercent": item.get("vendor_premium_percent"),
            "iopv": item.get("iopv"),
            "iopvDate": str(item.get("iopv_timestamp") or "")[:10],
            "volume": item.get("volume"),
            "turnover": item.get("turnover"),
            "turnoverRate": item.get("turnover_rate"),
            "suspended": bool(item.get("suspended")),
            "marketState": "OPEN" if item.get("session") == "trading" else "CLOSED",
            "asOf": item.get("collected_at"),
            "expiresAt": item.get("expires_at"),
            "quality": item.get("quality"),
        }

    def fund_metrics(self, symbols: list[str]) -> list[dict[str, Any]]:
        codes = list(dict.fromkeys(code for code in symbols if code.isdigit() and len(code) == 6))
        metrics = {code: self.fund_metric(code) for code in codes}
        if not codes:
            return []
        today = datetime.now(SHANGHAI).date()
        start = today - timedelta(days=45)

        def load_navs() -> dict[str, list[dict[str, Any]]]:
            result: dict[str, list[dict[str, Any]]] = {}
            missing = [code for code in codes if not (metrics.get(code) or {}).get("latestNav")]
            if not missing:
                return result
            with ThreadPoolExecutor(max_workers=min(6, len(missing))) as executor:
                futures = {
                    executor.submit(_fetch_danjuan_nav_history, code, start.isoformat(), today.isoformat(), self.timeout_sec): code
                    for code in missing
                }
                for future, code in ((future, futures[future]) for future in futures):
                    try:
                        result[code] = future.result()
                    except Exception:
                        result[code] = []
            return result

        cache_key = "latest-navs:" + ",".join(sorted(codes))
        missing_nav_codes = [code for code in codes if not (metrics.get(code) or {}).get("latestNav")]
        navs = self.cache.get_or_load(cache_key, 1800, load_navs) if missing_nav_codes else {}
        output = []
        for code in codes:
            metric = metrics.get(code)
            if not metric:
                continue
            rows = navs.get(code) or []
            if rows:
                latest = rows[-1]
                metric["latestNav"] = latest["nav"]
                metric["latestNavDate"] = latest["date"]
                if len(rows) > 1:
                    metric["previousNav"] = rows[-2]["nav"]
                    metric["previousNavDate"] = rows[-2]["date"]
            output.append(metric)
        return output

    def _raw_samples(self, symbol: str) -> list[dict[str, Any]]:
        samples = []
        for stored_sample in self.store.read_raw_samples(symbol, session="trading"):
            try:
                payload = dict(stored_sample)
                payload["_epoch"] = parse_iso(str(payload["collected_at"])).timestamp()
                samples.append(payload)
            except (KeyError, TypeError, ValueError):
                continue
        return sorted(samples, key=lambda item: item["_epoch"])

    def intraday_klines(self, symbol: str, limit: int = 240) -> dict[str, Any]:
        grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for sample in self._raw_samples(symbol):
            grouped[bucket_start_iso(str(sample["collected_at"]))].append(sample)
        candles = []
        for bucket, samples in sorted(grouped.items(), key=lambda item: parse_iso(item[0]).timestamp()):
            prices = [_number(item.get("price")) for item in samples]
            prices = [value for value in prices if value is not None and value > 0]
            if not prices:
                continue
            latest = samples[-1]
            premiums = [_number(item.get("computed_premium_percent")) for item in samples]
            premiums = [value for value in premiums if value is not None]
            iopv = _number(latest.get("iopv"))
            candle = {
                "t": int(parse_iso(bucket).timestamp()),
                "time": bucket,
                "date": bucket[:10],
                "o": _round4(prices[0]), "h": _round4(max(prices)),
                "l": _round4(min(prices)), "c": _round4(prices[-1]),
                "marketPrice": _round4(prices[-1]),
                "iopv": _round4(iopv), "nav": _round4(iopv),
                "premiumPercent": _round4(premiums[-1]) if premiums else None,
                "premiumOpen": _round4(premiums[0]) if premiums else None,
                "premiumHigh": _round4(max(premiums)) if premiums else None,
                "premiumLow": _round4(min(premiums)) if premiums else None,
                "premiumClose": _round4(premiums[-1]) if premiums else None,
                "sampleCount": len(samples),
                "quality": latest.get("quality"),
            }
            candles.append(candle)
        candles = candles[-max(1, min(limit, 3000)):]
        return {
            "market": "cn", "symbol": symbol, "interval": "5m",
            "generatedAt": _shanghai_iso(datetime.now(timezone.utc)),
            "source": f"market-collector-{self.store.backend_name}", "candles": candles,
        }

    def daily_price_klines(self, symbol: str, limit: int = 500) -> dict[str, Any]:
        limit = max(1, min(limit, 3000))
        secid = ("1." if symbol.startswith(("5", "6")) else "0.") + symbol
        params = urllib.parse.urlencode({
            "secid": secid, "klt": 101, "fqt": 1, "lmt": limit, "end": 20500101,
            "fields1": "f1,f2,f3,f4,f5,f6",
            "fields2": "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61",
        })

        def load() -> dict[str, Any]:
            raw = self.fetch_json(EASTMONEY_KLINE_URL + "?" + params, self.timeout_sec)
            source = "eastmoney-push2his"
            data = raw.get("data") or {}
            candles = []
            for line in data.get("klines") or []:
                fields = str(line).split(",")
                if len(fields) < 11:
                    continue
                candle = {
                    "date": fields[0], "t": _date_epoch(fields[0]),
                    "o": _round4(fields[1]), "c": _round4(fields[2]),
                    "h": _round4(fields[3]), "l": _round4(fields[4]),
                    "v": _number(fields[5]), "amount": _number(fields[6]),
                    "amplitudePercent": _round4(fields[7]),
                    "changePercent": _round4(fields[8]), "change": _round4(fields[9]),
                    "turnoverRate": _round4(fields[10]),
                }
                candles.append(candle)
            return {
                "market": "cn", "symbol": symbol, "name": data.get("name") or symbol,
                "interval": "1d", "generatedAt": _shanghai_iso(datetime.now(timezone.utc)),
                "source": source, "candles": candles,
            }

        return self.cache.get_or_load(f"daily:{symbol}:{limit}", 300, load)

    def nav_history(self, symbol: str, days: int = 365) -> dict[str, Any]:
        days = max(1, min(days, 3650))
        to_date = datetime.now(SHANGHAI).date()
        from_date = to_date - timedelta(days=days)
        def load() -> dict[str, Any]:
            rows = _fetch_danjuan_nav_history(symbol, from_date.isoformat(), to_date.isoformat(), self.timeout_sec)
            items = [{"date": item["date"], "t": _date_epoch(item["date"]), "nav": item["nav"]} for item in rows]
            return {
                "symbol": symbol, "from": from_date.isoformat(), "to": to_date.isoformat(),
                "generatedAt": _shanghai_iso(datetime.now(timezone.utc)),
                "source": "danjuan-nav-history", "items": items,
            }

        return self.cache.get_or_load(f"nav:{symbol}:{days}", 1800, load)

    def daily_combined(self, symbol: str, limit: int = 500) -> dict[str, Any]:
        with ThreadPoolExecutor(max_workers=2) as executor:
            price_future = executor.submit(self.daily_price_klines, symbol, limit)
            nav_future = executor.submit(self.nav_history, symbol, max(365, int(limit * 1.7)))
            price_payload = price_future.result()
            nav_payload = nav_future.result()
        nav_items = nav_payload["items"]
        nav_dates = [item["date"] for item in nav_items]
        candles = []
        for raw in price_payload["candles"]:
            lookup_date = _previous_date(raw["date"])
            position = bisect.bisect_right(nav_dates, lookup_date) - 1
            nav_item = nav_items[position] if position >= 0 else None
            nav = _number(nav_item.get("nav")) if nav_item else None
            close = _number(raw.get("c"))
            premium = ((close / nav) - 1) * 100 if close is not None and nav is not None and nav > 0 else None
            candles.append({
                **raw,
                "marketPrice": close,
                "nav": _round4(nav),
                "iopv": _round4(nav),
                "navDate": nav_item.get("date") if nav_item else "",
                "premiumPercent": _round4(premium),
            })
        return {
            **price_payload,
            "candles": candles,
            "navCandles": [{"date": item["date"], "t": item["t"], "nav": item["nav"], "o": item["nav"], "h": item["nav"], "l": item["nav"], "c": item["nav"]} for item in nav_items],
            "navAlignment": "cross-border T-1",
        }

    def kline(self, symbol: str, interval: str, limit: int) -> dict[str, Any]:
        return self.intraday_klines(symbol, limit) if interval == "5m" else self.daily_combined(symbol, limit)

    def premium_series(self, symbol: str, interval: str, limit: int) -> dict[str, Any]:
        payload = self.kline(symbol, interval, limit)
        points = [{
            "time": item.get("time") or item.get("date"), "t": item.get("t"),
            "date": item.get("date"), "price": item.get("c"),
            "nav": item.get("nav"), "navDate": item.get("navDate") or item.get("date"),
            "premiumPercent": item.get("premiumPercent"),
        } for item in payload["candles"]]
        return {"symbol": symbol, "interval": interval, "generatedAt": payload["generatedAt"], "points": points}

    def home_overview(self) -> dict[str, Any]:
        latest = self._latest()
        records = [
            item for item in (latest.get("symbols") or [])
            if str(item.get("symbol") or "") in HOME_BREADTH_SYMBOLS
        ]
        premiums = [_number(item.get("computed_premium_percent")) for item in records]
        premiums = [value for value in premiums if value is not None]
        changes = [_number(item.get("change_percent")) for item in records]
        changes = [value for value in changes if value is not None]
        price_ready = sum(_number(item.get("price")) is not None for item in records)
        premium_ready = len(premiums)
        total = len(HOME_BREADTH_SYMBOLS)
        market_state, session_label = _market_state()
        generated_at = latest.get("generated_at") or _shanghai_iso(datetime.now(timezone.utc))
        return {
            "schemaVersion": 1, "marketState": market_state, "sessionLabel": session_label,
            "generatedAt": generated_at, "priceAsOf": generated_at,
            "navAsOf": max((str(item.get("iopv_timestamp") or "") for item in records), default=""),
            "coverage": {
                "price": {"ready": price_ready, "total": total, "missing": total - price_ready, "stale": 0, "status": "ready" if price_ready == total else "partial"},
                "premium": {"ready": premium_ready, "total": total, "missing": total - premium_ready, "stale": 0, "status": "ready" if premium_ready == total else "partial"},
            },
            "breadth": {
                "riseCount": sum(value > 0 for value in changes),
                "fallCount": sum(value < 0 for value in changes),
                "flatCount": sum(value == 0 for value in changes),
                "premiumMedianPercent": _round4(statistics.median(premiums)) if premiums else None,
                "highPremiumCount": sum(value >= 5 for value in premiums),
            },
            "groups": [{key: value for key, value in group.items() if key != "codes"} for group in GROUPS],
            "anomalies": [], "source": "market-collector",
        }

    def home_series(self) -> dict[str, Any]:
        latest = self._latest_by_symbol()
        samples_by_symbol = {symbol: self._raw_samples(symbol) for symbol in SYMBOLS}
        available_dates = sorted({
            parse_iso(str(sample["collected_at"])).astimezone(SHANGHAI).date().isoformat()
            for samples in samples_by_symbol.values()
            for sample in samples
        })
        trading_date = available_dates[-1] if available_dates else None

        # home_series 集合的生产口径：只取最近交易日，并以 1 分钟桶最后一个样本为准。
        # 不能从 168 小时 raw retention 直接截最后 240 个 5 分钟桶，否则会跨交易日。
        by_symbol: dict[str, list[dict[str, Any]]] = {}
        if trading_date:
            for symbol, samples in samples_by_symbol.items():
                buckets: dict[str, dict[str, Any]] = {}
                for sample in samples:
                    sample_date = parse_iso(str(sample["collected_at"])).astimezone(SHANGHAI).date().isoformat()
                    if sample_date != trading_date:
                        continue
                    bucket = bucket_start_iso(str(sample["collected_at"]), 60)
                    buckets[bucket] = sample
                points = []
                for bucket, sample in sorted(buckets.items(), key=lambda item: parse_iso(item[0]).timestamp()):
                    price = _number(sample.get("price"))
                    if price is None or price <= 0:
                        continue
                    points.append({
                        "time": bucket,
                        "date": trading_date,
                        "price": _round4(price),
                        "nav": _round4(sample.get("iopv")),
                        "premiumPercent": _round4(sample.get("computed_premium_percent")),
                    })
                by_symbol[symbol] = points
        else:
            by_symbol = {symbol: [] for symbol in SYMBOLS}

        group_for = {code: group["key"] for group in GROUPS[1:] for code in group["codes"]}
        price_series = []
        premium_series = []
        for symbol in SYMBOLS:
            rows = by_symbol.get(symbol) or []
            if not rows:
                continue
            name = (latest.get(symbol) or {}).get("name") or symbol
            group_key = group_for.get(symbol, "all")
            price_series.append({
                "key": symbol, "code": symbol, "name": name, "groupKey": group_key,
                "points": [{"time": row["time"], "price": row["price"]} for row in rows],
            })
            premium_points = [{
                "time": row["time"], "price": row["price"], "nav": row["nav"],
                "premiumPercent": row["premiumPercent"], "navDate": trading_date,
            } for row in rows if row["premiumPercent"] is not None]
            if premium_points:
                premium_series.append({
                    "key": symbol, "code": symbol, "name": name, "groupKey": group_key,
                    "points": premium_points,
                })

        def aggregate_points(group: dict[str, Any], metric: str) -> list[dict[str, Any]]:
            values: dict[str, list[float]] = defaultdict(list)
            bases: dict[str, float] = {}
            for code in group["codes"]:
                for row in by_symbol.get(code) or []:
                    value = _number(row["price"] if metric == "price" else row["premiumPercent"])
                    if value is None:
                        continue
                    if metric == "price":
                        bases.setdefault(code, value)
                        value = value / bases[code] * 100
                    values[row["time"]].append(value)
            return [
                {"time": key, "value": _round4(statistics.mean(items) if metric == "price" else statistics.median(items))}
                for key, items in sorted(values.items()) if items
            ]

        price_aggregates = [{
            "key": f"price-equal-weight-{group['key']}", "role": "equal_weight",
            "label": group["label"] + "等权", "groupKey": group["key"],
            "normalized": True, "points": aggregate_points(group, "price"),
        } for group in GROUPS]
        premium_aggregates = [{
            "key": f"premium-median-{group['key']}", "role": "median",
            "label": group["label"] + "中位数", "groupKey": group["key"],
            "points": aggregate_points(group, "premium"),
        } for group in GROUPS]

        yesterday = None
        if len(available_dates) > 1:
            previous_date = available_dates[-2]
            previous_values = []
            for samples in samples_by_symbol.values():
                matching = [sample for sample in samples if parse_iso(str(sample["collected_at"])).astimezone(SHANGHAI).date().isoformat() == previous_date]
                if not matching:
                    continue
                value = _number(matching[-1].get("computed_premium_percent"))
                if value is not None:
                    previous_values.append(value)
            if previous_values:
                yesterday = {
                    "premiumMedianPercent": _round4(statistics.median(previous_values)),
                    "tradingDate": previous_date,
                }

        return {
            "schemaVersion": 1, "tradingDate": trading_date,
            "bucketMinutes": 1, "windowLabel": "今日 · 1 分钟", "defaultGroupKey": "all",
            "generatedAt": _shanghai_iso(datetime.now(timezone.utc)),
            "groups": [{key: value for key, value in group.items() if key != "codes"} for group in GROUPS],
            "yesterday": yesterday,
            "modes": {
                "price": {"aggregate": {"series": price_aggregates}, "series": price_series},
                "premium": {"aggregate": {"series": premium_aggregates}, "series": premium_series},
            },
            "source": f"market-collector-{self.store.backend_name}-1m",
        }

    def market_summary(self, region: str) -> dict[str, Any] | None:
        from .indices import fetch_market_summary

        normalized = str(region or "CN").strip().upper()
        cache_key = "market-summary:" + normalized
        return self.cache.get_or_load(cache_key, 60, lambda: fetch_market_summary(normalized, self.timeout_sec))

    @staticmethod
    def _normalize_limit_snapshot(source: dict[str, Any]) -> dict[str, Any]:
        summary = source.get("summary") or {}
        raw_records = source.get("records") if isinstance(source.get("records"), list) else []

        def num(value: Any) -> float | None:
            value = _number(value)
            return value if value is not None and value >= 0 else None

        def status_of(item: dict[str, Any]) -> str:
            raw = str(item.get("purchaseStatus") or item.get("buyStatus") or item.get("status") or "").lower()
            if raw in {"suspend", "suspended", "paused", "closed"}: return "suspended"
            if raw in {"limit_large", "limited", "restricted", "limit"}: return "limited"
            if raw in {"open", "available", "normal", "unlimited"}: return "open"
            return "unknown"

        records = []
        by_code: dict[str, dict[str, Any]] = {}
        for index, raw in enumerate(raw_records):
            item = dict(raw) if isinstance(raw, dict) else {}
            code = str(item.get("code") or item.get("symbol") or item.get("fundCode") or f"fund-{index + 1}")
            name = "天弘标普500发起(QDII-FOF)D" if code == "022523" else str(item.get("fundName") or item.get("name") or code)
            currency = str(item.get("currency") or "CNY").upper()
            if currency not in {"CNY", "USD"}: currency = "CNY"
            status = status_of(item)
            amount = num(item.get("limitAmount"))
            if amount is None: amount = num(item.get("maxPurchasePerDay"))
            if status == "suspended": amount = 0
            channel = str(item.get("purchaseChannel") or item.get("limitChannel") or "")
            channel_text = str(item.get("purchaseChannelText") or item.get("limitChannelText") or "")
            app_label = "App购买" if any(word in (channel + " " + channel_text) for word in ("直销", "APP", "App", "app", "官网", "微信公众", "直销柜台")) else ""
            normalized = {**item, "code": code, "name": name, "fundName": name, "currency": currency,
                          "purchaseStatus": status, "amount": _round4(amount), "limitAmount": _round4(amount),
                          "isSuspended": status == "suspended", "isPending": bool(item.get("isPending")),
                          "appLabel": app_label}
            records.append(normalized)
            by_code[code] = normalized

        raw_totals = summary.get("totalByCurrency") if isinstance(summary.get("totalByCurrency"), dict) else {}
        currencies = sorted(set(raw_totals) | {item["currency"] for item in records}, key=lambda value: (value != "CNY", value))
        currency_totals = []
        for currency in currencies:
            current = [item for item in records if item["currency"] == currency]
            total_value = num(raw_totals.get(currency))
            if total_value is None:
                total_value = sum(item.get("amount") or 0 for item in current if item["purchaseStatus"] == "limited" and not item["isPending"])
            currency_totals.append({"currency": currency, "amount": _round4(total_value),
                                    "fundCount": sum(not item["isPending"] and item["purchaseStatus"] != "unknown" for item in current),
                                    "limitedCount": sum(not item["isPending"] and item["purchaseStatus"] == "limited" for item in current)})

        trend = []
        for item in source.get("trend") or []:
            if not isinstance(item, dict): continue
            totals = item.get("totalByCurrency") if isinstance(item.get("totalByCurrency"), dict) else {}
            trend.append({"date": item.get("date"), "cny": _round4(totals.get("CNY")), "usd": _round4(totals.get("USD")),
                          "totalByCurrency": totals, "coveredCount": int(item.get("coveredFundCount") or item.get("coveredCount") or 0)})

        def event_amount(side: Any) -> float | None:
            if isinstance(side, dict): return num(side.get("limitAmount") if side.get("limitAmount") is not None else side.get("amount"))
            return num(side)

        events = []
        raw_events = source.get("recentEvents") if isinstance(source.get("recentEvents"), list) else source.get("events") or []
        for index, raw in enumerate(raw_events):
            if not isinstance(raw, dict): continue
            before_obj = raw.get("before") if isinstance(raw.get("before"), dict) else {}
            after_obj = raw.get("after") if isinstance(raw.get("after"), dict) else {}
            code = str(raw.get("code") or ((after_obj.get("codes") or [""])[0] if isinstance(after_obj.get("codes"), list) else "") or ((before_obj.get("codes") or [""])[0] if isinstance(before_obj.get("codes"), list) else ""))
            record = by_code.get(code) or {}
            event_type = str(raw.get("type") or "scope_changed")
            before = num(raw.get("previousAmount"))
            after = num(raw.get("currentAmount"))
            if before is None: before = event_amount(raw.get("before"))
            if after is None: after = event_amount(raw.get("after"))
            if event_type == "resume": before = 0
            currency = str(raw.get("currency") or after_obj.get("currency") or before_obj.get("currency") or record.get("currency") or "CNY").upper()
            events.append({"id": raw.get("id") or f"{source.get('asOf') or ''}:{code or index}:{event_type}", "type": event_type,
                           "code": code, "name": raw.get("fundName") or record.get("name") or code, "currency": currency,
                           "previousAmount": _round4(before), "currentAmount": _round4(after),
                           "effectiveAt": raw.get("effectiveAt") or raw.get("observedAt") or source.get("asOf")})

        covered = int(summary.get("coveredFundCount") or len(records))
        total = int(summary.get("expectedFundCount") or len(records))
        return {"schemaVersion": 1, "limitAsOf": source.get("asOf"), "generatedAt": source.get("asOf"),
                "coverage": {"covered": covered, "total": total, "review": int(summary.get("reviewCount") or 0)},
                "currencyTotals": currency_totals, "records": records, "trend": trend, "events": events[:100],
                "source": "market-collector-local-snapshot"}

    def fund_limit_overview(self) -> dict[str, Any]:
        snapshot_path = self.data_dir / "fund-limit-overview.json"
        try:
            snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
            if isinstance(snapshot.get("records"), list) and snapshot.get("records"):
                return self._normalize_limit_snapshot(snapshot)
        except (FileNotFoundError, OSError, json.JSONDecodeError, TypeError, ValueError):
            pass
        """Build a Mini Program compatible OTC quota snapshot from local history."""
        rows = self.store.read_fund_reference_history("fund_limit", 30)
        empty = {
            "schemaVersion": 1, "limitAsOf": None, "generatedAt": None,
            "coverage": {"covered": 0, "total": 0, "review": 0},
            "currencyTotals": [], "records": [], "trend": [], "events": [],
            "source": "market-collector",
        }
        if not rows:
            return empty

        def status_of(payload: dict[str, Any]) -> str:
            raw = str(payload.get("purchaseStatus") or payload.get("buyStatus") or payload.get("status") or "").strip().lower()
            if raw in {"suspend", "suspended", "paused", "closed"}:
                return "suspended"
            if raw in {"limit_large", "limited", "restricted", "limit"}:
                return "limited"
            if raw in {"open", "available", "normal"}:
                return "open"
            return "unknown"

        def amount_of(payload: dict[str, Any]) -> float | None:
            for key in ("limitAmount", "maxPurchasePerDay", "amount", "purchaseLimit"):
                value = _number(payload.get(key))
                if value is not None and value >= 0:
                    return value
            return None

        def currency_of(payload: dict[str, Any]) -> str:
            value = str(payload.get("currency") or "CNY").strip().upper()
            return value if value in {"CNY", "USD"} else "CNY"

        def name_of(code: str, payload: dict[str, Any]) -> str:
            if code == "022523":
                return "天弘标普500发起(QDII-FOF)D"
            return str(payload.get("fundName") or payload.get("name") or code)

        by_symbol: dict[str, list[dict[str, Any]]] = {}
        for row in rows:
            code = str(row.get("symbol") or "")
            if code:
                by_symbol.setdefault(code, []).append(row)
        for snapshots in by_symbol.values():
            snapshots.sort(key=lambda item: (str(item.get("snapshot_date") or ""), str(item.get("fetched_at") or "")))

        latest_rows = [snapshots[-1] for snapshots in by_symbol.values() if snapshots]
        latest_date = max(str(row.get("snapshot_date") or "") for row in latest_rows)
        generated_at = max((str(row.get("fetched_at") or "") for row in latest_rows), default="") or latest_date
        records = []
        for row in latest_rows:
            payload = row.get("payload") or {}
            code = str(row.get("symbol") or payload.get("code") or "")
            status = status_of(payload)
            amount = None if status == "suspended" else amount_of(payload)
            channel = str(payload.get("limitChannel") or "").lower()
            app_label = str(payload.get("limitChannelText") or "")
            if not app_label:
                app_label = "基金公司 App" if channel == "app" else ("销售渠道" if channel == "channel" else "")
            records.append({
                "code": code, "fundName": name_of(code, payload), "name": name_of(code, payload),
                "currency": currency_of(payload), "purchaseStatus": status,
                "buyStatus": str(payload.get("buyStatus") or ""), "limitAmount": _round4(amount),
                "amount": _round4(amount), "isSuspended": status == "suspended",
                "isPending": bool(payload.get("isPending")) or status == "unknown", "appLabel": app_label,
                "channelLimits": payload.get("channelLimits") or {},
            })
        records.sort(key=lambda item: (item["currency"], item["isSuspended"], -(item["amount"] or 0), item["name"]))

        currencies = sorted({item["currency"] for item in records}, key=lambda value: (value != "CNY", value))
        currency_totals = []
        for currency in currencies:
            current = [item for item in records if item["currency"] == currency]
            eligible = [item for item in current if not item["isPending"] and item["purchaseStatus"] != "unknown"]
            limited = [item for item in eligible if item["purchaseStatus"] == "limited"]
            currency_totals.append({"currency": currency, "amount": _round4(sum(item["amount"] or 0 for item in limited)), "fundCount": len(eligible), "limitedCount": len(limited)})

        by_date: dict[str, list[dict[str, Any]]] = {}
        for row in rows:
            by_date.setdefault(str(row.get("snapshot_date") or ""), []).append(row)
        trend = []
        for day in sorted(key for key in by_date if key):
            totals: dict[str, float] = {}
            for row in by_date[day]:
                payload = row.get("payload") or {}
                if status_of(payload) != "limited" or bool(payload.get("isPending")):
                    continue
                value = amount_of(payload)
                if value is not None:
                    currency = currency_of(payload)
                    totals[currency] = totals.get(currency, 0.0) + value
            trend.append({"date": day, "cny": _round4(totals.get("CNY")), "usd": _round4(totals.get("USD")), "totalByCurrency": {key: _round4(value) for key, value in totals.items()}, "coveredCount": len(by_date[day])})

        events = []
        for code, snapshots in by_symbol.items():
            for index in range(1, len(snapshots)):
                before = snapshots[index - 1].get("payload") or {}
                after = snapshots[index].get("payload") or {}
                before_status, after_status = status_of(before), status_of(after)
                before_amount = 0 if before_status == "suspended" else amount_of(before)
                after_amount = 0 if after_status == "suspended" else amount_of(after)
                event_type = ""
                if before_status != "suspended" and after_status == "suspended": event_type = "suspend"
                elif before_status == "suspended" and after_status != "suspended": event_type = "resume"
                elif before_amount is not None and after_amount is not None and before_amount != after_amount: event_type = "tighten" if after_amount < before_amount else "relax"
                elif before_status in {"open", "unknown"} and after_status == "limited" and after_amount is not None: event_type = "new_limit"
                if not event_type: continue
                effective_at = after.get("effectiveDate") or snapshots[index].get("snapshot_date")
                events.append({"id": ":".join([str(effective_at or ""), code, event_type]), "type": event_type, "code": code, "name": name_of(code, after), "currency": currency_of(after), "previousAmount": _round4(before_amount), "currentAmount": _round4(after_amount), "effectiveAt": effective_at})
        events.sort(key=lambda item: str(item.get("effectiveAt") or ""), reverse=True)
        review_count = sum(item["purchaseStatus"] in {"limited", "suspended"} for item in records)
        return {
            "schemaVersion": 1, "limitAsOf": latest_date, "generatedAt": generated_at,
            "coverage": {"covered": len(records), "total": len(by_symbol), "review": review_count},
            "currencyTotals": currency_totals, "records": records, "trend": trend,
            "events": events[:100], "source": "market-collector",
        }

    def dataset_record(self, dataset: str, key: str) -> dict[str, Any] | None:
        payload: dict[str, Any] | None = None
        if dataset == "quote" and key.isdigit():
            payload = self.quote(key)
        elif dataset == "fund-metric" and key.isdigit():
            items = self.fund_metrics([key])
            payload = items[0] if items else None
        elif dataset == "kline" and ":" in key:
            symbol, interval = key.split(":", 1)
            payload = self.kline(symbol, interval, 500 if interval == "1d" else 240)
        elif dataset == "home-market-overview" and key == "global":
            payload = self.home_overview()
        elif dataset == "home-market-series" and key == "today:5m":
            payload = self.home_series()
        elif dataset == "market-summary" and key in ("CN", "US"):
            payload = self.market_summary(key)
        elif dataset == "fund-fee" and key.isdigit():
            refs = self.store.read_latest_fund_references("fund_fee", [key])
            payload = refs.get(key)
        elif dataset == "fund-limit-overview" and key == "global":
            payload = self.fund_limit_overview()
        if payload is None:
            return None
        updated_at = payload.get("generatedAt") or payload.get("asOf") or _shanghai_iso(datetime.now(timezone.utc))
        return {"_id": f"{dataset}:{key}", "dataset": dataset, "key": key, "status": "ready", "payload": payload, "version": int(time.time() * 1000), "updatedAt": updated_at}
