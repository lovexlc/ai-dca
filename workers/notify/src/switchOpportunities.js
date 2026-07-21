import {
  DEFAULT_SWITCH_HIGH_CODES,
  normalizeSwitchConfig
} from './switchStrategy.js';
import { SWITCH_CANDIDATE_CATALOG } from './switchRecommendation.js';

export const SWITCH_OPPORTUNITY_TTL_MS = 3 * 60 * 1000;
export const DEFAULT_HIGH_TO_LOW_THRESHOLD = 3;
export const DEFAULT_LOW_TO_HIGH_THRESHOLD = 1;

const STATUS_RANK = Object.freeze({
  triggered: 0,
  very_near: 1,
  near: 2,
  watching: 3,
  no_data: 4
});

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, digits = 4) {
  const number = finite(value);
  if (number === null) return null;
  const factor = 10 ** digits;
  return Math.round((number + Number.EPSILON) * factor) / factor;
}

function clamp(value, min = 0, max = 100) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function normalizeCode(value) {
  const code = String(value || '').trim().replace(/^(sh|sz|bj)/i, '');
  return /^\d{6}$/.test(code) ? code : '';
}

function uniqueCodes(values = []) {
  return Array.from(new Set((Array.isArray(values) ? values : []).map(normalizeCode).filter(Boolean)));
}

function metricPremium(metric = {}) {
  const explicit = finite(metric?.premiumPercent ?? metric?.premiumPct);
  if (explicit !== null) return explicit;
  const price = finite(metric?.price ?? metric?.currentPrice ?? metric?.close);
  const nav = finite(metric?.latestNav ?? metric?.navBase ?? metric?.iopv ?? metric?.nav);
  return price !== null && price > 0 && nav !== null && nav > 0 ? ((price - nav) / nav) * 100 : null;
}

function catalogByCode(catalog = SWITCH_CANDIDATE_CATALOG) {
  return new Map((Array.isArray(catalog) ? catalog : []).map((item) => [normalizeCode(item?.code), item]));
}

export function calculateSwitchOpportunityProgress({
  direction,
  currentAdvantagePct,
  thresholdPct,
  referenceSpreadPct
} = {}) {
  const current = finite(currentAdvantagePct);
  const threshold = finite(thresholdPct);
  if (current === null || threshold === null) {
    return { distancePct: null, progressPct: 0, status: 'no_data' };
  }
  const distance = direction === 'low_to_high' ? current - threshold : threshold - current;
  let progress;
  if (direction === 'low_to_high') {
    const reference = finite(referenceSpreadPct);
    const safeReference = reference !== null && reference > threshold ? reference : Math.max(3, threshold + 1);
    progress = ((safeReference - current) / (safeReference - threshold)) * 100;
  } else {
    progress = threshold > 0 ? (current / threshold) * 100 : distance <= 0 ? 100 : 0;
  }
  const status = distance <= 0
    ? 'triggered'
    : distance <= 0.3
      ? 'very_near'
      : distance <= 1
        ? 'near'
        : 'watching';
  return { distancePct: round(distance), progressPct: round(clamp(progress), 2), status };
}

function thresholdForRule(rule, direction) {
  if (!rule) return null;
  const operator = rule?.runtimeConfig?.triggerOperatorAtRecommendation || rule?.triggerOperator;
  if (direction === 'low_to_high' && operator !== 'lte') return null;
  if (direction === 'high_to_low' && operator === 'lte') return null;
  return finite(rule?.thresholdValue ?? rule?.backtestRecommendedValue);
}

function resolveThreshold({ rule, direction, marketThresholds = {} } = {}) {
  const existing = thresholdForRule(rule, direction);
  if (existing !== null) {
    return {
      thresholdPct: existing,
      thresholdSource: rule?.backtestRecommendedValue != null ? 'existing_rule' : 'existing_rule'
    };
  }
  const marketValue = finite(
    direction === 'low_to_high' ? marketThresholds?.lowToHigh : marketThresholds?.highToLow
  );
  if (marketValue !== null) return { thresholdPct: marketValue, thresholdSource: 'market_default' };
  return {
    thresholdPct: direction === 'low_to_high' ? DEFAULT_LOW_TO_HIGH_THRESHOLD : DEFAULT_HIGH_TO_LOW_THRESHOLD,
    thresholdSource: 'fallback'
  };
}

