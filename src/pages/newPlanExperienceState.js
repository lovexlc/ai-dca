import { useEffect, useRef } from 'react';
import { readPlanState } from '../app/plan.js';
import { EXTRA_SYMBOL_CODES, findExtraSymbol } from '../app/extraSymbols.js';
import { trackFeatureEvent } from '../app/analytics.js';

export function buildInitialPlanState(initialPlan = null) {
  if (initialPlan?.id) {
    return {
      ...readPlanState(),
      ...initialPlan,
      isConfigured: Boolean(initialPlan.isConfigured)
    };
  }

  const template = readPlanState();
  return {
    ...template,
    ...(initialPlan && typeof initialPlan === 'object' ? initialPlan : {}),
    id: '',
    name: String(initialPlan?.name || ''),
    isConfigured: false,
    createdAt: '',
    updatedAt: ''
  };
}

export function buildInitialCustomDrawdown(initialPlan = null) {
  const triggerDrops = Array.isArray(initialPlan?.triggerDrops) ? initialPlan.triggerDrops.map(Number).filter(Number.isFinite) : [];
  const layerWeights = Array.isArray(initialPlan?.layerWeights) ? initialPlan.layerWeights.map(Number).filter(Number.isFinite) : [];

  if (initialPlan?.selectedStrategy === 'peak-drawdown' && triggerDrops.length >= 2 && layerWeights.length >= 2) {
    return {
      enabled: true,
      levels: triggerDrops.length,
      firstDrop: triggerDrops[0],
      stepDrop: Math.max(triggerDrops[1] - triggerDrops[0], 1),
      multiplierMode: Math.abs((layerWeights[0] || 0) - (layerWeights[1] || 0)) < 0.01 ? 'fixed' : 'increment',
      multiplierBase: layerWeights[0] || 1,
      multiplierStep: Math.max((layerWeights[1] || layerWeights[0] || 1) - (layerWeights[0] || 1), 0)
    };
  }

  return {
    enabled: false,
    levels: 6,
    firstDrop: 10,
    stepDrop: 5,
    multiplierMode: 'increment',
    multiplierBase: 1,
    multiplierStep: 0.5
  };
}

export function buildPlanValidation({ state = {}, computed = {}, selectedAssetType = '', selectedStrategy = '', screeningResult = {} } = {}) {
  const blocking = [];
  const warnings = [];
  const symbol = String(state.symbol || '').trim();
  const totalBudget = Number(state.totalBudget);
  const basePrice = Number(state.basePrice);
  const riskControlPrice = Number(state.riskControlPrice);
  const investableCapital = Number(computed.investableCapital);

  if (!symbol) blocking.push({ step: 1, message: '请先选择或填写投资标的。' });
  if (!selectedStrategy) blocking.push({ step: 2, message: '请选择策略模板。' });
  if (!Number.isFinite(totalBudget) || totalBudget <= 0) blocking.push({ step: 3, message: '总投资额必须大于 0。' });
  if (!Number.isFinite(investableCapital) || investableCapital <= 0) blocking.push({ step: 3, message: '现金留存比例过高，当前可投入资金为 0。' });
  if (!Number.isFinite(basePrice) || basePrice <= 0) {
    blocking.push({ step: 3, message: selectedStrategy === 'peak-drawdown' ? '阶段高点必须大于 0。' : '120日线触发价必须大于 0。' });
  }

  if (selectedStrategy === 'ma120-risk' && (!Number.isFinite(riskControlPrice) || riskControlPrice <= 0)) warnings.push('200日线风控价为空，深水档位会缺少风控参考。');
  if (selectedAssetType === 'stock' && !screeningResult.passed) warnings.push(screeningResult.message || '个股自查尚未全部通过。');
  if ((computed.layers?.length || 0) > 8) warnings.push('档位数量较多，移动端执行时建议先展开确认明细。');

  return { blocking, warnings };
}

