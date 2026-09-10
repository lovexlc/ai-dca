from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Any, Callable
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

SHANGHAI = ZoneInfo("Asia/Shanghai")
DEFAULT_WORKER_URL = "https://api.freebacktrack.tech"
FEE_BATCH_SIZE = 24

LIMIT_SCHEMA_VERSION = 2


def _positive_number(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number == number and number not in (float("inf"), float("-inf")) and number > 0 else None


def normalize_limit_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """把 Worker 的双渠道限额规范化为 collector 的正式 payload。"""
    data = dict(payload or {})
    raw_limits = data.get("channelLimits")
    limits: dict[str, float] = {}
    if isinstance(raw_limits, dict):
        for key in ("direct", "distributor", "all"):
            value = _positive_number(raw_limits.get(key))
            if value is not None:
                limits[key] = value
    if not limits:
        amount = _positive_number(data.get("maxPurchasePerDay"))
        if amount is not None:
            limits["all"] = amount
    if limits:
        data["channelLimits"] = limits
        primary = limits.get("direct") or limits.get("all") or limits.get("distributor")
        if primary is not None:
            data["maxPurchasePerDay"] = primary
        if limits.get("direct") is not None:
            data["limitChannel"] = "app"
        elif limits.get("distributor") is not None:
            data["limitChannel"] = "channel"
    data["limitSchemaVersion"] = LIMIT_SCHEMA_VERSION
    return data


JsonRequest = Callable[[str, str, dict[str, Any] | None, float], dict[str, Any]]


def normalize_fund_code(value: Any) -> str:
    text = str(value or "").strip()
    digits = "".join(character for character in text if character.isdigit())
    return digits[-6:] if len(digits) >= 6 else ""


def request_json(
    method: str,
    url: str,
    payload: dict[str, Any] | None,
    timeout_sec: float,
) -> dict[str, Any]:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
    request = Request(
        url,
        data=body,
        method=method,
        headers={
            "accept": "application/json",
            "content-type": "application/json",
            "user-agent": "market-collector-fund-reference/1",
        },
    )
    with urlopen(request, timeout=timeout_sec) as response:
        decoded = json.loads(response.read().decode("utf-8", "replace"))
    if not isinstance(decoded, dict):
        raise ValueError("Worker response must be a JSON object")
    return decoded


def _snapshot_record(
    data_kind: str,
    code: str,
    payload: dict[str, Any],
    fetched_at: str,
    snapshot_date: str,
) -> dict[str, Any]:
    normalized_payload = dict(payload)
    normalized_payload["code"] = code
    return {
        "data_kind": data_kind,
        "symbol": code,
        "snapshot_date": snapshot_date,
        "fetched_at": fetched_at,
        "source": "worker:" + data_kind.replace("_", "-"),
        "payload": normalized_payload,
    }


def _fetch_fee_records(
    codes: list[str],
    worker_url: str,
    timeout_sec: float,
    client: JsonRequest,
    fetched_at: str,
    snapshot_date: str,
) -> tuple[list[dict[str, Any]], list[str]]:
    records: list[dict[str, Any]] = []
    errors: list[str] = []
    endpoint = worker_url.rstrip("/") + "/api/fund-fee"
    for start in range(0, len(codes), FEE_BATCH_SIZE):
        batch = codes[start:start + FEE_BATCH_SIZE]
        try:
            response = client("POST", endpoint, {"codes": batch}, timeout_sec)
        except Exception as exc:
            errors.append(f"fund_fee:{','.join(batch)}: {exc}")
            continue
        items = response.get("items")
        if not isinstance(items, list):
            errors.append(f"fund_fee:{','.join(batch)}: invalid items")
            continue
        returned: set[str] = set()
        for item in items:
            if not isinstance(item, dict):
                continue
            code = normalize_fund_code(item.get("code") or (item.get("data") or {}).get("code"))
            data = item.get("data")
            if code not in batch or item.get("ok") is not True or not isinstance(data, dict):
                if code in batch:
                    errors.append(f"fund_fee:{code}: {item.get('error') or 'no data'}")
                continue
            returned.add(code)
            records.append(_snapshot_record("fund_fee", code, data, fetched_at, snapshot_date))
        for code in batch:
            if code not in returned and not any(error.startswith(f"fund_fee:{code}:") for error in errors):
                errors.append(f"fund_fee:{code}: missing response")
    return records, errors


def _fetch_one_limit(
    code: str,
    worker_url: str,
    timeout_sec: float,
    client: JsonRequest,
) -> tuple[str, dict[str, Any] | None, str | None]:
    endpoint = worker_url.rstrip("/") + "/api/fund-limit?" + urlencode({"code": code})
    try:
        payload = client("GET", endpoint, None, timeout_sec)
    except HTTPError as exc:
        return code, None, f"HTTP {exc.code}"
    except Exception as exc:
        return code, None, str(exc)
    response_code = normalize_fund_code(payload.get("code") or code)
    if response_code != code:
        return code, None, "response code mismatch"
    return code, normalize_limit_payload(payload), None


def _fetch_limit_records(
    codes: list[str],
    worker_url: str,
    timeout_sec: float,
    concurrency: int,
    client: JsonRequest,
    fetched_at: str,
    snapshot_date: str,
) -> tuple[list[dict[str, Any]], list[str]]:
    records_by_code: dict[str, dict[str, Any]] = {}
    errors: list[str] = []
    worker_count = max(1, min(int(concurrency), 8, len(codes))) if codes else 1
    with ThreadPoolExecutor(max_workers=worker_count) as executor:
        futures = {
            executor.submit(_fetch_one_limit, code, worker_url, timeout_sec, client): code
            for code in codes
        }
        for future in as_completed(futures):
            code, payload, error = future.result()
            if error is not None or payload is None:
                errors.append(f"fund_limit:{code}: {error or 'no data'}")
                continue
            records_by_code[code] = _snapshot_record(
                "fund_limit", code, payload, fetched_at, snapshot_date
            )
    return [records_by_code[code] for code in codes if code in records_by_code], errors


def fetch_fund_references(
    symbols: list[str],
    *,
    worker_url: str = DEFAULT_WORKER_URL,
    timeout_sec: float = 25.0,
    concurrency: int = 4,
    client: JsonRequest = request_json,
    now: datetime | None = None,
    fee_symbols: list[str] | None = None,
    limit_symbols: list[str] | None = None,
) -> dict[str, Any]:
    current = (now or datetime.now(timezone.utc)).astimezone(SHANGHAI)
    fetched_at = current.replace(microsecond=0).isoformat()
    snapshot_date = current.date().isoformat()
    # 默认 fee/limit 同 symbols；分别传入时可拆开：场内 ETF 只抓 fee（持有成本费率），
    # 场外 OTC 两样都抓（fee 含卖出费率 redeemRules，limit 含限购额度）。
    fee_codes = list(dict.fromkeys(
        code for code in (normalize_fund_code(symbol) for symbol in (fee_symbols or symbols)) if code
    ))
    limit_codes = list(dict.fromkeys(
        code for code in (normalize_fund_code(symbol) for symbol in (limit_symbols or symbols)) if code
    ))
    fee_records, fee_errors = _fetch_fee_records(
        fee_codes, worker_url, timeout_sec, client, fetched_at, snapshot_date
    )
    limit_records, limit_errors = _fetch_limit_records(
        limit_codes, worker_url, timeout_sec, concurrency, client, fetched_at, snapshot_date
    )
    records = fee_records + limit_records
    all_codes = list(dict.fromkeys(fee_codes + limit_codes))
    return {
        "kind": "market-collector-fund-reference-sync",
        "generated_at": fetched_at,
        "snapshot_date": snapshot_date,
        "requested_symbols": len(all_codes),
        "fee_success_count": len(fee_records),
        "fee_failure_count": len(fee_codes) - len(fee_records),
        "limit_success_count": len(limit_records),
        "limit_failure_count": len(limit_codes) - len(limit_records),
        "records": records,
        "errors": fee_errors + limit_errors,
    }


def fetch_fund_limit_overview(
    worker_url: str = DEFAULT_WORKER_URL,
    timeout_sec: float = 25.0,
    client: JsonRequest = request_json,
) -> dict[str, Any]:
    """拉取场外限额聚合快照（ocr-proxy /api/fund-limit/overview，含 quotaGroups/events/trend）。"""
    endpoint = worker_url.rstrip("/") + "/api/fund-limit/overview?days=30"
    return client("GET", endpoint, None, timeout_sec)
