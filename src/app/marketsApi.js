// Markets API client. Talks to ai-dca-markets worker mounted at /api/markets/* on api.freebacktrack.tech.

import { apiUrl } from './apiBase.js';
import {
  fetchDirectKline,
  fetchDirectQuotes,
  normalizeDirectSymbol
} from './directMarketData.js';
import { readCachedKline, writeCachedKline } from './marketHistoryCache.js';
import { isKnownQdiiFundCode } from './qdiiFundCodes.js';
import {
  readRedisFundMetrics,
  readRedisKline,
  readRedisQuote,
  readRedisQuotes,
  readRedisSimplePayload
} from './marketsRedisClient.js';

const DEFAULT_BASE = 'https://api.freebacktrack.tech/api/markets';
const EXCHANGE_PREFIXES = new Set(['15', '50', '51', '52', '56', '58', '53', '54']);

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
  if (!refresh) {
    const cached = await readRedisSimplePayload(
      'indices:' + encodeCachePart(market),
      (payload) => Array.isArray(payload?.indexes) && payload.indexes.length
    ).catch(() => null);
    if (cached) return cached;
  }
  return getJson('/indices?market=' + encodeURIComponent(market) + q);
}

export async function fetchSectors(market, { refresh = false } = {}) {
  const q = refresh ? '&refresh=1' : '';
  if (!refresh) {
    const cached = await readRedisSimplePayload(
      'sectors:' + encodeCachePart(market),
      (payload) => Array.isArray(payload?.sectors) && payload.sectors.length
    ).catch(() => null);
    if (cached) return cached;
  }
  return getJson('/sectors?market=' + encodeURIComponent(market) + q);
}

export async function fetchQuote(symbol) {
  const directMeta = normalizeDirectSymbol(symbol);
  if (directMeta) {
    const direct = await fetchDirectQuotes([symbol]).catch(() => null);
    const quote = direct?.quotes?.[symbol];
    if (quote) return quote;
  }
  const cached = await readRedisQuote(symbol).catch(() => null);
  if (cached) return cached;
  return getJson('/quote/' + encodeURIComponent(symbol));
}

export async function fetchQuotes(symbols) {
  const rawSymbols = Array.isArray(symbols) ? symbols.map((s) => String(s || '').trim()).filter(Boolean) : [];
  if (!rawSymbols.length) return { quotes: {} };
  const directable = rawSymbols.filter((symbol) => normalizeDirectSymbol(symbol));
  const out = {};
  if (directable.length) {
    const direct = await fetchDirectQuotes(directable).catch(() => null);
    Object.assign(out, direct?.quotes || {});
  }
  const missing = rawSymbols.filter((symbol) => !out[symbol]);
  if (!missing.length) return { quotes: out, generatedAt: new Date().toISOString(), source: 'direct' };
  const cached = await readRedisQuotes(symbols).catch(() => null);
  if (cached) return { ...cached, quotes: { ...(cached.quotes || {}), ...out } };
  const fallbackList = missing.map((s) => encodeURIComponent(s)).join(',');
  const fallback = await getJson('/quotes?symbols=' + fallbackList);
  return { ...fallback, quotes: { ...(fallback.quotes || {}), ...out } };
}

export async function fetchWorkerQuotes(symbols, { signal } = {}) {
  const rawSymbols = Array.isArray(symbols) ? symbols.map((s) => String(s || '').trim()).filter(Boolean) : [];
  if (!rawSymbols.length) return { quotes: {} };
  const list = rawSymbols.map((s) => encodeURIComponent(s)).join(',');
  return getJson('/quotes?symbols=' + list, { signal });
}

export async function searchSymbols(market, query, { limit = 8, signal } = {}) {
  const q = String(query || '').trim();
  if (!q) return { results: [] };
  const cached = await readRedisSimplePayload(
    'search:' + encodeCachePart(market) + ':' + q.toLowerCase() + ':' + limit,
    (payload) => Array.isArray(payload?.results),
    { signal }
  ).catch(() => null);
  if (cached) return cached;
  return getJson('/search?market=' + encodeURIComponent(market) + '&q=' + encodeURIComponent(q) + '&limit=' + encodeURIComponent(limit), { signal });
}

