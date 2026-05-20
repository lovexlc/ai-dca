import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, Save } from 'lucide-react';
import { formatCurrency, formatPercent } from '../app/accumulation.js';
import { readHomeDashboardState } from '../app/homeDashboard.js';
import { formatMarketCode, formatMarketLabel, formatMarketName } from '../app/marketDisplay.js';
import { loadLatestNasdaqPrices, loadNasdaqDailySeries } from '../app/nasdaqPrices.js';
import { syncTradePlanRules } from '../app/notifySync.js';
import { persistPlanState, readPlanState } from '../app/plan.js';
import { showToast } from '../app/toast.js';
import { Card, Field, NumberInput, PageHero, Pill, SectionHeading, SelectField, TextInput, cx, primaryButtonClass, secondaryButtonClass } from '../components/experience-ui.jsx';

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
import { EXTRA_SYMBOL_GROUPS, EXTRA_SYMBOL_CODES, findExtraSymbol, isExtraSymbol } from '../app/extraSymbols.js';
import { fetchQuote } from '../app/marketsApi.js';
import { getAssetType, getAssetTypeLabel, getStrategyParams } from '../app/assetType.js';
import { SCREENING_CHECKLIST, validateScreening } from '../app/stockScreener.js';

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

  // 选中美股快选标的（QQQ/SPY/Mag7/TSM 等）时，去 markets worker 拉一次实时 quote；symbol 不再是 extra 时清空。
  useEffect(() => {
    const sym = String(state.symbol || '').trim().toUpperCase();
    if (!sym || !EXTRA_SYMBOL_CODES.has(sym)) {
      if (extraQuote.symbol) {
        setExtraQuote({ symbol: '', price: 0, currency: '', asOf: '', loading: false, error: '' });
      }
      return undefined;
    }
    if (extraQuote.symbol === sym) return undefined;
    let cancelled = false;
    setExtraQuote({ symbol: sym, price: 0, currency: '', asOf: '', loading: true, error: '' });
    fetchQuote(sym).then((q) => {
      if (cancelled) return;
      const price = Number(q?.price) || 0;
      setExtraQuote({ symbol: sym, price, currency: String(q?.currency || ''), asOf: String(q?.asOf || ''), loading: false, error: '' });
    }).catch((err) => {
      if (cancelled) return;
      setExtraQuote({ symbol: sym, price: 0, currency: '', asOf: '', loading: false, error: err instanceof Error ? err.message : '行情获取失败' });
    });
    return () => { cancelled = true; };
  }, [state.symbol, extraQuote.symbol]);

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

    loadLatestNasdaqPrices({ inPagesDir })
      .then((entries) => {
        if (cancelled) {
          return;
        }

        setMarketEntries(entries);
        setMarketError('');
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setMarketEntries([]);
        setMarketError(error instanceof Error ? error.message : '标的数据加载失败');
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
  const selectedFundLabel = formatMarketLabel(selectedFund || { code: state.symbol });
  const benchmarkCodeLabel = formatMarketCode(benchmarkFund?.code || BENCHMARK_CODE);
  const benchmarkNameLabel = formatMarketName(benchmarkFund || { code: BENCHMARK_CODE });

  useEffect(() => {
    if (!benchmarkFund?.code) {
      setDailySeriesState({
        code: '',
        bars: [],
        ready: false
      });
      return;
    }

    let cancelled = false;
    const nextCode = benchmarkFund.code;

    setDailySeriesState({
      code: nextCode,
      bars: [],
      ready: false
    });

    loadNasdaqDailySeries(nextCode, { inPagesDir })
      .then((bars) => {
        if (!cancelled) {
          setDailySeriesState({
            code: nextCode,
            bars: Array.isArray(bars) ? bars : [],
            ready: true
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
        }
      });

    return () => {
      cancelled = true;
    };
  }, [benchmarkFund?.code, inPagesDir]);

  const selectedDailySeries = useMemo(
    () => (dailySeriesState.code === benchmarkFund?.code ? dailySeriesState.bars : []),
    [benchmarkFund?.code, dailySeriesState.bars, dailySeriesState.code]
  );
  const isSelectedDailySeriesReady = !benchmarkFund?.code || (dailySeriesState.code === benchmarkFund.code && dailySeriesState.ready);

  const derivedStageHigh = useMemo(() => {
    const values = selectedDailySeries
      .flatMap((bar) => [Number(bar.high) || 0, Number(bar.close) || 0])
      .filter((value) => Number.isFinite(value) && value > 0);

    if (values.length) {
      return Math.max(...values);
    }

    return Number(benchmarkFund?.current_price) || Number(selectedFund?.current_price) || 0;
  }, [benchmarkFund, selectedDailySeries, selectedFund]);
  const derivedMa120 = useMemo(
    () => findLatestFiniteValue(buildMovingAverageValues(selectedDailySeries, 120)) || Number(benchmarkFund?.current_price) || Number(selectedFund?.current_price) || 0,
    [benchmarkFund, selectedDailySeries, selectedFund]
  );
  const derivedMa200 = useMemo(
    () => findLatestFiniteValue(buildMovingAverageValues(selectedDailySeries, 200)) || (derivedMa120 > 0 ? derivedMa120 * 0.85 : 0),
    [selectedDailySeries, derivedMa120]
  );

  useEffect(() => {
    if (!benchmarkFund?.code || !isSelectedDailySeriesReady) {
      return;
    }

    const syncKey = `${benchmarkFund.code}:${selectedStrategy}`;
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
  }, [benchmarkFund?.code, derivedMa120, derivedMa200, derivedStageHigh, isSelectedDailySeriesReady, selectedStrategy]);

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
      return;
    }
    setPlanStep(target);
    setMaxUnlockedStep((current) => Math.max(current, target));
  }

  async function handleCreatePlan() {
    if (isSaving) {
      return;
    }

    setIsSaving(true);
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
      if (typeof onBack === 'function') {
        // 嵌入在《交易计划》中使用：保存成功后返回交易计划视图，而不跳转到加仓计划首页。
        onBack();
      } else {
        window.location.href = links.home;
      }
    }
  }

  return (
    <>
      <PageHero
        backHref={onBack ? undefined : links.home}
        onBack={onBack || undefined}
        backLabel={onBack ? '返回交易计划' : '返回加仓计划'}
        eyebrow="策略新建"
        title="新建建仓计划"
        badges={[
          <Pill key="symbol" tone="indigo">{formatMarketCode(selectedFund?.code || state.symbol) || '未选择标的'}</Pill>,
          <Pill key="benchmark" tone="slate">{benchmarkCodeLabel}</Pill>,
          <Pill key="strategy" tone="slate">{activeStrategy.label}</Pill>
        ]}
      />

      <div className="mx-auto max-w-6xl space-y-6 px-6 pt-8">
        <nav aria-label="新建策略步骤" className="grid gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:grid-cols-4">
          {PLAN_STEPS.map((step) => (
            <button
              key={step.id}
              type="button"
              onClick={() => goToPlanStep(step.id)}
              aria-current={planStep === step.id ? 'step' : undefined}
              aria-disabled={step.id > maxUnlockedStep + 1}
              className={cx(
                'rounded-xl px-3 py-2 text-left text-sm font-semibold transition-colors',
                planStep === step.id
                  ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-200'
                  : step.id > maxUnlockedStep + 1
                    ? 'cursor-not-allowed text-slate-300'
                    : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
              )}
            >
              <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/20 text-xs">{step.id}</span>
              {step.title}
            </button>
          ))}
        </nav>
        {/* 左侧主内容较宽随页面滚动，右侧成本预览上下文面板较窄并 sticky。 */}
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(360px,0.9fr)]">
          <div className="min-w-0 space-y-6">
            <Card className={cx("min-w-0 overflow-hidden", planStep !== 1 && "hidden")}>
              <SectionHeading eyebrow="第一步" title="选择标的" />

              {marketError ? (
                <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                  标的数据暂时加载失败：{marketError}
                </div>
              ) : null}

              <div className="mt-6 space-y-5">
                <div className="rounded-2xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm font-semibold text-indigo-800">
                  当前类型：{selectedAssetTypeLabel}
                </div>
                <Field className="min-w-0" label="资产标的" helper="可搜索纳指 ETF，或使用美股快捷分组。">
                  <TextInput
                    className="mb-3"
                    aria-label="搜索标的"
                    aria-describedby="new-plan-symbol-help"
                    placeholder="搜索代码或名称，例如 QQQ / 513100 / 纳指"
                    value={symbolSearch}
                    onChange={(event) => setSymbolSearch(event.target.value)}
                  />
                  <div id="new-plan-symbol-help" className="sr-only">输入代码或名称筛选标的，下方也可使用快捷标的按钮。</div>
                  <details className="mb-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
                    <summary className="cursor-pointer text-xs font-semibold text-slate-500">快捷美股标的</summary>
                    <div className="mt-3 space-y-2">
                      {EXTRA_SYMBOL_GROUPS.map((group) => (
                      <div key={group.key} className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold text-slate-500">{group.label}</span>
                        {group.symbols.map((s) => (
                          <button
                            key={s.code}
                            type="button"
                            onClick={() => {
                              autoSeedRef.current = s.code;
                              setState((current) => ({ ...current, symbol: s.code }));
                            }}
                            className={cx(
                              'rounded-full border px-3 py-1 text-xs font-semibold transition-all',
                              state.symbol === s.code
                                ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                                : 'border-slate-200 bg-white text-slate-500 hover:border-indigo-200 hover:text-indigo-600'
                            )}
                            title={s.name}
                          >
                            {s.code}
                          </button>
                        ))}
                        <span className="text-xs text-slate-400">{group.note}</span>
                      </div>
                      ))}
                    </div>
                  </details>
                  {marketEntries.length ? (
                    <>
                      <div className="mb-2 text-xs font-semibold text-slate-400">纳指 ETF 下拉 · {filteredMarketEntries.length}/{marketEntries.length}</div>
                      <SelectField
                      className="min-w-0"
                      options={(() => {
                        const opts = filteredMarketEntries.map((entry) => ({
                          label: formatMarketLabel(entry),
                          value: entry.code
                        }));
                        const sym = String(state.symbol || '').trim();
                        if (sym && !opts.some((o) => o.value === sym)) {
                          const extra = findExtraSymbol(sym);
                          opts.unshift({ label: extra ? `${sym} · ${extra.name}（美股快选）` : sym, value: sym });
                        }
                        return opts;
                      })()}
                      value={state.symbol}
                      onChange={(event) => setState((current) => ({ ...current, symbol: event.target.value }))}
                      />
                    </>
                  ) : (
                    <NumberInput
                      value={state.symbol}
                      onChange={(event) => setState((current) => ({ ...current, symbol: event.target.value }))}
                    />
                  )}
                </Field>

                <div className="hidden" data-step-advanced-fields>
                {selectedFund ? (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
                    <div className="font-semibold text-slate-900">{selectedFundLabel}</div>
                    <div className="mt-1">当前现价 {formatFundPrice(selectedFund.current_price, selectedFundCurrency)}</div>
                    <div className="mt-1">策略参考基准 {benchmarkNameLabel}，{formatFundPrice(benchmarkFund?.current_price, benchmarkCurrency)}</div>
                  </div>
                ) : isExtraSymbol(state.symbol) ? (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800">
                    <div className="font-semibold text-slate-900">
                      {state.symbol}·{findExtraSymbol(state.symbol)?.name || ''}
                    </div>
                    {extraQuote.symbol === String(state.symbol || '').trim().toUpperCase() && extraQuote.price > 0 ? (
                      <div className="mt-1">当前现价 {formatFundPrice(extraQuote.price, extraQuote.currency || 'USD')}{extraQuote.asOf ? ` · ${new Date(extraQuote.asOf).toLocaleString('zh-CN', { hour12: false })}` : ''}{extraQuote.asOf ? '' : ''}</div>
                    ) : extraQuote.symbol === String(state.symbol || '').trim().toUpperCase() && extraQuote.loading ? (
                      <div className="mt-1">正在拉取实时行情…</div>
                    ) : extraQuote.symbol === String(state.symbol || '').trim().toUpperCase() && extraQuote.error ? (
                      <div className="mt-1 text-rose-700">行情获取失败：{extraQuote.error}；请手动填写下方的「触发价」与「风控价」。</div>
                    ) : null}
                    <div className="mt-1 text-amber-700">提示：QQQ/SPY/VOO 等宽基指数只买不做 T；Mag7 / TSM 允许 70% 核仓 + 30% T 仓（后续 PR 会自动应用该规则）。</div>
                  </div>
                ) : null}


                <div className="rounded-2xl border border-indigo-100 bg-indigo-50 px-4 py-4 text-sm text-indigo-800">
                  <div className="font-semibold text-indigo-900">{selectedAssetTypeLabel}模式</div>
                  <div className="mt-1">首买跌幅 {formatPercent(selectedStrategyParams.firstBuyDrop, 1)} · 加仓步长 {formatPercent(selectedStrategyParams.stepDrop, 1)} · {selectedStrategyParams.levels} 档</div>
                  <div className="mt-1">倍数 {selectedStrategyParams.multipliers.join(' / ')} · 高位投入 {formatPercent(selectedStrategyParams.highLevelRatio * 100, 0)}</div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="总投资额">
                    <NumberInput step="0.01" value={state.totalBudget} onChange={(event) => setState((current) => ({ ...current, totalBudget: Number(event.target.value) || 0 }))} />
                  </Field>
                  <Field label={selectedStrategy === 'peak-drawdown' ? '阶段高点' : '120日线触发价'}>
                    <div className="flex items-center gap-2">
                      <NumberInput className="flex-1" step="0.001" value={state.basePrice} onChange={(event) => { isBasePriceDirtyRef.current = true; setState((current) => ({ ...current, basePrice: Number(event.target.value) || 0 })); }} />
                      <button type="button" title="重置为系统推荐值" className="shrink-0 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100" onClick={() => { isBasePriceDirtyRef.current = false; const sym = String(state.symbol || '').trim().toUpperCase(); const usingExtra = EXTRA_SYMBOL_CODES.has(sym) && extraQuote.symbol === sym && extraQuote.price > 0; const next = selectedStrategy === 'peak-drawdown' ? (usingExtra ? extraQuote.price : derivedStageHigh) : (usingExtra ? extraQuote.price : derivedMa120); setState((current) => ({ ...current, basePrice: Number(next) || 0 })); }}>推荐</button>
                    </div>
                  </Field>
                </div>

                {selectedStrategy === 'ma120-risk' ? (
                  <Field label="200日线风控价" helper="当它足够低于120日线深水层时，会进入最后一档。">
                    <div className="flex items-center gap-2">
                      <NumberInput className="flex-1" step="0.001" value={state.riskControlPrice} onChange={(event) => { isRiskPriceDirtyRef.current = true; setState((current) => ({ ...current, riskControlPrice: Number(event.target.value) || 0 })); }} />
                      <button type="button" title="重置为系统推荐值" className="shrink-0 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100" onClick={() => { isRiskPriceDirtyRef.current = false; setState((current) => ({ ...current, riskControlPrice: Number(derivedMa200) || 0 })); }}>推荐</button>
                    </div>
                  </Field>
                ) : null}

                <Field
                  label="现金留存比例"
                  rightLabel={formatPercent(state.cashReservePct, 0)}
                  helper="默认留一部分现金给后续补仓，不把预算一次性全部打满。"
                >
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
                    <input className="h-2 w-full accent-indigo-600" max="90" min="0" step="1" type="range" value={state.cashReservePct} onChange={(event) => setState((current) => ({ ...current, cashReservePct: Number(event.target.value) || 0 }))} />
                    <div className="mt-3 flex items-center justify-between text-xs font-semibold text-slate-400">
                      <span>0%</span>
                      <span>保守</span>
                      <span>90%</span>
                    </div>
                  </div>
                </Field>

                <Field label="执行频率">
                  <SelectField options={frequencyOptions} value={state.frequency} onChange={(event) => setState((current) => ({ ...current, frequency: event.target.value }))} />
                </Field>
                </div>
              </div>
            </Card>

            <Card className={cx("min-w-0 overflow-hidden", planStep !== 2 && "hidden")}>
              <SectionHeading eyebrow="第二步" title="选择策略模板" />

              <div className="mt-6 grid gap-4 md:grid-cols-2">
                {strategyOptions.map((option) => (
                  <button
                    key={option.key}
                    className={cx(
                      'rounded-[24px] border px-5 py-5 text-left transition-all',
                      selectedStrategy === option.key
                        ? 'border-indigo-200 bg-indigo-50 shadow-sm shadow-indigo-100'
                        : 'border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white'
                    )}
                    type="button"
                    onClick={() => setState((current) => ({ ...current, selectedStrategy: option.key }))}
                  >
                    <div className="text-sm font-semibold text-slate-900">{option.label}</div>
                    <div className="mt-2 text-sm leading-6 text-slate-500">{option.note}</div>
                  </button>
                ))}
              </div>

                <div className="mt-5 rounded-[24px] border border-indigo-100 bg-gradient-to-br from-indigo-50 via-white to-white p-5">
                  <div className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-500">当前模板说明</div>
                  <div className="mt-2 text-lg font-bold text-indigo-700">{activeStrategy.label}</div>
                  <div className="mt-2 text-sm font-semibold text-slate-700">参考基准 {benchmarkNameLabel}</div>
                  <p className="mt-3 text-sm leading-6 text-slate-500">第三步再确认总金额、频率和风险档位；高级价格表默认折叠。</p>
                  <div className="mt-4 inline-flex rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-500">
                    首页仅查看策略结果，如需调整请回到本页重新创建
                  </div>
                </div>
            </Card>

            {selectedAssetType === 'stock' ? (
              <Card className={cx("min-w-0 overflow-hidden border-amber-200 bg-amber-50", planStep !== 2 && "hidden")}>
                <SectionHeading eyebrow="个股自查" title="基本面 checklist" />
                <div className="mt-5 grid gap-3">
                  {SCREENING_CHECKLIST.map((item) => (
                    <label key={item.id} className="flex items-start gap-3 rounded-2xl border border-amber-100 bg-white/80 px-4 py-3 text-sm">
                      <input type="checkbox" className="mt-1 h-4 w-4 accent-amber-600" checked={Boolean(screeningAnswers[item.id])} onChange={(event) => setScreeningAnswers((current) => ({ ...current, [item.id]: event.target.checked }))} />
                      <span>
                        <span className="font-semibold text-slate-900">{item.label}{item.critical ? ' · 关键' : ''}</span>
                        <span className="mt-1 block text-slate-500">{item.description}</span>
                      </span>
                    </label>
                  ))}
                </div>
                {!screeningResult.passed ? <div className="mt-4 rounded-2xl border border-amber-200 bg-white px-4 py-3 text-sm text-amber-800">{screeningResult.message}</div> : null}
              </Card>
            ) : null}

            <Card className={cx("min-w-0 overflow-hidden", planStep !== 3 && "hidden")}>
              <SectionHeading
                eyebrow="第三步"
                title={selectedStrategy === 'peak-drawdown' ? `固定回撤 ${computed.layers.length} 档` : '均线分层设置'}
              />
              <div data-step-three-params="true">
              <div className="mt-6 space-y-5">
                {selectedFund ? (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
                    <div className="font-semibold text-slate-900">{selectedFundLabel}</div>
                    <div className="mt-1">当前现价 {formatFundPrice(selectedFund.current_price, selectedFundCurrency)}</div>
                    <div className="mt-1">策略参考基准 {benchmarkNameLabel}，{formatFundPrice(benchmarkFund?.current_price, benchmarkCurrency)}</div>
                  </div>
                ) : isExtraSymbol(state.symbol) ? (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800">
                    <div className="font-semibold text-slate-900">{state.symbol}·{findExtraSymbol(state.symbol)?.name || ''}</div>
                    {extraQuote.symbol === String(state.symbol || '').trim().toUpperCase() && extraQuote.price > 0 ? (
                      <div className="mt-1">当前现价 {formatFundPrice(extraQuote.price, extraQuote.currency || 'USD')}{extraQuote.asOf ? ` · ${new Date(extraQuote.asOf).toLocaleString('zh-CN', { hour12: false })}` : ''}</div>
                    ) : extraQuote.symbol === String(state.symbol || '').trim().toUpperCase() && extraQuote.loading ? (
                      <div className="mt-1">正在拉取实时行情…</div>
                    ) : extraQuote.symbol === String(state.symbol || '').trim().toUpperCase() && extraQuote.error ? (
                      <div className="mt-1 text-rose-700">行情获取失败：{extraQuote.error}；请手动填写下方价格。</div>
                    ) : null}
                  </div>
                ) : null}
                <div className="rounded-2xl border border-indigo-100 bg-indigo-50 px-4 py-4 text-sm text-indigo-800">
                  <div className="font-semibold text-indigo-900">{selectedAssetTypeLabel}模式</div>
                  <div className="mt-1">首买跌幅 {formatPercent(selectedStrategyParams.firstBuyDrop, 1)} · 加仓步长 {formatPercent(selectedStrategyParams.stepDrop, 1)} · {selectedStrategyParams.levels} 档</div>
                  <div className="mt-1">倍数 {selectedStrategyParams.multipliers.join(' / ')} · 高位投入 {formatPercent(selectedStrategyParams.highLevelRatio * 100, 0)}</div>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="总投资额">
                    <NumberInput step="0.01" value={state.totalBudget} onChange={(event) => setState((current) => ({ ...current, totalBudget: Number(event.target.value) || 0 }))} />
                  </Field>
                  <Field label="执行频率">
                    <SelectField options={frequencyOptions} value={state.frequency} onChange={(event) => setState((current) => ({ ...current, frequency: event.target.value }))} />
                  </Field>
                </div>
                <Field label="现金留存比例" rightLabel={formatPercent(state.cashReservePct, 0)}>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
                    <input aria-label="现金留存比例" className="h-2 w-full accent-indigo-600" max="90" min="0" step="1" type="range" value={state.cashReservePct} onChange={(event) => setState((current) => ({ ...current, cashReservePct: Number(event.target.value) || 0 }))} />
                  </div>
                </Field>
              </div>
              </div>

              {selectedStrategy === 'peak-drawdown' ? (
                <details className="mt-6 rounded-[24px] border border-indigo-200 bg-indigo-50/40 p-4">
                  <summary className="cursor-pointer text-sm font-semibold text-indigo-700">高级自定义固定回撤参数</summary>
                  <div className="mt-4 space-y-4">
                    <label className="flex items-center gap-2 text-sm font-semibold text-indigo-900">
                      <input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={customDrawdown.enabled} onChange={(e) => setCustomDrawdown((c) => ({ ...c, enabled: e.target.checked }))} />
                      开启自定义参数（关闭则使用系统推荐档位）
                    </label>
                    <div className={cx('grid gap-4 md:grid-cols-2', !customDrawdown.enabled && 'opacity-50 pointer-events-none')}>
                      <Field label="建仓总档数" rightLabel={`${customDrawdown.levels} 档`} helper="范围 4 ~ 10 档">
                        <input type="range" min="4" max="10" step="1" className="h-2 w-full accent-indigo-600" value={customDrawdown.levels} onChange={(e) => setCustomDrawdown((c) => ({ ...c, levels: Number(e.target.value) || 6 }))} />
                      </Field>
                      <Field label="首档下跌触发" rightLabel={`-${customDrawdown.firstDrop}%`} helper="范围 -5% ~ -15%">
                        <input type="range" min="5" max="15" step="1" className="h-2 w-full accent-indigo-600" value={customDrawdown.firstDrop} onChange={(e) => setCustomDrawdown((c) => ({ ...c, firstDrop: Number(e.target.value) || 10 }))} />
                      </Field>
                      <Field label="阶梯步长" rightLabel={`-${customDrawdown.stepDrop}%`} helper="范围 -2% ~ -8%">
                        <input type="range" min="2" max="8" step="1" className="h-2 w-full accent-indigo-600" value={customDrawdown.stepDrop} onChange={(e) => setCustomDrawdown((c) => ({ ...c, stepDrop: Number(e.target.value) || 5 }))} />
                      </Field>
                      <Field label="倍数模式" helper="递增：每档递加；固定：每档同倍">
                        <SelectField options={[{ label: '递增 (1.0x → 2.0x)', value: 'increment' }, { label: '固定 (1.0x)', value: 'fixed' }]} value={customDrawdown.multiplierMode} onChange={(e) => setCustomDrawdown((c) => ({ ...c, multiplierMode: e.target.value }))} />
                      </Field>
                    </div>
                    {customDrawdown.enabled ? (
                      <div className="rounded-2xl border border-indigo-100 bg-white px-4 py-3 text-xs text-slate-600">
                        当前生成 <strong className="text-indigo-700">{computed.layers.length}</strong> 档：首档 -{customDrawdown.firstDrop}%，每档增加 {customDrawdown.stepDrop}%跌幅；倍数 {customDrawdown.multiplierMode === 'fixed' ? '每档同 1.0x' : `1.0x → ${(1 + 0.5 * (customDrawdown.levels - 1)).toFixed(1)}x`}。右侧预览图与下方档位表会实时联动。
                      </div>
                    ) : null}
                  </div>
                </details>
              ) : null}

              <details className="mt-6 rounded-[24px] border border-slate-200 bg-slate-50/70 p-4">
                <summary className="cursor-pointer text-sm font-semibold text-slate-700">高级价格表</summary>
                <div className="mt-5 space-y-5">
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label={selectedStrategy === 'peak-drawdown' ? '阶段高点' : '120日线触发价'}>
                      <div className="flex items-center gap-2">
                        <NumberInput className="flex-1" step="0.001" value={Number(state.basePrice || 0).toFixed(3)} onChange={(event) => { isBasePriceDirtyRef.current = true; setState((current) => ({ ...current, basePrice: Number(event.target.value) || 0 })); }} />
                        <button type="button" title="重置为系统推荐值" className="shrink-0 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100" onClick={() => { isBasePriceDirtyRef.current = false; const sym = String(state.symbol || '').trim().toUpperCase(); const usingExtra = EXTRA_SYMBOL_CODES.has(sym) && extraQuote.symbol === sym && extraQuote.price > 0; const next = selectedStrategy === 'peak-drawdown' ? (usingExtra ? extraQuote.price : derivedStageHigh) : (usingExtra ? extraQuote.price : derivedMa120); setState((current) => ({ ...current, basePrice: Number(next) || 0 })); }}>推荐</button>
                      </div>
                    </Field>
                    {selectedStrategy === 'ma120-risk' ? (
                      <Field label="200日线风控价" helper="当它足够低于120日线深水层时，会进入最后一档。">
                        <div className="flex items-center gap-2">
                          <NumberInput className="flex-1" step="0.001" value={Number(state.riskControlPrice || 0).toFixed(3)} onChange={(event) => { isRiskPriceDirtyRef.current = true; setState((current) => ({ ...current, riskControlPrice: Number(event.target.value) || 0 })); }} />
                          <button type="button" title="重置为系统推荐值" className="shrink-0 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100" onClick={() => { isRiskPriceDirtyRef.current = false; setState((current) => ({ ...current, riskControlPrice: Number(derivedMa200) || 0 })); }}>推荐</button>
                        </div>
                      </Field>
                    ) : null}
                  </div>
                  <div className="space-y-4">
                {computed.layers.map((layer) => (
                  <div key={layer.id} className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-4">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex items-start gap-4">
                        <div className={cx('flex h-11 w-11 items-center justify-center rounded-2xl text-sm font-bold text-white', layer.isExtreme ? 'bg-amber-500' : layer.order === 1 ? 'bg-slate-900' : 'bg-indigo-600')}>
                          {String(layer.order).padStart(2, '0')}
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-slate-900">{layer.label}</div>
                          <div className="mt-1 text-sm text-slate-500">{layer.signal}</div>
                        </div>
                      </div>
                      <div className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-500">
                        {selectedStrategy === 'peak-drawdown' ? `策略倍数 ${layer.weight}x` : `模板权重 ${layer.weight}x`}
                      </div>
                    </div>

                    <div className="mt-5 grid gap-4 md:grid-cols-3">
                      <Field label="触发价格">
                        <NumberInput className="bg-white text-slate-600" readOnly step="0.001" value={layer.price.toFixed(3)} />
                      </Field>
                      <Field label="累计跌幅">
                        <NumberInput className="bg-white text-slate-600" readOnly step="0.1" value={layer.drawdown} />
                      </Field>
                      <Field label="计划金额">
                        <NumberInput className="bg-white text-slate-600" readOnly step="0.01" value={layer.amount.toFixed(2)} />
                      </Field>
                    </div>

                    <div className="mt-4 flex flex-col gap-2 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
                      <span>预估份额 {layer.shares.toFixed(2)} 份</span>
                      <span className="font-semibold text-slate-900">资金占比 {formatPercent(layer.weight / computed.totalWeight * 100, 1)}</span>
                    </div>
                  </div>
                ))}
                  </div>
                </div>
              </details>
            </Card>

            <Card className={cx("min-w-0 overflow-hidden", planStep !== 4 && "hidden")}>
              <SectionHeading eyebrow="第四步" title="确认策略配置" />
              <div className="mt-5 space-y-5">
                <Field label="策略名称" helper="创建后会出现在交易计划列表中；系统会根据标的与策略自动生成推荐名称。">
                  <div className="flex items-center gap-2">
                    <TextInput
                      className="flex-1"
                      placeholder="例如：513100 固定回撤计划"
                      value={state.name || ''}
                      onChange={(event) => { isNameDirtyRef.current = true; setState((current) => ({ ...current, name: event.target.value })); }}
                    />
                    <button type="button" title="重新使用系统推荐名称" className="shrink-0 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100" onClick={() => { isNameDirtyRef.current = false; setState((current) => ({ ...current, name: '' })); }}>推荐</button>
                  </div>
                </Field>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">投资标的</div>
                    <div className="mt-1 text-sm font-extrabold text-slate-900">{selectedFundLabel}</div>
                    <div className="mt-1 text-xs text-slate-500">参考基准 {benchmarkNameLabel}</div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">模板 / 频率</div>
                    <div className="mt-1 text-sm font-extrabold text-slate-900">{activeStrategy.label}</div>
                    <div className="mt-1 text-xs text-slate-500">{selectedFrequencyLabel}</div>
                  </div>
                </div>

                <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
                  <div className="border-b border-slate-100 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-900">档位确认明细</div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-left text-sm">
                      <thead className="bg-white text-[11px] uppercase tracking-[0.16em] text-slate-400">
                        <tr>
                          <th className="px-4 py-3 font-bold">档位</th>
                          <th className="px-4 py-3 font-bold">触发价</th>
                          <th className="px-4 py-3 font-bold">累计跌幅</th>
                          <th className="px-4 py-3 font-bold">计划金额</th>
                          <th className="px-4 py-3 font-bold">资金比例</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-slate-600">
                        {computed.layers.map((layer) => (
                          <tr key={layer.id} className="hover:bg-indigo-50/40">
                            <td className="px-4 py-3 font-semibold text-slate-900">{layer.label}</td>
                            <td className="px-4 py-3 font-mono">{formatFundPrice(layer.price, benchmarkCurrency)}</td>
                            <td className="px-4 py-3">{formatPercent(layer.drawdown, 1)}</td>
                            <td className="px-4 py-3 font-semibold text-slate-900">{formatCurrency(layer.amount, '¥ ')}</td>
                            <td className="px-4 py-3">{formatPercent((computed.totalWeight ? layer.weight / computed.totalWeight : 0) * 100, 1)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </Card>
          </div>

          <div className="min-w-0 space-y-6 lg:sticky lg:top-4">
            <Card className="min-w-0 overflow-hidden border-indigo-100 bg-gradient-to-br from-indigo-50 via-white to-white">
              <SectionHeading eyebrow="结果预览" title="策略成本预览" />
              <div className="mt-6 rounded-[24px] border border-white/80 bg-white/90 p-5 shadow-sm">
                <div className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-500">预估平均成本</div>
                <div className="mt-2 text-3xl font-extrabold tracking-tight text-indigo-700">{formatFundPrice(computed.averageCost, benchmarkCurrency)}</div>
                <div className="mt-4 grid gap-3">
                  <div className="flex items-center justify-between text-sm text-slate-500">
                    <span>可投入资金</span>
                    <strong className="text-slate-900">{formatCurrency(computed.investableCapital, '¥ ')}</strong>
                  </div>
                  <div className="flex items-center justify-between text-sm text-slate-500">
                    <span>预留现金</span>
                    <strong className="text-slate-900">{formatCurrency(computed.reserveCapital, '¥ ')}</strong>
                  </div>
                  <div className="flex items-center justify-between text-sm text-slate-500">
                    <span>{computed.anchorLabel}（{benchmarkCodeLabel}）</span>
                    <strong className="text-slate-900">{formatFundPrice(computed.anchorPrice, benchmarkCurrency)}</strong>
                  </div>
                </div>
              </div>

              <div className="mt-5 rounded-[24px] border border-slate-200 bg-white/80 p-5 shadow-sm">
                <div className="grid grid-cols-[minmax(82px,0.9fr)_minmax(112px,1.2fr)_minmax(88px,0.9fr)] items-end gap-3 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
                  <div className="text-right">Price / Condition</div>
                  <div className="text-center">Stepped Pyramid</div>
                  <div>Budget / Allocation</div>
                </div>
                <div className="relative mt-4 space-y-3 overflow-hidden rounded-[24px] bg-gradient-to-b from-slate-50 via-white to-indigo-50/40 px-2 py-3">
                  <div className="pointer-events-none absolute bottom-4 left-1/2 top-4 border-l border-dashed border-indigo-200" />
                  {computed.layers.map((layer, index) => {
                    const progression = computed.layers.length > 1 ? index / (computed.layers.length - 1) : 0;
                    const widthPct = Math.min(94, 35 + progression * 40 + (Number(layer.weight) || 0) / maxLayerWeight * 15);
                    const allocationPct = computed.totalWeight ? layer.weight / computed.totalWeight * 100 : 0;
                    return (
                      <div key={layer.id} className="group grid grid-cols-[minmax(82px,0.9fr)_minmax(112px,1.2fr)_minmax(88px,0.9fr)] items-center gap-3">
                        <div className="text-right">
                          <div className="text-xs font-extrabold text-slate-900">{formatPercent(layer.drawdown, 1)}</div>
                          <div className="mt-0.5 font-mono text-[11px] text-slate-400">{formatFundPrice(layer.price, benchmarkCurrency)}</div>
                        </div>
                        <div className="relative flex min-h-10 items-center justify-center">
                          <div
                            className={cx(
                              'relative flex h-10 items-center justify-center overflow-hidden rounded-2xl px-3 text-xs font-extrabold text-white shadow-sm transition-all duration-300 group-hover:-translate-y-0.5 group-hover:shadow-lg group-hover:shadow-indigo-200/60',
                              layer.isExtreme
                                ? 'bg-gradient-to-r from-amber-400 via-amber-500 to-orange-500'
                                : layer.order === 1
                                  ? 'bg-gradient-to-r from-slate-700 via-slate-900 to-slate-700'
                                  : 'bg-gradient-to-r from-indigo-500 via-indigo-600 to-violet-600'
                            )}
                            style={{ width: `${widthPct}%` }}
                          >
                            <span className="pointer-events-none absolute inset-y-0 -left-1/2 w-1/2 -skew-x-12 bg-white/20 opacity-0 transition-all duration-700 group-hover:left-full group-hover:opacity-100" />
                            <span className="relative z-10">{layer.weight}x</span>
                          </div>
                        </div>
                        <div>
                          <div className="text-xs font-extrabold text-slate-900">{formatPercent(allocationPct, 1)}</div>
                          <div className="mt-0.5 font-mono text-[11px] text-slate-400">{formatCurrency(layer.amount, '¥ ')}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </Card>

            <Card className="min-w-0 overflow-hidden border-emerald-100 bg-emerald-50">
              <div className="font-semibold text-emerald-900">执行建议</div>
              <p className="mt-2 text-sm leading-6 text-emerald-800">
                {selectedStrategy === 'peak-drawdown'
                  ? `当前计划会按 ${computed.layers.length} 档固定回撤执行，首档 ${formatPercent(computed.layers[0]?.drawdown ?? 0, 1)}，极端档 ${formatPercent(computed.layers[computed.layers.length - 1]?.drawdown ?? 0, 1)}。`
                  : `当前计划会按 4 档均线模板执行，先靠近120日线建首仓，再在更深位置逐步加大投入。`}
              </p>
            </Card>

            <Card className="min-w-0 overflow-hidden border-amber-200 bg-amber-50">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-600" />
                <div>
                  <div className="font-semibold text-amber-900">估计备注</div>
                  <p className="mt-2 text-sm leading-6 text-amber-800">
                    {selectedStrategy === 'peak-drawdown'
                      ? '固定回撤模板的跌幅档位不会自动变化，调整阶段高点会整体联动 8 档价格。'
                      : '均线模板下，若200日线高于深水层，它只作为风控线提示，不会反向插入加仓顺序。'}
                  </p>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200 bg-white/85 p-4 shadow-[0_-4px_24px_rgba(15,23,42,0.04)] backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-6 text-sm text-slate-500">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">策略模板</div>
              <div className="mt-1 text-sm font-extrabold text-slate-900">{activeStrategy.label}</div>
            </div>
            <div className="hidden h-8 w-px bg-slate-200 sm:block" />
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">可投入资金</div>
              <div className="mt-1 text-sm font-extrabold text-slate-900">{formatCurrency(computed.investableCapital, '¥ ')}</div>
            </div>
          </div>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <a className={cx(secondaryButtonClass, 'w-full sm:w-auto')} href={links.home}>取消</a>
            {planStep > 1 ? <button className={cx(secondaryButtonClass, 'w-full sm:w-auto')} type="button" onClick={() => goToPlanStep(planStep - 1)}>上一步</button> : null}
            {planStep < 4 ? (
              <button className={cx(primaryButtonClass, 'w-full sm:w-auto')} type="button" onClick={() => goToPlanStep(planStep + 1)}>
                下一步
                <ArrowRight className="h-4 w-4" />
              </button>
            ) : (
              <button className={cx(primaryButtonClass, 'w-full sm:w-auto')} disabled={isSaving} type="button" onClick={handleCreatePlan}>
                <Save className="h-4 w-4" />
                {isSaving ? '正在保存策略' : '确认创建并返回总览'}
                <ArrowRight className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
