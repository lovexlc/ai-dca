import { DIRECT_QUOTE_CACHE_KEY, DIRECT_SEARCH_CACHE_KEY } from './marketCacheKeys.js';

import { getExpectedLatestNavDate, getTodayShanghaiDate } from './holdingsLedgerBasics.js';
const TENCENT_QUOTE_URL = 'https://qt.gtimg.cn/';
const TENCENT_SEARCH_URL = 'https://smartbox.gtimg.cn/s3/';
const EM_KLINE_URL = 'https://push2his.eastmoney.com/api/qt/stock/kline/get';
const EM_PUSH_TOKEN = '7eea3edcaed734bea9cbfc24409ed989';

const CN_EXCHANGE_PREFIXES = new Set(['15', '50', '51', '52', '53', '54', '56', '58']);
const QUOTE_CACHE_TTL_MS = 45 * 1000;
const QUOTE_CLOSED_TTL_MS = 4 * 3600 * 1000; // 收盘后 4 小时缓存
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const KLINE_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_DIRECT_QUOTE_BATCH = 60;
const LOCAL_QUOTE_CACHE_KEY = DIRECT_QUOTE_CACHE_KEY;
const LOCAL_SEARCH_CACHE_KEY = DIRECT_SEARCH_CACHE_KEY;
const MAX_LOCAL_QUOTE_RECORDS = 300;
const MAX_LOCAL_SEARCH_RECORDS = 120;
const LOCAL_QUOTE_SOURCES = new Set(['tencent-direct', 'market-realtime']);

// ── A股交易时间判断 ──────────────────────────────────────────
// 北京时间 = UTC+8；盘中 09:30-15:00 周一至周五
function isCnMarketOpen() {
  const now = new Date();
  const beijing = new Date(now.getTime() + 8 * 3600 * 1000);
  const day = beijing.getUTCDay();
  const timeMin = beijing.getUTCHours() * 60 + beijing.getUTCMinutes();
  return day >= 1 && day <= 5 && timeMin >= 570 && timeMin < 900;
}
const quoteMemoryCache = new Map();
const klineMemoryCache = new Map();
const quoteInflight = new Map();
const searchInflight = new Map();
const klineInflight = new Map();

