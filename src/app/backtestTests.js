/**
 * 统一回测系统测试套件
 */

import { runBacktest, buildSampleBacktestRows, roundTo } from './backtest/index.js';

/**
 * 测试 1: 基础导入和工具函数
 */
export function testBasicImports() {
  console.log('\n=== 测试 1: 基础导入和工具函数 ===');

  // 测试导入
  if (typeof runBacktest !== 'function') {
    throw new Error('runBacktest 导入失败');
  }
  if (typeof buildSampleBacktestRows !== 'function') {
    throw new Error('buildSampleBacktestRows 导入失败');
  }
  if (typeof roundTo !== 'function') {
    throw new Error('roundTo 导入失败');
  }
  console.log('✓ 所有导入成功');

  // 测试 roundTo
  const rounded = roundTo(3.14159, 2);
  if (rounded !== 3.14) {
    throw new Error(`roundTo 结果错误: 期望 3.14, 实际 ${rounded}`);
  }
  console.log('✓ roundTo 函数正常');

  // 测试样例数据生成
  const rows = buildSampleBacktestRows(10);
  if (!Array.isArray(rows) || rows.length !== 10) {
    throw new Error(`buildSampleBacktestRows 结果错误: 期望 10 行, 实际 ${rows?.length}`);
  }
  console.log('✓ buildSampleBacktestRows 函数正常');

  return { passed: true };
}

/**
 * 测试 2: 空数据回测
 */
export function testEmptyDataBacktest() {
  console.log('\n=== 测试 2: 空数据回测 ===');

  const strategy = {
    type: 'premium-spread',
    highCodes: ['513050'],
    lowCodes: ['513100'],
    intraSellLowerPct: 0.2,
    intraBuyOtherPct: 0.5,
    activeSide: 'all'
  };

  const options = {
    timeframe: '5m',
    historyByCode: {},
    navHistoryByCode: {},
    initialEquity: 100000
  };

  const result = runBacktest(strategy, options);

  // 验证返回结构
  const requiredFields = ['ok', 'status', 'summary', 'rows', 'signals', 'trades', 'chart', 'quality'];
  for (const field of requiredFields) {
    if (!(field in result)) {
      throw new Error(`回测结果缺少字段: ${field}`);
    }
  }
  console.log('✓ 回测结果结构完整');

  // 验证无数据时的状态
  if (result.status !== 'failed') {
    console.warn(`⚠ 预期 status=failed, 实际 ${result.status}`);
  }

  console.log(`  status: ${result.status}`);
  console.log(`  quality.passed: ${result.quality?.passed}`);
  console.log(`  summary.sampleCount: ${result.summary?.sampleCount}`);

  return { passed: true, result };
}

/**
 * 测试 3: 模拟数据回测
 */
export function testSimulatedBacktest() {
  console.log('\n=== 测试 3: 模拟数据回测 ===');

  // 生成模拟 K线数据
  const now = Date.now() / 1000;
  const candles = [];
  for (let i = 0; i < 100; i++) {
    const t = now - (100 - i) * 300; // 每 5 分钟
    const base = 1.0 + Math.sin(i * 0.1) * 0.05;
    candles.push({
      t,
      date: new Date(t * 1000).toISOString().slice(0, 10),
      open: base,
      high: base * 1.01,
      low: base * 0.99,
      close: base,
      bidPrice: base * 0.999,
      askPrice: base * 1.001
    });
  }

  // 生成模拟 NAV 数据
  const navHistory = [];
  for (let i = 0; i < 30; i++) {
    const date = new Date(Date.now() - (30 - i) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    navHistory.push({
      date,
      nav: 1.0 + Math.sin(i * 0.15) * 0.03
    });
  }

  const strategy = {
    type: 'premium-spread',
    highCodes: ['513050'],
    lowCodes: ['513100'],
    intraSellLowerPct: 0.2,
    intraBuyOtherPct: 0.5,
    activeSide: 'all'
  };

  const options = {
    timeframe: '5m',
    historyByCode: {
      '513050': candles,
      '513100': candles.map(c => ({ ...c, close: c.close * 1.02 })) // 稍高溢价
    },
    navHistoryByCode: {
      '513050': navHistory,
      '513100': navHistory
    },
    initialEquity: 100000,
    feeRate: 0.0001,
    lotSize: 100
  };

  const result = runBacktest(strategy, options);

  console.log(`  status: ${result.status}`);
  console.log(`  sampleCount: ${result.summary?.sampleCount}`);
  console.log(`  tradeCount: ${result.summary?.tradeCount || 0}`);
  console.log(`  totalReturnPct: ${result.summary?.totalReturnPct?.toFixed(2)}%`);
  console.log(`  finalEquity: ${result.summary?.finalEquity}`);

  // 验证基本逻辑
  if (result.summary?.sampleCount <= 0) {
    throw new Error('样本数应该 > 0');
  }

  if (!Number.isFinite(result.summary?.finalEquity)) {
    throw new Error('finalEquity 应该是有限数');
  }

  console.log('✓ 模拟数据回测通过');

  return { passed: true, result };
}

/**
 * 测试 4: 策略类型路由
 */
export function testStrategyTypeRouting() {
  console.log('\n=== 测试 4: 策略类型路由 ===');

  // 测试默认类型
  const result1 = runBacktest({}, { historyByCode: {}, navHistoryByCode: {} });
  if (!result1.ok) {
    throw new Error('默认策略类型应该可用');
  }
  console.log('✓ 默认策略类型路由正常');

  // 测试显式类型
  const result2 = runBacktest(
    { type: 'premium-spread' },
    { historyByCode: {}, navHistoryByCode: {} }
  );
  if (!result2.ok) {
    throw new Error('premium-spread 类型应该可用');
  }
  console.log('✓ premium-spread 类型路由正常');

  // 测试未知类型
  try {
    runBacktest(
      { type: 'unknown-strategy' },
      { historyByCode: {}, navHistoryByCode: {} }
    );
    throw new Error('未知策略类型应该抛出错误');
  } catch (err) {
    if (!err.message.includes('Unknown strategy type')) {
      throw err;
    }
    console.log('✓ 未知策略类型正确抛出错误');
  }

  return { passed: true };
}

/**
 * 运行所有测试
 */
export function runAllBacktestTests() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║        统一回测系统测试套件                                  ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  const tests = [
    { name: '基础导入', fn: testBasicImports },
    { name: '空数据回测', fn: testEmptyDataBacktest },
    { name: '模拟数据回测', fn: testSimulatedBacktest },
    { name: '策略类型路由', fn: testStrategyTypeRouting }
  ];

  const results = [];
  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      const result = test.fn();
      results.push({ name: test.name, passed: true, result });
      passed++;
    } catch (error) {
      console.error(`\n❌ ${test.name} 失败:`, error.message);
      results.push({ name: test.name, passed: false, error });
      failed++;
    }
  }

  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║  测试结果汇总                                                ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`  总计: ${tests.length} 个测试`);
  console.log(`  通过: ${passed} ✓`);
  console.log(`  失败: ${failed} ✗`);
  console.log('');

  if (failed === 0) {
    console.log('🎉 所有测试通过！');
  } else {
    console.error('⚠️  存在测试失败');
  }

  return { passed, failed, results };
}

// 如果直接运行此文件
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllBacktestTests();
}
