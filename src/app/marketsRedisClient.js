const DEFAULT_PREFIX = 'ai-dca:markets:';
const EXCHANGE_PREFIXES = new Set(['15', '50', '51', '52', '53', '54', '56', '58']);

function redisBaseUrl() {
  const fromWindow = typeof window !== 'undefined' ? window.__MARKETS_REDIS_REST_URL__ : '';
  return String(fromWindow || import.meta.env.VITE_MARKETS_REDIS_REST_URL || '').trim().replace(/\/+$/, '');
}

function redisReadToken() {
  const fromWindow = typeof window !== 'undefined' ? window.__MARKETS_REDIS_READ_TOKEN__ : '';
  return String(fromWindow || import.meta.env.VITE_MARKETS_REDIS_READ_TOKEN || '').trim();
}

function redisPrefix() {
  const fromWindow = typeof window !== 'undefined' ? window.__MARKETS_REDIS_PREFIX__ : '';
  return String(fromWindow || import.meta.env.VITE_MARKETS_REDIS_PREFIX || DEFAULT_PREFIX).trim() || DEFAULT_PREFIX;
}

function redisEnabled() {
  return Boolean(redisBaseUrl() && redisReadToken());
}

function fullKey(key = '') {
  return `${redisPrefix()}${String(key || '').trim()}`;
}

function normalizeSymbol(input = '') {
  const s = String(input || '').trim();
  if (!s) return '';
  if (/^(sh|sz|bj)\d{6}$/i.test(s)) return s.toLowerCase();
  if (/^\d{6}$/.test(s)) {
    const prefix = s.startsWith('6') || s.startsWith('51') || s.startsWith('56') || s.startsWith('58')
      ? 'sh'
      : s.startsWith('4') || s.startsWith('8')
        ? 'bj'
        : 'sz';
    return `${prefix}${s}`;
  }
  return s.toUpperCase();
}

function normalizeFundCode(input = '') {
  const digits = String(input || '').replace(/^(sh|sz|bj)/i, '').replace(/\D/g, '');
  return digits.length === 6 ? digits : '';
}

function isUsLikeSymbol(input = '') {
  const s = String(input || '').trim();
  return Boolean(s && !/^(sh|sz|bj)?\d{6}$/i.test(s));
}

async function redisPipeline(commands = [], { signal } = {}) {
  if (!redisEnabled() || !commands.length) return [];
  const response = await fetch(`${redisBaseUrl()}/pipeline`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${redisReadToken()}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(commands),
    signal,
    cache: 'no-store'
  });
  if (!response.ok) throw new Error('markets redis HTTP ' + response.status);
  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

async function mgetJson(keys = [], { signal } = {}) {
  const list = Array.from(new Set(keys.map((key) => String(key || '').trim()).filter(Boolean)));
  if (!list.length) return {};
  const rows = await redisPipeline(list.map((key) => ['GET', fullKey(key)]), { signal });
  const out = {};
  list.forEach((key, index) => {
    const value = rows?.[index]?.result;
    if (!value) return;
    try {
      out[key] = JSON.parse(value);
    } catch {
      // ignore malformed cache value
    }
  });
  return out;
}

async function getJson(key, options) {
  const result = await mgetJson([key], options);
  return result[key] || null;
}

function hasQuoteValue(item) {
  return Boolean(item && (
    Number(item.price) > 0 ||
    Number(item.currentPrice) > 0 ||
    Number(item.close) > 0 ||
    Number(item.latestNav) > 0
  ));
}

export async function readRedisQuote(symbol, options = {}) {
  if (!redisEnabled()) return null;
  const normalized = normalizeSymbol(symbol);
  if (!normalized) return null;
  const item = await getJson(`quote:${normalized}`, options);
  return hasQuoteValue(item) ? { ...item, cached: true, cache: { hit: true, source: 'redis-direct' } } : null;
}

export async function readRedisQuotes(symbols = [], options = {}) {
  if (!redisEnabled()) return null;
  const entries = (Array.isArray(symbols) ? symbols : [])
    .map((raw) => ({ raw: String(raw || '').trim(), normalized: normalizeSymbol(raw) }))
    .filter((item) => item.raw && item.normalized);
  if (!entries.length) return { quotes: {} };
  const byKey = await mgetJson(entries.map((item) => `quote:${item.normalized}`), options);
  const quotes = {};
  let missing = 0;
  for (const item of entries) {
    const quote = byKey[`quote:${item.normalized}`];
    if (hasQuoteValue(quote)) {
      quotes[item.raw] = { ...quote, cached: true, cache: { hit: true, source: 'redis-direct' } };
    } else {
      missing += 1;
    }
  }
  return missing ? null : { quotes, generatedAt: new Date().toISOString(), cache: { hit: true, source: 'redis-direct' } };
}

export async function readRedisFundMetrics(codes = [], { signal } = {}) {
  if (!redisEnabled()) return null;
  const entries = (Array.isArray(codes) ? codes : [codes])
    .map((raw) => ({ raw: String(raw || '').trim(), code: normalizeFundCode(raw) }))
    .filter((item) => item.raw && item.code);
  if (!entries.length) return null;
  const byKey = await mgetJson(entries.map((item) => `fund-metrics:${item.code}`), { signal });
  const items = [];
  for (const entry of entries) {
    const item = byKey[`fund-metrics:${entry.code}`];
    if (!hasQuoteValue(item)) return null;
    items.push({ ...item, cached: true, cache: { hit: true, source: 'redis-direct' } });
  }
  return {
    items,
    successCount: items.filter((item) => item.ok !== false).length,
    failureCount: items.filter((item) => item.ok === false).length,
    generatedAt: new Date().toISOString(),
    tradingSession: false,
    cache: { hit: true, source: 'redis-direct', codeCount: entries.length }
  };
}

export async function readRedisSimplePayload(key, validator = null, options = {}) {
  if (!redisEnabled()) return null;
  const payload = await getJson(key, options);
  if (!payload || (validator && !validator(payload))) return null;
  return { ...payload, cached: true, cache: { hit: true, source: 'redis-direct' } };
}

export async function readRedisKline(symbol, { timeframe = '1d', limit = '' } = {}) {
  if (!redisEnabled()) return null;
  const normalized = normalizeSymbol(symbol);
  if (!normalized) return null;
  const market = isUsLikeSymbol(symbol) ? 'us' : 'cn';
  const payload = await getJson(`kline:${market}:${normalized}:${timeframe}`);
  if (!payload || !Array.isArray(payload.candles) || !payload.candles.length) return null;
  const requestedLimit = Math.max(0, Number(limit) || 0);
  return {
    ...payload,
    candles: requestedLimit > 0 ? payload.candles.slice(-requestedLimit) : payload.candles,
    cached: true,
    source: payload.source || 'redis-direct',
    cache: { hit: true, source: 'redis-direct' }
  };
}

export function redisFundKindFor(code = '') {
  const normalized = normalizeFundCode(code);
  if (!normalized) return '';
  return EXCHANGE_PREFIXES.has(normalized.slice(0, 2)) ? 'exchange' : '';
}