function safeNumber(value) {
  const n = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function compactNumber(value) {
  const n = safeNumber(value);
  return n == null ? null : Math.round(n * 10000) / 10000;
}

function readLocalQuoteBucket() {
  if (typeof window === 'undefined' || !window.localStorage) return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LOCAL_QUOTE_CACHE_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeLocalQuoteBucket(bucket) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const entries = Object.entries(bucket || {})
      .filter(([, entry]) => entry?.quote && Number(entry?.expiresAt) > Date.now())
      .sort((a, b) => Number(b[1]?.cachedAtMs || 0) - Number(a[1]?.cachedAtMs || 0))
      .slice(0, MAX_LOCAL_QUOTE_RECORDS);
    window.localStorage.setItem(LOCAL_QUOTE_CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // localStorage may be full or unavailable; direct fetch should still work.
  }
}

function isValidLocalQuote(entry, nowMs = Date.now()) {
  if (!entry || Number(entry.expiresAt) <= nowMs) return false;
  const quote = entry.quote;
  if (!quote || typeof quote !== 'object') return false;
  const entrySource = String(entry.source || '');
  const quoteSource = String(quote.source || '');
  if (!LOCAL_QUOTE_SOURCES.has(entrySource) || !LOCAL_QUOTE_SOURCES.has(quoteSource)) return false;
  if (entrySource !== quoteSource) return false;
  const price = Number(quote.price ?? quote.currentPrice ?? quote.close);
  return Number.isFinite(price) && price > 0;
}

function quoteTtlMs() {
  return isCnMarketOpen() ? QUOTE_CACHE_TTL_MS : QUOTE_CLOSED_TTL_MS;
}

function readCachedDirectQuote(cacheKey, nowMs = Date.now()) {
  const memory = quoteMemoryCache.get(cacheKey);
  if (memory?.expiresAt > nowMs && memory.quote) return memory.quote;

  const local = readLocalQuoteBucket()[cacheKey];
  if (!isValidLocalQuote(local, nowMs)) return null;
  quoteMemoryCache.set(cacheKey, { quote: local.quote, expiresAt: Number(local.expiresAt) });
  return local.quote;
}

function writeCachedDirectQuotes(records = [], nowMs = Date.now()) {
  const local = readLocalQuoteBucket();
  let changed = false;
  const ttl = quoteTtlMs();
  for (const record of records) {
    const key = String(record?.key || '').trim();
    const quote = record?.quote;
    if (!key || !quote) continue;
    const expiresAt = nowMs + ttl;
    quoteMemoryCache.set(key, { quote, expiresAt });
    local[key] = {
      quote,
      expiresAt,
      cachedAtMs: nowMs,
      source: String(quote.source || 'tencent-direct')
    };
    changed = true;
  }
  if (changed) writeLocalQuoteBucket(local);
}

export function cacheRealtimeDirectQuotes(items = [], nowMs = Date.now()) {
  const records = [];
  for (const item of Array.isArray(items) ? items : []) {
    const rawSymbol = String(item?.symbol || item?.code || '').trim();
    const meta = normalizeDirectSymbol(rawSymbol);
    if (!meta?.tencent) continue;
    const price = compactNumber(item?.price ?? item?.currentPrice ?? item?.close);
    if (price == null || price <= 0) continue;
    records.push({
      key: meta.tencent,
      quote: {
        symbol: meta.market === 'cn' ? meta.code : meta.code || rawSymbol,
        code: meta.code || rawSymbol,
        name: String(item?.name || rawSymbol).trim(),
        market: meta.market,
        price,
        currentPrice: price,
        close: price,
        previousClose: compactNumber(item?.previousClose ?? item?.prevClose),
        change: compactNumber(item?.change),
        changePercent: compactNumber(item?.changePercent),
        volume: safeNumber(item?.volume),
        turnover: safeNumber(item?.turnover ?? item?.amount),
        amount: safeNumber(item?.turnover ?? item?.amount),
        asOf: String(item?.quoteAt || item?.asOf || new Date(nowMs).toISOString()).trim(),
        source: 'market-realtime',
        assetType: meta.market === 'cn' && CN_EXCHANGE_PREFIXES.has(String(meta.code || '').slice(0, 2)) ? 'exchange_fund' : 'stock'
      }
    });
  }
  writeCachedDirectQuotes(records, nowMs);
  return records.length;
}

function searchCacheKey(market = '', query = '', limit = 8) {
  return `${String(market || '').trim().toLowerCase()}|${String(query || '').trim().toLowerCase()}|${Math.max(1, Math.min(Number(limit) || 8, 12))}`;
}

function readLocalSearchBucket() {
  if (typeof window === 'undefined' || !window.localStorage) return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LOCAL_SEARCH_CACHE_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isValidLocalSearchEntry(entry, nowMs = Date.now()) {
  if (!entry || entry.source !== 'tencent-smartbox-direct') return false;
  if (Number(entry.expiresAt) <= nowMs) return false;
  if (entry.payload?.source !== 'tencent-smartbox-direct') return false;
  return Array.isArray(entry.payload?.results);
}

function writeLocalSearchBucket(bucket = {}) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const nowMs = Date.now();
    const entries = Object.entries(bucket || {})
      .filter(([, entry]) => isValidLocalSearchEntry(entry, nowMs))
      .sort((a, b) => Number(b[1]?.cachedAtMs || 0) - Number(a[1]?.cachedAtMs || 0))
      .slice(0, MAX_LOCAL_SEARCH_RECORDS);
    window.localStorage.setItem(LOCAL_SEARCH_CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Search cache is optional.
  }
}

function readCachedDirectSearch(key, nowMs = Date.now()) {
  const entry = readLocalSearchBucket()[key];
  return isValidLocalSearchEntry(entry, nowMs) ? entry.payload : null;
}

function writeCachedDirectSearch(key, payload, nowMs = Date.now()) {
  if (!key || !Array.isArray(payload?.results)) return false;
  const bucket = readLocalSearchBucket();
  bucket[key] = {
    payload,
    expiresAt: nowMs + SEARCH_CACHE_TTL_MS,
    cachedAtMs: nowMs,
    source: 'tencent-smartbox-direct'
  };
  writeLocalSearchBucket(bucket);
  return true;
}

function decodeTencentBuffer(buffer) {
  try {
    return new TextDecoder('gbk').decode(buffer);
  } catch (_error) {
    return new TextDecoder().decode(buffer);
  }
}

export function normalizeDirectSymbol(symbol = '') {
  const raw = String(symbol || '').trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  const prefixedCn = /^(sh|sz|bj)(\d{6})$/i.exec(raw);
  if (prefixedCn) {
    return {
      market: 'cn',
      code: prefixedCn[2],
      tencent: prefixedCn[1].toLowerCase() + prefixedCn[2],
      eastmoneySecid: (prefixedCn[1].toLowerCase() === 'sh' ? '1.' : '0.') + prefixedCn[2]
    };
  }
  if (/^\d{6}$/.test(raw)) {
    const prefix = raw.startsWith('6') || raw.startsWith('5') ? 'sh' : 'sz';
    return {
      market: 'cn',
      code: raw,
      tencent: prefix + raw,
      eastmoneySecid: (prefix === 'sh' ? '1.' : '0.') + raw
    };
  }
  const hk = /^hk?(\d{5})$/i.exec(raw);
  if (hk) return { market: 'hk', code: hk[1], tencent: 'hk' + hk[1] };
  if (/^[A-Z][A-Z0-9.-]{0,15}$/i.test(raw) && !raw.startsWith('^')) {
    const code = raw.toUpperCase();
    return { market: 'us', code, tencent: 'us' + code };
  }
  return null;
}

function parseTencentVariables(text = '') {
  const rows = [];
  const re = /v_([^=]+)="([^"]*)";?/g;
  let match;
  while ((match = re.exec(text))) {
    rows.push({ key: match[1], fields: String(match[2] || '').split('~') });
  }
  return rows;
}

