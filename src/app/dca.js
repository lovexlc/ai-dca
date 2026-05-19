import { round } from './accumulation.js';
import { getStrategyParams } from './assetType.js';
import { buildPlan, readPlanList } from './plan.js';
import { calculatePyramidBuyAmount, calculateSmartDcaAmount, resolvePyramidLevel } from './smartDca.js';

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
  linkedPlanId: '',
  currentPrice: 0,
  rollingHigh: 0,
  capitalPool: 0,
  currentLevel: -1,
  createdAt: '',
  updatedAt: ''
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

function buildLinkedPlanSplit(linkedPlan = null, cycleBudget = 0) {
  if (!linkedPlan || !(Number(cycleBudget) > 0)) {
    return [];
  }

  const computedPlan = buildPlan(linkedPlan);
  const totalAmount = computedPlan.layers.reduce((sum, layer) => sum + (Number(layer.amount) || 0), 0) || 1;

  return computedPlan.layers.map((layer, index) => {
    const ratio = Math.max((Number(layer.amount) || 0) / totalAmount, 0);

    return {
      id: `linked-split-${index + 1}`,
      label: layer.label || `批次 ${String(index + 1).padStart(2, '0')}`,
      drawdown: Math.max(Number(layer.drawdown) || 0, 0),
      ratio,
      amount: Number(cycleBudget) * ratio
    };
  });
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
  const linkedPlanSplit = buildLinkedPlanSplit(linkedPlan, recurringInvestment);
  const linkedPlanFirstInvestment = linkedPlanSplit[0]?.amount || 0;
  const initialInvestment = linkedPlan ? 0 : manualInitialInvestment;
  const termMonths = Math.max(Number(state.termMonths) || 0, 1);
  const executionCount = getExecutionCount(state.frequency, termMonths);
  const effectiveSymbol = normalizeSavedSymbol(linkedPlan?.symbol || state.symbol) || defaultDcaState.symbol;
  const totalInvestment = linkedPlan
    ? recurringInvestment * executionCount
    : initialInvestment + recurringInvestment * executionCount;
  const monthlyEquivalent = totalInvestment / termMonths;
  const cadenceLabel = getCadenceLabel(state.frequency, state.executionDay);
  const strategyParams = linkedPlan?.strategyParams || getStrategyParams(effectiveSymbol);
  const currentPrice = Math.max(Number(state.currentPrice) || 0, 0);
  const rollingHigh = Math.max(Number(state.rollingHigh) || Number(linkedPlan?.basePrice) || currentPrice || 0, 0);
  const capitalPool = Math.max(Number(state.capitalPool) || 0, 0);
  const smartDca = linkedPlan
    ? calculateSmartDcaAmount({ monthlyBudget: recurringInvestment, currentPrice, rollingHigh, capitalPool, params: strategyParams })
    : null;
  const smartLevel = smartDca ? resolvePyramidLevel(smartDca.dropPct, strategyParams) : -1;
  const pyramidBuyAmount = smartDca?.mode === 'pyramid'
    ? calculatePyramidBuyAmount({ capitalPool: smartDca.poolBalance, monthlyBudget: recurringInvestment, level: smartLevel, params: strategyParams })
    : 0;
  const smartInvestAmount = smartDca
    ? (smartDca.mode === 'high-level' ? smartDca.investAmount : pyramidBuyAmount)
    : recurringInvestment;
  const poolBalance = smartDca
    ? Math.max(smartDca.poolBalance - pyramidBuyAmount, 0)
    : capitalPool;

  const schedule = Array.from({ length: Math.min(executionCount, 6) }, (_, index) => {
    if (linkedPlan) {
      return {
        id: `dca-${index + 1}`,
        label: `第 ${index + 1} 期`,
        contribution: smartInvestAmount,
        cumulative: smartInvestAmount * (index + 1),
        note: smartDca?.mode === 'high-level' ? `${cadenceLabel}，当前高位，仅投 ${Math.round((strategyParams.highLevelRatio || 0.1) * 100)}%，其余进入资金池` : `${cadenceLabel}，按「${linkedPlan.name || effectiveSymbol}」策略在周期内分批执行`,
        isLinkedCycle: true
      };
    }

    return {
      id: `dca-${index + 1}`,
      label: `第 ${index + 1} 次`,
      contribution: recurringInvestment,
      cumulative: initialInvestment + recurringInvestment * (index + 1),
      note: cadenceLabel,
      isLinkedCycle: false
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
    linkedPlanSplit,
    linkedPlanSplitCount: linkedPlanSplit.length,
    linkedPlanFirstInvestment,
    smartDcaMode: smartDca?.mode || 'fixed',
    poolBalance,
    dropPct: smartDca?.dropPct || 0,
    smartInvestAmount,
    smartPoolAmount: smartDca?.poolAmount || 0,
    smartLevel,
    strategyParams,
    isLinkedPlan: Boolean(linkedPlan),
    nextExecutionAmount: smartInvestAmount
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
      currentPrice: readSavedNumber(saved, 'currentPrice', defaultDcaState.currentPrice),
      rollingHigh: readSavedNumber(saved, 'rollingHigh', defaultDcaState.rollingHigh),
      capitalPool: readSavedNumber(saved, 'capitalPool', defaultDcaState.capitalPool),
      currentLevel: readSavedNumber(saved, 'currentLevel', defaultDcaState.currentLevel),
      linkedPlanId: normalizeLinkedPlanId(saved.linkedPlanId),
      createdAt: String(saved.createdAt || saved.updatedAt || ''),
      updatedAt: String(saved.updatedAt || '')
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

// 清空定投状态。定投只保存一份，清空后 tradePlans 列表中的 dca 行会自动消失。
export function clearDcaState() {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.removeItem(DCA_KEY);
}

export function persistDcaState(state, computed = buildDcaProjection(state)) {
  if (typeof window === 'undefined') {
    return;
  }

  const existingState = readDcaState();
  const timestamp = new Date().toISOString();
  const createdAt = String(state.createdAt || existingState.createdAt || existingState.updatedAt || timestamp);
  const normalizedSymbol = normalizeSavedSymbol(computed.effectiveSymbol || state.symbol);
  const payload = {
    source: 'react-dca',
    version: 5,
    symbol: normalizedSymbol,
    initialInvestment: round(state.initialInvestment, 2),
    recurringInvestment: round(state.recurringInvestment, 2),
    frequency: state.frequency || defaultDcaState.frequency,
    executionDay: Math.max(Number(state.executionDay) || 1, 1),
    termMonths: Math.max(Number(state.termMonths) || 1, 1),
    targetReturn: round(state.targetReturn, 2),
    currentPrice: round(state.currentPrice, 4),
    rollingHigh: round(state.rollingHigh, 4),
    capitalPool: round(computed.poolBalance, 2),
    currentLevel: Math.max(Number(state.currentLevel) || computed.smartLevel || -1, -1),
    linkedPlanId: normalizeLinkedPlanId(state.linkedPlanId),
    executionCount: computed.executionCount,
    totalInvestment: round(computed.totalInvestment, 2),
    cadenceLabel: computed.cadenceLabel,
    nextExecutionAmount: round(computed.nextExecutionAmount, 2),
    linkedPlanFirstInvestment: round(computed.linkedPlanFirstInvestment, 2),
    smartDcaMode: computed.smartDcaMode,
    poolBalance: round(computed.poolBalance, 2),
    dropPct: round(computed.dropPct, 2),
    createdAt,
    updatedAt: timestamp
  };

  window.localStorage.setItem(DCA_KEY, JSON.stringify(payload));
}
