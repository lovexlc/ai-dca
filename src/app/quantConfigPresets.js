/**
 * 量化策略参数配置 - 优化版
 * 基于真实市场特征调整参数
 */

/**
 * 推荐的策略参数配置
 */
export const RECOMMENDED_STRATEGY_CONFIGS = {
  // 保守型：适合新手，风险低
  conservative: {
    name: '纳指 ETF 溢价差 - 保守型',
    sellSymbol: '159513',
    buySymbol: '513100',
    triggerSpreadPct: 0.6,        // 提高触发线，只在明显机会时交易
    closeSpreadPct: 0.2,          // 提高观察线
    feeBufferPct: 0.18,           // 更高的费用缓冲
    maxOrderCash: 10000,          // 更小的单次金额
    minOrderCash: 1000,
    lotSize: 100,
    cooldownDays: 3,              // 更长的冷却期
    maxPositionPct: 0.5,          // 单标的最多50%仓位
    description: '适合风险厌恶者，交易频率低但确定性高'
  },

  // 平衡型：原版的改进版
  balanced: {
    name: '纳指 ETF 溢价差 - 平衡型',
    sellSymbol: '159513',
    buySymbol: '513100',
    triggerSpreadPct: 0.45,
    closeSpreadPct: 0.15,
    feeBufferPct: 0.15,
    maxOrderCash: 16000,
    minOrderCash: 1000,
    lotSize: 100,
    cooldownDays: 2,
    maxPositionPct: 0.7,
    description: '风险收益平衡，适合大多数用户'
  },

  // 激进型：追求更高收益，承受更多风险
  aggressive: {
    name: '纳指 ETF 溢价差 - 激进型',
    sellSymbol: '159513',
    buySymbol: '513100',
    triggerSpreadPct: 0.35,
    closeSpreadPct: 0.12,
    feeBufferPct: 0.12,
    maxOrderCash: 20000,
    minOrderCash: 1000,
    lotSize: 100,
    cooldownDays: 1,
    maxPositionPct: 0.9,
    description: '追求更高频率和收益，风险较高'
  }
};

/**
 * 风控参数配置
 */
export const RISK_CONTROL_CONFIG = {
  // 极端溢价率熔断阈值
  extremePremiumThreshold: 5.0,    // ±5%

  // IOPV比例检查
  iopvRatio: {
    expected: 1.18,                 // 159513/513100的预期比例
    maxDeviation: 0.05              // 最大偏离5%
  },

  // 最小盘口深度
  minBidAskSize: 10000,             // 单边至少1万股

  // 盘口深度使用率
  depthUtilization: 0.3,            // 只用30%深度

  // 日内最大交易次数
  maxTradesPerDay: 2,

  // 单日最大亏损止损
  maxDailyLossPct: 1.0,             // 1%

  // 连续亏损次数限制
  maxConsecutiveLosses: 3,

  // 持仓集中度限制
  maxSinglePositionPct: 0.7,        // 单标的最多70%

  // 总仓位限制
  maxTotalPositionPct: 0.95         // 总仓位最多95%
};

/**
 * 账户配置
 */
export const ACCOUNT_CONFIGS = {
  // 小额测试账户
  small: {
    cash: 30000,
    feeRate: 0.015,                 // 万1.5
    minFee: 0,
    tickSize: 0.001,
    slippageTicks: 1,
    description: '小额测试，适合初步验证策略'
  },

  // 标准账户
  standard: {
    cash: 60000,
    feeRate: 0.01,                  // 万1
    minFee: 0,
    tickSize: 0.001,
    slippageTicks: 1,
    description: '标准配置，适合正式运行'
  },

  // 大额账户
  large: {
    cash: 200000,
    feeRate: 0.008,                 // 万0.8（大资金优惠）
    minFee: 0,
    tickSize: 0.001,
    slippageTicks: 2,               // 大额需要更多滑点预留
    description: '大额账户，注意流动性约束'
  }
};

/**
 * 实时执行配置
 */