function normalizeTencentQuote(key, fields) {
  if (!Array.isArray(fields) || fields.length <= 5 || fields[0] === '') return null;
  const rawCode = fields[2] || key.replace(/^(sh|sz|bj|hk|us)/i, '');
  const market = key.startsWith('hk') ? 'hk' : key.startsWith('us') ? 'us' : 'cn';
  const symbol = market === 'cn' ? rawCode : market === 'hk' ? 'hk' + rawCode : rawCode;
  const previousClose = compactNumber(fields[4]);
  const price = compactNumber(fields[3]);
  const change = compactNumber(fields[31] ?? (price != null && previousClose != null ? price - previousClose : null));
  const changePercent = compactNumber(fields[32] ?? (previousClose ? (change / previousClose) * 100 : null));
  const quote = {
    symbol,
    code: rawCode,
    name: fields[1] || symbol,
    market,
    price,
    currentPrice: price,
    previousClose,
    open: compactNumber(fields[5]),
    high: compactNumber(fields[33]),
    low: compactNumber(fields[34]),
    change,
    changePercent,
    volume: safeNumber(fields[6]),
    turnover: safeNumber(fields[37]),
    amount: safeNumber(fields[37]),
    time: fields[30] || '',
    asOf: new Date().toISOString(),
    currency: market === 'cn' ? '¥' : market === 'hk' ? 'HKD' : 'USD',
    source: 'tencent-direct',
    assetType: market === 'cn' && CN_EXCHANGE_PREFIXES.has(String(rawCode).slice(0, 2)) ? 'exchange_fund' : 'stock'
  };
  if (market === 'cn') {
    quote.high52w = compactNumber(fields[67]);
    quote.low52w = compactNumber(fields[68]);
    quote.marketCapital = safeNumber(fields[45]);
    quote.pe = safeNumber(fields[39]);
    quote.pb = safeNumber(fields[46]);
  } else if (market === 'us') {
    quote.high52w = compactNumber(fields[48]);
    quote.low52w = compactNumber(fields[49]);
    quote.marketCapital = safeNumber(fields[45]);
    quote.pe = safeNumber(fields[39]);
    quote.pb = safeNumber(fields[47]);
  } else if (market === 'hk') {
    quote.marketCapital = safeNumber(fields[45]);
  }
  return quote;
}

