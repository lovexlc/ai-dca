# 晚间收益通知漏发排查计划

## 目标
- 查清 20:30 / 21:30 全仓收益通知未发送原因。
- 修复后确保晚间收益通知不会因为 dedup / 数据 ready / 渠道判定误跳过。

## 步骤清单
- [done] 检查 Worker 定时分发、持仓收益函数与 KV 状态。
- [done] 定位漏发根因并修改 Worker。
- [done] 本地语法 / smoke 检查。
- [done] 提交推送并等待 Notify Worker GitHub Actions 部署成功。
- [done] 记录部署证据。

## 验证记录
- 2026-05-22：确认 20:30 / 21:30 cron 已运行，并且写入 `holdings-dedup:*:all:2026-05-22`，因此不是 cron 未触发。
- 主设备 `web:765748a8-4545-47be-883f-61dbd8cb988c` 的 21:30 事件 `holdings-all-2026-05-22` 被记录为 `status=delivered`，渠道为：
  - `bark skipped`：未配置 Bark。
  - `ws delivered`：App 常驻通道送达，旧逻辑因此跳过 FCM。
  - `pc queued`：等待浏览器轮询。
- 根因：收益通知属于系统级强提醒，但旧逻辑在 App WS 在线时只记 WS delivered 并跳过 FCM；这可能不会弹出系统通知，却仍写入 holdings dedup，导致 21:30 兜底也不再重试。
- 修复：
  - `holdings-daily-return` 即使 WS 在线也继续发送 FCM 系统通知。
  - holdings dedup 只在 Bark / GCM 真实推送渠道 `delivered` 后写入，避免只有 WS/PC 状态时误标 sent。
- 本地检查：
  - `node --check workers/notify/src/evaluator.js` 通过。
  - `node --check workers/notify/src/index.js` 通过。
  - `git diff --check -- workers/notify/src/evaluator.js workers/notify/src/index.js docs/notify-holdings-evening-missed-plan.md` 通过。
- 提交：`a302c2a293d1c944170493b27be9bc177599acf4`（`fix(notify): send holdings returns through fcm`）。
- Notify Worker GitHub Actions：`https://github.com/lovexlc/ai-dca/actions/runs/26292694739`，状态 `completed / success`。
- Cloudflare Worker 生产环境：`ai-dca-notify`，版本 `d0e63258-3cd1-4fa5-b7ca-dcf962567f08`，版本号 `64`，生产环境 `modified_on=2026-05-22T14:10:10.084422Z`，script tag `6886be955625468ea68b7005a3cd0bdd`。
- 已删除今天主设备误写的全仓 dedup：`holdings-dedup:web:765748a8-4545-47be-883f-61dbd8cb988c:all:2026-05-22`，复查返回 `key not found`。
- 生产补发接口尝试被 Cloudflare 防护拦截：HTTP 403 / error code 1010；未作为代码失败处理。由于误写 dedup 已删除，下一次调度不会被旧记录拦住。
