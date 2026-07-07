import { kvGetJson, kvPutJson } from './storage.js';
import { getShanghaiTradingMinute } from './marketRuntime.js';

const CN_MORNING_OPEN_MINUTE = 9 * 60 + 30;
const CN_MORNING_CLOSE_MINUTE = 11 * 60 + 30;
const CN_AFTERNOON_OPEN_MINUTE = 13 * 60;
const CN_AFTERNOON_CLOSE_MINUTE = 15 * 60;
const WEEKDAY_INDEX = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export function quoteCacheKey(code = '') {
  return 'quote:' + String(code || '').trim();
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
  closedTtlSeconds = 24 * 3600
} = {}) {
  if (market !== 'cn') return liveTtlSeconds;
  const { weekday, minuteOfDay } = getShanghaiTradingMinute(date);
  const day = WEEKDAY_INDEX[weekday] || 1;
  const isWeekday = day >= 1 && day <= 5;
  const isTrading = isWeekday && (
    (minuteOfDay >= CN_MORNING_OPEN_MINUTE && minuteOfDay <= CN_MORNING_CLOSE_MINUTE)
    || (minuteOfDay >= CN_AFTERNOON_OPEN_MINUTE && minuteOfDay <= CN_AFTERNOON_CLOSE_MINUTE)
  );
  if (isTrading) return liveTtlSeconds;
  return Math.max(liveTtlSeconds, Math.min(closedTtlSeconds, secondsUntilNextCnOpen(date)));
}

export function quoteCacheMaxAgeMs(market, options = {}) {
  return quoteCacheTtlSeconds(market, options) * 1000;
}

export function prepareQuoteCacheValue(quote, date = new Date()) {
  if (!quote || typeof quote !== 'object') return quote;
  return { ...quote, cachedAt: quote.cachedAt || date.toISOString() };
}

export async function readFreshQuoteCache(env, code, market, { maxAgeMs } = {}) {
  const cached = await kvGetJson(env, quoteCacheKey(code)).catch(() => null);
  if (!cached || (!cached.cachedAt && !cached.asOf)) return null;
  const ageSource = cached.cachedAt || cached.asOf;
  const effectiveMaxAgeMs = Number.isFinite(maxAgeMs) ? maxAgeMs : quoteCacheMaxAgeMs(market);
  if (Date.now() - new Date(ageSource).getTime() >= effectiveMaxAgeMs) return null;
  if (market === 'cn' && cached.source !== 'xueqiu-quote') return null;
  return cached;
}

export async function writeQuoteCache(env, code, quote, { ttlSeconds = 300 } = {}) {
  if (!String(code || '').trim()) return;
  if (!quote || quote.error) return;
  await kvPutJson(env, quoteCacheKey(code), prepareQuoteCacheValue(quote), { ttlSeconds }).catch(() => {});
}