export function parseTencentQuoteText(text = '') {
  const quotes = {};
  for (const row of parseTencentVariables(text)) {
    const quote = normalizeTencentQuote(row.key, row.fields);
    if (!quote) continue;
    quotes[quote.symbol] = quote;
    quotes[quote.code] = quote;
    quotes[row.key] = quote;
  }
  return quotes;
}

export async function fetchDirectQuotes(symbols = [], { signal } = {}) {
  if (!signal) {
    const key = directQuoteInflightKey(symbols);
    if (!key) return null;
    if (quoteInflight.has(key)) return quoteInflight.get(key);
    const promise = fetchDirectQuotesUncached(symbols, { signal }).finally(() => {
      quoteInflight.delete(key);
    });
    quoteInflight.set(key, promise);
    return promise;
  }
  return fetchDirectQuotesUncached(symbols, { signal });
}

function directQuoteInflightKey(symbols = []) {
  const list = (Array.isArray(symbols) ? symbols : [symbols])
    .map((symbol) => normalizeDirectSymbol(symbol)?.tencent || '')
    .filter(Boolean)
    .sort();
  return Array.from(new Set(list)).join(',');
}

async function fetchDirectQuotesUncached(symbols = [], { signal } = {}) {
  const normalized = (Array.isArray(symbols) ? symbols : [symbols])
    .map((symbol) => ({ raw: String(symbol || '').trim(), meta: normalizeDirectSymbol(symbol) }))
    .filter((item) => item.raw && item.meta?.tencent);
  if (!normalized.length) return null;
  const now = Date.now();
  const marketOpen = isCnMarketOpen();
  const out = {};
  const missing = [];
  for (const item of normalized.slice(0, MAX_DIRECT_QUOTE_BATCH)) {
    const cached = readCachedDirectQuote(item.meta.tencent, now);
    if (cached) {
      out[item.raw] = cached;
    } else {
      missing.push(item);
    }
  }
  // 收盘后：有缓存就不调网络；没缓存还是要调一次腾讯拿收盘价
  if (!marketOpen && !missing.length) {
    return { quotes: out, generatedAt: new Date().toISOString(), source: 'tencent-direct-closed' };
  }
  if (marketOpen && !missing.length) {
    return { quotes: out, generatedAt: new Date().toISOString(), source: 'tencent-direct-cache' };
  }
  const q = missing.map((item) => item.meta.tencent).join(',');
  const res = await fetch(`${TENCENT_QUOTE_URL}?q=${encodeURIComponent(q)}`, { signal, cache: 'no-store' });
  if (!res.ok) throw new Error('tencent quote HTTP ' + res.status);
  const text = decodeTencentBuffer(await res.arrayBuffer());
  const parsed = parseTencentQuoteText(text);
  const cacheRecords = [];
  for (const item of missing) {
    const quote = parsed[item.meta.tencent] || parsed[item.meta.code] || parsed[item.raw] || null;
    if (quote) {
      out[item.raw] = quote;
      cacheRecords.push({ key: item.meta.tencent, quote });
    }
  }
  writeCachedDirectQuotes(cacheRecords, now);
  return { quotes: out, generatedAt: new Date().toISOString(), source: 'tencent-direct' };
}

function decodeUnicodeEscapes(value = '') {
  return String(value || '').replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

export function parseTencentSearchText(text = '') {
  const raw = String(text || '');
  const match = raw.match(/v_hint="([^"]*)"/);
  const body = match ? match[1] : raw;
  if (!body || body === 'N') return [];
  return body.split('^').filter(Boolean).map((record) => {
    const fields = record.split('~');
    const market = fields[0] || '';
    const code = fields[1] || '';
    const type = fields[4] || '';
    return {
      symbol: market + code,
      code,
      name: decodeUnicodeEscapes(fields[2] || ''),
      market: market === 'us' ? 'us' : market === 'hk' ? 'hk' : 'cn',
      exchange: market,
      type,
      assetType: /ETF|LOF|QDII|JJ|FUND|KJ/i.test(type) ? 'fund' : /ZS|INDEX/i.test(type) ? 'index' : 'stock',
      source: 'tencent-smartbox'
    };
  });
}

