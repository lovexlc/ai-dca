# 收益看板（持仓页下半屏）

> 蚂蚁财富同款收益体验：顶部 KPI 卡片 + 时间镜头 + 区间收益曲线 + 月度盈亏日历。
> 全部前端实时计算，**不写 Notion**，**不依赖服务端聚合**。

## 1. 起点：何谓「投资以来」

- 「投资以来」起点 = 成交流水里最早一笔 **BUY** 的日期：`min(tx.date where tx.type === 'BUY')`。
- 在那一天之前，组合视为「未开户」，所有镜头落到这之前会被夹紧到该日。
- 起点是一次性派生，刷新页面也稳定；删掉首笔 BUY 后会自动顺延到下一笔最早的 BUY。

## 2. 时间镜头

10 个预设镜头 + 1 个自定义，URL 同步 `?range=`（自定义额外带 `&from=&to=`）：

| key | 含义 |
|---|---|
| `today` | 当日（盘中/收盘后） |
| `week` | 本周（周一→今天） |
| `lastWeek` | 上周整周 |
| `month` | 本月（1 号→今天） |
| `lastMonth` | 上月整月 |
| `ytd` | 年初至今 |
| `year` | 本年度（同 `ytd` 别名） |
| `lastYear` | 去年整年 |
| `last365d` | 滚动近 365 天 |
| `sinceInception` | 投资以来 |
| `custom` | 自定义起止日期 |

所有镜头通过 `src/app/portfolioSeries.js → resolveRangeWindow()` 解析成 `{from, to, days}`。

## 3. 收益率计算（Modified Dietz）

核心公式：

```
收益率 = (期末市值 − 期初市值 − 净现金流) / (期初市值 + 加权现金流)
```

- 现金流：BUY 为正、SELL 为负；同日 BUY+SELL（基金转换）净额≈ 0 不会被误伤。
- 权重：现金流按发生日在区间内的剩余天数加权（标准 MD 加权法）。
- 年化：当区间天数 ≥ 30 时输出 `annualizedReturn`，否则 null。
- 实现：`src/app/portfolioSeries.js`，45 个单元 assert。

## 4. NAV 数据缓存策略（三层）

```
  组件                Worker                淘宝基金接口
   │                     │                        │
   │ L1: 内存 Map        │                        │
   │ (去重 in-flight)    │                        │
   │                     │                        │
   │ L2: IndexedDB ─────►│ L3: edge cache ───────►│
   │ (信任 expiresAt)    │ (动态 TTL)             │
```

- **L1 内存**：同一渲染周期内同一 `code+from+to` 只发一次请求。
- **L2 IndexedDB**：信任 Worker 返回的 `expiresAt`，预留 60s 安全余量；离线/请求失败回退 stale 数据并打 `stale: true`。
- **L3 Worker edge cache**：
  - 纯历史段（不含今天）：固定 24h。
  - 含今天的段：动态 TTL，由 `computeNonExchangeNavTtlMs` 计算：
    - 盘中（9:30–15:00 上海）：5 分钟
    - 收盘后：30 分钟
    - 周末/节假日：8 小时

实现：`src/app/navHistoryClient.js`（前端）+ `workers/ocr-proxy/src/index.js` 的 `/api/holdings/nav-history`。

## 5. 基准：沪深300

- 默认基准固定 ETF `510300`（华泰柏瑞沪深300）。
- 走同一个 `/api/holdings/nav-history` 端点 + 同一 IndexedDB 缓存，避免双套接口。
- 区间收益率 = `endNav / startNav − 1`（buy-and-hold）；KPI 卡片下方显示「跑赢/落后基准 X.XX%」。

## 6. UI 装配（持仓页下半屏）

```
IncomeDetail (src/app/IncomeDetail.jsx)
├── KPI 卡片（区间收益 / 收益率 / 累计盈亏 / 年化）
├── TimeRangeSelector
├── 基准对比一行
└── Disclosure 折叠面板（懒加载，仅有持仓时挂载）
    ├── 收益曲线  → React.lazy(ReturnChart.jsx)   默认展开
    └── 收益日历  → React.lazy(ReturnCalendar.jsx) 默认收起
```

- 涨跌色：红涨绿跌（A 股惯例），常量集中于 `TONE_UP/DOWN/NEUTRAL/DIM`。
- 日历单日盈亏 = `dailySeries[i].pnl − dailySeries[i−1].pnl`（剔除当日现金流即为净盈亏）。
- 日历可滑动「当月 ±2 月」，点格弹 Radix popover 显示当日交易明细。

## 7. 相关文件索引

| 路径 | 作用 |
|---|---|
| `workers/ocr-proxy/src/index.js` | `/api/holdings/nav-history` + edge cache |
| `src/app/navHistoryClient.js` | 前端 NAV 客户端（L1+L2） |
| `src/app/portfolioSeries.js` | Modified Dietz + 镜头解析 |
| `src/app/rangeUrlSync.js` | URL 同步 hook |
| `src/app/TimeRangeSelector.jsx` | 镜头切换 chip |
| `src/app/IncomeDetail.jsx` | KPI 卡片 + 装配下半屏 |
| `src/app/ReturnChart.jsx` | Recharts 区间收益曲线（懒加载） |
| `src/app/ReturnCalendar.jsx` | 月度盈亏热力图（懒加载） |
| `src/pages/HoldingsExperience.jsx` | 持仓页接入入口 |
