# 量化模块修复方案 - 迁移指南

## 概述

本文档说明如何从原版量化逻辑迁移到修复版本。

> 当前回测入口已收敛到 `src/app/backtest/index.js` 的 `runBacktest()`。
> 旧的 `quantBacktestEngine.js` / `runBacktestV2` 仅作为历史迁移背景保留，不再作为新代码入口。

---

## 修复内容总览

### 🔴 P0 - 严重问题修复

1. **回测引擎重写** (`src/app/backtest/index.js`)
   - ✅ 添加持仓状态追踪
   - ✅ 修正收益计算逻辑
   - ✅ 修正胜率计算（不再永远100%）
   - ✅ 新增夏普比率等专业指标

2. **历史数据获取** (`quantHistoricalData.js`)
   - ✅ 替换纯数学函数为真实模拟
   - ✅ 支持从后端API获取历史数据
   - ✅ 添加缓存机制

3. **订单生成逻辑修正** (`quantOrderPlanV2.js`)
   - ✅ 修正买卖金额匹配问题
   - ✅ 修正预估收益公式
   - ✅ 增强风控检查（IOPV比例、极端溢价等）

### 🟡 P1 - 强烈建议

4. **参数优化预设** (`quantConfigPresets.js`)
   - ✅ 提供保守/平衡/激进三种配置
   - ✅ 根据回测结果推荐参数调整
   - ✅ 参数有效性验证

5. **风控监控增强** (`quantRiskMonitor.js`)
   - ✅ 实时风险检查（数据、市场、流动性、持仓）
   - ✅ 熔断机制
   - ✅ 日内统计追踪

6. **后端API** (`quantHistoricalRoutes.js`)
   - ✅ 历史溢价数据查询接口
   - ✅ 雪球数据源集成
   - ✅ KV缓存

---

## 迁移步骤

### 第一步：安装新模块（不破坏现有功能）

新模块独立于原版，可以并行运行：

```javascript
// 在 quantTrading.js 中添加统一回测导出
export { runBacktest, runPremiumSpreadBacktest } from './backtest/index.js';
export { buildOrderPlanV2 } from './quantOrderPlanV2.js';
export { RiskMonitor, performRiskCheck } from './quantRiskMonitor.js';
export { getCachedHistoricalData } from './quantHistoricalData.js';
export { RECOMMENDED_STRATEGY_CONFIGS, applyConfigPreset } from './quantConfigPresets.js';
```

### 第二步：添加版本切换开关

在用户设置中添加开关，让用户选择使用哪个版本：

```javascript
// 在 DEFAULT_QUANT_STATE 中添加
settings: {
  // ... 现有设置
  useV2Logic: false,  // 默认false，保持向后兼容
  enableEnhancedRiskControl: false
}
```

### 第三步：修改前端调用（渐进式）

#### 3.1 回测模块

```javascript
import { runBacktest } from './backtest/index.js';
import { getCachedHistoricalData } from './quantHistoricalData.js';

const historicalData = await getCachedHistoricalData(
  [strategy.sellSymbol, strategy.buySymbol],
  startDate,
  endDate
);

const result = runBacktest({
  type: 'premium-spread',
  highCodes: [strategy.sellSymbol],
  lowCodes: [strategy.buySymbol],
  activeSide: 'all',
  intraSellLowerPct: strategy.closeSpreadPct,
  intraBuyOtherPct: strategy.triggerSpreadPct
}, {
  timeframe: '5m',
  historyByCode: historicalData,
  navHistoryByCode,
  initialEquity: account.cash,
  feeRate: account.feeRate / 100,
  minFee: account.minFee,
  tickSize: account.tickSize,
  slippageTicks: account.slippageTicks,
  lotSize: strategy.lotSize
});
```

#### 3.2 订单生成

```javascript
// 原版
import { buildSimulatedOrderPlan } from './quantTrading.js';
const planOld = buildSimulatedOrderPlan(state);

// 新版
import { buildOrderPlanV2 } from './quantOrderPlanV2.js';
const planNew = buildOrderPlanV2(state);

const plan = settings.useV2Logic ? planNew : planOld;
```

#### 3.3 执行前风控检查（新增）

```javascript
import { RiskMonitor } from './quantRiskMonitor.js';

function executeTradeWithRiskCheck(state, plan) {
  if (settings.enableEnhancedRiskControl) {
    const monitor = new RiskMonitor();
    const riskCheck = monitor.checkRisks(state, plan);
    
    if (!riskCheck.passed) {
      // 显示风控预警
      showRiskAlerts(riskCheck.alerts);
      return { success: false, reason: '风控检查未通过' };
    }
  }
  
  // 执行交易
  return executeSimulatedSwitch(state);
}
```

### 第四步：部署后端API

```javascript
// 在 workers/notify/src/index.js 中注册路由
import quantHistoricalRoutes from './quantHistoricalRoutes.js';

// ... 其他路由
router.all('/api/v1/quant/*', quantHistoricalRoutes.handle);
```

### 第五步：前端UI调整

#### 5.1 添加版本切换UI

```jsx
// 在设置页面添加
<div className="space-y-3">
  <h3>实验性功能</h3>
  
  <Checkbox
    label="启用V2回测引擎"
    description="使用真实历史数据和持仓追踪，结果更准确但计算较慢"
    checked={settings.useV2Logic}
    onChange={v => patchSettings('useV2Logic', v)}
  />
  
  <Checkbox
    label="启用增强风控"
    description="实时检查市场风险、流动性和持仓集中度"
    checked={settings.enableEnhancedRiskControl}
    onChange={v => patchSettings('enableEnhancedRiskControl', v)}
  />
</div>
```

