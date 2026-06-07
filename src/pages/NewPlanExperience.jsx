import { useEffect, useMemo, useRef, useState } from 'react';
import { formatCurrency, formatPercent } from '../app/accumulation.js';
import { readHomeDashboardState } from '../app/homeDashboard.js';
import { formatMarketCode, formatMarketLabel, formatMarketName } from '../app/marketDisplay.js';
import { loadLatestNasdaqPrices, loadNasdaqDailySeries } from '../app/nasdaqPrices.js';
import { syncTradePlanRules } from '../app/notifySync.js';
import { persistPlanState, readPlanState } from '../app/plan.js';
import { showToast } from '../app/toast.js';
import { NewPlanExperienceLayout } from './NewPlanExperienceLayout.jsx';
import { buildInitialCustomDrawdown, buildInitialPlanState, useNewPlanChangeTracking } from './newPlanExperienceState.js';

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
import { fetchKline, fetchQuote, fetchXueqiuFundData } from '../app/marketsApi.js';
import { getAssetType, getAssetTypeLabel, getStrategyParams } from '../app/assetType.js';
import { validateScreening } from '../app/stockScreener.js';
import { trackActionResult, trackFeatureEvent } from '../app/analytics.js';
import { getXueqiuQuote, resolveQuotePeakPrice } from '../app/xueqiuQuote.js';

