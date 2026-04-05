import { buildStages, defaultAccumulationState, round } from './accumulation.js';

const PLAN_KEY = 'aiDcaPlanState';
const PLAN_STORE_KEY = 'aiDcaPlanStore';
const PLAN_SOURCE = 'react-plan';
const PLAN_STORE_SOURCE = 'react-plan-store';

export const defaultPlanState = {
  id: '',
  name: '',
  symbol: '513100',
  totalBudget: 12000,
  cashReservePct: 30,
  basePrice: defaultAccumulationState.basePrice,
  riskControlPrice: round(defaultAccumulationState.basePrice * 0.85, 2),
  selectedStrategy: 'ma120-risk',
  isConfigured: false,
  createdAt: '',
  updatedAt: '',
  frequency: '每周',
  layerWeights: [40, 35, 25],
  triggerDrops: [0, 8, 16]
};

function normalizeList(values, fallback) {
  const source = Array.isArray(values) && values.length ? values : fallback;
  return source.map((value, index) => Number.isFinite(Number(value)) ? Number(value) : fallback[index] || 0);
}

function buildPlanId() {
  return `plan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizePlanName(value = '') {
  return String(value || '').trim();
}

function normalizePlanState(saved = {}, { assumeConfigured = false } = {}) {
  return {
    id: String(saved.id || '').trim(),
    name: normalizePlanName(saved.name),
    symbol: saved.symbol || defaultPlanState.symbol,
    totalBudget: Number(saved.totalBudget) || defaultPlanState.totalBudget,
    cashReservePct: Number(saved.cashReservePct) || defaultPlanState.cashReservePct,
    basePrice: Number(saved.basePrice) || defaultPlanState.basePrice,
    riskControlPrice: Number(saved.riskControlPrice) || defaultPlanState.riskControlPrice,
    selectedStrategy: saved.selectedStrategy || defaultPlanState.selectedStrategy,
    isConfigured: typeof saved.isConfigured === 'boolean' ? saved.isConfigured : assumeConfigured,
    createdAt: String(saved.createdAt || saved.updatedAt || ''),
    updatedAt: String(saved.updatedAt || ''),
    frequency: saved.frequency || defaultPlanState.frequency,
    layerWeights: normalizeList(saved.layerWeights, defaultPlanState.layerWeights),
    triggerDrops: normalizeList(saved.triggerDrops, defaultPlanState.triggerDrops)
  };
}

function resolveStrategyLabel(strategy = '') {
  return strategy === 'peak-drawdown' ? '固定回撤' : '均线分层';
}

function buildPlanName(state = {}, timestamp = '') {
  const explicitName = normalizePlanName(state.name);
  if (explicitName) {
    return explicitName;
  }

  const dateLabel = String(timestamp || state.createdAt || state.updatedAt || '').slice(0, 10) || '未命名';
  return `${state.symbol || '未命名标的'} · ${resolveStrategyLabel(state.selectedStrategy)} · ${dateLabel}`;
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

function serializePlanState(state, computed = buildPlan(state), { id = '', createdAt = '', updatedAt = '' } = {}) {
  const timestamp = updatedAt || new Date().toISOString();
  const normalized = normalizePlanState(
    {
      ...state,
      id: id || state.id || buildPlanId(),
      createdAt: createdAt || state.createdAt || timestamp,
      updatedAt: timestamp,
      isConfigured: state.isConfigured !== false
    },
    { assumeConfigured: true }
  );

  return {
    source: PLAN_SOURCE,
    version: 2,
    id: normalized.id,
    name: buildPlanName(normalized, normalized.createdAt),
    symbol: normalized.symbol,
    totalBudget: round(normalized.totalBudget, 2),
    cashReservePct: round(normalized.cashReservePct, 2),
    basePrice: round(normalized.basePrice, 2),
    riskControlPrice: round(normalized.riskControlPrice, 2),
    selectedStrategy: normalized.selectedStrategy,
    isConfigured: true,
    frequency: normalized.frequency,
    layerWeights: computed.layerWeights.map((value) => round(value, 4)),
    triggerDrops: computed.triggerDrops.map((value) => round(value, 4)),
    investableCapital: round(computed.investableCapital, 2),
    reserveCapital: round(computed.reserveCapital, 2),
    averageCost: round(computed.averageCost, 2),
    createdAt: normalized.createdAt,
    updatedAt: normalized.updatedAt
  };
}

function persistPlanStore(store) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(PLAN_STORE_KEY, JSON.stringify(store));

  const activePlan = store.plans.find((plan) => plan.id === store.activePlanId) || store.plans[0] || null;
  if (activePlan) {
    window.localStorage.setItem(PLAN_KEY, JSON.stringify(activePlan));
  } else {
    window.localStorage.removeItem(PLAN_KEY);
  }
}

function normalizePlanStore(rawStore) {
  const plans = (Array.isArray(rawStore?.plans) ? rawStore.plans : [])
    .map((plan) => normalizePlanState(plan, { assumeConfigured: true }))
    .filter((plan) => plan.isConfigured);

  const activePlanId = plans.some((plan) => plan.id === rawStore?.activePlanId)
    ? String(rawStore.activePlanId || '')
    : plans[0]?.id || '';

  return {
    source: PLAN_STORE_SOURCE,
    version: 1,
    activePlanId,
    plans
  };
}

export function readPlanStore() {
  if (typeof window === 'undefined') {
    return {
      source: PLAN_STORE_SOURCE,
      version: 1,
      activePlanId: '',
      plans: []
    };
  }

  try {
    const rawStore = JSON.parse(window.localStorage.getItem(PLAN_STORE_KEY) || 'null');
    const normalizedStore = normalizePlanStore(rawStore);
    if (normalizedStore.plans.length) {
      return normalizedStore;
    }
  } catch {
    // fall through to legacy migration
  }

  try {
    const legacyPlan = JSON.parse(window.localStorage.getItem(PLAN_KEY) || 'null');
    if (legacyPlan) {
      const normalizedLegacy = normalizePlanState(legacyPlan, { assumeConfigured: true });
      const serializedLegacy = serializePlanState(
        normalizedLegacy,
        buildPlan(normalizedLegacy),
        {
          id: normalizedLegacy.id || buildPlanId(),
          createdAt: normalizedLegacy.createdAt || normalizedLegacy.updatedAt || new Date().toISOString(),
          updatedAt: normalizedLegacy.updatedAt || new Date().toISOString()
        }
      );
      const migratedStore = {
        source: PLAN_STORE_SOURCE,
        version: 1,
        activePlanId: serializedLegacy.id,
        plans: [serializedLegacy]
      };
      persistPlanStore(migratedStore);
      return migratedStore;
    }
  } catch {
    // ignore broken legacy payloads
  }

  return {
    source: PLAN_STORE_SOURCE,
    version: 1,
    activePlanId: '',
    plans: []
  };
}

export function readPlanList() {
  return readPlanStore().plans;
}

export function readPlanState() {
  const store = readPlanStore();
  const activePlan = store.plans.find((plan) => plan.id === store.activePlanId) || store.plans[0] || null;
  return activePlan || defaultPlanState;
}

export function persistPlanState(state, computed = buildPlan(state), { activate = true, mode = 'create' } = {}) {
  if (typeof window === 'undefined') {
    return serializePlanState(state, computed);
  }

  const store = readPlanStore();
  const timestamp = new Date().toISOString();
  const plans = [...store.plans];
  const existingIndex = state.id ? plans.findIndex((plan) => plan.id === state.id) : -1;
  const shouldUpdate = mode === 'replace' && existingIndex >= 0;
  const persisted = serializePlanState(state, computed, {
    id: shouldUpdate ? plans[existingIndex].id : buildPlanId(),
    createdAt: shouldUpdate ? plans[existingIndex].createdAt : timestamp,
    updatedAt: timestamp
  });

  if (shouldUpdate) {
    plans.splice(existingIndex, 1, persisted);
  } else {
    plans.unshift(persisted);
  }

  const nextStore = {
    source: PLAN_STORE_SOURCE,
    version: 1,
    activePlanId: activate ? persisted.id : (store.activePlanId || persisted.id),
    plans
  };

  persistPlanStore(nextStore);
  return persisted;
}

export function setActivePlanId(planId = '') {
  if (typeof window === 'undefined') {
    return null;
  }

  const store = readPlanStore();
  const activePlan = store.plans.find((plan) => plan.id === planId);
  if (!activePlan) {
    return null;
  }

  const nextStore = {
    ...store,
    activePlanId: activePlan.id
  };
  persistPlanStore(nextStore);
  return activePlan;
}
