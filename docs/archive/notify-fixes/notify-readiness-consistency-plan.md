# notify worker 净值就绪判定一致性 + 场外更新逻辑复核

## 目标
把 notify worker 的「场内净值就绪」判定改成与前端持仓总览一致（以 asOf 的上海时区日期为准、并在通知时刻强制取最新行情），同时复核并修正场外/QDII 净值更新逻辑。

## 背景 / 根因
- 前端持仓总览刷新：挂载时浏览器直连 `POST /api/markets/fund-metrics` + WS 盘中推送；「更新完成」只看 successCount（拿到价格即视为完成）。场内「今日已更新」用 `quoteDate = asOf 的上海时区日期`，只要求 `hasCurrentPrice && hasChangePercent && isLiteralToday`，**不**依赖滞后的 latestNavDate。
- worker 场内就绪却 gate 在 `latestNavDate` 严格相等上；且 `metricToPrice.date` / `metricToHoldingSnapshot.asOfDate` 用的是 UTC slice，并且 `fetchSinaPrices` 硬编码 `refresh:false`。
- 结果：3 点半前端净值已刷新（WS + 直连），但 worker 在 `refresh:false` 下看到的 markets asOf 还停在旧日期 → 就绪判定 false → 漏发。
- 场外隐患：`isOtcSnapshotReady` 有 `sourceUpdatedDate===today → return true` 短路，会在 T 日净值尚未发布时用 T-1 净值误判 ready，误报当日收益并写 dedup，抑制当晚真正的 T 日通知。

## 关键决策（已与用户确认）
- D1：场内一致性 = **强制 refresh:true + 修时区**（UTC slice → 上海时区）。不只修时区。
- D2：场外 = **收紧 `isOtcSnapshotReady`**，要求 `latestNavDate >= expected`（移除 `sourceUpdatedDate===today` 短路）。

## 步骤清单
- [done] 通读 worker/前端净值链路，定位根因
- [done] D1/D2 决策确认（ask-survey）
- [in_progress] 代码改动
  - getNav.js：新增内部 `shanghaiDateFromTimestamp`；`metricToPrice.date`、`metricToHoldingSnapshot.asOfDate` 改上海时区；`fetchSinaPrices` 增加 `{ refresh }` 选项
  - holdingsSnapshotFetch.js：`fetchHoldingsNavSnapshots` 接收 `refreshExchange`，场内取价传 `refresh:refreshExchange`
  - holdingsNotificationRoutes.js：3 处快照取数传 `refreshExchange`（场内路径 true）
  - holdingsNotificationContent.js：收紧 `isOtcSnapshotReady`，移除 today 短路 + 本地未用 helper
- [todo] eslint 校验
- [todo] curl 冲烟 fund-metrics（正常 + 异常路径），记录状态码/字段
- [todo] 聚焦提交 + push HEAD:main
- [todo] 走 GitHub Actions 部署 deploy-worker-notify.yml
- [todo] 收集四件证据（路径行号 / commit SHA + raw / Actions run success / Worker Current Version ID）

## 待确认项
- 无（D1/D2 已定）。

## 产出与验证记录
- （随进度补充）

## 残留风险 / 后续
- holdingsSnapshotFetch.js 的 otc 缓存判定（L86-88 `sourceUpdatedDate===today`）与缓存写入 `sourceFreshenedToday`（L200-204）仍有同类宽松逻辑，但只影响缓存命中/写入，不影响通知就绪与 dedup（已被收紧后的就绪判定兜底）。本次按用户批准范围不改，留作后续可选项。
