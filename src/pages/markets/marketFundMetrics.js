import { normalizeCnFundCode } from './marketDisplayUtils.js';
import {
  calendarDaysBetween,
  getNearestTradingDayShanghai,
  getPreviousTradingDayShanghai,
} from '../../app/holidaysCN.js';
import {
  normalizeNavHistoryItems,
  resolveHistoricalPremiumNav,
} from '../../app/fundPremiumNav.js';

// 图表时间范围 tab：Google Finance 风格。每个 range 映射到 worker 接受的 tf。
// 客户端再按 range 截取 candles 最后一段，保证视觉粒度合理。
export const CHART_RANGE_TABS = [
  { key: '1d', label: '1 天', tabId: '1dayTab', tf: '5m', daysBack: 1 },
  { key: '5d', label: '5 天', tabId: '5dayTab', tf: '5m', daysBack: 5 },
  { key: '1mo', label: '1 个月', tabId: '1monthTab', tf: '1d', daysBack: 31 },
  { key: '6mo', label: '6 个月', tabId: '6monthTab', tf: '1d', daysBack: 31 * 6 },
  { key: 'ytd', label: '年初至今', tabId: 'ytdTab', tf: '1d', daysBack: null },
  { key: '1y', label: '1 年', tabId: '1yearTab', tf: '1d', daysBack: 365 },
  { key: '5y', label: '5 年', tabId: '5yearTab', tf: '1d', daysBack: 365 * 5 },
  { key: 'max', label: '最大', tabId: 'maxTab', tf: '1d', daysBack: null },
  { key: 'custom', label: '自定义', tabId: 'customRangeTab', tf: '1d', daysBack: null, custom: true },
];

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDate(value) {
  return ISO_DATE_RE.test(String(value || ''));
}

export function todayShanghaiIso() {
  try {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  } catch (_error) {
    return new Date().toISOString().slice(0, 10);
  }
}

export function shiftShanghaiIsoDate(isoDate, deltaDays) {
  if (!isIsoDate(isoDate)) return '';
  const [year, month, day] = isoDate.split('-').map((part) => Number(part));
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + Number(deltaDays || 0));
  return date.toISOString().slice(0, 10);
}

export function normalizeChartCustomRange(customRange) {
  const from = String(customRange?.from || '').slice(0, 10);
  const to = String(customRange?.to || '').slice(0, 10);
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) return null;
  return { from, to };
}

export function defaultChartCustomRange({ daysBack = 90 } = {}) {
  const to = todayShanghaiIso();
  return { from: shiftShanghaiIsoDate(to, -Math.max(1, Number(daysBack) || 90)), to };
}

export function formatChartRangeLabel(rangeKey, customRange) {
  const custom = rangeKey === 'custom' ? normalizeChartCustomRange(customRange) : null;
  if (custom) return `${custom.from} 至 ${custom.to}`;
  return CHART_RANGE_TABS.find((item) => item.key === rangeKey)?.label || '区间';
}

// 向前回溯第 n 个 A 股交易日（n=0 即当天）。与 holidaysCN 的节假日表保持一致。
export function nthPreviousTradingDayShanghai(dateStr, count = 0) {
  let current = String(dateStr || '');
  const steps = Math.max(0, Math.min(Number(count) || 0, 60));
  for (let i = 0; i < steps && isIsoDate(current); i += 1) {
    current = getPreviousTradingDayShanghai(current);
  }
  return isIsoDate(current) ? current : '';
}

function uniqueCandleDates(candles = []) {
  const dates = new Set();
  for (const candle of Array.isArray(candles) ? candles : []) {
    const date = isIsoDate(candle?.date) ? String(candle.date).slice(0, 10) : shanghaiDateFromEpochSec(candle?.t);
    if (date) dates.add(date);
  }
  return Array.from(dates).sort((a, b) => a.localeCompare(b));
}

