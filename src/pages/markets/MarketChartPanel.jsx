import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Area, Bar, CartesianGrid, Cell, ComposedChart, Customized, Line, Pie, PieChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { cx } from '../../components/experience-ui.jsx';
import { formatMarketPrice, formatNumber, formatPercentNoPlus, formatSignedPercent, formatSymbolDisplay } from './marketDisplayUtils.js';
import { useClickOutside } from '../../hooks/useClickOutside.js';

function shanghaiDateFromEpochSec(sec) {
  const n = Number(sec);
  if (!Number.isFinite(n) || n <= 0) return '';
  try {
    return new Date(n * 1000).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  } catch (_error) {
    return new Date(n * 1000).toISOString().slice(0, 10);
  }
}

// ---------- 图表工具栏（图表类型 / 指标 / 对比标的） ----------
const toolbarIconClass = 'h-[18px] w-[18px] stroke-[2.2] text-[#202124]';
export const TOOLBAR_ICONS = {
  params: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className={toolbarIconClass}><path d="M4 7h10" /><path d="M18 7h2" /><circle cx="16" cy="7" r="2" /><path d="M4 17h2" /><path d="M10 17h10" /><circle cx="8" cy="17" r="2" /></svg>,
  area: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className={toolbarIconClass}><path d="M4 17l4-5 4 2 4-7 4 10" /><path d="M4 20h16" /><path d="M4 17l4-5 4 2 4-7 4 10v3H4z" fill="currentColor" opacity="0.16" stroke="none" /></svg>,
  candle: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className={toolbarIconClass}><path d="M7 4v4" /><path d="M7 16v4" /><rect x="5" y="8" width="4" height="8" rx="1" /><path d="M17 3v5" /><path d="M17 15v6" /><rect x="15" y="8" width="4" height="7" rx="1" /></svg>,
  bar: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className={toolbarIconClass}><path d="M5 20V9" /><path d="M12 20V4" /><path d="M19 20v-7" /><path d="M3 20h18" /></svg>,
  pie: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className={toolbarIconClass}><path d="M12 3v9h9" /><path d="M21 12a9 9 0 1 1-9-9" /><path d="M12 12l6.4 6.4" /></svg>,
  indicators: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className={toolbarIconClass}><path d="M4 17c3-8 6 4 9-4s5 0 7-6" /><path d="M4 7h4" /><path d="M16 17h4" /></svg>,
  compare: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className={toolbarIconClass}><path d="M4 8c2.5-3 5.5-3 8 0s5.5 3 8 0" /><path d="M4 16c2.5 3 5.5 3 8 0s5.5-3 8 0" /></svg>,
};
export const CHART_TYPE_OPTIONS = [
  { key: 'area', label: '面积图', hint: '连续走势与面积填充', icon: TOOLBAR_ICONS.area },
  { key: 'line', label: '点线图', hint: '连续折线展示', icon: TOOLBAR_ICONS.indicators },
  { key: 'bar', label: '柱形图', hint: '柱形展示收盘价', icon: TOOLBAR_ICONS.bar },
];
export const CHART_TYPE_LABEL = CHART_TYPE_OPTIONS.reduce((acc, o) => { acc[o.key] = o.label; return acc; }, {});
export const CN_FUND_PARAM_OPTIONS = [
  { key: 'price', label: '价格', hint: '场内交易价格' },
  { key: 'nav', label: '净值', hint: '上一工作日确认净值' },
  { key: 'premium', label: '溢价', hint: '价格相对估算 IOPV' },
];
export const CN_FUND_PARAM_LABEL = CN_FUND_PARAM_OPTIONS.reduce((acc, o) => { acc[o.key] = o.label; return acc; }, {});

export const INDICATOR_OPTIONS = [
  { key: 'ma5', label: 'MA5', hint: '5 日均线' },
  { key: 'ma10', label: 'MA10', hint: '10 日均线' },
  { key: 'ma20', label: 'MA20', hint: '20 日均线' },
  { key: 'ma60', label: 'MA60', hint: '60 日均线' },
  { key: 'boll', label: 'BOLL', hint: '布林带 (20, 2)' },
];
const MA_COLORS = { ma5: '#1a73e8', ma10: '#ea4335', ma20: '#f9ab00', ma60: '#9aa0a6' };
export const COMPARE_COLORS = ['#e37400', '#9333ea', '#10b981'];
export const COMPARE_MAIN_COLOR = '#2563eb';
export const COMPARE_TEXT_CLASSES = ['text-[#e37400]', 'text-[#9333ea]', 'text-[#10b981]'];
export const COMPARE_DOT_CLASSES = ['bg-[#e37400]', 'bg-[#9333ea]', 'bg-[#10b981]'];
const CHART_UP = '#a50e0e';
const CHART_DOWN = '#137333';
const PREMIUM_BUCKET_COLORS = ['#137333', '#34a853', '#f9ab00', '#e37400', '#a50e0e'];