export async function fetchKline(symbol, { timeframe = '1d', limit = '', minCandles = 0 } = {}) {
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
  const cached = await readRedisKline(symbol, { timeframe, limit }).catch(() => null);
  if (cached) {
    if (cached?.candles?.length) writeCachedKline({ symbol, timeframe, payload: cached }).catch(() => {});
    return cached;
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
  if (!refresh) {
    const cached = await readRedisSimplePayload(
      'movers:' + encodeCachePart(market) + ':' + encodeCachePart(direction),
      (payload) => Array.isArray(payload?.list)
    ).catch(() => null);
    if (cached) return cached;
  }
  return getJson('/movers?market=' + encodeURIComponent(market) + '&direction=' + encodeURIComponent(direction) + q);
}

export async function fetchSummary(market, { refresh = false } = {}) {
  const q = refresh ? '&refresh=1' : '';
  if (!refresh) {
    const cached = await readRedisSimplePayload(
      'summary:' + encodeCachePart(market),
      (payload) => Array.isArray(payload?.themes)
    ).catch(() => null);
    if (cached) return cached;
  }
  return getJson('/summary?market=' + encodeURIComponent(market) + q);
}

export async function fetchNews(market, { refresh = false } = {}) {
  const q = refresh ? '&refresh=1' : '';
  if (!refresh) {
    const cached = await readRedisSimplePayload(
      'news:' + encodeCachePart(market),
      (payload) => Array.isArray(payload?.items)
    ).catch(() => null);
    if (cached) return cached;
  }
  return getJson('/news?market=' + encodeURIComponent(market) + q);
}

export async function fetchEarnings(market, { refresh = false } = {}) {
  const q = refresh ? '&refresh=1' : '';
  if (!refresh) {
    const cached = await readRedisSimplePayload(
      'earnings:' + encodeCachePart(market),
      (payload) => Array.isArray(payload?.items)
    ).catch(() => null);
    if (cached) return cached;
  }
  return getJson('/earnings?market=' + encodeURIComponent(market) + q);
}


export async function fetchFinancials(symbol, { refresh = false } = {}) {
  const q = refresh ? '?refresh=1' : '';
  if (!refresh) {
    const cached = await readRedisSimplePayload(
      'financials:us:' + String(symbol || '').trim().toUpperCase(),
      (payload) => Boolean(payload?.statements)
    ).catch(() => null);
    if (cached) return cached;
  }
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
  const fundKinds = Object.fromEntries(list.map((code) => {
    const normalized = normalizeCodeForKind(code);
    const callerKind = callerFundKinds?.[normalized] || callerFundKinds?.[code];
    if (callerKind === 'exchange' || callerKind === 'qdii' || callerKind === 'otc') {
      return [normalized, callerKind];
    }
    if (/^\d{6}$/.test(normalized) && EXCHANGE_PREFIXES.has(normalized.slice(0, 2))) return [normalized, 'exchange'];
    return [normalized, isKnownQdiiFundCode(normalized) ? 'qdii' : 'otc'];
  }));
  if (!refresh) {
    const cached = await readRedisFundMetrics(list, { signal }).catch(() => null);
    if (cached) return cached;
  }
  return postJson('/fund-metrics' + (refresh ? '?refresh=1' : ''), { codes: list, refresh, fundKinds }, { signal });
}

function normalizeCodeForKind(code = '') {
  const digits = String(code || '').replace(/^(sh|sz|bj)/i, '').replace(/\D/g, '');
  return digits.length === 6 ? digits : code;
}

function encodeCachePart(value = '') {
  return String(value || '').trim().toLowerCase();
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
  const cached = await readRedisSimplePayload(
    'profile:us:' + String(symbol || '').trim().toUpperCase(),
    (payload) => Boolean(payload?.profile)
  ).catch(() => null);
  if (cached) return cached;
  return getJson('/profile/' + encodeURIComponent(symbol));
}

// Watchlist (localStorage). Stored per market for convenience.
const WATCHLIST_KEY = 'markets:watchlist:v1';
const WATCHLIST_ETF_DEFAULTS_VERSION = 7;
const WATCHLIST_OTC_DEFAULTS_VERSION = 5;
const WATCHLIST_INDICATOR_DEFAULTS_VERSION = 8;
const WATCHLIST_DEFAULTS_VERSION = Math.max(WATCHLIST_ETF_DEFAULTS_VERSION, WATCHLIST_OTC_DEFAULTS_VERSION, WATCHLIST_INDICATOR_DEFAULTS_VERSION);
const DEFAULT_WATCHLIST_ID = 'default';
const DEFAULT_OTC_LIST_ID = 'default-otc';
const DEFAULT_INDICATOR_LIST_ID = 'default-indicators';
const REMOVED_US_INDICATOR_SYMBOLS = new Set(['NYAD_LINE', 'NAAD_LINE']);

export const CN_ETF_WATCHLIST_PRESETS = [
  // 用户指定的默认 A 股监控列表（以代码覆盖）
  { symbol: '513870', name: '纳指ETF 富国', exchange: '上交所', currency: 'CNY' },
  { symbol: '513390', name: '纳指100ETF 博时', exchange: '上交所', currency: 'CNY' },
  { symbol: '513300', name: '纳斯达克ETF 华夏', exchange: '上交所', currency: 'CNY' },
  { symbol: '513110', name: '纳指ETF 华泰柏瑞', exchange: '上交所', currency: 'CNY' },
  { symbol: '513100', name: '纳指ETF 国泰', exchange: '上交所', currency: 'CNY' },
  { symbol: '159941', name: '纳指ETF 广发', exchange: '深交所', currency: 'CNY' },
  { symbol: '159696', name: '纳指ETF 易方达', exchange: '深交所', currency: 'CNY' },
  { symbol: '159660', name: '纳指ETF 汇添富', exchange: '深交所', currency: 'CNY' },
  { symbol: '159659', name: '纳斯达克100ETF 招商', exchange: '深交所', currency: 'CNY' },
  { symbol: '159632', name: '纳斯达克ETF 华安', exchange: '深交所', currency: 'CNY' },
  { symbol: '159513', name: '纳斯达克100ETF 大成', exchange: '深交所', currency: 'CNY' },
  { symbol: '159509', name: '纳指科技ETF 景顺', exchange: '深交所', currency: 'CNY' },
  { symbol: '159501', name: '纳指ETF 嘉实', exchange: '深交所', currency: 'CNY' },
  { symbol: '159577', name: '美国50ETF 汇添富', exchange: '深交所', currency: 'CNY' },
  { symbol: '161128', name: '标普信息科技LOF', exchange: '深交所', currency: 'CNY' },
  { symbol: '161130', name: '纳斯达克100LOF', exchange: '深交所', currency: 'CNY' },
  { symbol: '513500', name: '标普500ETF 博时', exchange: '深交所', currency: 'CNY' },
  { symbol: '513650', name: '标普500ETF 南方', exchange: '深交所', currency: 'CNY' },
  { symbol: '159612', name: '标普500ETF 国泰', exchange: '深交所', currency: 'CNY' },
];

const DEFAULT_CN_WATCHLIST = CN_ETF_WATCHLIST_PRESETS.map((item) => item.symbol);

// 默认场外基金列表：纳指 100 场外全集 + 标普 500 场外全集，包含基金公司自有 F/I/E 类、C 类和美元份额。
export const CN_OTC_WATCHLIST_PRESETS = [
  { symbol: '000834', name: '大成纳斯达克100ETF联接(QDII)A' },
  { symbol: '008971', name: '大成纳斯达克100ETF联接(QDII)C' },
  { symbol: '270042', name: '广发纳指100ETF联接(QDII)人民币A' },
  { symbol: '006479', name: '广发纳指100ETF联接(QDII)人民币C' },
  { symbol: '000055', name: '广发纳指100ETF联接(QDII)美元A' },
  { symbol: '006480', name: '广发纳指100ETF联接(QDII)美元C' },
  { symbol: '021778', name: '广发纳指100ETF联接(QDII)人民币F' },
  { symbol: '161130', name: '易方达纳斯达克100ETF联接(QDII-LOF)A人民币' },
  { symbol: '012870', name: '易方达纳斯达克100ETF联接(QDII-LOF)C人民币' },
  { symbol: '003722', name: '易方达纳斯达克100ETF联接(QDII-LOF)A美元现汇' },
  { symbol: '040046', name: '华安纳斯达克100ETF联接(QDII)A' },
  { symbol: '014978', name: '华安纳斯达克100ETF联接(QDII)C' },
  { symbol: '016055', name: '博时纳斯达克100ETF发起式联接(QDII)A人民币' },
  { symbol: '016057', name: '博时纳斯达克100ETF发起式联接(QDII)C人民币' },
  { symbol: '016056', name: '博时纳斯达克100ETF发起式联接(QDII)A美元' },
  { symbol: '016058', name: '博时纳斯达克100ETF发起式联接(QDII)C美元' },
  { symbol: '015299', name: '华夏纳斯达克100ETF发起式联接(QDII)A' },
  { symbol: '015300', name: '华夏纳斯达克100ETF发起式联接(QDII)C' },
  { symbol: '016532', name: '嘉实纳斯达克100ETF发起联接(QDII)A人民币' },
  { symbol: '016533', name: '嘉实纳斯达克100ETF发起联接(QDII)C人民币' },
  { symbol: '016534', name: '嘉实纳斯达克100ETF发起联接(QDII)A美元现汇' },
  { symbol: '016535', name: '嘉实纳斯达克100ETF发起联接(QDII)C美元现汇' },
  { symbol: '021838', name: '嘉实纳斯达克100ETF发起联接(QDII)I人民币' },
  { symbol: '018966', name: '汇添富纳斯达克100ETF发起式联接(QDII)人民币A' },
  { symbol: '018967', name: '汇添富纳斯达克100ETF发起式联接(QDII)人民币C' },
  { symbol: '019524', name: '华泰柏瑞纳斯达克100ETF发起式联接(QDII)A' },
  { symbol: '019525', name: '华泰柏瑞纳斯达克100ETF发起式联接(QDII)C' },
  { symbol: '019547', name: '招商纳斯达克100ETF发起式联接(QDII)A' },
  { symbol: '019548', name: '招商纳斯达克100ETF发起式联接(QDII)C' },
  { symbol: '160213', name: '国泰纳斯达克100指数(QDII)' },
  { symbol: '019172', name: '摩根纳斯达克100指数(QDII)人民币A' },
  { symbol: '019173', name: '摩根纳斯达克100指数(QDII)人民币C' },
  { symbol: '019174', name: '摩根纳斯达克100指数(QDII)美元A' },
  { symbol: '019736', name: '宝盈纳斯达克100指数发起(QDII)A人民币' },
  { symbol: '019737', name: '宝盈纳斯达克100指数发起(QDII)C人民币' },
  { symbol: '021000', name: '南方纳斯达克100指数发起(QDII)I人民币' },
  { symbol: '017641', name: '摩根标普500指数(QDII)人民币A' },
  { symbol: '019305', name: '摩根标普500指数(QDII)人民币C' },
  { symbol: '017028', name: '国泰标普500ETF发起联接(QDII)A人民币' },
  { symbol: '017030', name: '国泰标普500ETF发起联接(QDII)C人民币' },
  { symbol: '018064', name: '华夏标普500ETF发起式联接(QDII)A人民币' },
  { symbol: '018065', name: '华夏标普500ETF发起式联接(QDII)C人民币' },
  { symbol: '050025', name: '博时标普500ETF联接(QDII)A人民币' },
  { symbol: '006075', name: '博时标普500ETF联接(QDII)C人民币' },
  { symbol: '018738', name: '博时标普500ETF联接(QDII)E人民币' },
  { symbol: '007721', name: '天弘标普500发起(QDII-FOF)A' },
  { symbol: '007722', name: '天弘标普500发起(QDII-FOF)C' },
  { symbol: '022523', name: '易方达标普500指数(QDII-LOF)A人民币' },
  { symbol: '012860', name: '易方达标普500指数(QDII-LOF)C人民币' },
];

const DEFAULT_CN_OTC_WATCHLIST = CN_OTC_WATCHLIST_PRESETS.map((item) => item.symbol);

export const US_INDICATOR_WATCHLIST_PRESETS = [
  { symbol: '^VIX', name: 'VIX 波动率指数', source: 'Cboe / Yahoo Finance' },
  { symbol: 'CNN_FNG', name: 'CNN Fear & Greed Index', source: 'CNN' },
  { symbol: 'CBOE_PCR', name: 'Put/Call Ratio', source: 'Cboe' },
  { symbol: 'SP500_PE', name: 'S&P 500 P/E Ratio', source: 'Multpl / Robert Shiller data' },
  { symbol: 'QQQ_PE', name: 'QQQ P/E Ratio', source: 'StockAnalysis / Macrotrends' },
  { symbol: 'CPIAUCSL', name: 'CPI', source: 'FRED' },
];

function sanitizeDefaultIndicatorSymbols(symbols = []) {
  const next = [];
  const seen = new Set();
  for (const symbol of symbols) {
    const normalized = String(symbol || '').trim();
    if (!normalized || REMOVED_US_INDICATOR_SYMBOLS.has(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    next.push(normalized);
  }
  return next;
}

const DEFAULT_US_INDICATOR_WATCHLIST = sanitizeDefaultIndicatorSymbols(US_INDICATOR_WATCHLIST_PRESETS.map((item) => item.symbol));

export function normalizeWatchlist(value = {}) {
  const now = new Date().toISOString();
  const rawUs = Array.isArray(value.us) ? value.us : [];
  const rawCn = Array.isArray(value.cn) ? value.cn : [];
  const version = Number(value.defaultsVersion) || 0;
  const hasCnDefaults = version >= WATCHLIST_ETF_DEFAULTS_VERSION;
  const hasOtcDefaults = version >= WATCHLIST_OTC_DEFAULTS_VERSION;
  const hasIndicatorDefaults = version >= WATCHLIST_INDICATOR_DEFAULTS_VERSION;
  const cn = hasCnDefaults
    ? rawCn
    : Array.from(new Set([...DEFAULT_CN_WATCHLIST, ...rawCn]));
  const seedList = {
    id: DEFAULT_WATCHLIST_ID,
    name: '默认-场内基金',
    type: 'cn_etf',
    us: rawUs,
    cn,
    createdAt: value.createdAt || now,
    updatedAt: value.updatedAt || now,
  };
  const otcSeedList = {
    id: DEFAULT_OTC_LIST_ID,
    name: '默认-场外基金',
    type: 'cn_otc',
    us: [],
    cn: [...DEFAULT_CN_OTC_WATCHLIST],
    createdAt: now,
    updatedAt: now,
  };
  const indicatorSeedList = {
    id: DEFAULT_INDICATOR_LIST_ID,
    name: '默认-常用指标',
    type: 'us_indicator',
    us: [...DEFAULT_US_INDICATOR_WATCHLIST],
    cn: [],
    createdAt: now,
    updatedAt: now,
  };
  const rawLists = Array.isArray(value.lists) ? value.lists : [];
  let lists = rawLists.length
    ? rawLists.map((item, index) => ({
      id: String(item.id || (index === 0 ? DEFAULT_WATCHLIST_ID : `list-${index + 1}`)),
      name: String(item.name || (index === 0 ? '默认-场内基金' : `列表 ${index + 1}`)),
      type: item.type || undefined,
      us: Array.isArray(item.us) ? item.us : [],
      cn: Array.isArray(item.cn) ? item.cn : [],
      createdAt: item.createdAt || now,
      updatedAt: item.updatedAt || now,
    }))
    : [seedList];
  // 迁移：确保默认列表命名正确 + 场外基金/常用指标列表始终存在。
  {
    const defaultIdx = lists.findIndex((item) => item.id === DEFAULT_WATCHLIST_ID);
    if (defaultIdx >= 0) {
      const old = lists[defaultIdx];
      if (old.name !== '默认-场内基金' || old.type !== 'cn_etf' || !hasCnDefaults) {
        lists[defaultIdx] = {
          ...old,
          name: '默认-场内基金',
          type: 'cn_etf',
          cn: hasCnDefaults ? (old.cn || []) : Array.from(new Set([...DEFAULT_CN_WATCHLIST, ...(old.cn || [])])),
        };
      }
    }
    if (!lists.some((item) => item.id === DEFAULT_OTC_LIST_ID)) {
      const afterDefault = lists.findIndex((item) => item.id === DEFAULT_WATCHLIST_ID);
      lists.splice(afterDefault >= 0 ? afterDefault + 1 : lists.length, 0, otcSeedList);
    } else if (!hasOtcDefaults) {
      const otcIdx = lists.findIndex((item) => item.id === DEFAULT_OTC_LIST_ID);
      const old = lists[otcIdx];
      lists[otcIdx] = {
        ...old,
        name: '默认-场外基金',
        type: 'cn_otc',
        cn: Array.from(new Set([...DEFAULT_CN_OTC_WATCHLIST, ...(old.cn || [])])),
      };
    }
    if (!lists.some((item) => item.id === DEFAULT_INDICATOR_LIST_ID)) {
      const afterOtc = lists.findIndex((item) => item.id === DEFAULT_OTC_LIST_ID);
      const afterDefault = lists.findIndex((item) => item.id === DEFAULT_WATCHLIST_ID);
      const insertAt = afterOtc >= 0 ? afterOtc + 1 : afterDefault >= 0 ? afterDefault + 1 : lists.length;
      lists.splice(insertAt, 0, indicatorSeedList);
    } else if (!hasIndicatorDefaults) {
      const indicatorIdx = lists.findIndex((item) => item.id === DEFAULT_INDICATOR_LIST_ID);
      const old = lists[indicatorIdx];
      lists[indicatorIdx] = {
        ...old,
        name: '默认-常用指标',
        type: 'us_indicator',
        us: sanitizeDefaultIndicatorSymbols([...DEFAULT_US_INDICATOR_WATCHLIST, ...(old.us || [])]),
      };
    } else {
      const indicatorIdx = lists.findIndex((item) => item.id === DEFAULT_INDICATOR_LIST_ID);
      const old = lists[indicatorIdx];
      lists[indicatorIdx] = {
        ...old,
        us: sanitizeDefaultIndicatorSymbols(old.us || []),
      };
    }
  }
  if (!lists.some((item) => item.id === DEFAULT_WATCHLIST_ID)) {
    lists.unshift(seedList);
    if (!lists.some((item) => item.id === DEFAULT_OTC_LIST_ID)) {
      lists.splice(1, 0, otcSeedList);
    }
    if (!lists.some((item) => item.id === DEFAULT_INDICATOR_LIST_ID)) {
      lists.splice(2, 0, indicatorSeedList);
    }
  }
  let activeListId = String(value.activeListId || DEFAULT_WATCHLIST_ID);
  if (!lists.some((item) => item.id === activeListId)) activeListId = lists[0].id;
  const activeList = lists.find((item) => item.id === activeListId) || lists[0] || seedList;

  return {
    ...value,
    us: activeList.us || [],
    cn: activeList.cn || [],
    lists,
    activeListId,
    defaultsVersion: WATCHLIST_DEFAULTS_VERSION
  };
}

export function loadWatchlist() {
  try {
    const raw = localStorage.getItem(WATCHLIST_KEY);
    if (!raw) return normalizeWatchlist({ us: [], cn: [] });
    const parsed = JSON.parse(raw);
    return normalizeWatchlist(parsed);
  } catch (err) {
    return normalizeWatchlist({ us: [], cn: [] });
  }
}

export function saveWatchlist(list) {
  try {
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify(normalizeWatchlist(list || { us: [], cn: [] })));
  } catch (err) {
    // ignore quota errors
  }
}

export function setActiveWatchlist(listId) {
  const current = loadWatchlist();
  const next = normalizeWatchlist({ ...current, activeListId: listId });
  saveWatchlist(next);
  return next;
}

export function createWatchlist(name = '新列表') {
  const current = loadWatchlist();
  const now = new Date().toISOString();
  const id = `list-${Date.now().toString(36)}`;
  const next = normalizeWatchlist({
    ...current,
    lists: [
      ...(current.lists || []),
      { id, name: String(name || '新列表').trim() || '新列表', us: [], cn: [], createdAt: now, updatedAt: now }
    ],
    activeListId: id,
  });
  saveWatchlist(next);
  return next;
}

export function renameWatchlist(listId, name) {
  const current = loadWatchlist();
  const targetListId = String(listId || current.activeListId || DEFAULT_WATCHLIST_ID);
  const nextName = String(name || '').trim();
  if (!nextName) return current;
  const now = new Date().toISOString();
  const lists = (current.lists || []).map((item) => (
    item.id === targetListId ? { ...item, name: nextName, updatedAt: now } : item
  ));
  const saved = normalizeWatchlist({ ...current, lists });
  saveWatchlist(saved);
  return saved;
}

export function deleteWatchlist(listId) {
  const current = loadWatchlist();
  const targetListId = String(listId || current.activeListId || '');
  const currentLists = current.lists || [];
  if (!targetListId || targetListId === DEFAULT_WATCHLIST_ID || currentLists.length <= 1) return current;
  const lists = currentLists.filter((item) => item.id !== targetListId);
  const activeListId = current.activeListId === targetListId
    ? (lists.find((item) => item.id === DEFAULT_WATCHLIST_ID)?.id || lists[0]?.id || DEFAULT_WATCHLIST_ID)
    : current.activeListId;
  const saved = normalizeWatchlist({ ...current, lists, activeListId });
  saveWatchlist(saved);
  return saved;
}

export function addToWatchlist(market, symbol, listId = null) {
  const next = loadWatchlist();
  const targetListId = String(listId || next.activeListId || DEFAULT_WATCHLIST_ID);
  const lists = (next.lists || []).map((item) => ({ ...item }));
  const target = lists.find((item) => item.id === targetListId) || lists[0];
  const list = target[market] || [];
  if (!list.includes(symbol)) list.unshift(symbol);
  target[market] = list.slice(0, 50);
  target.updatedAt = new Date().toISOString();
  const saved = normalizeWatchlist({ ...next, lists, activeListId: target.id });
  saveWatchlist(saved);
  return saved;
}

export function removeFromWatchlist(market, symbol, listId = null) {
  const next = loadWatchlist();
  const targetListId = String(listId || next.activeListId || DEFAULT_WATCHLIST_ID);
  const lists = (next.lists || []).map((item) => ({ ...item }));
  const target = lists.find((item) => item.id === targetListId) || lists[0];
  target[market] = (target[market] || []).filter((s) => s !== symbol);
  target.updatedAt = new Date().toISOString();
  const saved = normalizeWatchlist({ ...next, lists, activeListId: target.id });
  saveWatchlist(saved);
  return saved;
}