// 图表区间覆盖的起点日期（上海时区）。'' 表示无法限定起点（如 max）。
function chartRangeStartDate(rangeKey, customRange = null, todayIso = '') {
  const custom = rangeKey === 'custom' ? normalizeChartCustomRange(customRange) : null;
  if (custom) return custom.from;
  const today = isIsoDate(todayIso) ? todayIso : todayShanghaiIso();
  if (rangeKey === 'ytd') return `${today.slice(0, 4)}-01-01`;
  if (rangeKey === 'max') return '';
  const cfg = CHART_RANGE_TABS.find((item) => item.key === rangeKey);
  if (!cfg || cfg.daysBack == null) return '';
  return shiftShanghaiIsoDate(today, -cfg.daysBack);
}

function calendarDaysForChartRange(rangeKey, customRange = null, todayIso = '') {
  const custom = rangeKey === 'custom' ? normalizeChartCustomRange(customRange) : null;
  if (custom) {
    const start = epochSecFromShanghaiDate(custom.from, '00:00:00');
    const end = epochSecFromShanghaiDate(custom.to, '23:59:59');
    if (!start || !end) return 3650;
    return Math.max(1, Math.ceil((end - start) / 86400) + 1);
  }
  if (rangeKey === 'ytd') {
    const today = isIsoDate(todayIso) ? todayIso : todayShanghaiIso();
    const start = `${today.slice(0, 4)}-01-01`;
    return Math.max(1, calendarDaysBetween(start, today) + 1);
  }
  const cfg = CHART_RANGE_TABS.find((item) => item.key === rangeKey);
  if (!cfg || cfg.daysBack == null) return 3650;
  return Math.max(1, Number(cfg.daysBack) || 1);
}

function estimateTradingCandles(calendarDays) {
  return Math.max(2, Math.ceil((Number(calendarDays) || 1) * 5 / 7) + 12);
}

export function chartKlineLimitForRange(rangeKey, customRange = null) {
  if (rangeKey === '1d' || rangeKey === '5d') return '';
  return Math.max(30, Math.min(3000, estimateTradingCandles(calendarDaysForChartRange(rangeKey, customRange))));
}

export function chartKlineRequestForRange(rangeKey, customRange = null) {
  const cfg = CHART_RANGE_TABS.find((item) => item.key === rangeKey) || CHART_RANGE_TABS[0];
  const timeframe = cfg?.tf || '1d';
  return {
    timeframe,
    limit: timeframe === '1d' ? chartKlineLimitForRange(rangeKey, customRange) : '',
    session: timeframe === '5m' && rangeKey === '5d' ? 'all' : ''
  };
}

export function shouldForceLiveChartRange(rangeKey, customRange = null) {
  return chartKlineRequestForRange(rangeKey, customRange).timeframe !== '1d';
}

export function chartKlineCacheKey(symbol, { timeframe = '1d', session = '', limit = '' } = {}) {
  const normalizedSymbol = String(symbol || '').trim();
  const normalizedTimeframe = String(timeframe || '1d').trim();
  const normalizedSession = String(session || '').trim();
  const normalizedLimit = Math.max(0, Math.min(3000, Number(limit) || 0));
  const parts = [normalizedSymbol, normalizedTimeframe];
  if (normalizedSession) parts.push(`session=${normalizedSession}`);
  // 日线请求带 limit，必须作为缓存键的一部分：短区间与长区间共用 symbol|1d 会让
  // 一次 1 个月请求的 35 根蜡烛覆盖 5 年请求的结果（或反过来）。
  if (normalizedLimit > 0) parts.push(`limit=${normalizedLimit}`);
  return parts.join('|');
}

export function chartKlineCacheKeyForRange(symbol, rangeKey, customRange = null) {
  return chartKlineCacheKey(symbol, chartKlineRequestForRange(rangeKey, customRange));
}