function computeMA(closes, period) {
  const out = new Array(closes.length).fill(null);
  let sum = 0;
  for (let i = 0; i < closes.length; i += 1) {
    sum += closes[i];
    if (i >= period) sum -= closes[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function computeBOLL(closes, period = 20, mult = 2) {
  const upper = []; const mid = []; const lower = [];
  for (let i = 0; i < closes.length; i += 1) {
    if (i < period - 1) { upper.push(null); mid.push(null); lower.push(null); continue; }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j += 1) sum += closes[j];
    const mean = sum / period;
    let sq = 0;
    for (let j = i - period + 1; j <= i; j += 1) sq += (closes[j] - mean) * (closes[j] - mean);
    const sd = Math.sqrt(sq / period);
    mid.push(mean); upper.push(mean + mult * sd); lower.push(mean - mult * sd);
  }
  return { upper, mid, lower };
}

function fmtChartLabel(t, tf) {
  if (!Number.isFinite(Number(t))) return '';
  const d = new Date(Number(t) * 1000);
  if (tf === '5m' || tf === '15m' || tf === '60m') {
    return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('zh-CN', { year: '2-digit', month: '2-digit', day: '2-digit' });
}

function CandlesLayerPanel({ xAxisMap, yAxisMap, data }) {
  if (!xAxisMap || !yAxisMap || !data) return null;
  const xAxis = Object.values(xAxisMap)[0];
  const yAxis = Object.values(yAxisMap)[0];
  if (!xAxis || !yAxis || typeof yAxis.scale !== 'function') return null;
  const xScale = xAxis.scale;
  const yScale = yAxis.scale;
  const step = data.length > 1 && xAxis.width ? Math.max(2, xAxis.width / Math.max(1, data.length - 1)) : 8;
  const w = Math.max(2, Math.min(10, step * 0.54));
  return (
    <g>
      {data.map((d, i) => {
        if (!Number.isFinite(d.o) || !Number.isFinite(d.h) || !Number.isFinite(d.l) || !Number.isFinite(d.c)) return null;
        const cxRaw = xScale(d.label);
        if (typeof cxRaw !== 'number' || Number.isNaN(cxRaw)) return null;
        const cx = cxRaw;
        const up = d.c >= d.o;
        const color = up ? CHART_UP : CHART_DOWN;
        const yH = yScale(d.h);
        const yL = yScale(d.l);
        const yTop = yScale(Math.max(d.o, d.c));
        const yBot = yScale(Math.min(d.o, d.c));
        const bodyH = Math.max(1, yBot - yTop);
        return (
          <g key={i}>
            <line x1={cx} x2={cx} y1={yH} y2={yL} stroke={color} strokeWidth={1} />
            <rect x={cx - w / 2} y={yTop} width={w} height={bodyH} rx={0.8} fill={color} />
          </g>
        );
      })}
    </g>
  );
}

function buildDynamicBuckets(values, bucketCount = 3) {
  const nums = (Array.isArray(values) ? values : []).filter(Number.isFinite).sort((a, b) => a - b);
  if (!nums.length) return [];
  const min = nums[0];
  const max = nums[nums.length - 1];
  if (Math.abs(max - min) < 0.000001) {
    return [{
      key: 'single',
      label: formatPercentNoPlus(min),
      color: PREMIUM_BUCKET_COLORS[Math.floor(PREMIUM_BUCKET_COLORS.length / 2)],
      min,
      max,
      count: nums.length,
      value: nums.length,
      percent: 100
    }];
  }
  const count = Math.min(bucketCount, Math.max(3, Math.ceil(Math.sqrt(nums.length))));
  const width = (max - min) / count;
  const buckets = Array.from({ length: count }, (_item, index) => {
    const start = min + width * index;
    const end = index === count - 1 ? max : min + width * (index + 1);
    return {
      key: `bucket_${index}`,
      label: `${formatPercentNoPlus(start, 1)} ~ ${formatPercentNoPlus(end, 1)}`,
      color: PREMIUM_BUCKET_COLORS[Math.min(PREMIUM_BUCKET_COLORS.length - 1, Math.floor((index / Math.max(1, count - 1)) * (PREMIUM_BUCKET_COLORS.length - 1)))],
      min: start,
      max: end,
      count: 0,
      value: 0,
      percent: 0
    };
  });
  nums.forEach((value) => {
    const index = Math.min(count - 1, Math.max(0, Math.floor((value - min) / width)));
    buckets[index].count += 1;
  });
  return buckets.map((bucket) => ({
    ...bucket,
    value: bucket.count,
    percent: nums.length ? (bucket.count / nums.length) * 100 : 0
  }));
}

function buildPremiumDistribution(rows, compareCount = 0, useSpread = false) {
  const values = [];
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    if (useSpread) {
      Array.from({ length: compareCount }, (_item, index) => {
        const value = Number(row?.[`cmp_${index}`]);
        if (Number.isFinite(value)) values.push(value);
        return null;
      });
      return;
    }
    const value = Number(row?.main);
    if (Number.isFinite(value)) values.push(value);
  });
  return buildDynamicBuckets(values);
}

export function buildVisibleTradeMarkerPoints(data, markers = [], { preferMarkerPrice = true } = {}) {
  if (!Array.isArray(data) || !data.length || !Array.isArray(markers) || !markers.length) return [];
  const rows = data.filter((row) => Number.isFinite(Number(row?.t)) && Number.isFinite(Number(row?.main)));
  if (!rows.length) return [];
  const rowsMeta = rows.map((row) => ({
    t: Number(row.t),
    date: String(row.date || shanghaiDateFromEpochSec(row.t) || '')
  }));
  let minT = Infinity;
  let maxT = -Infinity;
  let minDate = '';
  let maxDate = '';
  rowsMeta.forEach((item) => {
    if (Number.isFinite(item.t)) {
      if (item.t < minT) minT = item.t;
      if (item.t > maxT) maxT = item.t;
    }
    if (item.date) {
      if (!minDate || item.date < minDate) minDate = item.date;
      if (!maxDate || item.date > maxDate) maxDate = item.date;
    }
  });
  return markers.map((marker, index) => {
    const markerT = Number(marker.t);
    const markerDate = String(marker.date || shanghaiDateFromEpochSec(markerT) || '');
    const inTimeRange = Number.isFinite(markerT) && markerT >= minT && markerT <= maxT;
    const inDateRange = markerDate && minDate && maxDate && markerDate >= minDate && markerDate <= maxDate;
    if (!inTimeRange && !inDateRange) return null;
    let rowIndex = -1;
    if (Number.isFinite(markerT)) {
      let bestDiff = Infinity;
      rowsMeta.forEach((item, idx) => {
        if (!Number.isFinite(item.t)) return;
        const diff = Math.abs(item.t - markerT);
        if (diff < bestDiff) {
          bestDiff = diff;
          rowIndex = idx;
        }
      });
    }
    if (rowIndex < 0 && markerDate) rowIndex = rowsMeta.findIndex((item) => item.date === markerDate);
    if (rowIndex < 0) rowIndex = rows.length - 1;
    if (rowIndex > 0 && Number.isFinite(markerT)) {
      const prevGap = Math.abs(Number(rows[rowIndex - 1].t) - markerT);
      const nextGap = Math.abs(Number(rows[rowIndex].t) - markerT);
      if (prevGap < nextGap) rowIndex -= 1;
    }
    const row = rows[rowIndex];
    if (!row) return null;
    const markerPrice = Number(marker.price);
    const y = preferMarkerPrice && Number.isFinite(markerPrice) && markerPrice > 0 ? markerPrice : Number(row.main);
    if (!Number.isFinite(y)) return null;
    const isBuy = marker.type === 'BUY';
    return {
      id: marker.id || `${marker.type}-${marker.date}-${index}`,
      type: marker.type,
      date: marker.date,
      x: row.label,
      y,
      color: isBuy ? '#f6a623' : '#5b8def',
      label: isBuy ? '买入' : '卖出'
    };
  }).filter(Boolean);
}

export function SymbolDetailChart({ candles, tf, chartType, indicators, compareSeries, compareMode = 'change', tone, symbol, valueRow = null, tradeMarkers = [], onHover, onLeave, onLock, lockOnClick = false, premiumView = 'trend' }) {
  const chartShellRef = useRef(null);
  const pointersRef = useRef(new Map());
  const pinchRef = useRef(null);
  const [zoomWindow, setZoomWindow] = useState(null);
  const [hoverTooltip, setHoverTooltip] = useState(null);
  const [chartSize, setChartSize] = useState({ width: 0, height: 0 });
  const cmpList = (compareSeries || []).filter((series) => Array.isArray(series.candles) && series.candles.length >= 2);
  const cmpSignature = JSON.stringify(cmpList.map((series) => ({
    symbol: series.symbol,
    length: series.candles.length,
    first: series.candles[0] && series.candles[0].t,
    last: series.candles[series.candles.length - 1] && series.candles[series.candles.length - 1].t
  })));
  const displayMainSymbol = formatSymbolDisplay(symbol);
  const hasCompare = cmpList.length > 0;
  const compareAsValue = hasCompare && compareMode === 'value';
  const normalized = hasCompare && !compareAsValue;
  const formatChartValue = (value) => formatMarketPrice(value, valueRow);
  const rows = useMemo(() => {
    const arr = Array.isArray(candles) ? candles : [];
    if (arr.length < 2) return [];
    const base = Number(arr[0].c) || 1;
    return arr.map((candle) => {
      const close = Number(candle.c);
      return {
        label: fmtChartLabel(candle.t, tf),
        t: Number(candle.t),
        o: Number(candle.o),
        h: Number(candle.h),
        l: Number(candle.l),
        c: close,
        main: normalized ? ((close / base) - 1) * 100 : close,
        mainPrice: close,
        mainBase: base,
        mainChange: close - base,
        mainChangePercent: base ? ((close / base) - 1) * 100 : null,
        mainNav: Number(candle.nav),
        mainIopv: Number(candle.iopv),
        mainNavDate: candle.navDate || '',
        mainMarketPrice: Number(candle.marketPrice),
        date: candle.date || shanghaiDateFromEpochSec(candle.t),
      };
    });
  }, [candles, tf, normalized]);
  const indicatorLines = useMemo(() => {
    if (normalized || !Array.isArray(candles) || candles.length === 0) return [];
    const closes = candles.map((candle) => Number(candle.c));
    const out = [];
    [['ma5', 5], ['ma10', 10], ['ma20', 20], ['ma60', 60]].forEach(([key, period]) => {
      if (indicators.has(key)) {
        out.push({ key, color: MA_COLORS[key], values: computeMA(closes, period), label: key.toUpperCase(), dashed: false });
      }
    });
    if (indicators.has('boll')) {
      const boll = computeBOLL(closes, 20, 2);
      out.push({ key: 'boll_upper', color: '#94a3b8', values: boll.upper, label: 'BOLL 上', dashed: true });
      out.push({ key: 'boll_mid', color: '#cbd5e1', values: boll.mid, label: 'BOLL 中', dashed: true });
      out.push({ key: 'boll_lower', color: '#94a3b8', values: boll.lower, label: 'BOLL 下', dashed: true });
    }
    return out;
  }, [candles, indicators, normalized]);
  const finalRows = useMemo(() => {
    const alignedCompare = cmpList.map((series) => {
      const candlesSorted = [...series.candles]
        .filter((candle) => Number.isFinite(Number(candle?.t)) && Number.isFinite(Number(candle?.c)))
        .sort((a, b) => Number(a.t) - Number(b.t));
      let cursor = 0;
      const values = rows.map((row) => {
        const rowT = Number(row.t);
        while (cursor + 1 < candlesSorted.length && Number(candlesSorted[cursor + 1].t) <= rowT) cursor += 1;
        const candle = candlesSorted[cursor];
        return candle && Number(candle.t) <= rowT ? candle : null;
      });
      return { values };
    });
    const commonBaseIndex = normalized
      ? rows.findIndex((row, index) => Number.isFinite(Number(row.c)) && alignedCompare.every((series) => Number.isFinite(Number(series.values[index]?.c))))
      : 0;
    const mainBase = Number(rows[Math.max(0, commonBaseIndex)]?.c) || 1;
    const compareBases = alignedCompare.map((series) => Number(series.values[Math.max(0, commonBaseIndex)]?.c) || 1);
    return rows.map((row, index) => {
      const out = { ...row };
      indicatorLines.forEach((line) => { out[line.key] = line.values[index]; });
      if (normalized) {
        if (commonBaseIndex >= 0 && index >= commonBaseIndex) {
          const close = Number(row.c);
          out.main = Number.isFinite(close) ? ((close / mainBase) - 1) * 100 : null;
          out.mainBase = mainBase;
          out.mainChange = Number.isFinite(close) ? close - mainBase : null;
          out.mainChangePercent = mainBase && Number.isFinite(close) ? ((close / mainBase) - 1) * 100 : null;
        } else {
          out.main = null;
          out.mainChange = null;
          out.mainChangePercent = null;
        }
      }
      alignedCompare.forEach((series, ci) => {
        const candle = series.values[index];
        const base = compareBases[ci];
        if (candle && Number.isFinite(Number(candle.c)) && (!normalized || (commonBaseIndex >= 0 && index >= commonBaseIndex))) {
          const close = Number(candle.c);
          out[`cmp_${ci}`] = compareAsValue ? close : ((close / base) - 1) * 100;
          out[`cmp_${ci}_price`] = close;
          out[`cmp_${ci}_base`] = base;
          out[`cmp_${ci}_change`] = close - base;
          out[`cmp_${ci}_changePercent`] = base ? ((close / base) - 1) * 100 : null;
          out[`cmp_${ci}_nav`] = Number(candle.nav);
          out[`cmp_${ci}_iopv`] = Number(candle.iopv);
          out[`cmp_${ci}_navDate`] = candle.navDate || '';
          out[`cmp_${ci}_marketPrice`] = Number(candle.marketPrice);
        }
      });
      return out;
    });
  }, [rows, indicatorLines, cmpSignature, compareAsValue, normalized]);
  const finalRowsSignature = finalRows.length ? `${finalRows.length}|${finalRows[0].t}|${finalRows[finalRows.length - 1].t}` : 'empty';
  useEffect(() => {
    setZoomWindow(null);
    setHoverTooltip(null);
    pointersRef.current.clear();
    pinchRef.current = null;
  }, [finalRowsSignature]);
  useEffect(() => {
    const element = chartShellRef.current;
    if (!element) return undefined;
    let frame = 0;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      const width = Math.floor(rect.width);
      const height = Math.floor(rect.height);
      setChartSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    };
    frame = window.requestAnimationFrame(measure);
    if (typeof ResizeObserver === 'undefined') {
      return () => window.cancelAnimationFrame(frame);
    }
    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(measure);
    });
    observer.observe(element);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [finalRowsSignature, premiumView]);
  const clampZoomWindow = useCallback((start, end, total = finalRows.length) => {
    if (total < 2) return null;
    const minSpan = Math.min(total, Math.max(12, Math.ceil(total * 0.08)));
    let nextStart = Math.round(start);
    let nextEnd = Math.round(end);
    if (nextEnd - nextStart + 1 < minSpan) {
      const mid = (nextStart + nextEnd) / 2;
      nextStart = Math.round(mid - (minSpan - 1) / 2);
      nextEnd = nextStart + minSpan - 1;
    }
    if (nextStart < 0) {
      nextEnd -= nextStart;
      nextStart = 0;
    }
    if (nextEnd > total - 1) {
      nextStart -= nextEnd - (total - 1);
      nextEnd = total - 1;
    }
    nextStart = Math.max(0, nextStart);
    nextEnd = Math.min(total - 1, nextEnd);
    if (nextStart <= 0 && nextEnd >= total - 1) return null;
    return { start: nextStart, end: nextEnd };
  }, [finalRows.length]);
  const visibleRows = useMemo(() => {
    if (!zoomWindow || finalRows.length < 2) return finalRows;
    const start = Math.max(0, Math.min(finalRows.length - 1, zoomWindow.start));
    const end = Math.max(start + 1, Math.min(finalRows.length - 1, zoomWindow.end));
    return finalRows.slice(start, end + 1);
  }, [finalRows, zoomWindow]);
  const isPremiumChart = finalRows.some((row) => Number.isFinite(Number(row?.mainIopv)) || Object.prototype.hasOwnProperty.call(row || {}, 'iopv'));
  const showPremiumSpread = isPremiumChart && compareAsValue && cmpList.length > 0;
  const displayRows = showPremiumSpread
    ? visibleRows.map((row) => {
      const mainPremium = Number(row.main);
      const next = { ...row, main: Number.isFinite(mainPremium) ? 0 : null };
      cmpList.forEach((_series, index) => {
        const comparePremium = Number(row[`cmp_${index}`]);
        next[`cmp_${index}`] = Number.isFinite(comparePremium) && Number.isFinite(mainPremium) ? mainPremium - comparePremium : null;
      });
      return next;
    })
    : visibleRows;
  const visibleTradeMarkerPoints = useMemo(
    () => (!hasCompare && Array.isArray(tradeMarkers) && tradeMarkers.length
      ? buildVisibleTradeMarkerPoints(displayRows, tradeMarkers, { preferMarkerPrice: Boolean(valueRow) })
      : []),
    [displayRows, hasCompare, tradeMarkers, valueRow]
  );
  if (finalRows.length < 2) {
    return <div className="flex h-full items-center justify-center text-sm text-[#5f6368]">暂无数据</div>;
  }
  const showPremiumDistribution = isPremiumChart && premiumView === 'distribution';
  const premiumMean = isPremiumChart
    ? (() => {
      const values = showPremiumSpread
        ? displayRows.flatMap((row) => cmpList.map((_series, index) => Number(row[`cmp_${index}`])).filter(Number.isFinite))
        : displayRows.map((row) => Number(row.main)).filter(Number.isFinite);
      if (!values.length) return null;
      return values.reduce((sum, value) => sum + value, 0) / values.length;
    })()
    : null;
  const premiumDistribution = showPremiumDistribution ? buildPremiumDistribution(displayRows, cmpList.length, showPremiumSpread) : [];
  const premiumDistributionTotal = premiumDistribution.reduce((sum, bucket) => sum + bucket.count, 0);
  if (showPremiumDistribution) {
    return (
      <div className="grid h-full w-full grid-cols-[minmax(0,1fr)_108px] items-center gap-1 px-1 sm:grid-cols-[minmax(0,1fr)_148px] sm:gap-2 sm:px-2">
        <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
          <PieChart>
            <Tooltip
              cursor={false}
              content={({ payload }) => {
                const item = Array.isArray(payload) ? payload[0]?.payload : null;
                if (!item) return null;
                return (
                  <div className="rounded-xl bg-white/95 px-3 py-2 text-[13px] font-medium text-[#5f6368] shadow-[0_8px_24px_rgba(60,64,67,0.20)] ring-1 ring-black/5">
                    <div>{item.label}</div>
                    <div className="mt-0.5 tabular-nums text-[#1f1f1f]">{formatNumber(item.percent, 1)}% · {item.count} 个样本</div>
                  </div>
                );
              }}
            />
            <Pie
              data={premiumDistribution.filter((bucket) => bucket.count > 0)}
              dataKey="value"
              nameKey="label"
              cx="50%"
              cy="50%"
              innerRadius="48%"
              outerRadius="78%"
              paddingAngle={2}
              isAnimationActive={false}
            >
              {premiumDistribution.filter((bucket) => bucket.count > 0).map((bucket) => (
                <Cell key={bucket.key} fill={bucket.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="min-w-0 pr-1 text-[11px] font-medium text-[#5f6368] sm:text-[12px]">
          <div className="mb-1 text-[12px] font-semibold text-[#202124] sm:text-[13px]">{showPremiumSpread ? '溢价差分布' : '溢价分布'}</div>
          {premiumDistribution.map((bucket) => (
            <div key={bucket.key} className="mb-1.5 grid grid-cols-[10px_minmax(0,1fr)] items-center gap-1.5">
              <span className="size-2.5 rounded-sm" style={{ background: bucket.color }} />
              <div className="min-w-0">
                <div className="truncate">{bucket.label}</div>
                <div className="tabular-nums text-[#202124]">{formatNumber(bucket.percent, 1)}%</div>
              </div>
            </div>
          ))}
          <div className="mt-1 text-[10px] text-[#9aa0a6] sm:text-[11px]">样本 {premiumDistributionTotal}</div>
        </div>
      </div>
    );
  }
  const mainColor = normalized ? COMPARE_MAIN_COLOR : tone === 'up' ? CHART_UP : tone === 'down' ? CHART_DOWN : '#1a73e8';
  const showCandle = chartType === 'candle' && !normalized && !showPremiumSpread;
  const showArea = chartType === 'area' && !normalized;
  const showLine = chartType === 'line' || (normalized && chartType !== 'bar') || (showPremiumSpread && chartType === 'candle');
  const showBar = chartType === 'bar';
  const pickRowFromPointer = (event) => {
    const rect = chartShellRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || displayRows.length < 2) return null;
    const x = Math.min(Math.max(event.clientX - rect.left, 0), rect.width);
    const index = Math.min(displayRows.length - 1, Math.max(0, Math.round((x / rect.width) * (displayRows.length - 1))));
    return displayRows[index] || null;
  };
  const getChartPayload = (state) => {
    const index = Number.isInteger(state?.activeTooltipIndex) ? state.activeTooltipIndex : -1;
    return state?.activePayload?.[0]?.payload || (index >= 0 ? displayRows[index] : null);
  };
  const handleChartPoint = (state) => {
    if (!onHover) return;
    const payload = getChartPayload(state);
    if (payload) onHover(payload);
  };
  const handlePointerMove = (event) => {
    const payload = pickRowFromPointer(event);
    const rect = chartShellRef.current?.getBoundingClientRect();
    if (payload && rect) {
      setHoverTooltip({
        row: payload,
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        width: rect.width,
        height: rect.height,
      });
      if (onHover) onHover(payload);
      return;
    }
    setHoverTooltip(null);
  };
  const handleChartLeave = () => {
    setHoverTooltip(null);
    if (onLeave) onLeave();
  };
  const handlePointerLock = (event) => {
    if (!lockOnClick || !onLock) return;
    const payload = pickRowFromPointer(event);
    if (payload) onLock(payload);
  };
  const handleChartLock = (state) => {
    if (!lockOnClick || !onLock) return;
    const payload = getChartPayload(state);
    if (payload) onLock(payload);
  };
  const getPointerDistance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const getPointerCenterX = (a, b) => (a.x + b.x) / 2;
  const handlePointerDown = (event) => {
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointersRef.current.size >= 2) {
      event.preventDefault();
      const [a, b] = Array.from(pointersRef.current.values()).slice(0, 2);
      const rect = chartShellRef.current?.getBoundingClientRect();
      const baseWindow = zoomWindow || { start: 0, end: finalRows.length - 1 };
      pinchRef.current = {
        distance: Math.max(1, getPointerDistance(a, b)),
        centerRatio: rect?.width ? Math.min(1, Math.max(0, (getPointerCenterX(a, b) - rect.left) / rect.width)) : 0.5,
        start: baseWindow.start,
        end: baseWindow.end
      };
      return;
    }
    handlePointerLock(event);
  };
  const handlePointerMoveZoom = (event) => {
    if (pointersRef.current.has(event.pointerId)) {
      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }
    if (pointersRef.current.size >= 2 && pinchRef.current) {
      event.preventDefault();
      const [a, b] = Array.from(pointersRef.current.values()).slice(0, 2);
      const distance = Math.max(1, getPointerDistance(a, b));
      const base = pinchRef.current;
      const baseSpan = Math.max(1, base.end - base.start + 1);
      const nextSpan = baseSpan / Math.max(0.25, Math.min(4, distance / base.distance));
      const anchor = base.start + base.centerRatio * (baseSpan - 1);
      const nextStart = anchor - base.centerRatio * (nextSpan - 1);
      const nextEnd = nextStart + nextSpan - 1;
      setZoomWindow(clampZoomWindow(nextStart, nextEnd));
      return;
    }
    handlePointerMove(event);
  };
  const handlePointerEnd = (event) => {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
  };
  const handleWheelZoom = (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const rect = chartShellRef.current?.getBoundingClientRect();
    const current = zoomWindow || { start: 0, end: finalRows.length - 1 };
    const ratio = rect?.width ? Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) : 0.5;
    const span = current.end - current.start + 1;
    const scale = event.deltaY < 0 ? 0.82 : 1.18;
    const nextSpan = span * scale;
    const anchor = current.start + ratio * (span - 1);
    const nextStart = anchor - ratio * (nextSpan - 1);
    setZoomWindow(clampZoomWindow(nextStart, nextStart + nextSpan - 1));
  };
  const handleDoubleClickReset = () => {
    setZoomWindow(null);
  };
  const legendPayload = normalized
    ? [
      { value: displayMainSymbol || '当前标的', type: 'line', color: mainColor, id: 'main' },
      ...cmpList.map((series, ci) => ({ value: formatSymbolDisplay(series.symbol), type: 'line', color: COMPARE_COLORS[ci % COMPARE_COLORS.length], id: `cmp_${ci}` }))
    ]
    : undefined;
  const canRenderResponsiveChart = chartSize.width > 0 && chartSize.height > 0;
  const renderChartTooltipContent = (row, label) => {
    if (!row) return null;
    const value = row.main;
    const price = Number(row.mainPrice ?? row.c ?? value);
    const visibleBase = Number(visibleRows[0]?.mainPrice ?? visibleRows[0]?.c);
    const showValue = !normalized && value != null && Number.isFinite(Number(value));
    const rangePct = Number.isFinite(price) && Number.isFinite(visibleBase) && visibleBase > 0 ? ((price / visibleBase) - 1) * 100 : null;
    const isPremiumPoint = row && (Object.prototype.hasOwnProperty.call(row, 'iopv') || Number.isFinite(Number(row.mainIopv)));
    if (showPremiumSpread && row) {
      const spreadItems = cmpList
        .map((series, index) => ({
          symbol: formatSymbolDisplay(series.symbol),
          color: COMPARE_COLORS[index % COMPARE_COLORS.length],
          value: Number(row[`cmp_${index}`])
        }))
        .filter((entry) => Number.isFinite(entry.value));
      return (
        <div className="rounded-xl bg-white/95 px-3 py-2 text-[13px] font-medium text-[#5f6368] shadow-[0_8px_24px_rgba(60,64,67,0.20)] ring-1 ring-black/5">
          <div>{label}</div>
          {spreadItems.map((entry) => (
            <div key={entry.symbol} className="mt-0.5 flex items-center gap-1.5 tabular-nums text-[#1f1f1f]">
              <span className="size-2 rounded-sm" style={{ background: entry.color }} />
              <span>{entry.symbol}</span>
              <span>{formatSignedPercent(entry.value)}</span>
            </div>
          ))}
        </div>
      );
    }
    if (isPremiumPoint) {
      const nav = Number(row.mainNav);
      const navDate = row.mainNavDate || '';
      const marketPrice = Number(row.mainMarketPrice);
      return (
        <div className="rounded-xl bg-white/95 px-3 py-2 text-[13px] font-medium text-[#5f6368] shadow-[0_8px_24px_rgba(60,64,67,0.20)] ring-1 ring-black/5">
          <div>{row.date || label}</div>
          <div className="mt-0.5 tabular-nums text-[#1f1f1f]">{showPremiumSpread ? `溢价差 ${formatSignedPercent(value)}` : `溢价 ${formatPercentNoPlus(value)}`}</div>
          {Number.isFinite(marketPrice) && marketPrice > 0 ? (
            <div className="mt-0.5 tabular-nums">价格 {formatNumber(marketPrice, 4)}</div>
          ) : null}
          {Number.isFinite(nav) && nav > 0 ? (
            <div className="mt-0.5 tabular-nums">NAV {formatNumber(nav, 4)}{navDate ? ` @ ${navDate}` : ''}</div>
          ) : null}
        </div>
      );
    }
    return (
      <div className="rounded-xl bg-white/95 px-3 py-2 text-[13px] font-medium text-[#5f6368] shadow-[0_8px_24px_rgba(60,64,67,0.20)] ring-1 ring-black/5">
        <div>{label}</div>
        {showValue ? <div className="mt-0.5 tabular-nums text-[#1f1f1f]">{formatChartValue(value)}</div> : null}
        {rangePct != null ? (
          <div className={cx("mt-0.5 tabular-nums", rangePct > 0 ? "text-rose-600" : rangePct < 0 ? "text-emerald-600" : "text-[#5f6368]")}>{formatSignedPercent(rangePct)}</div>
        ) : null}
      </div>
    );
  };
  return (
    <div
      ref={chartShellRef}
      className="relative h-full w-full touch-none select-none outline-none [-webkit-tap-highlight-color:transparent] [&_*]:outline-none [&_.recharts-surface]:outline-none [&_.recharts-surface]:focus:outline-none [&_.recharts-wrapper]:outline-none"
      tabIndex={-1}
      onMouseMove={handlePointerMove}
      onMouseLeave={handleChartLeave}
      onPointerMove={handlePointerMoveZoom}
      onPointerLeave={(event) => { handlePointerEnd(event); handleChartLeave(); }}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onWheel={handleWheelZoom}
      onDoubleClick={handleDoubleClickReset}
    >
      {canRenderResponsiveChart ? (
        <ComposedChart
          width={chartSize.width}
          height={chartSize.height}
          data={displayRows}
          margin={{ top: 12, right: 12, left: 4, bottom: 8 }}
          onMouseMove={handleChartPoint}
          onClick={undefined}
        >
        <CartesianGrid stroke="rgba(17,24,39,0.09)" vertical strokeDasharray="0" />
        <XAxis dataKey="label" tick={{ fontSize: 12, fill: 'rgba(17,24,39,0.62)' }} minTickGap={40} axisLine={false} tickLine={false} />
        <YAxis
          tick={{ fontSize: 12, fill: 'rgba(17,24,39,0.62)' }}
          domain={['auto', 'auto']}
          width={44}
          axisLine={false}
          tickLine={false}
          tickFormatter={(value) => (normalized || compareAsValue || isPremiumChart) ? `${Number(value).toFixed(1)}%` : formatChartValue(value)}
        />
        {Number.isFinite(Number(premiumMean)) ? (
          <ReferenceLine
            y={premiumMean}
            stroke="#5f6368"
            strokeDasharray="4 4"
            ifOverflow="extendDomain"
            label={{ value: `${showPremiumSpread ? '溢价差均值' : '均值'} ${formatPercentNoPlus(premiumMean)}`, position: 'insideTopRight', fill: '#5f6368', fontSize: 12, fontWeight: 600 }}
          />
        ) : null}
        <Tooltip
          cursor={false}
          content={({ label, payload }) => {
            const item = Array.isArray(payload) ? payload.find((entry) => entry && entry.dataKey === 'main') : null;
            const row = item && item.payload ? item.payload : null;
            return renderChartTooltipContent(row, label);
          }}
        />
        {showArea ? (
          <Area type="monotone" dataKey="main" name={displayMainSymbol || '当前标的'} stroke={mainColor} fill={mainColor} fillOpacity={0.12} dot={false} strokeWidth={3} isAnimationActive={false} />
        ) : null}
        {showLine ? (
          <Line type="monotone" dataKey="main" name={displayMainSymbol || '当前标的'} stroke={mainColor} dot={false} strokeWidth={3} isAnimationActive={false} />
        ) : null}
        {showBar ? (
          <Bar dataKey="main" name={displayMainSymbol || '当前标的'} fill={mainColor} fillOpacity={0.72} radius={[3, 3, 0, 0]} isAnimationActive={false} />
        ) : null}
        {showCandle ? (
          <Line type="monotone" dataKey="c" stroke="transparent" dot={false} activeDot={false} isAnimationActive={false} />
        ) : null}
        {showCandle ? (
          <Customized component={<CandlesLayerPanel data={visibleRows} />} />
        ) : null}
        {visibleTradeMarkerPoints.map((marker) => (
          <ReferenceDot
            key={`${marker.id}-${marker.x}`}
            x={marker.x}
            y={marker.y}
            r={5}
            fill={marker.color}
            stroke="#ffffff"
            strokeWidth={2}
            ifOverflow="visible"
            isFront
            label={{ value: marker.label, position: marker.type === 'BUY' ? 'bottom' : 'top', fill: marker.color, fontSize: 12, fontWeight: 700 }}
          />
        ))}
        {indicatorLines.map((line) => (
          <Line
            key={line.key}
            type="monotone"
            dataKey={line.key}
            name={line.label}
            stroke={line.color}
            strokeDasharray={line.dashed ? '3 3' : '0'}
            dot={false}
            strokeWidth={1}
            isAnimationActive={false}
          />
        ))}
        {chartType === 'bar' ? cmpList.map((series, ci) => (
          <Bar
            key={`cmp_${ci}`}
            dataKey={`cmp_${ci}`}
            name={formatSymbolDisplay(series.symbol)}
            fill={COMPARE_COLORS[ci % COMPARE_COLORS.length]}
            fillOpacity={0.62}
            radius={[3, 3, 0, 0]}
            isAnimationActive={false}
          />
        )) : cmpList.map((series, ci) => (
          <Line
            key={`cmp_${ci}`}
            type="monotone"
            dataKey={`cmp_${ci}`}
            name={formatSymbolDisplay(series.symbol)}
            stroke={COMPARE_COLORS[ci % COMPARE_COLORS.length]}
            dot={false}
            activeDot={false}
            strokeWidth={2.5}
            connectNulls
            isAnimationActive={false}
          />
        ))}
        </ComposedChart>
      ) : null}
      {hoverTooltip?.row ? (
        <div
          data-testid="market-chart-hover-tooltip"
          className="pointer-events-none absolute z-20"
          style={{
            left: `${Math.min(Math.max(hoverTooltip.x, 8), Math.max(8, hoverTooltip.width - 8))}px`,
            top: `${Math.min(Math.max(hoverTooltip.y, 36), Math.max(36, hoverTooltip.height - 8))}px`,
            transform: hoverTooltip.x > hoverTooltip.width * 0.6
              ? 'translate(-100%, -50%) translateX(-10px)'
              : 'translate(10px, -50%)',
          }}
        >
          {renderChartTooltipContent(hoverTooltip.row, hoverTooltip.row.date || hoverTooltip.row.label)}
        </div>
      ) : null}
    </div>
  );
}