function fetchSearchByScript(query, { signal } = {}) {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
      reject(new Error('script search requires browser'));
      return;
    }
    const script = document.createElement('script');
    const cleanup = () => {
      script.remove();
      if (signal) signal.removeEventListener('abort', abort);
    };
    const abort = () => {
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    window.v_hint = '';
    script.src = `${TENCENT_SEARCH_URL}?v=2&t=all&q=${encodeURIComponent(query)}`;
    script.charset = 'utf-8';
    script.onload = () => {
      const result = window.v_hint || '';
      cleanup();
      resolve(result);
    };
    script.onerror = () => {
      cleanup();
      reject(new Error('tencent smartbox script failed'));
    };
    if (signal) signal.addEventListener('abort', abort, { once: true });
    document.body.appendChild(script);
  });
}

export async function searchDirectSymbols(market, query, { limit = 8, signal } = {}) {
  if (!signal) {
    const key = searchCacheKey(market, query, limit);
    if (!key) return { market, query: String(query || '').trim(), results: [] };
    if (searchInflight.has(key)) return searchInflight.get(key);
    const promise = searchDirectSymbolsUncached(market, query, { limit, signal }).finally(() => {
      searchInflight.delete(key);
    });
    searchInflight.set(key, promise);
    return promise;
  }
  return searchDirectSymbolsUncached(market, query, { limit, signal });
}

async function searchDirectSymbolsUncached(market, query, { limit = 8, signal } = {}) {
  const q = String(query || '').trim();
  if (!q) return { market, query: q, results: [] };
  const key = searchCacheKey(market, q, limit);
  const cached = readCachedDirectSearch(key);
  if (cached) return { ...cached, cache: { hit: true, source: 'localStorage' } };
  const text = await fetchSearchByScript(q, { signal });
  const wantedMarket = String(market || '').toLowerCase();
  const results = parseTencentSearchText(text)
    .filter((item) => wantedMarket === 'us' ? item.market === 'us' : item.market === 'cn')
    .slice(0, Math.max(1, Math.min(Number(limit) || 8, 12)));
  const payload = { market, query: q, results, generatedAt: new Date().toISOString(), source: 'tencent-smartbox-direct' };
  writeCachedDirectSearch(key, payload);
  return payload;
}

function eastmoneyKlt(timeframe) {
  if (timeframe === '1d' || timeframe === '1y') return '101';
  if (timeframe === '1w') return '102';
  if (timeframe === '1mo') return '103';
  return '';
}

function epochSecFromCnDate(date) {
  const t = Date.parse(`${date}T15:00:00+08:00`);
  return Number.isFinite(t) ? Math.floor(t / 1000) : 0;
}

export function parseEastmoneyKlinePayload(payload, { symbol = '', timeframe = '1d' } = {}) {
  const data = payload?.data;
  const rows = Array.isArray(data?.klines) ? data.klines : [];
  const candles = rows.map((line) => {
    const [date, open, close, high, low, volume, amount] = String(line || '').split(',');
    return {
      t: epochSecFromCnDate(date),
      date,
      o: compactNumber(open),
      h: compactNumber(high),
      l: compactNumber(low),
      c: compactNumber(close),
      v: safeNumber(volume),
      amount: safeNumber(amount)
    };
  }).filter((item) => item.t > 0 && item.c != null);
  return {
    symbol: data?.code || symbol,
    name: data?.name || symbol,
    market: 'cn',
    tf: timeframe,
    candles,
    generatedAt: new Date().toISOString(),
    source: 'eastmoney-direct'
  };
}

export async function fetchDirectKline(symbol, { timeframe = '1d', limit = '' } = {}) {
  const key = directKlineInflightKey(symbol, { timeframe });
  if (!key) return null;
  if (klineInflight.has(key)) {
    const payload = await klineInflight.get(key);
    return sliceDirectKlinePayload(payload, limit);
  }
  const promise = fetchDirectKlineUncached(symbol, { timeframe }).finally(() => {
    klineInflight.delete(key);
  });
  klineInflight.set(key, promise);
  const payload = await promise;
  return sliceDirectKlinePayload(payload, limit);
}

