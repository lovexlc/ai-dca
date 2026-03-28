import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Plus, Trash2, Upload } from 'lucide-react';
import { formatCurrency, formatPercent, readAccumulationState } from '../app/accumulation.js';
import { exportHomeDashboardState, importHomeDashboardState, normalizeHomeDashboardState, persistHomeDashboardState, readHomeDashboardState } from '../app/homeDashboard.js';
import { formatPriceAsOf, loadLatestNasdaqPrices, loadNasdaqDailySeries, loadNasdaqMinuteSnapshot } from '../app/nasdaqPrices.js';
import { readPlanState } from '../app/plan.js';
import { Card, PageHero, PageShell, Pill, SectionHeading, SelectField, StatCard, cx, primaryButtonClass, secondaryButtonClass, subtleButtonClass } from '../components/experience-ui.jsx';

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

export function HomeExperience({ links, inPagesDir = false }) {
  const accumulationState = readAccumulationState();
  const planState = readPlanState();
  const [dashboardState] = useState(() => readHomeDashboardState());

  const [marketEntries, setMarketEntries] = useState([]);
  const [marketError, setMarketError] = useState('');
  const [watchlistCodes, setWatchlistCodes] = useState(dashboardState.watchlistCodes);
  const [selectedCode, setSelectedCode] = useState(dashboardState.selectedCode);
  const [selectedStrategy, setSelectedStrategy] = useState(dashboardState.selectedStrategy);
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
      selectedCode,
      selectedStrategy
    });
  }, [marketEntries.length, selectedCode, selectedStrategy, visibleWatchlistCodes]);

  const selectedFund = useMemo(() => marketByCode.get(selectedCode) || null, [marketByCode, selectedCode]);
  const benchmarkFund = useMemo(
    () => marketByCode.get(BENCHMARK_CODE) || selectedFund || null,
    [marketByCode, selectedFund]
  );
  const selectedFundCurrency = resolveMarketCurrency(selectedFund);
  const benchmarkCurrency = resolveMarketCurrency(benchmarkFund);

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
  const reserveRatio = planState.totalBudget > 0 ? strategyPlan.reserveCapital / planState.totalBudget * 100 : 0;
  const nextTriggerLayer = useMemo(
    () => resolveNextTriggerLayer(strategyPlan.layers, currentBenchmarkPrice),
    [currentBenchmarkPrice, strategyPlan.layers]
  );
  const nextBuyPrice = nextTriggerLayer?.price ?? strategyPlan.triggerPrice;
  const executionLayers = useMemo(
    () => strategyPlan.layers.map((layer) => {
      const isCompleted = currentBenchmarkPrice > 0 && currentBenchmarkPrice <= layer.price;
      const isNext = !isCompleted && nextTriggerLayer?.id === layer.id;

      return {
        ...layer,
        progressState: isCompleted ? 'completed' : isNext ? 'next' : 'pending',
        progressLabel: isCompleted ? '已完成' : isNext ? '下一档' : '待触发',
        progressTone: isCompleted ? 'emerald' : isNext ? 'indigo' : 'slate'
      };
    }),
    [currentBenchmarkPrice, nextTriggerLayer?.id, strategyPlan.layers]
  );
  const completedLayerCount = useMemo(
    () => executionLayers.filter((layer) => layer.progressState === 'completed').length,
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
      setSelectedStrategy(imported.selectedStrategy);
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
        badges={[
          <Pill key="status" tone="indigo">运行中</Pill>,
          <Pill key="strategy" tone="slate">{activeStrategyOption.shortLabel}</Pill>,
          <Pill key="layers" tone="slate">{strategyPlan.layers.length} 层建仓</Pill>
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
            <div
              className={cx(
                'mt-5 rounded-2xl px-4 py-3 text-sm',
                watchlistNoticeTone === 'emerald'
                  ? 'border border-emerald-200 bg-emerald-50 text-emerald-700'
                  : watchlistNoticeTone === 'amber'
                    ? 'border border-amber-200 bg-amber-50 text-amber-700'
                    : 'border border-slate-200 bg-slate-50 text-slate-600'
              )}
            >
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
              const itemCurrency = resolveMarketCurrency(item);
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
                        {formatFundPrice(item.current_price, itemCurrency)}
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

        <Card className="p-4 sm:p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Strategy Template</div>
              <div className="mt-1 text-lg font-bold text-slate-800">{activeStrategyOption.label}</div>
              <div className="mt-1 text-sm text-slate-500">{activeStrategyOption.note}</div>
              <div className="mt-1 text-sm text-slate-500">
                当前参考基准 {benchmarkFund?.code || BENCHMARK_CODE} · {formatFundPrice(currentBenchmarkPrice, benchmarkCurrency)}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {STRATEGY_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  className={cx(
                    'rounded-full px-4 py-2 text-sm font-semibold transition-colors',
                    selectedStrategy === option.key
                      ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-200'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  )}
                  type="button"
                  onClick={() => setSelectedStrategy(option.key)}
                >
                  {option.shortLabel}
                </button>
              ))}
            </div>
          </div>
        </Card>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard accent="indigo" eyebrow="Portfolio Budget" value={formatCurrency(strategyPlan.investableCapital)} note={selectedStrategy === 'peak-drawdown' ? '按阶段高点固定回撤 8 档分配预算' : '按 MA120 主触发策略分配的预算'} progress={Math.max(100 - reserveRatio, 0)} />
          <StatCard eyebrow="Reserve Cash" value={formatCurrency(strategyPlan.reserveCapital)} note={selectedStrategy === 'peak-drawdown' ? (isBelowPeakExtreme ? '价格已进入第 8 档极端区。' : `${formatPercent(reserveRatio, 1)} 作为极端回撤缓冲`) : (isBelowRiskControl ? '价格已跌破 MA200，进入防守区。' : strategyPlan.usesIndependentRiskLayer ? `${formatPercent(reserveRatio, 1)} 作为 MA200 防守缓冲` : 'MA200 当前高于深水层，仅作趋势风控。')} />
          <StatCard eyebrow="Next Trigger" value={formatFundPrice(nextBuyPrice, benchmarkCurrency)} note={nextTriggerLayer ? `${benchmarkFund?.code || BENCHMARK_CODE} · ${nextTriggerLayer.signal}` : selectedStrategy === 'peak-drawdown' ? '当前已进入第 8 档极端区' : '当前已进入最深防守区'} />
          <StatCard accent="emerald" eyebrow="Average Cost" value={formatFundPrice(strategyPlan.averageCost, benchmarkCurrency)} note={selectedStrategy === 'peak-drawdown' ? `${benchmarkFund?.code || BENCHMARK_CODE} 固定跌幅 8 档重算` : `${benchmarkFund?.code || BENCHMARK_CODE} MA120 / MA200 重算`} />

          <Card className="min-w-0 md:col-span-2 xl:col-start-2 xl:col-span-3">
            <SectionHeading
              eyebrow="Execution Map"
              title="建仓计划详情"
              action={
                <div className="flex flex-wrap items-center gap-2">
                  <Pill tone="indigo">基准 {benchmarkFund?.code || BENCHMARK_CODE}</Pill>
                  {selectedStrategy === 'peak-drawdown' ? (
                    <>
                      <Pill tone="violet">阶段高点 {formatFundPrice(strategyPlan.anchorPrice, benchmarkCurrency)}</Pill>
                      <Pill tone="amber">固定回撤 8 档</Pill>
                    </>
                  ) : (
                    <>
                      <Pill tone="violet">MA120 触发 {formatFundPrice(strategyTriggerPrice, benchmarkCurrency)}</Pill>
                      <Pill tone="amber">MA200 风控 {formatFundPrice(riskControlPrice, benchmarkCurrency)}</Pill>
                    </>
                  )}
                </div>
              }
            />
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Pill tone="slate">基准现价 {formatFundPrice(currentBenchmarkPrice, benchmarkCurrency)}</Pill>
              <Pill tone="emerald">已完成 {completedLayerCount}/{executionLayers.length} 档</Pill>
            </div>
            <div className="mt-5 overflow-x-auto rounded-2xl border border-slate-200">
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
                      <td className="px-4 py-3 text-slate-600">{formatFundPrice(layer.price, benchmarkCurrency)}</td>
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
                          <span>{formatFundPrice(layer.price, benchmarkCurrency)}</span>
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
    </PageShell>
  );
}
