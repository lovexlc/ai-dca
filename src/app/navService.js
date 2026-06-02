import { getHoldingCodeList, isHoldingCode, round } from './holdingsCore.js';
import { fetchNavHistory, fetchNavHistoryBatch } from './navHistoryClient.js';
import { fetchFundMetrics } from './marketsApi.js';

const FUND_METRICS_ENDPOINT = '/api/markets/fund-metrics';
const latestInflight = new Map();

function normalizeCodes(codes = []) {
  return getHoldingCodeList((Array.isArray(codes) ? codes : [codes]).map((code) => ({ code })));
}

function roundNullable(value, precision = 4) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return round(n, precision);
}

function normalizeSnapshotItem(item = {}) {
  const code = String(item?.code || '').trim();
  if (!isHoldingCode(code)) return null;
  const latestNav = round(Number(item?.latestNav) || 0, 4);
  const previousNav = round(Number(item?.previousNav) || 0, 4);
  const source = String(item?.source || item?.priceSource || item?.cacheSource || '').trim();
  const price = roundNullable(item?.price ?? item?.currentPrice ?? item?.close, 4);
  const iopv = roundNullable(item?.iopv, 4);
  const navBase = roundNullable(item?.navBase, 4);
  const premiumPercent = roundNullable(item?.premiumPercent, 4);
  const valueType = price > 0 ? 'fund-metrics' : 'nav';
  return {
    ok: item?.ok !== false,
    code,
    name: String(item?.name || '').trim(),
    latestNav,
    latestNavDate: String(item?.latestNavDate || '').trim(),
    previousNav,
    previousNavDate: String(item?.previousNavDate || '').trim(),
    updatedAt: String(item?.updatedAt || '').trim(),
    error: String(item?.error || '').trim(),
    cacheHit: item?.cacheHit === true,
    cacheSource: String(item?.cacheSource || '').trim(),
    cacheKey: String(item?.cacheKey || '').trim(),
    source,
    price,
    currentPrice: price,
    close: price,
    previousClose: roundNullable(item?.previousClose, 4),
    change: roundNullable(item?.change, 4),
    changePercent: roundNullable(item?.changePercent, 4),
    iopv,
    navBase,
    premiumPercent,
    marketState: String(item?.marketState || '').trim(),
    asOf: String(item?.asOf || item?.updatedAt || '').trim(),
    quoteDate: String(item?.quoteDate || '').trim(),
    fallback: String(item?.fallback || '').trim(),
    cachePolicy: String(item?.cachePolicy || '').trim(),
    valueType
  };
}

function normalizeCacheMeta(cache = null) {
  if (!cache || typeof cache !== 'object') return null;
  return {
    key: String(cache.key || '').trim(),
    hit: cache.hit === true,
    source: String(cache.source || '').trim(),
    stale: cache.stale === true,
    codeCount: Math.max(Number(cache.codeCount) || 0, 0)
  };
}

function normalizeSnapshotPayload(payload = {}) {
  const items = (Array.isArray(payload?.items) ? payload.items : [])
    .map(normalizeSnapshotItem)
    .filter(Boolean);
  return {
    items,
    cache: normalizeCacheMeta(payload?.cache),
    successCount: Math.max(Number(payload?.successCount) || items.filter((item) => item.ok !== false).length, 0),
    failureCount: Math.max(Number(payload?.failureCount) || items.filter((item) => item.ok === false).length, 0),
    generatedAt: String(payload?.generatedAt || '').trim(),
    expiresAt: String(payload?.expiresAt || '').trim(),
    tradingSession: payload?.tradingSession === true,
    cachePolicy: String(payload?.cachePolicy || '').trim()
  };
}

async function fetchSnapshotBatch(codes = [], { forceRefresh = false } = {}) {
  const payload = await fetchFundMetrics(codes, { refresh: forceRefresh });
  return normalizeSnapshotPayload(payload);
}

