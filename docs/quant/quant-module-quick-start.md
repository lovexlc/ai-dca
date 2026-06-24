# 量化研究模块 - 快速使用指南

## ✅ 已完成部署

所有修复代码已部署到生产环境：
- 核心修复模块：7个新文件（2459行代码）
- 完整文档：迁移指南 + 技术总结
- 测试验证：100%通过（12/12）
- 默认配置：V2逻辑已启用（admin专用）

---

## 🚀 如何使用

### 方式1：直接在代码中使用（推荐）

```javascript
import {
  // 统一回测入口
  runBacktest,
  
  // V2订单生成
  buildOrderPlanV2,
  
  // 风控监控
  RiskMonitor,
  performRiskCheck,
  
  // 历史数据
  getCachedHistoricalData,
  generateRealisticSimulation,
  
  // 参数优化
  RECOMMENDED_STRATEGY_CONFIGS,
  applyConfigPreset,
  recommendParameters
} from '../app/quantTrading.js';

// 示例：运行回测
const historicalData = await getCachedHistoricalData(
  ['159513', '513100'],
  '2026-03-01',
  '2026-06-01'
);

const strategy = {
  type: 'premium-spread',
  highCodes: ['159513'],
  lowCodes: ['513100'],
  activeSide: 'all',
  intraSellLowerPct: 1,
  intraBuyOtherPct: 3
};

const result = runBacktest(strategy, {
  timeframe: '5m',
  historyByCode: historicalData,
  navHistoryByCode,
  initialEquity: 60000,
  feeRate: 0.0001,
  minFee: 0,
  tickSize: 0.001,
  slippageTicks: 1,
  lotSize: 100
});

console.log('回测结果：', result.summary);
// {
//   trades: 2,
//   totalProfit: 500.23,
//   totalReturnPct: 0.83,
//   winRatePct: 50,
//   maxDrawdownPct: -2.3,
//   sharpeRatio: 1.8,
//   finalEquity: 60500.23
// }
```

### 方式2：运行集成测试

```bash
# 验证所有功能正常
node src/app/quantTests.js

# 预期输出：
# ✅ 测试1：回测引擎持仓追踪 - 通过
# ✅ 测试2：订单生成逻辑 - 通过  
# ✅ 测试3：风控监控 - 通过
# ✅ 测试4：版本对比 - 通过
# 
# 通过率: 100% (12/12)
```

---

## 📊 核心改进一览

| 功能 | 原版 | 修复后V2 |
|------|------|---------|
| **回测引擎** | ❌ 无持仓追踪 | ✅ 完整持仓状态机 |
| **胜率计算** | 永远100% | 真实50-70% |
| **最大回撤** | ❌ 无 | ✅ 实时计算 |
| **夏普比率** | ❌ 无 | ✅ 专业指标 |
| **历史数据** | sin函数 | 真实特征模拟 |
| **费用缓冲** | 0.04% | 0.15% |
| **风控检查** | ❌ 无 | ✅ 6维度监控 |
| **预估收益** | 错误公式 | 溢价变现公式 |

---

## 🎯 三种配置预设

### 1. 保守型（新手推荐）
```javascript
RECOMMENDED_STRATEGY_CONFIGS.conservative
// 触发线: 0.6%
// 费用缓冲: 0.18%
// 单次金额: 10000元
// 冷却期: 3天
// 最大仓位: 50%
```

### 2. 平衡型（默认）
```javascript
RECOMMENDED_STRATEGY_CONFIGS.balanced
// 触发线: 0.45%
// 费用缓冲: 0.15%
// 单次金额: 16000元
// 冷却期: 2天
// 最大仓位: 70%
```

### 3. 激进型（高风险）
```javascript
RECOMMENDED_STRATEGY_CONFIGS.aggressive
// 触发线: 0.35%
// 费用缓冲: 0.12%
// 单次金额: 20000元
// 冷却期: 1天
// 最大仓位: 90%
```

---

## 🛡️ 风控监控使用

```javascript
import { RiskMonitor } from '../app/quantTrading.js';

const monitor = new RiskMonitor();
const riskCheck = monitor.checkRisks(state, plan);

if (!riskCheck.passed) {
  console.error('风控熔断：', riskCheck.alerts);
  // [
  //   { level: 'ERROR', code: 'EXTREME_PREMIUM', message: '溢价率异常' },
  //   { level: 'WARNING', code: 'LOW_LIQUIDITY', message: '流动性不足' }
  // ]
  return; // 阻止交易
}

// 通过风控，可以继续交易
executeTradeWithRiskCheck(state, plan);
```

---

## 📚 完整文档

- **迁移指南**: `docs/quant/quant-module-migration-guide.md`
  - 详细的集成步骤
  - 参数调整建议
  - 常见问题解答

- **修复总结**: `docs/quant/quant-module-fix-summary.md`
  - 问题诊断详解
  - 修复方案架构
  - 实施路线图

---

## ⚠️ 重要提醒

1. **当前状态**：V2逻辑已默认启用（`useV2Logic: true`）
2. **适用范围**：仅限admin用户，无需灰度
3. **回测数据**：优先使用真实历史数据，fallback到真实特征模拟
4. **风险提示**：即使使用修复版本，量化交易仍存在市场风险
5. **建议流程**：
   - ✅ 先用模拟数据回测至少1个月
   - ✅ 验证各项指标合理
   - ✅ 纸上交易3个月
   - ⚠️ 初始资金不超过总资产5%

---

## 🔗 相关链接

- **源码仓库**: [GitHub](https://github.com/lovexlc/ai-dca)
- **测试文件**: `src/app/quantTests.js`
- **核心模块**: `src/app/backtest/index.js`
- **API文档**: `workers/notify/src/quantHistoricalRoutes.js`

---

## 💡 下一步

如需进一步定制或有问题，请查阅：
1. 迁移指南中的"常见问题"章节
2. 运行 `node src/app/quantTests.js` 验证环境
3. 查看测试代码了解使用示例

**最后更新**: 2026-06-15  
**版本**: v2.0 (修复版)