// 完整性按"实际日期是否覆盖请求区间"判断，数量只作为最小可渲染门槛。
// - 数据必须覆盖最近一个交易日（休市日回退到上一交易日），陈旧数据不算完整。
// - 1 天 / 5 天按交易日覆盖：5 天必须包含最近 5 个实际交易日，不能只取 5 个自然日。
// - 日线区间要求首根蜡烛不晚于区间起点；新基金上市晚于区间起点时同样返回 false，
//   由调用方按"已请求过的区间"短路补请求，避免循环。
export function hasEnoughChartCandles(candles, rangeKey, customRange = null, { today = '' } = {}) {
  const arr = Array.isArray(candles) ? candles : [];
  if (arr.length < 2) return false;
  const dates = uniqueCandleDates(arr);
  if (!dates.length) return false;
  const todayIso = isIsoDate(today) ? today : todayShanghaiIso();
  const latestTradingDay = getNearestTradingDayShanghai(todayIso);
  if (dates[dates.length - 1] < latestTradingDay) return false;
  if (rangeKey === '1d') return dates[0] <= latestTradingDay;
  if (rangeKey === '5d') return dates[0] <= nthPreviousTradingDayShanghai(latestTradingDay, 4);
  const start = chartRangeStartDate(rangeKey, customRange, todayIso);
  return !start || dates[0] <= start;
}

export function buildNavSnapshotItems(snapshot) {
  if (!snapshot) return [];
  const rows = [];
  const previousDate = String(snapshot.previousNavDate || '').slice(0, 10);
  const previousNav = Number(snapshot.previousNav);
  if (/^\d{4}-\d{2}-\d{2}$/.test(previousDate) && Number.isFinite(previousNav) && previousNav > 0) {
    rows.push({ date: previousDate, nav: previousNav });
  }
  const latestDate = String(snapshot.latestNavDate || snapshot.navDate || '').slice(0, 10);
  const latestNav = Number(snapshot.latestNav ?? snapshot.baseNav);
  if (/^\d{4}-\d{2}-\d{2}$/.test(latestDate) && Number.isFinite(latestNav) && latestNav > 0) {
    rows.push({ date: latestDate, nav: latestNav });
  }
  const seen = new Set();
  return rows
    .sort((a, b) => a.date.localeCompare(b.date))
    .filter((item) => {
      if (seen.has(item.date)) return false;
      seen.add(item.date);
      return true;
    });
}

export function sliceCandlesForRange(candles, rangeKey, customRange = null) {
  const arr = Array.isArray(candles) ? candles : [];
  if (!arr.length) return arr;
  const custom = rangeKey === 'custom' ? normalizeChartCustomRange(customRange) : null;
  if (custom) {
    const startSec = epochSecFromShanghaiDate(custom.from, '00:00:00');
    const endSec = epochSecFromShanghaiDate(custom.to, '23:59:59');
    if (!startSec || !endSec) return [];
    return arr.filter((c) => {
      const t = Number(c && c.t);
      return Number.isFinite(t) && t >= startSec && t <= endSec;
    });
  }
  const cfg = CHART_RANGE_TABS.find((r) => r.key === rangeKey);
  if (!cfg) return arr;
  if (rangeKey === 'ytd') {
    const y = new Date().getFullYear();
    const startSec = Date.UTC(y, 0, 1) / 1000;
    return arr.filter((c) => Number(c && c.t) >= startSec);
  }
  if (cfg.daysBack == null) return arr;
  const maxSec = arr.reduce((max, candle) => {
    const t = Number(candle && candle.t);
    return Number.isFinite(t) && t > max ? t : max;
  }, 0);
  const anchorSec = maxSec > 0 ? maxSec : Math.floor(Date.now() / 1000);
  const cutoffSec = anchorSec - cfg.daysBack * 86400;
  const filtered = arr.filter((c) => Number(c && c.t) >= cutoffSec);
  return filtered.length >= 2 ? filtered : arr;
}

export function deriveCandlestickExtrema(candles, { daysBack = 365 } = {}) {
  const arr = (Array.isArray(candles) ? candles : [])
    .map((candle) => {
      const t = Number(candle?.t ?? candle?.timestamp);
      const high = Number(candle?.h ?? candle?.high);
      const low = Number(candle?.l ?? candle?.low);
      return { t, high, low };
    })
    .filter((item) => Number.isFinite(item.t) && item.t > 0);
  if (!arr.length) return { high: null, low: null, highDate: '', lowDate: '', count: 0 };

  const maxT = arr.reduce((max, item) => Math.max(max, item.t), 0);
  const normalizedDaysBack = Number(daysBack);
  const cutoffT = Number.isFinite(normalizedDaysBack) && normalizedDaysBack > 0
    ? maxT - normalizedDaysBack * 86400
    : -Infinity;

  let high = null;
  let highT = 0;
  let low = null;
  let lowT = 0;
  let count = 0;
  for (const item of arr) {
    if (item.t < cutoffT) continue;
    count += 1;
    if (Number.isFinite(item.high) && item.high > 0 && (high == null || item.high > high)) {
      high = item.high;
      highT = item.t;
    }
    if (Number.isFinite(item.low) && item.low > 0 && (low == null || item.low < low)) {
      low = item.low;
      lowT = item.t;
    }
  }

  return {
    high,
    low,
    highDate: highT ? shanghaiDateFromEpochSec(highT) : '',
    lowDate: lowT ? shanghaiDateFromEpochSec(lowT) : '',
    count,
  };
}

