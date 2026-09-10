"""Read the local fund product tables as a complete quote snapshot.

The test frontend receives precomputed return and percentile fields in its
exchange-fund snapshot.  The CN collector already computes the same values in
``fund_summary``; this module exposes them together with ``fund_quote`` so API
callers do not need to fetch one year of klines per fund.
"""
from __future__ import annotations

from datetime import date, datetime
from pathlib import Path
from typing import Any

from .aggregates import MarketDataService
from .fund_store import FundStore


_PRODUCT_COLUMNS = (
    "code", "name", "price", "latest_nav", "latest_nav_date",
    "previous_close", "change_amount", "change_percent", "premium_percent",
    "iopv", "volume", "turnover", "market_state", "as_of", "session",
    "suspended", "quote_updated_at", "summary_date", "summary_latest_nav",
    "return_1w", "return_1m", "return_3m", "return_6m", "return_1y",
    "return_base", "ytd_return", "historical_percentile",
    "drawdown_percentile", "high_drawdown", "close_high_drawdown",
    "high_point", "high_point_date", "close_high_point",
    "close_high_point_date", "summary_updated_at",
)


def _date_text(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, (date, datetime)):
        return value.isoformat()[:10]
    text = str(value)
    return text[:10] if text else None


def _present(values: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in values.items() if value is not None}


def normalize_product_row(row: dict[str, Any]) -> dict[str, Any]:
    """Map product-table snake_case columns to the web/test quote contract."""
    code = str(row.get("code") or "")
    price = row.get("price")
    latest_nav = row.get("latest_nav")
    if latest_nav is None:
        latest_nav = row.get("summary_latest_nav")
    summary_date = _date_text(row.get("summary_date"))
    latest_nav_date = _date_text(row.get("latest_nav_date")) or summary_date
    as_of = row.get("as_of") or row.get("quote_updated_at")
    updated_at = row.get("quote_updated_at") or row.get("summary_updated_at")

    result: dict[str, Any] = {
        "symbol": code,
        "code": code,
        "name": row.get("name") or code,
        "price": price,
        "close": price,
        "latestNav": latest_nav,
        "latestNavDate": latest_nav_date,
        "previousClose": row.get("previous_close"),
        "change": row.get("change_amount"),
        "changePercent": row.get("change_percent"),
        "premiumPercent": row.get("premium_percent"),
        "iopv": row.get("iopv"),
        "volume": row.get("volume"),
        "turnover": row.get("turnover"),
        "marketState": row.get("market_state"),
        "asOf": as_of,
        "quoteDate": str(as_of or "")[:10] or latest_nav_date,
        "session": row.get("session"),
        "suspended": bool(row.get("suspended")),
        "return1w": row.get("return_1w"),
        "return1m": row.get("return_1m"),
        "return3m": row.get("return_3m"),
        "return6m": row.get("return_6m"),
        "return1y": row.get("return_1y"),
        "returnBase": row.get("return_base"),
        "ytdReturn": row.get("ytd_return"),
        "currentYearPercent": row.get("ytd_return"),
        "historicalPercentile": row.get("historical_percentile"),
        "drawdownPercentile": row.get("drawdown_percentile"),
        "highDrawdown": row.get("high_drawdown"),
        "closeHighDrawdown": row.get("close_high_drawdown"),
        "updatedAt": updated_at,
        "source": "fund-collector-products",
    }
    high_point = row.get("high_point")
    if high_point is not None:
        high_date = _date_text(row.get("high_point_date"))
        result["highPoint"] = _present({
            "high": high_point, "price": high_point,
            "highDate": high_date, "date": high_date,
        })
    close_high_point = row.get("close_high_point")
    if close_high_point is not None:
        high_date = _date_text(row.get("close_high_point_date"))
        result["closeHighPoint"] = _present({
            "high": close_high_point, "price": close_high_point,
            "highDate": high_date, "date": high_date,
        })
    return result


