import { normalizeCnFundCode } from './marketDisplayUtils.js';

const OTC_WATCH_CACHE_KEY = 'markets:otc-watch-cache:v1';

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

function nextShanghaiCloseIso(date = new Date()) {
  const parts = shanghaiParts(date);
  const afterClose = parts.hour > 15 || (parts.hour === 15 && parts.minute >= 30);
  return shanghaiLocalIso(parts, 15, 30, afterClose ? 1 : 0);
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

export async function loadWatchQuotesWithEnhancements({
  symbols,
  market,
  fetchQuotes,
  getNavSnapshots,
  fetchFundFees,
  buildOtcFundQuoteFromSnapshot,
  hasNasdaqOtcFund,
}) {
  const list = Array.isArray(symbols) ? symbols : [];
  const otcCodes = market === 'cn'
    ? uniqueCodes(list.map((sym) => normalizeCnFundCode(sym)).filter(hasNasdaqOtcFund))
    : [];
  const nonCachedQuoteSymbols = market === 'cn'
    ? list.filter((sym) => !hasNasdaqOtcFund(normalizeCnFundCode(sym)))
    : list;
  const quotePayload = nonCachedQuoteSymbols.length ? await fetchQuotes(nonCachedQuoteSymbols) : { quotes: {} };
  const quotes = { ...(quotePayload.quotes || {}) };
  const navSnapshots = {};
  const fundFees = {};

  if (market !== 'cn') {
    return { quotes, navSnapshots, fundFees };
  }

  if (otcCodes.length) {
    const cached = readCachedItems('navSnapshot', otcCodes);
    Object.assign(navSnapshots, cached.dataByCode);
    try {
      const snapshotsPayload = cached.missing.length ? await getNavSnapshots(cached.missing) : { items: [] };
      const freshSnapshots = {};
      (snapshotsPayload.items || []).forEach((item) => {
        const code = normalizeCnFundCode(item?.code);
        if (code) {
          navSnapshots[code] = item;
          freshSnapshots[code] = item;
        }
      });
      if (Object.keys(freshSnapshots).length) {
        writeCachedItems('navSnapshot', freshSnapshots, nextShanghaiCloseIso());
      }
      otcCodes.forEach((code) => {
        const existing = quotes[code] || quotes[`SZ${code}`] || quotes[`SH${code}`] || {};
        const quote = buildOtcFundQuoteFromSnapshot(code, navSnapshots[code], existing);
        if (quote) quotes[code] = quote;
      });
    } catch {
      // 场外基金净值是增强信息，失败时仍展示行情源返回的结果。
    }
  }

  const feeCodes = uniqueCodes(list.map((sym) => normalizeCnFundCode(sym)).filter((code) => /^\d{6}$/.test(code)));
  if (feeCodes.length) {
    const cached = readCachedItems('fundFee', feeCodes);
    Object.assign(fundFees, cached.dataByCode);
    try {
      const feePayload = cached.missing.length ? await fetchFundFees(cached.missing) : { items: [] };
      const freshFees = {};
      (feePayload.items || []).forEach((item) => {
        const code = normalizeCnFundCode(item?.data?.code);
        if (item?.ok && code) {
          fundFees[code] = item.data;
          freshFees[code] = item.data;
        }
      });
      if (Object.keys(freshFees).length) {
        writeCachedItems('fundFee', freshFees, nextShanghaiDayIso());
      }
    } catch {
      // 费率是增强信息，失败时保留行情与本地 fallback。
    }
  }

  return { quotes, navSnapshots, fundFees };
}
