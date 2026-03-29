import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Download, Plus, Trash2, Upload } from 'lucide-react';
import { formatCurrency, formatPercent, readAccumulationState } from '../app/accumulation.js';
import { exportHomeDashboardState, importHomeDashboardState, normalizeHomeDashboardState, persistHomeDashboardState, readHomeDashboardState } from '../app/homeDashboard.js';
import { formatPriceAsOf, loadLatestNasdaqPrices, loadNasdaqDailySeries, loadNasdaqMinuteSnapshot } from '../app/nasdaqPrices.js';
import { readPlanList, readPlanState, setActivePlanId } from '../app/plan.js';
import { getPrimaryTabs } from '../app/screens.js';
import { Card, PageHero, PageShell, PageTabs, Pill, SectionHeading, SelectField, StatCard, cx, primaryButtonClass, subtleButtonClass } from '../components/experience-ui.jsx';

const BENCHMARK_CODE = 'nas-daq100';
const DEFAULT_WATCHLIST_CODES = [BENCHMARK_CODE, '513100', '159501', '159660'];
const TIMEFRAME_OPTIONS = [
  { key: '1m', label: '1m', note: '分时' },
  { key: '15m', label: '15m', note: '短线' },
  { key: '1d', label: '1d', note: '日线' }
];
const MAX_CHART_BARS = {
  '1m': 64,
  '15m': 32,
  '1d': 120
};
const STRATEGY_OPTIONS = [
  {
    key: 'ma120-risk',
    label: 'MA120/MA200',
    shortLabel: '均线分层',
    note: 'MA120 主触发 + MA200 风控'
  },
  {
    key: 'peak-drawdown',
    label: '高点回撤 8 档',
    shortLabel: '固定回撤',
    note: '按阶段高点固定跌幅分 8 档执行'
  }
];
const PEAK_DRAWDOWN_LAYERS = [
  { drawdown: 9, label: '首次建仓', signal: '较阶段高点累计跌幅 9%' },
  { drawdown: 12.5, label: '第1次加仓', signal: '较阶段高点累计跌幅 12.5%' },
  { drawdown: 16, label: '第2次加仓', signal: '较阶段高点累计跌幅 16%' },
  { drawdown: 19.5, label: '第3次加仓', signal: '较阶段高点累计跌幅 19.5%' },
  { drawdown: 23, label: '第4次加仓', signal: '较阶段高点累计跌幅 23%' },
  { drawdown: 26.5, label: '第5次加仓', signal: '较阶段高点累计跌幅 26.5%' },
  { drawdown: 30, label: '第6次加仓', signal: '较阶段高点累计跌幅 30%' },
  { drawdown: 33.5, label: '第7次加仓', signal: '较阶段高点累计跌幅 33.5%' }
];

function resolveMarketCurrency(entry = null) {
  return String(entry?.currency || '').trim() || '¥';
}

function formatFundPrice(value, currency = '¥') {
  return formatCurrency(value, currency, 3);
}

function formatCompactNumber(value) {
  return new Intl.NumberFormat('zh-CN', {
    notation: 'compact',
    maximumFractionDigits: 1
  }).format(Number(value) || 0);
}

function formatRawNumber(value, digits = 3) {
  if (value === null || value === undefined || value === '') {
    return '--';
  }

  if (!Number.isFinite(Number(value))) {
    return '--';
  }

  return Number(value).toFixed(digits).replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
}

function mapReferencePrice(value, ratio = 1) {
  const numericValue = Number(value);
  const numericRatio = Number(ratio);

  if (!(numericValue > 0)) {
    return 0;
  }

  if (!(numericRatio > 0) || !Number.isFinite(numericRatio)) {
    return numericValue;
  }

  return numericValue * numericRatio;
}

function findLatestFiniteValue(values = []) {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = values[index];
    if (Number.isFinite(value)) {
      return value;
    }
  }

  return null;
}

function buildDefaultCodes(entries = []) {
  const availableCodes = new Set(entries.map((entry) => entry.code));
  const preferred = DEFAULT_WATCHLIST_CODES.filter((code) => availableCodes.has(code));
  if (preferred.length) {
    return preferred;
  }

  return entries.slice(0, 3).map((entry) => entry.code);
}

function normalizeMinuteBars(rawBars = []) {
  return rawBars
    .filter((bar) => Number.isFinite(Number(bar.close)))
    .map((bar, index) => ({
      id: String(bar.datetime || index),
      sourceIndex: index,
      label: String(bar.datetime || '').slice(11, 16),
      longLabel: String(bar.datetime || '').replace('T', ' '),
      open: Number(bar.open) || 0,
      close: Number(bar.close) || 0,
      high: Number(bar.high) || 0,
      low: Number(bar.low) || 0,
      volume: Number(bar.volume) || 0,
      amount: Number(bar.amount) || 0
    }));
}

function aggregateMinuteBars(minuteBars = [], groupSize = 15) {
  if (!minuteBars.length) {
    return [];
  }

  const aggregated = [];
  for (let index = 0; index < minuteBars.length; index += groupSize) {
    const chunk = minuteBars.slice(index, index + groupSize);
    if (!chunk.length) {
      continue;
    }

    const firstBar = chunk[0];
    const lastBar = chunk[chunk.length - 1];
    aggregated.push({
      id: `${firstBar.id}-${lastBar.id}`,
      sourceIndex: aggregated.length,
      label: lastBar.label,
      longLabel: `${firstBar.longLabel.slice(11, 16)} - ${lastBar.longLabel.slice(11, 16)}`,
      open: firstBar.open,
      close: lastBar.close,
      high: Math.max(...chunk.map((bar) => bar.high)),
      low: Math.min(...chunk.map((bar) => bar.low)),
      volume: chunk.reduce((sum, bar) => sum + bar.volume, 0),
      amount: chunk.reduce((sum, bar) => sum + bar.amount, 0)
    });
  }

  return aggregated;
}

function buildDailyBars(dailyBars = []) {
  return dailyBars
    .filter((bar) => Number.isFinite(Number(bar.close)))
    .sort((left, right) => String(left?.date || '').localeCompare(String(right?.date || '')))
    .map((bar, index) => ({
      id: String(bar.date || index),
      sourceIndex: index,
      label: String(bar.date || '').slice(5),
      longLabel: String(bar.date || ''),
      open: Number(bar.open) || Number(bar.close) || 0,
      close: Number(bar.close) || Number(bar.open) || 0,
      high: Number(bar.high) || Number(bar.close) || Number(bar.open) || 0,
      low: Number(bar.low) || Number(bar.close) || Number(bar.open) || 0,
      volume: Number(bar.volume) || 0,
      amount: Number(bar.amount) || 0
    }));
}

function limitBarsForChart(bars = [], limit = 64) {
  if (!bars.length || bars.length <= limit) {
    return bars;
  }

  const step = (bars.length - 1) / Math.max(limit - 1, 1);
  return Array.from({ length: limit }, (_, index) => bars[Math.min(bars.length - 1, Math.round(index * step))]);
}

function buildMovingAverageValues(bars = [], period = 5, { allowPartial = false } = {}) {
  const values = [];
  const closes = [];
  let rollingSum = 0;

  bars.forEach((bar, index) => {
    const close = Number(bar.close) || 0;
    closes.push(close);
    rollingSum += close;

    if (closes.length > period) {
      rollingSum -= closes[index - period];
    }

    if (allowPartial) {
      values.push(rollingSum / closes.length);
      return;
    }

    values.push(closes.length >= period ? rollingSum / period : null);
  });

  return values;
}

function buildMappedMovingAverage(displayBars = [], fullBars = [], period = 5, { allowPartial = false } = {}) {
  const fullValues = buildMovingAverageValues(fullBars, period, { allowPartial });
  return displayBars.map((bar) => fullValues[bar.sourceIndex] ?? null);
}