export function NewPlanExperience({ links, inPagesDir = false, embedded = false, onBack = null, initialPlan = null, mode = 'create' }) {
  const isEditing = mode === 'replace' && Boolean(initialPlan?.id);
  const dashboardState = readHomeDashboardState();
  const [state, setState] = useState(() => buildInitialPlanState(initialPlan));
  const [marketEntries, setMarketEntries] = useState([]);
  const [marketError, setMarketError] = useState('');
  const [selectedDailySeriesState, setSelectedDailySeriesState] = useState({
    code: '',
    bars: [],
    ready: false
  });
  const [benchmarkDailySeriesState, setBenchmarkDailySeriesState] = useState({
    code: '',
    bars: [],
    ready: false
  });
  const [isSaving, setIsSaving] = useState(false);
  const autoSeedRef = useRef('');
  const isBasePriceDirtyRef = useRef(isEditing);
  const isRiskPriceDirtyRef = useRef(isEditing);
  const isNameDirtyRef = useRef(Boolean(initialPlan?.name));
  const [customDrawdown, setCustomDrawdown] = useState(() => buildInitialCustomDrawdown(initialPlan));
  const [extraQuote, setExtraQuote] = useState({ symbol: '', price: 0, high52w: 0, currency: '', asOf: '', loading: false, error: '' });
  const [xueqiuQuoteState, setXueqiuQuoteState] = useState({ symbol: '', quote: null, loading: false, error: '' });
  const [screeningAnswers, setScreeningAnswers] = useState(() => initialPlan?.screeningAnswers || readPlanState().screeningAnswers || {});
  const [planStep, setPlanStep] = useState(() => (isEditing ? 3 : 1));
  const [maxUnlockedStep, setMaxUnlockedStep] = useState(() => (isEditing ? 4 : 1));
  const [symbolSearch, setSymbolSearch] = useState('');
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
      setExtraQuote({ symbol: '', price: 0, high52w: 0, currency: '', asOf: '', loading: false, error: '' });
      return undefined;
    }
    let cancelled = false;
    const startedAt = Date.now();
    trackFeatureEvent('new_plan', 'extra_quote_refresh_start', {
      symbolLength: sym.length
    });
    setExtraQuote({ symbol: sym, price: 0, high52w: 0, currency: '', asOf: '', loading: true, error: '' });
    fetchQuote(sym).then((q) => {
      if (cancelled) return;
      const price = Number(q?.price) || 0;
      setExtraQuote({
        symbol: sym,
        price,
        high52w: resolveQuotePeakPrice(q),
        currency: String(q?.currency || ''),
        asOf: String(q?.asOf || ''),
        loading: false,
        error: ''
      });
      trackActionResult('new_plan', 'extra_quote_refresh', price > 0 ? 'success' : 'empty', {
        symbolLength: sym.length,
        hasPrice: price > 0,
        currency: String(q?.currency || ''),
        durationMs: Date.now() - startedAt
      });
    }).catch((err) => {
      if (cancelled) return;
      setExtraQuote({ symbol: sym, price: 0, high52w: 0, currency: '', asOf: '', loading: false, error: err instanceof Error ? err.message : '行情获取失败' });
      trackActionResult('new_plan', 'extra_quote_refresh', 'error', {
        symbolLength: sym.length,
        durationMs: Date.now() - startedAt,
        errorName: err?.name || '',
        errorMessage: String(err?.message || err || '').slice(0, 160)
      });
    });
    return () => { cancelled = true; };
  }, [state.symbol]);

  useEffect(() => {
    const sym = String(state.symbol || '').trim().toUpperCase();
    if (!sym || EXTRA_SYMBOL_CODES.has(sym) || !/^\d{6}$/.test(sym)) {
      setXueqiuQuoteState({ symbol: '', quote: null, loading: false, error: '' });
      return undefined;
    }

    let cancelled = false;
    const startedAt = Date.now();
    setXueqiuQuoteState({ symbol: sym, quote: null, loading: true, error: '' });
    trackFeatureEvent('new_plan', 'xueqiu_peak_refresh_start', {
      symbolLength: sym.length
    });

    fetchXueqiuFundData(sym, { raw: true }).then((payload) => {
      if (cancelled) return;
      const quote = getXueqiuQuote(payload);
      const peakPrice = resolveQuotePeakPrice(quote);
      setXueqiuQuoteState({ symbol: sym, quote, loading: false, error: '' });
      trackActionResult('new_plan', 'xueqiu_peak_refresh', peakPrice > 0 ? 'success' : 'empty', {
        symbolLength: sym.length,
        hasPeakPrice: peakPrice > 0,
        durationMs: Date.now() - startedAt
      });
    }).catch((err) => {
      if (cancelled) return;
      setXueqiuQuoteState({ symbol: sym, quote: null, loading: false, error: err instanceof Error ? err.message : '雪球高点获取失败' });
      trackActionResult('new_plan', 'xueqiu_peak_refresh', 'error', {
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
    if (!selectedSymbolCode) {
      setSelectedDailySeriesState({
        code: '',
        bars: [],
        ready: false
      });
      return;
    }

    let cancelled = false;
    const nextCode = selectedSymbolCode;
    const startedAt = Date.now();
    trackFeatureEvent('new_plan', 'daily_series_load_start', {
      symbolLength: String(nextCode || '').length,
      isSelectedExtraSymbol
    });

    setSelectedDailySeriesState({
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
          setSelectedDailySeriesState({
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
          setSelectedDailySeriesState({
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
  }, [inPagesDir, isSelectedExtraSymbol, selectedSymbolCode]);

  useEffect(() => {
    if (!benchmarkFund?.code) {
      setBenchmarkDailySeriesState({
        code: '',
        bars: [],
        ready: false
      });
      return;
    }

    let cancelled = false;
    const nextCode = benchmarkFund.code;
    const startedAt = Date.now();
    trackFeatureEvent('new_plan', 'benchmark_daily_series_load_start', {
      symbolLength: String(nextCode || '').length
    });

    setBenchmarkDailySeriesState({
      code: nextCode,
      bars: [],
      ready: false
    });

    loadNasdaqDailySeries(nextCode, { inPagesDir })
      .then((bars) => {
        if (!cancelled) {
          setBenchmarkDailySeriesState({
            code: nextCode,
            bars: Array.isArray(bars) ? bars : [],
            ready: true
          });
          trackActionResult('new_plan', 'benchmark_daily_series_load', Array.isArray(bars) && bars.length ? 'success' : 'empty', {
            symbolLength: String(nextCode || '').length,
            barCount: Array.isArray(bars) ? bars.length : 0,
            durationMs: Date.now() - startedAt
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBenchmarkDailySeriesState({
            code: nextCode,
            bars: [],
            ready: true
          });
          trackActionResult('new_plan', 'benchmark_daily_series_load', 'error', {
            symbolLength: String(nextCode || '').length,
            durationMs: Date.now() - startedAt
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [benchmarkFund?.code, inPagesDir]);

  const selectedDailySeries = useMemo(
    () => {
      const expectedCode = selectedSymbolCode;
      return selectedDailySeriesState.code === expectedCode ? selectedDailySeriesState.bars : [];
    },
    [selectedDailySeriesState.bars, selectedDailySeriesState.code, selectedSymbolCode]
  );
  const benchmarkDailySeries = useMemo(
    () => benchmarkDailySeriesState.code === benchmarkFund?.code ? benchmarkDailySeriesState.bars : [],
    [benchmarkDailySeriesState.bars, benchmarkDailySeriesState.code, benchmarkFund?.code]
  );
  const movingAverageDailySeries = isSelectedExtraSymbol ? selectedDailySeries : benchmarkDailySeries;
  const expectedSelectedDailySeriesCode = selectedSymbolCode;
  const isSelectedDailySeriesReady = !expectedSelectedDailySeriesCode || (selectedDailySeriesState.code === expectedSelectedDailySeriesCode && selectedDailySeriesState.ready);
  const expectedBenchmarkDailySeriesCode = benchmarkFund?.code;
  const isBenchmarkDailySeriesReady = !expectedBenchmarkDailySeriesCode || (benchmarkDailySeriesState.code === expectedBenchmarkDailySeriesCode && benchmarkDailySeriesState.ready);
  const activeExtraQuotePrice = isSelectedExtraSymbol && extraQuote.symbol === selectedSymbolCode ? Number(extraQuote.price) || 0 : 0;
  const activeExtraPeakPrice = isSelectedExtraSymbol && extraQuote.symbol === selectedSymbolCode ? resolveQuotePeakPrice(extraQuote) : 0;
  const activeXueqiuPeakPrice = !isSelectedExtraSymbol && xueqiuQuoteState.symbol === selectedSymbolCode
    ? resolveQuotePeakPrice(xueqiuQuoteState.quote)
    : 0;
  const hasQuotePeakPrice = activeXueqiuPeakPrice > 0 || activeExtraPeakPrice > 0;

  const derivedStageHigh = useMemo(() => {
    const values = selectedDailySeries
      .flatMap((bar) => [Number(bar.high) || 0, Number(bar.close) || 0])
      .filter((value) => Number.isFinite(value) && value > 0);

    if (activeXueqiuPeakPrice > 0) {
      return activeXueqiuPeakPrice;
    }

    if (activeExtraPeakPrice > 0) {
      return activeExtraPeakPrice;
    }

    if (values.length) {
      return Math.max(...values);
    }

    if (isSelectedExtraSymbol) {
      return activeExtraQuotePrice;
    }

    return Number(benchmarkFund?.current_price) || Number(selectedFund?.current_price) || 0;
  }, [activeExtraPeakPrice, activeExtraQuotePrice, activeXueqiuPeakPrice, benchmarkFund, isSelectedExtraSymbol, selectedDailySeries, selectedFund]);
  const derivedMa120 = useMemo(
    () => {
      const ma120 = findLatestFiniteValue(buildMovingAverageValues(movingAverageDailySeries, 120));
      if (ma120 > 0) return ma120;
      if (isSelectedExtraSymbol) return activeExtraQuotePrice;
      return Number(benchmarkFund?.current_price) || Number(selectedFund?.current_price) || 0;
    },
    [activeExtraQuotePrice, benchmarkFund, isSelectedExtraSymbol, movingAverageDailySeries, selectedFund]
  );
  const derivedMa200 = useMemo(
    () => {
      const ma200 = findLatestFiniteValue(buildMovingAverageValues(movingAverageDailySeries, 200));
      if (ma200 > 0) return ma200;
      return derivedMa120 > 0 ? derivedMa120 * 0.85 : 0;
    },
    [derivedMa120, movingAverageDailySeries]
  );

  useEffect(() => {
    if (selectedStrategy === 'peak-drawdown' && !hasQuotePeakPrice && !isSelectedDailySeriesReady) {
      return;
    }

    if (selectedStrategy !== 'peak-drawdown' && !isSelectedExtraSymbol && (!benchmarkFund?.code || !isBenchmarkDailySeriesReady)) {
      return;
    }

    if (selectedStrategy !== 'peak-drawdown' && isSelectedExtraSymbol && !isSelectedDailySeriesReady) {
      return;
    }

    const syncKey = `${selectedSymbolCode}:${selectedStrategy}:${benchmarkFund?.code || ''}:${derivedStageHigh}:${derivedMa120}:${derivedMa200}`;
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
  }, [activeExtraQuotePrice, benchmarkFund?.code, derivedMa120, derivedMa200, derivedStageHigh, hasQuotePeakPrice, isBenchmarkDailySeriesReady, isSelectedDailySeriesReady, isSelectedExtraSymbol, selectedStrategy, selectedSymbolCode]);

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
  const planValidation = useMemo(() => {
    const blocking = [];
    const warnings = [];
    const symbol = String(state.symbol || '').trim();
    const totalBudget = Number(state.totalBudget);
    const basePrice = Number(state.basePrice);
    const riskControlPrice = Number(state.riskControlPrice);
    const investableCapital = Number(computed.investableCapital);

    if (!symbol) {
      blocking.push({ step: 1, message: '请先选择或填写投资标的。' });
    }
    if (!selectedStrategy) {
      blocking.push({ step: 2, message: '请选择策略模板。' });
    }
    if (!Number.isFinite(totalBudget) || totalBudget <= 0) {
      blocking.push({ step: 3, message: '总投资额必须大于 0。' });
    }
    if (!Number.isFinite(investableCapital) || investableCapital <= 0) {
      blocking.push({ step: 3, message: '现金留存比例过高，当前可投入资金为 0。' });
    }
    if (!Number.isFinite(basePrice) || basePrice <= 0) {
      blocking.push({ step: 3, message: selectedStrategy === 'peak-drawdown' ? '阶段高点必须大于 0。' : '120日线触发价必须大于 0。' });
    }
    if (selectedStrategy === 'ma120-risk' && (!Number.isFinite(riskControlPrice) || riskControlPrice <= 0)) {
      warnings.push('200日线风控价为空，深水档位会缺少风控参考。');
    }
    if (selectedAssetType === 'stock' && !screeningResult.passed) {
      warnings.push(screeningResult.message || '个股自查尚未全部通过。');
    }
    if (computed.layers.length > 8) {
      warnings.push('档位数量较多，移动端执行时建议先展开确认明细。');
    }

    return { blocking, warnings };
  }, [computed.investableCapital, computed.layers.length, screeningResult.message, screeningResult.passed, selectedAssetType, selectedStrategy, state.basePrice, state.riskControlPrice, state.symbol, state.totalBudget]);
  const planChangeSummary = useMemo(() => {
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
  }, [computed.layerWeights, computed.triggerDrops, initialPlan, isEditing, selectedStrategy, state.basePrice, state.cashReservePct, state.frequency, state.name, state.riskControlPrice, state.symbol, state.totalBudget]);

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

    const blocking = planValidation.blocking[0];
    if (blocking) {
      setPlanStep(blocking.step);
      setMaxUnlockedStep((current) => Math.max(current, blocking.step));
      showToast({ title: '先完善加仓计划', description: blocking.message, tone: 'amber' });
      trackActionResult('new_plan', isEditing ? 'edit_save' : 'create', 'validation_error', {
        ...newPlanMeta(),
        reason: blocking.message
      });
      return;
    }

    setIsSaving(true);
    const startedAt = Date.now();
    trackFeatureEvent('new_plan', isEditing ? 'edit_save_start' : 'create_start', newPlanMeta());
    persistPlanState({
      ...state,
      selectedStrategy,
      assetType: selectedAssetType,
      strategyParams: selectedStrategyParams,
      screeningAnswers,
      screeningResult,
      isConfigured: true
    }, computed, { mode: isEditing ? 'replace' : 'create', activate: true });

    let syncFailed = false;
    try {
      await syncTradePlanRules();
    } catch {
      // The local strategy has already been saved. Keep navigation responsive.
      syncFailed = true;
    } finally {
      showToast({
        title: isEditing ? '加仓计划已更新' : '加仓计划已保存',
        description: syncFailed ? '计划已保存，本次提醒规则未同步。' : '计划已保存，提醒规则已同步。',
        tone: syncFailed ? 'amber' : 'emerald',
        persist: true
      });
      trackActionResult('new_plan', isEditing ? 'edit_save' : 'create', syncFailed ? 'partial' : 'success', {
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

  useNewPlanChangeTracking({ state, selectedAssetType });

  return (
    <NewPlanExperienceLayout
      activeStrategy={activeStrategy}
      benchmarkCodeLabel={benchmarkCodeLabel}
      benchmarkCurrency={benchmarkCurrency}
      benchmarkFund={benchmarkFund}
      benchmarkNameLabel={benchmarkNameLabel}
      computed={computed}
      customDrawdown={customDrawdown}
      derivedMa120={derivedMa120}
      derivedMa200={derivedMa200}
      derivedStageHigh={derivedStageHigh}
      extraQuote={extraQuote}
      filteredMarketEntries={filteredMarketEntries}
      formatCurrency={formatCurrency}
      formatFundPrice={formatFundPrice}
      formatMarketCode={formatMarketCode}
      formatMarketLabel={formatMarketLabel}
      formatPercent={formatPercent}
      frequencyOptions={frequencyOptions}
      goToPlanStep={goToPlanStep}
      handleCreatePlan={handleCreatePlan}
      isBasePriceDirtyRef={isBasePriceDirtyRef}
      isEditing={isEditing}
      isNameDirtyRef={isNameDirtyRef}
      isRiskPriceDirtyRef={isRiskPriceDirtyRef}
      isSaving={isSaving}
      links={links}
      marketEntries={marketEntries}
      marketError={marketError}
      maxLayerWeight={maxLayerWeight}
      maxUnlockedStep={maxUnlockedStep}
      onBack={onBack}
      planChangeSummary={planChangeSummary}
      planStep={planStep}
      planValidation={planValidation}
      screeningAnswers={screeningAnswers}
      screeningResult={screeningResult}
      selectedAnchorNameLabel={selectedAnchorNameLabel}
      selectedAssetType={selectedAssetType}
      selectedAssetTypeLabel={selectedAssetTypeLabel}
      selectedFund={selectedFund}
      selectedFundCurrency={selectedFundCurrency}
      selectedFundLabel={selectedFundLabel}
      selectedFrequencyLabel={selectedFrequencyLabel}
      selectedInstrumentCurrency={selectedInstrumentCurrency}
      selectedStrategy={selectedStrategy}
      selectedStrategyParams={selectedStrategyParams}
      setCustomDrawdown={setCustomDrawdown}
      setScreeningAnswers={setScreeningAnswers}
      setState={setState}
      setSymbolSearch={setSymbolSearch}
      state={state}
      symbolSearch={symbolSearch}
    />
  );
}
