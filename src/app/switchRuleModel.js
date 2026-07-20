const FUND_CODE_PATTERN = /^\d{6}$/;

export const SWITCH_RULE_SCHEMA_VERSION = 2;
export const SWITCH_RULE_MAX_CANDIDATES = 20;

export const DEFAULT_SWITCH_FEE_CONFIG = Object.freeze({
  mode: 'detailed',
  sellCommissionRate: 0.03,
  buyCommissionRate: 0.03,
  minimumCommission: 5,
  otherFee: 0,
  estimatedTotalFee: 20
});

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round((safeNumber(value) + Number.EPSILON) * factor) / factor;
}

export function normalizeFundCode(value) {
  const code = String(value || '').trim().replace(/^(sh|sz|bj)/i, '');
  return FUND_CODE_PATTERN.test(code) ? code : '';
}

export function normalizeCodeList(value, { max = SWITCH_RULE_MAX_CANDIDATES } = {}) {
  const list = Array.isArray(value) ? value : value == null ? [] : [value];
  return Array.from(new Set(list.map(normalizeFundCode).filter(Boolean))).slice(0, max);
}

export function normalizeFeeConfig(input = {}) {
  const mode = input?.mode === 'estimated_total' ? 'estimated_total' : 'detailed';
  return {
    mode,
    sellCommissionRate: round(Math.max(0, safeNumber(input?.sellCommissionRate, DEFAULT_SWITCH_FEE_CONFIG.sellCommissionRate)), 4),
    buyCommissionRate: round(Math.max(0, safeNumber(input?.buyCommissionRate, DEFAULT_SWITCH_FEE_CONFIG.buyCommissionRate)), 4),
    minimumCommission: round(Math.max(0, safeNumber(input?.minimumCommission, DEFAULT_SWITCH_FEE_CONFIG.minimumCommission)), 2),
    otherFee: round(Math.max(0, safeNumber(input?.otherFee, DEFAULT_SWITCH_FEE_CONFIG.otherFee)), 2),
    estimatedTotalFee: round(Math.max(0, safeNumber(input?.estimatedTotalFee, DEFAULT_SWITCH_FEE_CONFIG.estimatedTotalFee)), 2)
  };
}

export function validateFeeConfig(input = {}) {
  const errors = {};
  const fee = normalizeFeeConfig(input);
  if (!['detailed', 'estimated_total'].includes(input?.mode)) errors.mode = '请选择费用计算方式';
  for (const [field, label] of [
    ['sellCommissionRate', '卖出手续费'],
    ['buyCommissionRate', '买入手续费']
  ]) {
    const raw = input?.[field];
    if (raw !== undefined && raw !== '' && (!Number.isFinite(Number(raw)) || Number(raw) < 0)) errors[field] = `${label}不能为负数`;
    if (raw !== undefined && raw !== '' && String(raw).includes('.') && String(raw).split('.')[1].length > 4) errors[field] = `${label}最多保留四位小数`;
  }
  for (const [field, label] of [['minimumCommission', '最低佣金'], ['otherFee', '其他费用'], ['estimatedTotalFee', '预计总费用']]) {
    const raw = input?.[field];
    if (raw !== undefined && raw !== '' && (!Number.isFinite(Number(raw)) || Number(raw) < 0)) errors[field] = `${label}不能为负数`;
  }
  if (fee.mode === 'estimated_total' && !(fee.estimatedTotalFee >= 0)) errors.estimatedTotalFee = '请输入预计总费用';
  return { valid: Object.keys(errors).length === 0, errors, value: fee };
}

/**
 * App stores percentage points (0.03 means 0.03%). The backtest simulator
 * consumes decimal rates (0.0003). Keep this conversion in one place.
 */
export function toSwitchBacktestCosts(input = {}, notional = 0) {
  const fee = normalizeFeeConfig(input);
  const amount = Math.max(0, safeNumber(notional));
  if (fee.mode === 'estimated_total') {
    return {
      sellFeeRate: 0,
      buyFeeRate: 0,
      minimumCommission: 0,
      otherFee: 0,
      fixedPerSwitchFee: fee.estimatedTotalFee,
      estimatedCost: fee.estimatedTotalFee
    };
  }
  const sell = Math.max(fee.minimumCommission, amount * fee.sellCommissionRate / 100);
  const buy = Math.max(fee.minimumCommission, amount * fee.buyCommissionRate / 100);
  return {
    sellFeeRate: fee.sellCommissionRate / 100,
    buyFeeRate: fee.buyCommissionRate / 100,
    minimumCommission: fee.minimumCommission,
    otherFee: fee.otherFee,
    fixedPerSwitchFee: 0,
    estimatedCost: round(sell + buy + fee.otherFee, 2)
  };
}

export function estimateSwitchCost(input = {}, notional = 0) {
  const costs = toSwitchBacktestCosts(input, notional);
  return round(costs.estimatedCost, 2);
}

export function normalizePremiumClass(input = {}, codes = []) {
  const allowed = new Set(normalizeCodeList(codes, { max: 100 }));
  const source = input && typeof input === 'object' ? input : {};
  return Object.fromEntries(Object.entries(source)
    .map(([code, value]) => [normalizeFundCode(code), String(value || '').trim().toUpperCase()])
    .filter(([code, value]) => code && allowed.has(code) && (value === 'H' || value === 'L')));
}

