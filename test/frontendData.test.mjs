/**
 * 测试前端页面数据流
 */

import {
  DEFAULT_QUANT_STATE,
  readQuantProjectState,
  buildSimulatedOrderPlan,
  computeAccountSummary,
  evaluatePremiumSpread,
  buildOrderPlanV2,
  RiskMonitor,
  RECOMMENDED_STRATEGY_CONFIGS
} from '../src/app/quantTrading.js';

console.log('========================================');
console.log('前端页面数据流测试');
console.log('========================================\n');

// 1. 测试状态初始化
console.log('=== 测试1：状态初始化 ===');
const state = readQuantProjectState();
console.log('初始状态：');
console.log('- 现金:', state.account.cash);
console.log('- 持仓数量:', Object.keys(state.account.positions).length);
console.log('- 策略名:', state.strategy.name);
console.log('- useV2Logic:', state.settings?.useV2Logic);
console.log('- enableEnhancedRiskControl:', state.settings?.enableEnhancedRiskControl);
console.log('');

// 2. 测试报价数据
console.log('=== 测试2：报价数据 ===');
console.log('quotes键:', Object.keys(state.quotes));
for (const [symbol, quote] of Object.entries(state.quotes)) {
  console.log(`${symbol}:`, {
    bid: quote.bid,
    ask: quote.ask,
    iopv: quote.iopv,
    name: quote.name
  });
}
console.log('');

// 3. 测试账户摘要
console.log('=== 测试3：账户摘要 ===');
const summary = computeAccountSummary(state);
console.log('账户摘要：');
console.log('- 总资产:', summary.equity);
console.log('- 现金:', summary.cash);
console.log('- 持仓市值:', summary.marketValue);
console.log('- 持仓数:', summary.positionCount);
console.log('');

// 4. 测试交易信号
console.log('=== 测试4：交易信号 ===');
const signal = evaluatePremiumSpread(state);
console.log('交易信号：');
console.log('- 动作:', signal.action);
console.log('- 原因:', signal.reason);
console.log('- 卖出溢价率:', signal.sellPremiumPct + '%');
console.log('- 买入溢价率:', signal.buyPremiumPct + '%');
console.log('- 净差价:', signal.netSpreadPct + '%');
console.log('');

// 5. 测试V1订单生成
console.log('=== 测试5：V1订单生成 ===');
const orderPlanV1 = buildSimulatedOrderPlan(state);
console.log('V1订单计划：');
console.log('- 可交易:', orderPlanV1.canTrade);
console.log('- 拒绝原因:', orderPlanV1.rejectReason);
console.log('- 预估收益:', orderPlanV1.estimatedCapture);
console.log('');

// 6. 测试V2订单生成
console.log('=== 测试6：V2订单生成 ===');
const orderPlanV2 = buildOrderPlanV2(state);
console.log('V2订单计划：');
console.log('- 可交易:', orderPlanV2.canTrade);
console.log('- 拒绝原因:', orderPlanV2.rejectReason);
console.log('- 预估收益:', orderPlanV2.estimatedCapture);
if (orderPlanV2.riskFlags && orderPlanV2.riskFlags.length > 0) {
  console.log('- 风险标记:', orderPlanV2.riskFlags);
}
console.log('');

// 7. 测试风控监控
console.log('=== 测试7：风控监控 ===');
const monitor = new RiskMonitor();
const riskCheck = monitor.checkRisks(state, orderPlanV2);
console.log('风控检查：');
console.log('- 通过:', riskCheck.passed);
console.log('- 风险等级:', riskCheck.riskLevel);
console.log('- 预警数量:', riskCheck.alerts.length);
if (riskCheck.alerts.length > 0) {
  console.log('预警列表：');
  riskCheck.alerts.forEach(alert => {
    console.log(`  [${alert.level}] ${alert.code}: ${alert.message}`);
  });
}
console.log('');

// 8. 测试配置预设
console.log('=== 测试8：配置预设 ===');
console.log('可用预设：');
for (const [key, preset] of Object.entries(RECOMMENDED_STRATEGY_CONFIGS)) {
  console.log(`- ${key} (${preset.name}):`);
  console.log(`  触发线: ${preset.triggerSpreadPct}%`);
  console.log(`  费用缓冲: ${preset.feeBufferPct}%`);
  console.log(`  冷却期: ${preset.cooldownDays}天`);
}
console.log('');

console.log('========================================');
console.log('测试完成');
console.log('========================================');
