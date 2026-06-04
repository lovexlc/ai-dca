import { useEffect, useMemo, useRef, useState } from 'react';
import { formatCurrency, formatPercent } from '../app/accumulation.js';
import { readHomeDashboardState } from '../app/homeDashboard.js';
import { formatMarketCode, formatMarketLabel, formatMarketName } from '../app/marketDisplay.js';
import { loadLatestNasdaqPrices, loadNasdaqDailySeries } from '../app/nasdaqPrices.js';
import { syncTradePlanRules } from '../app/notifySync.js';
import { persistPlanState, readPlanState } from '../app/plan.js';
import { showToast } from '../app/toast.js';
import { NewPlanFooter, NewPlanHero, NewPlanStepNav } from './NewPlanShell.jsx';
import { NewPlanConfigCards } from './NewPlanConfigCards.jsx';
import { NewPlanSelectionCards } from './NewPlanSelectionCards.jsx';
import { NewPlanPreviewSidebar } from './NewPlanPreviewSidebar.jsx';

import {
  BENCHMARK_CODE,
  buildFixedDrawdownPlan,
  buildMovingAverageTemplatePlan,
  buildMovingAverageValues,
  findLatestFiniteValue,
  formatFundPrice,
  frequencyOptions,
  resolveMarketCurrency,
  strategyOptions
} from '../app/newPlan.js';
import { EXTRA_SYMBOL_CODES, findExtraSymbol } from '../app/extraSymbols.js';
import { fetchKline, fetchQuote } from '../app/marketsApi.js';
import { getAssetType, getAssetTypeLabel, getStrategyParams } from '../app/assetType.js';
import { validateScreening } from '../app/stockScreener.js';
import { trackActionResult, trackFeatureEvent } from '../app/analytics.js';

const PLAN_STEPS = [
  { id: 1, title: '选标的' },
  { id: 2, title: '选模板' },
  { id: 3, title: '调参数' },
  { id: 4, title: '预览确认' }
];


