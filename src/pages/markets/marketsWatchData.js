import { normalizeCnFundCode } from './marketDisplayUtils.js';
import { OTC_WATCH_CACHE_KEY } from '../../app/marketCacheKeys.js';

export { normalizeFundLimitEntries } from '../../app/fundLimitApi.js';

function uniqueCodes(codes = []) {
  return Array.from(new Set((codes || []).map((code) => normalizeCnFundCode(code)).filter(Boolean)));
}

function shanghaiParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type) => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
  };
}

function shanghaiLocalIso(parts, hour, minute, addDays = 0) {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day + addDays, hour - 8, minute, 0, 0)).toISOString();
}

function nextShanghaiDayIso(date = new Date()) {
  const parts = shanghaiParts(date);
  return shanghaiLocalIso(parts, 0, 0, 1);
}

function readOtcWatchCache() {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(OTC_WATCH_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeOtcWatchCache(cache) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(OTC_WATCH_CACHE_KEY, JSON.stringify(cache || {}));
  } catch {
    // ignore quota errors
  }
}

function readCachedItems(kind, codes = [], nowMs = Date.now()) {
  const cache = readOtcWatchCache();
  const bucket = cache?.[kind] && typeof cache[kind] === 'object' ? cache[kind] : {};
  const dataByCode = {};
  const missing = [];
  uniqueCodes(codes).forEach((code) => {
    const entry = bucket[code];
    const expiresAtMs = entry?.expiresAt ? Date.parse(entry.expiresAt) : 0;
    if (entry?.data && expiresAtMs > nowMs) {
      dataByCode[code] = entry.data;
    } else {
      missing.push(code);
    }
  });
  return { dataByCode, missing };
}

function writeCachedItems(kind, dataByCode = {}, expiresAt) {
  const cache = readOtcWatchCache();
  const bucket = cache?.[kind] && typeof cache[kind] === 'object' ? { ...cache[kind] } : {};
  Object.entries(dataByCode || {}).forEach(([rawCode, data]) => {
    const code = normalizeCnFundCode(rawCode);
    if (!code || !data) return;
    bucket[code] = { data, expiresAt, cachedAt: new Date().toISOString() };
  });
  writeOtcWatchCache({ ...cache, [kind]: bucket });
}

export function readCachedFundLimits(codes = []) {
  return readCachedItems('fundLimit', codes);
}

export function writeCachedFundLimits(dataByCode = {}) {
  writeCachedItems('fundLimit', dataByCode, nextShanghaiDayIso());
}

export function readCachedFundFees(codes = []) {
  return readCachedItems('fundFee', codes);
}

export function writeCachedFundFees(dataByCode = {}) {
  writeCachedItems('fundFee', dataByCode, nextShanghaiDayIso());
}

function findQuoteForCode(quotes = {}, code = '') {
  const normalized = normalizeCnFundCode(code);
  return quotes[normalized] || quotes[`SH${normalized}`] || quotes[`SZ${normalized}`] || quotes[`sh${normalized}`] || quotes[`sz${normalized}`] || null;
}

function quoteKeysForCode(quotes = {}, code = '', symbols = []) {
  const normalized = normalizeCnFundCode(code);
  if (!normalized) return [];
  const keys = new Set([normalized]);
  Object.keys(quotes || {}).forEach((key) => {
    if (normalizeCnFundCode(key) === normalized) keys.add(key);
  });
  (Array.isArray(symbols) ? symbols : []).forEach((symbol) => {
    if (normalizeCnFundCode(symbol) === normalized) keys.add(symbol);
  });
  return Array.from(keys);
}

function hasUsableQuote(quote = null) {
  if (!quote || quote.error) return false;
  const price = Number(quote.price ?? quote.latestNav ?? quote.currentPrice ?? quote.close);
  return Number.isFinite(price) && price > 0;
}

function hasPremiumValue(quote = null) {
  if (!quote || quote.error) return false;
  const explicit = Number(quote.premiumPercent ?? quote.premium_rate ?? quote.premiumPct ?? quote.premiumRate ?? quote.premium);
  if (Number.isFinite(explicit)) return true;
  const price = Number(quote.price ?? quote.regularMarketPrice ?? quote.latestPrice);
  const nav = Number(quote.iopv ?? quote.latestNav ?? quote.nav ?? quote.baseNav ?? quote.estimateNav);
  return Number.isFinite(price) && price > 0 && Number.isFinite(nav) && nav > 0;
}

function hasHighPointValue(quote = null) {
  if (!quote || quote.error) return false;
  const dailyHigh = Number(quote.highPoint?.high ?? quote.yearHigh);
  const closeHigh = Number(quote.closeHighPoint?.high);
  return Number.isFinite(dailyHigh) && dailyHigh > 0 && Number.isFinite(closeHigh) && closeHigh > 0;
}

