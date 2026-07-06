import { getHoldingCodeList, isHoldingCode, round } from './holdingsCore.js';
import { fetchNavHistory, fetchNavHistoryBatch } from './navHistoryClient.js';
import { fetchFundMetrics } from './marketsApi.js';
import { FUND_METRICS_SNAPSHOT_CACHE_KEY } from './marketCacheKeys.js';

const FUND_METRICS_ENDPOINT = '/api/markets/fund-metrics';
const LOCAL_SNAPSHOT_CACHE_KEY = FUND_METRICS_SNAPSHOT_CACHE_KEY;
const MAX_LOCAL_SNAPSHOT_RECORDS = 500;
const REALTIME_SNAPSHOT_TTL_MS = 45 * 1000;
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
  const volume = roundNullable(item?.volume, 0);
  const turnover = roundNullable(item?.turnover ?? item?.amount, 2);
  const marketCapital = roundNullable(item?.marketCapital ?? item?.marketCap ?? item?.market_capital, 2);
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
    volume,
    turnover,
    marketCapital,
    iopv,
    navBase,
    premiumPercent,
    marketState: String(item?.marketState || '').trim(),
    asOf: String(item?.asOf || item?.updatedAt || '').trim(),
    quoteDate: String(item?.quoteDate || '').trim(),
    fallback: String(item?.fallback || '').trim(),
    cachePolicy: String(item?.cachePolicy || '').trim(),
    valueType,
    ytdReturn: item?.ytdReturn ?? null,
    return1w: item?.return1w ?? null,
    return1m: item?.return1m ?? null,
    return3m: item?.return3m ?? null,
    return6m: item?.return6m ?? null,
    return1y: item?.return1y ?? null,
    returnBase: item?.returnBase ?? null,
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

function readLocalSnapshotBucket() {
  if (typeof window === 'undefined' || !window.localStorage) return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LOCAL_SNAPSHOT_CACHE_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeLocalSnapshotBucket(bucket = {}) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const nowMs = Date.now();
    const entries = Object.entries(bucket)
      .filter(([, entry]) => isValidLocalSnapshotEntry(entry, nowMs))
      .sort((a, b) => Number(b[1]?.cachedAtMs || 0) - Number(a[1]?.cachedAtMs || 0))
      .slice(0, MAX_LOCAL_SNAPSHOT_RECORDS);
    window.localStorage.setItem(LOCAL_SNAPSHOT_CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // localStorage is an acceleration layer; failures should not block live data.
  }
}

function isValidLocalSnapshotEntry(entry, nowMs = Date.now()) {
  if (!entry || entry.source !== 'fund-metrics') return false;
  const expiresAtMs = Date.parse(String(entry.expiresAt || ''));
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) return false;
  const item = normalizeSnapshotItem(entry.item);
  if (!item || item.code !== String(entry.code || '').trim()) return false;
  const value = Number(item.price ?? item.currentPrice ?? item.close ?? item.latestNav);
  return Number.isFinite(value) && value > 0;
}

function readCachedSnapshotItems(codes = [], nowMs = Date.now()) {
  const bucket = readLocalSnapshotBucket();
  const items = [];
  const missing = [];
  for (const code of normalizeCodes(codes)) {
    const entry = bucket[code];
    if (isValidLocalSnapshotEntry(entry, nowMs)) {
      items.push(normalizeSnapshotItem(entry.item));
    } else {
      missing.push(code);
    }
  }
  return { items, missing };
}

function writeCachedSnapshotItems(items = [], expiresAt = '', nowMs = Date.now()) {
  const expiresAtMs = Date.parse(String(expiresAt || ''));
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) return false;
  const bucket = readLocalSnapshotBucket();
  let changed = false;
  for (const rawItem of Array.isArray(items) ? items : []) {
    const item = normalizeSnapshotItem(rawItem);
    if (!item || item.ok === false) continue;
    bucket[item.code] = {
      code: item.code,
      item,
      expiresAt,
      cachedAtMs: nowMs,
      source: 'fund-metrics'
    };
    changed = true;
  }
  if (changed) writeLocalSnapshotBucket(bucket);
  return changed;
}

function orderSnapshotItems(codes = [], items = []) {
  const byCode = new Map((Array.isArray(items) ? items : []).map((item) => [String(item?.code || '').trim(), item]));
  return normalizeCodes(codes).map((code) => byCode.get(code)).filter(Boolean);
}

async function fetchSnapshotBatch(codes = [], { forceRefresh = false, fundKinds = null } = {}) {
  const payload = await fetchFundMetrics(codes, { refresh: forceRefresh, fundKinds });
  return normalizeSnapshotPayload(payload);
}

