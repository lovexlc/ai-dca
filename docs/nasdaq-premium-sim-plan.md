# 纳指 ETF 溢价差量化 · Worker 模拟盘计划

## 目标

复用通知 Worker 现有的分钟级场内切换策略 tick：盘中每分钟读取 ETF 盘口与净值，继续按 H/L 溢价差信号发送通知，并在同一触发点写入模拟盘 SELL/BUY 成交。第一阶段只做模拟盘，不接券商、不下真实委托。

## 范围与边界

- 运行入口：`workers/notify` 的 `* 1-7 * * MON-FRI` cron。
- 数据来源：继续复用 `markets/fund-metrics` 与现有 NAV 缓存。
- 触发计算：复用 `switchStrategy` 的 H/L 计算函数，但量化配置使用独立 KV 前缀。
- 模拟撮合：按卖一/买一、滑点、整手、现金、持仓、单笔金额与每日次数限制生成成交。
- 状态存储：按 client 写入 `NOTIFY_STATE` KV，不再依赖浏览器 localStorage 或本地 JSONL。

## 步骤清单

- done: 找到现有分钟级 cron 与 `runSwitchStrategyTick` 复用点。
- done: 新增 Worker 端模拟盘状态、撮合、现金流水与订单生成模块。
- done: 新增 `/api/notify/quant/premium/*` 量化专用配置、快照、运行和资金接口。
- done: 将持仓交易 `/switch/*` 与量化 `/quant/premium/*` 的 H/L 配置和状态隔离。
- done: 把量化研究页改为 Worker 模拟盘面板。
- done: 增加“策略 / 资金 / 成交”页签，资金页支持手动增加或减少模拟现金。
- done: 增加模拟盘、量化配置隔离与 e2e smoke 断言。
- todo: 部署 notify Worker 后观察首个交易时段日志与 KV 状态。

## 关键决策

- 不再使用每秒 Python 常驻轮询作为产品路径；Python runner 保留为本地试验资产。
- Worker 频率采用 Cloudflare cron 分钟级，避免额外进程和本地运行依赖。
- 量化 H/L 列表可任意设置，不要求出现在持仓交易的真实持仓里。
- 模拟盘默认初始现金 60000，默认底仓沿用上一版样例：159513 20000 股、513100 8000 股。
- 场外 OTC 信号只通知，不生成场内模拟成交。
- 同一 client 的量化模拟盘状态独立存储，不与持仓交易 H/L 通知共用状态。
