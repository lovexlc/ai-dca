/**
 * 回测引擎统一入口
 *
 * 所有回测逻辑收敛到此目录，提供统一的 runBacktest() 接口。
 */

import { runPremiumSpreadBacktest } from './engines/premiumSpread.js';
import { buildSampleBacktestRows } from './engines/sample.js';

/**
 * 统一回测入口 - 根据策略类型路由到对应引擎
 * @param {Object} strategy - 策略配置
 * @param {Object} options - 回测选项
 * @returns {Object} 回测结果
 */
export function runBacktest(strategy, options = {}) {
  const type = strategy?.type || 'premium-spread';

  if (type === 'premium-spread' || !strategy?.type) {
    return runPremiumSpreadBacktest(strategy, options);
  }

  throw new Error(`Unknown strategy type: ${type}`);
}

/**
 * 向后兼容的别名
 * @deprecated Use runBacktest() instead
 */
export { runPremiumSpreadBacktest };

/**
 * 样例数据生成工具（保留用于演示和测试）
 */
export { buildSampleBacktestRows };

/**
 * 导出核心工具函数（供高级用户使用）
 */
export { roundTo, clampNumber } from './core/math.js';
export { normalizeBacktestCandles, buildNavLookup } from './core/candles.js';
export { PositionState, AccountState } from './core/account.js';
export { createTradeSimulator } from './core/simulator.js';
