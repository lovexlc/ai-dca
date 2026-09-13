from __future__ import annotations

import math
from datetime import datetime, time as day_time, timedelta, timezone
from zoneinfo import ZoneInfo

SHANGHAI = ZoneInfo("Asia/Shanghai")

HOLIDAY_RANGES = {
    "2024": [
        ("2024-01-01", "2024-01-01"), ("2024-02-09", "2024-02-17"),
        ("2024-04-04", "2024-04-06"), ("2024-05-01", "2024-05-05"),
        ("2024-06-10", "2024-06-10"), ("2024-09-15", "2024-09-17"),
        ("2024-10-01", "2024-10-07"),
    ],
    "2025": [
        ("2025-01-01", "2025-01-01"), ("2025-01-28", "2025-02-04"),
        ("2025-04-04", "2025-04-06"), ("2025-05-01", "2025-05-05"),
        ("2025-05-31", "2025-06-02"), ("2025-10-01", "2025-10-08"),
    ],
    "2026": [
        ("2026-01-01", "2026-01-03"), ("2026-02-15", "2026-02-23"),
        ("2026-04-04", "2026-04-06"), ("2026-05-01", "2026-05-05"),
        ("2026-06-19", "2026-06-21"), ("2026-09-25", "2026-09-27"),
        ("2026-10-01", "2026-10-07"),
    ],
}


def shanghai_datetime(value: datetime) -> datetime:
    return value.astimezone(SHANGHAI)


def is_market_holiday(date_text: str) -> bool:
    return any(start <= date_text <= end for start, end in HOLIDAY_RANGES.get(date_text[:4], []))


def is_trading_day(value: datetime) -> bool:
    current = shanghai_datetime(value)
    return current.weekday() < 5 and not is_market_holiday(current.date().isoformat())


QUOTE_REFRESH_WINDOWS = (
    (day_time(9, 29), day_time(11, 30)),
    (day_time(12, 59), day_time(15, 0)),
)


def quote_snapshot_cache_ttl(value: datetime | None = None) -> int:
    """Return the local quote-map TTL for the current A-share session.

    The map refreshes every two seconds from one minute before each continuous
    trading session. During closed periods it remains valid until one minute
    before the next session, including weekends and configured holidays.
    """
    current = shanghai_datetime(value or datetime.now(timezone.utc))
    clock = current.time().replace(tzinfo=None)

    if is_trading_day(current):
        for refresh_start, close_at in QUOTE_REFRESH_WINDOWS:
            if refresh_start <= clock < close_at:
                return 2
            if clock < refresh_start:
                boundary = datetime.combine(current.date(), refresh_start, SHANGHAI)
                return max(1, math.ceil((boundary - current).total_seconds()))

    candidate = current.date() + timedelta(days=1)
    while True:
        boundary = datetime.combine(candidate, QUOTE_REFRESH_WINDOWS[0][0], SHANGHAI)
        if is_trading_day(boundary):
            return max(1, math.ceil((boundary - current).total_seconds()))
        candidate += timedelta(days=1)
