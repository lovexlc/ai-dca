const FUND_CODE_PATTERN = /^\d{6}$/;

export const SWITCH_RULE_SCHEMA_VERSION = 2;
export const SWITCH_RULE_MAX_CANDIDATES = 20;
export const DEFAULT_SWITCH_HIGH_CODES = Object.freeze(['159501', '513100']);
export const DEFAULT_SWITCH_LOW_THRESHOLD = 1;
export const DEFAULT_SWITCH_HIGH_THRESHOLD = 3;
export const SWITCH_THRESHOLD_MIN = -1;
export const SWITCH_THRESHOLD_MAX = 5;

export const DEFAULT_SWITCH_FEE_CONFIG = Object.freeze({
  mode: 'detailed',
  // App percentage points: 0.005 means 0.005% = 万 0.5
  sellCommissionRate: 0.005,
  buyCommissionRate: 0.005,
  minimumCommission: 0,
  otherFee: 0,
  estimatedTotalFee: 20
});

export const SWITCH_THRESHOLD_RANGES = Object.freeze({
  gte: Object.freeze({ min: SWITCH_THRESHOLD_MIN, max: SWITCH_THRESHOLD_MAX, defaultValue: 2.65 }),
  lte: Object.freeze({ min: SWITCH_THRESHOLD_MIN, max: SWITCH_THRESHOLD_MAX, defaultValue: DEFAULT_SWITCH_LOW_THRESHOLD })
});

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round((safeNumber(value) + Number.EPSILON) * factor) / factor;
}

function normalizeSwitchThreshold(value, fallback) {
  return round(
    Math.min(SWITCH_THRESHOLD_MAX, Math.max(SWITCH_THRESHOLD_MIN, safeNumber(value, fallback))),
    4
  );
}


/**
 * Convert app commission percentage points to 万 x display.
 * Example: 0.005 (%) → 万0.5；0.03 (%) → 万3
 */
export function formatCommissionRateAsWan(value) {
  if (value === undefined || value === null || value === '') return '万—';
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return '万—';
  const wan = number * 100;
  const text = String(Number(wan.toFixed(4)));
  return `万${text}`;
}

export function normalizeFundCode(value) {
  const code = String(value || '')
    .trim()
    .replace(/^(sh|sz|bj)/i, '');
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
    sellCommissionRate: round(
      Math.max(0, safeNumber(input?.sellCommissionRate, DEFAULT_SWITCH_FEE_CONFIG.sellCommissionRate)),
      4
    ),
    buyCommissionRate: round(
      Math.max(0, safeNumber(input?.buyCommissionRate, DEFAULT_SWITCH_FEE_CONFIG.buyCommissionRate)),
      4
    ),
    minimumCommission: round(
      Math.max(0, safeNumber(input?.minimumCommission, DEFAULT_SWITCH_FEE_CONFIG.minimumCommission)),
      2
    ),
    otherFee: round(Math.max(0, safeNumber(input?.otherFee, DEFAULT_SWITCH_FEE_CONFIG.otherFee)), 2),
    estimatedTotalFee: round(
      Math.max(0, safeNumber(input?.estimatedTotalFee, DEFAULT_SWITCH_FEE_CONFIG.estimatedTotalFee)),
      2
    )
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
    if (raw !== undefined && raw !== '' && (!Number.isFinite(Number(raw)) || Number(raw) < 0))
      errors[field] = `${label}不能为负数`;
    if (raw !== undefined && raw !== '' && String(raw).includes('.') && String(raw).split('.')[1].length > 4)
      errors[field] = `${label}最多保留四位小数`;
  }
  for (const [field, label] of [
    ['minimumCommission', '最低佣金'],
    ['otherFee', '其他费用'],
    ['estimatedTotalFee', '预计总费用']
  ]) {
    const raw = input?.[field];
    if (raw !== undefined && raw !== '' && (!Number.isFinite(Number(raw)) || Number(raw) < 0))
      errors[field] = `${label}不能为负数`;
  }
  if (fee.mode === 'estimated_total' && !(fee.estimatedTotalFee >= 0))
    errors.estimatedTotalFee = '请输入预计总费用';
  return { valid: Object.keys(errors).length === 0, errors, value: fee };
}

export function validateThresholdValue(value, operator = 'gte') {
  const range = SWITCH_THRESHOLD_RANGES[operator] || SWITCH_THRESHOLD_RANGES.gte;
  const errors = {};
  const raw = value;
  const number = Number(value);
  if (raw === undefined || raw === null || raw === '' || !Number.isFinite(number)) {
    errors.thresholdValue = '请输入提醒值';
  } else if (number < range.min || number > range.max) {
    errors.thresholdValue = `提醒值应在 ${range.min}%–${range.max}% 之间`;
  }
  return {
    valid: Object.keys(errors).length === 0,
    errors,
    value: Object.keys(errors).length ? null : round(number, 4),
    range
  };
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
  const sell = Math.max(fee.minimumCommission, (amount * fee.sellCommissionRate) / 100);
  const buy = Math.max(fee.minimumCommission, (amount * fee.buyCommissionRate) / 100);
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
  return Object.fromEntries(
    Object.entries(source)
      .map(([code, value]) => [
        normalizeFundCode(code),
        String(value || '')
          .trim()
          .toUpperCase()
      ])
      .filter(([code, value]) => code && allowed.has(code) && (value === 'H' || value === 'L'))
  );
}