export function shanghaiDateFromEpochSec(sec) {
  const n = Number(sec);
  if (!Number.isFinite(n) || n <= 0) return '';
  try {
    return new Date(n * 1000).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  } catch (_error) {
    return new Date(n * 1000).toISOString().slice(0, 10);
  }
}

export function epochSecFromShanghaiDate(date, time = '15:00:00') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return 0;
  const safeTime = /^\d{2}:\d{2}(?::\d{2})?$/.test(String(time || '')) ? String(time) : '15:00:00';
  const t = Date.parse(`${date}T${safeTime}+08:00`);
  return Number.isFinite(t) ? Math.floor(t / 1000) : 0;
}

export function buildHoldingTradeMarkers(transactions = [], code = '', aliases = []) {
  const normalizedCode = normalizeCnFundCode(code);
  const normalizeAliasText = (value = '') => String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
  const aliasSet = new Set(
    [code, normalizedCode, ...(Array.isArray(aliases) ? aliases : [])]
      .map(normalizeAliasText)
      .filter(Boolean)
  );
  if (!normalizedCode && !aliasSet.size) return [];
  return (Array.isArray(transactions) ? transactions : [])
    .map((tx, index) => {
      const rawCandidates = [
        tx?.code,
        tx?.symbol,
        tx?.fundCode,
        tx?.securityCode,
        tx?.name,
      ].map(normalizeAliasText).filter(Boolean);
      const rawSymbol = rawCandidates[0] || '';
      const txCode = normalizeCnFundCode(rawCandidates.find((item) => normalizeCnFundCode(item)) || rawSymbol);
      const symbolMatches = Boolean(
        (normalizedCode && txCode === normalizedCode)
        || rawCandidates.some((item) => aliasSet.has(item))
        || (normalizedCode && rawCandidates.some((item) => item.includes(normalizedCode)))
      );
      const rawType = String(tx?.type || '').toUpperCase();
      const side = String(tx?.side || '').toLowerCase();
      const type = rawType === 'BUY' || rawType === '买入' || side === 'buy'
        ? 'BUY'
        : rawType === 'SELL' || rawType === '卖出' || side === 'sell'
          ? 'SELL'
          : '';
      const date = String(tx?.date || '').slice(0, 10);
      if (!symbolMatches || !type || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
      return {
        id: tx.id || `${type}-${date}-${index}`,
        type,
        date,
        t: epochSecFromShanghaiDate(date, '15:00:00'),
        price: Number(tx.price ?? tx.nav ?? tx.costPrice),
        shares: Number(tx.shares),
      };
    })
    .filter((marker) => marker && marker.t > 0)
    .filter((marker, index, markers) => {
      const key = `${marker.type}|${marker.date}|${Number(marker.price) || 0}|${Number(marker.shares) || 0}`;
      return markers.findIndex((item) => `${item.type}|${item.date}|${Number(item.price) || 0}|${Number(item.shares) || 0}` === key) === index;
    })
    .sort((a, b) => a.t - b.t);
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
  const latestLabelByType = new Map();
  markers.forEach((marker, index) => {
    const type = marker?.type === 'SELL' ? 'SELL' : marker?.type === 'BUY' ? 'BUY' : '';
    if (!type) return;
    const markerT = Number(marker?.t);
    const markerDate = String(marker?.date || shanghaiDateFromEpochSec(markerT) || '');
    const fallbackRank = Date.parse(`${markerDate}T15:00:00+08:00`) / 1000;
    const rank = Number.isFinite(markerT) ? markerT : fallbackRank;
    if (!Number.isFinite(rank)) return;
    const current = latestLabelByType.get(type);
    if (!current || rank > current.rank || (rank === current.rank && index > current.index)) {
      latestLabelByType.set(type, { marker, index, rank });
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
    const latestForType = latestLabelByType.get(marker.type);
    const label = latestForType?.marker === marker ? (isBuy ? '买入' : '卖出') : '';
    return {
      id: marker.id || `${marker.type}-${marker.date}-${index}`,
      type: marker.type,
      date: marker.date,
      x: row.label,
      y,
      color: isBuy ? '#f6a623' : '#5b8def',
      label,
    };
  }).filter(Boolean);
}

export function buildChartRowsWithTradeMarkerDomain(rows = [], markerPoints = []) {
  if (!Array.isArray(rows) || !rows.length || !Array.isArray(markerPoints) || !markerPoints.length) return rows;
  const markerValuesByLabel = new Map();
  markerPoints.forEach((marker) => {
    const label = String(marker?.x || '');
    const y = Number(marker?.y);
    if (!label || !Number.isFinite(y)) return;
    const bucket = markerValuesByLabel.get(label) || { min: y, max: y };
    bucket.min = Math.min(bucket.min, y);
    bucket.max = Math.max(bucket.max, y);
    markerValuesByLabel.set(label, bucket);
  });
  if (!markerValuesByLabel.size) return rows;
  return rows.map((row) => {
    const bucket = markerValuesByLabel.get(String(row?.label || ''));
    return bucket ? { ...row, tradeMarkerMin: bucket.min, tradeMarkerMax: bucket.max } : row;
  });
}

// NAV 查询需要在可见价格日期之前多留对齐缓冲：QDII 的区间起点价格要找"价格日前
// 最近可用 NAV"，缓冲不足时区间首日的溢价点会因为找不到前一净值被丢弃。
export const NAV_HISTORY_ALIGN_BUFFER_DAYS = 14;

export function navHistoryDaysForRange(rangeKey, customRange = null, { today = '' } = {}) {
  const custom = rangeKey === 'custom' ? normalizeChartCustomRange(customRange) : null;
  if (custom) {
    const start = epochSecFromShanghaiDate(custom.from, '00:00:00');
    const end = epochSecFromShanghaiDate(custom.to, '23:59:59');
    if (!start || !end) return 3650;
    return Math.max(1, Math.min(3650, Math.ceil((end - start) / 86400) + 2));
  }
  const cfg = CHART_RANGE_TABS.find((r) => r.key === rangeKey);
  if (rangeKey === '1d') return 30;
  if (rangeKey === '5d') return 45;
  if (rangeKey === 'ytd') {
    const todayIso = isIsoDate(today) ? today : todayShanghaiIso();
    const start = `${todayIso.slice(0, 4)}-01-01`;
    return Math.max(30, calendarDaysBetween(start, todayIso) + 10);
  }
  if (!cfg || cfg.daysBack == null) return 3650;
  // 日K线按交易日计，NAV需覆盖周末/节假日：交易日数 * 7/5 + 缓冲
  if (cfg.tf === '1d') {
    const tradingDays = chartKlineLimitForRange(rangeKey, customRange);
    if (Number.isFinite(tradingDays) && tradingDays > 0) {
      const calendarDays = Math.ceil(tradingDays * 7 / 5) + 15;
      return Math.max(30, Math.min(3650, calendarDays));
    }
  }
  return Math.max(30, Math.min(3650, cfg.daysBack + 10));
}

// 查询与缓存键使用同一份规范化范围（from/to，上海时区），键格式与
// navHistoryClient 的 IndexedDB 键 `${code}|${from}|${to}` 完全一致。
export function navHistoryQueryForRange(rangeKey, customRange = null, { today = '' } = {}) {
  const custom = rangeKey === 'custom' ? normalizeChartCustomRange(customRange) : null;
  if (custom) {
    return { from: shiftShanghaiIsoDate(custom.from, -NAV_HISTORY_ALIGN_BUFFER_DAYS), to: custom.to };
  }
  const to = isIsoDate(today) ? today : todayShanghaiIso();
  return { from: shiftShanghaiIsoDate(to, -navHistoryDaysForRange(rangeKey, customRange, { today: to })), to };
}

export function navHistoryCacheKey(code, rangeKey, customRange = null, { today = '' } = {}) {
  const normalizedCode = normalizeCnFundCode(code);
  const query = navHistoryQueryForRange(rangeKey, customRange, { today });
  return `${normalizedCode}|${query.from}|${query.to}`;
}

// 溢价/净值指标统一的派生入口：主标的与对比标都必须走同一顺序
// （区间截取价格 → buildCnFundParamCandles 派生 → 再按区间截取派生结果），
// 避免相同数据在两条路径产生不同曲线。
export function buildDetailMetricCandles(priceCandles, navItems, param, premiumState, rangeKey, isQdii = false, { code = '', customRange = null } = {}) {
  const derived = buildCnFundParamCandles(priceCandles, navItems, param, premiumState, rangeKey, isQdii, { code });
  if (param === 'price') return derived;
  return sliceCandlesForRange(derived, rangeKey, customRange);
}

// 快照必须属于当前标的才允许参与派生，防止主标的快照污染对比曲线。
function snapshotOwnerMatches(snapshot, ownerCode) {
  if (!snapshot) return false;
  const snapshotCode = normalizeCnFundCode(snapshot.symbol);
  return !snapshotCode || !ownerCode || snapshotCode === ownerCode;
}

// 实时补点只接受快照内的有效行情时间（quoteAt/updatedAt/asOf），禁止用 Date.now()
// 在休市日凭空造点；快照时间早于或等于已有数据末点时也不补。
export function realtimeQuoteTimeSec(snapshot) {
  const candidates = [snapshot?.quoteAt, snapshot?.updatedAt, snapshot?.asOf];
  const maxFutureSec = Math.floor(Date.now() / 1000) + 48 * 3600;
  for (const raw of candidates) {
    const ms = Date.parse(String(raw || ''));
    if (!Number.isFinite(ms)) continue;
    const sec = Math.floor(ms / 1000);
    if (sec <= 0 || sec > maxFutureSec) continue;
    return sec;
  }
  return 0;
}

export function buildRealtimePremiumPoint(snapshot, sortedNav, isQdii = false) {
  // premiumPercent 为 null/undefined 时不得把 Number(null)=0 当成 0% 实时点。
  const rawPremium = snapshot?.premiumPercent;
  if (rawPremium == null) return null;
  const premiumPercent = Number(rawPremium);
  if (!Number.isFinite(premiumPercent)) return null;
  const quoteSec = realtimeQuoteTimeSec(snapshot);
  if (!quoteSec) return null;
  const quoteDate = shanghaiDateFromEpochSec(quoteSec);
  if (!quoteDate) return null;
  const resolved = resolveHistoricalPremiumNav(sortedNav, quoteDate, {
    isCrossBorder: isQdii,
    allowPreviousForNonCrossBorder: true,
  });
  const nav = Number(resolved?.nav);
  if (!Number.isFinite(nav) || nav <= 0) return null;
  const marketPrice = Number(snapshot?.price);
  return {
    t: quoteSec,
    o: premiumPercent,
    h: premiumPercent,
    l: premiumPercent,
    c: premiumPercent,
    date: quoteDate,
    nav,
    iopv: nav,
    navDate: resolved.navDate,
    navStale: resolved.stale,
    marketPrice: Number.isFinite(marketPrice) ? marketPrice : null,
  };
}

export function mergeRealtimePremiumPoint(baseCandles, point) {
  const base = Array.isArray(baseCandles) ? baseCandles : [];
  if (!point) return base;
  if (!base.length) return [point];
  const lastT = Number(base[base.length - 1]?.t);
  // 已有同刻或更新的数据时不补点（去重 + 保持有序）。
  if (Number.isFinite(lastT) && point.t <= lastT) return base;
  return [...base, point];
}

export function buildCnFundParamCandles(priceCandles, navItems, param, premiumState, rangeKey = '', isQdii = false, { code = '' } = {}) {
  if (param === 'price') return priceCandles;
  const ownerCode = normalizeCnFundCode(code);
  const ownedSnapshot = snapshotOwnerMatches(premiumState?.data, ownerCode) ? premiumState?.data || null : null;
  let sortedNav = normalizeNavHistoryItems(navItems);
  if (param === 'nav') {
    const latestDate = String(ownedSnapshot?.navDate || '').slice(0, 10);
    const latestNav = Number(ownedSnapshot?.latestNav ?? ownedSnapshot?.baseNav);
    if (/^\d{4}-\d{2}-\d{2}$/.test(latestDate) && Number.isFinite(latestNav) && latestNav > 0) {
      sortedNav = sortedNav.filter((item) => item.date !== latestDate);
      sortedNav.push({ date: latestDate, nav: latestNav, source: 'xueqiu-quote' });
      sortedNav.sort((a, b) => a.date.localeCompare(b.date));
    }
  }
  if (param === 'nav' && rangeKey === '1d' && sortedNav.length) {
    // 场外基金没有盘中分时。1 天视图用最新确认净值生成同一日水平线，避免把前一净值日连成斜线。
    const latest = sortedNav[sortedNav.length - 1];
    const v = Number(latest.nav);
    const startT = epochSecFromShanghaiDate(latest.date, '09:30:00');
    const endT = epochSecFromShanghaiDate(latest.date, '15:00:00');
    return startT && endT && Number.isFinite(v) && v > 0
      ? [
        { t: startT, o: v, h: v, l: v, c: v, date: latest.date },
        { t: endT, o: v, h: v, l: v, c: v, date: latest.date }
      ]
      : [];
  }
  if (param === 'nav') {
    return sortedNav
      .map((item) => {
        const t = epochSecFromShanghaiDate(item.date);
        const v = Number(item.nav);
        return t && Number.isFinite(v) && v > 0 ? { t, o: v, h: v, l: v, c: v, date: item.date } : null;
      })
      .filter(Boolean);
  }
  if (param === 'premium') {
    const base = (Array.isArray(priceCandles) ? priceCandles : [])
      .map((candle) => {
        const date = shanghaiDateFromEpochSec(candle?.t);
        const resolved = resolveHistoricalPremiumNav(sortedNav, date, {
          isCrossBorder: isQdii,
          allowPreviousForNonCrossBorder: rangeKey === '1d',
        });
        const nav = Number(resolved?.nav);
        if (!date || !Number.isFinite(nav) || nav <= 0) return null;
        const iopv = nav;
        const toPremium = (value) => {
          const n = Number(value);
          return Number.isFinite(n) ? ((n - nav) / nav) * 100 : null;
        };
        const o = toPremium(candle.o);
        const h = toPremium(candle.h);
        const l = toPremium(candle.l);
        const c = toPremium(candle.c);
        if (![o, h, l, c].every(Number.isFinite)) return null;
        // 每条溢价点明确实际使用的 navDate，并带陈旧标记（长假缺口/净值滞后）。
        return { t: Number(candle.t), o, h, l, c, date, nav, iopv, navDate: resolved.navDate, navStale: resolved.stale, marketPrice: Number(candle.c) };
      })
      .filter(Boolean);

    // 1 天溢价：用快照里的有效行情时间补"最新点"，让图表跟随实时溢价刷新。
    // 历史仍来自 base（由 candle 价格 + 当日/前一净值映射计算）。
    if (rangeKey === '1d') {
      const point = buildRealtimePremiumPoint(ownedSnapshot, sortedNav, isQdii);
      if (point) return mergeRealtimePremiumPoint(base, point);
    }
    return base;
  }
  return priceCandles;
}

export function isCnOtcFundQuote(row) {
  if (!row) return false;
  const source = String(row.source || '').toLowerCase();
  const fundKind = String(row.fundKind || row.kind || row.fundVenue || '').toLowerCase();
  const assetType = String(row.assetType || row.type || '').toLowerCase();
  const exchange = String(row.exchange || '').toLowerCase();
  return row.valueType === 'nav'
    || fundKind === 'otc'
    || fundKind === 'qdii'
    || assetType.includes('otc')
    || assetType.includes('场外')
    || exchange.includes('场外')
    || source.includes('otc-fund')
    || source.includes('danjuan')
    || source.includes('nav-fallback');
}
