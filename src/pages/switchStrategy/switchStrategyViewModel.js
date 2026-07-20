import { normalizeSwitchRuleModel, resolveRuleThreshold } from '../../app/switchRuleModel.js';

export const SWITCH_RUNTIME_STATUSES = Object.freeze([
  'ready',
  'near_trigger',
  'triggered',
  'pending_classification',
  'classification_expired',
  'stale',
  'failed'
]);

export function ruleSnapshotFor(snapshot, ruleId) {
  if (!snapshot) return null;
  const nested = Array.isArray(snapshot.rules)
    ? snapshot.rules.find((item) => item.ruleId === ruleId)?.snapshot
    : null;
  return nested || snapshot;
}

function numeric(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function operatorFor(rule) {
  const model = normalizeSwitchRuleModel(rule);
  return model.triggerOperator || resolveRuleThreshold(model).operator;
}

export function candidateAdvantage(candidate, operator = 'gte') {
  const direct = numeric(candidate?.advantagePct ?? candidate?.currentAdvantagePct);
  if (direct !== null) return direct;
  const spread = numeric(candidate?.spreadVsBenchmarkPct ?? candidate?.gapPct);
  if (spread === null) return null;
  // 老快照只有 benchmarkPremium - candidatePremium，低侧需要转换为 H-L。
  return operator === 'lte' ? -spread : spread;
}

export function getRuleCandidates(rule, snapshot) {
  const model = normalizeSwitchRuleModel(rule);
  const active = ruleSnapshotFor(snapshot, model.id);
  const group =
    active?.byBenchmark?.find((item) => item.benchmarkCode === model.holdingFundCode) ||
    active?.byBenchmark?.[0];
  const operator = operatorFor(model);
  return (group?.candidates || [])
    .map((candidate) => ({
      ...candidate,
      advantagePct: candidateAdvantage(candidate, operator)
    }))
    .sort((a, b) => {
      const av = numeric(a.advantagePct);
      const bv = numeric(b.advantagePct);
      return operator === 'lte'
        ? (av === null ? Infinity : av) - (bv === null ? Infinity : bv)
        : (bv === null ? -Infinity : bv) - (av === null ? -Infinity : av);
    });
}

export function thresholdReached(advantage, threshold, operator = 'gte') {
  if (!Number.isFinite(Number(advantage)) || !Number.isFinite(Number(threshold))) return false;
  return operator === 'lte' ? Number(advantage) <= Number(threshold) : Number(advantage) >= Number(threshold);
}

export function getDistanceToThreshold(advantage, threshold) {
  const current = numeric(advantage);
  const target = numeric(threshold);
  return current === null || target === null ? null : Math.round(Math.abs(target - current) * 10000) / 10000;
}

export function candidateStatus(candidate, rule) {
  const model = normalizeSwitchRuleModel(rule);
  const operator = operatorFor(model);
  const threshold = Number(model.thresholdValue);
  const advantage = candidateAdvantage(candidate, operator);
  if (advantage === null) return 'notReached';
  if (thresholdReached(advantage, threshold, operator)) return 'reached';
  return getDistanceToThreshold(advantage, threshold) <= 1 ? 'near' : 'notReached';
}

export function getRuleRuntimeStatus(rule, snapshot) {
  const model = normalizeSwitchRuleModel(rule);
  const classificationStatus = model.runtimeConfig?.classificationStatus;
  if (classificationStatus === 'classification_expired') return 'classification_expired';
  if (classificationStatus === 'pending_classification') return 'pending_classification';
  if (classificationStatus === 'stale') return 'stale';
  if (model.lastResult?.status === 'failed') return 'failed';
  const candidates = getRuleCandidates(model, snapshot);
  const best = getBestAdvantage(model, candidates);
  if (best === null) return 'ready';
  const operator = operatorFor(model);
  if (thresholdReached(best, model.thresholdValue, operator)) return 'triggered';
  return getDistanceToThreshold(best, model.thresholdValue) <= 1 ? 'near_trigger' : 'ready';
}

export function getBestAdvantage(rule, candidates = []) {
  const operator = operatorFor(rule);
  const values = candidates
    .map((candidate) => candidateAdvantage(candidate, operator))
    .filter((value) => value !== null);
  if (!values.length) return null;
  return operator === 'lte' ? Math.min(...values) : Math.max(...values);
}

export function getRuleViewModel(rule, snapshot) {
  const model = normalizeSwitchRuleModel(rule);
  const operator = operatorFor(model);
  const candidates = getRuleCandidates(model, snapshot).map((candidate) => ({
    ...candidate,
    status: candidateStatus(candidate, model),
    distancePct: getDistanceToThreshold(candidateAdvantage(candidate, operator), model.thresholdValue)
  }));
  const bestAdvantagePct = getBestAdvantage(model, candidates);
  const distancePct = getDistanceToThreshold(bestAdvantagePct, model.thresholdValue);
  const reached = thresholdReached(bestAdvantagePct, model.thresholdValue, operator);
  return {
    rule: model,
    operator,
    candidates,
    bestAdvantagePct,
    thresholdValue: model.thresholdValue,
    distancePct,
    reached,
    currentStatus: getRuleRuntimeStatus(model, snapshot),
    directionHint: operator === 'lte' ? '越低越好' : '越高越好'
  };
}
