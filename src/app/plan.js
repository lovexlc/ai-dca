import { buildStages, defaultAccumulationState, round } from './accumulation.js';

const PLAN_KEY = 'aiDcaPlanState';

export const defaultPlanState = {
  symbol: '513100',
  totalBudget: 12000,
  cashReservePct: 30,
  basePrice: defaultAccumulationState.basePrice,
  riskControlPrice: round(defaultAccumulationState.basePrice * 0.85, 2),
  selectedStrategy: 'ma120-risk',
  frequency: '每周',
  layerWeights: [40, 35, 25],
  triggerDrops: [0, 8, 16]
};

function normalizeList(values, fallback) {
  const source = Array.isArray(values) && values.length ? values : fallback;
  return source.map((value, index) => Number.isFinite(Number(value)) ? Number(value) : fallback[index] || 0);
}

export function buildPlan(state) {
  const layerWeights = normalizeList(state.layerWeights, defaultPlanState.layerWeights).map((value) => Math.max(value, 0));
  const triggerDrops = normalizeList(state.triggerDrops, defaultPlanState.triggerDrops).slice(0, layerWeights.length);
  while (triggerDrops.length < layerWeights.length) {
    triggerDrops.push(triggerDrops.length === 0 ? 0 : triggerDrops[triggerDrops.length - 1] + 4);
  }

  const totalWeight = layerWeights.reduce((sum, value) => sum + value, 0) || 1;
  const totalBudget = Number(state.totalBudget) || 0;
  const cashReservePct = Math.max(Number(state.cashReservePct) || 0, 0);
  const investableCapital = totalBudget * Math.max(0, 1 - cashReservePct / 100);
  const reserveCapital = totalBudget - investableCapital;
  const basePrice = Number(state.basePrice) || defaultPlanState.basePrice;

  const layers = layerWeights.map((weight, index) => {
    const drawdown = Math.max(triggerDrops[index] || 0, 0);
    const price = basePrice * (1 - drawdown / 100);
    const amount = investableCapital * (weight / totalWeight);
    const shares = price > 0 ? amount / price : 0;

    return {
      id: `plan-${index + 1}`,
      label: `批次 ${String(index + 1).padStart(2, '0')}`,
      weight,
      drawdown,
      price,
      amount,
      shares
    };
  });

  const stageSnapshot = buildStages({
    totalCapital: investableCapital,
    basePrice,
    maxDrawdown: triggerDrops[triggerDrops.length - 1] || 0,
    weights: layerWeights
  });

  return {
    layerWeights,
    triggerDrops,
    totalWeight,
    investableCapital,
    reserveCapital,
    averageCost: stageSnapshot.averageCost,
    layers
  };
}

export function readPlanState() {
  if (typeof window === 'undefined') {
    return defaultPlanState;
  }

  try {
    const saved = JSON.parse(window.localStorage.getItem(PLAN_KEY) || 'null');
    if (!saved) {
      return defaultPlanState;
    }

    return {
      symbol: saved.symbol || defaultPlanState.symbol,
      totalBudget: Number(saved.totalBudget) || defaultPlanState.totalBudget,
      cashReservePct: Number(saved.cashReservePct) || defaultPlanState.cashReservePct,
      basePrice: Number(saved.basePrice) || defaultPlanState.basePrice,
      riskControlPrice: Number(saved.riskControlPrice) || defaultPlanState.riskControlPrice,
      selectedStrategy: saved.selectedStrategy || defaultPlanState.selectedStrategy,
      frequency: saved.frequency || defaultPlanState.frequency,
      layerWeights: normalizeList(saved.layerWeights, defaultPlanState.layerWeights),
      triggerDrops: normalizeList(saved.triggerDrops, defaultPlanState.triggerDrops)
    };
  } catch (_error) {
    return defaultPlanState;
  }
}

export function persistPlanState(state, computed = buildPlan(state)) {
  if (typeof window === 'undefined') {
    return;
  }

  const payload = {
    source: 'react-plan',
    symbol: state.symbol || defaultPlanState.symbol,
    totalBudget: round(state.totalBudget, 2),
    cashReservePct: round(state.cashReservePct, 2),
    basePrice: round(state.basePrice, 2),
    riskControlPrice: round(state.riskControlPrice, 2),
    selectedStrategy: state.selectedStrategy || defaultPlanState.selectedStrategy,
    frequency: state.frequency || defaultPlanState.frequency,
    layerWeights: computed.layerWeights.map((value) => round(value, 4)),
    triggerDrops: computed.triggerDrops.map((value) => round(value, 4)),
    investableCapital: round(computed.investableCapital, 2),
    reserveCapital: round(computed.reserveCapital, 2),
    averageCost: round(computed.averageCost, 2),
    updatedAt: new Date().toISOString()
  };

  window.localStorage.setItem(PLAN_KEY, JSON.stringify(payload));
}
