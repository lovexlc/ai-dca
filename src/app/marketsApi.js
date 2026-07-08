// Markets API client. Talks to ai-dca-markets worker mounted at /api/markets/* on api.freebacktrack.tech.

import { apiUrl } from './apiBase.js';
import {
  fetchDirectKline,
  fetchDirectQuotes,
  fetchDanjuanDirectQuotes,
  normalizeDirectSymbol,
  searchDirectSymbols
} from './directMarketData.js';
import { readCachedKline, writeCachedKline } from './marketHistoryCache.js';
import { isKnownQdiiFundCode } from './qdiiFundCodes.js';
import { NASDAQ_OTC_FUND_MAP } from './nasdaqCatalog.js';

export {
  CN_ETF_WATCHLIST_PRESETS,
  CN_OTC_WATCHLIST_PRESETS,
  US_INDICATOR_WATCHLIST_PRESETS,
  normalizeWatchlist,
  loadWatchlist,
  saveWatchlist,
  setActiveWatchlist,
  createWatchlist,
  renameWatchlist,
  deleteWatchlist,
  addToWatchlist,
  removeFromWatchlist,
} from './marketsWatchlistStorage.js';

const _otcCodeSet = new Set(Object.keys(NASDAQ_OTC_FUND_MAP));
function isOtcFundCode(code) {
  const digits = String(code || '').replace(/^(sh|sz|bj)/i, '');
  return _otcCodeSet.has(digits);
}

const DEFAULT_BASE = 'https://api.freebacktrack.tech/api/markets';
const EXCHANGE_PREFIXES = new Set(['15', '50', '51', '52', '56', '58', '53', '54']);
const quotesInflight = new Map();
const klineInflight = new Map();
const fundMetricsInflight = new Map();

function resolveBase() {
  if (typeof window !== 'undefined' && window.__MARKETS_API_BASE__) {
    return String(window.__MARKETS_API_BASE__).replace(/\/$/, '');
  }
  return DEFAULT_BASE;
}

async function getJson(path, { signal } = {}) {
  const url = resolveBase() + path;
  const res = await fetch(url, {
    method: 'GET',
    headers: { accept: 'application/json' },
    signal,
    cache: 'no-store'
  });
  if (!res.ok) {
    throw new Error('markets api GET ' + path + ' HTTP ' + res.status);
  }
  return res.json();
}

async function postJson(path, body, { signal } = {}) {
  const url = resolveBase() + path;
  const res = await fetch(url, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
    signal,
    cache: 'no-store'
  });
  if (!res.ok) {
    throw new Error('markets api POST ' + path + ' HTTP ' + res.status);
  }
  return res.json();
}

export async function fetchMarketsHealth() {
  return getJson('/health');
}

export async function fetchIndices(market, { refresh = false } = {}) {
  const q = refresh ? '&refresh=1' : '';
  return getJson('/indices?market=' + encodeURIComponent(market) + q);
}

export async function fetchSectors(market, { refresh = false } = {}) {
  const q = refresh ? '&refresh=1' : '';
  return getJson('/sectors?market=' + encodeURIComponent(market) + q);
}

export async function fetchQuote(symbol) {
  const batch = await fetchQuotes([symbol]).catch(() => null);
  const quote = batch?.quotes?.[symbol];
  if (quote) return quote;
  const directMeta = normalizeDirectSymbol(symbol);
  if (directMeta) {
    const direct = await fetchDirectQuotes([symbol]).catch(() => null);
    const quote = direct?.quotes?.[symbol];
    if (quote) return quote;
  }
  return getJson('/quote/' + encodeURIComponent(symbol));
}

function normalizeQuoteSymbols(symbols) {
  const rawSymbols = Array.isArray(symbols) ? symbols.map((s) => String(s || '').trim()).filter(Boolean) : [];
  return Array.from(new Set(rawSymbols));
}

function quoteInflightKey(symbols = []) {
  return normalizeQuoteSymbols(symbols).sort().join(',');
}

function klineInflightKey(symbol, { timeframe = '1d', limit = '', minCandles = 0 } = {}) {
  return [
    String(symbol || '').trim(),
    String(timeframe || '1d').trim(),
    String(limit || ''),
    String(minCandles || 0),
  ].join('|');
}

function fundMetricsInflightKey(codes = [], { refresh = false, fundKinds = null } = {}) {
  const list = (Array.isArray(codes) ? codes : [codes])
    .map((code) => String(code || '').trim())
    .filter(Boolean)
    .sort();
  const kindKey = Object.entries(fundKinds || {})
    .map(([code, kind]) => [String(code || '').trim(), String(kind || '').trim()])
    .filter(([code, kind]) => code && kind)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([code, kind]) => `${code}:${kind}`)
    .join(',');
  return `${refresh ? 'refresh' : 'cache'}|${list.join(',')}|${kindKey}`;
}

