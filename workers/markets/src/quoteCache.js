import { kvGetJson, kvPutJson } from './storage.js';
import { getShanghaiTradingMinute } from './marketRuntime.js';
import { kvCacheMGetJson } from './kvCache.js';
import {
  CACHE_ENVELOPE_VERSION,
  CACHE_POLICY,
  CACHE_STATUS,
  cacheExpirationTtlSeconds,
  createCacheEnvelope,
  isCacheEnvelope,
  isPayloadObject,
  resolveCacheStatus,
  validateCacheEnvelope
} from './cachePolicy.js';

const CN_MORNING_OPEN_MINUTE = 9 * 60 + 30;
const CN_MORNING_CLOSE_MINUTE = 11 * 60 + 30;
const CN_AFTERNOON_OPEN_MINUTE = 13 * 60;
const CN_AFTERNOON_CLOSE_MINUTE = 15 * 60;
const WEEKDAY_INDEX = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
const CN_STALE_QUOTE_MAX_AGE_MS = CACHE_POLICY.quote.cn.staleMs;
const CN_STALE_QUOTE_STORAGE_TTL_SECONDS = CACHE_POLICY.quote.cn.staleMs / 1000;
const OTC_QUOTE_MAX_AGE_MS = CACHE_POLICY.quote.otc.liveMs;
const OTC_STALE_QUOTE_MAX_AGE_MS = CACHE_POLICY.quote.otc.staleMs;
const CN_QUOTE_SOURCES = new Set(['xueqiu-quote', 'tencent-quote']);

export function canonicalQuoteCode(code = '') {
  const raw = String(code || '').trim();
  return /^(?:sh|sz|bj)\d{6}$/i.test(raw) ? raw.slice(2) : raw;
}

export function quoteCacheKey(code = '') {
  return 'quote:' + canonicalQuoteCode(code);
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

function isUsTradingSession(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(date);
  const weekday = parts.find((part) => part.type === 'weekday')?.value || '';
  const hour = Number(parts.find((part) => part.type === 'hour')?.value || 0);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value || 0);
  const minuteOfDay = hour * 60 + minute;
  return !['Sat', 'Sun'].includes(weekday) && minuteOfDay >= 570 && minuteOfDay <= 960;
}

export function quoteCacheTtlSeconds(market, {
  date = new Date(),
  liveTtlSeconds = CACHE_POLICY.quote.cn.liveMs / 1000,
  closedTtlSeconds = CACHE_POLICY.quote.cn.closedMs / 1000
} = {}) {
  if (market === 'otc' || market === 'qdii') return closedTtlSeconds;
  if (market === 'us') {
    if (isUsTradingSession(date)) return liveTtlSeconds;
    const configuredClosed = Number(closedTtlSeconds) === 24 * 3600
      ? CACHE_POLICY.quote.us.closedMs / 1000
      : Number(closedTtlSeconds);
    return Math.max(liveTtlSeconds, Math.min(configuredClosed, CACHE_POLICY.quote.us.closedMs / 1000));
  }
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

export function quoteCacheAgeMs(cached = {}, market = '', now = Date.now()) {
  // OTC quote `asOf` is the Danjuan fetch timestamp. It must win over
  // `cachedAt`, otherwise an old OTC record can be wrapped and appear fresh.
  const ageSource = market === 'otc' || market === 'qdii'
    ? (cached.asOf || cached.cachedAt)
    : (cached.cachedAt || cached.asOf);
  const timestamp = new Date(ageSource).getTime();
  if (!Number.isFinite(timestamp)) return Infinity;
  return Number(now) - timestamp;
}

export function isValidQuoteCacheSource(cached = {}, market = '') {
  const source = String(cached.source || '').trim();
  if (market === 'cn' && !CN_QUOTE_SOURCES.has(source)) return false;
  if ((market === 'otc' || market === 'qdii') && !['danjuan', 'tencent+danjuan'].includes(source)) return false;
  return Boolean(source || market === 'us');
}

function quotePayloadValidator(payload, market = '') {
  return isPayloadObject(payload)
    && isValidQuoteCacheSource(payload, market)
    && (Number(payload.price) > 0 || Number(payload.latestNav) > 0 || Number(payload.currentPrice) > 0 || Number(payload.close) > 0);
}

function quoteEnvelopeSourceSet(market) {
  if (market === 'cn') return CN_QUOTE_SOURCES;
  if (market === 'otc' || market === 'qdii') return new Set(['danjuan', 'tencent+danjuan']);
  return undefined;
}

function quoteEnvelopeValidator(envelope, market) {
  return validateCacheEnvelope(envelope, {
    key: envelope?.key,
    source: quoteEnvelopeSourceSet(market),
    payloadValidator: (payload) => quotePayloadValidator(payload, market)
  }) && (market === 'us' || envelope.source === String(envelope.payload?.source || '').trim());
}

function shanghaiDate(value = '') {
  const raw = String(value || '').trim();
  const direct = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (direct) return direct[1];
  const timestamp = Date.parse(raw);
  if (!Number.isFinite(timestamp)) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(timestamp));
}

