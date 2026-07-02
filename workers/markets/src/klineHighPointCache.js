import { attachKlineHighPoint } from './klineHighPoint.js';
import { klineKey, kvGetJson, kvPutJson, r2GetJson, r2PutJson } from './storage.js';

const HIGH_POINT_TTL_SECONDS = 400 * 24 * 3600;

export function klineHighPointCacheKey(market, symbol, interval = '1d') {
  return `kline-high:${market}:${symbol}:${interval}`;
}

export function normalizeKlineHighPoint(value) {
  const raw = value?.highPoint && value?.high == null ? value.highPoint : value;
  const high = Number(raw?.high ?? raw?.yearHigh ?? raw?.price ?? raw);
  if (!Number.isFinite(high) || high <= 0) return null;
  const highDate = String(raw?.highDate || raw?.date || '').trim();
  const source = String(raw?.source || 'daily-kline-365d').trim();
  const daysBack = Number(raw?.daysBack);
  const count = Number(raw?.count);
  return {
    high,
    highDate,
    source,
    ...(Number.isFinite(daysBack) && daysBack > 0 ? { daysBack } : {}),
    ...(Number.isFinite(count) && count > 0 ? { count } : {})
  };
}

export async function readKlineHighPointCache(env, { market, symbol, interval = '1d' } = {}) {
  const keySymbol = String(symbol || '').trim();
  if (!market || !keySymbol || interval !== '1d') return null;
  const cached = await kvGetJson(env, klineHighPointCacheKey(market, keySymbol, interval)).catch(() => null);
  return normalizeKlineHighPoint(cached);
}

export async function writeKlineHighPointCache(env, { market, symbol, interval = '1d', highPoint } = {}) {
  const keySymbol = String(symbol || '').trim();
  const normalized = normalizeKlineHighPoint(highPoint);
  if (!market || !keySymbol || interval !== '1d' || !normalized) return null;
  await kvPutJson(env, klineHighPointCacheKey(market, keySymbol, interval), {
    ...normalized,
    market,
    symbol: keySymbol,
    interval,
    updatedAt: new Date().toISOString()
  }, { ttlSeconds: HIGH_POINT_TTL_SECONDS }).catch(() => {});
  return normalized;
}

export async function resolveKlineHighPointCache(env, { market, symbol, interval = '1d', hydrateFromR2 = false } = {}) {
  const cached = await readKlineHighPointCache(env, { market, symbol, interval });
  if (cached || !hydrateFromR2) return cached;

  const keySymbol = String(symbol || '').trim();
  if (!market || !keySymbol || interval !== '1d') return null;
  const r2Key = klineKey(market, keySymbol, interval);
  const payload = await r2GetJson(env, r2Key).catch(() => null);
  if (!payload || typeof payload !== 'object') return null;

  const withHigh = attachKlineHighPoint(payload, { interval, source: 'daily-kline-365d' });
  const highPoint = normalizeKlineHighPoint(withHigh?.highPoint);
  if (!highPoint) return null;

  await writeKlineHighPointCache(env, { market, symbol: keySymbol, interval, highPoint });
  if (!payload.highPoint) {
    await r2PutJson(env, r2Key, withHigh).catch(() => {});
  }
  return highPoint;
}
