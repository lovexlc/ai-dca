// marketDataPush.js —— 行情数据 WS 推送
//
// 在交易时段定时从 markets worker 拉取订阅代码的最新行情，
// 通过 WsHub Durable Object 推送给已订阅的 WS 连接。

import { getSubscriptionSnapshot, tryPublishPrices } from './wsHub.js';
import { readSettings } from './notifyStorage.js';
import { hasWebWsCapability } from './gcm.js';
import { redisMGetJson, shouldFetchMarketsOnRedisMiss } from './redisCache.js';

// markets worker 的基础 URL（与前端 marketsApi.js 一致）
const MARKETS_API_BASE = 'https://api.freebacktrack.tech/api/markets';

// KV 缓存 key 前缀，避免同一代码在短时间内重复请求
const PRICE_CACHE_PREFIX = 'market-push-cache:';
const PRICE_CACHE_TTL = 90; // 秒
const MARKET_TOPICS = ['market.price', 'market.premium'];

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function positiveNumberOrNull(value) {
  const n = numberOrNull(value);
  return n != null && n > 0 ? n : null;
}

function roundNumber(value, precision = 4) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const factor = 10 ** precision;
  return Math.round(n * factor) / factor;
}

/**
 * 从 markets worker 批量获取 fund-metrics 数据。
 */
async function fetchFundMetricsFromMarkets(codes, env) {
  if (!codes.length) return [];
  const url = `${MARKETS_API_BASE}/fund-metrics`;
  try {
    const init = {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'accept': 'application/json' },
      body: JSON.stringify({ codes }),
    };
    const res = env?.MARKETS && typeof env.MARKETS.fetch === 'function'
      ? await env.MARKETS.fetch(new Request(url, init))
      : await fetch(url, init);
    if (!res.ok) {
      console.log('[marketPush] fund-metrics fetch failed', JSON.stringify({ status: res.status }));
      return [];
    }
    const data = await res.json().catch(() => null);
    return Array.isArray(data?.items) ? data.items : [];
  } catch (error) {
    console.log('[marketPush] fund-metrics fetch error', JSON.stringify({
      message: error instanceof Error ? error.message : String(error),
    }));
    return [];
  }
}

async function fetchFundMetricsFromRedis(codes, env) {
  const uniqueCodes = Array.from(new Set((Array.isArray(codes) ? codes : []).map((code) => String(code || '').trim()).filter(Boolean)));
  if (!uniqueCodes.length) return { items: [], missing: [] };
  const byKey = await redisMGetJson(env, uniqueCodes.map((code) => `fund-metrics:${code}`));
  const items = [];
  const missing = [];
  for (const code of uniqueCodes) {
    const item = byKey[`fund-metrics:${code}`];
    if (item && (Number(item.price) > 0 || Number(item.latestNav) > 0)) {
      items.push({ ...item, cache: { hit: true, source: 'redis' } });
    } else {
      missing.push(code);
    }
  }
  return { items, missing };
}

/**
 * 从 markets worker 批量获取 quotes 数据（美股等）。
 */
async function fetchQuotesFromMarkets(symbols, env) {
  if (!symbols.length) return [];
  const url = `${MARKETS_API_BASE}/quotes?symbols=${encodeURIComponent(symbols.join(','))}`;
  try {
    const init = { method: 'GET', headers: { 'accept': 'application/json' } };
    const res = env?.MARKETS && typeof env.MARKETS.fetch === 'function'
      ? await env.MARKETS.fetch(new Request(url, init))
      : await fetch(url, init);
    if (!res.ok) return [];
    const data = await res.json().catch(() => null);
    if (data?.quotes && typeof data.quotes === 'object' && !Array.isArray(data.quotes)) {
      return Object.values(data.quotes);
    }
    return Array.isArray(data?.quotes) ? data.quotes : (Array.isArray(data) ? data : []);
  } catch {
    return [];
  }
}

async function fetchQuotesFromRedis(symbols, env) {
  const uniqueSymbols = Array.from(new Set((Array.isArray(symbols) ? symbols : []).map((symbol) => String(symbol || '').trim()).filter(Boolean)));
  if (!uniqueSymbols.length) return { items: [], missing: [] };
  const byKey = await redisMGetJson(env, uniqueSymbols.map((symbol) => `quote:${symbol}`));
  const items = [];
  const missing = [];
  for (const symbol of uniqueSymbols) {
    const item = byKey[`quote:${symbol}`];
    if (item && (Number(item.price) > 0 || Number(item.currentPrice) > 0 || Number(item.close) > 0 || Number(item.latestNav) > 0)) {
      items.push({ ...item, code: item.code || item.symbol || symbol, cache: { hit: true, source: 'redis' } });
    } else {
      missing.push(symbol);
    }
  }
  return { items, missing };
}