export async function fetchQuotes(symbols) {
  const rawSymbols = normalizeQuoteSymbols(symbols);
  if (!rawSymbols.length) return { quotes: {} };
  const inflightKey = quoteInflightKey(rawSymbols);
  if (quotesInflight.has(inflightKey)) return quotesInflight.get(inflightKey);
  const promise = fetchQuotesUncached(rawSymbols).finally(() => {
    quotesInflight.delete(inflightKey);
  });
  quotesInflight.set(inflightKey, promise);
  return promise;
}

async function fetchQuotesUncached(rawSymbols) {
  const directable = rawSymbols.filter((symbol) => normalizeDirectSymbol(symbol));
  const otcCodes = rawSymbols
    .filter((symbol) => !normalizeDirectSymbol(symbol))
    .map((s) => s.replace(/^(sh|sz|bj)/i, ''))
    .filter((code) => /^\d{6}$/.test(code) && isOtcFundCode(code));
  const out = {};
  if (directable.length) {
    const direct = await fetchDirectQuotes(directable).catch(() => null);
    Object.assign(out, direct?.quotes || {});
  }
  if (otcCodes.length) {
    const danjuan = await fetchDanjuanDirectQuotes(otcCodes).catch(() => null);
    if (danjuan?.quotes) {
      for (const [code, quote] of Object.entries(danjuan.quotes)) {
        out[code] = quote;
      }
    }
  }
  // OTC 基金只走蛋卷直连，不 fallback 到 Worker
  const missing = rawSymbols.filter((symbol) => {
    const digits = symbol.replace(/^(sh|sz|bj)/i, '');
    if (isOtcFundCode(digits)) return false; // OTC 不走 Worker
    return !out[symbol] && !out[digits];
  });
  if (!missing.length) return { quotes: out, generatedAt: new Date().toISOString(), source: 'direct' };
  const fallbackList = missing.map((s) => encodeURIComponent(s)).join(',');
  const fallback = await getJson('/quotes?symbols=' + fallbackList);
  return { ...fallback, quotes: { ...(fallback.quotes || {}), ...out } };
}

export async function fetchWorkerQuotes(symbols, { signal, hydrateHighPoints = false } = {}) {
  const rawSymbols = normalizeQuoteSymbols(symbols);
  if (!rawSymbols.length) return { quotes: {} };
  const params = new URLSearchParams();
  params.set('symbols', rawSymbols.join(','));
  if (hydrateHighPoints) params.set('hydrateHighPoints', '1');
  return getJson('/quotes?' + params.toString(), { signal });
}

export async function searchSymbols(market, query, { limit = 8, signal } = {}) {
  const q = String(query || '').trim();
  if (!q) return { results: [] };
  const normalizedMarket = String(market || '').trim().toLowerCase();
  if (normalizedMarket === 'cn' || normalizedMarket === 'us') {
    const direct = await searchDirectSymbols(normalizedMarket, q, { limit, signal }).catch(() => null);
    if (Array.isArray(direct?.results) && direct.results.length) return direct;
  }
  return getJson('/search?market=' + encodeURIComponent(market) + '&q=' + encodeURIComponent(q) + '&limit=' + encodeURIComponent(limit), { signal });
}

export async function fetchKline(symbol, { timeframe = '1d', limit = '', minCandles = 0 } = {}) {
  const inflightKey = klineInflightKey(symbol, { timeframe, limit, minCandles });
  if (klineInflight.has(inflightKey)) return klineInflight.get(inflightKey);
  const promise = fetchKlineUncached(symbol, { timeframe, limit, minCandles }).finally(() => {
    klineInflight.delete(inflightKey);
  });
  klineInflight.set(inflightKey, promise);
  return promise;
}

async function fetchKlineUncached(symbol, { timeframe = '1d', limit = '', minCandles = 0 } = {}) {
  const params = new URLSearchParams({ tf: timeframe });
  if (limit) params.set('limit', String(limit));
  const requestedLimit = Number(limit);
  const requiredCandles = Number(minCandles) || (Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 900) : 0);
  const cachedLocal = await readCachedKline({ symbol, timeframe, minCandles: requiredCandles }).catch(() => null);
  if (cachedLocal?.candles?.length) return sliceKlinePayload(cachedLocal, limit);
  const direct = await fetchDirectKline(symbol, { timeframe, limit }).catch(() => null);
  if (direct?.candles?.length) {
    writeCachedKline({ symbol, timeframe, payload: direct }).catch(() => {});
    return direct;
  }
  const live = await getJson('/kline/' + encodeURIComponent(symbol) + '?' + params.toString());
  if (live?.candles?.length) writeCachedKline({ symbol, timeframe, payload: live }).catch(() => {});
  return live;
}