function isIntradayCnCachePastClose(cached = {}, now = Date.now()) {
  const cachedAt = Date.parse(String(cached.cachedAt || cached.asOf || ''));
  if (!Number.isFinite(cachedAt)) return false;
  const cachedShanghaiDate = shanghaiDate(new Date(cachedAt));
  const nowShanghaiDate = shanghaiDate(new Date(now));
  if (!cachedShanghaiDate || !nowShanghaiDate) return false;
  const cachedSession = getShanghaiTradingMinute(new Date(cachedAt));
  const isCachedWeekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(cachedSession.weekday);
  const isCachedIntraday = isCachedWeekday
    && cachedSession.minuteOfDay < CN_AFTERNOON_CLOSE_MINUTE;
  if (!isCachedIntraday) return false;
  if (nowShanghaiDate > cachedShanghaiDate) return true;
  if (nowShanghaiDate !== cachedShanghaiDate) return false;
  const currentSession = getShanghaiTradingMinute(new Date(now));
  return currentSession.minuteOfDay > CN_AFTERNOON_CLOSE_MINUTE;
}

function previousShanghaiBusinessDate(date = new Date()) {
  const cursor = new Date(date);
  for (let i = 0; i < 7; i += 1) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', weekday: 'short' }).format(cursor);
    if (weekday !== 'Sat' && weekday !== 'Sun') return shanghaiDate(cursor.toISOString());
  }
  return '';
}

function expectedPublishedNavDate(now = new Date(), fundKind = 'otc') {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value || 0);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value || 0);
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', weekday: 'short' }).format(now);
  // QDII publishes with an additional disclosure lag; keep the last known
  // NAV as delayed while its expected disclosure window has not arrived.
  const publicationHour = fundKind === 'qdii' ? 23 : 20;
  if (weekday === 'Sat' || weekday === 'Sun') return previousShanghaiBusinessDate(now);
  if (hour < publicationHour || (hour === publicationHour && minute < 0)) return previousShanghaiBusinessDate(now);
  return shanghaiDate(now.toISOString());
}

export function isQuoteDelayed(quote = {}, market = '', { now = new Date() } = {}) {
  if (market !== 'otc' && market !== 'qdii') return false;
  const latestDate = shanghaiDate(quote.latestNavDate || quote.navDate || quote.endDate || '');
  if (!latestDate) return false;
  const expectedDate = expectedPublishedNavDate(now, market === 'qdii' ? 'qdii' : 'otc');
  return Boolean(expectedDate && latestDate < expectedDate);
}

function staleMaxAgeMs(market) {
  if (market === 'cn') return CN_STALE_QUOTE_MAX_AGE_MS;
  if (market === 'otc') return OTC_STALE_QUOTE_MAX_AGE_MS;
  if (market === 'qdii') return CACHE_POLICY.quote.qdii.staleMs;
  if (market === 'us') return CACHE_POLICY.quote.us.staleMs;
  return CACHE_POLICY.quote.cn.staleMs;
}

export function isUsableQuoteCache(cached, market, { maxAgeMs, allowStale = false, now = Date.now() } = {}) {
  if (!cached || (!cached.cachedAt && !cached.asOf)) return false;
  if (!isValidQuoteCacheSource(cached, market)) return false;
  if (market === 'cn' && !allowStale && isIntradayCnCachePastClose(cached, now)) return false;
  const effectiveMaxAgeMs = Number.isFinite(maxAgeMs)
    ? maxAgeMs
    : (allowStale ? staleMaxAgeMs(market) : (market === 'otc' ? OTC_QUOTE_MAX_AGE_MS : quoteCacheMaxAgeMs(market)));
  const age = quoteCacheAgeMs(cached, market, now);
  return age >= 0 && age < effectiveMaxAgeMs;
}

