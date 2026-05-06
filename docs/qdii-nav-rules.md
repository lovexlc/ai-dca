# QDII 基金净值披露规则与持仓总览口径

持仓总览（`summarizePortfolio` + `renderPortfolioOverview`）需要把 QDII（场外、海外标的）和
境内场内 / 场外基金区分对待，否则"当日收益"和"NAV 同步状态"会被 QDII 的天然滞后
带偏。本文档汇总了 QDII 净值的发布规则，以及代码里如何把这些规则落到持仓总览的
计算逻辑上。

## 1. QDII 净值的发布规则

QDII（Qualified Domestic Institutional Investor）基金主要投资海外资产，受时差、
境内外清算和外汇折算的影响，净值公布存在结构性滞后：

| 维度 | QDII（美股/全球类） | 境内场外（otc） | 境内场内（exchange） |
| --- | --- | --- | --- |
| 当日 T 净值披露时点 | T+1 工作日 ~21:00 之后（部分基金到 T+2） | T 日 21:00 左右 | 盘中实时 |
| 申购确认 | T+2 | T+1 | 当日成交 |
| 赎回到账 | T+4 ~ T+10 | T+1 ~ T+4 | 当日成交 |
| 净值波动来源 | 基金底层资产 + 汇率 + 多市场拼盘 | 仅境内市场 | 仅境内市场 |

### 1.1 休市矩阵

QDII 是否更新当日净值，取决于 A 股和境外市场是否同时开市：

| A 股 | 境外（如美股） | 当日 NAV 是否更新 | 备注 |
| --- | --- | --- | --- |
| 开市 | 开市 | 更新 | 正常 T+1 披露 |
| 开市 | 休市 | 仍可更新 | 仅汇率变动驱动，幅度通常很小 |
| 休市 | 开市 | 不更新 | 等下一个 A 股交易日才披露 |
| 休市 | 休市 | 不更新 | — |

### 1.2 节假日跳变

A 股长假期间，QDII 不披露净值；节后第一个交易日的净值会一次性反映整个假期境外
市场的累计涨跌——不是"今天"的涨跌。这一点在持仓总览的"当日收益"口径上需要特别
说明，避免用户把跳变误读为单日波动。

## 2. 持仓总览里的实现位置

所有规则都集中在 `src/app/holdingsLedgerCore.js`，通过下面这条流水线进入
持仓总览：

```
rawTransactions
  ├─ sanitizeTransactions   归一化每笔交易（kind 升级 QDII）
  ├─ buildHoldingAggregates 聚合到每只基金，标 hasTodayNav
  └─ summarizePortfolio     组合层面 navDateCoverage + 三类 NAV 日期
```

### 2.1 QDII 识别 — `detectFundKind` / `normalizeFundKind`

- `detectQdiiByName` 用一组关键词（`QDII / 纳指 / 标普 / 美国 / 港股 / 恒生 / 海外 / 全球 / 中概互联 / 油气 ...`）+ 已知 QDII 代码白名单做识别。
- `normalizeFundKind` 在每次读交易和聚合时跑一遍：显式标了 `exchange` / `qdii`
  的就保留；`otc` 或为空的会用代码 + 名称重新识别，以便存量 `kind='otc'` 的 QDII
  自动升级到 `qdii`。
- `detectFundKind` 还会按代码前缀（`15 / 50 / 51 / 52 / 53 / 54 / 56 / 58`）把场内
  ETF 单独标成 `exchange`。

### 2.2 "预期最新 NAV 日期" — `getExpectedLatestNavDate(kind, todayDate)`

这是把上面规则量化成一个日期字符串的核心函数：

- `exchange` / `otc`：预期 = 今日（周六回退到周五，周日回退到上周五）。
- `qdii`：预期 = 上一个工作日。
  - 周二 ~ 周五 → 前一天（T-1）
  - 周一 → 上周五（T-3）
  - 周六 → 周五，周日 → 上周五

聚合层把 `latestNavDate ≥ expectedLatestNavDate` 写成 `isLatestNavToday` /
`hasTodayNav`，并用它**门控当日收益**：

```
todayProfit = hasLatestNav && hasPreviousNav && isLatestNavToday
  ? (latestNav − previousNav) × totalShares
  : 0;
```

