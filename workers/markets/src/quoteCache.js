import { kvGetJson, kvPutJson } from './storage.js';
import { getShanghaiTradingMinute } from './marketRuntime.js';
import { kvCacheMGetJson } from './kvCache.js';

const CN_MORNING_OPEN_MINUTE = 9 * 60 + 30;
const CN_MORNING_CLOSE_MINUTE = 11 * 60 + 30;
const CN_AFTERNOON_OPEN_MINUTE = 13 * 60;
const CN_AFTERNOON_CLOSE_MINUTE = 15 * 60;
const WEEKDAY_INDEX = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
const CN_STALE_QUOTE_MAX_AGE_MS = 6 * 3600 * 1000;
const CN_STALE_QUOTE_STORAGE_TTL_SECONDS = 6 * 3600;

export function quoteCacheKey(code = '') {
  return 'quote:' + String(code || '').trim();
}

function isCnTradingTime(date = new Date()) {
  const { weekday, minuteOfDay } = getShanghaiTradingMinute(date);
  const day = WEEKDAY_INDEX[weekday] || 1;
  return day >= 1 && day <= 5 && (
    (minuteOfDay >= CN_MORNING_OPEN_MINUTE && minuteOfDay < CN_MORNING_CLOSE_MINUTE)
    || (minuteOfDay >= CN_AFTERNOON_OPEN_MINUTE && minuteOfDay < CN_AFTERNOON_CLOSE_MINUTE)
  );
}

function secondsUntilNextCnOpen(date = new Date()) {
  const { weekday, minuteOfDay } = getShanghaiTradingMinute(date);
  const day = WEEKDAY_INDEX[weekday] || 1;
  if (day >= 1 && day <= 5) {
    if (minuteOfDay < CN_MORNING_OPEN_MINUTE) return (CN_MORNING_OPEN_MINUTE - minuteOfDay) * 60;
    if (minuteOfDay > CN_MORNING_CLOSE_MINUTE && minuteOfDay < CN_AFTERNOON_OPEN_MINUTE) {
      return (CN_AFTERNOON_OPEN_MINUTE - minuteOfDay) * 60;
    }
  }
  const daysUntilNextWeekday = day === 5 ? 3 : day === 6 ? 2 : day === 7 ? 1 : 1;
  const minutesUntilOpen = (24 * 60 - minuteOfDay)
    + (daysUntilNextWeekday - 1) * 24 * 60
    + CN_MORNING_OPEN_MINUTE;
  return Math.max(60, minutesUntilOpen * 60);
}

export function quoteCacheTtlSeconds(market, {
  date = new Date(),
  liveTtlSeconds = 120,
  closedTtlSeconds = 4 * 24 * 3600
} = {}) {
  if (market !== 'cn') return liveTtlSeconds;
  if (isCnTradingTime(date)) return liveTtlSeconds;
  return Math.max(liveTtlSeconds, Math.min(closedTtlSeconds, secondsUntilNextCnOpen(date)));
}

export function quoteCacheMaxAgeMs(market, options = {}) {
  return quoteCacheTtlSeconds(market, options) * 1000;
}

export function prepareQuoteCacheValue(quote, date = new Date()) {
  if (!quote || typeof quote !== 'object') return quote;
  return { ...quote, cachedAt: quote.cachedAt || date.toISOString() };
}

export function quoteCacheAgeMs(cached = {}, date = new Date()) {
  const ageSource = cached.cachedAt || cached.asOf;
  const timestamp = new Date(ageSource).getTime();
  if (!Number.isFinite(timestamp)) return Infinity;
  return date.getTime() - timestamp;
}

export function isValidQuoteCacheSource(cached = {}, market = '') {
  if (market !== 'cn') return true;
  if (cached.source === 'xueqiu-quote') return true;
  if (cached.source !== 'tencent-quote') return false;
  const navBase = Number(cached.navBase ?? cached.iopv ?? cached.latestNav);
  const premiumPercent = cached.premiumPercent;
  return Number.isFinite(navBase) && navBase > 0 && premiumPercent !== null && premiumPercent !== '' && Number.isFinite(Number(premiumPercent));
}

export function isUsableQuoteCache(cached, market, { maxAgeMs, allowStale = false, date = new Date() } = {}) {
  if (!cached || (!cached.cachedAt && !cached.asOf)) return false;
  if (!isValidQuoteCacheSource(cached, market)) return false;
  if (!Number.isFinite(maxAgeMs) && !allowStale && market === 'cn' && !isCnTradingTime(date)) {
    // MARKETS_KV expiration already matches the next CN open. Recomputing the
    // remaining closed-session TTL here made valid Friday quotes stale on weekends.
    return true;
  }
  const effectiveMaxAgeMs = Number.isFinite(maxAgeMs)
    ? maxAgeMs
    : (allowStale && market === 'cn' ? CN_STALE_QUOTE_MAX_AGE_MS : quoteCacheMaxAgeMs(market, { date }));
  return quoteCacheAgeMs(cached, date) < effectiveMaxAgeMs;
}

export async function readQuoteCache(env, code, market, { maxAgeMs, allowStale = false, date = new Date() } = {}) {
  const cached = await kvGetJson(env, quoteCacheKey(code)).catch(() => null);
  return isUsableQuoteCache(cached, market, { maxAgeMs, allowStale, date }) ? cached : null;
}

export async function readFreshQuoteCache(env, code, market, { maxAgeMs, date = new Date() } = {}) {
  return readQuoteCache(env, code, market, { maxAgeMs, allowStale: false, date });
}

export async function readStaleQuoteCache(env, code, market, { maxAgeMs, date = new Date() } = {}) {
  return readQuoteCache(env, code, market, {
    maxAgeMs: Number.isFinite(maxAgeMs) ? maxAgeMs : (market === 'cn' ? CN_STALE_QUOTE_MAX_AGE_MS : quoteCacheMaxAgeMs(market, { date })),
    allowStale: true,
    date
  });
}

export async function readFreshQuoteCacheMap(env, items = []) {
  const normalized = (Array.isArray(items) ? items : [])
    .map((item) => ({
      key: quoteCacheKey(item?.code),
      code: String(item?.code || '').trim(),
      market: String(item?.market || '').trim()
    }))
    .filter((item) => item.code && item.market);
  if (!normalized.length) return {};
  const cached = await kvCacheMGetJson(env, normalized.map((item) => item.key));
  const out = {};
  for (const item of normalized) {
    const value = cached[item.key];
    if (isUsableQuoteCache(value, item.market)) out[item.key] = value;
  }
  return out;
}

export async function writeQuoteCache(env, code, quote, { ttlSeconds = 300 } = {}) {
  if (!String(code || '').trim()) return;
  if (!quote || quote.error) return;
  const isCnXueqiuQuote = quote?.market === 'cn' || quote?.source === 'xueqiu-quote';
  const storageTtlSeconds = isCnXueqiuQuote
    ? Math.max(Number(ttlSeconds) || 0, CN_STALE_QUOTE_STORAGE_TTL_SECONDS)
    : ttlSeconds;
  await kvPutJson(env, quoteCacheKey(code), prepareQuoteCacheValue(quote), { ttlSeconds: storageTtlSeconds }).catch(() => {});
}
