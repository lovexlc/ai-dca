// Chart + formatter helpers for HomeExperience.
// Extracted from src/pages/HomeExperience.jsx in refactor step 1.
// Pure functions only — no React, no DOM access.

import { formatCurrency } from '../../app/accumulation.js';
import { buildMovingAverageValues } from '../../app/strategyEngine.js';

export const BENCHMARK_CODE = 'nas-daq100';
export const DEFAULT_WATCHLIST_CODES = [BENCHMARK_CODE, '513100', '159501', '159660'];

export const TIMEFRAME_OPTIONS = [
  { key: '1m', label: '1分', note: '分时' },
  { key: '15m', label: '15分', note: '短线' },
  { key: '1d', label: '日线', note: '日线' }
];

export const MAX_CHART_BARS = {
  '1m': 64,
  '15m': 32,
  '1d': 120
};

export const STRATEGY_OPTIONS = [
  {
    key: 'ma120-risk',
    label: '均线分层',
    shortLabel: '均线分层',
    note: '以120日均线为主触发，以200日均线为风控'
  },
  {
    key: 'peak-drawdown',
    label: '高点回撤 8 档',
    shortLabel: '固定回撤',
    note: '按阶段高点固定跌幅分 8 档执行'
  }
];

export function resolveMarketCurrency(entry = null) {
  return String(entry?.currency || '').trim() || '¥';
}

export function formatFundPrice(value, currency = '¥') {
  return formatCurrency(value, currency, 3);
}

export function formatCompactNumber(value) {
  return new Intl.NumberFormat('zh-CN', {
    notation: 'compact',
    maximumFractionDigits: 1
  }).format(Number(value) || 0);
}

export function formatRawNumber(value, digits = 3) {
  if (value === null || value === undefined || value === '') {
    return '--';
  }

  if (!Number.isFinite(Number(value))) {
    return '--';
  }

  return Number(value).toFixed(digits).replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
}

export function buildDefaultCodes(entries = []) {
  const availableCodes = new Set(entries.map((entry) => entry.code));
  const preferred = DEFAULT_WATCHLIST_CODES.filter((code) => availableCodes.has(code));
  if (preferred.length) {
    return preferred;
  }

  return entries.slice(0, 3).map((entry) => entry.code);
}

export function normalizeMinuteBars(rawBars = []) {
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

export function aggregateMinuteBars(minuteBars = [], groupSize = 15) {
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

export function buildDailyBars(dailyBars = []) {
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

export function limitBarsForChart(bars = [], limit = 64) {
  if (!bars.length || bars.length <= limit) {
    return bars;
  }

  const step = (bars.length - 1) / Math.max(limit - 1, 1);
  return Array.from({ length: limit }, (_, index) => bars[Math.min(bars.length - 1, Math.round(index * step))]);
}

export function buildMappedMovingAverage(displayBars = [], fullBars = [], period = 5, { allowPartial = false } = {}) {
  const fullValues = buildMovingAverageValues(fullBars, period, { allowPartial });
  return displayBars.map((bar) => fullValues[bar.sourceIndex] ?? null);
}

export function scalePrice(value, minValue, maxValue, top = 8, bottom = 74) {
  if (!Number.isFinite(value) || !Number.isFinite(minValue) || !Number.isFinite(maxValue) || maxValue <= minValue) {
    return (top + bottom) / 2;
  }

  const ratio = (value - minValue) / (maxValue - minValue);
  return bottom - ratio * (bottom - top);
}

export function buildLineSegments(points = []) {
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

export function buildChartGeometry(displayBars = [], overlays = {}) {
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