export async function getNavSnapshots(codes = [], options = {}) {
  const normalizedCodes = normalizeCodes(codes);
  if (!normalizedCodes.length) {
    return { items: [], cache: null, successCount: 0, failureCount: 0, generatedAt: '', expiresAt: '' };
  }

  const batchSize = Math.max(1, Math.min(Number(options.batchSize) || 60, 60));
  const batches = [];
  for (let i = 0; i < normalizedCodes.length; i += batchSize) batches.push(normalizedCodes.slice(i, i + batchSize));

  const results = [];
  for (const batch of batches) {
    const key = `${options.forceRefresh === true ? 'force' : 'cache'}:${batch.join(',')}`;
    if (!options.forceRefresh && latestInflight.has(key)) {
      results.push(await latestInflight.get(key));
      continue;
    }
    const promise = fetchSnapshotBatch(batch, options);
    if (!options.forceRefresh) latestInflight.set(key, promise);
    try {
      results.push(await promise);
    } finally {
      latestInflight.delete(key);
    }
  }

  if (results.length === 1) return results[0];
  const items = results.flatMap((res) => res.items || []);
  const caches = results.map((res) => res.cache).filter(Boolean);
  return {
    items,
    cache: caches.length ? {
      key: caches.map((c) => c.key).filter(Boolean).join('+'),
      hit: caches.every((c) => c.hit === true),
      source: caches.map((c) => c.source).find(Boolean) || '',
      stale: caches.some((c) => c.stale === true),
      codeCount: items.length
    } : null,
    successCount: results.reduce((sum, res) => sum + (res.successCount || 0), 0),
    failureCount: results.reduce((sum, res) => sum + (res.failureCount || 0), 0),
    generatedAt: results.map((res) => res.generatedAt).filter(Boolean).sort().at(-1) || '',
    expiresAt: results.map((res) => res.expiresAt).filter(Boolean).sort().at(0) || ''
  };
}

export async function getNavSnapshot(code, options = {}) {
  const result = await getNavSnapshots([code], options);
  return (result.items || []).find((item) => item.code === String(code || '').trim()) || null;
}

export async function getNavHistory(code, { forceRefresh = false, ...options } = {}) {
  return fetchNavHistory({ code, ...options, forceLive: forceRefresh === true || options.forceLive === true });
}

export async function getNavHistoryBatch({ forceRefresh = false, ...options } = {}) {
  return fetchNavHistoryBatch({ ...options, forceLive: forceRefresh === true || options.forceLive === true });
}

export async function getCnEtfPremiumSnapshot(code, { price, qqqChangePercent, forceRefresh = false } = {}) {
  const snapshot = await getNavSnapshot(code, { forceRefresh });
  const priceValue = Number(snapshot?.price ?? snapshot?.currentPrice ?? price);
  const baseNav = Number(snapshot?.navBase ?? snapshot?.iopv ?? snapshot?.latestNav);
  if (!Number.isFinite(priceValue) || priceValue <= 0) throw new Error('缺少当前价格');
  if (!Number.isFinite(baseNav) || baseNav <= 0) throw new Error('缺少净值基准');
  return {
    symbol: String(code || '').trim(),
    price: priceValue,
    baseNav,
    navDate: snapshot?.navDate || snapshot?.latestNavDate || '',
    qqqChangePercent: Number.isFinite(Number(qqqChangePercent)) ? Number(qqqChangePercent) : null,
    iopv: Number(snapshot?.iopv) || baseNav,
    premiumPercent: Number.isFinite(Number(snapshot?.premiumPercent)) ? Number(snapshot.premiumPercent) : null,
    updatedAt: snapshot?.asOf || new Date().toISOString(),
    source: snapshot?.source || '',
    cache: snapshot ? {
      hit: snapshot.cached === true || snapshot.cacheHit === true,
      source: snapshot.cachePolicy || snapshot.cacheSource || snapshot.source || '',
      key: snapshot.cacheKey || ''
    } : null
  };
}

export function clearNavServiceMemoryCache() {
  latestInflight.clear();
}

export const __internals = {
  FUND_METRICS_ENDPOINT,
  normalizeCodes,
  normalizeSnapshotItem,
  normalizeSnapshotPayload
};
