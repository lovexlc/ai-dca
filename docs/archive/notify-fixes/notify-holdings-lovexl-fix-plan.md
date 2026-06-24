# lovexl 收益通知彻底修复计划

## Goal

修复 lovexl 对应账户收益通知整条漏发的问题。重点处理全仓收益通知中任意单只标的净值未 ready 时导致整个账户跳过的逻辑。

## Checklist

- done: 定位 notify worker 收益通知调度和全仓通知入口。
- done: 修改全仓通知 ready 策略，保留 20:30 完整性等待，21:30 兜底发送已 ready 部分。
- done: 增加单测覆盖“一个未 ready 标的不应拖垮整个账户”的场景。
- done: 运行相关测试和差异检查。

## Key Decisions

- 单 bucket 通知仍保持严格 ready，避免用过期净值误报。
- 全仓总览在 20:30 继续等待完整数据；21:30 作为兜底，只要有可计算持仓就发通知。
- 部分通知不写入全仓完整 dedup，避免抑制后续完整通知。

## Verification

- `node --test test/notifyHoldingsContent.test.mjs test/notifyHoldingsAllRoute.test.mjs`: pass。
- `node --check workers/notify/src/holdingsNotificationRoutes.js`: pass。
- `node --check test/notifyHoldingsAllRoute.test.mjs`: pass。
- `git diff --check -- workers/notify/src/holdingsNotificationRoutes.js test/notifyHoldingsAllRoute.test.mjs docs/notify-holdings-lovexl-fix-plan.md`: pass。
- `npx eslint workers/notify/src/holdingsNotificationRoutes.js test/notifyHoldingsAllRoute.test.mjs`: blocked by existing worker lint globals/no-unused configuration (`console` in worker source is reported as `no-undef` throughout the file).
