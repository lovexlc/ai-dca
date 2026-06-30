# 基金切换：把「基准」改成「我的持仓」

## 背景

基金切换 tab 当前用「基准」一词描述用户当前持有、用来对比其他基金的 ETF。用户反馈这个词需要解释，不如直接改成用户自己的语言「我持有的」。

## 目标

1. UI 文案里不再出现「基准」一词。
2. 把「设为基准/取消基准」改成「设为我的持仓/取消我的持仓」。
3. 顶部说明从长段文字缩成一行，或删除。
4. 首次进入页面时，用一次极简操作（选持仓）替代阅读说明。
5. 用状态图标（Pin）让用户一眼识别当前被标记的持仓。

## 方案

### 1. 文案替换（最暴力）

| 原文案 | 新文案 |
| --- | --- |
| 设为基准 | 设为我的持仓 |
| 取消基准 | 取消我的持仓 |
| 当前规则基准 | 当前规则持仓 |
| 模拟基准 | 模拟持仓 |
| 基准/模拟基准 | 持仓/模拟持仓 |
| 请先选择至少一只基准 ETF | 请先选择至少一只持仓 ETF |
| 未配置基准（在上方 H/L 表把已分类 ETF 设为基准） | 未配置持仓（在上方 H/L 表把已分类 ETF 设为我的持仓） |
| 当前基准 X 只 / 总候选 Y 只 | 当前持仓 X 只 / 总候选 Y 只 |
| 基准溢价阈值 | 持仓溢价阈值 |
| 未切换基准 | 未切换持仓 |
| 场外信号：卖 基准，观察场外 QDII 申购机会 | 场外信号：卖 持仓，观察场外 QDII 申购机会 |

> 代码注释、变量名、接口字段保留 `benchmark`，只改用户可见文案。

### 2. 首次引导：先选持仓

进入基金切换 tab 时，如果当前规则没有配置 benchmarkCodes，在页面顶部显示一个极简的单选条：

```
你目前持有哪只纳指 ETF？  [513100 纳斯达克ETF] [159941 纳斯达克指数] [159696 ...] [还没持有，先看模拟]
```

- 选项从 `candidateUniverse` 与 `exchangeFunds` 的并集动态生成。
- 每个选项显示 `code` + `name`。
- 点击后自动把该 code 设为当前规则的 benchmarkCodes（相当于之前「设为基准」的简化入口）。
- 选择「还没持有，先看模拟」则跳过，不设置任何持仓，单选条消失。
- 这个引导不是弹窗，不阻断页面其他内容。
- 已配置 benchmarkCodes 后不再显示。

### 3. 状态图标

当前 benchmark 的 chip 上显示一个 Pin 图标（📌）替代现在的「基准」文字 badge。

- 位置：code 与 H/L 操作按钮之间，靠近「持」badge。
- tooltip：`当前规则的持仓`。
- 配合 H 组（高溢价）与 L 组（低溢价）的颜色对比，让用户一眼看到「我的持仓在这里，其他跟它比」。

### 4. 顶部说明简化

`SwitchStrategyClassificationPanel` 顶部的说明行保留一行即可：

```
当前持仓：513100 · 纳斯达克ETF  · NAV 最新日期 2026-06-30
```

删除原来的 indigo 提示框：「基准按当前监控规则单独保存……」

### 5. 删除/简化现有新手引导

- `FundSwitchExperience` 中的 `FundSwitchHowToDialog`（「怎么用」弹窗）移除。
- `FundSwitchGuide` 的首次引导改为上述单选条，不再使用多步骤教程卡片。
- `FundSwitchGuide.jsx` 保留但只导出轻量组件，或直接在 `FundSwitchExperience` 内实现单选条。

## 不做的事

- ❌ 写更长的解释文案
- ❌ 新增阻断式新手指引弹窗
- ❌ 保留「基准」这个词在用户界面
- ❌ 修改代码变量名、接口字段、数据库字段（只改 UI 文案）

## 受影响文件

- `src/pages/FundSwitchExperience.jsx`：首次引导改为持仓单选条，删除「怎么用」弹窗
- `src/pages/SwitchStrategyClassificationPanel.jsx`：按钮文案、Pin 图标、顶部说明、删除 indigo 提示框
- `src/pages/SwitchStrategyExperience.jsx`：状态文案、benchmarkSummary
- `src/pages/SwitchStrategyPanels.jsx`：规则选择、状态提示里的「基准」文案
- `src/pages/SwitchStrategyOpportunityPanels.jsx`：「基准溢价阈值」文案
- `src/app/todaySignals.js`：信号描述里的「基准」文案
- `src/components/FundSwitchGuide.jsx`：精简或替换

## 成功标准

1. 基金切换 tab 内所有用户可见文案不含「基准」二字。
2. 「设为我的持仓」/「取消我的持仓」按钮正常工作。
3. 未配置持仓时顶部出现单选条，选择后自动设置 benchmarkCodes。
4. 当前持仓 chip 显示 Pin 图标。
5. 现有自动化测试 / lint 通过。
