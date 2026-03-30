import { round } from './accumulation.js';

export const DCA_KEY = 'aiDcaDcaState';

export const frequencyOptions = ['每日', '每周', '每月', '每季'];

export const defaultDcaState = {
  symbol: '纳指基金',
  initialInvestment: 1500,
  recurringInvestment: 800,
  frequency: '每月',
  executionDay: 8,
  termMonths: 12,
  targetReturn: 30
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

export function buildDcaProjection(state) {
  const initialInvestment = Math.max(Number(state.initialInvestment) || 0, 0);
  const recurringInvestment = Math.max(Number(state.recurringInvestment) || 0, 0);
  const termMonths = Math.max(Number(state.termMonths) || 0, 1);
  const executionCount = getExecutionCount(state.frequency, termMonths);
  const totalInvestment = initialInvestment + recurringInvestment * executionCount;
  const monthlyEquivalent = totalInvestment / termMonths;
  const cadenceLabel = getCadenceLabel(state.frequency, state.executionDay);

  const schedule = Array.from({ length: Math.min(executionCount, 6) }, (_, index) => ({
    id: `dca-${index + 1}`,
    label: `第 ${index + 1} 次`,
    contribution: recurringInvestment,
    cumulative: initialInvestment + recurringInvestment * (index + 1),
    note: cadenceLabel
  }));

  return {
    executionCount,
    totalInvestment,
    monthlyEquivalent,
    cadenceLabel,
    schedule
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
      targetReturn: readSavedNumber(saved, 'targetReturn', defaultDcaState.targetReturn)
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

  const normalizedSymbol = normalizeSavedSymbol(state.symbol);
  const payload = {
    source: 'react-dca',
    version: 2,
    symbol: normalizedSymbol,
    initialInvestment: round(state.initialInvestment, 2),
    recurringInvestment: round(state.recurringInvestment, 2),
    frequency: state.frequency || defaultDcaState.frequency,
    executionDay: Math.max(Number(state.executionDay) || 1, 1),
    termMonths: Math.max(Number(state.termMonths) || 1, 1),
    targetReturn: round(state.targetReturn, 2),
    executionCount: computed.executionCount,
    totalInvestment: round(computed.totalInvestment, 2),
    cadenceLabel: computed.cadenceLabel,
    updatedAt: new Date().toISOString()
  };

  window.localStorage.setItem(DCA_KEY, JSON.stringify(payload));
}