function estimatedCost(rule) {
  const fee = rule?.feeConfig || {};
  if (fee.mode === 'estimated_total') return finite(fee.estimatedTotalFee);
  const notional = finite(rule?.holdingNotional);
  if (notional === null || notional <= 0) return null;
  const minimum = Math.max(0, Number(fee.minimumCommission) || 0);
  const sell = Math.max(minimum, (notional * Math.max(0, Number(fee.sellCommissionRate) || 0)) / 100);
  const buy = Math.max(minimum, (notional * Math.max(0, Number(fee.buyCommissionRate) || 0)) / 100);
  return round(sell + buy + Math.max(0, Number(fee.otherFee) || 0), 2);
}

function opportunityId(sourceCode, targetCode, direction) {
  return `opp_${sourceCode}_${targetCode}_${direction}`;
}

function ruleMatchesPair(rule, sourceCode, targetCode) {
  const source = normalizeCode(rule?.sourceFundCode || rule?.holdingFundCode || rule?.benchmarkCodes?.[0]);
  const explicitTarget = normalizeCode(rule?.targetFundCode || rule?.preferredCandidateCode);
  const candidates = uniqueCodes([
    rule?.targetFundCode,
    ...(rule?.candidateFundCodes || []),
    ...(rule?.enabledCodes || [])
  ]);
  if (rule?.ruleType === 'market_watch' && explicitTarget) {
    const samePair = new Set([source, explicitTarget]);
    if (samePair.has(sourceCode) && samePair.has(targetCode)) {
      return { rule, containsTarget: true };
    }
  }
  return source === sourceCode ? { rule, containsTarget: candidates.includes(targetCode) } : null;
}

function buildOpportunity({
  mode,
  source,
  target,
  direction,
  threshold,
  rules,
  evaluatedAt,
  holdingQuantity,
  sameIndexCandidateCodes,
  referenceSpreadPct = null
}) {
  const sourcePremium = metricPremium(source.metric);
  const targetPremium = metricPremium(target.metric);
  const highPremium = direction === 'high_to_low' ? sourcePremium : targetPremium;
  const lowPremium = direction === 'high_to_low' ? targetPremium : sourcePremium;
  const currentAdvantagePct = highPremium === null || lowPremium === null ? null : round(highPremium - lowPremium);
  const progress = calculateSwitchOpportunityProgress({
    direction,
    currentAdvantagePct,
    thresholdPct: threshold.thresholdPct,
    referenceSpreadPct
  });
  const existing = (rules || []).map((rule) => ruleMatchesPair(rule, source.code, target.code)).find(Boolean) || null;
  const sourceRule = existing?.rule || (rules || []).find(
    (rule) => normalizeCode(rule?.holdingFundCode || rule?.sourceFundCode || rule?.benchmarkCodes?.[0]) === source.code
  );
  return {
    id: opportunityId(source.code, target.code, direction),
    mode,
    sourceFund: { code: source.code, name: source.name, premiumPct: round(sourcePremium) },
    targetFund: { code: target.code, name: target.name, premiumPct: round(targetPremium) },
    indexKey: source.indexKey,
    internalDirection: direction,
    currentAdvantagePct,
    thresholdPct: round(threshold.thresholdPct),
    distancePct: progress.distancePct,
    progressPct: progress.progressPct,
    status: progress.status,
    thresholdSource: threshold.thresholdSource,
    holdingQuantity: mode === 'holding' ? finite(holdingQuantity) ?? undefined : undefined,
    estimatedSwitchCost: existing ? estimatedCost(existing.rule) : null,
    sameIndexCandidateCodes: uniqueCodes(sameIndexCandidateCodes),
    existingRule: existing
      ? {
          ruleId: String(existing.rule?.id || ''),
          ruleType: existing.rule?.ruleType === 'market_watch' ? 'market_watch' : 'holding_switch',
          containsTarget: existing.containsTarget
        }
      : null,
    canCreateRule: !existing?.containsTarget,
    evaluatedAt,
    backtestAnnualizedReturnPct: finite(sourceRule?.lastResult?.backtest?.annualizedReturnPct),
    backtestWinRatePct: finite(sourceRule?.lastResult?.backtest?.winRatePct),
    targetTurnover: finite(target?.metric?.turnover ?? target?.metric?.amount)
  };
}