export function ChartToolbarPopover({ label, icon, active, children, align = 'left', panelClassName = '', buttonClassName = '', fixedPanel = false }) {
  const [open, setOpen] = useState(false);
  const [panelStyle, setPanelStyle] = useState(null);
  const ref = useRef(null);
  const buttonRef = useRef(null);

  useClickOutside(ref, () => setOpen(false), open);

  const updateFixedPanelPosition = useCallback(() => {
    if (!fixedPanel || !buttonRef.current || typeof window === 'undefined') return;
    const rect = buttonRef.current.getBoundingClientRect();
    const width = Math.min(360, Math.max(0, window.innerWidth - 16));
    const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - width - 8));
    setPanelStyle({ left, top: rect.bottom + 6, width });
  }, [fixedPanel]);

  useEffect(() => {
    if (!open) return undefined;
    updateFixedPanelPosition();
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    if (fixedPanel) {
      window.addEventListener('resize', updateFixedPanelPosition);
      window.addEventListener('scroll', updateFixedPanelPosition, true);
    }
    return () => {
      document.removeEventListener('keydown', onKey);
      if (fixedPanel) {
        window.removeEventListener('resize', updateFixedPanelPosition);
        window.removeEventListener('scroll', updateFixedPanelPosition, true);
      }
    };
  }, [open, fixedPanel, updateFixedPanelPosition]);
  return (
    <div ref={ref} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cx(
          'inline-flex h-8 items-center gap-1 rounded-[11px] px-2 text-[12px] font-semibold text-[#202124] transition hover:bg-white/70 sm:h-9 sm:gap-1.5 sm:px-2.5 sm:text-[13px]',
          active ? 'border border-[rgba(17,24,39,0.08)] bg-white/60 shadow-[0_2px_8px_rgba(0,0,0,0.06)]' : 'border border-transparent bg-transparent',
          buttonClassName
        )}
      >
        {icon ? <span className="text-[13px] leading-none text-[#202124] sm:text-[14px]" aria-hidden="true">{icon}</span> : null}
        <span>{label}</span>
        <ChevronDown size={12} className={cx('transition', open ? 'rotate-180' : '')} />
      </button>
      {open ? (
        <div
          className={cx(
            fixedPanel
              ? 'fixed z-50 min-w-[190px] rounded-[14px] border border-[rgba(17,24,39,0.08)] bg-white p-1.5 shadow-[0_6px_18px_rgba(0,0,0,0.10)]'
              : 'absolute z-30 mt-1 min-w-[190px] rounded-[14px] border border-[rgba(17,24,39,0.08)] bg-white p-1.5 shadow-[0_6px_18px_rgba(0,0,0,0.10)]',
            panelClassName,
            !fixedPanel && (align === 'right' ? 'right-0' : 'left-0')
          )}
          style={fixedPanel && panelStyle ? panelStyle : undefined}
        >
          {typeof children === 'function' ? children({ close: () => setOpen(false) }) : children}
        </div>
      ) : null}
    </div>
  );
}
