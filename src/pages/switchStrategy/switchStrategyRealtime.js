import {
  normalizeSwitchRuleModel,
  toSwitchBacktestCosts
} from '../../app/switchRuleModel.js';

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, digits = 4) {
  const number = finiteNumber(value);
  if (number === null) return null;
  const factor = 10 ** digits;
  return Math.round(number * factor) / factor;
}

function normalizeCode(value) {
  return String(value || '').trim();
}

function ruleCodes(rule = {}) {
  const model = normalizeSwitchRuleModel(rule);
  return [
    model.holdingFundCode,
    ...(Array.isArray(model.candidateFundCodes) ? model.candidateFundCodes : []),
    ...(Array.isArray(rule?.benchmarkCodes) ? rule.benchmarkCodes : []),
    ...(Array.isArray(rule?.enabledCodes) ? rule.enabledCodes : []),
    ...Object.keys(model.runtimeConfig?.premiumClass || {})
  ].map(normalizeCode).filter(Boolean);
}

export function getSwitchRealtimeSymbols(rules = []) {
  return Array.from(new Set(
    (Array.isArray(rules) ? rules : [])
      .filter((rule) => rule?.enabled !== false)
      .flatMap((rule) => ruleCodes(rule))
  ));
}

export function collectSnapshotPremiums(snapshot = null, output = {}) {
  if (!snapshot || typeof snapshot !== 'object') return output;
  const nested = Array.isArray(snapshot.rules)
    ? snapshot.rules.map((item) => item?.snapshot).filter(Boolean)
    : [snapshot];
  for (const item of nested) {
    for (const group of Array.isArray(item?.byBenchmark) ? item.byBenchmark : []) {
      const benchmarkCode = normalizeCode(group?.benchmarkCode);
      const benchmarkPremium = finiteNumber(group?.benchmarkPremiumPct);
      if (benchmarkCode && benchmarkPremium !== null) output[benchmarkCode] = benchmarkPremium;
      for (const candidate of Array.isArray(group?.candidates) ? group.candidates : []) {
        const code = normalizeCode(candidate?.code);
        const premium = finiteNumber(candidate?.premiumPct);
        if (code && premium !== null) output[code] = premium;
      }
    }
  }
  return output;
}

function premiumFromItem(item = {}) {
  return finiteNumber(item?.premiumPercent ?? item?.premiumPct ?? item?.premium_rate);
}

function buildPremiumMap(previous = {}, items = []) {
  const next = { ...(previous || {}) };
  for (const item of Array.isArray(items) ? items : []) {
    const code = normalizeCode(item?.code || item?.symbol);
    const premium = premiumFromItem(item);
    if (code && premium !== null) next[code] = premium;
  }
  return next;
}

function feeImpactPct(rule, holdingNotional) {
  const notional = finiteNumber(holdingNotional) ?? finiteNumber(rule?.holdingNotional) ?? 0;
  if (!(notional > 0)) return 0;
  const costs = toSwitchBacktestCosts(rule?.feeConfig, notional);
  const total = finiteNumber(costs?.estimatedCost);
  return total !== null && total > 0 ? total / notional * 100 : 0;
}

function candidateStatus(advantage, threshold, operator, bestAdvantage) {
  if (advantage === null || threshold === null) return 'no_data';
  const reached = operator === 'lte' ? advantage < threshold : advantage > threshold;
  if (reached) {
    const isBest = operator === 'lte' ? advantage === bestAdvantage : advantage === bestAdvantage;
    return isBest ? 'better' : 'reached';
  }
  return Math.abs(threshold - advantage) <= 1 ? 'near' : 'not_reached';
}

