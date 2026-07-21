import {
  estimateSwitchCost,
  getSwitchConditionText,
  normalizeSwitchRuleModel,
  resolveRuleThreshold
} from '../../app/switchRuleModel.js';

export const SWITCH_RUNTIME_STATUSES = Object.freeze([
  'ready',
  'near_trigger',
  'triggered',
  'pending_classification',
  'classification_expired',
  'stale',
  'failed'
]);

export const SWITCH_PLAN_DISPLAY_STATUSES = Object.freeze([
  'noHolding',
  'watching',
  'nearReminder',
  'triggered',
  'disabled',
  'error'
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

/**
 * Convert the runtime advantage into the compact progress shown on a plan card.
 *
 * A high-side rule (gte) approaches its target as the advantage increases.
 * A low-side rule (lte) approaches its target as the advantage decreases, so
 * the ratio is inverted. This keeps an out-of-range low-side value such as
 * 2.34% against a 1.00% target below 100% instead of clamping it to triggered.
 */
export function calculateSwitchProgress(currentAdvantage, reminderThreshold, operator = 'gte') {
  if (currentAdvantage === null || currentAdvantage === undefined || currentAdvantage === '') return 0;
  const current = Number(currentAdvantage);
  const threshold = Number(reminderThreshold);
  if (!Number.isFinite(current)) return 0;
  if (!Number.isFinite(threshold) || threshold <= 0) return 0;

  const ratio = operator === 'lte'
    ? threshold / Math.max(current, threshold)
    : current / threshold;

  return Math.max(0, Math.min(100, Math.round(ratio * 100)));
}

export function getSwitchPlanDisplayStatus({
  holdingQuantity = 0,
  enabled = true,
  progressPercent = 0,
  runtimeStatus = 'ready'
} = {}) {
  if (!(Number(holdingQuantity) > 0)) return 'noHolding';
  if (!enabled) return 'disabled';
  if (runtimeStatus === 'failed') return 'error';
  if (progressPercent >= 100 || runtimeStatus === 'triggered') return 'triggered';
  if (progressPercent >= 80 || runtimeStatus === 'near_trigger') return 'nearReminder';
  return 'watching';
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
  return operator === 'lte' ? Number(advantage) < Number(threshold) : Number(advantage) > Number(threshold);
}

export function getDistanceToThreshold(advantage, threshold) {
  const current = numeric(advantage);
  const target = numeric(threshold);
  return current === null || target === null ? null : Math.round(Math.abs(target - current) * 10000) / 10000;
}

function formatAdvantagePercent(value) {
  const result = numeric(value);
  return result === null ? '暂无' : `${result.toFixed(2)}%`;
}

export function getAdvantageCopy(viewModel = {}) {
  const operator = viewModel.operator === 'lte' ? 'lte' : 'gte';
  const threshold = numeric(viewModel.thresholdValue);
  const distance = numeric(viewModel.distancePct);
  const hasCurrentValue = numeric(viewModel.bestAdvantagePct) !== null;
  const reached = Boolean(viewModel.reached);

  if (operator === 'lte') {
    return {
      label: '当前切换价差',
      hint: threshold === null ? '目标是让价差收窄' : `目标：收窄到 ${formatAdvantagePercent(threshold)} 以内`,
      progress: !hasCurrentValue
        ? '等待行情数据'
        : reached
          ? '已进入提醒范围'
          : distance === null
            ? '尚未进入提醒范围'
            : `还需收窄 ${formatAdvantagePercent(distance)}`
    };
  }

  return {
    label: '当前最佳切换优势',
    hint: '当前持仓比候选基金贵',
    progress: !hasCurrentValue
      ? '等待行情数据'
      : reached
        ? '已达到提醒条件'
        : distance === null
          ? '尚未达到提醒条件'
          : `还差 ${formatAdvantagePercent(distance)}`
  };
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

export function getRuleViewModel(rule, snapshot, runtimeView = null) {
  const model = normalizeSwitchRuleModel(rule);
  if (runtimeView && typeof runtimeView === 'object') {
    const operator = runtimeView.triggerOperator === 'lte' ? 'lte' : 'gte';
    const candidates = (Array.isArray(runtimeView.candidates) ? runtimeView.candidates : []).map((candidate) => ({
      ...candidate,
      advantagePct: numeric(candidate.currentAdvantagePct),
      distancePct: numeric(candidate.distancePct),
      status: candidate.status === 'better' ? 'better' : candidate.status
    }));
    return {
      rule: model,
      operator,
      candidates,
      bestAdvantagePct: numeric(runtimeView.bestAdvantagePct),
      thresholdValue: numeric(runtimeView.thresholdValue) ?? model.thresholdValue,
      distancePct: numeric(runtimeView.distancePct),
      reached: runtimeView.status === 'triggered',
      currentStatus: SWITCH_RUNTIME_STATUSES.includes(runtimeView.status) ? runtimeView.status : 'ready',
      estimatedSwitchCost: numeric(runtimeView.estimatedSwitchCost),
      holdingNotional: numeric(runtimeView.holdingNotional),
      holdingPrice: numeric(runtimeView.holdingPrice)
    };
  }
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
    holdingPrice: numeric(
      ruleSnapshotFor(snapshot, model.id)?.byBenchmark?.find(
        (item) => item?.benchmarkCode === model.holdingFundCode
      )?.benchmarkPrice
    )
  };
}

export function buildSwitchPlanDisplayModel(
  rule,
  snapshot,
  runtimeView = null,
  holdingNotional = 0,
  holdingQuantityOverride = null
) {
  const model = normalizeSwitchRuleModel(rule);
  const viewModel = getRuleViewModel(model, snapshot, runtimeView);
  const holdingQuantity = numeric(holdingQuantityOverride) ?? numeric(model.holdingQuantity) ?? 0;
  const currentAdvantage = holdingQuantity > 0 ? numeric(viewModel.bestAdvantagePct) : null;
  const reminderThreshold = numeric(viewModel.thresholdValue) ?? numeric(model.thresholdValue);
  const progressPercent = calculateSwitchProgress(
    currentAdvantage,
    reminderThreshold,
    viewModel.operator
  );
  const runtimeStatus = viewModel.currentStatus || 'ready';
  const displayStatus = getSwitchPlanDisplayStatus({
    holdingQuantity,
    enabled: model.enabled,
    progressPercent,
    runtimeStatus
  });
  const notional = numeric(viewModel.holdingNotional) > 0
    ? numeric(viewModel.holdingNotional)
    : numeric(holdingNotional) || 0;
  const candidates = viewModel.candidates
    .map((candidate) => {
      const advantage = numeric(candidate.advantagePct);
      const distance = getDistanceToThreshold(advantage, reminderThreshold);
      const reached = thresholdReached(advantage, reminderThreshold, viewModel.operator);
      return {
        ...candidate,
        fundCode: candidate.code || candidate.fundCode || '',
        fundName: candidate.name || candidate.fundName || candidate.code || '候选基金',
        currentAdvantage: advantage,
        remainingToThreshold: distance,
        status: reached ? 'triggered' : distance !== null && distance <= 1 ? 'nearReminder' : 'watching'
      };
    })
    .sort((left, right) => {
      const leftValue = numeric(left.currentAdvantage);
      const rightValue = numeric(right.currentAdvantage);
      if (leftValue === null) return 1;
      if (rightValue === null) return -1;
      return rightValue - leftValue;
    });

  return {
    id: model.id,
    ruleName: model.name,
    fundCode: model.holdingFundCode,
    fundName: model.holdingFundName,
    holdingQuantity,
    enabled: model.enabled,
    currentAdvantage,
    reminderThreshold,
    estimatedSwitchFee:
      numeric(viewModel.estimatedSwitchCost) ?? estimateSwitchCost(model.feeConfig, notional),
    progressPercent,
    displayStatus,
    runtimeStatus,
    conditionText: getSwitchConditionText(model),
    distanceToThreshold: getDistanceToThreshold(currentAdvantage, reminderThreshold),
    candidateCount: candidates.length,
    candidates,
    model,
    viewModel
  };
}