function fundRecord(item, metrics, catalogMap) {
  const code = normalizeCode(item?.code || item?.fundCode);
  const catalog = catalogMap.get(code);
  if (!code || !catalog) return null;
  return {
    code,
    name: String(item?.name || item?.fundName || metrics?.[code]?.name || catalog.name || '').trim(),
    indexKey: catalog.indexKey,
    metric: metrics?.[code] || {}
  };
}

function opportunitySort(a, b) {
  const status = (STATUS_RANK[a?.status] ?? 99) - (STATUS_RANK[b?.status] ?? 99);
  if (status) return status;
  const distance = Math.abs(finite(a?.distancePct) ?? Infinity) - Math.abs(finite(b?.distancePct) ?? Infinity);
  if (distance) return distance;
  const annualized = (finite(b?.backtestAnnualizedReturnPct) ?? -Infinity) - (finite(a?.backtestAnnualizedReturnPct) ?? -Infinity);
  if (Number.isFinite(annualized) && annualized) return annualized;
  const winRate = (finite(b?.backtestWinRatePct) ?? -Infinity) - (finite(a?.backtestWinRatePct) ?? -Infinity);
  if (Number.isFinite(winRate) && winRate) return winRate;
  const turnover = (finite(b?.targetTurnover) ?? 0) - (finite(a?.targetTurnover) ?? 0);
  if (turnover) return turnover;
  return Date.parse(b?.evaluatedAt || '') - Date.parse(a?.evaluatedAt || '');
}

export function sortSwitchOpportunities(items = []) {
  return [...items].sort(opportunitySort);
}

