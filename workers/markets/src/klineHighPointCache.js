import { attachKlineHighPoint } from './klineHighPoint.js';
import { klineKey, r2GetJson, r2PutJson } from './storage.js';
import { CACHE_STATUS } from './cachePolicy.js';
import { readKlineMetaCache, writeKlineMetaCache } from './klineMetaCache.js';

export function normalizeKlineHighPoint(value, { defaultSource = 'daily-kline-365d' } = {}) {
  const raw = value?.highPoint && value?.high == null ? value.highPoint : value;
  const high = Number(raw?.high ?? raw?.yearHigh ?? raw?.price ?? raw);
  if (!Number.isFinite(high) || high <= 0) return null;
  const highDate = String(raw?.highDate || raw?.date || '').trim();
  const source = String(raw?.source || defaultSource).trim();
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

export function normalizeKlineCloseHighPoint(value) {
  const raw = value?.closeHighPoint && value?.high == null ? value.closeHighPoint : value;
  return normalizeKlineHighPoint(raw, { defaultSource: 'daily-close-kline-365d' });
}

export async function readKlineHighPointCache(env, { market, symbol, interval = '1d' } = {}) {
  const keySymbol = String(symbol || '').trim();
  if (!market || !keySymbol || interval !== '1d') return null;
  const meta = await readKlineMetaCache(env, { market, symbol: keySymbol, interval, allowStale: true }).catch(() => null);
  if (meta?.status !== CACHE_STATUS.MISS) {
    const normalizedMeta = normalizeKlineHighPoint(meta.payload?.highPoint);
    if (normalizedMeta) return normalizedMeta;
  }
  return null;
}

export async function readKlineCloseHighPointCache(env, { market, symbol, interval = '1d' } = {}) {
  const keySymbol = String(symbol || '').trim();
  if (!market || !keySymbol || interval !== '1d') return null;
  const meta = await readKlineMetaCache(env, { market, symbol: keySymbol, interval, allowStale: true }).catch(() => null);
  if (meta?.status !== CACHE_STATUS.MISS) {
    const normalizedMeta = normalizeKlineCloseHighPoint(meta.payload?.closeHighPoint);
    if (normalizedMeta) return normalizedMeta;
  }
  return null;
}

export async function writeKlineHighPointCache(env, { market, symbol, interval = '1d', highPoint } = {}) {
  const keySymbol = String(symbol || '').trim();
  const normalized = normalizeKlineHighPoint(highPoint);
  if (!market || !keySymbol || interval !== '1d' || !normalized) return null;
  await writeKlineMetaCache(env, {
    market,
    symbol: keySymbol,
    interval,
    meta: { highPoint: normalized }
  }).catch(() => {});
  return normalized;
}

export async function writeKlineCloseHighPointCache(env, { market, symbol, interval = '1d', closeHighPoint } = {}) {
  const keySymbol = String(symbol || '').trim();
  const normalized = normalizeKlineCloseHighPoint(closeHighPoint);
  if (!market || !keySymbol || interval !== '1d' || !normalized) return null;
  await writeKlineMetaCache(env, {
    market,
    symbol: keySymbol,
    interval,
    meta: { closeHighPoint: normalized }
  }).catch(() => {});
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
  await writeKlineCloseHighPointCache(env, { market, symbol: keySymbol, interval, closeHighPoint: withHigh?.closeHighPoint });
  if (!payload.highPoint || !payload.closeHighPoint) {
    await r2PutJson(env, r2Key, withHigh).catch(() => {});
  }
  return highPoint;
}

export async function resolveKlineCloseHighPointCache(env, { market, symbol, interval = '1d', hydrateFromR2 = false } = {}) {
  const cached = await readKlineCloseHighPointCache(env, { market, symbol, interval });
  if (cached || !hydrateFromR2) return cached;

  const keySymbol = String(symbol || '').trim();
  if (!market || !keySymbol || interval !== '1d') return null;
  const r2Key = klineKey(market, keySymbol, interval);
  const payload = await r2GetJson(env, r2Key).catch(() => null);
  if (!payload || typeof payload !== 'object') return null;

  const withHigh = attachKlineHighPoint(payload, { interval, source: 'daily-kline-365d' });
  const closeHighPoint = normalizeKlineCloseHighPoint(withHigh?.closeHighPoint);
  if (!closeHighPoint) return null;

  await writeKlineHighPointCache(env, { market, symbol: keySymbol, interval, highPoint: withHigh?.highPoint });
  await writeKlineCloseHighPointCache(env, { market, symbol: keySymbol, interval, closeHighPoint });
  if (!payload.highPoint || !payload.closeHighPoint) {
    await r2PutJson(env, r2Key, withHigh).catch(() => {});
  }
  return closeHighPoint;
}