function envelopeCacheEntry(raw, key, market, { maxAgeMs, allowStale = false, now = Date.now() } = {}) {
  if (!quoteEnvelopeValidator({ ...raw, key }, market)) {
    return { status: CACHE_STATUS.MISS, payload: null, envelope: null, key };
  }
  if (market === 'cn' && !allowStale && isIntradayCnCachePastClose(raw.payload, now)) {
    return { status: CACHE_STATUS.MISS, payload: null, envelope: raw, key };
  }
  const status = resolveCacheStatus(raw, {
    now,
    key,
    source: quoteEnvelopeSourceSet(market),
    payloadValidator: (payload) => quotePayloadValidator(payload, market),
    delayed: isQuoteDelayed(raw.payload, market, { now: new Date(now) })
  });
  if (status === CACHE_STATUS.FRESH || status === CACHE_STATUS.DELAYED) {
    return { status, payload: raw.payload, envelope: raw, key };
  }
  if (status === CACHE_STATUS.STALE && allowStale) {
    return { status, payload: raw.payload, envelope: raw, key };
  }
  // maxAgeMs is an explicit caller policy and must be stricter than the
  // envelope policy when supplied (for example a live trading request).
  if (Number.isFinite(maxAgeMs) && quoteCacheAgeMs(raw.payload, market, now) < maxAgeMs) {
    return { status: CACHE_STATUS.FRESH, payload: raw.payload, envelope: raw, key };
  }
  return { status: CACHE_STATUS.MISS, payload: null, envelope: raw, key };
}

export async function readQuoteCacheEntryFromKv(kv, code, market, options = {}) {
  const key = quoteCacheKey(code);
  if (!kv) return { status: CACHE_STATUS.MISS, payload: null, envelope: null, key };
  const stored = await kv.get(key, 'json').catch(() => null);
  let raw = stored;
  if (typeof stored === 'string') {
    try { raw = JSON.parse(stored); } catch { raw = null; }
  }
  if (!raw) return { status: CACHE_STATUS.MISS, payload: null, envelope: null, key };
  return isCacheEnvelope(raw)
    ? envelopeCacheEntry(raw, key, market, options)
    : { status: CACHE_STATUS.MISS, payload: null, envelope: raw, key };
}

export async function readQuoteCacheEntry(env, code, market, options = {}) {
  const key = quoteCacheKey(code);
  const raw = await kvGetJson(env, key).catch(() => null);
  if (!raw) return { status: CACHE_STATUS.MISS, payload: null, envelope: null, key };
  return isCacheEnvelope(raw)
    ? envelopeCacheEntry(raw, key, market, options)
    : { status: CACHE_STATUS.MISS, payload: null, envelope: raw, key };
}

export async function readQuoteCache(env, code, market, { maxAgeMs, allowStale = false, now = Date.now() } = {}) {
  const entry = await readQuoteCacheEntry(env, code, market, { maxAgeMs, allowStale, now });
  return entry.status === CACHE_STATUS.FRESH || entry.status === CACHE_STATUS.DELAYED || (allowStale && entry.status === CACHE_STATUS.STALE)
    ? entry.payload
    : null;
}

export async function readFreshQuoteCache(env, code, market, { maxAgeMs, now = Date.now() } = {}) {
  return readQuoteCache(env, code, market, { maxAgeMs, allowStale: false, now });
}

export async function readStaleQuoteCache(env, code, market, { maxAgeMs, now = Date.now() } = {}) {
  const entry = await readQuoteCacheEntry(env, code, market, {
    maxAgeMs: Number.isFinite(maxAgeMs) ? maxAgeMs : staleMaxAgeMs(market),
    allowStale: true,
    now
  });
  return entry.status === CACHE_STATUS.FRESH || entry.status === CACHE_STATUS.DELAYED || entry.status === CACHE_STATUS.STALE
    ? entry.payload
    : null;
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
    if (!value) continue;
    if (!isCacheEnvelope(value)) continue;
    const entry = envelopeCacheEntry(value, item.key, item.market);
    if (entry.status === CACHE_STATUS.FRESH || entry.status === CACHE_STATUS.DELAYED) out[item.key] = entry.payload;
  }
  return out;
}

