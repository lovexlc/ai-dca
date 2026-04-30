// Home page — 加仓计划 dashboard.
// Visual language adapted from:
//   - Tremor Dashboard OSS (Apache 2.0) https://dashboard.tremor.so/overview
//   - shadcn/ui dashboard example (MIT)  https://ui.shadcn.com/examples/dashboard
// See docs/home-redesign.md for the layout spec.

import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { formatCurrency, formatPercent, readAccumulationState } from '../app/accumulation.js';
import { normalizeHomeDashboardState, persistHomeDashboardState, readHomeDashboardState } from '../app/homeDashboard.js';
import { formatMarketCode, formatMarketName } from '../app/marketDisplay.js';
import { formatPriceAsOf, loadLatestNasdaqPrices, loadNasdaqDailySeries, loadNasdaqMinuteSnapshot } from '../app/nasdaqPrices.js';
import { readNotifyClientConfig, sendNotifyTest } from '../app/notifySync.js';
import { deletePlan, readPlanList, readPlanState, setActivePlanId } from '../app/plan.js';
import { buildMovingAverageValues, buildNasdaqStrategyPlan, buildPeakDrawdownStrategyPlan, findLatestFiniteValue, mapReferencePrice, resolveNextTriggerLayer } from '../app/strategyEngine.js';
import { showActionToast } from '../app/toast.js';
import { Card, Pill, SectionHeading, cx, primaryButtonClass, subtleButtonClass } from '../components/experience-ui.jsx';
import {
  BENCHMARK_CODE,
  MAX_CHART_BARS,
  STRATEGY_OPTIONS,
  TIMEFRAME_OPTIONS,
  aggregateMinuteBars,
  buildChartGeometry,
  buildDailyBars,
  buildDefaultCodes,
  buildMappedMovingAverage,
  formatCompactNumber,
  formatFundPrice,
  formatRawNumber,
  limitBarsForChart,
  normalizeMinuteBars,
  resolveMarketCurrency,
  scalePrice
} from './home/helpers.js';
import { KpiCell, StatusDot } from './home/HomeWidgets.jsx';

