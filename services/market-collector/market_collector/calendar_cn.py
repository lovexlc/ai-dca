from __future__ import annotations

from datetime import datetime
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