class FundProductStore(FundStore):
    """Read-side companion for the four local product tables."""

    def read_products(self) -> dict[str, dict[str, Any]]:
        conn = None
        try:
            conn = self._tidb()
        except Exception as exc:
            print(f"[fund-products] tidb unavailable: {exc}", flush=True)
            return {}
        if conn is None:
            return {}
        sql = """SELECT
  q.code,q.name,q.price,q.latest_nav,q.latest_nav_date,
  q.previous_close,q.change_amount,q.change_percent,q.premium_percent,
  q.iopv,q.volume,q.turnover,q.market_state,q.as_of,q.session,q.suspended,
  q.updated_at AS quote_updated_at,
  s.date AS summary_date,s.latest_nav AS summary_latest_nav,
  s.return_1w,s.return_1m,s.return_3m,s.return_6m,s.return_1y,
  s.return_base,s.ytd_return,s.historical_percentile,s.drawdown_percentile,
  s.high_drawdown,s.close_high_drawdown,s.high_point,s.high_point_date,
  s.close_high_point,s.close_high_point_date,s.updated_at AS summary_updated_at
FROM fund_quote q
LEFT JOIN fund_summary s
  ON s.code=q.code
 AND s.date=(SELECT MAX(s2.date) FROM fund_summary s2 WHERE s2.code=q.code)"""
        try:
            # FundStore uses a shared non-autocommit connection.  Serialize the
            # complete read and end the previous snapshot before selecting so
            # high-frequency quote updates are visible across connections.
            with self._lock:
                try:
                    conn.rollback()
                except Exception:
                    pass
                with conn.cursor() as cur:
                    cur.execute(sql)
                    raw_rows = cur.fetchall()
            products: dict[str, dict[str, Any]] = {}
            for raw in raw_rows:
                row = raw if isinstance(raw, dict) else dict(zip(_PRODUCT_COLUMNS, raw))
                item = normalize_product_row(row)
                if item["code"]:
                    products[item["code"]] = item
            return products
        except Exception as exc:
            print(f"[fund-products] read failed: {exc}", flush=True)
            try:
                conn.rollback()
            except Exception:
                pass
            return {}


def build_product_store(config: dict[str, Any]) -> FundProductStore | None:
    storage = config.get("storage") or {}
    tidb_config = storage.get("tidb") or config.get("tidb") or {}
    if not isinstance(tidb_config, dict):
        return None
    targets = [
        target for target in (tidb_config.get("targets") or [])
        if isinstance(target, dict)
    ]
    return FundProductStore(targets) if targets else None


class ProductSnapshotService(MarketDataService):
    """MarketDataService backed by the collector's precomputed product rows."""

    def __init__(
        self,
        store: Any,
        data_dir: str | Path,
        product_store: FundProductStore | None,
        **kwargs: Any,
    ) -> None:
        super().__init__(store, data_dir, **kwargs)
        self.product_store = product_store

    def _product_map(self) -> dict[str, dict[str, Any]]:
        if self.product_store is None:
            return {}
        # One small all-fund query serves an entire /quotes request.  quote()
        # may be called once per requested symbol by the compatibility router.
        return self.cache.get_or_load(
            "fund-products:all",
            2,
            self.product_store.read_products,
        )

    def _latest_by_symbol(self) -> dict[str, dict[str, Any]]:
        try:
            fallback = super()._latest_by_symbol()
        except (FileNotFoundError, OSError, ValueError):
            fallback = {}
        return {**fallback, **self._product_map()}

    def _latest(self) -> dict[str, Any]:
        products = self._product_map()
        if not products:
            return super()._latest()
        generated = max((str(row.get("asOf") or row.get("updatedAt") or "") for row in products.values()), default="")
        symbols = [{
            **row,
            "computed_premium_percent": row.get("premiumPercent"),
            "change_percent": row.get("changePercent"),
            "previous_close": row.get("previousClose"),
            "collected_at": row.get("asOf") or row.get("updatedAt"),
            "iopv_timestamp": row.get("latestNavDate"),
        } for row in products.values()]
        return {"generated_at": generated, "symbols": symbols, "source": "fund-products"}

    def quote(self, symbol: str) -> dict[str, Any] | None:
        product = self._product_map().get(symbol)
        try:
            fallback = super().quote(symbol)
        except (FileNotFoundError, OSError, ValueError):
            fallback = None
        if product is None:
            return fallback
        return {**(fallback or {}), **_present(product)}

    def fund_metric(self, symbol: str) -> dict[str, Any] | None:
        quote = self.quote(symbol)
        if quote is None:
            return None
        return {**quote, "code": symbol}

    def fund_metrics(self, symbols: list[str]) -> list[dict[str, Any]]:
        codes = list(dict.fromkeys(
            code for code in symbols if code.isdigit() and len(code) == 6
        ))
        products = self._product_map()
        output: list[dict[str, Any]] = []
        for code in codes:
            product = products.get(code)
            if product is not None:
                try:
                    fallback = super().fund_metric(code)
                except (FileNotFoundError, OSError, ValueError):
                    fallback = None
                output.append({**(fallback or {}), **_present(product), "code": code})
                continue
            fallback = super().fund_metric(code)
            if fallback is not None:
                output.append(fallback)
        return output
