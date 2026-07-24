/*
 * Business freshness is deliberately kept separate from KV expiration.
 * KV expiration only bounds physical retention; callers must use the status
 * returned by resolveCacheStatus before using a cached payload.
 */

export const CACHE_ENVELOPE_VERSION = 2;

export const CACHE_STATUS = Object.freeze({
  FRESH: 'fresh',
  DELAYED: 'delayed',
  STALE: 'stale',
  MISS: 'miss'
});

export const CACHE_POLICY = Object.freeze({
  quote: Object.freeze({
    cn: Object.freeze({ liveMs: 120 * 1000, closedMs: 24 * 3600 * 1000, staleMs: 6 * 3600 * 1000 }),
    us: Object.freeze({ liveMs: 60 * 1000, closedMs: 30 * 60 * 1000, staleMs: 2 * 3600 * 1000 }),
    otc: Object.freeze({ liveMs: 24 * 3600 * 1000, closedMs: 24 * 3600 * 1000, staleMs: 7 * 24 * 3600 * 1000 }),
    qdii: Object.freeze({ liveMs: 24 * 3600 * 1000, closedMs: 24 * 3600 * 1000, staleMs: 3 * 24 * 3600 * 1000 })
  }),
  fundMetrics: Object.freeze({ liveMs: 120 * 1000, closedMs: 24 * 3600 * 1000, staleMs: 24 * 3600 * 1000 }),
  klineMeta: Object.freeze({ liveMs: 24 * 3600 * 1000, staleMs: 7 * 24 * 3600 * 1000 }),
  kline: Object.freeze({ dailyMs: 24 * 3600 * 1000, dailyStaleMs: 7 * 24 * 3600 * 1000, intradayMs: 60 * 1000, intradayStaleMs: 24 * 3600 * 1000 }),
  navHistory: Object.freeze({ currentMonthMs: 30 * 60 * 1000, staleMs: 30 * 24 * 3600 * 1000 }),
  fundLimit: Object.freeze({ validMs: 24 * 3600 * 1000, staleMs: 7 * 24 * 3600 * 1000 }),
  news: Object.freeze({ validMs: 60 * 60 * 1000, staleMs: 2 * 3600 * 1000 })
});

function asTimestamp(value) {
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(String(value || ''));
  return Number.isFinite(timestamp) ? timestamp : NaN;
}

function isoOrEmpty(value, fallback = '') {
  const timestamp = asTimestamp(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : fallback;
}

export function createCacheEnvelope({
  key,
  market = '',
  fundKind = '',
  source = '',
  fetchedAt = new Date().toISOString(),
  asOf = '',
  validUntil,
  staleUntil,
  payload
} = {}) {
  const fetchedTimestamp = asTimestamp(fetchedAt);
  const validTimestamp = asTimestamp(validUntil);
  const staleTimestamp = asTimestamp(staleUntil);
  if (!String(key || '').trim() || !String(source || '').trim() || !Number.isFinite(fetchedTimestamp)
    || !Number.isFinite(validTimestamp) || !Number.isFinite(staleTimestamp)
    || staleTimestamp < validTimestamp || payload == null) {
    return null;
  }
  return {
    version: CACHE_ENVELOPE_VERSION,
    key: String(key).trim(),
    market: String(market || '').trim(),
    fundKind: String(fundKind || '').trim(),
    source: String(source).trim(),
    fetchedAt: new Date(fetchedTimestamp).toISOString(),
    asOf: isoOrEmpty(asOf),
    validUntil: new Date(validTimestamp).toISOString(),
    staleUntil: new Date(staleTimestamp).toISOString(),
    payload
  };
}

export function isCacheEnvelope(value) {
  return Boolean(value && typeof value === 'object'
    && value.version === CACHE_ENVELOPE_VERSION
    && typeof value.key === 'string'
    && typeof value.source === 'string'
    && typeof value.fetchedAt === 'string'
    && typeof value.validUntil === 'string'
    && typeof value.staleUntil === 'string'
    && value.payload != null);
}

function sourceMatches(source, expectedSource) {
  if (expectedSource == null || expectedSource === '') return true;
  if (expectedSource instanceof Set) return expectedSource.has(source);
  if (Array.isArray(expectedSource)) return expectedSource.includes(source);
  return source === expectedSource;
}

export function validateCacheEnvelope(envelope, {
  key = '',
  source,
  payloadValidator
} = {}) {
  if (!isCacheEnvelope(envelope)) return false;
  if (key && envelope.key !== key) return false;
  if (!sourceMatches(envelope.source, source)) return false;
  if (!Number.isFinite(asTimestamp(envelope.fetchedAt))
    || !Number.isFinite(asTimestamp(envelope.validUntil))
    || !Number.isFinite(asTimestamp(envelope.staleUntil))) return false;
  if (asTimestamp(envelope.staleUntil) < asTimestamp(envelope.validUntil)) return false;
  return typeof payloadValidator === 'function' ? payloadValidator(envelope.payload) : true;
}

export function resolveCacheStatus(envelope, {
  now = Date.now(),
  key = '',
  source,
  payloadValidator,
  delayed = false
} = {}) {
  if (!validateCacheEnvelope(envelope, { key, source, payloadValidator })) return CACHE_STATUS.MISS;
  const nowTimestamp = now instanceof Date ? now.getTime() : Number(now);
  const validUntil = asTimestamp(envelope.validUntil);
  const staleUntil = asTimestamp(envelope.staleUntil);
  if (!Number.isFinite(nowTimestamp) || nowTimestamp > staleUntil) return CACHE_STATUS.MISS;
  if (delayed) return CACHE_STATUS.DELAYED;
  return nowTimestamp <= validUntil ? CACHE_STATUS.FRESH : CACHE_STATUS.STALE;
}

export function cacheExpirationTtlSeconds(envelope, { now = Date.now(), minimum = 60 } = {}) {
  const nowTimestamp = now instanceof Date ? now.getTime() : Number(now);
  const staleUntil = asTimestamp(envelope?.staleUntil);
  if (!Number.isFinite(nowTimestamp) || !Number.isFinite(staleUntil)) return undefined;
  const seconds = Math.ceil((staleUntil - nowTimestamp) / 1000);
  return seconds > minimum ? seconds : undefined;
}

export function cacheWindow({ validMs, staleMs, now = Date.now() } = {}) {
  const nowTimestamp = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(nowTimestamp) || !Number.isFinite(validMs) || !Number.isFinite(staleMs)) return null;
  return {
    validUntil: new Date(nowTimestamp + Math.max(0, validMs)).toISOString(),
    staleUntil: new Date(nowTimestamp + Math.max(0, validMs) + Math.max(0, staleMs)).toISOString()
  };
}

export function isPayloadObject(payload) {
  return Boolean(payload && typeof payload === 'object' && !Array.isArray(payload));
}

export function isPayloadArray(payload) {
  return Array.isArray(payload);
}
