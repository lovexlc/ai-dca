import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Download, LayoutGrid, LineChart, Plus, Shield, Trash2, TrendingUp, Upload, Wallet } from 'lucide-react';
import { buildStages, formatCurrency, formatPercent, readAccumulationState } from '../app/accumulation.js';
import { buildDcaProjection, readDcaState } from '../app/dca.js';
import { exportHomeDashboardState, importHomeDashboardState, normalizeHomeDashboardState, persistHomeDashboardState, readHomeDashboardState } from '../app/homeDashboard.js';
import { formatPriceAsOf, loadLatestNasdaqPrices, loadNasdaqMinuteSnapshot } from '../app/nasdaqPrices.js';
import { buildPlan, readPlanState } from '../app/plan.js';
import { Card, PageHero, PageShell, Pill, SectionHeading, SelectField, StatCard, cx, primaryButtonClass, secondaryButtonClass, subtleButtonClass } from '../components/experience-ui.jsx';

const DEFAULT_WATCHLIST_CODES = ['513100', '159501', '159660'];
const CHART_POINT_LIMIT = 28;

const HISTORY_PLANS = [
  { name: '科技股累积', note: '平均成本: $548.05', active: true },
  { name: '股息增长', note: '平均成本: $42.10' }
];

function formatFundPrice(value) {
  return formatCurrency(value, '¥', 3);
}

function formatCompactNumber(value) {
  return new Intl.NumberFormat('zh-CN', {
    notation: 'compact',
    maximumFractionDigits: 1
  }).format(Number(value) || 0);
}

function sampleBars(bars = [], limit = CHART_POINT_LIMIT) {
  if (!Array.isArray(bars) || bars.length <= limit) {
    return Array.isArray(bars) ? bars : [];
  }

  const step = (bars.length - 1) / Math.max(limit - 1, 1);
  return Array.from({ length: limit }, (_, index) => bars[Math.min(bars.length - 1, Math.round(index * step))]);
}

function scaleChartY(value, minValue, maxValue) {
  if (!Number.isFinite(value) || !Number.isFinite(minValue) || !Number.isFinite(maxValue) || maxValue <= minValue) {
    return 50;
  }

  const ratio = (value - minValue) / (maxValue - minValue);
  return 84 - ratio * 68;
}

function buildChartGeometry(bars = []) {
  if (!bars.length) {
    return { candles: [], volumeBars: [], closePoints: '' };
  }

  const numericPrices = bars.flatMap((bar) => [bar.open, bar.close, bar.high, bar.low].map((value) => Number(value))).filter(Number.isFinite);
  const numericVolumes = bars.map((bar) => Number(bar.volume) || 0);
  const minPrice = Math.min(...numericPrices);
  const maxPrice = Math.max(...numericPrices);
  const maxVolume = Math.max(...numericVolumes, 1);
  const gap = bars.length > 1 ? 92 / (bars.length - 1) : 0;
  const candleWidth = Math.max(Math.min(gap * 0.52, 2.8), 1.3);

  const candles = bars.map((bar, index) => {
    const x = 4 + gap * index;
    const open = Number(bar.open) || 0;
    const close = Number(bar.close) || open;
    const high = Number(bar.high) || Math.max(open, close);
    const low = Number(bar.low) || Math.min(open, close);
    const openY = scaleChartY(open, minPrice, maxPrice);
    const closeY = scaleChartY(close, minPrice, maxPrice);
    const highY = scaleChartY(high, minPrice, maxPrice);
    const lowY = scaleChartY(low, minPrice, maxPrice);
    const bodyY = Math.min(openY, closeY);
    const bodyHeight = Math.max(Math.abs(closeY - openY), 1.3);

    return {
      id: `${bar.datetime || index}`,
      x,
      wickX: x,
      wickTop: highY,
      wickBottom: lowY,
      bodyX: x - candleWidth / 2,
      bodyY,
      bodyHeight,
      rising: close >= open
    };
  });

  const volumeBars = bars.map((bar, index) => {
    const x = 4 + gap * index;
    const height = Math.max((Number(bar.volume) || 0) / maxVolume * 18, 1.2);
    return {
      id: `volume-${bar.datetime || index}`,
      x: x - candleWidth / 2,
      y: 96 - height,
      width: candleWidth,
      height,
      rising: (Number(bar.close) || 0) >= (Number(bar.open) || 0)
    };
  });

  const closePoints = bars
    .map((bar, index) => {
      const x = 4 + gap * index;
      const y = scaleChartY(Number(bar.close) || 0, minPrice, maxPrice);
      return `${x},${y}`;
    })
    .join(' ');

  return { candles, volumeBars, closePoints };
}