async function fetchSnapshotBatchWithLocalCache(codes = [], options = {}) {
  const normalizedCodes = normalizeCodes(codes);
  if (!normalizedCodes.length) return normalizeSnapshotPayload({ items: [] });

  const nowMs = Date.now();
  const cached = options.forceRefresh ? { items: [], missing: normalizedCodes } : readCachedSnapshotItems(normalizedCodes, nowMs);
  if (!cached.missing.length) {
    return {
      items: orderSnapshotItems(normalizedCodes, cached.items),
      cache: { key: LOCAL_SNAPSHOT_CACHE_KEY, hit: true, source: 'localStorage', stale: false, codeCount: normalizedCodes.length },
      successCount: cached.items.length,
      failureCount: 0,
      generatedAt: new Date(nowMs).toISOString(),
      expiresAt: '',
      tradingSession: false,
      cachePolicy: 'localStorage'
    };
  }

  const fresh = await fetchSnapshotBatch(cached.missing, options);
  writeCachedSnapshotItems(fresh.items || [], fresh.expiresAt, nowMs);
  const mergedItems = orderSnapshotItems(normalizedCodes, [...cached.items, ...(fresh.items || [])]);
  return {
    ...fresh,
    items: mergedItems,
    cache: cached.items.length ? {
      key: [LOCAL_SNAPSHOT_CACHE_KEY, fresh.cache?.key].filter(Boolean).join('+'),
      hit: false,
      source: 'localStorage+live',
      stale: fresh.cache?.stale === true,
      codeCount: mergedItems.length,
      worker: fresh.cache || null
    } : fresh.cache,
    successCount: mergedItems.filter((item) => item.ok !== false).length,
    failureCount: mergedItems.filter((item) => item.ok === false).length
  };
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
    const promise = fetchSnapshotBatchWithLocalCache(batch, options);
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
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.removeItem(LOCAL_SNAPSHOT_CACHE_KEY);
    } catch {
      // ignore
    }
  }
}

export const __internals = {
  FUND_METRICS_ENDPOINT,
  LOCAL_SNAPSHOT_CACHE_KEY,
  REALTIME_SNAPSHOT_TTL_MS,
  normalizeCodes,
  normalizeSnapshotItem,
  normalizeSnapshotPayload,
  isValidLocalSnapshotEntry,
  readCachedSnapshotItems,
  writeCachedSnapshotItems,
  orderSnapshotItems
};

export function cacheRealtimeSnapshotItems(items = [], nowMs = Date.now()) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return false;
  const expiresAt = new Date(nowMs + REALTIME_SNAPSHOT_TTL_MS).toISOString();
  return writeCachedSnapshotItems(list, expiresAt, nowMs);
}

/**
 * 将 WS 推送的行情数据合并到已有的 navSnapshots 中。
 * 只更新价格相关字段，保留原有非价格字段不变。
 *
 * @param {Array<object>} existing - 现有的 navSnapshots.items
 * @param {Array<object>} pushItems - WS 推送的 price_push items
 * @returns {Array<object>} 合并后的新数组（不修改原数组）
 */
export function mergePricePushItems(existing = [], pushItems = []) {
  if (!Array.isArray(existing) || !existing.length) return existing;
  if (!Array.isArray(pushItems) || !pushItems.length) return existing;

  // 构建 code -> pushItem 的索引
  const pushMap = new Map();
  for (const item of pushItems) {
    const code = String(item?.code || '').trim();
    if (code) pushMap.set(code, item);
  }

  if (pushMap.size === 0) return existing;

  let changed = false;
  const merged = existing.map((snapshot) => {
    const code = String(snapshot?.code || '').trim();
    const pushItem = pushMap.get(code);
    if (!pushItem) return snapshot;

    const updated = { ...snapshot };
    if (pushItem.price != null && pushItem.price > 0) {
      updated.price = round(Number(pushItem.price), 4);
      updated.currentPrice = updated.price;
      updated.close = updated.price;
    }
    if (pushItem.change != null) {
      updated.change = roundNullable(pushItem.change, 4);
    }
    if (pushItem.changePercent != null) {
      updated.changePercent = roundNullable(pushItem.changePercent, 4);
    }
    if (pushItem.prevClose != null || pushItem.previousClose != null) {
      const prevClose = pushItem.prevClose ?? pushItem.previousClose;
      updated.previousClose = roundNullable(prevClose, 4);
      updated.previousNav = roundNullable(prevClose, 4);
    }
    if (pushItem.premiumPercent != null) {
      updated.premiumPercent = roundNullable(pushItem.premiumPercent, 4);
    }
    if (pushItem.volume != null) {
      updated.volume = roundNullable(pushItem.volume, 0);
    }
    if (pushItem.turnover != null || pushItem.amount != null) {
      updated.turnover = roundNullable(pushItem.turnover ?? pushItem.amount, 2);
    }
    if (pushItem.marketCapital != null || pushItem.marketCap != null || pushItem.market_capital != null) {
      updated.marketCapital = roundNullable(pushItem.marketCapital ?? pushItem.marketCap ?? pushItem.market_capital, 2);
    }
    if (pushItem.latestNav != null) {
      updated.latestNav = round(Number(pushItem.latestNav), 4);
    }
    if (pushItem.latestNavDate) {
      updated.latestNavDate = String(pushItem.latestNavDate).trim();
      updated.navDate = updated.latestNavDate;
    }
    if (pushItem.estimatedNav != null) {
      updated.estimatedNav = roundNullable(pushItem.estimatedNav, 4);
    }
    if (pushItem.estimatedNavSource) {
      updated.estimatedNavSource = String(pushItem.estimatedNavSource).trim();
    }
    if (pushItem.navBase != null) {
      updated.navBase = roundNullable(pushItem.navBase, 4);
    }
    if (pushItem.iopv != null) {
      updated.iopv = roundNullable(pushItem.iopv, 4);
    }
    if (pushItem.marketState) {
      updated.marketState = String(pushItem.marketState).trim();
    }
    if (pushItem.asOf) {
      updated.asOf = String(pushItem.asOf).trim();
    }
    if (pushItem.quoteAt) {
      updated.quoteAt = String(pushItem.quoteAt).trim();
      updated.asOf = updated.quoteAt;
    }
    if (pushItem.quoteDate) {
      updated.quoteDate = String(pushItem.quoteDate).trim();
    }
    if (pushItem.source) {
      updated.source = String(pushItem.source).trim();
    }
    changed = true;
    return updated;
  });

  return changed ? merged : existing;
}
