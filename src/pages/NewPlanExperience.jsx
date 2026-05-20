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
  const [extraQuote, setExtraQuote] = useState({ symbol: '', price: 0, currency: '', asOf: '', loading: false, error: '' });
  const [screeningAnswers, setScreeningAnswers] = useState(() => readPlanState().screeningAnswers || {});
  const [planStep, setPlanStep] = useState(1);
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

    setState((current) => ({
      ...current,
      basePrice: selectedStrategy === 'peak-drawdown' ? derivedStageHigh : derivedMa120,
      riskControlPrice: selectedStrategy === 'peak-drawdown' ? current.riskControlPrice : derivedMa200
    }));
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
    () => (selectedStrategy === 'peak-drawdown' ? buildFixedDrawdownPlan(state, selectedAssetType) : buildMovingAverageTemplatePlan(state)),
    [selectedAssetType, selectedStrategy, state]
  );

  const strategySummary = selectedStrategy === 'peak-drawdown'
    ? `按 ${benchmarkCodeLabel} 的阶段高点 ${formatFundPrice(computed.anchorPrice, benchmarkCurrency)} 向下拆成 ${computed.layers.length} 档固定回撤。`
    : `按 ${benchmarkCodeLabel} 的120日线触发价 ${formatFundPrice(computed.anchorPrice, benchmarkCurrency)} 和200日线风控价 ${formatFundPrice(computed.riskPrice, benchmarkCurrency)} 生成分层。`;

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
              onClick={() => setPlanStep(step.id)}
              aria-current={planStep === step.id ? 'step' : undefined}
              className={cx(
                'rounded-xl px-3 py-2 text-left text-sm font-semibold transition-colors',
                planStep === step.id ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-200' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
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
              <SectionHeading eyebrow="第一步" title="选标的与基础设置" />

              {marketError ? (
                <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                  标的数据暂时加载失败：{marketError}
                </div>
              ) : null}

              <div className="mt-6 space-y-5">
                <Field label="策略名称" helper="创建后会出现在首页的策略列表中。">
                  <TextInput
                    placeholder="例如：513100 固定回撤计划"
                    value={state.name || ''}
                    onChange={(event) => setState((current) => ({ ...current, name: event.target.value }))}
                  />
                </Field>

                <Field className="min-w-0" label="资产标的" helper="可搜索纳指 ETF，或使用美股快捷分组。">
                  <TextInput
                    className="mb-3"
                    placeholder="搜索代码或名称，例如 QQQ / 513100 / 纳指"
                    value={symbolSearch}
                    onChange={(event) => setSymbolSearch(event.target.value)}
                  />
                  <div className="mb-3 space-y-2">
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
                  {marketEntries.length ? (
                    <>
                      <div className="mb-2 text-xs font-semibold text-slate-400">纳指 ETF 下拉 · {filteredMarketEntries.length}/{marketEntries.length}</div>
                      <SelectField
                      className="min-w-0"
                      options={filteredMarketEntries.map((entry) => ({
                        label: formatMarketLabel(entry),
                        value: entry.code
                      }))}
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
                    <NumberInput step="0.001" value={state.basePrice} onChange={(event) => setState((current) => ({ ...current, basePrice: Number(event.target.value) || 0 }))} />
                  </Field>
                </div>

                {selectedStrategy === 'ma120-risk' ? (
                  <Field label="200日线风控价" helper="当它足够低于120日线深水层时，会进入最后一档。">
                    <NumberInput step="0.001" value={state.riskControlPrice} onChange={(event) => setState((current) => ({ ...current, riskControlPrice: Number(event.target.value) || 0 }))} />
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
                  <p className="mt-3 text-sm leading-6 text-slate-500">{strategySummary}</p>
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

              <div className="mt-6 space-y-4">
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
            </Card>
          </div>

          <div className={cx("min-w-0 space-y-6 lg:sticky lg:top-4", planStep !== 4 && "hidden")}>
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

              <div className="mt-5 rounded-[24px] border border-slate-200 bg-white/80 p-5">
                <div
                  className={cx(
                    selectedStrategy === 'peak-drawdown'
                      ? 'grid grid-cols-4 gap-3 sm:flex sm:min-h-[180px] sm:min-w-max sm:items-end'
                      : 'flex min-h-[180px] items-end gap-3'
                  )}
                >
                  {computed.layers.map((layer) => (
                    <div
                      key={layer.id}
                      className={cx(
                        'flex flex-col items-center gap-3',
                        selectedStrategy === 'peak-drawdown' ? 'min-w-0 sm:w-14' : 'w-14'
                      )}
                    >
                      <div
                        className={cx(
                          'flex w-full items-end justify-center rounded-t-2xl px-2 py-3 text-xs font-bold text-white',
                          layer.isExtreme ? 'bg-amber-500' : layer.order === 1 ? 'bg-slate-900' : 'bg-indigo-600'
                        )}
                        style={{ height: `${Math.max(layer.weight * (selectedStrategy === 'peak-drawdown' ? 14 : 32), 44)}px` }}
                      >
                        {`${layer.weight}x`}
                      </div>
                      <span className="text-center text-[11px] font-semibold text-slate-400">
                        {selectedStrategy === 'peak-drawdown' ? `档位 ${layer.order}` : layer.label}
                      </span>
                    </div>
                  ))}
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
            {planStep > 1 ? <button className={cx(secondaryButtonClass, 'w-full sm:w-auto')} type="button" onClick={() => setPlanStep((step) => Math.max(1, step - 1))}>上一步</button> : null}
            {planStep < 4 ? (
              <button className={cx(primaryButtonClass, 'w-full sm:w-auto')} type="button" onClick={() => setPlanStep((step) => Math.min(4, step + 1))}>
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
