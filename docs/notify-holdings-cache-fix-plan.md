# Notify holdings cache fix plan

## Problem
收益通知在 15:30 / 20:30 / 21:30 没有推送。线上 KV 显示 2026-05-21 没有 `holdings-dedup:*:2026-05-21`，但普通通知检测在 15:30 已更新 `lastCheckedAt`，说明 cron 入口触发过。

## Root cause
`fetchHoldingsNavSnapshots` 对 `exchange` 场内基金只要存在 KV 缓存就直接视为有效；第二个交易日 15:30 会复用前一日缓存。后续 `computeWeightedReturn` 又要求 `latestNavDate >= todayShanghai`，于是判定 not ready 并跳过。20:30 / 21:30 全仓总览要求场内与场外都 ready，因此也会被场内旧缓存卡住。

## Fix
- 当 `todayShanghai` 存在时，所有类型（exchange / otc / qdii）都按 `getExpectedLatestNavDate(kind, todayShanghai)` 校验缓存日期。
- 只有没有执行日期的兜底调用才保留旧的 exchange 缓存行为。

## Verification
- 检查线上 KV：目标 client 今日无 dedup，场内缓存仍是 2026-05-20，符合根因。
- 运行 focused ESLint 与 diff check。
- 推送后由 GitHub Actions 部署 notify worker。
- 部署后用 admin holdings-all-test 对目标 client 做一次即时验证。
