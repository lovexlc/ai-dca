from __future__ import annotations

import codecs
import json
import re
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

from .sources import (
    decode_tencent_payload,
    isoformat_z,
    round4,
    to_float,
    to_positive_float,
    utc_now,
)

SHANGHAI = ZoneInfo("Asia/Shanghai")
NEW_YORK = ZoneInfo("America/New_York")

EASTMONEY_STOCK_URL = "https://push2.eastmoney.com/api/qt/stock/get"
TENCENT_QUOTE_URL = "https://qt.gtimg.cn/"
SINA_QUOTE_URL = "https://hq.sinajs.cn/list="

# CN 指数。腾讯/新浪对上海指数（sh 前缀）时常返回空，所以东方财富优先，
# 失败再逐个 fallback。每个指数至少两个源。
CN_INDICES = [
    {"key": "000001", "name": "上证综指", "em_secid": "1.000001", "tencent": "sh000001", "sina": "sh000001", "currency": "CNY"},
    {"key": "399001", "name": "深证成指", "em_secid": "0.399001", "tencent": "sz399001", "sina": "sz399001", "currency": "CNY"},
    {"key": "399006", "name": "创业板指", "em_secid": "0.399006", "tencent": "sz399006", "sina": "sz399006", "currency": "CNY"},
    {"key": "000300", "name": "沪深300", "em_secid": "1.000300", "tencent": "sh000300", "sina": "sh000300", "currency": "CNY"},
    {"key": "000016", "name": "上证50", "em_secid": "1.000016", "tencent": "sh000016", "sina": "sh000016", "currency": "CNY"},
    {"key": "000688", "name": "科创50", "em_secid": "1.000688", "tencent": "sh000688", "sina": "sh000688", "currency": "CNY"},
]

# US 指数。腾讯 s_ 简版实测最稳，东方财富 100.* 部分可用，新浪 int_* 兜底。
US_INDICES = [
    {"key": "DJI", "name": "道琼斯", "em_secid": "100.DJIA", "tencent": "usDJI", "tencent_simple": "s_usDJI", "sina": "int_dji", "currency": "USD"},
    {"key": "IXIC", "name": "纳斯达克", "em_secid": "100.NDX", "tencent": "usIXIC", "tencent_simple": "s_usIXIC", "sina": "int_nasdaq", "currency": "USD"},
    {"key": "SPX", "name": "标普500", "em_secid": "100.SPX", "tencent": "usINX", "tencent_simple": "s_usINX", "sina": "int_sp500", "currency": "USD"},
]

_TENCENT_RE = re.compile(r'v_[^=]+="([^"]*)";?')
_SINA_RE = re.compile(r'hq_str_[^=]+="([^"]*)";?')