#### 5.2 显示版本对比

```jsx
// 在回测页面
{settings.useV2Logic && (
  <div className="bg-blue-50 p-4 rounded">
    <div className="flex items-center gap-2">
      <BadgeCheck className="text-blue-600" />
      <span className="text-sm font-semibold text-blue-900">
        使用V2引擎（真实数据）
      </span>
    </div>
    <div className="mt-2 text-xs text-blue-700">
      · 持仓状态追踪 · 真实收益计算 · 夏普比率 {result.summary.sharpeRatio}
    </div>
  </div>
)}
```

#### 5.3 风控预警显示

```jsx
// 在交易面板
{riskCheck && !riskCheck.passed && (
  <div className="bg-red-50 border border-red-200 rounded-xl p-4">
    <div className="flex items-center gap-2 text-red-900 font-bold">
      <AlertTriangle className="h-5 w-5" />
      风控熔断
    </div>
    <div className="mt-3 space-y-2">
      {riskCheck.alerts
        .filter(a => a.level === 'ERROR')
        .map(alert => (
          <div key={alert.code} className="text-sm text-red-700">
            • {alert.message}
          </div>
        ))}
    </div>
  </div>
)}
```

---

## 参数调整建议

### 对比原版与推荐配置

| 参数 | 原版 | 推荐（平衡型） | 说明 |
|------|------|---------------|------|
| `triggerSpreadPct` | 0.3% | **0.45%** | 提高触发线，降低错误交易 |
| `feeBufferPct` | 0.04% | **0.15%** | 覆盖真实成本（佣金+滑点） |
| `maxOrderCash` | 16000 | 16000 | 保持不变 |
| `cooldownDays` | 2 | 2 | 保持不变 |

### 应用预设配置

```javascript
import { applyConfigPreset } from './quantConfigPresets.js';

// 应用保守型配置
const newState = applyConfigPreset(currentState, 'conservative');

// 或根据回测结果获取推荐
import { recommendParameters } from './quantConfigPresets.js';
const recommendations = recommendParameters(backtestResult);

// 显示给用户
recommendations.forEach(rec => {
  console.log(`建议${rec.action} ${rec.parameter}: ${rec.reason}`);
});
```

---

## 测试验证

### 运行自动化测试

```bash
node src/app/quantTests.js
```

预期输出：
```
✅ 测试1：回测引擎持仓追踪 - 通过
✅ 测试2：订单生成逻辑 - 通过
✅ 测试3：风控监控 - 通过
✅ 测试4：对比原版vs修正版 - 通过

通过率: 100%
```

### 手动测试检查清单

- [ ] 回测结果的胜率不再是100%
- [ ] 回测结果包含最大回撤
- [ ] 回测结果包含夏普比率
- [ ] 预估收益计算不再是简单的金额×差价百分比
- [ ] 极端溢价率（如±5%）触发熔断
- [ ] IOPV比例异常时显示预警
- [ ] 盘口深度不足时显示预警
- [ ] 历史数据缓存生效（第二次加载更快）

---

## 回滚方案

如果新版本出现问题，可以立即回滚：

```javascript
// 方式1：前端UI关闭开关
settings.useV2Logic = false;
settings.enableEnhancedRiskControl = false;

// 方式2：环境变量强制禁用
if (env.FORCE_LEGACY_QUANT === 'true') {
  settings.useV2Logic = false;
}

// 方式3：删除新模块文件（不影响原有功能）
// 原版 quantTrading.js 完全保留，可独立运行
```

---

## 性能影响

| 操作 | 原版耗时 | 新版耗时 | 说明 |
|------|---------|---------|------|
| 回测30天 | ~10ms | ~50ms | 增加持仓追踪和真实模拟 |
| 回测180天 | ~20ms | ~200ms | 需要更多计算 |
| 订单生成 | ~2ms | ~5ms | 增加风控检查 |
| 历史数据获取 | N/A | ~500ms（首次）<br>~10ms（缓存） | 新增功能 |

**建议**：
- 回测时显示Loading状态
- 历史数据预加载（用户打开回测页面时后台获取）
- 考虑Web Worker执行长回测

---

## 常见问题

### Q1: 为什么新版回测收益比原版低？

**A**: 原版使用错误的公式，假设溢价差=即时收益。新版正确模拟了持仓切换，收益需要等未来平仓时才能实现，更接近真实情况。

### Q2: 为什么胜率不再是100%？

**A**: 原版只要触发交易就认为盈利（因为公式是`profit = amount * spread%`，spread为正）。新版追踪真实持仓和已实现盈亏，部分交易可能因为后续市场变化而亏损。

### Q3: 可以同时显示两个版本的对比吗？

**A**: 可以！参考 `testCompareVersions()` 的实现，同时运行两个版本并展示对比。

### Q4: 历史数据从哪里来？

**A**: 优先级：后端API（雪球） > 本地缓存 > 真实模拟数据。生产环境建议配置后端API。

### Q5: 风控熔断会影响手动交易吗？

**A**: 默认只影响自动执行。手动点击"执行交易"会显示预警但允许用户确认后继续。

---

## 下一步优化方向

1. **分钟级回测**：当前是日级，可升级到分钟级更精确
2. **多策略组合**：支持同时运行多个策略
3. **实盘对接**：PTrade/QMT券商接口真实下单
4. **机器学习优化**：用历史数据训练最优参数
5. **实时监控面板**：WebSocket推送实时风控状态

---

## 技术支持

如有问题，请联系开发团队或提交Issue，并附上：
- 错误信息
- 使用的配置参数
- 复现步骤
- 测试结果截图