/**
 * 判断代码是否为 A 股基金/ETF（6位数字，前缀 15/50/51/52/56/58/53/54）。
 */
function isCnFundCode(code) {
  return /^(15|50|51|52|53|54|56|58)\d{4}$/.test(code);
}

function isWebWsDeviceId(value = '') {
  return String(value || '').trim().startsWith('web-ws:');
}

/**
 * 将 markets 数据标准化为 WS market_snapshot item。
 */
export function normalizeMarketSnapshotItem(item) {
  const code = String(item?.code || item?.symbol || '').trim();
  if (!code) return null;
  const price = positiveNumberOrNull(item?.price ?? item?.currentPrice ?? item?.close);
  const latestNav = positiveNumberOrNull(item?.latestNav);
  const navBase = positiveNumberOrNull(item?.navBase);
  const iopv = positiveNumberOrNull(item?.iopv);
  const estimatedNav = positiveNumberOrNull(item?.estimatedNav ?? item?.estimateNav ?? item?.estimate_nav ?? item?.iopv);
  const premiumBase = estimatedNav ?? iopv ?? navBase ?? latestNav;
  const explicitPremium = numberOrNull(item?.premiumPercent);
  const premiumPercentRaw = explicitPremium != null
    ? explicitPremium
    : (price != null && premiumBase != null && premiumBase > 0 ? ((price - premiumBase) / premiumBase) * 100 : null);
  const premiumPercent = roundNumber(premiumPercentRaw, 4);
  const prevClose = positiveNumberOrNull(item?.previousClose ?? item?.prevClose ?? item?.previousNav);
  const volume = numberOrNull(item?.volume);
  const turnover = numberOrNull(item?.turnover ?? item?.amount);
  const marketCapital = numberOrNull(item?.marketCapital ?? item?.marketCap ?? item?.market_capital);
  const quoteAt = String(item?.asOf || item?.quoteAt || item?.updatedAt || item?.quoteDate || '').trim();
  return {
    code,
    name: String(item?.name || '').trim(),
    market: String(item?.market || '').trim() || (isCnFundCode(code) ? 'cn' : ''),
    kind: isCnFundCode(code) ? 'exchange_fund' : String(item?.kind || item?.assetType || '').trim(),
    fundKind: String(item?.fundKind || '').trim(),
    price: price ?? 0,
    prevClose,
    previousClose: prevClose,
    change: numberOrNull(item?.change) ?? 0,
    changePercent: numberOrNull(item?.changePercent) ?? 0,
    volume,
    turnover,
    marketCapital,
    premiumPercent,
    latestNav,
    latestNavDate: String(item?.latestNavDate || item?.navDate || '').trim(),
    estimatedNav,
    estimatedNavSource: estimatedNav != null ? String(item?.estimatedNavSource || (iopv != null ? 'iopv' : '')).trim() : '',
    navBase,
    navBaseSource: navBase != null ? String(item?.navBaseSource || '').trim() : '',
    iopv,
    marketState: String(item?.marketState || '').trim(),
    quoteAt,
    quoteDate: String(item?.quoteDate || '').trim(),
    asOf: quoteAt,
    source: String(item?.source || '').trim(),
    updatedAt: String(item?.updatedAt || '').trim(),
  };
}

export const normalizePriceItem = normalizeMarketSnapshotItem;

/**
 * 从 KV 缓存读取已推送的行情，避免短时间内重复推送相同数据。
 */
async function getCachedPrices(env, codes) {
  if (!env.NOTIFY_STATE || !codes.length) return {};
  const cached = {};
  await Promise.all(codes.map(async (code) => {
    try {
      const raw = await env.NOTIFY_STATE.get(`${PRICE_CACHE_PREFIX}${code}`);
      if (raw) cached[code] = JSON.parse(raw);
    } catch { /* ignore */ }
  }));
  return cached;
}

async function setCachedPrices(env, items) {
  if (!env.NOTIFY_STATE || !items.length) return;
  await Promise.all(items.map(async (item) => {
    if (!item?.code) return;
    try {
      await env.NOTIFY_STATE.put(
        `${PRICE_CACHE_PREFIX}${item.code}`,
        JSON.stringify(item),
        { expirationTtl: PRICE_CACHE_TTL },
      );
    } catch { /* ignore */ }
  }));
}

/**
 * 判断两次价格是否有显著变化（避免推送无意义的相同数据）。
 */
function hasSignificantChange(oldItem, newItem) {
  if (!oldItem) return true;
  return (
    oldItem.price !== newItem.price ||
    oldItem.change !== newItem.change ||
    oldItem.changePercent !== newItem.changePercent ||
    oldItem.premiumPercent !== newItem.premiumPercent ||
    oldItem.marketState !== newItem.marketState ||
    oldItem.latestNav !== newItem.latestNav ||
    oldItem.latestNavDate !== newItem.latestNavDate ||
    oldItem.estimatedNav !== newItem.estimatedNav ||
    oldItem.quoteAt !== newItem.quoteAt
  );
}

