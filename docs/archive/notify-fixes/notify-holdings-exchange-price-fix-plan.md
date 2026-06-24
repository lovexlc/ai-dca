# Notify holdings exchange price fix plan

## Problem
场内基金/ETF 收益通知不应该使用基金单位净值 NAV。场内持仓的当日收益应使用交易所行情口径：收盘价 / 昨收价。

## Fix
- `fetchHoldingsNavSnapshots` 保留兼容字段名 `latestNav` / `previousNav`，但对 `exchange` 使用 Sina 行情：
  - `latestNav = current/close price`
  - `previousNav = preClose`
  - `latestNavDate = quote.date`
  - `source = sina-close-price`
- `otc` / `qdii` 继续通过 `/api/holdings/nav` 拉单位净值。
- KV 缓存仍要求 15:30 后才写入 exchange，避免盘中价被当成收盘价长期缓存。

## Verification
- Syntax check with `node --check workers/notify/src/index.js`.
- `git diff --check`.
- Deploy notify worker through GitHub Actions.