function mergeExchangeWorkerQuote(quote = {}, workerQuote = null) {
  if (!workerQuote) return quote;
  const premiumPercent = workerQuote.premiumPercent ?? workerQuote.premium_rate ?? quote.premiumPercent ?? quote.premium_rate;
  return {
    ...quote,
    ...workerQuote,
    price: quote.price ?? workerQuote.price,
    change: quote.change ?? workerQuote.change,
    changePercent: quote.changePercent ?? workerQuote.changePercent,
    latestNav: quote.latestNav ?? workerQuote.latestNav,
    previousNav: quote.previousNav ?? workerQuote.previousNav,
    latestNavDate: quote.latestNavDate ?? workerQuote.latestNavDate,
    iopv: quote.iopv ?? workerQuote.iopv ?? workerQuote.estimateNav,
    premiumPercent,
    premium_rate: quote.premium_rate ?? workerQuote.premium_rate ?? premiumPercent,
  };
}

export async function loadWatchQuotesWithEnhancements({
  symbols,
  market,
  fetchQuotes,
  getNavSnapshots,
  buildOtcFundQuoteFromSnapshot,
  isOtcList = false,
  includePremiumSnapshots = false,
  includeHighPointSnapshots = false,
  fetchPremiumQuotes = null,
  onBaseResult = null,
}) {
  const list = Array.isArray(symbols) ? symbols : [];
  const otcCodes = market === 'cn' && isOtcList
    ? uniqueCodes(list.map((sym) => normalizeCnFundCode(sym)))
    : [];

  // 场外基金现在直接调用 Worker API，不再使用本地 navSnapshot 缓存
  // Worker API 内部已经有 KV 缓存，数据更新及时
  const allSymbols = market === 'cn' ? list : list;
  const quotePayload = allSymbols.length ? await fetchQuotes(allSymbols) : { quotes: {} };
  const quotes = { ...(quotePayload.quotes || {}) };
  const navSnapshots = {};

  if (market !== 'cn') {
    if (typeof onBaseResult === 'function') onBaseResult({ quotes: { ...quotes }, navSnapshots: { ...navSnapshots } });
    return { quotes, navSnapshots };
  }

  // /quotes 已负责场外基金行情；只有 quote 缺失或不可用时才用净值快照兜底。
  const otcSnapshotFallbackCodes = otcCodes.filter((code) => !hasUsableQuote(findQuoteForCode(quotes, code)));
  if (otcSnapshotFallbackCodes.length) {
    try {
      const snapshotsPayload = await getNavSnapshots(otcSnapshotFallbackCodes);
      (snapshotsPayload.items || []).forEach((item) => {
        const code = normalizeCnFundCode(item?.code);
        if (code) {
          navSnapshots[code] = item;
        }
      });
      otcSnapshotFallbackCodes.forEach((code) => {
        const existing = findQuoteForCode(quotes, code) || {};
        const quote = buildOtcFundQuoteFromSnapshot(code, navSnapshots[code], existing);
        if (quote) quotes[code] = quote;
      });
    } catch {
      // 场外基金净值是增强信息，失败时仍展示行情源返回的结果。
    }
  }

  if (typeof onBaseResult === 'function') onBaseResult({ quotes: { ...quotes }, navSnapshots: { ...navSnapshots } });

  const exchangeCodes = market === 'cn' && !isOtcList
    ? uniqueCodes(list.map((sym) => normalizeCnFundCode(sym)).filter((code) => /^\d{6}$/.test(code)))
    : [];
  const exchangePremiumCodes = includePremiumSnapshots
    ? exchangeCodes.filter((code) => !hasPremiumValue(findQuoteForCode(quotes, code)))
    : [];
  const exchangeHighPointCodes = includeHighPointSnapshots
    ? exchangeCodes.filter((code) => !hasHighPointValue(findQuoteForCode(quotes, code)))
    : [];
  const exchangeWorkerCodes = uniqueCodes([...exchangePremiumCodes, ...exchangeHighPointCodes]);
  if (exchangeWorkerCodes.length) {
    try {
      const workerPayload = typeof fetchPremiumQuotes === 'function'
        // High-point fields are list metadata produced by the scheduled K-line
        // job. The list may ask the Worker for KV metadata, but never asks it
        // to hydrate or scan an R2 K-line object.
        ? await fetchPremiumQuotes(exchangeWorkerCodes)
        : { quotes: {} };
      Object.entries(workerPayload.quotes || {}).forEach(([rawCode, item]) => {
        const code = normalizeCnFundCode(item?.code || rawCode);
        if (!code) return;
        const existing = findQuoteForCode(quotes, code) || {};
        const merged = mergeExchangeWorkerQuote(existing, item);
        quoteKeysForCode(quotes, code, list).forEach((key) => {
          quotes[key] = merged;
        });
      });
    } catch {
      // Worker quote carries list-only premium and high-point metadata; keep base quotes on failure.
    }
  }

  // List fee fields come from the D1-backed list row.  Detail/compare is the
  // only consumer allowed to call the fee endpoint, so this list loader never
  // fans out to /api/fund-fee.
  return { quotes, navSnapshots };
}