function buildNasdaqStrategyPlan({
  totalBudget = 0,
  cashReservePct = 0,
  ma120 = 0,
  ma200 = 0,
  fallbackPrice = 0
} = {}) {
  const triggerPrice = Number(ma120) > 0 ? Number(ma120) : Number(fallbackPrice) || 0;
  const riskPrice = Number(ma200) > 0 ? Number(ma200) : 0;
  const normalizedBudget = Math.max(Number(totalBudget) || 0, 0);
  const normalizedReservePct = Math.max(Number(cashReservePct) || 0, 0);
  const investableCapital = normalizedBudget * Math.max(0, 1 - normalizedReservePct / 100);
  const reserveCapital = normalizedBudget - investableCapital;
  const baseLayers = [
    {
      id: 'ma120-base',
      label: 'MA120 基准',
      signal: '靠近 MA120',
      weight: 1,
      price: triggerPrice,
      drawdown: 0,
      tone: 'violet'
    },
    {
      id: 'ma120-minus-5',
      label: 'MA120 - 5%',
      signal: '低于 MA120 5%',
      weight: 1.5,
      price: triggerPrice > 0 ? triggerPrice * 0.95 : 0,
      drawdown: 5,
      tone: 'indigo'
    },
    {
      id: 'ma120-minus-10',
      label: 'MA120 - 10%',
      signal: '低于 MA120 10%',
      weight: 2,
      price: triggerPrice > 0 ? triggerPrice * 0.9 : 0,
      drawdown: 10,
      tone: 'slate'
    }
  ].filter((layer) => layer.price > 0);
  const deepestBaseLayerPrice = baseLayers[baseLayers.length - 1]?.price || 0;
  const canUseIndependentRiskLayer = riskPrice > 0 && deepestBaseLayerPrice > 0 && riskPrice < deepestBaseLayerPrice;
  const layerBlueprints = [
    ...baseLayers,
    canUseIndependentRiskLayer
      ? {
          id: 'ma200-risk',
          label: 'MA200 风控',
          signal: '跌破 MA200',
          weight: 2.5,
          price: riskPrice,
          drawdown: triggerPrice > 0 ? Math.max((1 - riskPrice / triggerPrice) * 100, 0) : 0,
          tone: 'amber'
        }
      : {
          id: 'ma120-minus-15',
          label: 'MA120 - 15%',
          signal: riskPrice > 0 ? 'MA200 仅作风控，不单列加仓' : '低于 MA120 15%',
          weight: 2.5,
          price: triggerPrice > 0 ? triggerPrice * 0.85 : 0,
          drawdown: 15,
          tone: 'amber'
        }
  ].filter((layer) => layer.price > 0);
  const totalWeight = layerBlueprints.reduce((sum, layer) => sum + layer.weight, 0) || 1;
  const layers = layerBlueprints.map((layer, index) => {
    const amount = investableCapital * (layer.weight / totalWeight);
    const shares = layer.price > 0 ? amount / layer.price : 0;

    return {
      ...layer,
      amount,
      shares,
      order: index + 1
    };
  });
  const totalAmount = layers.reduce((sum, layer) => sum + layer.amount, 0);
  const totalShares = layers.reduce((sum, layer) => sum + layer.shares, 0);

  return {
    layers,
    totalWeight,
    investableCapital,
    reserveCapital,
    averageCost: totalShares > 0 ? totalAmount / totalShares : 0,
    triggerPrice,
    riskPrice,
    usesIndependentRiskLayer: canUseIndependentRiskLayer
  };
}

function buildPeakDrawdownStrategyPlan({
  totalBudget = 0,
  cashReservePct = 0,
  peakPrice = 0,
  fallbackPrice = 0
} = {}) {
  const anchorPrice = Number(peakPrice) > 0 ? Number(peakPrice) : Number(fallbackPrice) || 0;
  const normalizedBudget = Math.max(Number(totalBudget) || 0, 0);
  const normalizedReservePct = Math.max(Number(cashReservePct) || 0, 0);
  const investableCapital = normalizedBudget * Math.max(0, 1 - normalizedReservePct / 100);
  const reserveCapital = normalizedBudget - investableCapital;
  const totalWeight = PEAK_DRAWDOWN_LAYERS.reduce((sum, _, index) => sum + index + 1, 0) || 1;
  const layers = PEAK_DRAWDOWN_LAYERS.map((layer, index) => {
    const weight = index + 1;
    const price = anchorPrice > 0 ? anchorPrice * (1 - layer.drawdown / 100) : 0;
    const amount = investableCapital * (weight / totalWeight);
    const shares = price > 0 ? amount / price : 0;

    return {
      id: `peak-drawdown-${index + 1}`,
      label: layer.label,
      signal: layer.signal,
      weight,
      price,
      amount,
      shares,
      drawdown: layer.drawdown,
      order: index + 1,
      tone: index === PEAK_DRAWDOWN_LAYERS.length - 1 ? 'amber' : index === 0 ? 'violet' : 'slate',
      isExtreme: index === PEAK_DRAWDOWN_LAYERS.length - 1
    };
  }).filter((layer) => layer.price > 0);
  const totalAmount = layers.reduce((sum, layer) => sum + layer.amount, 0);
  const totalShares = layers.reduce((sum, layer) => sum + layer.shares, 0);

  return {
    layers,
    totalWeight,
    investableCapital,
    reserveCapital,
    averageCost: totalShares > 0 ? totalAmount / totalShares : 0,
    triggerPrice: anchorPrice,
    riskPrice: layers[layers.length - 1]?.price || 0,
    anchorPrice,
    usesIndependentRiskLayer: false
  };
}

function resolveNextTriggerLayer(layers = [], currentPrice = 0) {
  const sortedLayers = [...layers]
    .filter((layer) => Number.isFinite(layer.price) && layer.price > 0)
    .sort((left, right) => right.price - left.price);

  if (!sortedLayers.length) {
    return null;
  }

  if (!(Number(currentPrice) > 0)) {
    return sortedLayers[0];
  }

  return sortedLayers.find((layer) => currentPrice > layer.price) || null;
}

function scalePrice(value, minValue, maxValue, top = 8, bottom = 74) {
  if (!Number.isFinite(value) || !Number.isFinite(minValue) || !Number.isFinite(maxValue) || maxValue <= minValue) {
    return (top + bottom) / 2;
  }

  const ratio = (value - minValue) / (maxValue - minValue);
  return bottom - ratio * (bottom - top);
}

function buildLineSegments(points = []) {
  const segments = [];
  let current = [];

  points.forEach((point) => {
    if (!point) {
      if (current.length > 1) {
        segments.push(current.join(' '));
      }
      current = [];
      return;
    }

    current.push(`${point.x},${point.y}`);
  });

  if (current.length > 1) {
    segments.push(current.join(' '));
  }

  return segments;
}

function buildChartGeometry(displayBars = [], overlays = {}) {
  if (!displayBars.length) {
    return {
      candles: [],
      volumeBars: [],
      ma120Segments: [],
      ma200Segments: [],
      xPositions: [],
      scaleMeta: null
    };
  }

  const overlayValues = [
    ...(overlays.ma120 || []),
    ...(overlays.ma200 || [])
  ].filter((value) => Number.isFinite(value));
  const priceValues = [
    ...displayBars.flatMap((bar) => [bar.open, bar.close, bar.high, bar.low]),
    ...overlayValues
  ].filter(Number.isFinite);
  const minPrice = Math.min(...priceValues);
  const maxPrice = Math.max(...priceValues);
  const maxVolume = Math.max(...displayBars.map((bar) => bar.volume), 1);
  const gap = displayBars.length > 1 ? 92 / (displayBars.length - 1) : 0;
  const candleWidth = displayBars.length > 1
    ? Math.max(Math.min(gap * 0.42, 2.8), 1.3)
    : 14;
  const hitBoxWidth = displayBars.length > 1 ? Math.max(gap, 3) : 92;

  const candles = displayBars.map((bar, index) => {
    const x = displayBars.length > 1 ? 4 + gap * index : 50;
    const openY = scalePrice(bar.open, minPrice, maxPrice);
    const closeY = scalePrice(bar.close, minPrice, maxPrice);
    const highY = scalePrice(bar.high, minPrice, maxPrice);
    const lowY = scalePrice(bar.low, minPrice, maxPrice);

    return {
      id: bar.id,
      x,
      rising: bar.close >= bar.open,
      wickTop: highY,
      wickBottom: lowY,
      bodyX: x - candleWidth / 2,
      bodyY: Math.min(openY, closeY),
      bodyHeight: Math.max(Math.abs(closeY - openY), 1.4),
      hitBoxX: x - hitBoxWidth / 2,
      hitBoxWidth
    };
  });

  const volumeBars = displayBars.map((bar, index) => {
    const x = displayBars.length > 1 ? 4 + gap * index : 50;
    const height = Math.max(bar.volume / maxVolume * 16, 1.5);
    return {
      id: `volume-${bar.id}`,
      x: x - candleWidth / 2,
      y: 96 - height,
      width: candleWidth,
      height,
      rising: bar.close >= bar.open
    };
  });

  const ma120Segments = buildLineSegments(
    displayBars.map((bar, index) => {
      const value = overlays.ma120?.[index];
      if (!Number.isFinite(value)) {
        return null;
      }

      const x = displayBars.length > 1 ? 4 + gap * index : 50;
      return { x, y: scalePrice(value, minPrice, maxPrice) };
    })
  );

  const ma200Segments = buildLineSegments(
    displayBars.map((bar, index) => {
      const value = overlays.ma200?.[index];
      if (!Number.isFinite(value)) {
        return null;
      }

      const x = displayBars.length > 1 ? 4 + gap * index : 50;
      return { x, y: scalePrice(value, minPrice, maxPrice) };
    })
  );

  return {
    candles,
    volumeBars,
    ma120Segments,
    ma200Segments,
    xPositions: candles.map((candle) => candle.x),
    scaleMeta: { minPrice, maxPrice }
  };
}