export function HomeExperience({ links, inPagesDir = false, embedded = false }) {
  const accumulationState = readAccumulationState();
  const initialPlanState = readPlanState();
  const [dashboardState] = useState(() => readHomeDashboardState());

  const [marketEntries, setMarketEntries] = useState([]);
  const [marketError, setMarketError] = useState('');
  const [planList, setPlanList] = useState(() => readPlanList());
  const [activePlanId, setActivePlanIdState] = useState(() => initialPlanState.id || '');
  const [watchlistCodes, setWatchlistCodes] = useState(dashboardState.watchlistCodes);
  const [selectedCode, setSelectedCode] = useState(() => (initialPlanState.isConfigured ? initialPlanState.symbol : dashboardState.selectedCode));
  const [minuteSnapshot, setMinuteSnapshot] = useState(null);
  const [fifteenMinuteSnapshot, setFifteenMinuteSnapshot] = useState(null);
  const [dailySeries, setDailySeries] = useState([]);
  const [benchmarkDailySeries, setBenchmarkDailySeries] = useState([]);
  const [pulseError, setPulseError] = useState('');
  const [isLoadingPulse, setIsLoadingPulse] = useState(false);
  const [planTestNotice, setPlanTestNotice] = useState('');
  const [planTestError, setPlanTestError] = useState('');
  const [testingPlanId, setTestingPlanId] = useState('');
  const [timeframe, setTimeframe] = useState('1d');
  const [activeBarId, setActiveBarId] = useState('');

  const planState = useMemo(
    () => planList.find((plan) => plan.id === activePlanId) || initialPlanState,
    [activePlanId, initialPlanState, planList]
  );
  const selectedStrategy = planState.selectedStrategy || 'ma120-risk';

  useEffect(() => {
    let cancelled = false;
    loadLatestNasdaqPrices({ inPagesDir })
      .then((entries) => {
        if (cancelled) return;
        setMarketEntries(entries);
        setMarketError('');
      })
      .catch((error) => {
        if (cancelled) return;
        setMarketEntries([]);
        setMarketError(error instanceof Error ? error.message : '现价数据加载失败');
      });
    return () => { cancelled = true; };
  }, [inPagesDir]);

  const marketByCode = useMemo(() => new Map(marketEntries.map((entry) => [entry.code, entry])), [marketEntries]);
  const defaultWatchlistCodes = useMemo(() => buildDefaultCodes(marketEntries), [marketEntries]);
  const availableCodes = useMemo(() => marketEntries.map((entry) => entry.code), [marketEntries]);

  useEffect(() => {
    if (!marketEntries.length) return;
    const normalized = normalizeHomeDashboardState(
      { watchlistCodes, selectedCode },
      { availableCodes, defaultCodes: defaultWatchlistCodes }
    );
    if (normalized.watchlistCodes.join(',') !== watchlistCodes.join(',')) {
      setWatchlistCodes(normalized.watchlistCodes);
    }
    if (normalized.selectedCode !== selectedCode) {
      setSelectedCode(normalized.selectedCode);
    }
  }, [availableCodes, defaultWatchlistCodes, marketEntries.length, selectedCode, watchlistCodes]);

  const visibleWatchlistCodes = useMemo(
    () => watchlistCodes.filter((code) => marketByCode.has(code)),
    [marketByCode, watchlistCodes]
  );
  const watchlistItems = useMemo(
    () => visibleWatchlistCodes.map((code) => marketByCode.get(code)).filter(Boolean),
    [marketByCode, visibleWatchlistCodes]
  );

  useEffect(() => {
    if (!marketEntries.length) return;
    if (!watchlistItems.length) {
      if (selectedCode) setSelectedCode('');
      return;
    }
    if (!watchlistItems.some((item) => item.code === selectedCode)) {
      setSelectedCode(watchlistItems[0].code);
    }
  }, [marketEntries.length, selectedCode, watchlistItems]);

  useEffect(() => {
    if (!marketEntries.length) return;
    persistHomeDashboardState({ watchlistCodes: visibleWatchlistCodes, selectedCode });
  }, [marketEntries.length, selectedCode, visibleWatchlistCodes]);

  useEffect(() => {
    if (!planList.length) {
      if (activePlanId) setActivePlanIdState('');
      return;
    }
    if (!planList.some((plan) => plan.id === activePlanId)) {
      const nextPlanId = planList[0].id;
      setActivePlanIdState(nextPlanId);
      setActivePlanId(nextPlanId);
    }
  }, [activePlanId, planList]);

  const selectedFund = useMemo(() => marketByCode.get(selectedCode) || null, [marketByCode, selectedCode]);
  const benchmarkFund = useMemo(
    () => marketByCode.get(BENCHMARK_CODE) || selectedFund || null,
    [marketByCode, selectedFund]
  );
  const selectedFundCurrency = resolveMarketCurrency(selectedFund);
  const benchmarkCurrency = resolveMarketCurrency(benchmarkFund);
  const selectedFundCodeLabel = formatMarketCode(selectedFund?.code);
  const selectedFundNameLabel = formatMarketName(selectedFund);
  const benchmarkCodeLabel = formatMarketCode(benchmarkFund?.code || BENCHMARK_CODE);

  useEffect(() => {
    if (!planState?.isConfigured || !planState.symbol || !marketByCode.has(planState.symbol)) return;
    setSelectedCode((current) => (current === planState.symbol ? current : planState.symbol));
    setWatchlistCodes((current) => (current.includes(planState.symbol) ? current : [...current, planState.symbol]));
  }, [marketByCode, planState?.id, planState?.isConfigured, planState?.symbol]);

  useEffect(() => {
    if (!selectedFund?.output_path) {
      setMinuteSnapshot(null);
      setFifteenMinuteSnapshot(null);
      setDailySeries([]);
      setPulseError('');
      setIsLoadingPulse(false);
      return;
    }
    let cancelled = false;
    setIsLoadingPulse(true);
    const requests = [
      loadNasdaqMinuteSnapshot(selectedFund, { inPagesDir }),
      selectedFund?.output_path_15m
        ? loadNasdaqMinuteSnapshot(selectedFund.output_path_15m, { inPagesDir })
        : Promise.resolve(null),
      loadNasdaqDailySeries(selectedFund.code, { inPagesDir })
    ];
    Promise.allSettled(requests)
      .then(([minuteResult, fifteenMinuteResult, dailySeriesResult]) => {
        if (cancelled) return;
        if (minuteResult.status === 'fulfilled') {
          setMinuteSnapshot(minuteResult.value);
          setPulseError('');
        } else {
          setMinuteSnapshot(null);
          setPulseError(minuteResult.reason instanceof Error ? minuteResult.reason.message : '分钟线数据加载失败');
        }
        setFifteenMinuteSnapshot(fifteenMinuteResult.status === 'fulfilled' ? fifteenMinuteResult.value : null);
        if (dailySeriesResult.status === 'fulfilled') {
          setDailySeries(dailySeriesResult.value);
        } else {
          setDailySeries([]);
          if (minuteResult.status !== 'fulfilled') {
            setPulseError(dailySeriesResult.reason instanceof Error ? dailySeriesResult.reason.message : '日线数据加载失败');
          }
        }
      })
      .finally(() => { if (!cancelled) setIsLoadingPulse(false); });
    return () => { cancelled = true; };
  }, [inPagesDir, selectedFund]);

  useEffect(() => {
    if (!benchmarkFund?.code) {
      setBenchmarkDailySeries([]);
      return;
    }
    let cancelled = false;
    loadNasdaqDailySeries(benchmarkFund.code, { inPagesDir })
      .then((bars) => { if (!cancelled) setBenchmarkDailySeries(Array.isArray(bars) ? bars : []); })
      .catch(() => { if (!cancelled) setBenchmarkDailySeries([]); });
    return () => { cancelled = true; };
  }, [benchmarkFund?.code, inPagesDir]);

  const normalizedMinuteBars = useMemo(() => normalizeMinuteBars(minuteSnapshot?.bars || []), [minuteSnapshot]);
  const normalizedFifteenMinuteBars = useMemo(() => normalizeMinuteBars(fifteenMinuteSnapshot?.bars || []), [fifteenMinuteSnapshot]);
  const fullBarsByTimeframe = useMemo(() => ({
    '1m': normalizedMinuteBars,
    '15m': normalizedFifteenMinuteBars.length ? normalizedFifteenMinuteBars : aggregateMinuteBars(normalizedMinuteBars, 15),
    '1d': buildDailyBars(dailySeries)
  }), [dailySeries, normalizedFifteenMinuteBars, normalizedMinuteBars]);
  const benchmarkDailyBars = useMemo(() => buildDailyBars(benchmarkDailySeries), [benchmarkDailySeries]);
  const dailyMa120Values = useMemo(
    () => buildMovingAverageValues(benchmarkDailyBars, 120, { allowPartial: benchmarkDailyBars.length < 120 }),
    [benchmarkDailyBars]
  );
  const dailyMa200Values = useMemo(
    () => buildMovingAverageValues(benchmarkDailyBars, 200, { allowPartial: benchmarkDailyBars.length < 200 }),
    [benchmarkDailyBars]
  );
  const latestDailyMa120 = useMemo(() => findLatestFiniteValue(dailyMa120Values), [dailyMa120Values]);
  const latestDailyMa200 = useMemo(() => findLatestFiniteValue(dailyMa200Values), [dailyMa200Values]);
  const stageHighPrice = useMemo(() => {
    const values = benchmarkDailyBars
      .flatMap((bar) => [Number(bar.high) || 0, Number(bar.close) || 0])
      .filter((value) => Number.isFinite(value) && value > 0);
    return values.length ? Math.max(...values) : 0;
  }, [benchmarkDailyBars]);

  const currentFundPrice = Number(selectedFund?.current_price) || 0;
  const currentBenchmarkPrice = Number(benchmarkFund?.current_price) || currentFundPrice;
  const strategyPriceRatio = useMemo(() => {
    if (currentFundPrice > 0 && currentBenchmarkPrice > 0) return currentFundPrice / currentBenchmarkPrice;
    return 1;
  }, [currentBenchmarkPrice, currentFundPrice]);
  const usesMappedStrategyPrices = Boolean(
    selectedFund?.code && benchmarkFund?.code && selectedFund.code !== benchmarkFund.code
    && currentFundPrice > 0 && currentBenchmarkPrice > 0
  );
  const strategyDisplayCurrency = usesMappedStrategyPrices ? selectedFundCurrency : benchmarkCurrency;

  const strategyTriggerPrice = useMemo(() => {
    if (Number.isFinite(latestDailyMa120)) return latestDailyMa120;
    if (Number.isFinite(latestDailyMa200)) return latestDailyMa200;
    if (Number.isFinite(currentBenchmarkPrice) && currentBenchmarkPrice > 0) return currentBenchmarkPrice;
    return Number(planState.basePrice) || Number(accumulationState.basePrice) || 0;
  }, [accumulationState.basePrice, currentBenchmarkPrice, latestDailyMa120, latestDailyMa200, planState.basePrice]);
  const riskControlPrice = useMemo(() => {
    if (Number.isFinite(latestDailyMa200)) return latestDailyMa200;
    return strategyTriggerPrice > 0 ? strategyTriggerPrice * 0.85 : 0;
  }, [latestDailyMa200, strategyTriggerPrice]);

  const strategyPlan = useMemo(
    () => (selectedStrategy === 'peak-drawdown'
      ? buildPeakDrawdownStrategyPlan({
          totalBudget: planState.totalBudget,
          cashReservePct: planState.cashReservePct,
          peakPrice: stageHighPrice,
          fallbackPrice: currentBenchmarkPrice || Number(accumulationState.basePrice) || Number(planState.basePrice) || 0
        })
      : buildNasdaqStrategyPlan({
          totalBudget: planState.totalBudget,
          cashReservePct: planState.cashReservePct,
          ma120: strategyTriggerPrice,
          ma200: riskControlPrice,
          fallbackPrice: currentBenchmarkPrice || Number(accumulationState.basePrice) || Number(planState.basePrice) || 0
        })),
    [accumulationState.basePrice, currentBenchmarkPrice, planState.basePrice, planState.cashReservePct, planState.totalBudget, riskControlPrice, selectedStrategy, stageHighPrice, strategyTriggerPrice]
  );
  const displayStrategyPlan = useMemo(() => ({
    ...strategyPlan,
    triggerPrice: mapReferencePrice(strategyPlan.triggerPrice, strategyPriceRatio),
    riskPrice: mapReferencePrice(strategyPlan.riskPrice, strategyPriceRatio),
    anchorPrice: mapReferencePrice(strategyPlan.anchorPrice, strategyPriceRatio),
    averageCost: mapReferencePrice(strategyPlan.averageCost, strategyPriceRatio),
    layers: strategyPlan.layers.map((layer) => {
      const mappedPrice = mapReferencePrice(layer.price, strategyPriceRatio);
      return { ...layer, price: mappedPrice, shares: mappedPrice > 0 ? layer.amount / mappedPrice : 0 };
    })
  }), [strategyPlan, strategyPriceRatio]);
  const displayTriggerPrice = mapReferencePrice(strategyTriggerPrice, strategyPriceRatio);
  const displayRiskControlPrice = mapReferencePrice(riskControlPrice, strategyPriceRatio);
  const displayStageHighPrice = mapReferencePrice(stageHighPrice, strategyPriceRatio);
  const strategyDisplayCurrentPrice = usesMappedStrategyPrices ? currentFundPrice : currentBenchmarkPrice;

  const nextTriggerLayer = useMemo(
    () => resolveNextTriggerLayer(displayStrategyPlan.layers, strategyDisplayCurrentPrice),
    [displayStrategyPlan.layers, strategyDisplayCurrentPrice]
  );
  const nextBuyPrice = nextTriggerLayer?.price ?? displayStrategyPlan.triggerPrice;
  const executionLayers = useMemo(
    () => displayStrategyPlan.layers.map((layer) => {
      const isCompleted = strategyDisplayCurrentPrice > 0 && strategyDisplayCurrentPrice <= layer.price;
      const isNext = !isCompleted && nextTriggerLayer?.id === layer.id;
      return {
        ...layer,
        progressState: isCompleted ? 'completed' : isNext ? 'next' : 'pending',
        progressLabel: isCompleted ? '已完成' : isNext ? '下一档' : '待触发'
      };
    }),
    [displayStrategyPlan.layers, nextTriggerLayer?.id, strategyDisplayCurrentPrice]
  );
  const completedLayerCount = useMemo(
    () => executionLayers.filter((layer) => layer.progressState === 'completed').length,
    [executionLayers]
  );

  // chart pipeline
  const fullBars = fullBarsByTimeframe[timeframe] || [];
  const displayBars = useMemo(
    () => limitBarsForChart(fullBars, MAX_CHART_BARS[timeframe] || 64),
    [fullBars, timeframe]
  );
  const ma120Values = useMemo(
    () => buildMappedMovingAverage(displayBars, fullBars, 120, { allowPartial: fullBars.length < 120 }),
    [displayBars, fullBars]
  );
  const ma200Values = useMemo(
    () => buildMappedMovingAverage(displayBars, fullBars, 200, { allowPartial: fullBars.length < 200 }),
    [displayBars, fullBars]
  );
  const chartGeometry = useMemo(
    () => buildChartGeometry(displayBars, { ma120: ma120Values, ma200: ma200Values }),
    [displayBars, ma120Values, ma200Values]
  );

  useEffect(() => {
    if (!displayBars.length) {
      if (activeBarId) setActiveBarId('');
      return;
    }
    if (!displayBars.some((bar) => bar.id === activeBarId)) {
      setActiveBarId(displayBars[displayBars.length - 1].id);
    }
  }, [activeBarId, displayBars]);

  const activeBarIndex = useMemo(() => displayBars.findIndex((bar) => bar.id === activeBarId), [activeBarId, displayBars]);
  const resolvedActiveBarIndex = activeBarIndex >= 0 ? activeBarIndex : Math.max(displayBars.length - 1, 0);
  const activeBar = displayBars[resolvedActiveBarIndex] || null;
  const activeMa120 = resolvedActiveBarIndex >= 0 ? ma120Values[resolvedActiveBarIndex] : null;
  const activeMa200 = resolvedActiveBarIndex >= 0 ? ma200Values[resolvedActiveBarIndex] : null;
  const activeCandle = chartGeometry.candles[resolvedActiveBarIndex] || null;
  const activeCloseY = activeBar && chartGeometry.scaleMeta
    ? scalePrice(activeBar.close, chartGeometry.scaleMeta.minPrice, chartGeometry.scaleMeta.maxPrice)
    : null;

  const pricePulse = useMemo(() => {
    if (!selectedFund || !displayBars.length) return null;
    const latestBar = activeBar || displayBars[displayBars.length - 1];
    const firstBar = displayBars[0];
    const latestPrice = Number(selectedFund.current_price) || latestBar.close || 0;
    const openPrice = firstBar.open || latestPrice;
    const changePct = openPrice > 0 ? (latestPrice - openPrice) / openPrice * 100 : 0;
    const totalVolume = displayBars.reduce((sum, bar) => sum + bar.volume, 0);
    return {
      latestPrice,
      changePct,
      volumeMetricValue: formatCompactNumber(totalVolume),
      asOf: formatPriceAsOf(selectedFund)
    };
  }, [activeBar, displayBars, selectedFund]);

  // ----- handlers -----
  function handleSelectPlan(planId) {
    const targetPlan = planList.find((plan) => plan.id === planId);
    if (!targetPlan) return;
    setActivePlanIdState(targetPlan.id);
    setActivePlanId(targetPlan.id);
    if (targetPlan.symbol) {
      setSelectedCode(targetPlan.symbol);
      setWatchlistCodes((current) => (current.includes(targetPlan.symbol) ? current : [...current, targetPlan.symbol]));
    }
  }

  function handleDeletePlanItem(planId) {
    const normalizedId = String(planId || '').trim();
    if (!normalizedId) return;
    const removed = deletePlan(normalizedId);
    if (!removed) return;
    const nextList = readPlanList();
    setPlanList(nextList);
    if (activePlanId === normalizedId) {
      const fallbackId = nextList[0]?.id || '';
      setActivePlanIdState(fallbackId);
      if (fallbackId) {
        setActivePlanId(fallbackId);
      }
    }
    showActionToast('删除加仓计划', 'success');
  }

  async function handlePlanTestNotify(plan) {
    const normalizedPlanId = String(plan?.id || '').trim();
    if (!normalizedPlanId) return;
    const notifyClientId = readNotifyClientConfig().notifyClientId || '';
    setTestingPlanId(normalizedPlanId);
    setPlanTestError('');
    setPlanTestNotice('');
    const planLabel = String(plan?.name || plan?.symbol || '交易计划').trim();
    try {
      await sendNotifyTest({
        clientId: notifyClientId,
        ruleId: `plan:${normalizedPlanId}`,
        title: '交易计划测试提醒',
        summary: `${planLabel} 测试提醒`,
        body: `这是「${planLabel}」的测试通知。已触发您设置的购买条件，请前往网页查看当前投资策略。`
      });
      setPlanTestNotice(`已发送「${planLabel}」的测试通知。`);
      showActionToast('测试通知', 'success', { description: `已发送「${planLabel}」的测试通知。` });
    } catch (error) {
      const message = error instanceof Error ? error.message : '测试通知发送失败。';
      setPlanTestError(message);
      showActionToast('测试通知', 'error', { description: message });
    } finally {
      setTestingPlanId('');
    }
  }


  const activeStrategyOption = STRATEGY_OPTIONS.find((option) => option.key === selectedStrategy) || STRATEGY_OPTIONS[0];
  const hasPlans = planList.length > 0;
  const reserveRatio = planState.totalBudget > 0 ? strategyPlan.reserveCapital / planState.totalBudget * 100 : 0;

  function formatPriceLabel(value, currency = strategyDisplayCurrency) {
    return formatFundPrice(value, currency);
  }
  function formatDrawdownLabel(layer) {
    if (selectedStrategy === 'peak-drawdown') return formatPercent(layer.drawdown, 1);
    return layer.order === 1 ? '基准' : formatPercent(layer.drawdown, 1);
  }

  const content = (
    <div className={cx('mx-auto max-w-7xl space-y-4', embedded ? 'px-4 py-6 sm:px-6 sm:py-8' : 'px-4 py-6 sm:px-6 sm:py-8')}>
      {marketError ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">
          现价数据加载失败：{marketError}
        </div>
      ) : null}

      {/* ===== PlanBar: 策略切换 + 测试通知 + 新建策略 ===== */}
      <Card className="p-0">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="min-w-0 flex-1">
            {hasPlans ? (
              <div className="inline-flex items-center gap-1 overflow-x-auto rounded-lg bg-slate-100 p-1">
                {planList.map((plan) => {
                  const isActive = plan.id === activePlanId;
                  return (
                    <button
                      key={plan.id}
                      type="button"
                      onClick={() => handleSelectPlan(plan.id)}
                      className={cx(
                        'shrink-0 rounded-md px-3 py-1.5 text-sm font-medium transition-all',
                        isActive
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      )}
                    >
                      {plan.name || plan.symbol || '未命名策略'}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="text-sm text-slate-500">还没有策略，先点右侧「新建策略」创建一条。</div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {hasPlans && planState ? (
              <button
                type="button"
                disabled={testingPlanId === planState.id}
                onClick={() => handlePlanTestNotify(planState)}
                className={cx(subtleButtonClass, 'h-9 px-3 text-sm')}
              >
                {testingPlanId === planState.id ? '发送中' : '测试通知'}
              </button>
            ) : null}
            <a href={links.accumNew} className={cx(primaryButtonClass, 'h-9 px-3 text-sm')}>
              <Plus className="h-4 w-4" />
              新建策略
            </a>
          </div>
        </div>
        {(planTestNotice || planTestError) ? (
          <div className="border-b border-slate-100 px-4 py-2 text-xs sm:px-5">
            {planTestError ? (
              <div className="text-rose-600">{planTestError}</div>
            ) : (
              <div className="text-emerald-600">{planTestNotice}</div>
            )}
          </div>
        ) : null}
        {hasPlans ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-xs text-slate-500 sm:px-5">
            <span>策略 <span className="font-medium text-slate-700">{activeStrategyOption.shortLabel}</span></span>
            <span className="hidden text-slate-300 sm:inline">·</span>
            <span>标的 <span className="font-medium text-slate-700">{selectedFundCodeLabel || '--'}</span></span>
            {selectedFundNameLabel ? (
              <>
                <span className="hidden text-slate-300 sm:inline">·</span>
                <span className="truncate">{selectedFundNameLabel}</span>
              </>
            ) : null}
            <span className="hidden text-slate-300 sm:inline">·</span>
            <span>基准 <span className="font-medium text-slate-700">{benchmarkCodeLabel}</span></span>
          </div>
        ) : null}
      </Card>

      {/* ===== KpiRow: 4 flat stat cards ===== */}
      <Card className="overflow-hidden p-0">
        <div className="grid grid-cols-1 divide-y divide-slate-100 sm:grid-cols-2 sm:divide-y-0 sm:divide-x lg:grid-cols-4">
          <KpiCell
            label="可投入预算"
            value={formatCurrency(strategyPlan.investableCapital)}
            hint={planState.totalBudget > 0 ? `总预算 ${formatCurrency(planState.totalBudget)}` : undefined}
          />
          <KpiCell
            label="预留现金"
            value={formatCurrency(strategyPlan.reserveCapital)}
            hint={`占比 ${formatPercent(reserveRatio, 1)}`}
          />
          <KpiCell
            label="下一触发价"
            value={nextTriggerLayer ? formatPriceLabel(nextBuyPrice) : '已到深水区'}
            hint={nextTriggerLayer?.signal}
          />
          <KpiCell
            label="估算均价"
            value={formatPriceLabel(displayStrategyPlan.averageCost)}
            hint="触发全部档位后的加权平均"
            accent="emerald"
          />
        </div>
      </Card>

      {/* ===== PlanDetailCard: full-width with table ===== */}
      <Card className="p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <SectionHeading
            eyebrow="建仓计划"
            title="建仓计划详情"
          />
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Pill tone="slate">基准 {benchmarkCodeLabel}</Pill>
            <Pill tone="slate">标的 {selectedFundCodeLabel || '--'}</Pill>
            {selectedStrategy === 'peak-drawdown' ? (
              <Pill tone="slate">阶段高点 {formatPriceLabel(displayStageHighPrice)}</Pill>
            ) : (
              <>
                <Pill tone="slate">120日线触发 {formatPriceLabel(displayTriggerPrice)}</Pill>
                <Pill tone="slate">200日线风控 {formatPriceLabel(displayRiskControlPrice)}</Pill>
              </>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <div>
            <div className="text-xs text-slate-500">当前标的现价</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
              {formatPriceLabel(strategyDisplayCurrentPrice)}
            </div>
          </div>
          <div className="text-sm text-slate-500">
            已完成 <span className="font-medium tabular-nums text-emerald-700">{completedLayerCount}</span>
            {' '}/{' '}
            <span className="tabular-nums">{executionLayers.length}</span> 档
          </div>
        </div>

        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full bg-emerald-500 transition-all"
            style={{ width: executionLayers.length ? `${(completedLayerCount / executionLayers.length) * 100}%` : '0%' }}
          />
        </div>

        {/* Desktop table */}
        <div className="mt-5 hidden overflow-hidden rounded-md border border-slate-200 md:block">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">批次</th>
                <th className="px-4 py-2.5 font-medium">状态</th>
                <th className="px-4 py-2.5 font-medium">信号</th>
                <th className="px-4 py-2.5 text-right font-medium">价格</th>
                <th className="px-4 py-2.5 text-right font-medium">跌幅</th>
                <th className="px-4 py-2.5 text-right font-medium">金额</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {executionLayers.map((layer) => (
                <tr key={layer.id} className={cx(layer.progressState === 'next' && 'bg-indigo-50/40')}>
                  <td className="px-4 py-3 tabular-nums text-slate-600">{String(layer.order).padStart(2, '0')}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-2">
                      <StatusDot state={layer.progressState} />
                      <span className={cx('text-xs',
                        layer.progressState === 'completed' && 'text-emerald-700',
                        layer.progressState === 'next' && 'text-indigo-700',
                        layer.progressState === 'pending' && 'text-slate-500'
                      )}>{layer.progressLabel}</span>
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{layer.signal}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-900">{formatPriceLabel(layer.price)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-600">{formatDrawdownLabel(layer)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-900">{formatCurrency(layer.amount)}</td>
                </tr>
              ))}
              {!executionLayers.length ? (
                <tr><td className="px-4 py-6 text-center text-sm text-slate-500" colSpan={6}>请先创建一条建仓策略。</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {/* Mobile stacked cards */}
        <div className="mt-4 space-y-2 md:hidden">
          {executionLayers.map((layer) => (
            <div key={`m-${layer.id}`} className={cx(
              'rounded-md border p-3',
              layer.progressState === 'next' ? 'border-indigo-200 bg-indigo-50/40' : 'border-slate-200 bg-white'
            )}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <StatusDot state={layer.progressState} />
                  <span className="text-xs tabular-nums text-slate-500">批次 {String(layer.order).padStart(2, '0')}</span>
                  <span className={cx('text-xs',
                    layer.progressState === 'completed' && 'text-emerald-700',
                    layer.progressState === 'next' && 'text-indigo-700',
                    layer.progressState === 'pending' && 'text-slate-500'
                  )}>{layer.progressLabel}</span>
                </div>
                <span className="text-sm font-medium tabular-nums text-slate-900">{formatPriceLabel(layer.price)}</span>
              </div>
              <div className="mt-2 text-sm text-slate-700">{layer.signal}</div>
              <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                <span>跌幅 <span className="tabular-nums text-slate-700">{formatDrawdownLabel(layer)}</span></span>
                <span>金额 <span className="font-medium tabular-nums text-slate-700">{formatCurrency(layer.amount)}</span></span>
              </div>
            </div>
          ))}
          {!executionLayers.length ? (
            <div className="rounded-md border border-dashed border-slate-300 px-3 py-4 text-center text-sm text-slate-500">
              请先创建一条建仓策略。
            </div>
          ) : null}
        </div>
      </Card>

      {/* ===== 价格走势 + 策略列表 ===== */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        {/* Price chart */}
        <Card className="p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <SectionHeading
              eyebrow="价格走势"
              title={selectedFundCodeLabel || '未选择标的'}
              description={pricePulse?.asOf ? `截至 ${pricePulse.asOf}` : (minuteSnapshot?.date || '选择一个标的查看走势。')}
            />
            {pricePulse ? (
              <div className="text-left sm:text-right">
                <div className="text-xs text-slate-500">当前价格</div>
                <div className="mt-1 flex items-baseline gap-2 sm:justify-end">
                  <span className="text-2xl font-semibold tabular-nums text-slate-900">
                    {formatFundPrice(pricePulse.latestPrice, selectedFundCurrency)}
                  </span>
                  <span className={cx(
                    'text-sm font-medium tabular-nums',
                    pricePulse.changePct >= 0 ? 'text-emerald-600' : 'text-rose-600'
                  )}>
                    {formatPercent(pricePulse.changePct, 2, true)}
                  </span>
                </div>
              </div>
            ) : null}
          </div>

          <div className="mt-4 inline-flex items-center rounded-md bg-slate-100 p-0.5">
            {TIMEFRAME_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setTimeframe(option.key)}
                className={cx(
                  'rounded-md px-3 py-1 text-xs font-medium transition-colors',
                  timeframe === option.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                )}
              >
                {option.label}
              </button>
            ))}
          </div>

          {pricePulse && chartGeometry.candles.length ? (
            <>
              <div className="relative mt-4 min-w-0 overflow-hidden rounded-md border border-slate-200 bg-white">
                <svg className="relative h-[320px] w-full sm:h-[380px]" preserveAspectRatio="none" viewBox="0 0 100 100">
                  <line stroke="rgba(148,163,184,0.2)" strokeDasharray="1.5 2.5" strokeWidth="0.3" x1="4" x2="96" y1="16" y2="16" />
                  <line stroke="rgba(148,163,184,0.2)" strokeDasharray="1.5 2.5" strokeWidth="0.3" x1="4" x2="96" y1="32" y2="32" />
                  <line stroke="rgba(148,163,184,0.2)" strokeDasharray="1.5 2.5" strokeWidth="0.3" x1="4" x2="96" y1="48" y2="48" />
                  <line stroke="rgba(148,163,184,0.2)" strokeDasharray="1.5 2.5" strokeWidth="0.3" x1="4" x2="96" y1="64" y2="64" />
                  <line stroke="rgba(148,163,184,0.25)" strokeWidth="0.4" x1="4" x2="96" y1="79" y2="79" />
                  {chartGeometry.volumeBars.map((bar) => (
                    <rect key={bar.id} fill={bar.rising ? 'rgba(16,185,129,0.2)' : 'rgba(244,63,94,0.18)'} height={bar.height} rx="0.2" width={Math.max(bar.width, 1.2)} x={bar.x} y={bar.y} />
                  ))}
                  {chartGeometry.ma120Segments.map((segment, index) => (
                    <polyline key={`ma120-${index}`} fill="none" points={segment} stroke="#7c3aed" strokeWidth={timeframe === '1d' ? '1.4' : '1'} strokeLinecap="round" strokeLinejoin="round" />
                  ))}
                  {chartGeometry.ma200Segments.map((segment, index) => (
                    <polyline key={`ma200-${index}`} fill="none" points={segment} stroke="#f59e0b" strokeWidth={timeframe === '1d' ? '1.4' : '1'} strokeLinecap="round" strokeLinejoin="round" />
                  ))}
                  {chartGeometry.candles.map((candle) => (
                    <g key={candle.id}>
                      <line stroke={candle.rising ? '#10b981' : '#f43f5e'} strokeWidth="0.6" x1={candle.x} x2={candle.x} y1={candle.wickTop} y2={candle.wickBottom} />
                      <rect fill={candle.rising ? '#10b981' : '#f43f5e'} height={candle.bodyHeight} rx="0.3" width={Math.max(candle.hitBoxWidth > 5 ? 1.8 : 1.3, 1.1)} x={candle.bodyX} y={candle.bodyY} />
                      <rect fill="transparent" height="100" width={candle.hitBoxWidth} x={candle.hitBoxX} y="0" onClick={() => setActiveBarId(candle.id)} />
                    </g>
                  ))}
                  {activeCandle && Number.isFinite(activeCloseY) ? (
                    <g>
                      <line stroke="rgba(15,23,42,0.28)" strokeDasharray="1.6 2.2" strokeWidth="0.4" x1={activeCandle.x} x2={activeCandle.x} y1="6" y2="96" />
                      <line stroke="rgba(15,23,42,0.18)" strokeDasharray="1.6 2.2" strokeWidth="0.4" x1="4" x2="96" y1={activeCloseY} y2={activeCloseY} />
                      <circle cx={activeCandle.x} cy={activeCloseY} fill="#0f172a" r="1" />
                    </g>
                  ) : null}
                </svg>
              </div>

              <div className="mt-3 flex flex-col gap-2 text-xs md:flex-row md:items-center md:justify-between">
                <div className="flex flex-wrap items-center gap-4">
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-2.5 w-2.5 rounded-sm bg-violet-600" />
                    <span className="text-slate-500">120日线</span>
                    <span className="font-medium tabular-nums text-slate-700">{formatRawNumber(activeMa120)}</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-500" />
                    <span className="text-slate-500">200日线</span>
                    <span className="font-medium tabular-nums text-slate-700">{formatRawNumber(activeMa200)}</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="text-slate-500">成交量</span>
                    <span className="font-medium tabular-nums text-slate-700">{pricePulse.volumeMetricValue}</span>
                  </span>
                </div>
                {activeBar ? (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-500">
                    <span>{activeBar.longLabel}</span>
                    <span>开 <span className="tabular-nums text-slate-700">{formatRawNumber(activeBar.open)}</span></span>
                    <span>高 <span className="tabular-nums text-slate-700">{formatRawNumber(activeBar.high)}</span></span>
                    <span>低 <span className="tabular-nums text-slate-700">{formatRawNumber(activeBar.low)}</span></span>
                    <span>收 <span className="tabular-nums text-slate-700">{formatRawNumber(activeBar.close)}</span></span>
                  </div>
                ) : null}
              </div>
            </>
          ) : (
            <div className="mt-4 rounded-md border border-dashed border-slate-300 px-4 py-12 text-center text-sm text-slate-500">
              {pulseError
                ? `加载失败：${pulseError}`
                : isLoadingPulse
                  ? '正在加载价格走势数据...'
                  : '请选择一个标的查看走势。'}
            </div>
          )}
        </Card>

        {/* Strategy list (no per-item test notify, it's in PlanBar) */}
        <Card className="p-4 sm:p-5">
          <SectionHeading
            eyebrow="策略"
            title="策略列表"
          />

          {hasPlans ? (
            <div className="mt-4 space-y-2">
              {planList.map((plan) => {
                const isActive = plan.id === activePlanId;
                return (
                  <div
                    key={plan.id}
                    className={cx(
                      'flex w-full items-center justify-between rounded-md border px-3 py-2.5 text-left transition-colors',
                      isActive
                        ? 'border-slate-900 bg-slate-50'
                        : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => handleSelectPlan(plan.id)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="flex items-center gap-2">
                        <span className={cx('truncate text-sm font-medium', isActive ? 'text-slate-900' : 'text-slate-700')}>
                          {plan.name || plan.symbol || '未命名策略'}
                        </span>
                        {isActive ? <Pill tone="emerald">当前</Pill> : null}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {plan.symbol ? `标的 ${formatMarketCode(plan.symbol)}` : '未设置标的'}
                        {plan.totalBudget ? ` · 预算 ${formatCurrency(plan.totalBudget)}` : ''}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeletePlanItem(plan.id)}
                      aria-label="删除该加仓计划"
                      className="ml-3 inline-flex shrink-0 items-center justify-center rounded-md border border-rose-200 bg-white p-1.5 text-rose-600 transition-colors hover:border-rose-300 hover:bg-rose-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
              <a href={links.accumNew} className={cx(subtleButtonClass, 'mt-2 w-full justify-center text-sm')}>
                <Plus className="h-4 w-4" />
                新建策略
              </a>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              <a href={links.accumNew} className={cx(primaryButtonClass, 'w-full justify-center')}>
                <Plus className="h-4 w-4" />
                新建策略
              </a>
              <div className="rounded-md border border-dashed border-slate-300 px-3 py-4 text-sm text-slate-500">
                还没有已创建的策略。
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );

  return content;
}
