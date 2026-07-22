// marketDataPush.js —— 行情数据 WS 推送
//
// 在交易时段定时从 markets worker 拉取订阅代码的最新行情，
// 通过 WsHub Durable Object 推送给已订阅的 WS 连接。

import { getSubscriptionSnapshot, tryPublishPrices } from './wsHub.js';
import { readSettings } from './notifyStorage.js';
import { hasWebWsCapability } from './gcm.js';

// markets worker 的基础 URL（与前端 marketsApi.js 一致）
const MARKETS_API_BASE = 'https://api.freebacktrack.tech/api/markets';

// KV 缓存 key 前缀，避免同一代码在短时间内重复请求
const PRICE_CACHE_PREFIX = 'market-push-cache:';
const PRICE_CACHE_TTL = 90; // 秒
const MARKET_SUMMARY_CACHE_PREFIX = 'market-summary-push-cache:';
const MARKET_SUMMARY_CACHE_TTL = 90; // 秒
const MARKET_TOPICS = ['market.price', 'market.premium'];
const MARKET_SUMMARY_TOPICS = ['market.summary'];
const MARKET_SUMMARY_REGION = 'US';

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

function normalizeSparklinePoints(value, { maxPoints = 80 } = {}) {
  const list = Array.isArray(value) ? value : [];
  const points = list
    .filter((item) => item != null)
    .map((item) => roundNumber(item, 4))
    .filter((item) => item != null && Number.isFinite(item));
  const limit = Math.max(2, Number(maxPoints) || 80);
  return points.length > limit ? points.slice(-limit) : points;
}