如果 QDII 当天还没披露 T-1 NAV（`latestNavDate` 仍为 T-2），`hasTodayNav=false`，
该持仓的当日收益就留空、不会污染组合的当日合计。

### 2.3 持仓总览 — `summarizePortfolio(aggregates)`

组合层面在 `summarizePortfolio` 把每只持仓的 `latestNavDate` 按 kind 分别落到三个
Set：

```js
const exchangeNavDates = new Set();
const otcNavDates = new Set();
const qdiiNavDates = new Set();
```

输出：

- `summary.latestExchangeNavDate` — 场内 ETF 最近的 NAV 日期。
- `summary.latestOtcNavDate` — 场外（境内）最近的 NAV 日期。
- `summary.latestQdiiNavDate` — **QDII 最近的 NAV 日期**（新增，单独成桶）。
- `summary.qdiiCount` — QDII 持仓数量。
- `summary.navDateCoverage` — 取值 `none / partial / full`，由
  `pricedCount === assetCount && navTodayReadyCount === assetCount` 判定。
  这里用的是每只持仓**自己**的 `hasTodayNav`，而不是要求所有持仓 NAV 日期一致——
  QDII 比场内晚一天属于正常状态。

### 2.4 投资组合概览卡片 — `renderPortfolioOverview`

`HoldingsExperience.jsx` 里的概览卡片消费上述字段：

- "当日收益" 和 "当日收益率" 用 `portfolio.todayProfit` / `todayReturnRate`，
  天然只统计 `hasTodayNav` 的仓位。
- "最后更新" 旁边的 `navBadge`：
  - `full` → `场内 YYYY-MM-DD · 场外 YYYY-MM-DD · QDII YYYY-MM-DD`。
  - `partial` → 同样把 `QDII YYYY-MM-DD` 加进 tooltip，让用户能直接看到 QDII
    最新落到了哪一天，从而判断当前"未同步"是因为 T+1 滞后还是真的失败。

## 3. 工程取舍

- **港股 / 日股 QDII 没有时差**：理论上当晚就能披露当日净值，目前一律按 T+1 计入
  `qdii`。这部分被识别为 QDII 后会比真实预期晚一天判定 `hasTodayNav`，导致
  当日收益被保守地留空。如果未来需要更精细，可在 `detectQdiiByName` 之后再加
  一个亚太子分类，用更短的预期日期（与 otc 同档）。
- **22:00 净值披露窗口**：QDII 在 T+1 当晚 ~21:00 之后才发布 T 日净值。代码里没
  显式建模时间，只看日期；后台同步任务会在 22:00 触发拉数，命中后 `hasTodayNav`
  自然变 true。
- **A 股节后 QDII 跳变**：当前用日期回退覆盖（`expected = 上一个工作日`），
  跳变值会自然作为单日 NAV 差进入 `todayProfit`。如需在 UI 上专门标注，可以
  比较 `latestNavDate − previousNavDate` 是否 > 1 个自然日来打 badge。
- **22:00 之前"没 NAV"被显示成失败**：靠 `summary.failedCodes` 区分。聚合层只
  在 `agg.snapshotError && agg.hasPosition` 才计入失败，仅"延迟"不会进。

## 4. 相关文件

- `src/app/holdingsLedgerCore.js` — `getExpectedLatestNavDate`、`detectFundKind`、
  `normalizeFundKind`、`buildHoldingAggregates`、`summarizePortfolio`。
- `src/pages/HoldingsExperience.jsx` — 概览卡片、`navBadge` tooltip。
- `src/app/holdingsHelpers.js` — `KIND_LABELS = { otc: '场外', exchange: '场内', qdii: 'QDII' }`、`KIND_PILL_TONES`。

## 5. 后续可考虑

- 把 `detectQdiiByName` 的关键词、白名单沉到 `src/app/qdiiRules.js` 单独模块，
  让 worker / Notion 同步逻辑也复用。
- 增加单元测试覆盖 `getExpectedLatestNavDate` 在每个工作日的预期；当前重构靠人
  工 + browser smoke。
- 节后第一个交易日的 "假期累计涨跌" 在 UI 上加一个 hover 提示。
