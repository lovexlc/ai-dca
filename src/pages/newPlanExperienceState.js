import { useEffect, useRef } from 'react';
import { readPlanState } from '../app/plan.js';
import { EXTRA_SYMBOL_CODES } from '../app/extraSymbols.js';
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
    id: '',
    name: '',
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