export const REALTIME_CONFIGS = {
  // 谨慎模式
  cautious: {
    enabled: true,
    autoExecute: false,             // 不自动执行，只提醒
    onlyTradingSession: true,
    refreshIntervalSec: 30,         // 30秒一次
    maxExecutionsPerDay: 1,
    description: '只监控和提醒，不自动交易'
  },

  // 半自动模式
  semiAuto: {
    enabled: true,
    autoExecute: true,
    onlyTradingSession: true,
    refreshIntervalSec: 15,         // 15秒一次
    maxExecutionsPerDay: 2,
    description: '满足条件自动执行，但有次数限制'
  },

  // 全自动模式
  fullAuto: {
    enabled: true,
    autoExecute: true,
    onlyTradingSession: true,
    refreshIntervalSec: 10,         // 10秒一次
    maxExecutionsPerDay: 3,
    description: '完全自动化，需密切监控'
  }
};

/**
 * 根据回测结果推荐参数
 */
export function recommendParameters(backtestResult) {
  const { summary } = backtestResult;

  const recommendations = [];

  // 1. 如果胜率太低，提高触发线
  if (summary.winRatePct < 60) {
    recommendations.push({
      parameter: 'triggerSpreadPct',
      action: 'increase',
      reason: `当前胜率 ${summary.winRatePct}% 偏低，建议提高触发线以提升胜率`,
      suggestedValue: '+0.1%'
    });
  }

  // 2. 如果交易次数太少，降低触发线或缩短冷却期
  if (summary.trades < 5) {
    recommendations.push({
      parameter: 'triggerSpreadPct',
      action: 'decrease',
      reason: `交易次数仅 ${summary.trades} 次，样本量不足`,
      suggestedValue: '-0.05%'
    });
  }

  // 3. 如果最大回撤过大，增加风控
  if (summary.maxDrawdownPct < -3) {
    recommendations.push({
      parameter: 'maxOrderCash',
      action: 'decrease',
      reason: `最大回撤 ${summary.maxDrawdownPct}% 过大，建议降低单次交易金额`,
      suggestedValue: '-20%'
    });
  }

  // 4. 如果夏普比率优秀，可以适当激进
  if (summary.sharpeRatio > 2.0) {
    recommendations.push({
      parameter: 'cooldownDays',
      action: 'decrease',
      reason: `夏普比率 ${summary.sharpeRatio} 优秀，可缩短冷却期提高资金使用率`,
      suggestedValue: '-1 天'
    });
  }

  // 5. 费用占比检查
  const feeRatio = summary.totalFees / Math.abs(summary.totalProfit);
  if (feeRatio > 0.3) {
    recommendations.push({
      parameter: 'feeBufferPct',
      action: 'increase',
      reason: `手续费占利润 ${(feeRatio * 100).toFixed(1)}%，费用缓冲不足`,
      suggestedValue: '+0.05%'
    });
  }

  return recommendations;
}

/**
 * 参数有效性验证
 */
export function validateStrategyParameters(strategy) {
  const errors = [];
  const warnings = [];

  // 必须参数检查
  if (!strategy.sellSymbol || !strategy.buySymbol) {
    errors.push('缺少交易标的代码');
  }

  // 触发线必须大于观察线
  if (strategy.triggerSpreadPct <= strategy.closeSpreadPct) {
    errors.push('触发线必须大于观察线');
  }

  // 费用缓冲合理性
  if (strategy.feeBufferPct < 0.1) {
    warnings.push(`费用缓冲 ${strategy.feeBufferPct}% 可能不足，建议至少 0.15%`);
  }

  // 单次交易金额合理性
  if (strategy.maxOrderCash > 50000) {
    warnings.push('单次交易金额较大，注意流动性约束');
  }

  // 冷却期合理性
  if (strategy.cooldownDays < 1) {
    warnings.push('冷却期过短，可能导致过度交易');
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * 应用配置预设
 */
export function applyConfigPreset(currentState, presetName) {
  const strategyPreset = RECOMMENDED_STRATEGY_CONFIGS[presetName];
  const accountPreset = ACCOUNT_CONFIGS['standard']; // 默认用标准账户
  const realtimePreset = REALTIME_CONFIGS['semiAuto']; // 默认半自动

  if (!strategyPreset) {
    throw new Error(`Unknown preset: ${presetName}`);
  }

  return {
    ...currentState,
    strategy: {
      ...currentState.strategy,
      ...strategyPreset
    },
    realtime: {
      ...currentState.realtime,
      ...realtimePreset
    },
    // 账户参数一般不自动覆盖，只提供参考
    _accountSuggestion: accountPreset
  };
}
