from __future__ import annotations

import json
import os
import tempfile
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable
from zoneinfo import ZoneInfo

SHANGHAI = ZoneInfo("Asia/Shanghai")
FUND_METRICS_URL = "https://api.freebacktrack.tech/api/markets/fund-metrics"

OTC_SYMBOLS = [
    "000834", "008971", "270042", "006479", "000055", "006480", "021778", "161130",
    "012870", "012871", "003722", "040046", "040047", "040048", "014978", "016055",
    "016057", "016056", "016058", "015299", "015300", "015518", "016532", "016533",
    "016534", "016535", "021838", "018966", "018967", "018968", "018969", "019524",
    "019525", "019547", "019548", "160213", "019172", "019173", "019174", "019175",
    "019441", "019442", "019736", "019737", "019738", "019739", "016452", "016453",
    "021000", "018043", "018044", "022525", "539001", "012751", "012752", "012753",
    "023422", "021773", "022664", "024237", "017641", "019305", "017642", "017643",
    "017028", "017030", "018064", "018065", "018066", "050025", "050030", "006075", "018738",
    "013425", "013499", "007721", "007722", "022523", "161125", "012860", "003718",
    "012861",
]

PostJson = Callable[[str, dict[str, Any], float], dict[str, Any]]


def post_json(url: str, payload: dict[str, Any], timeout_sec: float) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={"accept": "application/json", "content-type": "application/json", "user-agent": "market-collector/1"},
    )
    with urllib.request.urlopen(request, timeout=timeout_sec) as response:
        return json.loads(response.read().decode("utf-8", "replace"))


def _to_shanghai(value: Any) -> Any:
    text = str(value or "").strip()
    if not text:
        return value
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).astimezone(SHANGHAI).isoformat(timespec="seconds")
    except ValueError:
        return value


def _fetch_batch(codes: list[str], timeout_sec: float, client: PostJson) -> dict[str, Any]:
    # 不传 fundKinds：fund-metrics 接口内部从 danjuan type_desc 自动判定 QDII/OTC。
    # 之前硬编码 {code: "qdii" for code in codes} 在 OTC_SYMBOLS 全是 QDII 时正确，
    # 但加入纯 A 股场外基金时会错标 qdii（T-1），导致净值日期口径错误。
    return client(FUND_METRICS_URL, {
        "codes": codes,
    }, timeout_sec)


def fetch_otc_metrics(
    symbols: list[str] | None = None,
    timeout_sec: float = 30.0,
    client: PostJson = post_json,
) -> dict[str, Any]:
    codes = list(dict.fromkeys(symbols or OTC_SYMBOLS))
    batches = [codes[index:index + 20] for index in range(0, len(codes), 20)]
    items: list[dict[str, Any]] = []
    errors: list[str] = []
    with ThreadPoolExecutor(max_workers=3) as executor:
        futures = {executor.submit(_fetch_batch, batch, timeout_sec, client): batch for batch in batches}
        for future in as_completed(futures):
            try:
                payload = future.result()
                for item in payload.get("items") or []:
                    normalized = dict(item)
                    for key in ("asOf", "updatedAt", "expiresAt"):
                        if key in normalized:
                            normalized[key] = _to_shanghai(normalized[key])
                    items.append(normalized)
            except Exception as exc:
                errors.append(f"{','.join(futures[future])}: {exc}")
    by_code = {str(item.get("code") or item.get("symbol")): item for item in items}
    ordered = [by_code[code] for code in codes if code in by_code]
    return {
        "kind": "market-collector-otc-latest",
        "generated_at": datetime.now(timezone.utc).astimezone(SHANGHAI).isoformat(timespec="seconds"),
        "requested": len(codes), "success_count": len(ordered),
        "failure_count": len(codes) - len(ordered), "errors": errors, "items": ordered,
    }


def atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temp_path = tempfile.mkstemp(prefix=path.name + ".", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, sort_keys=True)
            handle.write("\n")
        os.replace(temp_path, path)
    finally:
        if os.path.exists(temp_path):
            os.unlink(temp_path)