function sameNumberArray(left = [], right = []) {
  const a = Array.isArray(left) ? left : [];
  const b = Array.isArray(right) ? right : [];
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function shouldFetchMarkets(env = {}) {
  const mode = String(env.MARKETS_WS_DATA_READ_MODE || env.MARKETS_DATA_READ_MODE || 'cache-first').trim().toLowerCase();
  return mode !== 'cache-only';
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

async function fetchMarketSummaryFromMarkets(env, { region = MARKET_SUMMARY_REGION, refresh = true } = {}) {
  const params = new URLSearchParams();
  params.set('region', region || MARKET_SUMMARY_REGION);
  if (refresh) params.set('refresh', '1');
  const url = `${MARKETS_API_BASE}/market-summary?${params.toString()}`;
  try {
    const init = { method: 'GET', headers: { 'accept': 'application/json' } };
    const res = env?.MARKETS && typeof env.MARKETS.fetch === 'function'
      ? await env.MARKETS.fetch(new Request(url, init))
      : await fetch(url, init);
    if (!res.ok) {
      console.log('[marketSummaryPush] fetch failed', JSON.stringify({ status: res.status }));
      return null;
    }
    return await res.json().catch(() => null);
  } catch (error) {
    console.log('[marketSummaryPush] fetch error', JSON.stringify({
      message: error instanceof Error ? error.message : String(error),
    }));
    return null;
  }
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
    tradeStatus: item?.tradeStatus ?? null,
    isHalted: Boolean(item?.isHalted),
    quoteAt,
    quoteDate: String(item?.quoteDate || '').trim(),
    asOf: quoteAt,
    source: String(item?.source || '').trim(),
    updatedAt: String(item?.updatedAt || '').trim(),
  };
}

export const normalizePriceItem = normalizeMarketSnapshotItem;

export function normalizeMarketSummarySnapshotItem(item, { region = MARKET_SUMMARY_REGION } = {}) {
  const symbol = String(item?.symbol || item?.code || '').trim();
  if (!symbol) return null;
  const price = numberOrNull(item?.price ?? item?.regularMarketPrice);
  const sparkline = normalizeSparklinePoints(item?.sparkline);
  return {
    code: symbol,
    symbol,
    name: String(item?.name || item?.shortName || symbol).trim(),
    market: 'us',
    kind: 'market_summary',
    summaryRegion: String(region || MARKET_SUMMARY_REGION).trim().toUpperCase() || MARKET_SUMMARY_REGION,
    price,
    priceText: String(item?.priceText || '').trim(),
    change: numberOrNull(item?.change ?? item?.regularMarketChange),
    changeText: String(item?.changeText || '').trim(),
    changePercent: numberOrNull(item?.changePercent ?? item?.regularMarketChangePercent),
    changePercentText: String(item?.changePercentText || '').trim(),
    marketState: String(item?.marketState || '').trim(),
    asOf: String(item?.asOf || item?.quoteAt || '').trim(),
    quoteAt: String(item?.asOf || item?.quoteAt || '').trim(),
    timeText: String(item?.timeText || '').trim(),
    exchangeTimezone: String(item?.exchangeTimezone || '').trim(),
    delayMinutes: numberOrNull(item?.delayMinutes),
    source: String(item?.source || '').trim(),
    sparkline,
    sparklineRange: String(item?.sparklineRange || '').trim(),
    sparklineInterval: String(item?.sparklineInterval || '').trim(),
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

async function getCachedMarketSummaryItems(env, region, codes) {
  if (!env.NOTIFY_STATE || !codes.length) return {};
  const cached = {};
  await Promise.all(codes.map(async (code) => {
    try {
      const raw = await env.NOTIFY_STATE.get(`${MARKET_SUMMARY_CACHE_PREFIX}${region}:${code}`);
      if (raw) cached[code] = JSON.parse(raw);
    } catch { /* ignore */ }
  }));
  return cached;
}

async function setCachedMarketSummaryItems(env, region, items) {
  if (!env.NOTIFY_STATE || !items.length) return;
  await Promise.all(items.map(async (item) => {
    if (!item?.code) return;
    try {
      await env.NOTIFY_STATE.put(
        `${MARKET_SUMMARY_CACHE_PREFIX}${region}:${item.code}`,
        JSON.stringify(item),
        { expirationTtl: MARKET_SUMMARY_CACHE_TTL },
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

function hasMarketSummaryChange(oldItem, newItem) {
  if (!oldItem) return true;
  return (
    oldItem.price !== newItem.price ||
    oldItem.priceText !== newItem.priceText ||
    oldItem.change !== newItem.change ||
    oldItem.changeText !== newItem.changeText ||
    oldItem.changePercent !== newItem.changePercent ||
    oldItem.changePercentText !== newItem.changePercentText ||
    oldItem.marketState !== newItem.marketState ||
    oldItem.asOf !== newItem.asOf ||
    !sameNumberArray(oldItem.sparkline, newItem.sparkline)
  );
}

function hasAnyTopic(topics = [], allowedTopics = []) {
  const list = Array.isArray(topics) ? topics.map((topic) => String(topic || '').trim()).filter(Boolean) : [];
  if (!list.length) return true;
  const allowed = new Set(allowedTopics);
  return list.some((topic) => allowed.has(topic));
}

async function getMarketWebSocketDevices(env) {
  const settings = await readSettings(env);
  const registrations = Array.isArray(settings.gcmRegistrations) ? settings.gcmRegistrations : [];
  const allDeviceIds = registrations
    .filter((r) => hasWebWsCapability(r, 'market'))
    .map((r) => String(r?.deviceInstallationId || r?.id || '').trim())
    .filter(isWebWsDeviceId);

  if (!allDeviceIds.length) return [];

  const snapshots = await Promise.all(
    allDeviceIds.map(async (deviceId) => {
      const snapshot = await getSubscriptionSnapshot(env, deviceId);
      return {
        deviceId,
        symbols: Array.isArray(snapshot.symbols) ? snapshot.symbols : [],
        topics: Array.isArray(snapshot.topics) ? snapshot.topics : [],
        connections: Number(snapshot.connections) || 0,
      };
    })
  );

  return snapshots.filter((item) => item.connections > 0);
}

export async function runMarketSummaryPush(env, { region = MARKET_SUMMARY_REGION } = {}) {
  const normalizedRegion = String(region || MARKET_SUMMARY_REGION).trim().toUpperCase() || MARKET_SUMMARY_REGION;
  const onlineDevices = await getMarketWebSocketDevices(env);
  const activeSubscriptions = onlineDevices.filter((device) => device.topics.includes('market.summary'));

  if (!activeSubscriptions.length) {
    return { skipped: true, reason: 'no-online-summary-subscriptions' };
  }

  if (!shouldFetchMarkets(env)) {
    return { skipped: true, reason: 'cache-only-no-market-source' };
  }

  const summary = await fetchMarketSummaryFromMarkets(env, { region: normalizedRegion, refresh: true });
  const items = (Array.isArray(summary?.items) ? summary.items : [])
    .map((item) => normalizeMarketSummarySnapshotItem(item, { region: normalizedRegion }))
    .filter(Boolean);

  if (!items.length) {
    return { skipped: true, reason: 'no-data' };
  }

  const cachedItems = await getCachedMarketSummaryItems(env, normalizedRegion, items.map((item) => item.code));
  const changedItems = items.filter((item) => hasMarketSummaryChange(cachedItems[item.code], item));

  if (!changedItems.length) {
    return { skipped: true, reason: 'no-changes', total: items.length };
  }

  await setCachedMarketSummaryItems(env, normalizedRegion, changedItems);

  let totalDelivered = 0;
  let totalFailed = 0;
  for (const { deviceId, symbols } of activeSubscriptions) {
    const symbolSet = new Set((Array.isArray(symbols) ? symbols : []).map((symbol) => String(symbol || '').trim()));
    const deviceItems = symbolSet.size
      ? changedItems.filter((item) => symbolSet.has(item.code))
      : changedItems;
    if (!deviceItems.length) continue;

    const result = await tryPublishPrices(env, deviceId, deviceItems, {
      type: 'market_snapshot',
      source: 'markets/market-summary',
      session: 'us',
      topics: MARKET_SUMMARY_TOPICS,
    });
    if (result?.ok) {
      totalDelivered += Number(result.delivered || 0);
    }
    totalFailed += Number(result?.failed || 0);
  }

  console.log('[marketSummaryPush] done', JSON.stringify({
    region: normalizedRegion,
    changed: changedItems.length,
    delivered: totalDelivered,
    failed: totalFailed,
    devices: activeSubscriptions.length,
  }));

  return {
    ok: true,
    region: normalizedRegion,
    changed: changedItems.length,
    delivered: totalDelivered,
    failed: totalFailed,
    devices: activeSubscriptions.length,
  };
}

/**
 * 主入口：遍历所有活跃 WsHub，收集订阅代码，拉取行情，推送。
 * 由 notify worker 的 scheduled handler 调用。
 */
export async function runMarketDataPush(env) {
  const onlineDevices = await getMarketWebSocketDevices(env);

  if (!onlineDevices.length) {
    return { skipped: true, reason: 'no-devices' };
  }

  const activeSubscriptions = onlineDevices.filter((d) => (
    d.symbols.length > 0 && hasAnyTopic(d.topics, MARKET_TOPICS)
  ));

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

  if (!shouldFetchMarkets(env)) {
    return { skipped: true, reason: 'cache-only-no-market-source' };
  }

  const [cnItems, otherItems] = await Promise.all([
    cnCodes.length ? fetchFundMetricsFromMarkets(cnCodes, env) : Promise.resolve([]),
    otherSymbols.length ? fetchQuotesFromMarkets(otherSymbols, env) : Promise.resolve([]),
  ]);

  // 合并并标准化
  const allItems = [...cnItems, ...otherItems]
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