export function generateSwitchOpportunities({
  mode = 'auto',
  holdings = [],
  metrics = {},
  config = {},
  catalog = SWITCH_CANDIDATE_CATALOG,
  limit = 10,
  evaluatedAt = new Date().toISOString(),
  marketThresholds = {}
} = {}) {
  const catalogMap = catalogByCode(catalog);
  const funds = [...catalogMap.values()]
    .map((item) => fundRecord(item, metrics, catalogMap))
    .filter(Boolean);
  const normalizedConfig = normalizeSwitchConfig(config || { enabled: false, rules: [] });
  const rules = normalizedConfig.rules || [];
  const positiveHoldings = (Array.isArray(holdings) ? holdings : [])
    .map((item) => ({ ...item, fundCode: normalizeCode(item?.fundCode || item?.code) }))
    .filter((item) => item.fundCode && Number(item?.quantity ?? item?.holdingQuantity) > 0 && catalogMap.has(item.fundCode));
  const resolvedMode = mode === 'holding' || mode === 'market'
    ? mode
    : positiveHoldings.length
      ? 'holding'
      : 'market';
  const highSet = new Set(DEFAULT_SWITCH_HIGH_CODES);
  const opportunities = [];

  if (resolvedMode === 'holding') {
    for (const holding of positiveHoldings) {
      const source = fundRecord(
        { code: holding.fundCode, name: holding.fundName || holding.name },
        metrics,
        catalogMap
      );
      if (!source) continue;
      const rule = rules.find((item) => normalizeCode(item?.holdingFundCode || item?.benchmarkCodes?.[0]) === source.code);
      const ruleClass = rule?.premiumClass && typeof rule.premiumClass === 'object'
        ? rule.premiumClass
        : rule?.runtimeConfig?.premiumClass;
      const classify = (code) => ruleClass?.[code] === 'H' || ruleClass?.[code] === 'L'
        ? ruleClass[code]
        : highSet.has(code) ? 'H' : 'L';
      const sourceClass = classify(source.code);
      const direction = sourceClass === 'H' ? 'high_to_low' : 'low_to_high';
      const candidates = funds.filter(
        (item) => item.indexKey === source.indexKey && item.code !== source.code && classify(item.code) !== sourceClass
      );
      const threshold = resolveThreshold({ rule, direction, marketThresholds });
      const built = candidates.map((target) => buildOpportunity({
        mode: 'holding',
        source,
        target,
        direction,
        threshold,
        rules,
        evaluatedAt,
        holdingQuantity: holding.quantity ?? holding.holdingQuantity,
        sameIndexCandidateCodes: candidates.map((item) => item.code),
        referenceSpreadPct: finite(rule?.referenceSpreadPct ?? rule?.runtimeConfig?.referenceSpreadPct)
      }));
      const best = sortSwitchOpportunities(built)[0];
      if (best) opportunities.push({ ...best, alternatives: sortSwitchOpportunities(built).slice(1) });
    }
  } else {
    const byIndex = Map.groupBy
      ? Map.groupBy(funds, (item) => item.indexKey)
      : funds.reduce((map, item) => map.set(item.indexKey, [...(map.get(item.indexKey) || []), item]), new Map());
    for (const group of byIndex.values()) {
      const highs = group.filter((item) => highSet.has(item.code));
      const lows = group.filter((item) => !highSet.has(item.code));
      for (const high of highs) {
        for (const low of lows) {
          const highRule = rules.find((item) => normalizeCode(item?.holdingFundCode || item?.sourceFundCode) === high.code);
          const lowRule = rules.find((item) => normalizeCode(item?.holdingFundCode || item?.sourceFundCode) === low.code);
          const highOpportunity = buildOpportunity({
            mode: 'market', source: high, target: low, direction: 'high_to_low',
            threshold: resolveThreshold({ rule: highRule, direction: 'high_to_low', marketThresholds }),
            rules, evaluatedAt, sameIndexCandidateCodes: lows.map((item) => item.code)
          });
          const lowOpportunity = buildOpportunity({
            mode: 'market', source: low, target: high, direction: 'low_to_high',
            threshold: resolveThreshold({ rule: lowRule, direction: 'low_to_high', marketThresholds }),
            rules, evaluatedAt, sameIndexCandidateCodes: highs.map((item) => item.code)
          });
          opportunities.push(sortSwitchOpportunities([highOpportunity, lowOpportunity])[0]);
        }
      }
    }
  }

  const max = Math.max(1, Math.min(10, Number(limit) || 10));
  return {
    mode: resolvedMode,
    holdingCount: positiveHoldings.length,
    generatedAt: evaluatedAt,
    opportunities: sortSwitchOpportunities(opportunities).slice(0, max)
  };
}

export function collectOpportunityCodes(holdings = [], catalog = SWITCH_CANDIDATE_CATALOG) {
  const holdingCodes = (Array.isArray(holdings) ? holdings : [])
    .filter((item) => Number(item?.quantity ?? item?.holdingQuantity) > 0)
    .map((item) => normalizeCode(item?.fundCode || item?.code));
  const indexes = new Set(
    catalog.filter((item) => holdingCodes.includes(item.code)).map((item) => item.indexKey)
  );
  const scoped = indexes.size ? catalog.filter((item) => indexes.has(item.indexKey)) : catalog;
  return uniqueCodes(scoped.map((item) => item.code));
}

export function isOpportunityFresh(opportunity, now = Date.now()) {
  const evaluatedAt = Date.parse(String(opportunity?.evaluatedAt || ''));
  return Number.isFinite(evaluatedAt) && now - evaluatedAt <= SWITCH_OPPORTUNITY_TTL_MS;
}
