const DEFAULT_BENCHMARK_SYMBOL = 'nas-daq100';

function normalizeList(values) {
  return Array.isArray(values) ? values : [];
}

function normalizePlan(plan = {}) {
  const id = String(plan.id || '').trim();
  const symbol = String(plan.symbol || '').trim();

  if (!id || !symbol) {
    return null;
  }

  return {
    id,
    name: String(plan.name || '').trim(),
    symbol,
    totalBudget: Number(plan.totalBudget) || 0,
    cashReservePct: Number(plan.cashReservePct) || 0,
    basePrice: Number(plan.basePrice) || 0,
    riskControlPrice: Number(plan.riskControlPrice) || 0,
    selectedStrategy: String(plan.selectedStrategy || 'ma120-risk').trim() || 'ma120-risk',
    isConfigured: plan.isConfigured !== false,
    investableCapital: Number(plan.investableCapital) || 0,
    layerWeights: normalizeList(plan.layerWeights).map((value) => Number(value) || 0),
    triggerDrops: normalizeList(plan.triggerDrops).map((value) => Number(value) || 0),
    referenceSymbol: String(plan.referenceSymbol || DEFAULT_BENCHMARK_SYMBOL).trim() || DEFAULT_BENCHMARK_SYMBOL,
    createdAt: String(plan.createdAt || '').trim(),
    updatedAt: String(plan.updatedAt || '').trim()
  };
}

function normalizeDca(dca = null) {
  if (!dca || typeof dca !== 'object') {
    return null;
  }

  const symbol = String(dca.symbol || '').trim();
  if (!symbol) {
    return null;
  }

  return {
    symbol,
    initialInvestment: Number(dca.initialInvestment) || 0,
    recurringInvestment: Number(dca.recurringInvestment) || 0,
    frequency: String(dca.frequency || '每月').trim() || '每月',
    executionDay: Number(dca.executionDay) || 1,
    termMonths: Number(dca.termMonths) || 0,
    targetReturn: Number(dca.targetReturn) || 0,
    linkedPlanId: String(dca.linkedPlanId || '').trim()
  };
}

function resolveInvestableCapital(plan = {}) {
  const explicitCapital = Number(plan.investableCapital) || 0;
  if (explicitCapital > 0) {
    return explicitCapital;
  }

  const totalBudget = Number(plan.totalBudget) || 0;
  const cashReservePct = Math.max(Number(plan.cashReservePct) || 0, 0);
  return totalBudget * Math.max(0, 1 - cashReservePct / 100);
}

function resolvePlanFirstLayerAmount(plan = null) {
  if (!plan) {
    return 0;
  }

  const layerWeights = normalizeList(plan.layerWeights).map((value) => Math.max(Number(value) || 0, 0));
  const totalWeight = layerWeights.reduce((sum, value) => sum + value, 0) || 1;
  const firstWeight = layerWeights[0] || 0;
  return resolveInvestableCapital(plan) * (firstWeight / totalWeight);
}

export function normalizeNotifyPayload(payload = {}) {
  return {
    syncedAt: String(payload.syncedAt || new Date().toISOString()),
    plans: normalizeList(payload.plans)
      .map((plan) => normalizePlan(plan))
      .filter((plan) => plan && plan.isConfigured),
    dca: normalizeDca(payload.dca)
  };
}

export function compileNotifyRules(payload = {}) {
  const normalized = normalizeNotifyPayload(payload);
  const planRules = normalized.plans.map((plan) => ({
    ruleId: `plan:${plan.id}`,
    type: 'plan-monitor',
    planId: plan.id,
    planName: plan.name || `${plan.symbol} 建仓计划`,
    symbol: plan.symbol,
    referenceSymbol: plan.referenceSymbol,
    selectedStrategy: plan.selectedStrategy,
    totalBudget: plan.totalBudget,
    cashReservePct: plan.cashReservePct,
    basePrice: plan.basePrice,
    riskControlPrice: plan.riskControlPrice,
    layerWeights: plan.layerWeights,
    triggerDrops: plan.triggerDrops,
    enabled: true
  }));

  const linkedPlan = normalized.dca?.linkedPlanId
    ? normalized.plans.find((plan) => plan.id === normalized.dca.linkedPlanId) || null
    : null;
  const dcaSymbol = linkedPlan?.symbol || normalized.dca?.symbol || '';
  const dcaRules = normalized.dca && dcaSymbol
    ? [{
        ruleId: `dca:${dcaSymbol}:${normalized.dca.frequency}:${normalized.dca.executionDay}:${normalized.dca.linkedPlanId || 'standard'}`,
        type: 'dca-schedule',
        symbol: dcaSymbol,
        frequency: normalized.dca.frequency,
        executionDay: normalized.dca.executionDay,
        recurringInvestment: normalized.dca.recurringInvestment,
        linkedPlanId: linkedPlan?.id || '',
        linkedPlanName: linkedPlan?.name || dcaSymbol,
        firstExecutionAmount: resolvePlanFirstLayerAmount(linkedPlan),
        enabled: true
      }]
    : [];

  return {
    normalized,
    planRules,
    dcaRules,
    allRules: [...planRules, ...dcaRules],
    summary: {
      planRuleCount: planRules.length,
      dcaRuleCount: dcaRules.length,
      totalRuleCount: planRules.length + dcaRules.length
    }
  };
}
