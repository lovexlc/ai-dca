# 量化看板专业版实现计划

日期：2026-09-28。目标：按参考截图复刻溢价差轮动看板 UI 与交互（实时行情，无演示模式）。
决策：标的保持 159659/159632；手续费万 0.5 双边；阈值 Q=2.5 / W=0.4（回滞语义不变）。

## 后端（services/market-collector/market_collector/paper_trade.py）

1. 参数配置化：`Q_THRESHOLD=2.5`（原 SPREAD_UPPER）、`W_THRESHOLD=0.4`（原 SPREAD_LOWER）、`FEE_RATE=0.00005`、`LOT_SHARES` 不变；`status()` 新增 `strategy` 段暴露 {symbols, q_threshold, w_threshold, lot_shares, fee_rate, initial_capital}。
2. 手续费：buy/sell 按 `amount * FEE_RATE` 从现金扣减；trade 记录 `fee` 字段；portfolio 累计 `total_fees`（to_dict/from_dict 持久化）。
3. 成交字段：`sweep_book` 返回吃档数 → trade 加 `levels_consumed`；下单时记录 `counter_price`（买入=卖一价，卖出=买一价）；buy 的冲击金额 `impact_cost = (avg_price - base_avg) * filled`，sell 记 0。
4. 轮换计数：portfolio 加 `rotation_count`，每次完整切换（卖出旧标的＋买入新标的）加 1，持久化并暴露。
5. 历史序列：engine 维护 `nav_history` / `spread_history`（deque，maxlen 20000），每 tick 追加 {t, quant, manual} 与 {t, spread}；新增 HTTP `/api/paper-trade/history?limit=` 一次返回两段；落盘时随 snapshot.json 持久化（启动恢复）。
6. tick 序号：engine `tick_seq` 自增，`status()` 暴露；quotes 每标的加 `quote_ts`（captured_at）与五档 `bids`/`asks`。
7. 测试：更新 `tests/test_paper_trade.py`——阈值常量改名、新字段（fee/counter_price/levels_consumed/impact_cost/rotation_count）、history 接口、快照恢复含历史。

## 前端（src/pages/AdminQuantExperience.jsx，recharts 已有）

1. Header：标题「溢价差轮动·实时看板」＋实时行情徽标＋盘中/盘后徽标；右侧实时时钟（1s）＋ tick #n ＋行情时间＋刷新按钮。
2. 行情卡 X/Y：名称代码、溢价率大字（红涨绿跌）、买卖五档表、最新价大字、IOPV。
3. 账户卡 A/B：延迟徽标（0ms/3000ms）、总资产大字、收益率、当前持仓、可用现金、轮换次数、累计手续费、累计冲击成本。
4. 对比卡 B−A：差额大字＋高出/低于、占本金比例、溢价差 X−Y、阈值 Q/W、下单粒度。
5. 图表：① 账户净值（A/B/本金三线，深色 hover tooltip）；② 溢价差（黑线）＋ Q 红虚线 ＋ W 绿虚线。
6. 成交明细：列＝账户/时间/标的/方向/成交份数/成交均价/对手一档价/冲击成本/吃档；保留"最近 N 笔"。
7. 轮询：盘中 2s，盘后 30s（按 `in_trading_hours` 切换）；移动端堆叠、桌面端网格，贴截图排版。
8. 红涨绿跌：沿用现有 rose/emerald 语义。

## 风险

- 阈值从 0.3/0.1 改为 2.5/0.4 会改变实盘模拟行为（价差多数时间落在回滞区，轮换变少）—— dudu 已确认按截图值。
- 手续费是新增扣减项，历史组合的现金/净值口径变化——新组合从 100 万重新开始无影响；现有组合继续跑，fee 从此 tick 起计。
- history 落盘体积：20000 点 ×2 序列 ≈ 1–2MB JSON，10s 节流写，可接受。
- 后端跑在 CN 主机常驻进程，改完需重启服务才能生效（部署步骤单独确认）。

## 输出

- paper_trade.py 改动＋测试全绿
- AdminQuantExperience.jsx 重写
- 提交 → push_cn.py → Deploy CN Frontend 验证
- 后端部署：确认 CN 主机 paper-trade 进程重启方式后执行

## 进度

- [x] 缺口分析（GAP_ANALYSIS.md）
- [ ] 后端：参数/手续费/成交字段/轮换计数
- [ ] 后端：历史序列＋tick＋盘口暴露＋测试
- [ ] 前端重写
- [ ] lint / check:refactor / git diff --check
- [ ] 提交推送＋前端部署验证
- [ ] 后端 CN 主机部署（重启进程）