export function normalizeRuntimeConfig(input = {}, codes = []) {
  const validCodes = normalizeCodeList(codes, { max: 100 });
  const runtime = input && typeof input === 'object' ? input : {};
  const rawPremiumClass = normalizePremiumClass(runtime.premiumClass, validCodes);
  const hasConfiguredHighCodes = Array.isArray(runtime.highPremiumCodes);
  const rawHighCodes = hasConfiguredHighCodes
    ? normalizeCodeList(runtime.highPremiumCodes, { max: 100 })
    : [];
  const legacyHighCodes = Object.entries(rawPremiumClass)
    .filter(([, value]) => value === 'H')
    .map(([code]) => code);
  const classificationSource = String(runtime.classificationSource || '').toLowerCase();
  const legacyGeneratedClassification = ['worker', 'backtest', 'runtime'].some((token) =>
    classificationSource.includes(token)
  );
  const explicitlyDefaultClassification = runtime.premiumClassSource === 'default';
  const hasUserClassification =
    (!explicitlyDefaultClassification && hasConfiguredHighCodes) ||
    (legacyHighCodes.length > 0 && (runtime.premiumClassSource === 'user' || !legacyGeneratedClassification));
  const highPremiumCodes = (hasUserClassification ? rawHighCodes : DEFAULT_SWITCH_HIGH_CODES).filter((code) =>
    validCodes.includes(code)
  );
  const highSet = new Set(highPremiumCodes.length ? highPremiumCodes : hasUserClassification ? legacyHighCodes : []);
  const premiumClass = Object.fromEntries(validCodes.map((code) => [code, highSet.has(code) ? 'H' : 'L']));
  const holdingCode = normalizeFundCode(runtime.holdingFundCode || validCodes[0]);
  const side = premiumClass[holdingCode] === 'L' ? 'low' : 'high';
  const operator = side === 'low' ? 'lte' : 'gte';
  const sellLower = normalizeSwitchThreshold(runtime.intraSellLowerPct, DEFAULT_SWITCH_LOW_THRESHOLD);
  const buyOther = normalizeSwitchThreshold(runtime.intraBuyOtherPct, DEFAULT_SWITCH_HIGH_THRESHOLD);
  return {
    recommendationId: String(runtime.recommendationId || '').trim(),
    premiumClass,
    highPremiumCodes,
    premiumClassSource: hasUserClassification ? 'user' : 'default',
    premiumClassUpdatedAt: String(runtime.premiumClassUpdatedAt || '').trim(),
    classificationSource: String(runtime.classificationSource || '').trim(),
    classificationStatus: ['stale', 'pending_classification', 'classification_expired'].includes(
      runtime.classificationStatus
    )
      ? runtime.classificationStatus
      : 'fresh',
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
  return (
    codesList.length >= 2 &&
    codesList.every(
      (code) => normalized.premiumClass[code] === 'H' || normalized.premiumClass[code] === 'L'
    )
  );
}

export function resolveRuleThreshold(rule = {}) {
  const runtime = normalizeRuntimeConfig(rule.runtimeConfig || rule, [
    rule.holdingFundCode,
    ...(rule.candidateFundCodes || rule.enabledCodes || []),
    ...(rule.benchmarkCodes || [])
  ]);
  const side =
    runtime.premiumClass[normalizeFundCode(rule.holdingFundCode)] === 'L'
      ? 'low'
      : runtime.holdingSideAtRecommendation;
  const operator = side === 'low' ? 'lte' : 'gte';
  const recommended = side === 'low' ? runtime.intraSellLowerPct : runtime.intraBuyOtherPct;
  const thresholdValue =
    rule.thresholdMode === 'fixed' && Number.isFinite(Number(rule.thresholdValue))
      ? normalizeSwitchThreshold(rule.thresholdValue, recommended)
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
    ? `当切回同类候选基金的价差收窄到 ${value}% 以内时提醒`
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
  const candidateFundCodes = normalizeCodeList(input.candidateFundCodes || input.enabledCodes).filter(
    (code) => code !== holdingFundCode
  );
  const codes = [holdingFundCode, ...candidateFundCodes];
  const runtimeConfig = normalizeRuntimeConfig(input.runtimeConfig || input, codes);
  const threshold = resolveRuleThreshold({ ...input, holdingFundCode, candidateFundCodes, runtimeConfig });
  const recommendationStatus = ['valid', 'fee_changed', 'expired'].includes(input.recommendationStatus)
    ? input.recommendationStatus
    : 'valid';
  const ruleType = input.ruleType === 'market_watch' ? 'market_watch' : 'holding_switch';
  return {
    id: String(input.id || input.ruleId || `rule-${index + 1}`).trim() || `rule-${index + 1}`,
    name: String(input.name || input.ruleName || `${holdingFundCode || '基金'}切换方案`).trim(),
    enabled: input.enabled !== false,
    ruleType,
    holdingFundCode,
    holdingFundName: String(input.holdingFundName || input.name || '').trim(),
    holdingQuantity: Number.isFinite(Number(input.holdingQuantity))
      ? Number(input.holdingQuantity)
      : undefined,
    holdingNotional: Number.isFinite(Number(input.holdingNotional)) && Number(input.holdingNotional) > 0
      ? Number(input.holdingNotional)
      : undefined,
    thresholdMode: input.thresholdMode === 'fixed' ? 'fixed' : 'backtest',
    thresholdValue: threshold.thresholdValue,
    backtestRecommendedValue:
      input.backtestRecommendedValue === null
        ? null
        : Number.isFinite(Number(input.backtestRecommendedValue))
          ? Number(input.backtestRecommendedValue)
          : threshold.thresholdValue,
    recommendationStatus,
    feeConfig: normalizeFeeConfig(input.feeConfig),
    candidateFundCodes,
    sourceFundCode: normalizeFundCode(input.sourceFundCode || holdingFundCode),
    targetFundCode: normalizeFundCode(input.targetFundCode || input.preferredCandidateCode),
    preferredCandidateCode: normalizeFundCode(input.preferredCandidateCode || input.targetFundCode),
    sourceOpportunityId: String(input.sourceOpportunityId || '').trim().slice(0, 120),
    createdFrom: input.createdFrom === 'opportunity' ? 'opportunity' : 'manual',
    thresholdSource: ['existing_rule', 'backtest', 'market_default', 'fallback'].includes(input.thresholdSource)
      ? input.thresholdSource
      : input.thresholdMode === 'backtest'
        ? 'backtest'
        : 'fallback',
    referenceSpreadPct: Number.isFinite(Number(input.referenceSpreadPct))
      ? Number(input.referenceSpreadPct)
      : undefined,
    highPremiumCodes: runtimeConfig.highPremiumCodes,
    premiumClassSource: runtimeConfig.premiumClassSource,
    runtimeConfig,
    internalHoldingSide: threshold.side,
    triggerOperator: threshold.operator,
    lastResult: input.lastResult && typeof input.lastResult === 'object' ? input.lastResult : null,
    createdAt: String(input.createdAt || '').trim(),
    updatedAt: String(input.updatedAt || '').trim()
  };
}

/**
 * Rebind a monitoring rule to another fund already present in its candidate pool.
 * This only changes the monitoring target; it never creates ledger transactions.
 */
export function rebindSwitchRuleToCandidate(rule = {}, candidate = {}, holding = {}) {
  const model = normalizeSwitchRuleModel(rule);
  const targetCode = normalizeFundCode(candidate?.code || candidate?.fundCode);
  if (!targetCode || targetCode === model.holdingFundCode) return model;

  // A rebound plan is intentionally a two-fund pair. Keeping the previous
  // pool would allow the next run to recommend a third fund and charge a
  // second switch fee immediately after the user-selected switch.
  const candidateFundCodes = model.holdingFundCode ? [model.holdingFundCode] : [];
  const codes = [targetCode, ...candidateFundCodes];
  const runtimeConfig = normalizeRuntimeConfig(
    {
      ...model.runtimeConfig,
      holdingFundCode: targetCode,
      classificationSource: 'rebind',
      classificationStatus: 'fresh'
    },
    codes
  );
  const holdingQuantity = Number.isFinite(Number(holding?.totalShares))
    ? Number(holding.totalShares)
    : undefined;
  const holdingNotional = Number.isFinite(Number(holding?.marketValue)) && Number(holding.marketValue) > 0
    ? Number(holding.marketValue)
    : undefined;

  return normalizeSwitchRuleModel({
    ...model,
    holdingFundCode: targetCode,
    holdingFundName: String(candidate?.name || candidate?.fundName || targetCode).trim(),
    holdingQuantity,
    holdingNotional,
    candidateFundCodes,
    sourceFundCode: targetCode,
    targetFundCode: '',
    preferredCandidateCode: '',
    referenceSpreadPct: undefined,
    recommendationStatus: 'valid',
    backtestRecommendedValue: model.thresholdMode === 'fixed' ? null : model.backtestRecommendedValue,
    lastResult: null,
    runtimeConfig
  });
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