function MobileFoldSection({ eyebrow, title, summary, isOpen, onToggle, children }) {
  return (
    <Card className="p-4">
      <button
        className="flex w-full items-start justify-between gap-3 text-left"
        type="button"
        onClick={onToggle}
      >
        <div className="min-w-0">
          {eyebrow ? <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">{eyebrow}</div> : null}
          <div className="mt-1 text-base font-bold text-slate-900">{title}</div>
          {summary ? (
            <div className="mt-2 min-w-0">
              {typeof summary === 'string' ? (
                <div className="text-sm leading-6 text-slate-500">{summary}</div>
              ) : (
                summary
              )}
            </div>
          ) : null}
        </div>
        <span className="mt-1 inline-flex shrink-0 items-center justify-center rounded-full bg-slate-100 p-2 text-slate-500">
          {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </span>
      </button>
      {isOpen ? <div className="mt-4">{children}</div> : null}
    </Card>
  );
}

export function HomeExperience({ links, inPagesDir = false }) {
  const accumulationState = readAccumulationState();
  const initialPlanState = readPlanState();
  const [dashboardState] = useState(() => readHomeDashboardState());

  const [marketEntries, setMarketEntries] = useState([]);
  const [marketError, setMarketError] = useState('');
  const [planList, setPlanList] = useState(() => readPlanList());
  const [activePlanId, setActivePlanIdState] = useState(() => initialPlanState.id || '');
  const [watchlistCodes, setWatchlistCodes] = useState(dashboardState.watchlistCodes);
  const [selectedCode, setSelectedCode] = useState(() => (initialPlanState.isConfigured ? initialPlanState.symbol : dashboardState.selectedCode));
  const [pendingCode, setPendingCode] = useState('');
  const [minuteSnapshot, setMinuteSnapshot] = useState(null);
  const [fifteenMinuteSnapshot, setFifteenMinuteSnapshot] = useState(null);
  const [dailySeries, setDailySeries] = useState([]);
  const [benchmarkDailySeries, setBenchmarkDailySeries] = useState([]);
  const [pulseError, setPulseError] = useState('');
  const [isLoadingPulse, setIsLoadingPulse] = useState(false);
  const [watchlistNotice, setWatchlistNotice] = useState('');
  const [watchlistNoticeTone, setWatchlistNoticeTone] = useState('slate');
  const [timeframe, setTimeframe] = useState('1m');
  const [activeBarId, setActiveBarId] = useState('');
  const [mobilePanels, setMobilePanels] = useState({
    price: false,
    execution: true,
    watchlist: false,
    plans: false,
    capital: false
  });
  const [mobileChartExpanded, setMobileChartExpanded] = useState(false);
  const [mobileExecutionExpanded, setMobileExecutionExpanded] = useState(false);
  const importInputRef = useRef(null);
  const planState = useMemo(
    () => planList.find((plan) => plan.id === activePlanId) || initialPlanState,
    [activePlanId, initialPlanState, planList]
  );
  const selectedStrategy = planState.selectedStrategy || 'ma120-risk';
  const hasConfiguredPlan = planList.length > 0;

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

  const visibleWatchlistCodes = useMemo(
    () => watchlistCodes.filter((code) => marketByCode.has(code)),
    [marketByCode, watchlistCodes]
  );

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
  }, [marketEntries.length, selectedCode, watchlistItems]);

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
  }, [addableEntries, marketEntries.length, pendingCode]);

  useEffect(() => {
    if (!marketEntries.length) {
      return;
    }

    persistHomeDashboardState({
      watchlistCodes: visibleWatchlistCodes,
      selectedCode
    });
  }, [marketEntries.length, selectedCode, visibleWatchlistCodes]);

  useEffect(() => {
    if (!planList.length) {
      if (activePlanId) {
        setActivePlanIdState('');
      }
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

  useEffect(() => {
    if (!planState?.isConfigured || !planState.symbol || !marketByCode.has(planState.symbol)) {
      return;
    }

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
        if (cancelled) {
          return;
        }

        if (minuteResult.status === 'fulfilled') {
          setMinuteSnapshot(minuteResult.value);
          setPulseError('');
        } else {
          setMinuteSnapshot(null);
          setPulseError(minuteResult.reason instanceof Error ? minuteResult.reason.message : '分钟线数据加载失败');
        }

        if (fifteenMinuteResult.status === 'fulfilled') {
          setFifteenMinuteSnapshot(fifteenMinuteResult.value);
        } else {
          setFifteenMinuteSnapshot(null);
        }

        if (dailySeriesResult.status === 'fulfilled') {
          setDailySeries(dailySeriesResult.value);
        } else {
          setDailySeries([]);
          if (minuteResult.status !== 'fulfilled') {
            setPulseError(dailySeriesResult.reason instanceof Error ? dailySeriesResult.reason.message : '日线数据加载失败');
          }
        }
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

  useEffect(() => {
    if (!benchmarkFund?.code) {
      setBenchmarkDailySeries([]);
      return;
    }

    let cancelled = false;
    loadNasdaqDailySeries(benchmarkFund.code, { inPagesDir })
      .then((bars) => {
        if (!cancelled) {
          setBenchmarkDailySeries(Array.isArray(bars) ? bars : []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBenchmarkDailySeries([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [benchmarkFund?.code, inPagesDir]);

  const normalizedMinuteBars = useMemo(
    () => normalizeMinuteBars(minuteSnapshot?.bars || []),
    [minuteSnapshot]
  );
  const normalizedFifteenMinuteBars = useMemo(
    () => normalizeMinuteBars(fifteenMinuteSnapshot?.bars || []),
    [fifteenMinuteSnapshot]
  );
  const fullBarsByTimeframe = useMemo(() => ({
    '1m': normalizedMinuteBars,
    '15m': normalizedFifteenMinuteBars.length ? normalizedFifteenMinuteBars : aggregateMinuteBars(normalizedMinuteBars, 15),
    '1d': buildDailyBars(dailySeries)
  }), [dailySeries, normalizedFifteenMinuteBars, normalizedMinuteBars]);
  const dailyBars = fullBarsByTimeframe['1d'] || [];
  const benchmarkDailyBars = useMemo(
    () => buildDailyBars(benchmarkDailySeries),
    [benchmarkDailySeries]
  );
  const dailyMa120Values = useMemo(
    () => buildMovingAverageValues(benchmarkDailyBars, 120, { allowPartial: benchmarkDailyBars.length < 120 }),
    [benchmarkDailyBars]
  );
  const dailyMa200Values = useMemo(
    () => buildMovingAverageValues(benchmarkDailyBars, 200, { allowPartial: benchmarkDailyBars.length < 200 }),
    [benchmarkDailyBars]
  );
  const latestDailyMa120 = useMemo(
    () => findLatestFiniteValue(dailyMa120Values),
    [dailyMa120Values]
  );
  const latestDailyMa200 = useMemo(
    () => findLatestFiniteValue(dailyMa200Values),
    [dailyMa200Values]
  );
  const stageHighPrice = useMemo(() => {
    const values = benchmarkDailyBars
      .flatMap((bar) => [Number(bar.high) || 0, Number(bar.close) || 0])
      .filter((value) => Number.isFinite(value) && value > 0);

    return values.length ? Math.max(...values) : 0;
  }, [benchmarkDailyBars]);
  const currentFundPrice = Number(selectedFund?.current_price) || 0;
  const currentBenchmarkPrice = Number(benchmarkFund?.current_price) || currentFundPrice;
  const strategyPriceRatio = useMemo(() => {
    if (currentFundPrice > 0 && currentBenchmarkPrice > 0) {
      return currentFundPrice / currentBenchmarkPrice;
    }

    return 1;
  }, [currentBenchmarkPrice, currentFundPrice]);
  const usesMappedStrategyPrices = Boolean(
    selectedFund?.code
    && benchmarkFund?.code
    && selectedFund.code !== benchmarkFund.code
    && currentFundPrice > 0
    && currentBenchmarkPrice > 0
  );
  const strategyDisplayCurrency = usesMappedStrategyPrices ? selectedFundCurrency : benchmarkCurrency;
  const activeStrategyOption = useMemo(
    () => STRATEGY_OPTIONS.find((option) => option.key === selectedStrategy) || STRATEGY_OPTIONS[0],
    [selectedStrategy]
  );
  const strategyTriggerPrice = useMemo(() => {
    if (Number.isFinite(latestDailyMa120)) {
      return latestDailyMa120;
    }

    if (Number.isFinite(latestDailyMa200)) {
      return latestDailyMa200;
    }

    if (Number.isFinite(currentBenchmarkPrice) && currentBenchmarkPrice > 0) {
      return currentBenchmarkPrice;
    }

    return Number(planState.basePrice) || Number(accumulationState.basePrice) || 0;
  }, [accumulationState.basePrice, currentBenchmarkPrice, latestDailyMa120, latestDailyMa200, planState.basePrice]);
  const riskControlPrice = useMemo(() => {
    if (Number.isFinite(latestDailyMa200)) {
      return latestDailyMa200;
    }

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

      return {
        ...layer,
        price: mappedPrice,
        shares: mappedPrice > 0 ? layer.amount / mappedPrice : 0
      };
    })
  }), [strategyPlan, strategyPriceRatio]);
  const displayTriggerPrice = mapReferencePrice(strategyTriggerPrice, strategyPriceRatio);
  const displayRiskControlPrice = mapReferencePrice(riskControlPrice, strategyPriceRatio);
  const displayStageHighPrice = mapReferencePrice(stageHighPrice, strategyPriceRatio);
  const strategyDisplayCurrentPrice = usesMappedStrategyPrices ? currentFundPrice : currentBenchmarkPrice;
  const reserveRatio = planState.totalBudget > 0 ? strategyPlan.reserveCapital / planState.totalBudget * 100 : 0;
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
        progressLabel: isCompleted ? '已完成' : isNext ? '下一档' : '待触发',
        progressTone: isCompleted ? 'emerald' : isNext ? 'indigo' : 'slate'
      };
    }),
    [displayStrategyPlan.layers, nextTriggerLayer?.id, strategyDisplayCurrentPrice]
  );
  const completedLayerCount = useMemo(
    () => executionLayers.filter((layer) => layer.progressState === 'completed').length,
    [executionLayers]
  );
  const recentCompletedLayers = useMemo(
    () => executionLayers.filter((layer) => layer.progressState === 'completed').slice(-2).reverse(),
    [executionLayers]
  );
  const isBelowRiskControl = currentBenchmarkPrice > 0 && riskControlPrice > 0 && currentBenchmarkPrice < riskControlPrice;
  const isBelowPeakExtreme = selectedStrategy === 'peak-drawdown' && currentBenchmarkPrice > 0 && strategyPlan.riskPrice > 0 && currentBenchmarkPrice <= strategyPlan.riskPrice;

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
      if (activeBarId) {
        setActiveBarId('');
      }
      return;
    }

    if (!displayBars.some((bar) => bar.id === activeBarId)) {
      setActiveBarId(displayBars[displayBars.length - 1].id);
    }
  }, [activeBarId, displayBars]);

  const activeBarIndex = useMemo(
    () => displayBars.findIndex((bar) => bar.id === activeBarId),
    [activeBarId, displayBars]
  );
  const resolvedActiveBarIndex = activeBarIndex >= 0 ? activeBarIndex : Math.max(displayBars.length - 1, 0);
  const activeBar = displayBars[resolvedActiveBarIndex] || null;
  const activeMa120 = resolvedActiveBarIndex >= 0 ? ma120Values[resolvedActiveBarIndex] : null;
  const activeMa200 = resolvedActiveBarIndex >= 0 ? ma200Values[resolvedActiveBarIndex] : null;
  const activeCandle = chartGeometry.candles[resolvedActiveBarIndex] || null;
  const activeCloseY = activeBar && chartGeometry.scaleMeta
    ? scalePrice(activeBar.close, chartGeometry.scaleMeta.minPrice, chartGeometry.scaleMeta.maxPrice)
    : null;

  const pricePulse = useMemo(() => {
    if (!selectedFund || !displayBars.length) {
      return null;
    }

    const latestBar = activeBar || displayBars[displayBars.length - 1];
    const firstBar = displayBars[0];
    const latestPrice = Number(selectedFund.current_price) || latestBar.close || 0;
    const openPrice = firstBar.open || latestPrice;
    const highPrice = Math.max(...displayBars.map((bar) => bar.high), latestPrice);
    const lowPrice = Math.min(...displayBars.map((bar) => bar.low), latestPrice);
    const changePct = openPrice > 0 ? (latestPrice - openPrice) / openPrice * 100 : 0;
    const totalAmount = displayBars.reduce((sum, bar) => sum + bar.amount, 0);
    const totalVolume = displayBars.reduce((sum, bar) => sum + bar.volume, 0);
    const hasAmountData = displayBars.some((bar) => Number(bar.amount) > 0);

    return {
      bars: displayBars,
      latestPrice,
      openPrice,
      highPrice,
      lowPrice,
      totalAmount,
      totalVolume,
      volumeMetricValue: formatCompactNumber(totalVolume),
      hasAmountData,
      changePct,
      asOf: formatPriceAsOf(selectedFund)
    };
  }, [activeBar, displayBars, selectedFund]);
  const nextStepSuggestion = useMemo(() => {
    if (!executionLayers.length) {
      return {
        title: '先创建一条建仓策略',
        note: '创建后首页会按策略给出下一档和资金分配建议。'
      };
    }

    if (nextTriggerLayer) {
      if (completedLayerCount > 0) {
        return {
          title: `等待第 ${nextTriggerLayer.order} 档触发`,
          note: `下一次参考买点 ${formatFundPrice(nextTriggerLayer.price, strategyDisplayCurrency)}，保持分批执行。`
        };
      }

      return {
        title: '首档尚未触发',
        note: `当前先观察，等待价格回落到 ${formatFundPrice(nextTriggerLayer.price, strategyDisplayCurrency)} 附近。`
      };
    }

    return selectedStrategy === 'peak-drawdown'
      ? {
          title: '已进入极端回撤区',
          note: '后续更看重节奏控制和现金缓冲，不建议一次性打满。'
        }
      : {
          title: '已进入最深防守区',
          note: '继续以小步分批为主，优先保留机动现金。'
      };
  }, [completedLayerCount, executionLayers.length, nextTriggerLayer, selectedStrategy, strategyDisplayCurrency]);
  const currentDecisionSummary = useMemo(() => {
    if (!executionLayers.length) {
      return {
        title: '待创建策略',
        note: '先创建一条策略后，首页才会生成下一档判断。',
        detail: ''
      };
    }

    if (nextTriggerLayer && strategyDisplayCurrentPrice > 0 && nextTriggerLayer.price > 0) {
      const dropNeededPct = Math.max((strategyDisplayCurrentPrice - nextTriggerLayer.price) / strategyDisplayCurrentPrice * 100, 0);
      return {
        title: `距离下一档还差 ${formatPercent(dropNeededPct, 1)}`,
        note: nextTriggerLayer.signal,
        detail: `参考价 ${formatFundPrice(nextTriggerLayer.price, strategyDisplayCurrency)}`
      };
    }

    if (completedLayerCount > 0) {
      return {
        title: `已进入第 ${completedLayerCount} 档`,
        note: completedLayerCount >= executionLayers.length ? '当前已经进入最深触发区。' : '当前价格已进入已完成档位区间。',
        detail: ''
      };
    }

    return {
      title: '首档尚未触发',
      note: '当前还未进入首档。',
      detail: `等待价格靠近 ${formatFundPrice(nextBuyPrice, strategyDisplayCurrency)} 再执行。`
    };
  }, [completedLayerCount, executionLayers.length, nextBuyPrice, nextTriggerLayer, strategyDisplayCurrentPrice, strategyDisplayCurrency]);
  const mobileProgressPct = executionLayers.length ? completedLayerCount / executionLayers.length * 100 : 0;

  function toggleMobilePanel(panelKey) {
    setMobilePanels((current) => ({
      ...current,
      [panelKey]: !current[panelKey]
    }));
  }

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
      selectedCode,
      selectedStrategy
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

  function handleSelectPlan(planId) {
    const targetPlan = planList.find((plan) => plan.id === planId);
    if (!targetPlan) {
      return;
    }

    setActivePlanIdState(targetPlan.id);
    setActivePlanId(targetPlan.id);

    if (targetPlan.symbol) {
      setSelectedCode(targetPlan.symbol);
      setWatchlistCodes((current) => (current.includes(targetPlan.symbol) ? current : [...current, targetPlan.symbol]));
    }
  }

  const primaryTabs = getPrimaryTabs(links);

  return (
    <PageShell>
      <PageHero
        eyebrow="Strategy Dashboard"
        title="QQQ 建仓策略总览"
        badges={[
          <Pill key="status" tone="indigo">{hasConfiguredPlan ? '已创建策略' : '待创建策略'}</Pill>
        ]}
      >
        <PageTabs activeKey="home" tabs={primaryTabs} />
      </PageHero>

      <div className="mx-auto max-w-6xl space-y-6 px-6 pt-8">
        <div className="space-y-4 md:hidden">
          <Card className="overflow-hidden border-0 bg-gradient-to-br from-indigo-600 via-indigo-500 to-sky-500 p-0 text-white shadow-xl shadow-indigo-200">
            <div className="space-y-5 p-5">
              <div className="space-y-3">
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/70">当前执行策略</div>
                <div className="space-y-2">
                  <div className="max-w-[14ch] break-words text-[28px] font-extrabold leading-[1.15]">
                    {planState?.name || activeStrategyOption.label}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-semibold text-white">
                    {activeStrategyOption.shortLabel}
                  </span>
                  <span className="rounded-full bg-white/12 px-3 py-1 text-xs font-semibold text-white/90">
                    基准 {benchmarkFund?.code || BENCHMARK_CODE}
                  </span>
                </div>
                <div className="rounded-[22px] bg-white/12 px-4 py-3 backdrop-blur-sm">
                  <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/70">当前观察标的</div>
                  <div className="mt-1 text-base font-semibold leading-6 text-white">{selectedFund?.code || '--'}</div>
                  {selectedFund?.name ? (
                    <div className="text-sm leading-6 text-indigo-100">{selectedFund.name}</div>
                  ) : null}
                </div>
              </div>

              <div className="grid gap-3">
                <div className="rounded-[22px] bg-white/12 px-4 py-3 backdrop-blur-sm">
                  <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/70">当前价格</div>
                  <div className="mt-2 min-w-0 break-all text-[24px] font-extrabold leading-tight">
                    {formatFundPrice(strategyDisplayCurrentPrice, strategyDisplayCurrency)}
                  </div>
                </div>
                <div className="rounded-[22px] bg-white/12 px-4 py-3 backdrop-blur-sm">
                  <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/70">下一次触发</div>
                  <div className="mt-2 min-w-0 break-all text-[24px] font-extrabold leading-tight">
                    {nextTriggerLayer ? formatFundPrice(nextBuyPrice, strategyDisplayCurrency) : '已到深水区'}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between text-sm font-semibold text-white/90">
                <span>已完成层级</span>
                <span>{completedLayerCount}/{executionLayers.length || 0}</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/15">
                <div
                  className="h-full rounded-full bg-emerald-300"
                  style={{ width: `${Math.max(Math.min(mobileProgressPct, 100), 0)}%` }}
                />
              </div>

              <div className="rounded-[24px] bg-white/12 px-4 py-3 backdrop-blur-sm">
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/70">当前判断</div>
                <div className="mt-2 text-base font-semibold leading-6 text-white">{currentDecisionSummary.title}</div>
                <div className="mt-1 text-sm leading-6 text-indigo-100">{currentDecisionSummary.note}</div>
                {currentDecisionSummary.detail ? (
                  <div className="text-sm leading-6 text-indigo-100">{currentDecisionSummary.detail}</div>
                ) : null}
                <div className="mt-2 text-xs font-semibold uppercase tracking-[0.16em] text-white/70">动作建议</div>
                <div className="mt-1 text-sm leading-6 text-indigo-100">{nextStepSuggestion.title}</div>
              </div>
            </div>
          </Card>

          <MobileFoldSection
            eyebrow="Plans"
            title="策略列表"
            summary={planList.length ? (
              <div className="space-y-1 text-sm text-slate-500">
                <div className="font-semibold text-slate-800">{planState?.name || '当前策略'}</div>
                <div>共 {planList.length} 条策略，首页只读切换查看</div>
              </div>
            ) : '当前还没有策略，先创建一条再回到首页查看。'}
            isOpen={mobilePanels.plans}
            onToggle={() => toggleMobilePanel('plans')}
          >
            <a className={cx(primaryButtonClass, 'w-full')} href={links.accumNew}>
              <Plus className="h-4 w-4 shrink-0" />
              新建策略
            </a>

            {planList.length ? (
              <div className="mt-4 space-y-3">
                {planList.map((plan) => {
                  const isActive = plan.id === planState.id;
                  return (
                    <button
                      key={`mobile-plan-${plan.id}`}
                      className={cx(
                        'w-full rounded-[22px] border px-4 py-4 text-left transition-all',
                        isActive ? 'border-indigo-200 bg-indigo-50 shadow-sm shadow-indigo-100' : 'border-slate-200 bg-slate-50'
                      )}
                      type="button"
                      onClick={() => handleSelectPlan(plan.id)}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="break-words text-sm font-semibold text-slate-900">{plan.name}</div>
                          <div className="mt-2 text-xs leading-5 text-slate-500">
                            标的 {plan.symbol}
                          </div>
                          <div className="text-xs leading-5 text-slate-500">
                            预算 {formatCurrency(plan.totalBudget, '¥ ')}
                          </div>
                        </div>
                        {isActive ? <Pill tone="emerald">当前</Pill> : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-500">
                还没有已创建的策略。
              </div>
            )}
          </MobileFoldSection>

          <MobileFoldSection
            eyebrow="Price Pulse"
            title="价格走势"
            summary={selectedFund && pricePulse ? (
              <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
                <span className="font-semibold text-slate-800">{selectedFund.code}</span>
                <span>{formatFundPrice(pricePulse.latestPrice, selectedFundCurrency)}</span>
                <span className={pricePulse.changePct >= 0 ? 'font-semibold text-emerald-600' : 'font-semibold text-rose-600'}>
                  {formatPercent(pricePulse.changePct, 2, true)}
                </span>
              </div>
            ) : '当前还没有可展示的价格走势数据。'}
            isOpen={mobilePanels.price}
            onToggle={() => toggleMobilePanel('price')}
          >
            {selectedFund && pricePulse ? (
              <div className="space-y-4">
                <div className="flex flex-col gap-3">
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">当前价格</div>
                      <div className="mt-1 text-2xl font-extrabold text-slate-900">{formatFundPrice(pricePulse.latestPrice, selectedFundCurrency)}</div>
                    </div>
                    <div className={cx('text-sm font-semibold', pricePulse.changePct >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
                      {formatPercent(pricePulse.changePct, 2, true)}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 rounded-full bg-slate-100 p-1">
                    {TIMEFRAME_OPTIONS.map((option) => (
                      <button
                        key={option.key}
                        className={cx(
                          'rounded-full px-3 py-1.5 text-xs font-semibold transition-colors',
                          timeframe === option.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
                        )}
                        type="button"
                        onClick={() => setTimeframe(option.key)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                {mobileChartExpanded ? (
                  <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-2xl bg-slate-50 px-3 py-2">
                      <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">成交量</div>
                      <div className="mt-1 text-sm font-semibold text-slate-900">{pricePulse.volumeMetricValue}</div>
                    </div>
                    <div className="rounded-2xl bg-slate-50 px-3 py-2">
                      <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">MA120</div>
                      <div className="mt-1 text-sm font-semibold text-violet-600">{formatRawNumber(activeMa120)}</div>
                    </div>
                    <div className="rounded-2xl bg-slate-50 px-3 py-2">
                      <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">MA200</div>
                      <div className="mt-1 text-sm font-semibold text-amber-600">{formatRawNumber(activeMa200)}</div>
                    </div>
                  </div>
                ) : null}

                <div className="relative min-w-0 overflow-hidden rounded-[24px] border border-slate-200 bg-white">
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(99,102,241,0.12),_transparent_34%),radial-gradient(circle_at_bottom_right,_rgba(16,185,129,0.08),_transparent_32%)]" />
                  <svg className={cx('relative w-full', mobileChartExpanded ? 'h-[320px]' : 'h-[200px]')} preserveAspectRatio="none" viewBox="0 0 100 100">
                    <line stroke="rgba(148,163,184,0.16)" strokeDasharray="1.5 2.5" strokeWidth="0.4" x1="4" x2="96" y1="16" y2="16" />
                    <line stroke="rgba(148,163,184,0.16)" strokeDasharray="1.5 2.5" strokeWidth="0.4" x1="4" x2="96" y1="32" y2="32" />
                    <line stroke="rgba(148,163,184,0.16)" strokeDasharray="1.5 2.5" strokeWidth="0.4" x1="4" x2="96" y1="48" y2="48" />
                    <line stroke="rgba(148,163,184,0.16)" strokeDasharray="1.5 2.5" strokeWidth="0.4" x1="4" x2="96" y1="64" y2="64" />
                    <line stroke="rgba(148,163,184,0.2)" strokeWidth="0.5" x1="4" x2="96" y1="79" y2="79" />

                    {chartGeometry.volumeBars.map((bar) => (
                      <rect
                        key={bar.id}
                        fill={bar.rising ? 'rgba(16,185,129,0.22)' : 'rgba(244,63,94,0.18)'}
                        height={bar.height}
                        rx="0.25"
                        width={Math.max(bar.width, 1.2)}
                        x={bar.x}
                        y={bar.y}
                      />
                    ))}

                    {chartGeometry.ma120Segments.map((segment, index) => (
                      <polyline
                        key={`mobile-ma120-${index}`}
                        fill="none"
                        points={segment}
                        stroke="#7c3aed"
                        strokeWidth={timeframe === '1d' ? '1.6' : '1.2'}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    ))}

                    {chartGeometry.ma200Segments.map((segment, index) => (
                      <polyline
                        key={`mobile-ma200-${index}`}
                        fill="none"
                        points={segment}
                        stroke="#f59e0b"
                        strokeWidth={timeframe === '1d' ? '1.6' : '1.2'}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    ))}

                    {chartGeometry.candles.map((candle) => (
                      <g key={`mobile-${candle.id}`}>
                        <line
                          stroke={candle.rising ? '#10b981' : '#f43f5e'}
                          strokeWidth="0.7"
                          x1={candle.x}
                          x2={candle.x}
                          y1={candle.wickTop}
                          y2={candle.wickBottom}
                        />
                        <rect
                          fill={candle.rising ? '#10b981' : '#f43f5e'}
                          height={candle.bodyHeight}
                          rx="0.35"
                          width={Math.max(candle.hitBoxWidth > 5 ? 1.9 : 1.4, 1.2)}
                          x={candle.bodyX}
                          y={candle.bodyY}
                        />
                        <rect
                          fill="transparent"
                          height="100"
                          width={candle.hitBoxWidth}
                          x={candle.hitBoxX}
                          y="0"
                          onClick={() => setActiveBarId(candle.id)}
                        />
                      </g>
                    ))}

                    {activeCandle && Number.isFinite(activeCloseY) ? (
                      <g>
                        <line stroke="rgba(15,23,42,0.28)" strokeDasharray="1.8 2.2" strokeWidth="0.5" x1={activeCandle.x} x2={activeCandle.x} y1="6" y2="96" />
                        <line stroke="rgba(15,23,42,0.18)" strokeDasharray="1.8 2.2" strokeWidth="0.5" x1="4" x2="96" y1={activeCloseY} y2={activeCloseY} />
                        <circle cx={activeCandle.x} cy={activeCloseY} fill="#312e81" r="1.2" />
                      </g>
                    ) : null}
                  </svg>

                  <div className="pointer-events-none absolute left-3 top-3 right-3 flex items-center justify-between gap-3 text-[10px] font-semibold">
                    <span className="truncate rounded-full bg-slate-900 px-2.5 py-1 text-white">{selectedFund.code}</span>
                    <span className="truncate rounded-full bg-white/95 px-2.5 py-1 text-slate-600">{pricePulse.asOf || minuteSnapshot?.date || ''}</span>
                  </div>
                </div>

                {mobileChartExpanded ? (
                  <div className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="font-semibold text-slate-800">{activeBar?.longLabel || selectedFund.name}</span>
                      <span>开 {formatRawNumber(activeBar?.open)}</span>
                      <span>高 {formatRawNumber(activeBar?.high)}</span>
                      <span>低 {formatRawNumber(activeBar?.low)}</span>
                      <span>收 {formatRawNumber(activeBar?.close)}</span>
                    </div>
                  </div>
                ) : null}

                <button
                  className={cx(subtleButtonClass, 'w-full')}
                  type="button"
                  onClick={() => setMobileChartExpanded((current) => !current)}
                >
                  {mobileChartExpanded ? '收起完整 K 线' : '展开完整 K 线'}
                </button>
              </div>
            ) : (
              <div className="rounded-[20px] border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-500">
                {pulseError || marketError
                  ? `价格走势加载失败：${pulseError || marketError}`
                  : isLoadingPulse
                    ? '正在加载价格走势数据...'
                    : '请选择一个自选基金后查看价格走势。'}
              </div>
            )}
          </MobileFoldSection>

          <MobileFoldSection
            eyebrow="Execution"
            title="建仓计划详情"
            summary={
              <div className="space-y-1 text-sm text-slate-500">
                <div>已完成 {completedLayerCount}/{executionLayers.length} 档</div>
                <div>{nextTriggerLayer ? `下一档参考价 ${formatFundPrice(nextTriggerLayer.price, strategyDisplayCurrency)}` : '当前已经进入最深触发区'}</div>
              </div>
            }
            isOpen={mobilePanels.execution}
            onToggle={() => toggleMobilePanel('execution')}
          >
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-[20px] bg-slate-50 px-4 py-3">
                <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">当前价格</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">{formatFundPrice(strategyDisplayCurrentPrice, strategyDisplayCurrency)}</div>
              </div>
              <div className="rounded-[20px] bg-slate-50 px-4 py-3">
                <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">参考基准</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">{benchmarkFund?.code || BENCHMARK_CODE}</div>
              </div>
            </div>

            {nextTriggerLayer ? (
              <div className="mt-4 rounded-[24px] border border-indigo-200 bg-indigo-50/70 p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
                      下一档
                    </div>
                    <div className="mt-1 text-sm font-semibold text-slate-900">{nextTriggerLayer.signal}</div>
                  </div>
                  <Pill tone="indigo">待触发</Pill>
                </div>
                <div className="mt-4 grid gap-3 rounded-2xl bg-white/80 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">触发价格</div>
                    <div className="text-sm font-semibold text-slate-900">{formatFundPrice(nextTriggerLayer.price, strategyDisplayCurrency)}</div>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">计划金额</div>
                    <div className="text-sm font-semibold text-slate-900">{formatCurrency(nextTriggerLayer.amount)}</div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-4 rounded-[24px] border border-amber-200 bg-amber-50/80 px-4 py-4 text-sm text-amber-700">
                当前已经进入最深触发区，后续更看重分批节奏和现金缓冲。
              </div>
            )}

            {recentCompletedLayers.length ? (
              <div className="mt-4 rounded-[24px] border border-emerald-200 bg-emerald-50/70 p-4 shadow-sm">
                <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">最近已完成</div>
                <div className="mt-3 space-y-2">
                  {recentCompletedLayers.map((layer) => (
                    <div key={`mobile-completed-${layer.id}`} className="flex items-center justify-between gap-3 rounded-2xl bg-white/80 px-3 py-2">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-slate-900">{layer.signal}</div>
                        <div className="mt-1 text-xs text-slate-500">{formatFundPrice(layer.price, strategyDisplayCurrency)}</div>
                      </div>
                      <Pill tone="emerald">已完成</Pill>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="mt-4">
              <button
                className={cx(subtleButtonClass, 'w-full')}
                type="button"
                onClick={() => setMobileExecutionExpanded((current) => !current)}
              >
                {mobileExecutionExpanded ? '收起完整档位' : '查看全部档位'}
              </button>
            </div>

            {mobileExecutionExpanded ? (
              <div className="mt-4 space-y-3">
                {executionLayers.map((layer) => (
                  <div
                    key={`mobile-layer-${layer.id}`}
                    className={cx(
                      'rounded-[24px] border p-4 shadow-sm',
                      layer.progressState === 'completed'
                        ? 'border-emerald-200 bg-emerald-50/70'
                        : layer.progressState === 'next'
                          ? 'border-indigo-200 bg-indigo-50/70'
                          : 'border-slate-200 bg-slate-50/80'
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
                          第 {String(layer.order).padStart(2, '0')} 档
                        </div>
                        <div className="mt-1 text-sm font-semibold text-slate-900">{layer.signal}</div>
                      </div>
                      <Pill tone={layer.progressTone}>{layer.progressLabel}</Pill>
                    </div>

                    <div className="mt-4 grid gap-3 rounded-2xl bg-white/80 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">触发价格</div>
                        <div className="text-sm font-semibold text-slate-900">{formatFundPrice(layer.price, strategyDisplayCurrency)}</div>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">累计跌幅</div>
                        <div className="text-sm font-semibold text-slate-900">
                          {selectedStrategy === 'peak-drawdown' ? formatPercent(layer.drawdown, 1) : (layer.order === 1 ? '基准' : formatPercent(layer.drawdown, 1))}
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">计划金额</div>
                        <div className="text-sm font-semibold text-slate-900">{formatCurrency(layer.amount)}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </MobileFoldSection>

          <MobileFoldSection
            eyebrow="Capital Mix"
            title="资金配置模型"
            summary={
              <div className="space-y-1 text-sm text-slate-500">
                <div>可投资 {formatCurrency(strategyPlan.investableCapital)}</div>
                <div>预留现金 {formatCurrency(strategyPlan.reserveCapital)}</div>
              </div>
            }
            isOpen={mobilePanels.capital}
            onToggle={() => toggleMobilePanel('capital')}
          >
            <div className="rounded-[28px] border border-slate-200 bg-slate-50/80 p-4">
              <div className="mx-auto flex flex-col items-center gap-3">
                {strategyPlan.layers.map((layer, index) => {
                  const maxWeight = strategyPlan.layers[strategyPlan.layers.length - 1]?.weight || 1;
                  const widthPct = `${Math.min(100, 44 + layer.weight / maxWeight * 56)}%`;
                  const bandClass = layer.tone === 'amber'
                    ? 'from-amber-500 to-orange-500'
                    : layer.tone === 'violet'
                      ? 'from-violet-600 to-indigo-600'
                      : index === strategyPlan.layers.length - 1
                        ? 'from-indigo-600 to-sky-600'
                        : 'from-slate-600 to-slate-500';

                  return (
                    <div key={`mobile-capital-${layer.id}`} className="w-full">
                      <div
                        className={cx(
                          'mx-auto flex max-w-full items-center justify-between gap-3 rounded-[24px] bg-gradient-to-r px-4 py-3 text-white shadow-[0_10px_24px_rgba(15,23,42,0.10)] ring-1 ring-white/20',
                          bandClass
                        )}
                        style={{ width: widthPct }}
                      >
                        <div className="min-w-0">
                          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/70">
                            {selectedStrategy === 'peak-drawdown' ? `档位 ${String(layer.order).padStart(2, '0')}` : `第 ${layer.order} 档`}
                          </div>
                          <div className="mt-1 truncate text-sm font-extrabold">
                            {selectedStrategy === 'peak-drawdown' ? layer.label : layer.signal}
                          </div>
                        </div>
                        <div className="shrink-0 rounded-full bg-white/15 px-3 py-1 text-sm font-extrabold">
                          {`${formatRawNumber(layer.weight, 1)}x`}
                        </div>
                      </div>
                      <div className="mx-auto mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-2 text-[11px] font-semibold text-slate-500">
                        <span>{formatFundPrice(layer.price, strategyDisplayCurrency)}</span>
                        <span>{selectedStrategy === 'peak-drawdown' ? formatPercent(layer.drawdown, 1) : (layer.order === 1 ? '基准层' : formatPercent(layer.drawdown, 1))}</span>
                        <span>{formatCurrency(layer.amount)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </MobileFoldSection>
        </div>

        <div className="hidden space-y-6 md:block">
        <Card className="p-4 sm:p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Strategy Template</div>
              <div className="mt-1 text-lg font-bold text-slate-800">{activeStrategyOption.label}</div>
              <div className="mt-1 text-sm text-slate-500">{activeStrategyOption.note}</div>
              <div className="mt-1 text-sm text-slate-500">
                策略在“新建建仓计划”页面创建，首页只读查看执行配置。
              </div>
              {planState?.name ? (
                <div className="mt-1 text-sm text-slate-500">
                  当前策略 {planState.name}
                </div>
              ) : null}
              <div className="mt-2 space-y-1 text-sm text-slate-500">
                <div>当前观察标的</div>
                <div>{selectedFund?.code || '--'}</div>
                <div>{formatFundPrice(currentFundPrice, selectedFundCurrency)}</div>
              </div>
              <div className="mt-2 space-y-1 text-sm text-slate-500">
                <div>参考基准</div>
                <div>{benchmarkFund?.code || BENCHMARK_CODE}</div>
                <div>{formatFundPrice(currentBenchmarkPrice, benchmarkCurrency)}</div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 lg:justify-end">
              <Pill tone="indigo">{activeStrategyOption.shortLabel}</Pill>
              <Pill tone="slate">{hasConfiguredPlan ? '只读展示' : '使用默认模板预览'}</Pill>
            </div>
          </div>
        </Card>

        <Card>
          <SectionHeading
            eyebrow="Plans"
            title="策略列表"
            description="先在新建页创建策略，再回到这里切换查看。首页不直接修改策略模板。"
            action={
              <a className={cx(primaryButtonClass, 'w-full sm:w-auto')} href={links.accumNew}>
                <Plus className="h-4 w-4 shrink-0" />
                新建策略
              </a>
            }
          />

          {planList.length ? (
            <div className="mt-5 grid gap-3">
              {planList.map((plan) => {
                const isActive = plan.id === planState.id;
                return (
                  <button
                    key={plan.id}
                    className={cx(
                      'rounded-[24px] border px-4 py-4 text-left transition-all',
                      isActive
                        ? 'border-indigo-200 bg-indigo-50 shadow-sm shadow-indigo-100'
                        : 'border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white'
                    )}
                    type="button"
                    onClick={() => handleSelectPlan(plan.id)}
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="break-words text-base font-semibold leading-6 text-slate-900">{plan.name}</div>
                          {isActive ? <Pill tone="emerald">当前查看</Pill> : null}
                        </div>
                        <div className="mt-2 space-y-1 text-sm text-slate-500">
                          <div>标的 {plan.symbol}</div>
                          <div>预算 {formatCurrency(plan.totalBudget, '¥ ')}</div>
                        </div>
                      </div>
                      <div className="shrink-0 self-start text-sm font-semibold text-slate-500 sm:self-center">
                        {isActive ? '当前策略' : '点击查看'}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-500">
              还没有已创建的策略。先进入“新建策略”页创建一条，首页才会出现可切换的策略列表。
            </div>
          )}
        </Card>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard accent="indigo" eyebrow="Portfolio Budget" value={formatCurrency(strategyPlan.investableCapital)} note={selectedStrategy === 'peak-drawdown' ? '按阶段高点固定回撤 8 档分配预算' : '按 MA120 主触发策略分配的预算'} progress={Math.max(100 - reserveRatio, 0)} />
          <StatCard eyebrow="Reserve Cash" value={formatCurrency(strategyPlan.reserveCapital)} note={selectedStrategy === 'peak-drawdown' ? (isBelowPeakExtreme ? '价格已进入第 8 档极端区。' : `${formatPercent(reserveRatio, 1)} 作为极端回撤缓冲`) : (isBelowRiskControl ? '价格已跌破 MA200，进入防守区。' : strategyPlan.usesIndependentRiskLayer ? `${formatPercent(reserveRatio, 1)} 作为 MA200 防守缓冲` : 'MA200 当前高于深水层，仅作趋势风控。')} />
          <StatCard
            eyebrow="Next Trigger"
            value={formatFundPrice(nextBuyPrice, strategyDisplayCurrency)}
            note={nextTriggerLayer ? (
              <>
                <div>{benchmarkFund?.code || BENCHMARK_CODE} 信号</div>
                <div>映射到 {selectedFund?.code || benchmarkFund?.code || BENCHMARK_CODE}</div>
              </>
            ) : selectedStrategy === 'peak-drawdown' ? '当前已进入第 8 档极端区' : '当前已进入最深防守区'}
          />
          <StatCard accent="emerald" eyebrow="Average Cost" value={formatFundPrice(displayStrategyPlan.averageCost, strategyDisplayCurrency)} note={selectedStrategy === 'peak-drawdown' ? `${benchmarkFund?.code || BENCHMARK_CODE} 固定跌幅 8 档映射` : `${benchmarkFund?.code || BENCHMARK_CODE} MA120 / MA200 映射`} />

          <Card className="min-w-0 md:col-span-2 xl:col-start-2 xl:col-span-3">
            <SectionHeading
              eyebrow="Execution Map"
              title="建仓计划详情"
              action={
                <div className="flex flex-wrap items-start gap-2">
                  <Pill tone="indigo">基准 {benchmarkFund?.code || BENCHMARK_CODE}</Pill>
                  <Pill tone="slate">标的 {selectedFund?.code || '--'}</Pill>
                  {selectedStrategy === 'peak-drawdown' ? (
                    <>
                      <Pill tone="violet">阶段高点 {formatFundPrice(displayStageHighPrice, strategyDisplayCurrency)}</Pill>
                    </>
                  ) : (
                    <>
                      <Pill tone="violet">MA120 触发 {formatFundPrice(displayTriggerPrice, strategyDisplayCurrency)}</Pill>
                      <Pill tone="amber">MA200 风控 {formatFundPrice(displayRiskControlPrice, strategyDisplayCurrency)}</Pill>
                    </>
                  )}
                </div>
              }
            />
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Pill tone="slate">当前标的现价 {formatFundPrice(strategyDisplayCurrentPrice, strategyDisplayCurrency)}</Pill>
              <Pill tone="emerald">已完成 {completedLayerCount}/{executionLayers.length} 档</Pill>
            </div>
            <div className="mt-5 space-y-3 md:hidden">
              {executionLayers.map((layer) => (
                <div
                  key={layer.id}
                  className={cx(
                    'rounded-[24px] border p-4 shadow-sm',
                    layer.progressState === 'completed'
                      ? 'border-emerald-200 bg-emerald-50/70'
                      : layer.progressState === 'next'
                        ? 'border-indigo-200 bg-indigo-50/70'
                        : 'border-slate-200 bg-slate-50/80'
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
                        第 {String(layer.order).padStart(2, '0')} 档
                      </div>
                      <div className="mt-1 text-sm font-semibold text-slate-900">{layer.signal}</div>
                    </div>
                    <Pill tone={layer.progressTone}>{layer.progressLabel}</Pill>
                  </div>

                  <div className="mt-4 grid gap-3 rounded-2xl bg-white/80 p-3 sm:grid-cols-3">
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">触发价格</div>
                      <div className="mt-1 text-sm font-semibold text-slate-900">{formatFundPrice(layer.price, strategyDisplayCurrency)}</div>
                    </div>
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">累计跌幅</div>
                      <div className="mt-1 text-sm font-semibold text-slate-900">
                        {selectedStrategy === 'peak-drawdown' ? formatPercent(layer.drawdown, 1) : (layer.order === 1 ? '基准' : formatPercent(layer.drawdown, 1))}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">计划金额</div>
                      <div className="mt-1 text-sm font-semibold text-slate-900">{formatCurrency(layer.amount)}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-5 hidden overflow-x-auto rounded-2xl border border-slate-200 md:block">
              <table className="min-w-[660px] w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50/80 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-semibold">批次</th>
                    <th className="px-4 py-3 font-semibold">状态</th>
                    <th className="px-4 py-3 font-semibold">信号</th>
                    <th className="px-4 py-3 font-semibold">价格</th>
                    <th className="px-4 py-3 font-semibold">跌幅</th>
                    <th className="px-4 py-3 font-semibold">金额</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {executionLayers.map((layer) => (
                    <tr
                      key={layer.id}
                      className={cx(
                        layer.progressState === 'completed'
                          ? 'bg-emerald-50/70'
                          : layer.progressState === 'next'
                            ? 'bg-indigo-50/60'
                            : ''
                      )}
                    >
                      <td className="px-4 py-3 font-semibold text-slate-700">{String(layer.order).padStart(2, '0')}</td>
                      <td className="px-4 py-3">
                        <Pill tone={layer.progressTone}>{layer.progressLabel}</Pill>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{layer.signal}</td>
                      <td className="px-4 py-3 text-slate-600">{formatFundPrice(layer.price, strategyDisplayCurrency)}</td>
                      <td className="px-4 py-3 text-slate-600">{selectedStrategy === 'peak-drawdown' ? formatPercent(layer.drawdown, 1) : (layer.order === 1 ? '基准' : formatPercent(layer.drawdown, 1))}</td>
                      <td className="px-4 py-3 text-slate-900">{formatCurrency(layer.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.75fr)_minmax(0,0.95fr)]">
          <Card className="min-w-0 overflow-hidden">
            <SectionHeading
              eyebrow="Price Pulse"
              title="价格走势"
              action={selectedFund ? <Pill tone="indigo">{selectedFund.code}</Pill> : null}
            />

            {selectedFund && pricePulse ? (
              <div className="mt-6 min-w-0 flex flex-col gap-5 rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm shadow-slate-100 md:p-6">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="space-y-1">
                      <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">K-Line Monitor</div>
                      <div className="text-2xl font-extrabold text-slate-900">{formatFundPrice(pricePulse.latestPrice, selectedFundCurrency)}</div>
                      <div className={cx('text-sm font-semibold', pricePulse.changePct >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
                        {formatPercent(pricePulse.changePct, 2, true)}
                      </div>
                    </div>

                    <div className="flex flex-col gap-3 xl:items-end">
                      <div className="flex flex-wrap items-center gap-2 rounded-full bg-slate-100 p-1">
                        {TIMEFRAME_OPTIONS.map((option) => (
                          <button
                            key={option.key}
                            className={cx(
                              'rounded-full px-3 py-1.5 text-xs font-semibold transition-colors',
                              timeframe === option.key
                                ? 'bg-white text-slate-900 shadow-sm'
                                : 'text-slate-500 hover:text-slate-700'
                            )}
                            type="button"
                            onClick={() => setTimeframe(option.key)}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>

                      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-2 xl:min-w-[220px]">
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-4 rounded-2xl bg-white px-3 py-2">
                            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">成交量</div>
                            <div className="text-sm font-semibold text-slate-900">{pricePulse.volumeMetricValue}</div>
                          </div>
                          <div className="flex items-center justify-between gap-4 rounded-2xl bg-white px-3 py-2">
                            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">MA120</div>
                            <div className="text-sm font-semibold text-violet-600">{formatRawNumber(activeMa120)}</div>
                          </div>
                          <div className="flex items-center justify-between gap-4 rounded-2xl bg-white px-3 py-2">
                            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">MA200</div>
                            <div className="text-sm font-semibold text-amber-600">{formatRawNumber(activeMa200)}</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="font-semibold text-slate-800">{activeBar?.longLabel || selectedFund.name}</span>
                      <span>开 {formatRawNumber(activeBar?.open)}</span>
                      <span>高 {formatRawNumber(activeBar?.high)}</span>
                      <span>低 {formatRawNumber(activeBar?.low)}</span>
                      <span>收 {formatRawNumber(activeBar?.close)}</span>
                      <span>MA120 {formatRawNumber(activeMa120)}</span>
                      <span>MA200 {formatRawNumber(activeMa200)}</span>
                    </div>
                  </div>

                  <div className="relative min-w-0 overflow-hidden rounded-[28px] border border-slate-200 bg-white">
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(99,102,241,0.12),_transparent_34%),radial-gradient(circle_at_bottom_right,_rgba(16,185,129,0.08),_transparent_32%)]" />
                    <svg className="relative h-[480px] w-full md:h-[560px]" preserveAspectRatio="none" viewBox="0 0 100 100">
                      <line stroke="rgba(148,163,184,0.16)" strokeDasharray="1.5 2.5" strokeWidth="0.4" x1="4" x2="96" y1="16" y2="16" />
                      <line stroke="rgba(148,163,184,0.16)" strokeDasharray="1.5 2.5" strokeWidth="0.4" x1="4" x2="96" y1="32" y2="32" />
                      <line stroke="rgba(148,163,184,0.16)" strokeDasharray="1.5 2.5" strokeWidth="0.4" x1="4" x2="96" y1="48" y2="48" />
                      <line stroke="rgba(148,163,184,0.16)" strokeDasharray="1.5 2.5" strokeWidth="0.4" x1="4" x2="96" y1="64" y2="64" />
                      <line stroke="rgba(148,163,184,0.2)" strokeWidth="0.5" x1="4" x2="96" y1="79" y2="79" />

                      {chartGeometry.volumeBars.map((bar) => (
                        <rect
                          key={bar.id}
                          fill={bar.rising ? 'rgba(16,185,129,0.22)' : 'rgba(244,63,94,0.18)'}
                          height={bar.height}
                          rx="0.25"
                          width={Math.max(bar.width, 1.2)}
                          x={bar.x}
                          y={bar.y}
                        />
                      ))}

                      {chartGeometry.ma120Segments.map((segment, index) => (
                        <polyline
                          key={`ma120-${index}`}
                          fill="none"
                          points={segment}
                          stroke="#7c3aed"
                          strokeWidth={timeframe === '1d' ? '1.6' : '1.2'}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      ))}

                      {chartGeometry.ma200Segments.map((segment, index) => (
                        <polyline
                          key={`ma200-${index}`}
                          fill="none"
                          points={segment}
                          stroke="#f59e0b"
                          strokeWidth={timeframe === '1d' ? '1.6' : '1.2'}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      ))}

                      {chartGeometry.candles.map((candle) => (
                        <g key={candle.id}>
                          <line
                            stroke={candle.rising ? '#10b981' : '#f43f5e'}
                            strokeWidth="0.7"
                            x1={candle.x}
                            x2={candle.x}
                            y1={candle.wickTop}
                            y2={candle.wickBottom}
                          />
                          <rect
                            fill={candle.rising ? '#10b981' : '#f43f5e'}
                            height={candle.bodyHeight}
                            rx="0.35"
                            width={Math.max(candle.hitBoxWidth > 5 ? 1.9 : 1.4, 1.2)}
                            x={candle.bodyX}
                            y={candle.bodyY}
                          />
                          <rect
                            fill="transparent"
                            height="100"
                            width={candle.hitBoxWidth}
                            x={candle.hitBoxX}
                            y="0"
                            onClick={() => setActiveBarId(candle.id)}
                          />
                        </g>
                      ))}

                      {activeCandle && Number.isFinite(activeCloseY) ? (
                        <g>
                          <line stroke="rgba(15,23,42,0.28)" strokeDasharray="1.8 2.2" strokeWidth="0.5" x1={activeCandle.x} x2={activeCandle.x} y1="6" y2="96" />
                          <line stroke="rgba(15,23,42,0.18)" strokeDasharray="1.8 2.2" strokeWidth="0.5" x1="4" x2="96" y1={activeCloseY} y2={activeCloseY} />
                          <circle cx={activeCandle.x} cy={activeCloseY} fill="#312e81" r="1.2" />
                        </g>
                      ) : null}
                    </svg>

                    <div className="pointer-events-none absolute left-3 top-3 right-20 flex flex-wrap items-center gap-1.5 text-[10px] font-semibold sm:left-4 sm:top-4 sm:right-28 sm:gap-2 sm:text-[11px]">
                      <span className="rounded-full bg-slate-900 px-3 py-1 text-white">{selectedFund.code}</span>
                      <span className="rounded-full bg-violet-50 px-3 py-1 text-violet-700">MA120</span>
                      <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-700">MA200</span>
                    </div>
                    <div className="pointer-events-none absolute right-3 top-3 max-w-[5.5rem] truncate rounded-full bg-white/95 px-2.5 py-1 text-[10px] font-semibold text-slate-600 shadow-sm sm:right-4 sm:top-4 sm:max-w-none sm:px-3 sm:text-xs">
                      {pricePulse.asOf || minuteSnapshot?.date || ''}
                    </div>
                    <div className="border-t border-slate-200 bg-slate-50/90 px-4 py-3 text-xs text-slate-500">
                      <div className="flex flex-wrap items-center gap-4">
                        <span>{activeBar?.longLabel || '--'}</span>
                        <span>成交量 {formatCompactNumber(activeBar?.volume)}</span>
                        {pricePulse.hasAmountData && Number(activeBar?.amount) > 0 ? (
                          <span>成交额 ¥ {formatCompactNumber(activeBar?.amount)}</span>
                        ) : null}
                      </div>
                    </div>
                  </div>
              </div>
            ) : (
              <div className="mt-6 rounded-[24px] border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-sm text-slate-500">
                {pulseError || marketError
                  ? `价格脉冲加载失败：${pulseError || marketError}`
                  : isLoadingPulse
                    ? '正在加载所选基金的 K 线和历史快照数据...'
                    : '请选择一个自选基金后查看 Price Pulse。'}
              </div>
            )}
          </Card>

          <div className="min-w-0 space-y-6 lg:col-span-2">
            <Card className="min-w-0 overflow-hidden">
              <SectionHeading title="资金配置模型" />
              <div className="mt-6 rounded-[28px] border border-slate-200 bg-slate-50/80 p-4 sm:p-5">
                <div className="mx-auto flex max-w-[720px] flex-col items-center gap-3">
                  {strategyPlan.layers.map((layer, index) => {
                    const maxWeight = strategyPlan.layers[strategyPlan.layers.length - 1]?.weight || 1;
                    const widthPct = `${Math.min(100, 44 + layer.weight / maxWeight * 56)}%`;
                    const bandClass = layer.tone === 'amber'
                      ? 'from-amber-500 to-orange-500'
                      : layer.tone === 'violet'
                        ? 'from-violet-600 to-indigo-600'
                        : index === strategyPlan.layers.length - 1
                          ? 'from-indigo-600 to-sky-600'
                          : 'from-slate-600 to-slate-500';

                    return (
                      <div key={layer.id} className="w-full">
                        <div
                          className={cx(
                            'mx-auto flex max-w-full items-center justify-between gap-3 rounded-[24px] bg-gradient-to-r px-4 py-3 text-white shadow-[0_10px_24px_rgba(15,23,42,0.10)] ring-1 ring-white/20',
                            bandClass
                          )}
                          style={{ width: widthPct }}
                        >
                          <div className="min-w-0">
                            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/70">
                              {selectedStrategy === 'peak-drawdown' ? `档位 ${String(layer.order).padStart(2, '0')}` : `第 ${layer.order} 档`}
                            </div>
                            <div className="mt-1 truncate text-sm font-extrabold">
                              {selectedStrategy === 'peak-drawdown' ? layer.label : layer.signal}
                            </div>
                          </div>

                          <div className="shrink-0 rounded-full bg-white/15 px-3 py-1 text-sm font-extrabold">
                            {`${formatRawNumber(layer.weight, 1)}x`}
                          </div>
                        </div>

                        <div className="mx-auto mt-2 flex max-w-[560px] flex-wrap items-center justify-center gap-x-3 gap-y-1 px-2 text-[11px] font-semibold text-slate-500">
                          <span>{formatFundPrice(layer.price, strategyDisplayCurrency)}</span>
                          <span>{selectedStrategy === 'peak-drawdown' ? formatPercent(layer.drawdown, 1) : (layer.order === 1 ? '基准层' : formatPercent(layer.drawdown, 1))}</span>
                          <span>{formatCurrency(layer.amount)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </Card>
          </div>
        </div>
        </div>
      </div>
    </PageShell>
  );
}