/**
 * 主入口：遍历所有活跃 WsHub，收集订阅代码，拉取行情，推送。
 * 由 notify worker 的 scheduled handler 调用。
 */
export async function runMarketDataPush(env) {
  const settings = await readSettings(env);
  const registrations = Array.isArray(settings.gcmRegistrations) ? settings.gcmRegistrations : [];

  // 只扫描 WebSocket 虚拟设备；没有在线连接/订阅时不请求上游行情源。
  const allDeviceIds = registrations
    .filter((r) => hasWebWsCapability(r, 'market'))
    .map((r) => String(r?.deviceInstallationId || r?.id || '').trim())
    .filter(isWebWsDeviceId);

  if (!allDeviceIds.length) {
    return { skipped: true, reason: 'no-devices' };
  }

  // 并发获取每个设备的在线连接数与订阅代码。
  const deviceSubscriptions = await Promise.all(
    allDeviceIds.map(async (deviceId) => {
      const snapshot = await getSubscriptionSnapshot(env, deviceId);
      return {
        deviceId,
        symbols: snapshot.symbols,
        connections: snapshot.connections,
      };
    })
  );

  const activeSubscriptions = deviceSubscriptions.filter((d) => d.connections > 0 && d.symbols.length > 0);

  if (!activeSubscriptions.length) {
    return { skipped: true, reason: 'no-online-subscriptions' };
  }

  // 去重：收集所有订阅代码
  const allSymbolsSet = new Set();
  for (const sub of activeSubscriptions) {
    for (const s of sub.symbols) allSymbolsSet.add(s);
  }
  const allSymbols = [...allSymbolsSet];

  // 分类：A 股基金 vs 美股/其他
  const cnCodes = allSymbols.filter(isCnFundCode);
  const otherSymbols = allSymbols.filter((s) => !isCnFundCode(s));

  // 并发读取 Redis；缺失时再按灰度策略回退 markets service binding。
  const [cnRedis, otherRedis] = await Promise.all([
    cnCodes.length ? fetchFundMetricsFromRedis(cnCodes, env) : Promise.resolve({ items: [], missing: [] }),
    otherSymbols.length ? fetchQuotesFromRedis(otherSymbols, env) : Promise.resolve({ items: [], missing: [] }),
  ]);
  const canFallback = shouldFetchMarketsOnRedisMiss(env);
  const [cnFallbackItems, otherFallbackItems] = await Promise.all([
    canFallback && cnRedis.missing.length ? fetchFundMetricsFromMarkets(cnRedis.missing, env) : Promise.resolve([]),
    canFallback && otherRedis.missing.length ? fetchQuotesFromMarkets(otherRedis.missing, env) : Promise.resolve([]),
  ]);

  // 合并并标准化
  const allItems = [...cnRedis.items, ...otherRedis.items, ...cnFallbackItems, ...otherFallbackItems]
    .map(normalizeMarketSnapshotItem)
    .filter(Boolean);

  if (!allItems.length) {
    return { skipped: true, reason: 'no-data' };
  }

  // 读取缓存，过滤掉没有显著变化的数据
  const cachedPrices = await getCachedPrices(env, allSymbols);
  const changedItems = allItems.filter((item) => hasSignificantChange(cachedPrices[item.code], item));

  if (!changedItems.length) {
    return { skipped: true, reason: 'no-changes', total: allItems.length };
  }

  // 更新缓存
  await setCachedPrices(env, changedItems);

  // 推送到每个有订阅的设备
  let totalDelivered = 0;
  let totalFailed = 0;

  for (const { deviceId, symbols } of activeSubscriptions) {
    // 过滤出该设备订阅的代码
    const deviceItems = changedItems.filter((item) => symbols.includes(item.code));
    if (!deviceItems.length) continue;

    const result = await tryPublishPrices(env, deviceId, deviceItems, {
      type: 'market_snapshot',
      source: 'markets/fund-metrics',
      session: 'regular',
      topics: MARKET_TOPICS,
    });
    if (result?.ok) {
      totalDelivered += Number(result.delivered || 0);
    }
    totalFailed += Number(result?.failed || 0);
  }

  console.log('[marketPush] done', JSON.stringify({
    symbols: allSymbols.length,
    changed: changedItems.length,
    delivered: totalDelivered,
    failed: totalFailed,
    devices: activeSubscriptions.length,
  }));

  return {
    ok: true,
    symbols: allSymbols.length,
    changed: changedItems.length,
    delivered: totalDelivered,
    failed: totalFailed,
    devices: activeSubscriptions.length,
  };
}
