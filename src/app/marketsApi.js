// Markets API client. Talks to ai-dca-markets worker mounted at /api/markets/* on api.freebacktrack.tech.

import { apiUrl } from './apiBase.js';
import { isCnUnambiguousExchangeFundCode } from './cnFundVenue.js';
import { readCachedKline, writeCachedKline } from './marketHistoryCache.js';
import { isKnownQdiiFundCode } from './qdiiFundCodes.js';

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

const DEFAULT_BASE = 'https://api.freebacktrack.tech/api/markets';
const quotesInflight = new Map();
const klineInflight = new Map();
const fundMetricsInflight = new Map();

function resolveBase() {
  if (typeof window !== 'undefined' && window.__MARKETS_API_BASE__) {
    return String(window.__MARKETS_API_BASE__).replace(/\/$/, '');
  }
  if (String((import.meta.env || {}).VITE_API_ORIGIN || '').trim()) {
    return apiUrl('/api/markets').replace(/\/$/, '');
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

/**
 * SQL-style list page: ORDER BY + LIMIT (+ cursor) over a symbol universe.
 * OTC lists use the D1 snapshot ORDER BY path; exchange/US callers keep their
 * existing quote-cache path until a matching SQL snapshot exists.
 */
export async function fetchListRows(body, { signal } = {}) {
  return postJson('/list-rows', body || {}, { signal });
}

function exchangeFundQueryParams({
  symbols = [],
  heldSymbols = [],
  orderBy = [],
  sortBy = '',
  order = '',
  query = '',
  heldOnly = false,
  limit = 100,
  offset = 0,
} = {}) {
  const params = new URLSearchParams();
  const unique = (values) => Array.from(new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  ));
  const requestedSymbols = unique(symbols);
  const requestedHeldSymbols = unique(heldSymbols);
  if (requestedSymbols.length) params.set('symbols', requestedSymbols.join(','));
  if (requestedHeldSymbols.length) params.set('heldSymbols', requestedHeldSymbols.join(','));
  if (Array.isArray(orderBy) && orderBy.length) params.set('orderBy', JSON.stringify(orderBy));
  if (sortBy) params.set('sortBy', String(sortBy));
  if (order) params.set('order', String(order));
  if (String(query || '').trim()) params.set('q', String(query).trim());
  if (heldOnly) params.set('heldOnly', '1');
  if (limit != null) params.set('limit', String(limit));
  if (offset != null) params.set('offset', String(offset));
  return params;
}

export async function fetchExchangeFundList(options = {}, { signal } = {}) {
  const params = exchangeFundQueryParams(options);
  return getJson('/exchange-fund-list?' + params.toString(), { signal });
}

export function getExchangeFundWebSocketUrl(options = {}) {
  const base = resolveBase() + '/exchange-fund-list';
  const origin = typeof globalThis.location?.origin === 'string' ? globalThis.location.origin : 'http://localhost';
  const url = new URL(base, origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const params = exchangeFundQueryParams(options);
  ['orderBy', 'sortBy', 'order', 'query', 'heldOnly', 'limit', 'offset'].forEach((key) => params.delete(key));
  if (params.toString()) url.search = params.toString();
  return url.toString();
}


export async function fetchIndices(market, { refresh = false } = {}) {
  const q = refresh ? '&refresh=1' : '';
  return getJson('/indices?market=' + encodeURIComponent(market) + q);
}

export async function fetchTacoSentiment({ signal } = {}) {
  return getJson('/taco', { signal });
}

export async function fetchSectors(market, { refresh = false } = {}) {
  const q = refresh ? '&refresh=1' : '';
  return getJson('/sectors?market=' + encodeURIComponent(market) + q);
}

export async function fetchQuote(symbol, { market = '' } = {}) {
  const batch = await fetchQuotes([symbol]).catch(() => null);
  const quote = batch?.quotes?.[symbol];
  if (quote) return quote;
  const suffix = market ? '?market=' + encodeURIComponent(market) : '';
  return getJson('/quote/' + encodeURIComponent(symbol) + suffix);
}

function normalizeQuoteSymbols(symbols) {
  const rawSymbols = Array.isArray(symbols) ? symbols.map((s) => String(s || '').trim()).filter(Boolean) : [];
  return Array.from(new Set(rawSymbols));
}

function quoteInflightKey(symbols = []) {
  return normalizeQuoteSymbols(symbols).sort().join(',');
}

function klineInflightKey(symbol, { timeframe = '1d', limit = '', minCandles = 0, market = '', session = '', includeR2 = false, startDate = '', endDate = '' } = {}) {
  const parts = [
    String(symbol || '').trim(),
    String(market || '').trim().toLowerCase(),
    String(timeframe || '1d').trim(),
    String(limit || ''),
    String(minCandles || 0),
    String(session || '').trim(),
    includeR2 ? 'r2' : '',
    String(startDate || '').trim(),
    String(endDate || '').trim(),
  ];
  while (parts.length > 6 && !parts[parts.length - 1]) parts.pop();
  return parts.join('|');
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

export async function fetchQuotes(symbols, { signal } = {}) {
  const rawSymbols = normalizeQuoteSymbols(symbols);
  if (!rawSymbols.length) return { quotes: {} };
  const inflightKey = quoteInflightKey(rawSymbols);
  if (quotesInflight.has(inflightKey)) return quotesInflight.get(inflightKey);
  const promise = fetchQuotesUncached(rawSymbols, { signal }).finally(() => {
    quotesInflight.delete(inflightKey);
  });
  quotesInflight.set(inflightKey, promise);
  return promise;
}

async function fetchQuotesUncached(rawSymbols, { signal } = {}) {
  return fetchWorkerQuotes(rawSymbols, { signal });
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
  return getJson('/search?market=' + encodeURIComponent(market) + '&q=' + encodeURIComponent(q) + '&limit=' + encodeURIComponent(limit), { signal });
}

export async function fetchKline(symbol, { timeframe = '1d', limit = '', minCandles = 0, market = '', session = '', includeR2 = false, startDate = '', endDate = '' } = {}) {
  const inflightKey = klineInflightKey(symbol, { timeframe, limit, minCandles, market, session, includeR2, startDate, endDate });
  if (klineInflight.has(inflightKey)) return klineInflight.get(inflightKey);
  const promise = fetchKlineUncached(symbol, { timeframe, limit, minCandles, market, session, includeR2, startDate, endDate }).finally(() => {
    klineInflight.delete(inflightKey);
  });
  klineInflight.set(inflightKey, promise);
  return promise;
}

async function fetchKlineUncached(symbol, { timeframe = '1d', limit = '', minCandles = 0, market = '', session = '', includeR2 = false, startDate = '', endDate = '' } = {}) {
  const params = new URLSearchParams({ tf: timeframe });
  if (limit) params.set('limit', String(limit));
  if (market) params.set('market', String(market));
  if (session) params.set('session', String(session));
  if (includeR2) params.set('includeR2', '1');
  const requestedLimit = Number(limit);
  const requiredCandles = Number(minCandles) || (Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 900) : 0);
  const cacheTimeframe = session ? `${timeframe}|session=${session}` : timeframe;
  const cachedLocal = await readCachedKline({ symbol, timeframe: cacheTimeframe, minCandles: requiredCandles, startDate, endDate }).catch(() => null);
  if (cachedLocal?.candles?.length) return sliceKlinePayload(cachedLocal, limit);
  const live = await getJson('/kline/' + encodeURIComponent(symbol) + '?' + params.toString());
  if (live?.candles?.length) writeCachedKline({ symbol, timeframe: cacheTimeframe, payload: live }).catch(() => {});
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

export async function fetchMarketSummary(region = 'US', { refresh = false, signal } = {}) {
  const params = new URLSearchParams();
  params.set('region', region || 'US');
  if (refresh) params.set('refresh', '1');
  return getJson('/market-summary?' + params.toString(), { signal });
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
    if (isCnUnambiguousExchangeFundCode(normalized)) return [normalized, 'exchange'];
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