function directKlineInflightKey(symbol, { timeframe = '1d' } = {}) {
  const meta = normalizeDirectSymbol(symbol);
  const klt = eastmoneyKlt(timeframe);
  if (!meta || meta.market !== 'cn' || !klt) return '';
  return `${meta.eastmoneySecid}|${timeframe}`;
}

function sliceDirectKlinePayload(payload, limit = '') {
  if (!payload?.candles?.length) return payload;
  const requestedLimit = Number(limit);
  if (!Number.isFinite(requestedLimit) || requestedLimit <= 0) return payload;
  return { ...payload, candles: payload.candles.slice(-requestedLimit) };
}

async function fetchDirectKlineUncached(symbol, { timeframe = '1d' } = {}) {
  const meta = normalizeDirectSymbol(symbol);
  const klt = eastmoneyKlt(timeframe);
  if (!meta || meta.market !== 'cn' || !klt) return null;
  const cacheKey = `${meta.eastmoneySecid}|${timeframe}`;
  const now = Date.now();
  const cached = klineMemoryCache.get(cacheKey);
  if (cached?.expiresAt > now && cached.payload?.candles?.length) {
    return {
      ...cached.payload,
      cache: { hit: true, source: 'memory-direct' }
    };
  }
  const params = new URLSearchParams({
    secid: meta.eastmoneySecid,
    ut: EM_PUSH_TOKEN,
    fields1: 'f1,f2,f3,f4,f5,f6',
    fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
    klt,
    fqt: '1',
    beg: '19700101',
    end: '20500101'
  });
  const res = await fetch(`${EM_KLINE_URL}?${params.toString()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('eastmoney kline HTTP ' + res.status);
  const payload = await res.json();
  if (payload?.rc !== 0 || !payload?.data) throw new Error('eastmoney kline empty');
  const normalized = parseEastmoneyKlinePayload(payload, { symbol: meta.code, timeframe });
  klineMemoryCache.set(cacheKey, { payload: normalized, expiresAt: now + KLINE_CACHE_TTL_MS });
  return normalized;
}

export function clearDirectMarketDataCaches() {
  quoteMemoryCache.clear();
  klineMemoryCache.clear();
  quoteInflight.clear();
  searchInflight.clear();
  klineInflight.clear();
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.removeItem(LOCAL_QUOTE_CACHE_KEY);
      window.localStorage.removeItem(LOCAL_SEARCH_CACHE_KEY);
    } catch {
      // ignore
    }
  }
}

export const __internals = {
  LOCAL_QUOTE_CACHE_KEY,
  LOCAL_SEARCH_CACHE_KEY,
  QUOTE_CACHE_TTL_MS,
  SEARCH_CACHE_TTL_MS,
  searchCacheKey,
  LOCAL_QUOTE_SOURCES,
  readCachedDirectQuote,
  writeCachedDirectQuotes,
  isValidLocalQuote,
  isValidLocalSearchEntry,
  readCachedDirectSearch,
  writeCachedDirectSearch,
  directQuoteInflightKey,
  directKlineInflightKey,
  clearDirectInflight() {
    quoteInflight.clear();
    searchInflight.clear();
    klineInflight.clear();
  },
  inflightSizes() {
    return { quotes: quoteInflight.size, search: searchInflight.size, kline: klineInflight.size };
  }
};

// ── 蛋卷基金直连（场外基金净值） ──────────────────────────────

const DANJUAN_HOST = 'https://danjuanfunds.com';
const DANJUAN_HEADERS = {
  'Referer': 'https://danjuanfunds.com/',
  'Accept': 'application/json'
};
const danjuanMemoryCache = new Map();
const danjuanInflight = new Map();

function danjuanCacheKey(code) {
  return 'danjuan:' + code;
}

// 场外基金净值是否为最新：latestNavDate >= 预期最新净值日期
function isDanjuanQuoteFresh(quote) {
  if (!quote?.latestNavDate) return false;
  const expected = getExpectedLatestNavDate('otc', getTodayShanghaiDate());
  return String(quote.latestNavDate) >= expected;
}

// 读取缓存：净值日期达到预期才认为有效
function readCachedDanjuanQuote(code) {
  const entry = danjuanMemoryCache.get(danjuanCacheKey(code));
  if (!entry?.quote) return null;
  // 盘中：净值未发布，只要有过缓存就用（即使是上一交易日的）
  if (isCnMarketOpen()) return entry.quote;
  // 收盘后：净值日期必须达到预期最新日期
  if (isDanjuanQuoteFresh(entry.quote)) return entry.quote;
  return null;
}

// 写入缓存：只有拉到最新净值才缓存
function writeCachedDanjuanQuote(code, quote) {
  if (!quote || !isDanjuanQuoteFresh(quote)) return;
  danjuanMemoryCache.set(danjuanCacheKey(code), { quote });
}

function transformDanjuanDerived(code, data) {
  const d = data || {};
  return {
    code,
    symbol: code,
    name: '', // 名称由前端 catalog 提供
    price: null,
    currentPrice: null,
    close: null,
    previousClose: null,
    change: null,
    changePercent: parseFloat(d.nav_grtd) || null,
    latestNav: parseFloat(d.unit_nav) || null,
    accumulatedNav: parseFloat(d.unit_acc_nav) || null,
    latestNavDate: d.end_date || '',
    iopv: null,
    marketState: '',
    asOf: d.updated_at ? new Date(d.updated_at).toISOString() : new Date().toISOString(),
    source: 'danjuan-direct',
    fundTypeCode: d.fd_type || null,
    updatedAt: d.updated_at || 0,
    ytdReturn: parseFloat(d.nav_grlty) || null,
    return1w: parseFloat(d.nav_grl1w) || null,
    return1m: parseFloat(d.nav_grl1m) || null,
    return3m: parseFloat(d.nav_grl3m) || null,
    return6m: parseFloat(d.nav_grl6m) || null,
    return1y: parseFloat(d.nav_grl1y) || null,
    returnBase: parseFloat(d.nav_grbase) || null,
  };
}

export async function fetchDanjuanDirectQuotes(codes = [], { signal } = {}) {
  const list = (Array.isArray(codes) ? codes : [codes])
    .map((c) => String(c || '').trim().replace(/^(sh|sz|bj)/i, ''))
    .filter((c) => /^\d{6}$/.test(c));
  if (!list.length) return null;

  const unique = Array.from(new Set(list));
  const now = Date.now();
  const marketOpen = isCnMarketOpen();
  const out = {};
  const missing = [];

  for (const code of unique) {
    const cached = readCachedDanjuanQuote(code);
    if (cached) {
      out[code] = cached;
    } else {
      missing.push(code);
    }
  }

  if (!missing.length) {
    return { quotes: out, generatedAt: new Date().toISOString(), source: 'danjuan-direct-cache' };
  }

  // 盘中：净值还没发布，不调接口，用已有缓存（即使过期）
  if (marketOpen) {
    for (const code of missing) {
      const entry = danjuanMemoryCache.get(danjuanCacheKey(code));
      if (entry?.quote) out[code] = entry.quote;
    }
    return { quotes: out, generatedAt: new Date().toISOString(), source: 'danjuan-direct-market' };
  }

  // 并发请求，限制 5 并发
  const BATCH_SIZE = 5;
  for (let i = 0; i < missing.length; i += BATCH_SIZE) {
    const batch = missing.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (code) => {
        const url = `${DANJUAN_HOST}/djapi/fund/derived/${code}`;
        const res = await fetch(url, { headers: DANJUAN_HEADERS, signal, cache: 'no-store' });
        if (!res.ok) throw new Error('danjuan HTTP ' + res.status);
        const body = await res.json();
        if (body?.result_code !== 0 && body?.result_code !== '0') {
          throw new Error('danjuan error: ' + (body?.message || body?.result_code));
        }
        return { code, data: body.data };
      })
    );
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value?.data) {
        const { code, data } = result.value;
        const quote = transformDanjuanDerived(code, data);
        out[code] = quote;
        writeCachedDanjuanQuote(code, quote);
      }
    }
  }

  return { quotes: out, generatedAt: new Date().toISOString(), source: 'danjuan-direct' };
}
