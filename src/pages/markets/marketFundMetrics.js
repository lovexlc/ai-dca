import { normalizeCnFundCode } from './marketDisplayUtils.js';

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

export function navHistoryDaysForRange(rangeKey, customRange = null) {
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
    const start = new Date(new Date().getFullYear(), 0, 1);
    return Math.max(30, Math.ceil((Date.now() - start.getTime()) / 86400000) + 10);
  }
  if (!cfg || cfg.daysBack == null) return 3650;
  return Math.max(30, Math.min(3650, cfg.daysBack + 10));
}

export function navHistoryQueryForRange(rangeKey, customRange = null) {
  const custom = rangeKey === 'custom' ? normalizeChartCustomRange(customRange) : null;
  if (custom) return { from: custom.from, to: custom.to };
  return { days: navHistoryDaysForRange(rangeKey) };
}

export function navHistoryCacheKey(code, rangeKey, customRange = null) {
  const normalizedCode = normalizeCnFundCode(code);
  const query = navHistoryQueryForRange(rangeKey, customRange);
  if (query.from && query.to) return `${normalizedCode}|${query.from}|${query.to}`;
  return `${normalizedCode}|${query.days}`;
}

export function findNavOnOrBefore(navItems, date) {
  if (!Array.isArray(navItems) || !date) return null;
  let found = null;
  for (const item of navItems) {
    if (item.date <= date) found = item;
    else break;
  }
  return found;
}

function premiumNavLookupDate(candleDate, qdii) {
  if (!qdii || !candleDate) return candleDate;
  return shiftShanghaiIsoDate(candleDate, -1);
}

export function findNavOnDate(navItems, date) {
  if (!Array.isArray(navItems) || !date) return null;
  return navItems.find((item) => item.date === date) || null;
}

export function buildCnFundParamCandles(priceCandles, navItems, param, premiumState, rangeKey = '', isQdii = false) {
  if (param === 'price') return priceCandles;
  let sortedNav = (Array.isArray(navItems) ? navItems : [])
    .filter((item) => item && /^\d{4}-\d{2}-\d{2}$/.test(String(item.date || '')) && Number(item.nav) > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (param === 'nav') {
    const latestData = premiumState?.data || null;
    const latestDate = String(latestData?.navDate || '').slice(0, 10);
    const latestNav = Number(latestData?.latestNav ?? latestData?.baseNav);
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
        const navItem = isQdii
          ? findNavOnOrBefore(sortedNav, premiumNavLookupDate(date, true))
          : rangeKey === '1d'
            ? findNavOnOrBefore(sortedNav, date)
            : findNavOnDate(sortedNav, date);
        const nav = Number(navItem?.nav);
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
        return { t: Number(candle.t), o, h, l, c, date, nav, iopv };
      })
      .filter(Boolean);

    // 1 天溢价：补一个“最新点”，让图表跟随实时溢价刷新。
    // 历史仍来自 base（由 candle 价格 + 当日/前一净值映射计算）。
    if (rangeKey === '1d') {
      const latest = premiumState?.data;
      const premiumPercent = Number(latest?.premiumPercent);
      if (Number.isFinite(premiumPercent)) {
        const nowSec = Math.floor(Date.now() / 1000);
        const nowDate = shanghaiDateFromEpochSec(nowSec);
        const navItem = findNavOnOrBefore(sortedNav, premiumNavLookupDate(nowDate, isQdii));
        const nav = Number(navItem?.nav);
        if (nowDate && Number.isFinite(nav) && nav > 0) {
          const latestPoint = {
            t: nowSec,
            o: premiumPercent,
            h: premiumPercent,
            l: premiumPercent,
            c: premiumPercent,
            date: nowDate,
            nav,
            iopv: nav,
          };
          return base.length ? [...base, latestPoint] : [latestPoint];
        }
      }
    }
    return base;
  }
  return priceCandles;
}

export function isCnOtcFundQuote(row) {
  if (!row) return false;
  const source = String(row.source || '').toLowerCase();
  const assetType = String(row.assetType || row.type || '').toLowerCase();
  const exchange = String(row.exchange || '').toLowerCase();
  return row.valueType === 'nav'
    || assetType.includes('otc')
    || assetType.includes('场外')
    || exchange.includes('场外')
    || source.includes('otc-fund')
    || source.includes('nav-fallback');
}