function buildDefaultCodes(entries = []) {
  const availableCodes = new Set(entries.map((entry) => entry.code));
  const preferred = DEFAULT_WATCHLIST_CODES.filter((code) => availableCodes.has(code));
  if (preferred.length) {
    return preferred;
  }

  return entries.slice(0, 3).map((entry) => entry.code);
}

export function HomeExperience({ links, inPagesDir = false }) {
  const accumulationState = readAccumulationState();
  const accumulation = buildStages(accumulationState);
  const planState = readPlanState();
  const plan = buildPlan(planState);
  const dcaState = readDcaState();
  const dca = buildDcaProjection(dcaState);
  const nextBuyPrice = accumulation.stages[1]?.price ?? accumulationState.basePrice;
  const reserveRatio = planState.totalBudget > 0 ? plan.reserveCapital / planState.totalBudget * 100 : 0;
  const savedDashboardState = readHomeDashboardState();

  const [marketEntries, setMarketEntries] = useState([]);
  const [marketError, setMarketError] = useState('');
  const [watchlistCodes, setWatchlistCodes] = useState(savedDashboardState.watchlistCodes);
  const [selectedCode, setSelectedCode] = useState(savedDashboardState.selectedCode);
  const [pendingCode, setPendingCode] = useState('');
  const [pulseData, setPulseData] = useState(null);
  const [pulseError, setPulseError] = useState('');
  const [isLoadingPulse, setIsLoadingPulse] = useState(false);
  const [watchlistNotice, setWatchlistNotice] = useState('');
  const [watchlistNoticeTone, setWatchlistNoticeTone] = useState('slate');
  const importInputRef = useRef(null);

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
        setMarketError(error instanceof Error ? error.message : '现价数据加载失败');
      });

    return () => {
      cancelled = true;
    };
  }, [inPagesDir]);

  const marketByCode = useMemo(() => new Map(marketEntries.map((entry) => [entry.code, entry])), [marketEntries]);
  const defaultWatchlistCodes = useMemo(() => buildDefaultCodes(marketEntries), [marketEntries]);
  const availableCodes = useMemo(() => marketEntries.map((entry) => entry.code), [marketEntries]);

  useEffect(() => {
    if (!marketEntries.length) {
      return;
    }

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

  const visibleWatchlistCodes = useMemo(() => {
    return watchlistCodes.filter((code) => marketByCode.has(code));
  }, [marketByCode, watchlistCodes]);

  const watchlistItems = useMemo(
    () => visibleWatchlistCodes.map((code) => marketByCode.get(code)).filter(Boolean),
    [marketByCode, visibleWatchlistCodes]
  );

  const addableEntries = useMemo(
    () => marketEntries.filter((entry) => !visibleWatchlistCodes.includes(entry.code)),
    [marketEntries, visibleWatchlistCodes]
  );

  useEffect(() => {
    if (!marketEntries.length) {
      return;
    }

    if (!watchlistItems.length) {
      if (selectedCode) {
        setSelectedCode('');
      }
      return;
    }

    if (!watchlistItems.some((item) => item.code === selectedCode)) {
      setSelectedCode(watchlistItems[0].code);
    }
  }, [selectedCode, watchlistItems]);

  useEffect(() => {
    if (!marketEntries.length) {
      return;
    }

    if (!addableEntries.length) {
      if (pendingCode) {
        setPendingCode('');
      }
      return;
    }

    if (!addableEntries.some((entry) => entry.code === pendingCode)) {
      setPendingCode(addableEntries[0].code);
    }
  }, [addableEntries, pendingCode]);

  useEffect(() => {
    if (!marketEntries.length) {
      return;
    }

    persistHomeDashboardState({
      watchlistCodes: visibleWatchlistCodes,
      selectedCode
    });
  }, [marketEntries.length, selectedCode, visibleWatchlistCodes]);

  const selectedFund = useMemo(() => marketByCode.get(selectedCode) || null, [marketByCode, selectedCode]);

  useEffect(() => {
    if (!selectedFund?.output_path) {
      setPulseData(null);
      setPulseError('');
      setIsLoadingPulse(false);
      return;
    }

    let cancelled = false;

    setIsLoadingPulse(true);
    loadNasdaqMinuteSnapshot(selectedFund, { inPagesDir })
      .then((payload) => {
        if (cancelled) {
          return;
        }

        setPulseData(payload);
        setPulseError('');
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setPulseData(null);
        setPulseError(error instanceof Error ? error.message : '分钟线数据加载失败');
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingPulse(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [inPagesDir, selectedFund]);

  const pricePulse = useMemo(() => {
    const rawBars = Array.isArray(pulseData?.bars) ? pulseData.bars : [];
    if (!selectedFund || !rawBars.length) {
      return null;
    }

    const bars = rawBars.filter((bar) => Number.isFinite(Number(bar.close)));
    if (!bars.length) {
      return null;
    }

    const firstBar = bars[0];
    const lastBar = bars[bars.length - 1];
    const latestPrice = Number(selectedFund.current_price) || Number(lastBar.close) || 0;
    const openPrice = Number(firstBar.open) || Number(firstBar.close) || latestPrice;
    const highPrice = Math.max(...bars.map((bar) => Number(bar.high) || Number(bar.close) || 0), latestPrice);
    const lowPrice = Math.min(...bars.map((bar) => Number(bar.low) || Number(bar.close) || latestPrice), latestPrice);
    const avgPrice = Number(lastBar.avg_price) || latestPrice;
    const totalAmount = bars.reduce((sum, bar) => sum + (Number(bar.amount) || 0), 0);
    const totalVolume = bars.reduce((sum, bar) => sum + (Number(bar.volume) || 0), 0);
    const changePct = openPrice > 0 ? (latestPrice - openPrice) / openPrice * 100 : 0;
    const sampledBars = sampleBars(bars);
    const chart = buildChartGeometry(sampledBars);

    return {
      latestPrice,
      openPrice,
      highPrice,
      lowPrice,
      avgPrice,
      totalAmount,
      totalVolume,
      changePct,
      asOf: formatPriceAsOf(selectedFund),
      chart,
      lastTimestamp: String(lastBar.datetime || '').trim().slice(11, 16)
    };
  }, [pulseData, selectedFund]);

  function addWatchlistItem() {
    if (!pendingCode || visibleWatchlistCodes.includes(pendingCode)) {
      return;
    }

    setWatchlistCodes((current) => [...current, pendingCode]);
    setSelectedCode(pendingCode);
    setWatchlistNotice(`已加入 ${pendingCode} 到自选基金。`);
    setWatchlistNoticeTone('emerald');
  }

  function removeWatchlistItem(code) {
    setWatchlistCodes((current) => current.filter((itemCode) => itemCode !== code));
    if (selectedCode === code) {
      const nextCode = visibleWatchlistCodes.find((itemCode) => itemCode !== code) || '';
      setSelectedCode(nextCode);
    }
    setWatchlistNotice(`已从自选基金移除 ${code}。`);
    setWatchlistNoticeTone('slate');
  }

  function exportWatchlistConfig() {
    const payload = exportHomeDashboardState({
      watchlistCodes: visibleWatchlistCodes,
      selectedCode
    });
    const blob = new Blob([payload], { type: 'application/json;charset=utf-8' });
    const objectUrl = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = `qqq-dashboard-config-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(objectUrl);
    setWatchlistNotice('已导出当前浏览器中的自选配置。');
    setWatchlistNoticeTone('emerald');
  }

  async function importWatchlistConfig(event) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const rawText = await file.text();
      const imported = importHomeDashboardState(rawText, {
        availableCodes,
        defaultCodes: defaultWatchlistCodes
      });
      setWatchlistCodes(imported.watchlistCodes);
      setSelectedCode(imported.selectedCode);
      setWatchlistNotice(`已导入 ${imported.watchlistCodes.length} 个自选基金。`);
      setWatchlistNoticeTone('emerald');
    } catch (error) {
      setWatchlistNotice(error instanceof Error ? error.message : '导入配置失败。');
      setWatchlistNoticeTone('amber');
    } finally {
      event.target.value = '';
    }
  }

  function restoreDefaultWatchlist() {
    setWatchlistCodes(defaultWatchlistCodes);
    setSelectedCode(defaultWatchlistCodes[0] || '');
    setWatchlistNotice('已恢复默认自选基金组合。');
    setWatchlistNoticeTone('slate');
  }

  return (
    <PageShell>
      <PageHero
        backHref={links.catalog}
        backLabel="返回页面目录"
        eyebrow="Strategy Dashboard"
        title="QQQ 建仓策略总览"
        description="将加仓计划、资金留存和定投节奏汇总到一个轻量决策视图里，便于快速判断下一次操作窗口和预算占用。"
        badges={[
          <Pill key="status" tone="indigo">运行中</Pill>,
          <Pill key="layers" tone="slate">{accumulation.stages.length} 层建仓</Pill>
        ]}
        actions={
          <>
            <a className={secondaryButtonClass} href={links.accumEdit}>修改配置</a>
            <a className={primaryButtonClass} href={links.accumNew}>
              <Plus className="h-4 w-4" />
              新建建仓计划
            </a>
          </>
        }
      />

      <div className="mx-auto max-w-6xl space-y-6 px-6 pt-8">
        <Card>
          <SectionHeading
            eyebrow="Watchlist"
            title="自选基金"
            description="自选基金固定放在页面最上方，配置只保存在当前浏览器。你可以直接导出 JSON，自行备份或导入到另一台设备。"
            action={
              <div className="flex w-full flex-col gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <button className={subtleButtonClass} type="button" onClick={exportWatchlistConfig}>
                    <Download className="h-4 w-4" />
                    导出配置
                  </button>
                  <button className={subtleButtonClass} type="button" onClick={() => importInputRef.current?.click()}>
                    <Upload className="h-4 w-4" />
                    导入配置
                  </button>
                  <button className={subtleButtonClass} type="button" onClick={restoreDefaultWatchlist}>
                    恢复默认
                  </button>
                  <input
                    ref={importInputRef}
                    accept="application/json"
                    className="hidden"
                    type="file"
                    onChange={importWatchlistConfig}
                  />
                </div>
                <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
                <div className="min-w-[220px]">
                  <SelectField
                    disabled={!addableEntries.length}
                    options={addableEntries.map((entry) => ({
                      label: `${entry.code} · ${entry.name}`,
                      value: entry.code
                    }))}
                    value={pendingCode}
                    onChange={(event) => setPendingCode(event.target.value)}
                  />
                </div>
                <button
                  className={primaryButtonClass}
                  disabled={!pendingCode || !addableEntries.length}
                  type="button"
                  onClick={addWatchlistItem}
                >
                  <Plus className="h-4 w-4" />
                  新增自选
                </button>
                </div>
              </div>
            }
          />

          {watchlistNotice ? (
            <div className={cx(
              'mt-5 rounded-2xl px-4 py-3 text-sm',
              watchlistNoticeTone === 'emerald'
                ? 'border border-emerald-200 bg-emerald-50 text-emerald-700'
                : watchlistNoticeTone === 'amber'
                  ? 'border border-amber-200 bg-amber-50 text-amber-700'
                  : 'border border-slate-200 bg-slate-50 text-slate-600'
            )}>
              {watchlistNotice}
            </div>
          ) : null}

          {marketError ? (
            <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
              自选基金数据加载失败：{marketError}
            </div>
          ) : null}

          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {watchlistItems.map((item) => {
              const isActive = item.code === selectedCode;
              return (
                <div
                  key={item.code}
                  className={cx(
                    'group relative rounded-[24px] border px-4 py-4 transition-all',
                    isActive
                      ? 'border-indigo-200 bg-indigo-50 shadow-sm shadow-indigo-100'
                      : 'border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white'
                  )}
                >
                  <button
                    className="absolute inset-0 rounded-[24px]"
                    type="button"
                    aria-label={`切换到 ${item.code}`}
                    onClick={() => setSelectedCode(item.code)}
                  />
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-lg font-semibold text-slate-900">{item.code}</div>
                      <div className="mt-1 line-clamp-2 text-sm leading-6 text-slate-500">{item.name}</div>
                    </div>
                    <button
                      className="relative z-10 inline-flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500"
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        removeWatchlistItem(item.code);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="mt-4 flex items-end justify-between gap-4">
                    <div>
                      <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">现价</div>
                      <div className={cx('mt-1 text-xl font-bold', isActive ? 'text-indigo-700' : 'text-slate-900')}>
                        {formatFundPrice(item.current_price)}
                      </div>
                    </div>
                    <span className={cx('rounded-full px-3 py-1 text-xs font-semibold', isActive ? 'bg-white text-indigo-600' : 'bg-white text-slate-500')}>
                      {isActive ? '当前观察' : '点击切换'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {!watchlistItems.length && !marketError ? (
            <div className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-500">
              当前没有可展示的自选基金，请先从右上角加入一个可用标的。
            </div>
          ) : null}
        </Card>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard accent="indigo" eyebrow="Portfolio Budget" value={formatCurrency(accumulation.investedCapital)} note="当前金字塔策略总预算" progress={Math.max(100 - reserveRatio, 0)} />
          <StatCard eyebrow="Reserve Cash" value={formatCurrency(plan.reserveCapital)} note={`${formatPercent(reserveRatio, 1)} 作为流动性缓冲`} />
          <StatCard eyebrow="Next Trigger" value={formatCurrency(nextBuyPrice)} note="下一层计划买入价位" />
          <StatCard accent="emerald" eyebrow="Average Cost" value={formatCurrency(accumulation.averageCost)} note={`${formatPercent(4.2, 1, true)} 假设增长空间`} />
        </div>

        <div className="grid gap-6 lg:grid-cols-5">
          <Card className="lg:col-span-3">
            <SectionHeading
              eyebrow="Price Pulse"
              title="价格走势与基金脉冲"
              description="卡片指标和图表都直接读取 data 下对应基金的分钟线与现价数据，不再使用写死示意图。"
              action={selectedFund ? <Pill tone="indigo">{selectedFund.code}</Pill> : null}
            />

            {selectedFund && pricePulse ? (
              <div className="mt-6 rounded-[24px] border border-slate-200 bg-gradient-to-br from-slate-50 via-white to-indigo-50 p-5">
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="rounded-2xl border border-slate-200 bg-white/90 p-4">
                    <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">最新价</div>
                    <div className="mt-2 text-xl font-bold text-slate-900">{formatFundPrice(pricePulse.latestPrice)}</div>
                    <div className="mt-1 text-sm text-slate-500">{selectedFund.name}</div>
                  </div>
                  <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-4">
                    <div className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-500">日内涨跌</div>
                    <div className="mt-2 text-xl font-bold text-indigo-700">{formatPercent(pricePulse.changePct, 2, true)}</div>
                    <div className="mt-1 text-sm text-indigo-600">开盘 {formatFundPrice(pricePulse.openPrice)}</div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white/90 p-4">
                    <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">成交额</div>
                    <div className="mt-2 text-xl font-bold text-slate-900">¥ {formatCompactNumber(pricePulse.totalAmount)}</div>
                    <div className="mt-1 text-sm text-slate-500">成交量 {formatCompactNumber(pricePulse.totalVolume)}</div>
                  </div>
                </div>

                <div className="relative mt-6 h-72 overflow-hidden rounded-[24px] border border-slate-200 bg-white">
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(99,102,241,0.16),_transparent_36%),radial-gradient(circle_at_bottom_right,_rgba(16,185,129,0.1),_transparent_30%)]" />
                  <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="none" viewBox="0 0 100 100">
                    {pricePulse.chart.volumeBars.map((bar) => (
                      <rect
                        key={bar.id}
                        fill={bar.rising ? 'rgba(16,185,129,0.16)' : 'rgba(244,63,94,0.16)'}
                        height={bar.height}
                        width={bar.width}
                        x={bar.x}
                        y={bar.y}
                      />
                    ))}
                    {pricePulse.chart.candles.map((candle) => (
                      <g key={candle.id}>
                        <line
                          stroke={candle.rising ? '#10b981' : '#f43f5e'}
                          strokeWidth="0.7"
                          x1={candle.wickX}
                          x2={candle.wickX}
                          y1={candle.wickTop}
                          y2={candle.wickBottom}
                        />
                        <rect
                          fill={candle.rising ? '#10b981' : '#f43f5e'}
                          height={candle.bodyHeight}
                          rx="0.5"
                          width={Math.max(candle.bodyHeight > 1.3 ? 1.8 : 1.2, 1.2)}
                          x={candle.bodyX}
                          y={candle.bodyY}
                        />
                      </g>
                    ))}
                    <polyline
                      fill="none"
                      points={pricePulse.chart.closePoints}
                      stroke="#312e81"
                      strokeWidth="1.6"
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                  </svg>
                  <div className="absolute left-4 top-4 rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white shadow-lg">
                    {selectedFund.code} · {pricePulse.lastTimestamp || '分时'}
                  </div>
                  <div className="absolute right-4 top-4 rounded-full bg-white/95 px-3 py-1 text-xs font-semibold text-slate-600 shadow-sm">
                    {pricePulse.asOf || pulseData?.date || ''}
                  </div>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">日内最高</div>
                    <div className="mt-2 text-lg font-bold text-slate-900">{formatFundPrice(pricePulse.highPrice)}</div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">日内最低</div>
                    <div className="mt-2 text-lg font-bold text-slate-900">{formatFundPrice(pricePulse.lowPrice)}</div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">均价参考</div>
                    <div className="mt-2 text-lg font-bold text-slate-900">{formatFundPrice(pricePulse.avgPrice)}</div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-6 rounded-[24px] border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-sm text-slate-500">
                {pulseError || marketError
                  ? `价格脉冲加载失败：${pulseError || marketError}`
                  : isLoadingPulse
                    ? '正在加载所选基金的分钟线数据...'
                    : '请选择一个自选基金后查看 Price Pulse。'}
              </div>
            )}
          </Card>

          <div className="space-y-6 lg:col-span-2">
            <Card>
              <SectionHeading eyebrow="Execution Map" title="建仓计划详情" />
              <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50/80 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-semibold">阶段</th>
                      <th className="px-4 py-3 font-semibold">价格</th>
                      <th className="px-4 py-3 font-semibold">跌幅</th>
                      <th className="px-4 py-3 font-semibold">金额</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {accumulation.stages.map((stage, index) => (
                      <tr key={stage.id}>
                        <td className="px-4 py-3 font-semibold text-slate-700">{String(index + 1).padStart(2, '0')}</td>
                        <td className="px-4 py-3 text-slate-600">{formatCurrency(stage.price)}</td>
                        <td className="px-4 py-3 text-slate-600">{index === 0 ? '基准' : formatPercent(stage.drawdown, 1)}</td>
                        <td className="px-4 py-3 text-slate-900">{formatCurrency(stage.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card>
              <SectionHeading eyebrow="Capital Mix" title="资金配置模型" />
              <div className="mt-6 flex min-h-[180px] items-end justify-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-5">
                {accumulation.stages.map((stage, index) => (
                  <div key={stage.id} className="flex w-16 flex-col items-center gap-3">
                    <div
                      className={cx(
                        'flex w-full items-end justify-center rounded-t-2xl px-2 py-3 text-xs font-bold text-white',
                        index === accumulation.stages.length - 1 ? 'bg-indigo-600' : 'bg-slate-400'
                      )}
                      style={{ height: `${Math.max(stage.weightPercent * 1.8, 44)}px` }}
                    >
                      {formatPercent(stage.weightPercent, 0)}
                    </div>
                    <span className="text-xs font-semibold text-slate-400">阶段 {index + 1}</span>
                  </div>
                ))}
              </div>
              <div className="mt-4 text-sm leading-6 text-slate-500">
                分配权重与目标跌幅同步驱动入场价格，末层最大跌幅 {formatPercent(accumulationState.maxDrawdown, 2)}。
              </div>
            </Card>

            <Card>
              <SectionHeading eyebrow="Operator Notes" title="执行建议" />
              <ul className="mt-5 space-y-3 text-sm leading-6 text-slate-600">
                <li>首笔建仓使用 {formatCurrency(accumulation.stages[0]?.price ?? accumulationState.basePrice)} 作为基准价。</li>
                <li>下一层计划买入价为 {formatCurrency(nextBuyPrice)}，触发后会自动重算平均成本。</li>
                <li>定投计划当前总投入 {formatCurrency(dca.totalInvestment)}，执行频率为 {dcaState.frequency}。</li>
              </ul>
            </Card>
          </div>
        </div>

        <Card>
          <SectionHeading eyebrow="Playbooks" title="历史计划与调试入口" />
          <div className="mt-5 space-y-3">
            {HISTORY_PLANS.map((item) => (
              <div key={item.name} className={cx('rounded-2xl border px-4 py-4', item.active ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-slate-50')}>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="font-semibold">{item.name}</div>
                    <div className={cx('mt-1 text-sm', item.active ? 'text-slate-300' : 'text-slate-500')}>{item.note}</div>
                  </div>
                  <LayoutGrid className={cx('h-5 w-5', item.active ? 'text-slate-300' : 'text-slate-400')} />
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                <Wallet className="h-4 w-4 text-slate-400" />
                预留现金
              </div>
              <div className="mt-2 text-xl font-bold text-slate-900">{formatCurrency(plan.reserveCapital)}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                <TrendingUp className="h-4 w-4 text-slate-400" />
                定投总投入
              </div>
              <div className="mt-2 text-xl font-bold text-slate-900">{formatCurrency(dca.totalInvestment)}</div>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <a className={secondaryButtonClass} href={links.catalog}>打开目录</a>
            <a className={primaryButtonClass} href={links.history}>
              查看历史记录
              <ArrowRight className="h-4 w-4" />
            </a>
            <button className={subtleButtonClass} type="button" onClick={restoreDefaultWatchlist}>
              恢复默认自选
            </button>
          </div>

          <div className="mt-6 rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-sm leading-6 text-emerald-700">
            <div className="flex items-center gap-2 font-semibold">
              <Shield className="h-4 w-4" />
              资金纪律
            </div>
            <p className="mt-2">
              当前预留资金占总预算 {formatPercent(reserveRatio, 1)}，这让你在阶段二和阶段三出现快速下探时仍有足够现金缓冲。
            </p>
          </div>

          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-600">
            <div className="flex items-center gap-2 font-semibold text-slate-700">
              <LineChart className="h-4 w-4 text-slate-400" />
              趋势提示
            </div>
            <p className="mt-2">
              如果 QQQ 触及 {formatCurrency(nextBuyPrice)} 附近，可以优先回到“加仓配置”页确认第二层权重与总现金使用节奏。
            </p>
          </div>
        </Card>
      </div>
    </PageShell>
  );
}