export function buildPlanChangeSummary({ initialPlan = null, isEditing = false, selectedStrategy = '', state = {}, computed = {} } = {}) {
  if (!isEditing || !initialPlan) return [];

  const changes = [];
  const changedNumber = (left, right, precision = 4) => Math.abs((Number(left) || 0) - (Number(right) || 0)) > 10 ** -precision;
  const normalizeList = (values = []) => (Array.isArray(values) ? values : []).map((value) => Number(value) || 0);
  const changedList = (left, right) => {
    const a = normalizeList(left);
    const b = normalizeList(right);
    if (a.length !== b.length) return true;
    return a.some((value, index) => Math.abs(value - b[index]) > 0.0001);
  };

  if (String(initialPlan.name || '') !== String(state.name || '')) changes.push('计划名称');
  if (String(initialPlan.symbol || '') !== String(state.symbol || '')) changes.push('投资标的');
  if (String(initialPlan.selectedStrategy || 'ma120-risk') !== String(selectedStrategy || 'ma120-risk')) changes.push('策略模板');
  if (changedNumber(initialPlan.totalBudget, state.totalBudget, 2)) changes.push('总投资额');
  if (changedNumber(initialPlan.cashReservePct, state.cashReservePct, 2)) changes.push('现金留存');
  if (changedNumber(initialPlan.basePrice, state.basePrice, 4)) changes.push(selectedStrategy === 'peak-drawdown' ? '阶段高点' : '120日线触发价');
  if (changedNumber(initialPlan.riskControlPrice, state.riskControlPrice, 4)) changes.push('200日线风控价');
  if (String(initialPlan.frequency || '') !== String(state.frequency || '')) changes.push('执行频率');
  if (changedList(initialPlan.layerWeights, computed.layerWeights) || changedList(initialPlan.triggerDrops, computed.triggerDrops)) changes.push('档位配置');

  return changes;
}

export function buildRecommendedPlanName({ symbol = '', marketEntries = [], selectedStrategy = '', customDrawdown = {}, layerCount = 0, formatMarketCode }) {
  const code = String(symbol || '').trim();
  if (!code) return '';

  const entry = marketEntries.find((item) => item.code === code) || null;
  const extra = findExtraSymbol(code);
  const codeLabel = typeof formatMarketCode === 'function' ? formatMarketCode(code) : code;
  const displayName = entry ? (entry.name || entry.display_name || '') : (extra ? extra.name : '');
  const labelLeft = displayName && displayName !== codeLabel ? `${codeLabel} ${displayName}` : codeLabel;

  if (selectedStrategy === 'ma120-risk') return `${labelLeft} · 120日均线策略`;
  if (customDrawdown.enabled) return `${labelLeft} · ${customDrawdown.levels}档固定回撤 (首-${customDrawdown.firstDrop}% 步-${customDrawdown.stepDrop}%)`;
  return `${labelLeft} · ${layerCount || 8}档固定回撤`;
}

export function useNewPlanChangeTracking({ state, selectedAssetType }) {
  const prevSymbolRef = useRef('');
  const prevStrategyRef = useRef('');
  const prevFrequencyRef = useRef('');

  useEffect(() => {
    const previous = prevSymbolRef.current;
    const current = String(state.symbol || '').trim();
    if (previous && previous !== current) {
      trackFeatureEvent('new_plan', 'symbol_change', {
        previousLength: previous.length,
        symbolLength: current.length,
        source: EXTRA_SYMBOL_CODES.has(current) ? 'extra_symbol' : 'fund_list'
      });
    }
    prevSymbolRef.current = current;
  }, [state.symbol]);

  useEffect(() => {
    const previous = prevStrategyRef.current;
    const current = state.selectedStrategy || 'ma120-risk';
    if (previous && previous !== current) {
      trackFeatureEvent('new_plan', 'strategy_change', {
        previousStrategy: previous,
        selectedStrategy: current,
        selectedAssetType
      });
    }
    prevStrategyRef.current = current;
  }, [state.selectedStrategy, selectedAssetType]);

  useEffect(() => {
    const previous = prevFrequencyRef.current;
    const current = state.frequency || '';
    if (previous && previous !== current) {
      trackFeatureEvent('new_plan', 'frequency_change', {
        previousFrequency: previous,
        frequency: current
      });
    }
    prevFrequencyRef.current = current;
  }, [state.frequency]);
}