function applyPremiumToRuleView(rule, previousView, premiums) {
  if (!previousView || typeof previousView !== 'object') return previousView;
  const model = normalizeSwitchRuleModel(rule);
  const operator = model.triggerOperator === 'lte' ? 'lte' : 'gte';
  const holdingPremium = finiteNumber(premiums?.[model.holdingFundCode]);
  if (holdingPremium === null) return previousView;

  const holdingNotional = finiteNumber(previousView.holdingNotional) ?? finiteNumber(model.holdingNotional) ?? 0;
  const feeImpact = feeImpactPct(model, holdingNotional);
  let candidateChanged = false;
  const candidates = (Array.isArray(previousView.candidates) ? previousView.candidates : [])
    .map((candidate) => {
      const code = normalizeCode(candidate?.code);
      const candidatePremium = finiteNumber(premiums?.[code]);
      if (candidatePremium === null) return candidate;
      const rawDiff = holdingPremium - candidatePremium;
      const grossAdvantage = model.internalHoldingSide === 'low' ? -rawDiff : rawDiff;
      const advantage = round(grossAdvantage - feeImpact);
      if (
        finiteNumber(candidate?.currentAdvantagePct ?? candidate?.advantagePct) === advantage &&
        finiteNumber(candidate?.premiumPct) === candidatePremium
      ) {
        return candidate;
      }
      candidateChanged = true;
      return {
        ...candidate,
        currentAdvantagePct: advantage,
        advantagePct: advantage,
        distancePct: finiteNumber(previousView.thresholdValue) === null
          ? null
          : round(Math.abs(Number(previousView.thresholdValue) - advantage)),
        premiumPct: candidatePremium
      };
    });

  const values = candidates
    .map((candidate) => finiteNumber(candidate?.currentAdvantagePct ?? candidate?.advantagePct))
    .filter((value) => value !== null);
  if (!values.length || !candidateChanged) return previousView;
  const bestAdvantagePct = operator === 'lte' ? Math.min(...values) : Math.max(...values);
  const thresholdValue = finiteNumber(previousView.thresholdValue) ?? model.thresholdValue;
  const reached = thresholdValue !== null && (operator === 'lte'
    ? bestAdvantagePct < thresholdValue
    : bestAdvantagePct > thresholdValue);
  const status = ['pending_classification', 'classification_expired', 'stale', 'failed'].includes(previousView.status)
    ? previousView.status
    : reached
      ? 'triggered'
      : thresholdValue !== null && Math.abs(thresholdValue - bestAdvantagePct) <= 1
        ? 'near_trigger'
        : 'ready';

  return {
    ...previousView,
    status,
    triggerOperator: operator,
    bestAdvantagePct: round(bestAdvantagePct),
    distancePct: thresholdValue === null ? null : round(Math.abs(thresholdValue - bestAdvantagePct)),
    evaluatedAt: new Date().toISOString(),
    candidates: candidates
      .map((candidate) => ({
        ...candidate,
        status: candidateStatus(
          finiteNumber(candidate?.currentAdvantagePct ?? candidate?.advantagePct),
          thresholdValue,
          operator,
          bestAdvantagePct
        )
      }))
      .sort((left, right) => {
        const a = finiteNumber(left?.currentAdvantagePct ?? left?.advantagePct);
        const b = finiteNumber(right?.currentAdvantagePct ?? right?.advantagePct);
        if (a === null && b === null) return 0;
        if (a === null) return 1;
        if (b === null) return -1;
        return operator === 'lte' ? a - b : b - a;
      })
  };
}

/**
 * 将 WS 的最新溢价合并为规则运行视图。该函数只处理内存状态，不会写入规则配置、KV 或运行状态。
 */
export function mergeSwitchRealtimeViews({ rules = [], runtimeViews = {}, premiumMap = {}, items = [] } = {}) {
  const nextPremiumMap = buildPremiumMap(premiumMap, items);
  const nextViews = { ...(runtimeViews || {}) };
  let changed = false;
  for (const rule of Array.isArray(rules) ? rules : []) {
    if (!rule?.id || rule.enabled === false) continue;
    const current = nextViews[rule.id];
    const next = applyPremiumToRuleView(rule, current, nextPremiumMap);
    if (next && next !== current) {
      nextViews[rule.id] = next;
      changed = true;
    }
  }
  return { runtimeViews: changed ? nextViews : runtimeViews, premiumMap: nextPremiumMap, changed };
}