export function NewPlanExperience({ links, inPagesDir = false, embedded = false, onBack = null }) {
  const dashboardState = readHomeDashboardState();
  const [state, setState] = useState(() => {
    const template = readPlanState();
    return {
      ...template,
      id: '',
      name: '',
      isConfigured: false,
      createdAt: '',
      updatedAt: ''
    };
  });
  const [marketEntries, setMarketEntries] = useState([]);
  const [marketError, setMarketError] = useState('');
  const [dailySeriesState, setDailySeriesState] = useState({
    code: '',
    bars: [],
    ready: false
  });
  const [isSaving, setIsSaving] = useState(false);
  const autoSeedRef = useRef('');
  const isBasePriceDirtyRef = useRef(false);
  const isRiskPriceDirtyRef = useRef(false);
  const isNameDirtyRef = useRef(false);
  const [customDrawdown, setCustomDrawdown] = useState({
    enabled: false,
    levels: 6,
    firstDrop: 10,
    stepDrop: 5,
    multiplierMode: 'increment',
    multiplierBase: 1,
    multiplierStep: 0.5
  });
  const [extraQuote, setExtraQuote] = useState({ symbol: '', price: 0, currency: '', asOf: '', loading: false, error: '' });
  const [screeningAnswers, setScreeningAnswers] = useState(() => readPlanState().screeningAnswers || {});
  const [planStep, setPlanStep] = useState(1);
  const [maxUnlockedStep, setMaxUnlockedStep] = useState(1);
  const [symbolSearch, setSymbolSearch] = useState('');
  const prevSymbolRef = useRef('');
  const prevStrategyRef = useRef('');
  const prevFrequencyRef = useRef('');
  const newPlanMeta = () => ({
    embedded,
    step: planStep,
    maxUnlockedStep,
    symbolLength: String(state.symbol || '').trim().length,
    selectedStrategy: state.selectedStrategy || 'ma120-risk',
    selectedAssetType,
    marketEntryCount: marketEntries.length,
    filteredMarketEntryCount: filteredMarketEntries.length,
    hasMarketError: Boolean(marketError),
    hasSelectedFund: Boolean(selectedFund),
    isSelectedExtraSymbol,
    screeningOk: Boolean(screeningResult?.ok),
    layerCount: Array.isArray(computed?.layers) ? computed.layers.length : 0,
    customDrawdownEnabled: Boolean(customDrawdown.enabled)
  });

  // 选中美股快选标的（QQQ/SPY/Mag7/TSM 等）时，去 markets worker 拉一次实时 quote；symbol 不再是 extra 时清空。
  useEffect(() => {
    const sym = String(state.symbol || '').trim().toUpperCase();
    if (!sym || !EXTRA_SYMBOL_CODES.has(sym)) {
      setExtraQuote({ symbol: '', price: 0, currency: '', asOf: '', loading: false, error: '' });
      return undefined;
    }
    let cancelled = false;
    const startedAt = Date.now();
    trackFeatureEvent('new_plan', 'extra_quote_refresh_start', {
      symbolLength: sym.length
    });
    setExtraQuote({ symbol: sym, price: 0, currency: '', asOf: '', loading: true, error: '' });
    fetchQuote(sym).then((q) => {
      if (cancelled) return;
      const price = Number(q?.price) || 0;
      setExtraQuote({ symbol: sym, price, currency: String(q?.currency || ''), asOf: String(q?.asOf || ''), loading: false, error: '' });
      trackActionResult('new_plan', 'extra_quote_refresh', price > 0 ? 'success' : 'empty', {
        symbolLength: sym.length,
        hasPrice: price > 0,
        currency: String(q?.currency || ''),
        durationMs: Date.now() - startedAt
      });
    }).catch((err) => {
      if (cancelled) return;
      setExtraQuote({ symbol: sym, price: 0, currency: '', asOf: '', loading: false, error: err instanceof Error ? err.message : '行情获取失败' });
      trackActionResult('new_plan', 'extra_quote_refresh', 'error', {
        symbolLength: sym.length,
        durationMs: Date.now() - startedAt,
        errorName: err?.name || '',
        errorMessage: String(err?.message || err || '').slice(0, 160)
      });
    });
    return () => { cancelled = true; };
  }, [state.symbol]);

  // 拉到现价 + basePrice 仍为 0 时预填一次；不覆盖用户已输入的值。
  useEffect(() => {
    const sym = String(state.symbol || '').trim().toUpperCase();
    if (!sym || !EXTRA_SYMBOL_CODES.has(sym)) return;
    if (extraQuote.symbol !== sym || !(extraQuote.price > 0)) return;
    if (Number(state.basePrice) > 0) return;
    if (isBasePriceDirtyRef.current) return;
    setState((current) => ({ ...current, basePrice: extraQuote.price }));
  }, [extraQuote.symbol, extraQuote.price, state.symbol, state.basePrice]);

  useEffect(() => {
    let cancelled = false;
    const startedAt = Date.now();
    trackFeatureEvent('new_plan', 'market_entries_load_start', { inPagesDir });

    loadLatestNasdaqPrices({ inPagesDir })
      .then((entries) => {
        if (cancelled) {
          return;
        }

        setMarketEntries(entries);
        setMarketError('');
        trackActionResult('new_plan', 'market_entries_load', Array.isArray(entries) && entries.length ? 'success' : 'empty', {
          inPagesDir,
          entryCount: Array.isArray(entries) ? entries.length : 0,
          durationMs: Date.now() - startedAt
        });
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setMarketEntries([]);
        setMarketError(error instanceof Error ? error.message : '标的数据加载失败');
        trackActionResult('new_plan', 'market_entries_load', 'error', {
          inPagesDir,
          durationMs: Date.now() - startedAt,
          errorName: error?.name || '',
          errorMessage: String(error?.message || error || '').slice(0, 160)
        });
      });

    return () => {
      cancelled = true;
    };
  }, [inPagesDir]);

  useEffect(() => {
    if (!marketEntries.length) {
      return;
    }

    // 用户选中了美股快选标的（QQQ/VOO/Mag7/TSM）时，不要被基金清单覆盖。
    if (EXTRA_SYMBOL_CODES.has(String(state.symbol || '').trim())) {
      return;
    }

    const availableCodes = new Set(marketEntries.map((entry) => entry.code));
    const nonBenchmarkEntries = marketEntries.filter((entry) => entry.code !== BENCHMARK_CODE);
    const dashboardPreferredCode = String(dashboardState.selectedCode || '').trim();
    const preferredCode = availableCodes.has(String(state.symbol || '').trim())
      ? String(state.symbol || '').trim()
      : dashboardPreferredCode && dashboardPreferredCode !== BENCHMARK_CODE && availableCodes.has(dashboardPreferredCode)
        ? dashboardPreferredCode
        : nonBenchmarkEntries[0]?.code || marketEntries[0]?.code || '';

    if (preferredCode && preferredCode !== state.symbol) {
      setState((current) => ({ ...current, symbol: preferredCode }));
    }
  }, [dashboardState.selectedCode, marketEntries, state.symbol]);

  const selectedStrategy = state.selectedStrategy || 'ma120-risk';
  const selectedSymbolCode = String(state.symbol || '').trim().toUpperCase();
  const selectedExtraSymbol = findExtraSymbol(selectedSymbolCode);
  const isSelectedExtraSymbol = EXTRA_SYMBOL_CODES.has(selectedSymbolCode);
  const selectedFund = useMemo(
    () => marketEntries.find((entry) => entry.code === state.symbol) || null,
    [marketEntries, state.symbol]
  );
  const benchmarkFund = useMemo(
    () => marketEntries.find((entry) => entry.code === BENCHMARK_CODE) || selectedFund || null,
    [marketEntries, selectedFund]
  );
  const selectedFundCurrency = resolveMarketCurrency(selectedFund);
  const benchmarkCurrency = resolveMarketCurrency(benchmarkFund);
  const selectedInstrumentCurrency = isSelectedExtraSymbol ? (extraQuote.currency || selectedExtraSymbol?.currency || 'USD') : selectedFundCurrency;
  const selectedFundLabel = formatMarketLabel(selectedFund || selectedExtraSymbol || { code: state.symbol });
  const selectedAnchorNameLabel = formatMarketName(selectedFund || selectedExtraSymbol || { code: state.symbol });
  const benchmarkCodeLabel = formatMarketCode(benchmarkFund?.code || BENCHMARK_CODE);
  const benchmarkNameLabel = formatMarketName(benchmarkFund || { code: BENCHMARK_CODE });

  useEffect(() => {
    if (!isSelectedExtraSymbol && !benchmarkFund?.code) {
      setDailySeriesState({
        code: '',
        bars: [],
        ready: false
      });
      return;
    }

    let cancelled = false;
    const nextCode = isSelectedExtraSymbol ? selectedSymbolCode : benchmarkFund.code;
    const startedAt = Date.now();
    trackFeatureEvent('new_plan', 'daily_series_load_start', {
      symbolLength: String(nextCode || '').length,
      isSelectedExtraSymbol
    });

    setDailySeriesState({
      code: nextCode,
      bars: [],
      ready: false
    });

    const seriesPromise = isSelectedExtraSymbol
      ? fetchKline(nextCode, { timeframe: '1y' }).then((payload) => {
          const candles = Array.isArray(payload?.candles) ? payload.candles : Array.isArray(payload?.bars) ? payload.bars : [];
          return candles.map((bar) => ({
            datetime: bar.datetime || bar.date || bar.t || '',
            high: Number(bar.high ?? bar.h) || 0,
            close: Number(bar.close ?? bar.c) || 0
          }));
        })
      : loadNasdaqDailySeries(nextCode, { inPagesDir });

    seriesPromise
      .then((bars) => {
        if (!cancelled) {
          setDailySeriesState({
            code: nextCode,
            bars: Array.isArray(bars) ? bars : [],
            ready: true
          });
          trackActionResult('new_plan', 'daily_series_load', Array.isArray(bars) && bars.length ? 'success' : 'empty', {
            symbolLength: String(nextCode || '').length,
            isSelectedExtraSymbol,
            barCount: Array.isArray(bars) ? bars.length : 0,
            durationMs: Date.now() - startedAt
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDailySeriesState({
            code: nextCode,
            bars: [],
            ready: true
          });
          trackActionResult('new_plan', 'daily_series_load', 'error', {
            symbolLength: String(nextCode || '').length,
            isSelectedExtraSymbol,
            durationMs: Date.now() - startedAt
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [benchmarkFund?.code, inPagesDir, isSelectedExtraSymbol, selectedSymbolCode]);

  const selectedDailySeries = useMemo(
    () => {
      const expectedCode = isSelectedExtraSymbol ? selectedSymbolCode : benchmarkFund?.code;
      return dailySeriesState.code === expectedCode ? dailySeriesState.bars : [];
    },
    [benchmarkFund?.code, dailySeriesState.bars, dailySeriesState.code, isSelectedExtraSymbol, selectedSymbolCode]
  );
  const expectedDailySeriesCode = isSelectedExtraSymbol ? selectedSymbolCode : benchmarkFund?.code;
  const isSelectedDailySeriesReady = !expectedDailySeriesCode || (dailySeriesState.code === expectedDailySeriesCode && dailySeriesState.ready);
  const activeExtraQuotePrice = isSelectedExtraSymbol && extraQuote.symbol === selectedSymbolCode ? Number(extraQuote.price) || 0 : 0;

  const derivedStageHigh = useMemo(() => {
    const values = selectedDailySeries
      .flatMap((bar) => [Number(bar.high) || 0, Number(bar.close) || 0])
      .filter((value) => Number.isFinite(value) && value > 0);

    if (values.length) {
      return Math.max(...values);
    }

    if (isSelectedExtraSymbol) {
      return activeExtraQuotePrice;
    }

    return Number(benchmarkFund?.current_price) || Number(selectedFund?.current_price) || 0;
  }, [activeExtraQuotePrice, benchmarkFund, isSelectedExtraSymbol, selectedDailySeries, selectedFund]);
  const derivedMa120 = useMemo(
    () => {
      const ma120 = findLatestFiniteValue(buildMovingAverageValues(selectedDailySeries, 120));
      if (ma120 > 0) return ma120;
      if (isSelectedExtraSymbol) return activeExtraQuotePrice;
      return Number(benchmarkFund?.current_price) || Number(selectedFund?.current_price) || 0;
    },
    [activeExtraQuotePrice, benchmarkFund, isSelectedExtraSymbol, selectedDailySeries, selectedFund]
  );
  const derivedMa200 = useMemo(
    () => {
      const ma200 = findLatestFiniteValue(buildMovingAverageValues(selectedDailySeries, 200));
      if (ma200 > 0) return ma200;
      return derivedMa120 > 0 ? derivedMa120 * 0.85 : 0;
    },
    [derivedMa120, selectedDailySeries]
  );

  useEffect(() => {
    if (!isSelectedExtraSymbol && (!benchmarkFund?.code || !isSelectedDailySeriesReady)) {
      return;
    }

    if (isSelectedExtraSymbol && !isSelectedDailySeriesReady) {
      return;
    }

    const syncKey = `${selectedSymbolCode}:${selectedStrategy}:${isSelectedExtraSymbol ? `${derivedStageHigh}:${derivedMa120}:${derivedMa200}` : benchmarkFund?.code}`;
    if (autoSeedRef.current === syncKey) {
      return;
    }

    setState((current) => {
      const next = { ...current };
      if (!isBasePriceDirtyRef.current) {
        next.basePrice = selectedStrategy === 'peak-drawdown' ? derivedStageHigh : derivedMa120;
      }
      if (!isRiskPriceDirtyRef.current && selectedStrategy === 'ma120-risk') {
        next.riskControlPrice = derivedMa200;
      }
      return next;
    });
    autoSeedRef.current = syncKey;
  }, [activeExtraQuotePrice, benchmarkFund?.code, derivedMa120, derivedMa200, derivedStageHigh, isSelectedDailySeriesReady, isSelectedExtraSymbol, selectedStrategy, selectedSymbolCode]);

  const filteredMarketEntries = useMemo(() => {
    const keyword = symbolSearch.trim().toLowerCase();
    if (!keyword) return marketEntries;
    return marketEntries.filter((entry) => {
      const haystack = `${entry.code || ''} ${entry.name || ''} ${entry.display_name || ''}`.toLowerCase();
      return haystack.includes(keyword);
    });
  }, [marketEntries, symbolSearch]);

  const selectedAssetType = getAssetType(state.symbol);
  const selectedAssetTypeLabel = getAssetTypeLabel(state.symbol);
  const selectedStrategyParams = getStrategyParams(state.symbol);
  const screeningResult = useMemo(() => validateScreening(screeningAnswers), [screeningAnswers]);
  const activeStrategy = useMemo(
    () => strategyOptions.find((option) => option.key === selectedStrategy) || strategyOptions[0],
    [selectedStrategy]
  );
  const computed = useMemo(
    () => (selectedStrategy === 'peak-drawdown'
      ? buildFixedDrawdownPlan(state, selectedAssetType, customDrawdown)
      : buildMovingAverageTemplatePlan(state)),
    [selectedAssetType, selectedStrategy, state, customDrawdown]
  );
  const maxLayerWeight = useMemo(
    () => Math.max(...computed.layers.map((layer) => Number(layer.weight) || 0), 1),
    [computed.layers]
  );
  const selectedFrequencyLabel = frequencyOptions.find((item) => item.value === state.frequency)?.label || state.frequency;

  useEffect(() => {
    if (isNameDirtyRef.current) return;
    const code = String(state.symbol || '').trim();
    if (!code) return;
    const entry = marketEntries.find((e) => e.code === code) || null;
    const extra = findExtraSymbol(code);
    const codeLabel = formatMarketCode(code);
    const displayName = entry ? (entry.name || entry.display_name || '') : (extra ? extra.name : '');
    const labelLeft = displayName && displayName !== codeLabel ? `${codeLabel} ${displayName}` : codeLabel;
    let suffix = '';
    if (selectedStrategy === 'ma120-risk') {
      suffix = '120日均线策略';
    } else if (customDrawdown.enabled) {
      suffix = `${customDrawdown.levels}档固定回撤 (首-${customDrawdown.firstDrop}% 步-${customDrawdown.stepDrop}%)`;
    } else {
      suffix = `${computed.layers.length || 8}档固定回撤`;
    }
    const recommended = `${labelLeft} · ${suffix}`;
    if (recommended && recommended !== state.name) {
      setState((current) => ({ ...current, name: recommended }));
    }
  }, [state.symbol, selectedStrategy, customDrawdown.enabled, customDrawdown.levels, customDrawdown.firstDrop, customDrawdown.stepDrop, marketEntries, computed.layers.length, state.name]);

  function goToPlanStep(nextStep) {
    const target = Math.max(1, Math.min(4, Number(nextStep) || 1));
    if (target > maxUnlockedStep + 1) {
      showToast({ title: '先完成当前步骤', description: '请按顺序继续，避免跳到还没有上下文的预览。', tone: 'amber' });
      trackActionResult('new_plan', 'step_select', 'validation_error', {
        ...newPlanMeta(),
        targetStep: target,
        reason: 'step_locked'
      });
      return;
    }
    trackFeatureEvent('new_plan', 'step_select', {
      ...newPlanMeta(),
      fromStep: planStep,
      targetStep: target
    });
    setPlanStep(target);
    setMaxUnlockedStep((current) => Math.max(current, target));
  }

  async function handleCreatePlan() {
    if (isSaving) {
      return;
    }

    setIsSaving(true);
    const startedAt = Date.now();
    trackFeatureEvent('new_plan', 'create_start', newPlanMeta());
    persistPlanState({
      ...state,
      selectedStrategy,
      assetType: selectedAssetType,
      strategyParams: selectedStrategyParams,
      screeningAnswers,
      screeningResult,
      isConfigured: true
    }, computed, { mode: 'create', activate: true });

    let syncFailed = false;
    try {
      await syncTradePlanRules();
    } catch (_error) {
      // The local strategy has already been saved. Keep navigation responsive.
      syncFailed = true;
    } finally {
      showToast({
        title: '确认创建并返回总览成功',
        description: syncFailed ? '策略已保存，本次通知规则未同步。' : '策略已保存，正在返回总览。',
        tone: syncFailed ? 'amber' : 'emerald',
        persist: true
      });
      trackActionResult('new_plan', 'create', syncFailed ? 'partial' : 'success', {
        ...newPlanMeta(),
        syncFailed,
        durationMs: Date.now() - startedAt
      });
      if (typeof onBack === 'function') {
        // 嵌入在《交易计划》中使用：保存成功后返回交易计划视图，而不跳转到加仓计划首页。
        onBack();
      } else {
        window.location.href = links.home;
      }
    }
  }

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

  return (
    <>
      <NewPlanHero
        links={links}
        onBack={onBack}
        selectedFundCode={selectedFund?.code || state.symbol}
        benchmarkCodeLabel={benchmarkCodeLabel}
        activeStrategyLabel={activeStrategy.label}
        formatMarketCode={formatMarketCode}
      />

      <div className="mx-auto max-w-6xl space-y-6 px-6 pt-8">
        <NewPlanStepNav planSteps={PLAN_STEPS} planStep={planStep} maxUnlockedStep={maxUnlockedStep} goToPlanStep={goToPlanStep} />
        {/* 左侧主内容较宽随页面滚动，右侧成本预览上下文面板较窄并 sticky。 */}
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(360px,0.9fr)]">
          <div className="min-w-0 space-y-6">
            <NewPlanSelectionCards
              planStep={planStep}
              marketError={marketError}
              selectedAssetTypeLabel={selectedAssetTypeLabel}
              symbolSearch={symbolSearch}
              setSymbolSearch={setSymbolSearch}
              marketEntries={marketEntries}
              filteredMarketEntries={filteredMarketEntries}
              state={state}
              setState={setState}
              selectedFund={selectedFund}
              selectedFundLabel={selectedFundLabel}
              selectedFundCurrency={selectedFundCurrency}
              benchmarkNameLabel={benchmarkNameLabel}
              benchmarkFund={benchmarkFund}
              benchmarkCurrency={benchmarkCurrency}
              extraQuote={extraQuote}
              selectedStrategy={selectedStrategy}
              activeStrategyLabel={activeStrategy.label}
              selectedStrategyParams={selectedStrategyParams}
              frequencyOptions={frequencyOptions}
              selectedAssetType={selectedAssetType}
              screeningAnswers={screeningAnswers}
              setScreeningAnswers={setScreeningAnswers}
              screeningResult={screeningResult}
              derivedStageHigh={derivedStageHigh}
              derivedMa120={derivedMa120}
              derivedMa200={derivedMa200}
              isBasePriceDirtyRef={isBasePriceDirtyRef}
              isRiskPriceDirtyRef={isRiskPriceDirtyRef}
              formatFundPrice={formatFundPrice}
              formatPercent={formatPercent}
              formatMarketLabel={formatMarketLabel}
            />
            <NewPlanConfigCards
              planStep={planStep}
              selectedStrategy={selectedStrategy}
              activeStrategyLabel={activeStrategy.label}
              computed={computed}
              selectedFund={selectedFund}
              selectedFundLabel={selectedFundLabel}
              selectedFundCurrency={selectedFundCurrency}
              benchmarkNameLabel={benchmarkNameLabel}
              benchmarkFund={benchmarkFund}
              benchmarkCurrency={benchmarkCurrency}
              extraQuote={extraQuote}
              state={state}
              setState={setState}
              selectedAssetTypeLabel={selectedAssetTypeLabel}
              selectedStrategyParams={selectedStrategyParams}
              selectedFrequencyLabel={selectedFrequencyLabel}
              frequencyOptions={frequencyOptions}
              selectedInstrumentCurrency={selectedInstrumentCurrency}
              customDrawdown={customDrawdown}
              setCustomDrawdown={setCustomDrawdown}
              isBasePriceDirtyRef={isBasePriceDirtyRef}
              isRiskPriceDirtyRef={isRiskPriceDirtyRef}
              derivedStageHigh={derivedStageHigh}
              derivedMa120={derivedMa120}
              derivedMa200={derivedMa200}
              formatFundPrice={formatFundPrice}
              formatPercent={formatPercent}
              formatCurrency={formatCurrency}
              isNameDirtyRef={isNameDirtyRef}
            />
          </div>

          <NewPlanPreviewSidebar
            planStep={planStep}
            computed={computed}
            maxLayerWeight={maxLayerWeight}
            selectedStrategy={selectedStrategy}
            selectedInstrumentCurrency={selectedInstrumentCurrency}
            selectedAnchorNameLabel={selectedAnchorNameLabel}
            formatFundPrice={formatFundPrice}
            formatPercent={formatPercent}
            formatCurrency={formatCurrency}
          />
        </div>
      </div>

      <NewPlanFooter
        links={links}
        planStep={planStep}
        isSaving={isSaving}
        activeStrategy={activeStrategy}
        computed={computed}
        goToPlanStep={goToPlanStep}
        handleCreatePlan={handleCreatePlan}
        formatCurrency={formatCurrency}
      />
    </>
  );
}
