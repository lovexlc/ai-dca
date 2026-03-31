import { round } from './accumulation.js';
import { buildPlan, readPlanList } from './plan.js';

export const DCA_KEY = 'aiDcaDcaState';

export const frequencyOptions = ['每日', '每周', '每月', '每季'];

export const defaultDcaState = {
  symbol: '纳指基金',
  initialInvestment: 1500,
  recurringInvestment: 800,
  frequency: '每月',
  executionDay: 8,
  termMonths: 12,
  targetReturn: 30,
  linkedPlanId: ''
};

function getExecutionCount(frequency, termMonths) {
  const months = Math.max(Number(termMonths) || 0, 1);
  switch (frequency) {
    case '每日':
      return months * 21;
    case '每周':
      return months * 4;
    case '每季':
      return Math.max(Math.ceil(months / 3), 1);
    case '每月':
    default:
      return months;
  }
}

function getCadenceLabel(frequency, executionDay) {
  switch (frequency) {
    case '每日':
      return '每个交易日执行';
    case '每周':
      return `每周第 ${Math.max(Number(executionDay) || 1, 1)} 个交易日执行`;
    case '每季':
      return `每季度第 ${Math.max(Number(executionDay) || 1, 1)} 个交易日执行`;
    case '每月':
    default:
      return `每月 ${Math.max(Number(executionDay) || 1, 1)} 日执行`;
  }
}

function normalizeSavedSymbol(value) {
  const normalized = String(value || '').trim();
  if (normalized === 'QQQ') {
    return defaultDcaState.symbol;
  }
  return normalized;
}

function hasOwnField(target, field) {
  return Object.prototype.hasOwnProperty.call(target, field);
}

function normalizeLinkedPlanId(value) {
  return String(value || '').trim();
}

function readSavedNumber(saved, fields, fallback) {
  const candidateFields = Array.isArray(fields) ? fields : [fields];

  for (const field of candidateFields) {
    if (!hasOwnField(saved, field)) {
      continue;
    }

    const value = Number(saved[field]);
    if (Number.isFinite(value)) {
      return value;
    }
  }

  return fallback;
}

function readSavedSymbol(saved) {
  if (!hasOwnField(saved, 'symbol')) {
    return defaultDcaState.symbol;
  }

  return normalizeSavedSymbol(saved.symbol);
}

export function buildDcaProjection(state, { planList = readPlanList() } = {}) {
  const plans = Array.isArray(planList) ? planList : [];
  const linkedPlanId = normalizeLinkedPlanId(state?.linkedPlanId);
  const linkedPlan = linkedPlanId
    ? plans.find((plan) => String(plan?.id || '').trim() === linkedPlanId) || null
    : null;
  const recurringInvestment = Math.max(Number(state.recurringInvestment) || 0, 0);
  const manualInitialInvestment = Math.max(Number(state.initialInvestment) || 0, 0);
  const linkedPlanFirstInvestment = linkedPlan
    ? Math.max(Number(buildPlan(linkedPlan).layers?.[0]?.amount) || 0, 0)
    : 0;
  const initialInvestment = linkedPlan ? linkedPlanFirstInvestment : manualInitialInvestment;
  const termMonths = Math.max(Number(state.termMonths) || 0, 1);
  const executionCount = getExecutionCount(state.frequency, termMonths);
  const effectiveSymbol = normalizeSavedSymbol(linkedPlan?.symbol || state.symbol) || defaultDcaState.symbol;
  const totalInvestment = linkedPlan
    ? initialInvestment + recurringInvestment * Math.max(executionCount - 1, 0)
    : initialInvestment + recurringInvestment * executionCount;
  const monthlyEquivalent = totalInvestment / termMonths;
  const cadenceLabel = getCadenceLabel(state.frequency, state.executionDay);

  const schedule = Array.from({ length: Math.min(executionCount, 6) }, (_, index) => {
    if (linkedPlan) {
      const isFirstExecution = index === 0;
      return {
        id: `dca-${index + 1}`,
        label: isFirstExecution ? '第 1 次（首投）' : `第 ${index + 1} 次`,
        contribution: isFirstExecution ? initialInvestment : recurringInvestment,
        cumulative: initialInvestment + recurringInvestment * Math.max(index, 0),
        note: isFirstExecution
          ? `${cadenceLabel}，按「${linkedPlan.name || effectiveSymbol}」首笔金额执行`
          : cadenceLabel,
        isLinkedFirstExecution: isFirstExecution
      };
    }

    return {
      id: `dca-${index + 1}`,
      label: `第 ${index + 1} 次`,
      contribution: recurringInvestment,
      cumulative: initialInvestment + recurringInvestment * (index + 1),
      note: cadenceLabel,
      isLinkedFirstExecution: false
    };
  });

  return {
    executionCount,
    totalInvestment,
    monthlyEquivalent,
    cadenceLabel,
    schedule,
    effectiveSymbol,
    initialInvestment,
    manualInitialInvestment,
    recurringInvestment,
    linkedPlanId,
    linkedPlanName: String(linkedPlan?.name || effectiveSymbol || '').trim(),
    linkedPlanFirstInvestment,
    isLinkedPlan: Boolean(linkedPlan),
    nextExecutionAmount: linkedPlan ? initialInvestment : recurringInvestment
  };
}