export function normalizeRuntimeConfig(input = {}, codes = []) {
  const validCodes = normalizeCodeList(codes, { max: 100 });
  const runtime = input && typeof input === 'object' ? input : {};
  const premiumClass = normalizePremiumClass(runtime.premiumClass, validCodes);
  const side = runtime.holdingSideAtRecommendation === 'low' ? 'low' : 'high';
  const operator = runtime.triggerOperatorAtRecommendation === 'lte' ? 'lte' : 'gte';
  const sellLower = round(Math.max(0, safeNumber(runtime.intraSellLowerPct, 0)), 4);
  const buyOther = round(Math.max(0, safeNumber(runtime.intraBuyOtherPct, 0)), 4);
  return {
    recommendationId: String(runtime.recommendationId || '').trim(),
    premiumClass,
    premiumClassUpdatedAt: String(runtime.premiumClassUpdatedAt || '').trim(),
    classificationSource: String(runtime.classificationSource || '').trim(),
    classificationStatus: runtime.classificationStatus === 'stale' ? 'stale' : 'fresh',
    classificationWarning: String(runtime.classificationWarning || '').trim(),
    intraSellLowerPct: sellLower,
    intraBuyOtherPct: buyOther,
    holdingSideAtRecommendation: side,
    triggerOperatorAtRecommendation: operator
  };
}

export function isRuntimeConfigComplete(runtime = {}, codes = []) {
  const normalized = normalizeRuntimeConfig(runtime, codes);
  const codesList = normalizeCodeList(codes, { max: 100 });
  return codesList.length >= 2
    && codesList.every((code) => normalized.premiumClass[code] === 'H' || normalized.premiumClass[code] === 'L')
    && normalized.intraBuyOtherPct > normalized.intraSellLowerPct;
}

export function resolveRuleThreshold(rule = {}) {
  const runtime = normalizeRuntimeConfig(rule.runtimeConfig || rule, [
    rule.holdingFundCode,
    ...(rule.candidateFundCodes || rule.enabledCodes || []),
    ...(rule.benchmarkCodes || [])
  ]);
  const side = runtime.premiumClass[normalizeFundCode(rule.holdingFundCode)] === 'L' ? 'low' : runtime.holdingSideAtRecommendation;
  const operator = side === 'low' ? 'lte' : 'gte';
  const recommended = side === 'low' ? runtime.intraSellLowerPct : runtime.intraBuyOtherPct;
  const thresholdValue = rule.thresholdMode === 'fixed' && Number.isFinite(Number(rule.thresholdValue))
    ? round(Math.max(0, Number(rule.thresholdValue)), 4)
    : recommended;
  return {
    side,
    operator,
    thresholdValue,
    intraSellLowerPct: side === 'low' ? thresholdValue : runtime.intraSellLowerPct,
    intraBuyOtherPct: side === 'high' ? thresholdValue : runtime.intraBuyOtherPct,
    runtime
  };
}

export function getSwitchConditionText(rule = {}) {
  const { side, thresholdValue } = resolveRuleThreshold(rule);
  const value = Number(thresholdValue).toFixed(2);
  return side === 'low'
    ? `当切回候选基金的价差收窄到 ${value}% 以内时提醒`
    : `当当前持仓比同类候选基金贵 ${value}% 时提醒`;
}

export function getSwitchStatusText(status = '', { maxAdvantage = null } = {}) {
  if (status === 'classification_expired') return '需要重新分析';
  if (status === 'pending_classification') return '等待分析';
  if (status === 'stale') return '使用上次分析结果';
  if (status === 'triggered') return '已达到提醒条件';
  if (Number.isFinite(Number(maxAdvantage)) && Number(maxAdvantage) > 0) return '接近提醒';
  return '尚未触发';
}

export function normalizeSwitchRuleModel(input = {}, index = 0) {
  const holdingFundCode = normalizeFundCode(input.holdingFundCode || input.benchmarkCodes?.[0]);
  const candidateFundCodes = normalizeCodeList(input.candidateFundCodes || input.enabledCodes)
    .filter((code) => code !== holdingFundCode);
  const codes = [holdingFundCode, ...candidateFundCodes];
  const runtimeConfig = normalizeRuntimeConfig(input.runtimeConfig || input, codes);
  const threshold = resolveRuleThreshold({ ...input, holdingFundCode, candidateFundCodes, runtimeConfig });
  return {
    id: String(input.id || input.ruleId || `rule-${index + 1}`).trim() || `rule-${index + 1}`,
    name: String(input.name || input.ruleName || `${holdingFundCode || '基金'}切换方案`).trim(),
    enabled: input.enabled !== false,
    holdingFundCode,
    holdingFundName: String(input.holdingFundName || input.name || '').trim(),
    holdingQuantity: Number.isFinite(Number(input.holdingQuantity)) ? Number(input.holdingQuantity) : undefined,
    thresholdMode: input.thresholdMode === 'fixed' ? 'fixed' : 'backtest',
    thresholdValue: threshold.thresholdValue,
    backtestRecommendedValue: Number.isFinite(Number(input.backtestRecommendedValue)) ? Number(input.backtestRecommendedValue) : threshold.thresholdValue,
    feeConfig: normalizeFeeConfig(input.feeConfig),
    candidateFundCodes,
    runtimeConfig,
    internalHoldingSide: threshold.side,
    triggerOperator: threshold.operator,
    lastResult: input.lastResult && typeof input.lastResult === 'object' ? input.lastResult : null,
    createdAt: String(input.createdAt || '').trim(),
    updatedAt: String(input.updatedAt || '').trim()
  };
}

export function hasDuplicateHoldingRule(rules = []) {
  const seen = new Set();
  return rules.some((rule) => {
    const code = normalizeFundCode(rule?.holdingFundCode || rule?.benchmarkCodes?.[0]);
    if (!code) return false;
    if (seen.has(code)) return true;
    seen.add(code);
    return false;
  });
}