function sliceKlinePayload(payload, limit = '') {
  const requestedLimit = Number(limit);
  if (!Number.isFinite(requestedLimit) || requestedLimit <= 0 || !Array.isArray(payload?.candles)) return payload;
  return { ...payload, candles: payload.candles.slice(-requestedLimit) };
}

export async function fetchMovers(market, { direction = 'mixed', refresh = false } = {}) {
  const q = refresh ? '&refresh=1' : '';
  return getJson('/movers?market=' + encodeURIComponent(market) + '&direction=' + encodeURIComponent(direction) + q);
}

export async function fetchSummary(market, { refresh = false } = {}) {
  const q = refresh ? '&refresh=1' : '';
  return getJson('/summary?market=' + encodeURIComponent(market) + q);
}

export async function fetchNews(market, { refresh = false } = {}) {
  const q = refresh ? '&refresh=1' : '';
  return getJson('/news?market=' + encodeURIComponent(market) + q);
}

export async function fetchEarnings(market, { refresh = false } = {}) {
  const q = refresh ? '&refresh=1' : '';
  return getJson('/earnings?market=' + encodeURIComponent(market) + q);
}


export async function fetchFinancials(symbol, { refresh = false } = {}) {
  const q = refresh ? '?refresh=1' : '';
  return getJson('/financials/' + encodeURIComponent(symbol) + q);
}

export async function fetchXueqiuFundData(symbol, { refresh = false, raw = false } = {}) {
  const params = [];
  if (refresh) params.push('refresh=1');
  if (raw) params.push('raw=1');
  const q = params.length ? '?' + params.join('&') : '';
  return getJson('/xueqiu-fund-data/' + encodeURIComponent(symbol) + q);
}

export async function fetchFundMetrics(codes, { refresh = false, signal, fundKinds: callerFundKinds = null } = {}) {
  const list = (Array.isArray(codes) ? codes : [codes])
    .map((code) => String(code || '').trim())
    .filter(Boolean);
  if (!list.length) {
    return { items: [], successCount: 0, failureCount: 0, generatedAt: '', tradingSession: false, cachePolicy: '' };
  }
  if (!signal) {
    const inflightKey = fundMetricsInflightKey(list, { refresh, fundKinds: callerFundKinds });
    if (fundMetricsInflight.has(inflightKey)) return fundMetricsInflight.get(inflightKey);
    const promise = fetchFundMetricsUncached(list, { refresh, fundKinds: callerFundKinds }).finally(() => {
      fundMetricsInflight.delete(inflightKey);
    });
    fundMetricsInflight.set(inflightKey, promise);
    return promise;
  }
  return fetchFundMetricsUncached(list, { refresh, signal, fundKinds: callerFundKinds });
}

async function fetchFundMetricsUncached(list, { refresh = false, signal, fundKinds: callerFundKinds = null } = {}) {
  const fundKinds = Object.fromEntries(list.map((code) => {
    const normalized = normalizeCodeForKind(code);
    const callerKind = callerFundKinds?.[normalized] || callerFundKinds?.[code];
    if (callerKind === 'exchange' || callerKind === 'qdii' || callerKind === 'otc') {
      return [normalized, callerKind];
    }
    if (/^\d{6}$/.test(normalized) && EXCHANGE_PREFIXES.has(normalized.slice(0, 2))) return [normalized, 'exchange'];
    return [normalized, isKnownQdiiFundCode(normalized) ? 'qdii' : 'otc'];
  }));
  return postJson('/fund-metrics' + (refresh ? '?refresh=1' : ''), { codes: list, refresh, fundKinds }, { signal });
}

function normalizeCodeForKind(code = '') {
  const digits = String(code || '').replace(/^(sh|sz|bj)/i, '').replace(/\D/g, '');
  return digits.length === 6 ? digits : code;
}

export async function fetchFundFees(codes, { refresh = false, signal } = {}) {
  const list = Array.isArray(codes) ? codes.map((code) => String(code || '').trim()).filter(Boolean) : [];
  if (!list.length) return { items: [], successCount: 0, failureCount: 0 };
  return fetch(apiUrl('/api/fund-fee' + (refresh ? '?refresh=1' : '')), {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ codes: list }),
    signal,
    cache: 'no-store'
  }).then((res) => {
    if (!res.ok) throw new Error('fund fee api HTTP ' + res.status);
    return res.json();
  });
}

export async function fetchProfile(symbol) {
  return getJson('/profile/' + encodeURIComponent(symbol));
}

export const __internals = {
  quoteInflightKey,
  klineInflightKey,
  fundMetricsInflightKey,
  normalizeQuoteSymbols,
  clearMarketsApiInflight() {
    quotesInflight.clear();
    klineInflight.clear();
    fundMetricsInflight.clear();
  },
  inflightSizes() {
    return { quotes: quotesInflight.size, kline: klineInflight.size, fundMetrics: fundMetricsInflight.size };
  }
};
