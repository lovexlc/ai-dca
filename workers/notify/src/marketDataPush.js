// marketDataPush.js —— 行情数据 WS 推送
//
// 在交易时段定时从 markets worker 拉取订阅代码的最新行情，
// 通过 WsHub Durable Object 推送给已订阅的 WS 连接。

import { getSubscribedSymbols, tryPublishPrices } from './wsHub.js';
import { readSettings } from './notifyStorage.js';

// markets worker 的基础 URL（与前端 marketsApi.js 一致）
const MARKETS_API_BASE = 'https://tools.freebacktrack.tech/api/markets';

// KV 缓存 key 前缀，避免同一代码在短时间内重复请求
const PRICE_CACHE_PREFIX = 'market-push-cache:';
const PRICE_CACHE_TTL = 90; // 秒

/**
 * 从 markets worker 批量获取 fund-metrics 数据。
 */
async function fetchFundMetricsFromMarkets(codes, env) {
  if (!codes.length) return [];
  const url = `${MARKETS_API_BASE}/fund-metrics`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'accept': 'application/json' },
      body: JSON.stringify({ codes }),
    });
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

/**
 * 从 markets worker 批量获取 quotes 数据（美股等）。
 */
async function fetchQuotesFromMarkets(symbols, env) {
  if (!symbols.length) return [];
  const url = `${MARKETS_API_BASE}/quotes?symbols=${encodeURIComponent(symbols.join(','))}`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'accept': 'application/json' },
    });
    if (!res.ok) return [];
    const data = await res.json().catch(() => null);
    return Array.isArray(data?.quotes) ? data.quotes : (Array.isArray(data) ? data : []);
  } catch {
    return [];
  }
}

/**
 * 判断代码是否为 A 股基金/ETF（6位数字，前缀 15/50/51/52/56/58/53/54）。
 */
function isCnFundCode(code) {
  return /^(15|50|51|52|53|54|56|58)\d{4}$/.test(code);
}

/**
 * 将行情数据标准化为推送格式。
 */
function normalizePriceItem(item) {
  const code = String(item?.code || item?.symbol || '').trim();
  if (!code) return null;
  return {
    code,
    name: String(item?.name || '').trim(),
    price: Number(item?.price || item?.currentPrice || item?.close || 0) || 0,
    change: Number(item?.change || 0) || 0,
    changePercent: Number(item?.changePercent || 0) || 0,
    premiumPercent: item?.premiumPercent != null ? Number(item.premiumPercent) : null,
    latestNav: item?.latestNav != null ? Number(item.latestNav) : null,
    navBase: item?.navBase != null ? Number(item.navBase) : null,
    iopv: item?.iopv != null ? Number(item.iopv) : null,
    marketState: String(item?.marketState || '').trim(),
    asOf: String(item?.asOf || item?.quoteDate || '').trim(),
  };
}

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
    oldItem.marketState !== newItem.marketState
  );
}

/**
 * 主入口：遍历所有活跃 WsHub，收集订阅代码，拉取行情，推送。
 * 由 notify worker 的 scheduled handler 调用。
 */
export async function runMarketDataPush(env) {
  const settings = await readSettings(env);
  const registrations = Array.isArray(settings.gcmRegistrations) ? settings.gcmRegistrations : [];

  // 收集所有有活跃 WS 连接的 deviceInstallationId
  // （包括 web 虚拟设备和 Android 设备）
  const allDeviceIds = registrations
    .map((r) => String(r?.deviceInstallationId || r?.id || '').trim())
    .filter(Boolean);

  if (!allDeviceIds.length) {
    return { skipped: true, reason: 'no-devices' };
  }

  // 并发获取每个设备的订阅代码
  const deviceSubscriptions = await Promise.all(
    allDeviceIds.map(async (deviceId) => {
      const symbols = await getSubscribedSymbols(env, deviceId);
      return { deviceId, symbols };
    })
  );

  // 过滤掉没有订阅的设备
  const activeSubscriptions = deviceSubscriptions.filter((d) => d.symbols.length > 0);

  if (!activeSubscriptions.length) {
    return { skipped: true, reason: 'no-subscriptions' };
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

  // 并发拉取行情数据
  const [cnItems, usItems] = await Promise.all([
    cnCodes.length ? fetchFundMetricsFromMarkets(cnCodes, env) : Promise.resolve([]),
    otherSymbols.length ? fetchQuotesFromMarkets(otherSymbols, env) : Promise.resolve([]),
  ]);

  // 合并并标准化
  const allItems = [...cnItems, ...usItems]
    .map(normalizePriceItem)
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

    const result = await tryPublishPrices(env, deviceId, deviceItems);
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