function quoteMarket(quote = {}, fallback = '') {
  if (quote.market) return String(quote.market).trim();
  if (quote.source === 'danjuan' || quote.source === 'tencent+danjuan') return 'otc';
  if (CN_QUOTE_SOURCES.has(String(quote.source || '').trim())) return 'cn';
  return fallback || 'us';
}

function quoteStaleMs(market, quote = {}) {
  if (market === 'otc' || quote.source === 'danjuan' || quote.source === 'tencent+danjuan') return OTC_STALE_QUOTE_MAX_AGE_MS;
  if (market === 'cn') return CN_STALE_QUOTE_MAX_AGE_MS;
  if (market === 'us') return CACHE_POLICY.quote.us.staleMs;
  return staleMaxAgeMs(market);
}

function buildQuoteEnvelope(code, quote, { ttlSeconds = 300, fundKind = '', now = Date.now() } = {}) {
  const payload = prepareQuoteCacheValue(quote, new Date(now));
  const market = quoteMarket(payload, fundKind === 'otc' || fundKind === 'qdii' ? fundKind : '');
  const validMs = Math.max(1000, (Number(ttlSeconds) || quoteCacheTtlSeconds(market)) * 1000);
  // staleUntil is an absolute retention boundary from fetch time. This keeps
  // physical retention independent from the business valid window.
  const staleMs = Math.max(validMs, quoteStaleMs(market, payload));
  const key = quoteCacheKey(code);
  return createCacheEnvelope({
    key,
    market: market === 'qdii' ? 'cn' : market,
    fundKind: fundKind || payload.fundKind || (market === 'otc' ? 'otc' : ''),
    source: String(payload.source || '').trim() || 'unknown',
    fetchedAt: payload.cachedAt,
    asOf: payload.asOf || payload.latestNavDate || payload.cachedAt,
    validUntil: new Date(now + validMs),
    staleUntil: new Date(now + staleMs),
    payload
  });
}

async function writeQuoteCacheValue(kv, code, quote, options = {}) {
  if (!kv || !String(code || '').trim() || !quote || quote.error) return null;
  const envelope = buildQuoteEnvelope(code, quote, options);
  if (!envelope) return null;
  const ttlSeconds = cacheExpirationTtlSeconds(envelope, options);
  const putOptions = Number.isFinite(ttlSeconds) && ttlSeconds > 60 ? { expirationTtl: ttlSeconds } : {};
  await kv.put(envelope.key, JSON.stringify(envelope), putOptions);
  return envelope;
}

export async function writeQuoteCacheToKv(kv, code, quote, options = {}) {
  return writeQuoteCacheValue(kv, code, quote, options);
}

export async function writeQuoteCache(env, code, quote, { ttlSeconds = 300, fundKind = '' } = {}) {
  if (!String(code || '').trim() || !quote || quote.error) return;
  await writeQuoteCacheValue(env.MARKETS_KV, code, quote, { ttlSeconds, fundKind }).catch(() => {});
}

export function isNewerOtcQuote(candidate = {}, previous = null) {
  if (!previous) return true;
  const candidateNavDate = shanghaiDate(candidate.latestNavDate || candidate.navDate || candidate.endDate || '');
  const previousNavDate = shanghaiDate(previous.latestNavDate || previous.navDate || previous.endDate || '');
  if (candidateNavDate && previousNavDate) return candidateNavDate > previousNavDate;
  const candidateAsOf = Date.parse(String(candidate.asOf || ''));
  const previousAsOf = Date.parse(String(previous.asOf || ''));
  if (!Number.isFinite(candidateAsOf)) return false;
  if (!Number.isFinite(previousAsOf)) return true;
  return candidateAsOf > previousAsOf;
}

export const __internals = {
  expectedPublishedNavDate,
  quotePayloadValidator,
  staleMaxAgeMs,
  buildQuoteEnvelope,
  CACHE_ENVELOPE_VERSION
};
