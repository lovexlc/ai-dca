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
    id: String(dca.id || '').trim(),
    name: String(dca.name || '').trim(),
    symbol,
    initialInvestment: Number(dca.initialInvestment) || 0,
    recurringInvestment: Number(dca.recurringInvestment) || 0,
    frequency: String(dca.frequency || '每月').trim() || '每月',
    executionDay: Number(dca.executionDay) || 1,
    termMonths: Number(dca.termMonths) || 0,
    targetReturn: Number(dca.targetReturn) || 0,
    linkedPlanId: String(dca.linkedPlanId || '').trim(),
    isConfigured: dca.isConfigured !== false,
    createdAt: String(dca.createdAt || '').trim(),
    updatedAt: String(dca.updatedAt || '').trim()
  };
}

function normalizeDcaListPayload(payload = {}) {
  if (Array.isArray(payload.dcaList)) {
    return payload.dcaList
      .map((dca) => normalizeDca(dca))
      .filter((dca) => dca && dca.isConfigured);
  }

  const legacyDca = normalizeDca(payload.dca);
  return legacyDca && legacyDca.isConfigured ? [legacyDca] : [];
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
  const dcaList = normalizeDcaListPayload(payload);
  return {
    syncedAt: String(payload.syncedAt || new Date().toISOString()),
    plans: normalizeList(payload.plans)
      .map((plan) => normalizePlan(plan))
      .filter((plan) => plan && plan.isConfigured),
    dca: dcaList[0] || null,
    dcaList,
    marketAlerts: normalizeMarketAlerts(payload.marketAlerts),
    holdingAlerts: normalizeHoldingAlerts(payload.holdingAlerts)
  };
}

function normalizeAlertFundKind(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'exchange' || normalized === 'otc' || normalized === 'qdii' ? normalized : '';
}

function normalizeMarketAlertType(value = '') {
  const normalized = String(value || '').trim();
  if (normalized === 'discount') return 'premium-below';
  return ['gain', 'loss', 'premium', 'premium-below'].includes(normalized) ? normalized : 'gain';
}

function normalizeMarketAlerts(alerts = []) {
  if (!Array.isArray(alerts)) return [];
  return alerts
    .map(alert => ({
      id: String(alert.id || '').trim(),
      symbol: String(alert.symbol || '').trim(),
      name: String(alert.name || '').trim(),
      fundKind: normalizeAlertFundKind(alert.fundKind || alert.kind),
      alertType: normalizeMarketAlertType(alert.alertType),
      priceBase: ['daily', 'alert-day'].includes(alert.priceBase) ? alert.priceBase : '',
      alertDayPrice: Number(alert.alertDayPrice) || 0,
      threshold: Number(alert.threshold) || 0,
      enabled: alert.enabled !== false,
      cooldownHours: Number(alert.cooldownHours) || 24
    }))
    .filter(alert => alert.id && alert.symbol && alert.threshold > 0);
}

function normalizeHoldingAlerts(alerts = []) {
  if (!Array.isArray(alerts)) return [];
  return alerts
    .map(alert => ({
      id: String(alert.id || '').trim(),
      symbol: String(alert.symbol || '').trim(),
      name: String(alert.name || '').trim(),
      fundKind: normalizeAlertFundKind(alert.fundKind || alert.kind),
      alertType: ['gain', 'loss'].includes(alert.alertType) ? alert.alertType : 'gain',
      threshold: Number(alert.threshold) || 0,
      holdingCost: Number(alert.holdingCost) || 0,
      enabled: alert.enabled !== false,
      cooldownHours: Number(alert.cooldownHours) || 24
    }))
    .filter(alert => alert.id && alert.symbol && alert.threshold > 0 && alert.holdingCost > 0);
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

  const dcaRules = normalized.dcaList
    .map((dca) => {
      const linkedPlan = dca.linkedPlanId
        ? normalized.plans.find((plan) => plan.id === dca.linkedPlanId) || null
        : null;
      const dcaSymbol = linkedPlan?.symbol || dca.symbol || '';
      if (!dcaSymbol) {
        return null;
      }

      const fallbackRuleId = `dca:${dcaSymbol}:${dca.frequency}:${dca.executionDay}:${dca.linkedPlanId || 'standard'}`;
      return {
        ruleId: dca.id ? `dca:${dca.id}` : fallbackRuleId,
        type: 'dca-schedule',
        dcaId: dca.id,
        dcaName: dca.name,
        symbol: dcaSymbol,
        frequency: dca.frequency,
        executionDay: dca.executionDay,
        recurringInvestment: dca.recurringInvestment,
        linkedPlanId: linkedPlan?.id || '',
        linkedPlanName: linkedPlan?.name || dca.name || dcaSymbol,
        firstExecutionAmount: resolvePlanFirstLayerAmount(linkedPlan),
        enabled: true
      };
    })
    .filter(Boolean);

  const marketAlertRules = normalized.marketAlerts.map(alert => ({
    ruleId: alert.id,
    type: 'market-alert',
    symbol: alert.symbol,
    name: alert.name,
    fundKind: alert.fundKind,
    alertType: alert.alertType,
    priceBase: alert.priceBase,
    alertDayPrice: alert.alertDayPrice,
    threshold: alert.threshold,
    cooldownHours: alert.cooldownHours,
    enabled: alert.enabled
  }));

  const holdingAlertRules = normalized.holdingAlerts.map(alert => ({
    ruleId: alert.id,
    type: 'holding-alert',
    symbol: alert.symbol,
    name: alert.name,
    fundKind: alert.fundKind,
    alertType: alert.alertType,
    threshold: alert.threshold,
    holdingCost: alert.holdingCost,
    cooldownHours: alert.cooldownHours,
    enabled: alert.enabled
  }));

  return {
    normalized,
    planRules,
    dcaRules,
    marketAlertRules,
    holdingAlertRules,
    allRules: [...planRules, ...dcaRules, ...marketAlertRules, ...holdingAlertRules],
    summary: {
      planRuleCount: planRules.length,
      dcaRuleCount: dcaRules.length,
      marketAlertCount: marketAlertRules.length,
      holdingAlertCount: holdingAlertRules.length,
      totalRuleCount: planRules.length + dcaRules.length + marketAlertRules.length + holdingAlertRules.length
    }
  };
}