export function readDcaState() {
  if (typeof window === 'undefined') {
    return defaultDcaState;
  }

  try {
    const saved = JSON.parse(window.localStorage.getItem(DCA_KEY) || 'null');
    if (!saved) {
      return defaultDcaState;
    }

    return {
      symbol: readSavedSymbol(saved),
      initialInvestment: readSavedNumber(saved, 'initialInvestment', defaultDcaState.initialInvestment),
      recurringInvestment: readSavedNumber(saved, ['recurringInvestment', 'monthlyInvestment'], defaultDcaState.recurringInvestment),
      frequency: saved.frequency || defaultDcaState.frequency,
      executionDay: readSavedNumber(saved, 'executionDay', defaultDcaState.executionDay),
      termMonths: readSavedNumber(saved, 'termMonths', defaultDcaState.termMonths),
      targetReturn: readSavedNumber(saved, 'targetReturn', defaultDcaState.targetReturn),
      linkedPlanId: normalizeLinkedPlanId(saved.linkedPlanId)
    };
  } catch (_error) {
    return defaultDcaState;
  }
}

export function hasSavedDcaState() {
  if (typeof window === 'undefined') {
    return false;
  }

  return Boolean(window.localStorage.getItem(DCA_KEY));
}

export function persistDcaState(state, computed = buildDcaProjection(state)) {
  if (typeof window === 'undefined') {
    return;
  }

  const normalizedSymbol = normalizeSavedSymbol(computed.effectiveSymbol || state.symbol);
  const payload = {
    source: 'react-dca',
    version: 3,
    symbol: normalizedSymbol,
    initialInvestment: round(computed.initialInvestment, 2),
    recurringInvestment: round(state.recurringInvestment, 2),
    frequency: state.frequency || defaultDcaState.frequency,
    executionDay: Math.max(Number(state.executionDay) || 1, 1),
    termMonths: Math.max(Number(state.termMonths) || 1, 1),
    targetReturn: round(state.targetReturn, 2),
    linkedPlanId: normalizeLinkedPlanId(state.linkedPlanId),
    executionCount: computed.executionCount,
    totalInvestment: round(computed.totalInvestment, 2),
    cadenceLabel: computed.cadenceLabel,
    nextExecutionAmount: round(computed.nextExecutionAmount, 2),
    linkedPlanFirstInvestment: round(computed.linkedPlanFirstInvestment, 2),
    updatedAt: new Date().toISOString()
  };

  window.localStorage.setItem(DCA_KEY, JSON.stringify(payload));
}
