import {
  CACHE_POLICY,
  CACHE_STATUS,
  cacheExpirationTtlSeconds,
  createCacheEnvelope,
  isCacheEnvelope,
  isPayloadObject,
  resolveCacheStatus,
  validateCacheEnvelope
} from './cachePolicy.js';
import { kvGetJson, kvPutJson } from './storage.js';

const KLINE_META_SOURCE = 'kline-batch';

export function klineMetaCacheKey(market, symbol, interval = '1d') {
  return `kline-meta:${String(market || '').trim()}:${String(symbol || '').trim()}:${String(interval || '1d').trim()}`;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function candleDate(candle = '') {
  const direct = String(candle?.date || candle?.day || '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(direct)) return direct;
  const timestamp = Number(candle?.t ?? candle?.timestamp ?? 0);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '';
  return new Date(timestamp * 1000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
}

function closeValue(candle = {}) {
  return numberOrNull(candle.c ?? candle.close ?? candle.price);
}

function highValue(candle = {}) {
  return numberOrNull(candle.h ?? candle.high ?? candle.close ?? candle.price);
}

function returnForDays(candles, days) {
  if (!Array.isArray(candles) || candles.length < 2) return null;
  const latest = closeValue(candles[candles.length - 1]);
  const latestDate = Date.parse(`${candleDate(candles[candles.length - 1])}T00:00:00Z`);
  if (!(latest > 0) || !Number.isFinite(latestDate)) return null;
  const cutoff = latestDate - days * 86400000;
  let base = null;
  for (const candle of candles) {
    const date = Date.parse(`${candleDate(candle)}T00:00:00Z`);
    const close = closeValue(candle);
    if (Number.isFinite(date) && date <= cutoff && close > 0) base = close;
  }
  return base > 0 ? Math.round(((latest / base - 1) * 10000)) / 100 : null;
}

function drawdownPercentileFromCandles(candles) {
  const closes = (Array.isArray(candles) ? candles : [])
    .map(closeValue)
    .filter((v) => v != null && v > 0);
  if (closes.length < 2) return null;

  let runningMax = -Infinity;
  const drawdowns = closes.map((close) => {
    if (close > runningMax) runningMax = close;
    return (close / runningMax - 1) * 100;
  });

  const currentDrawdown = (closes[closes.length - 1] / runningMax - 1) * 100;
  if (!Number.isFinite(currentDrawdown)) return null;

  const shallowerOrEqual = drawdowns.filter((dd) => dd >= currentDrawdown).length;
  return Math.round((shallowerOrEqual / drawdowns.length) * 10000) / 100;
}

export function buildKlineMeta(payload = {}, { market = '', symbol = '', interval = '1d', source = KLINE_META_SOURCE, now = Date.now() } = {}) {
  if (!isPayloadObject(payload) || interval !== '1d') return null;
  const candles = Array.isArray(payload.candles) ? payload.candles.filter(Boolean).slice().sort((a, b) => String(candleDate(a)).localeCompare(String(candleDate(b)))) : [];
  const latestBarDate = candles.map(candleDate).filter(Boolean).at(-1) || String(payload.latestBarDate || '').slice(0, 10);
  const highPoint = payload.highPoint || null;
  const closeHighPoint = payload.closeHighPoint || null;
  const high = numberOrNull(highPoint?.high);
  const closeHigh = numberOrNull(closeHighPoint?.high);
  const generatedAt = String(payload.generatedAt || new Date(now).toISOString());
  if (!symbol || !latestBarDate && !(high > 0) && !(closeHigh > 0)) return null;
  return {
    market,
    symbol: String(symbol).trim(),
    interval,
    highPoint: high > 0 ? highPoint : null,
    closeHighPoint: closeHigh > 0 ? closeHighPoint : null,
    return1w: numberOrNull(payload.return1w) ?? returnForDays(candles, 7),
    return1m: numberOrNull(payload.return1m) ?? returnForDays(candles, 30),
    return3m: numberOrNull(payload.return3m) ?? returnForDays(candles, 90),
    return6m: numberOrNull(payload.return6m) ?? returnForDays(candles, 180),
    return1y: numberOrNull(payload.return1y) ?? returnForDays(candles, 365),
    historicalPercentile: numberOrNull(payload.historicalPercentile),
    drawdownPercentile: numberOrNull(payload.drawdownPercentile) ?? drawdownPercentileFromCandles(candles),
    latestBarDate,
    generatedAt,
    source
  };
}

function isKlineMetaPayload(payload) {
  return isPayloadObject(payload)
    && typeof payload.market === 'string'
    && typeof payload.symbol === 'string'
    && payload.interval === '1d'
    && (payload.highPoint == null || Number(payload.highPoint?.high) > 0)
    && (payload.closeHighPoint == null || Number(payload.closeHighPoint?.high) > 0)
    && typeof payload.generatedAt === 'string';
}

export async function readKlineMetaCache(env, { market, symbol, interval = '1d', now = Date.now(), allowStale = true } = {}) {
  const key = klineMetaCacheKey(market, symbol, interval);
  if (!market || !symbol || interval !== '1d') return { status: CACHE_STATUS.MISS, payload: null, envelope: null, key };
  const raw = await kvGetJson(env, key).catch(() => null);
  if (!raw) return { status: CACHE_STATUS.MISS, payload: null, envelope: null, key };
  if (!isCacheEnvelope(raw)) return { status: CACHE_STATUS.MISS, payload: null, envelope: null, key };
  const status = resolveCacheStatus(raw, { now, key, source: KLINE_META_SOURCE, payloadValidator: isKlineMetaPayload });
  if (status === CACHE_STATUS.MISS || (status === CACHE_STATUS.STALE && !allowStale)) {
    return { status: CACHE_STATUS.MISS, payload: null, envelope: raw, key };
  }
  return { status, payload: raw.payload, envelope: raw, key };
}

export async function writeKlineMetaCache(env, { market, symbol, interval = '1d', meta = null, now = Date.now() } = {}) {
  if (!env?.MARKETS_KV || !market || !symbol || interval !== '1d') return null;
  const key = klineMetaCacheKey(market, symbol, interval);
  const previous = await readKlineMetaCache(env, { market, symbol, interval, now, allowStale: true }).catch(() => null);
  const merged = {
    ...(previous?.payload || {}),
    ...(meta || {}),
    market,
    symbol: String(symbol).trim(),
    interval,
    generatedAt: String(meta?.generatedAt || previous?.payload?.generatedAt || new Date(now).toISOString()),
    source: KLINE_META_SOURCE
  };
  if (!isKlineMetaPayload(merged)) return null;
  const envelope = createCacheEnvelope({
    key,
    market,
    source: KLINE_META_SOURCE,
    fetchedAt: new Date(now),
    asOf: merged.latestBarDate || merged.generatedAt,
    validUntil: new Date(now + CACHE_POLICY.klineMeta.liveMs),
    staleUntil: new Date(now + CACHE_POLICY.klineMeta.staleMs),
    payload: merged
  });
  if (!envelope) return null;
  const expirationTtl = cacheExpirationTtlSeconds(envelope, { now });
  await kvPutJson(env, key, envelope, { ttlSeconds: expirationTtl }).catch(() => {});
  return envelope;
}

export const __internals = { isKlineMetaPayload, candleDate, returnForDays, KLINE_META_SOURCE };
