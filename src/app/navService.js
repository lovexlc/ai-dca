import { getHoldingCodeList, isHoldingCode, round } from './holdingsCore.js';
import { fetchNavHistory, fetchNavHistoryBatch } from './navHistoryClient.js';

const HOLDINGS_NAV_ENDPOINT = '/api/holdings/nav';
const latestInflight = new Map();

function normalizeCodes(codes = []) {
  return getHoldingCodeList((Array.isArray(codes) ? codes : [codes]).map((code) => ({ code })));
}

function normalizeSnapshotItem(item = {}) {
  const code = String(item?.code || '').trim();
  if (!isHoldingCode(code)) return null;
  const latestNav = round(Number(item?.latestNav) || 0, 4);
  const previousNav = round(Number(item?.previousNav) || 0, 4);
  const source = String(item?.source || item?.priceSource || item?.cacheSource || '').trim();
  const valueType = source === 'exchange-quote' || source === 'sina-close-price' || source === 'eastmoney-exchange-quote' ? 'price' : 'nav';
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
    expiresAt: String(payload?.expiresAt || '').trim()
  };
}

async function fetchSnapshotBatch(codes = [], { forceRefresh = false } = {}) {
  const params = forceRefresh ? '?refresh=1' : '';
  const response = await fetch(`${HOLDINGS_NAV_ENDPOINT}${params}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ codes })
  });
  const rawText = await response.text();
  let payload = {};
  if (rawText) {
    try {
      payload = JSON.parse(rawText);
    } catch (_error) {
      payload = { error: response.ok ? '净值服务返回了非标准响应。' : rawText };
    }
  }
  if (!response.ok) {
    throw new Error(payload.error || `净值服务请求失败：状态 ${response.status}`);
  }
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
  const baseNav = Number(snapshot?.latestNav);
  const priceValue = Number(price);
  const qqqPct = Number(qqqChangePercent);
  if (!Number.isFinite(baseNav) || baseNav <= 0) throw new Error('缺少上一工作日净值');
  if (!Number.isFinite(priceValue) || priceValue <= 0) throw new Error('缺少当前价格');
  if (!Number.isFinite(qqqPct)) throw new Error('缺少 QQQ 涨幅');
  const iopv = baseNav * (1 + qqqPct / 100);
  return {
    symbol: String(code || '').trim(),
    price: priceValue,
    baseNav,
    navDate: snapshot?.latestNavDate || '',
    qqqChangePercent: qqqPct,
    iopv,
    premiumPercent: iopv > 0 ? ((priceValue - iopv) / iopv) * 100 : null,
    updatedAt: new Date().toISOString(),
    cache: snapshot ? {
      hit: snapshot.cacheHit === true,
      source: snapshot.cacheSource || snapshot.source || '',
      key: snapshot.cacheKey || ''
    } : null
  };
}

export function clearNavServiceMemoryCache() {
  latestInflight.clear();
}

export const __internals = {
  HOLDINGS_NAV_ENDPOINT,
  normalizeCodes,
  normalizeSnapshotItem,
  normalizeSnapshotPayload
};