def _fetch(url: str, timeout: float) -> bytes:
    request = urllib.request.Request(
        url,
        headers={
            "user-agent": "Mozilla/5.0",
            "referer": "https://quote.eastmoney.com/",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def _try_eastmoney(secid: str, timeout: float) -> dict[str, Any] | None:
    params = urllib.parse.urlencode(
        {"secid": secid, "fltt": 2, "fields": "f43,f57,f58,f60,f169,f170,f124"}
    )
    try:
        raw = _fetch(EASTMONEY_STOCK_URL + "?" + params, timeout)
        data = (json.loads(raw.decode("utf-8", "replace")).get("data") or {})
    except Exception:
        return None
    price = to_float(data.get("f43"))
    previous_close = to_float(data.get("f60"))
    if price is None or price <= 0:
        return None
    name = str(data.get("f58") or "").strip()
    change = to_float(data.get("f169"))
    change_percent = to_float(data.get("f170"))
    if change is None and previous_close:
        change = round4(price - previous_close)
    if change_percent is None and previous_close:
        change_percent = round4((price - previous_close) / previous_close * 100)
    return {
        "price": round4(price),
        "previous_close": round4(previous_close),
        "change": change,
        "change_percent": change_percent,
        "name": name,
        "as_of": str(data.get("f124") or ""),
    }


def _try_tencent(code: str, timeout: float, simple: bool = False) -> dict[str, Any] | None:
    try:
        raw = decode_tencent_payload(_fetch(TENCENT_QUOTE_URL + "?q=" + urllib.parse.quote(code), timeout))
    except Exception:
        return None
    match = _TENCENT_RE.search(raw)
    if not match:
        return None
    fields = match.group(1).split("~")
    if len(fields) < 6:
        return None
    if simple:
        # v_s_usDJI="200~道琼斯~.DJI~53791.85~-184.13~-0.34~..."
        price = to_positive_float(fields[3])
        if price is None:
            return None
        change = to_float(fields[4])
        change_percent = to_float(fields[5])
        previous_close = round4(price - change) if change is not None else None
    else:
        # 完整版 v_sh000001="1~上证指数~000001~14463.80~14259.44~..."
        price = to_positive_float(fields[3])
        previous_close = to_positive_float(fields[4])
        if price is None:
            return None
        change = to_float(fields[31]) if len(fields) > 31 else None
        change_percent = to_float(fields[32]) if len(fields) > 32 else None
        if change is None and previous_close:
            change = round4(price - previous_close)
        if change_percent is None and previous_close:
            change_percent = round4((price - previous_close) / previous_close * 100)
    return {
        "price": round4(price),
        "previous_close": previous_close,
        "change": change,
        "change_percent": change_percent,
        "name": fields[1] if len(fields) > 1 else "",
        "as_of": "",
    }


def _try_sina(code: str, timeout: float) -> dict[str, Any] | None:
    try:
        raw = _fetch(SINA_QUOTE_URL + urllib.parse.quote(code), timeout)
    except Exception:
        return None
    try:
        text = codecs.decode(raw, "gbk")
    except Exception:
        text = raw.decode("utf-8", "replace")
    match = _SINA_RE.search(text)
    if not match:
        return None
    fields = match.group(1).split(",")
    if len(fields) < 4:
        return None
    name = fields[0] or code
    previous_close = to_float(fields[2])
    price = to_float(fields[3])
    # 盘后/盘中数据缺失时，新浪可能把现价留空，退化为昨收
    if price is None or price <= 0:
        price = previous_close
    if price is None or price <= 0:
        return None
    change = round4(price - previous_close) if previous_close else None
    change_percent = round4((price - previous_close) / previous_close * 100) if previous_close else None
    return {
        "price": round4(price),
        "previous_close": round4(previous_close),
        "change": change,
        "change_percent": change_percent,
        "name": name,
        "as_of": "",
    }


def _fetch_index(definition: dict[str, Any], timeout: float) -> dict[str, Any] | None:
    sources = []
    if definition.get("em_secid"):
        sources.append(lambda: _try_eastmoney(definition["em_secid"], timeout))
    if definition.get("tencent"):
        sources.append(lambda: _try_tencent(definition["tencent"], timeout))
    if definition.get("tencent_simple"):
        sources.append(lambda: _try_tencent(definition["tencent_simple"], timeout, simple=True))
    if definition.get("sina"):
        sources.append(lambda: _try_sina(definition["sina"], timeout))
    for source in sources:
        result = source()
        if result and result.get("price") and result["price"] > 0:
            return result
    return None


def fetch_market_summary(region: str, timeout: float = 8.0) -> dict[str, Any] | None:
    normalized = str(region or "CN").strip().upper()
    indices = CN_INDICES if normalized == "CN" else US_INDICES if normalized == "US" else []
    if not indices:
        return None
    tz = SHANGHAI if normalized == "CN" else NEW_YORK
    now = datetime.now(tz)
    items: list[dict[str, Any]] = []
    for definition in indices:
        result = _fetch_index(definition, timeout)
        if not result:
            continue
        items.append({
            "key": definition["key"],
            "name": result.get("name") or definition["name"],
            "symbol": definition["key"],
            "currency": definition.get("currency", ""),
            "timezone": str(tz),
            "date": now.date().isoformat(),
            "datetime": now.replace(microsecond=0).isoformat(),
            "current_price": result.get("price"),
            "previous_close": result.get("previous_close"),
            "change": result.get("change"),
            "change_percent": result.get("change_percent"),
        })
    return {
        "region": normalized,
        "source": "collector-indices",
        "generatedAt": isoformat_z(utc_now()),
        "title": "CN Markets" if normalized == "CN" else "US Markets",
        "items": items,
    }
