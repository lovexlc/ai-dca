/* global URLSearchParams, console */

import {
  fetchDanjuanFundMeta,
  fetchDanjuanFundNav,
  fetchTencentQuote,
  fetchXueqiuQuote,
  fetchYahooChart,
  normalizeYahooKline
} from './fetchers.js';
import { OTC_ALL_FUNDS, OTC_FUND_NAME_BY_CODE } from './otcFundList.js';
import { kvGetJson, kvPutJson, r2GetJson, r2PutJson, klineKey } from './storage.js';
import { classifySymbol } from './symbols.js';
import { attachKlineHighPoint, pickHigherHighPoint } from './klineHighPoint.js';
import { writeKlineCloseHighPointCache, writeKlineHighPointCache } from './klineHighPointCache.js';
import { readStaleQuoteCache } from './quoteCache.js';
import {
  isKvCacheEnabled,
  kvCacheMGetJson,
  shouldFetchLiveOnMiss
} from './kvCache.js';
import {
  describeKlinePayloadForLog,
  errorJson,
  fetchCnKlineWithFallback,
  getShanghaiTradingMinute,
  INTRADAY_KLINE_INTERVALS,
  isCnTradingSession,
  json,
  keepLatestCnIntradaySession,
  klineCacheIsStale,
  mapLimit,
  notifyXueqiuCookieIssue,
  roundNumber,
  summarizeXueqiuError
} from './marketRuntime.js';

function firstPositiveNumber(...values) {
  for (const value of values) {
    const rounded = roundNumber(value, 4);
    if (Number.isFinite(rounded) && rounded > 0) return rounded;
  }
  return null;
}

function shanghaiDateFromTimestamp(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const direct = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return direct ? direct[1] : '';
  try {
    return new Date(parsed).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  } catch {
    return new Date(parsed).toISOString().slice(0, 10);
  }
}

function todayShanghaiDate() {
  try {
    return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  } catch {
    return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }
}

function normalizeSourceUpdatedAt(value = '') {
  if (value == null || value === '') return '';
  const numeric = Number(value);
  const parsed = Number.isFinite(numeric)
    ? (numeric > 0 && numeric < 1e12 ? numeric * 1000 : numeric)
    : Date.parse(String(value));
  if (!Number.isFinite(parsed) || parsed <= 0) return '';
  return new Date(parsed).toISOString();
}

function deriveChangePercent(currentValue, previousValue, explicitChangePercent = null) {
  const explicit = roundNumber(explicitChangePercent, 4);
  if (Number.isFinite(explicit)) return explicit;
  if (!Number.isFinite(currentValue) || currentValue <= 0) return null;
  if (!Number.isFinite(previousValue) || previousValue <= 0) return null;
  return roundNumber(((currentValue - previousValue) / previousValue) * 100, 4);
}

function derivePreviousValue(currentValue, changePercent = null, change = null) {
  const explicitChange = roundNumber(change, 4);
  if (Number.isFinite(currentValue) && currentValue > 0 && Number.isFinite(explicitChange) && explicitChange !== 0) {
    const previous = roundNumber(currentValue - explicitChange, 4);
    if (Number.isFinite(previous) && previous > 0) return previous;
  }
  const pct = roundNumber(changePercent, 4);
  if (Number.isFinite(currentValue) && currentValue > 0 && Number.isFinite(pct) && pct !== -100) {
    const previous = roundNumber(currentValue / (1 + pct / 100), 4);
    if (Number.isFinite(previous) && previous > 0) return previous;
  }
  return null;
}

function normalizeOrderBook(book = null) {
  if (!book || typeof book !== 'object') return null;
  const bidPrice = roundNumber(book.bidPrice ?? book.bid_price ?? book.bp1, 4);
  const askPrice = roundNumber(book.askPrice ?? book.ask_price ?? book.sp1, 4);
  const bidVolume = Number(book.bidVolume ?? book.bid_volume ?? book.bc1);
  const askVolume = Number(book.askVolume ?? book.ask_volume ?? book.sc1);
  const rawLevels = Array.isArray(book.levels) && book.levels.length
    ? book.levels.slice(0, 3)
    : [1, 2, 3].map((level) => ({
      level,
      bidPrice: book[`bp${level}`] ?? book[`bid${level}`] ?? book[`bid${level}_price`] ?? book[`bid_price${level}`] ?? book[`buy${level}`] ?? book[`buy${level}_price`] ?? book[`buy_price${level}`],
      bidVolume: book[`bc${level}`] ?? book[`bid${level}_volume`] ?? book[`bid${level}_vol`] ?? book[`bid_volume${level}`] ?? book[`buy${level}_volume`] ?? book[`buy${level}_vol`] ?? book[`buy_volume${level}`],
      askPrice: book[`sp${level}`] ?? book[`ask${level}`] ?? book[`ask${level}_price`] ?? book[`ask_price${level}`] ?? book[`sell${level}`] ?? book[`sell${level}_price`] ?? book[`sell_price${level}`],
      askVolume: book[`sc${level}`] ?? book[`ask${level}_volume`] ?? book[`ask${level}_vol`] ?? book[`ask_volume${level}`] ?? book[`sell${level}_volume`] ?? book[`sell${level}_vol`] ?? book[`sell_volume${level}`]
    }));
  const levels = rawLevels.map((item, index) => {
    const level = Number(item?.level) || index + 1;
    const levelBidPrice = roundNumber(item?.bidPrice ?? item?.bid_price ?? item?.bp, 4);
    const levelAskPrice = roundNumber(item?.askPrice ?? item?.ask_price ?? item?.sp, 4);
    const levelBidVolume = Number(item?.bidVolume ?? item?.bid_volume ?? item?.bc);
    const levelAskVolume = Number(item?.askVolume ?? item?.ask_volume ?? item?.sc);
    return {
      level,
      bidPrice: Number.isFinite(levelBidPrice) ? levelBidPrice : null,
      bidVolume: Number.isFinite(levelBidVolume) ? levelBidVolume : null,
      askPrice: Number.isFinite(levelAskPrice) ? levelAskPrice : null,
      askVolume: Number.isFinite(levelAskVolume) ? levelAskVolume : null
    };
  }).filter((item) => Number.isFinite(item.bidPrice) || Number.isFinite(item.askPrice));
  const topLevel = levels.find((item) => item.level === 1) || levels[0] || {};
  const normalizedBidPrice = Number.isFinite(bidPrice) ? bidPrice : topLevel.bidPrice;
  const normalizedAskPrice = Number.isFinite(askPrice) ? askPrice : topLevel.askPrice;
  const normalizedBidVolume = Number.isFinite(bidVolume) ? bidVolume : topLevel.bidVolume;
  const normalizedAskVolume = Number.isFinite(askVolume) ? askVolume : topLevel.askVolume;
  const spread = Number.isFinite(normalizedBidPrice) && Number.isFinite(normalizedAskPrice)
    ? roundNumber(normalizedAskPrice - normalizedBidPrice, 4)
    : roundNumber(book.spread, 4);
  const mid = Number.isFinite(normalizedBidPrice) && Number.isFinite(normalizedAskPrice) ? (normalizedBidPrice + normalizedAskPrice) / 2 : NaN;
  const spreadPercent = Number.isFinite(mid) && mid > 0 && Number.isFinite(spread)
    ? roundNumber((spread / mid) * 100, 4)
    : roundNumber(book.spreadPercent ?? book.spread_percent, 4);
  if (!Number.isFinite(normalizedBidPrice) && !Number.isFinite(normalizedAskPrice) && !levels.length) return null;
  return {
    bidPrice: Number.isFinite(normalizedBidPrice) ? normalizedBidPrice : null,
    bidVolume: Number.isFinite(normalizedBidVolume) ? normalizedBidVolume : null,
    askPrice: Number.isFinite(normalizedAskPrice) ? normalizedAskPrice : null,
    askVolume: Number.isFinite(normalizedAskVolume) ? normalizedAskVolume : null,
    levels,
    spread: Number.isFinite(spread) ? spread : null,
    spreadPercent: Number.isFinite(spreadPercent) ? spreadPercent : null,
    source: String(book.source || '').trim()
  };
}

function normalizeFundKindHint(value = '') {
  const raw = String(value || '').trim().toLowerCase();
  return raw === 'exchange' || raw === 'qdii' || raw === 'otc' ? raw : '';
}

function normalizeFundKindFromQuote(quote, exchange, hintedKind = '') {
  if (exchange) return 'exchange';
  const normalizedHint = normalizeFundKindHint(hintedKind);
  if (normalizedHint === 'qdii' || normalizedHint === 'otc') return normalizedHint;
  return 'otc';
}

function isSupportedFundMetricSource(source, exchange) {
  const normalized = String(source || '').trim();
  if (exchange) return normalized === 'xueqiu-quote' || normalized === 'tencent+danjuan';
  return normalized === 'danjuan';
}

export function normalizeFundMetricFromQuote(code, quote, { cached = false, cachePolicy = '', primaryError = '', exchange = isExchangeTradedFund(code), fundKind = '' } = {}) {
  const normalizedCode = String(quote?.code || code || '').trim();
  const fallbackName = OTC_FUND_NAME_BY_CODE[normalizedCode] || '';
  const price = firstPositiveNumber(quote?.price, quote?.currentPrice, quote?.close);
  const latestNav = firstPositiveNumber(quote?.latestNav, !exchange ? quote?.currentPrice : null);
  const currentValue = exchange ? price : latestNav;
  const rawPreviousClose = firstPositiveNumber(quote?.previousClose, quote?.previous_close);
  const rawPreviousNav = firstPositiveNumber(quote?.previousNav, quote?.previous_nav);
  const previousValue = exchange
    ? firstPositiveNumber(rawPreviousClose, rawPreviousNav, derivePreviousValue(currentValue, quote?.changePercent, quote?.change))
    : firstPositiveNumber(rawPreviousNav, rawPreviousClose, derivePreviousValue(currentValue, quote?.changePercent, quote?.change));
  const changePercent = deriveChangePercent(currentValue, previousValue, quote?.changePercent);
  const explicitChange = roundNumber(quote?.change, 4);
  const change = Number.isFinite(explicitChange)
    ? explicitChange
    : (Number.isFinite(currentValue) && Number.isFinite(previousValue) ? roundNumber(currentValue - previousValue, 4) : null);
  const iopv = roundNumber(quote?.iopv, 4);
  const navBase = Number.isFinite(iopv) && iopv > 0
    ? iopv
    : (Number.isFinite(latestNav) && latestNav > 0 ? latestNav : null);
  const explicitPremium = roundNumber(quote?.premiumPercent, 4);
  const computedPremium = Number.isFinite(price) && price > 0 && Number.isFinite(navBase) && navBase > 0
    ? roundNumber(((price - navBase) / navBase) * 100, 4)
    : null;
  const premiumPercent = explicitPremium != null ? explicitPremium : computedPremium;
  const asOf = String(quote?.asOf || new Date().toISOString()).trim();
  const updatedAt = normalizeSourceUpdatedAt(quote?.updatedAt);
  const quoteDate = shanghaiDateFromTimestamp(quote?.quoteDate || asOf);
  const todayDate = todayShanghaiDate();
  const rawMarketState = String(quote?.marketState || '').trim();
  const marketState = exchange && quoteDate && quoteDate < todayDate
    ? 'CLOSED'
    : rawMarketState;
  const resolvedFundKind = normalizeFundKindFromQuote(quote, exchange, fundKind || quote?.requestedFundKind);
  const orderBook = exchange ? normalizeOrderBook(quote?.orderBook) : null;
  const volume = Number(quote?.volume);
  const turnover = Number(quote?.turnover ?? quote?.amount);
  const marketCapital = Number(quote?.marketCapital ?? quote?.marketCap ?? quote?.market_capital);
  return {
    ok: !quote?.error,
    code: normalizedCode,
    symbol: String(quote?.symbol || code || '').trim(),
    name: String(quote?.name || fallbackName).trim(),
    market: 'cn',
    fundKind: resolvedFundKind,
    fundType: String(quote?.fundType || quote?.typeDesc || (!exchange && resolvedFundKind === 'qdii' && fallbackName ? 'QDII' : '')).trim(),
    fundTypeCode: quote?.fundTypeCode ?? null,
    fullName: String(quote?.fullName || fallbackName).trim(),
    price,
    currentPrice: currentValue,
    close: currentValue,
    high: roundNumber(quote?.high, 4),
    low: roundNumber(quote?.low, 4),
    volume: Number.isFinite(volume) && volume >= 0 ? volume : null,
    turnover: Number.isFinite(turnover) && turnover >= 0 ? turnover : null,
    marketCapital: Number.isFinite(marketCapital) && marketCapital >= 0 ? marketCapital : null,
    previousClose: previousValue,
    previousNav: previousValue,
    previousNavDate: String(quote?.previousNavDate || quote?.previous_nav_date || '').trim(),
    change,
    changePercent,
    latestNav,
    navBase,
    iopv,
    premiumPercent,
    latestNavDate: String(quote?.latestNavDate || '').trim(),
    navDate: String(quote?.latestNavDate || '').trim(),
    orderBook,
    marketState,
    asOf,
    updatedAt,
    quoteDate,
    source: String(quote?.source || '').trim(),
    fallback: quote?.fallback || '',
    primaryError: primaryError || quote?.primaryError || '',
    error: quote?.error || '',
    cached,
    cachePolicy,
    ytdReturn: quote?.ytdReturn ?? quote?.currentYearPercent ?? quote?.current_year_percent ?? null,
    return1w: quote?.return1w ?? null,
    return1m: quote?.return1m ?? null,
    return3m: quote?.return3m ?? null,
    return6m: quote?.return6m ?? null,
    return1y: quote?.return1y ?? null,
    returnBase: quote?.returnBase ?? null,
  };
}

function finiteReturn(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? roundNumber(number, 4) : null;
}

async function hydrateExchangeYtdReturn(env, code, item, exchange) {
  if (!exchange || finiteReturn(item?.ytdReturn) !== null) return item;
  const cachedQuote = await readStaleQuoteCache(env, code, 'cn').catch(() => null);
  const ytdReturn = finiteReturn(
    cachedQuote?.currentYearPercent ?? cachedQuote?.ytdReturn ?? cachedQuote?.current_year_percent
  );
  return ytdReturn === null ? item : { ...item, ytdReturn };
}

const EXCHANGE_PREFIXES = new Set(['15', '50', '51', '52', '56', '58', '53', '54']);

function isExchangeTradedFund(code) {
  const digits = String(code || '').replace(/^(sh|sz|bj)/i, '');
  return /^\d{6}$/.test(digits) && EXCHANGE_PREFIXES.has(digits.slice(0, 2));
}

function normalizeFundMetricCodes(codes = []) {
  const list = (Array.isArray(codes) ? codes : String(codes || '').split(','))
    .map((code) => String(code || '').trim())
    .filter(Boolean);
  const out = [];
  const seen = new Set();
  for (const raw of list) {
    const { market, code } = classifySymbol(raw);
    const digits = String(code || '').replace(/^(sh|sz|bj)/i, '');
    if (market !== 'cn' || !/^\d{6}$/.test(digits)) continue;
    if (seen.has(digits)) continue;
    seen.add(digits);
    out.push(digits);
  }
  return out;
}

function normalizeFundKindHints(body = {}) {
  const raw = body?.fundKinds && typeof body.fundKinds === 'object' ? body.fundKinds : {};
  const out = {};
  for (const [rawCode, rawKind] of Object.entries(raw)) {
    const { market, code } = classifySymbol(rawCode);
    const digits = String(code || rawCode || '').replace(/^(sh|sz|bj)/i, '');
    const kind = normalizeFundKindHint(rawKind);
    if (market === 'cn' && /^\d{6}$/.test(digits) && kind) out[digits] = kind;
    if (!market && /^\d{6}$/.test(digits) && kind) out[digits] = kind;
  }
  for (const item of Array.isArray(body?.items) ? body.items : []) {
    const { market, code } = classifySymbol(item?.code || item?.symbol || '');
    const digits = String(code || '').replace(/^(sh|sz|bj)/i, '');
    const kind = normalizeFundKindHint(item?.fundKind || item?.kind);
    if (market === 'cn' && /^\d{6}$/.test(digits) && kind) out[digits] = kind;
  }
  return out;
}

function klinePayloadForSession(payload, market, tf, sessionMode = 'latest') {
  return sessionMode === 'all' ? payload : keepLatestCnIntradaySession(payload, market, tf);
}

function limitKlinePayload(payload = {}, limit = 500) {
  if (limit == null || String(limit).toLowerCase() === 'all') return payload;
  const requestedLimit = Math.max(1, Math.min(Number(limit) || 500, 3000));
  const candles = Array.isArray(payload?.candles) ? payload.candles.slice(-requestedLimit) : [];
  return { ...payload, candles };
}

function buildKlineResponsePayload(payload, { market, tf, sessionMode, limit, highPoint = null, forceDeriveHighPoint = false } = {}) {
  const withHigh = attachKlineHighPoint({ ...payload, highPoint: pickHigherHighPoint(payload?.highPoint, highPoint) || payload?.highPoint }, {
    interval: tf,
    source: forceDeriveHighPoint ? 'daily-kline-1d' : 'daily-kline-365d',
    forceDerive: forceDeriveHighPoint
  });
  return limitKlinePayload(klinePayloadForSession(withHigh, market, tf, sessionMode), limit);
}

function collectValidKlineCandles(payload = {}) {
  return (Array.isArray(payload?.candles) ? payload.candles : [])
    .filter((bar) => bar && Number.isFinite(Number(bar.t)));
}

function mergeKlinePayloadsWithR2(cached, fresh, { market, tf, limit = 1000, sessionMode = 'all' } = {}) {
  const r2Candles = collectValidKlineCandles(cached);
  const freshCandles = collectValidKlineCandles(fresh);
  const byTimestamp = new Map();
  for (const candle of r2Candles) {
    byTimestamp.set(Number(candle.t), { ...candle, t: Number(candle.t) });
  }
  for (const candle of freshCandles) {
    byTimestamp.set(Number(candle.t), { ...candle, t: Number(candle.t) });
  }
  const mergedCandles = Array.from(byTimestamp.values())
    .sort((left, right) => Number(left.t) - Number(right.t));
  const limitedCandles = limit == null || String(limit).toLowerCase() === 'all'
    ? mergedCandles
    : mergedCandles.slice(-Math.max(1, Math.min(Number(limit) || 1000, 3000)));
  const highPoint = attachKlineHighPoint({ candles: mergedCandles, interval: tf }, {
    interval: tf,
    source: 'daily-kline-365d'
  });
  const payload = {
    ...(cached && typeof cached === 'object' ? cached : {}),
    ...(fresh && typeof fresh === 'object' ? fresh : {}),
    market: fresh?.market || cached?.market || market,
    symbol: fresh?.symbol || cached?.symbol || '',
    interval: fresh?.interval || cached?.interval || tf,
    generatedAt: fresh?.generatedAt || new Date().toISOString(),
    cached: false,
    source: 'realtime+r2',
    mergedR2: r2Candles.length > 0,
    r2CandleCount: r2Candles.length,
    freshCandleCount: freshCandles.length,
    mergedCandleCount: mergedCandles.length,
    highPoint: pickHigherHighPoint(highPoint?.highPoint, pickHigherHighPoint(cached?.highPoint, fresh?.highPoint)) || undefined,
    closeHighPoint: pickHigherHighPoint(highPoint?.closeHighPoint, pickHigherHighPoint(cached?.closeHighPoint, fresh?.closeHighPoint)) || undefined,
    candles: limitedCandles
  };
  return klinePayloadForSession(payload, market, tf, sessionMode);
}

/**
 * Persist full multi-session history. Never replace a longer R2 series with a
 * session-truncated or shorter live window (e.g. latest-only CN 5m ~24 bars).
 */
function buildKlinePayloadForR2Write(existing, candidate, { market, tf } = {}) {
  const existingCount = collectValidKlineCandles(existing).length;
  const candidateCount = collectValidKlineCandles(candidate).length;
  if (!candidateCount && existingCount) return existing;
  if (!existingCount) return candidate;
  const merged = mergeKlinePayloadsWithR2(existing, candidate, {
    market,
    tf,
    limit: null,
    sessionMode: 'all'
  });
  // Keep batchSaved if either side had durable batch history.
  const batchSaved = Boolean(existing?.batchSaved || candidate?.batchSaved);
  return {
    ...merged,
    source: candidate?.source || existing?.source || merged.source,
    batchSaved: batchSaved || undefined,
    // Storage should not look like a transient API merge response.
    cached: undefined,
    mergedR2: undefined,
    r2CandleCount: undefined,
    freshCandleCount: undefined,
    mergedCandleCount: undefined
  };
}

async function readCachedFundMetric(env, cacheKey, fundKind = '', exchangeOverride = null) {
  const cached = await kvGetJson(env, cacheKey).catch(() => null);
  if (!cached || !cached.code) return null;
  const hasNav = Number(cached.latestNav) > 0;
  const hasPrice = Number(cached.price) > 0;
  if (!hasNav && !hasPrice) return null;
  const code = String(cached.code || '').trim();
  const exchange = typeof exchangeOverride === 'boolean' ? exchangeOverride : isExchangeTradedFund(code);
  if (!isSupportedFundMetricSource(cached.source, exchange)) {
    return null;
  }
  let quote = cached;
  if (!exchange && !cached.fundKind && !cached.fundType) {
    const meta = await fetchDanjuanFundMetaWithCache(env, code).catch(() => null);
    if (meta) {
      quote = { ...cached, ...meta };
      await kvPutJson(env, cacheKey, quote, { ttlSeconds: 24 * 3600 }).catch(() => {});
    }
  }
  const item = normalizeFundMetricFromQuote(code, quote, {
    cached: true,
    cachePolicy: 'kv-closed-session',
    exchange,
    fundKind
  });
  return hydrateExchangeYtdReturn(env, code, item, exchange);
}

async function fetchDanjuanFundMetaWithCache(env, code) {
  const cacheKey = 'fund-meta:' + code;
  const cached = await kvGetJson(env, cacheKey).catch(() => null);
  if (cached && cached.code === code && cached.fundType) return cached;
  const meta = await fetchDanjuanFundMeta(code);
  if (meta && meta.code) {
    await kvPutJson(env, cacheKey, meta, { ttlSeconds: 30 * 24 * 3600 }).catch(() => {});
  }
  return meta;
}

async function fetchExchangeFundFallback(code, primaryError) {
  const [priceResult, navResult] = await Promise.allSettled([
    fetchTencentQuote(code),
    fetchDanjuanFundNav(code, { includeDetail: false })
  ]);
  const priceError = priceResult.status === 'rejected' ? summarizeXueqiuError(priceResult.reason) : '';
  const navError = navResult.status === 'rejected' ? summarizeXueqiuError(navResult.reason) : '';
  if (priceResult.status !== 'fulfilled' || navResult.status !== 'fulfilled') {
    throw new Error([
      'tencent price unavailable: ' + (priceError || 'unknown error'),
      'danjuan nav unavailable: ' + (navError || 'unknown error')
    ].join('; '));
  }
  const priceQuote = priceResult.value;
  const navQuote = navResult.value;
  if (!(Number(priceQuote?.price) > 0) || !(Number(navQuote?.latestNav) > 0) || !String(navQuote?.latestNavDate || '').trim()) {
    throw new Error('tencent price or danjuan published NAV is invalid');
  }
  return {
    ...navQuote,
    ...priceQuote,
    code: String(code || '').replace(/^(sh|sz|bj)/i, ''),
    symbol: priceQuote.symbol || priceQuote.code || code,
    name: priceQuote.name || navQuote.name || priceQuote.symbol || code,
    price: priceQuote.price,
    currentPrice: priceQuote.price,
    close: priceQuote.price,
    previousClose: priceQuote.previousClose,
    previousNav: navQuote.previousClose,
    latestNav: navQuote.latestNav,
    latestNavDate: navQuote.latestNavDate,
    navDate: navQuote.latestNavDate,
    iopv: null,
    premiumPercent: null,
    asOf: priceQuote.asOf || new Date().toISOString(),
    updatedAt: navQuote.updatedAt,
    source: 'tencent+danjuan',
    fallback: 'tencent-price+danjuan-nav',
    primaryError: summarizeXueqiuError(primaryError)
  };
}

function isDanjuanUpdatedToday(updatedAtMs) {
  if (!updatedAtMs) return false;
  const shanghai = new Date(updatedAtMs).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  return shanghai === today;
}

async function fetchFreshFundMetric(env, code, cachePolicy, fundKind = '', exchangeOverride = null) {
  const cacheKey = 'fund-metrics:' + code;
  const exchange = typeof exchangeOverride === 'boolean' ? exchangeOverride : isExchangeTradedFund(code);
  try {
    let quote;
    if (exchange) {
      try {
        quote = await fetchXueqiuQuote(code, { cookie: env.XUEQIU_COOKIE });
      } catch (primaryError) {
        console.warn('[fund-metrics] xueqiu unavailable; using Tencent + Danjuan fallback', {
          code,
          error: summarizeXueqiuError(primaryError)
        });
        quote = await fetchExchangeFundFallback(code, primaryError);
      }
    } else {
      quote = await fetchDanjuanFundNav(code);
    }
    if (!exchange) {
      const meta = await fetchDanjuanFundMetaWithCache(env, code).catch(() => null);
      if (meta) quote = { ...quote, ...meta };
    }
    const item = normalizeFundMetricFromQuote(code, quote, { cached: false, cachePolicy, exchange, fundKind });
    // 场内始终缓存；场外仅当 updated_at 是今天时缓存（净值已发布）
    const shouldCache = exchange || isDanjuanUpdatedToday(quote?.updatedAt);
    if (shouldCache) {
      await kvPutJson(env, cacheKey, item, { ttlSeconds: 24 * 3600 }).catch(() => {});
    }
    return hydrateExchangeYtdReturn(env, code, item, exchange);
  } catch (error) {
    const primaryError = summarizeXueqiuError(error);
    if (exchange) {
      await notifyXueqiuCookieIssue(env, error, { code, endpoint: 'fund-metrics' });
      const cached = await readCachedFundMetric(env, cacheKey, fundKind, exchange);
      if (cached) {
        return {
          ...cached,
          fallback: 'kv',
          primaryError,
          cachePolicy: 'kv-live-fallback'
        };
      }
    }
    return {
      ok: false,
      code,
      symbol: code,
      market: 'cn',
      fundKind: exchange ? 'exchange' : 'otc',
      fundType: '',
      fundTypeCode: null,
      fullName: '',
      price: null,
      currentPrice: null,
      close: null,
      previousClose: null,
      previousNav: null,
      previousNavDate: '',
      change: null,
      changePercent: null,
      latestNav: null,
      navBase: null,
      iopv: null,
      premiumPercent: null,
      latestNavDate: '',
      navDate: '',
      marketState: '',
      asOf: new Date().toISOString(),
      source: '',
      fallback: '',
      primaryError: exchange ? primaryError : '',
      error: exchange ? `exchange fund quote unavailable: ${primaryError}` : String((error && error.message) || error),
      cached: false,
      cachePolicy
    };
  }
}

export async function handleFundMetrics(env, body = {}, params = new URLSearchParams()) {
  const rawCodes = Array.isArray(body?.codes) && body.codes.length ? body.codes : (params.get('codes') || params.get('symbols') || '');
  const codes = normalizeFundMetricCodes(rawCodes);
  if (!codes.length) return errorJson('missing valid cn fund codes', 400);
  if (codes.length > 60) return errorJson('codes too many (max 60)', 400);
  const fundKindHints = normalizeFundKindHints(body);

  const forceRefresh = body?.refresh === true || params.get('refresh') === '1';
  const { weekday, minuteOfDay } = getShanghaiTradingMinute();
  const isWeekday = weekday !== 'Sat' && weekday !== 'Sun';
  const tradingSession = isWeekday && ((minuteOfDay >= 570 && minuteOfDay <= 690) || (minuteOfDay >= 780 && minuteOfDay <= 900));

  const cachePlans = codes.map((code) => {
    const cacheKey = 'fund-metrics:' + code;
    const hintedKind = normalizeFundKindHint(fundKindHints[code]);
    const exchange = isExchangeTradedFund(code) || hintedKind === 'exchange';
    const requestedKind = exchange ? 'exchange' : hintedKind;
    // 场内：盘中拉活数据，非交易时段读缓存
    // 场外：周末/节假日始终读缓存；交易日盘中读缓存，盘后拉活数据并按 updated_at 判断是否缓存
    let codeShouldReadCache;
    if (forceRefresh) {
      codeShouldReadCache = false;
    } else if (exchange) {
      codeShouldReadCache = !tradingSession;
    } else {
      // 场外：非交易日（周末/节假日）直接读缓存，交易日盘中也读缓存
      codeShouldReadCache = !isWeekday || tradingSession;
    }
    const codeCachePolicy = codeShouldReadCache
      ? 'kv-closed-session'
      : (forceRefresh ? 'live-refresh' : (exchange ? 'live-trading-session' : 'live-post-close'));
    return { code, cacheKey, exchange, requestedKind, codeShouldReadCache, codeCachePolicy };
  });

  const kvCached = !forceRefresh
    ? await kvCacheMGetJson(env, cachePlans.filter((plan) => plan.codeShouldReadCache).map((plan) => plan.cacheKey)).catch(() => ({}))
    : {};

  const items = await mapLimit(cachePlans, 5, async (plan) => {
    const { code, cacheKey, exchange, requestedKind, codeShouldReadCache, codeCachePolicy } = plan;
    if (codeShouldReadCache) {
      const cachedKvItem = kvCached[cacheKey];
      if (cachedKvItem
        && String(cachedKvItem.code || '').replace(/^(sh|sz|bj)/i, '') === code
        && isSupportedFundMetricSource(cachedKvItem.source, exchange)
        && (Number(cachedKvItem.price) > 0 || Number(cachedKvItem.latestNav) > 0)) {
        const item = normalizeFundMetricFromQuote(code, cachedKvItem, {
          cached: true,
          cachePolicy: cachedKvItem.cachePolicy || 'kv',
          exchange,
          fundKind: requestedKind
        });
        return hydrateExchangeYtdReturn(env, code, item, exchange);
      }
      const cached = await readCachedFundMetric(env, cacheKey, requestedKind, exchange);
      if (cached) return cached;
    }
    if (!forceRefresh && isKvCacheEnabled(env) && !shouldFetchLiveOnMiss(env)) {
      return {
        ok: false,
        code,
        symbol: code,
        market: 'cn',
        fundKind: exchange ? 'exchange' : (requestedKind || 'otc'),
        fundType: '',
        fundTypeCode: null,
        fullName: '',
        price: null,
        currentPrice: null,
        close: null,
        previousClose: null,
        previousNav: null,
        previousNavDate: '',
        change: null,
        changePercent: null,
        latestNav: null,
        navBase: null,
        iopv: null,
        premiumPercent: null,
        latestNavDate: '',
        navDate: '',
        marketState: '',
        asOf: new Date().toISOString(),
        source: '',
        fallback: '',
        primaryError: '',
        error: 'kv cache miss',
        cached: false,
        cachePolicy: 'kv-only-miss'
      };
    }
    return await fetchFreshFundMetric(env, code, codeCachePolicy, requestedKind, exchange);
  });

  return json({
    items,
    successCount: items.filter((item) => item && item.ok !== false).length,
    failureCount: items.filter((item) => !item || item.ok === false).length,
    generatedAt: new Date().toISOString(),
    tradingSession,
    cache: { source: 'kv+live', codeCount: codes.length }
  });
}

/**
 * Only markets-center "today intraday" charts may hit live sources.
 * Everything else (backtests, multi-day session=all, daily/weekly, limit=all, etc.)
 * is R2-only; empty R2 does not backfill from Xueqiu/Sina/Yahoo.
 * Durable R2 history is filled by scheduled kline-batch jobs.
 */
function allowsLiveIntradayKline(market, tf, sessionMode, forceLive) {
  if (forceLive) return true;
  if (!INTRADAY_KLINE_INTERVALS.has(String(tf || ''))) return false;
  // session=all is multi-day history for backtests — R2 only.
  if (sessionMode === 'all') return false;
  // Default session=latest: today's intraday for markets center charts (cn + us).
  return market === 'cn' || market === 'us';
}

function emptyKlineResponse({ market, code, tf, r2Key, reason = 'r2-empty' }) {
  return json({
    market,
    symbol: code,
    interval: tf,
    generatedAt: new Date().toISOString(),
    candles: [],
    cached: true,
    source: reason,
    r2Key
  });
}

export async function handleKline(env, rawSymbol, params) {
  const tf = String(params.get('tf') || '1d');
  const { market, code } = classifySymbol(rawSymbol);
  if (!market) return errorJson('invalid symbol', 400);
  const rawDigits = String(rawSymbol || code || '').replace(/^(sh|sz|bj)/i, '');
  if (market === 'cn' && OTC_ALL_FUNDS.includes(rawDigits)) {
    return json({
      market,
      symbol: rawDigits,
      interval: tf,
      generatedAt: new Date().toISOString(),
      candles: [],
      cached: false,
      source: 'otc-fund-no-kline'
    });
  }
  const r2k = klineKey(market, code, tf);
  // forceLive reserved for ops: live=1. refresh=1 alone no longer opens full live backfill.
  const forceLive = params.get('live') === '1';
  const forceRefresh = params.get('refresh') === '1' || forceLive;
  const limitParam = String(params.get('limit') || '').trim().toLowerCase();
  const requestedLimit = limitParam === 'all'
    ? null
    : Math.max(1, Math.min(Number(limitParam) || 500, 3000));
  const sourceLimit = requestedLimit == null ? 3000 : requestedLimit;
  const sessionMode = params.get('session') === 'all' ? 'all' : 'latest';
  const allowLive = allowsLiveIntradayKline(market, tf, sessionMode, forceLive);

  console.log('[markets:kline] request', {
    rawSymbol,
    market,
    code,
    tf,
    forceRefresh,
    forceLive,
    allowLive,
    limit: requestedLimit,
    sessionMode,
    r2Key: r2k,
    nowIso: new Date().toISOString(),
    tradingMinute: market === 'cn' ? getShanghaiTradingMinute() : null,
    isCnTradingSession: market === 'cn' ? isCnTradingSession() : null
  });

  // ---- Always read R2 first (except explicit live=1 that still merges for history when present) ----
  const cached = await r2GetJson(env, r2k).catch(() => null);
  const hasR2 = Boolean(cached && Array.isArray(cached.candles) && cached.candles.length);

  if (hasR2 && !forceLive) {
    const cachedWithHigh = attachKlineHighPoint(cached, { interval: tf, source: 'daily-kline-365d' });
    if (tf === '1d' && ((cachedWithHigh.highPoint && !cached.highPoint) || (cachedWithHigh.closeHighPoint && !cached.closeHighPoint))) {
      await r2PutJson(env, r2k, cachedWithHigh).catch(() => {});
    }
    await writeKlineHighPointCache(env, { market, symbol: code, interval: tf, highPoint: cachedWithHigh.highPoint });
    await writeKlineCloseHighPointCache(env, { market, symbol: code, interval: tf, closeHighPoint: cachedWithHigh.closeHighPoint });

    // Non-live paths: serve R2 only (no age/stale live refresh).
    if (!allowLive) {
      console.log('[markets:kline] R2-only hit', {
        rawSymbol, market, code, tf, sessionMode,
        cache: describeKlinePayloadForLog(cached)
      });
      return json({
        ...buildKlineResponsePayload(cachedWithHigh, { market, tf, sessionMode, limit: requestedLimit }),
        cached: true,
        source: cached.batchSaved ? 'r2-batch' : 'r2-cache'
      });
    }

    // Live-allowed intraday (today chart): if R2 is fresh enough during session, still prefer R2;
    // otherwise fall through to live source for today's bars only (never write truncated session to R2).
    const stale = klineCacheIsStale({ cached, market, tf });
    if (!stale && !forceRefresh) {
      console.log('[markets:kline] intraday R2 fresh', {
        rawSymbol, market, code, tf,
        cache: describeKlinePayloadForLog(cached)
      });
      return json({
        ...buildKlineResponsePayload(cachedWithHigh, { market, tf, sessionMode, limit: requestedLimit }),
        cached: true,
        source: cached.batchSaved ? 'r2-batch' : 'r2-cache'
      });
    }
    console.log('[markets:kline] intraday R2 stale or refresh; live fetch for today only', {
      rawSymbol, market, code, tf, stale, forceRefresh
    });
  }

  if (!allowLive) {
    // Miss or empty: do not origin-fetch. Backtests / daily history depend on batch jobs.
    console.log('[markets:kline] R2-only miss (no origin fetch)', {
      rawSymbol, market, code, tf, sessionMode, r2Key: r2k, hasR2
    });
    if (hasR2) {
      // forceLive false + allowLive false already returned above when hasR2
    }
    return emptyKlineResponse({ market, code, tf, r2Key: r2k, reason: 'r2-empty' });
  }

  // Live path: markets-center today intraday only. Do not persist to R2 (cron owns durable history).
  let fresh;
  try {
    fresh = await refreshKline(env, market, code, tf, {
      limit: Math.min(sourceLimit, 500),
      sessionMode: 'latest',
      writeCache: false
    });
  } catch (error) {
    if (hasR2) {
      const cachedWithHigh = attachKlineHighPoint(cached, { interval: tf, source: 'daily-kline-365d' });
      return json({
        ...buildKlineResponsePayload(cachedWithHigh, { market, tf, sessionMode: 'latest', limit: requestedLimit }),
        cached: true,
        source: 'r2-fallback'
      });
    }
    throw error;
  }

  console.log('[markets:kline] response live intraday (not written to R2)', {
    rawSymbol, market, code, tf,
    payload: describeKlinePayloadForLog(fresh)
  });
  return json({
    ...buildKlineResponsePayload(fresh, { market, tf, sessionMode: 'latest', limit: requestedLimit }),
    cached: false,
    source: 'realtime'
  });
}

async function refreshKline(env, market, code, tf, { limit = 500, sessionMode = 'latest', writeCache = false } = {}) {
  let payload;
  if (market === 'us') {
    const yahooRange = { '1d': '5y', '1y': '5y', '1w': '5y', '1mo': '5y', '5m': '5d', '15m': '1mo', '60m': '3mo', '1m': '1d', '30m': '1mo' }[tf] || '5y';
    const yahooInterval = { '1d': '1d', '1y': '1d', '1w': '1wk', '1mo': '1mo', '5m': '5m', '15m': '15m', '60m': '60m', '1m': '1m', '30m': '30m' }[tf] || '1d';
    const raw = await fetchYahooChart(code, { range: yahooRange, interval: yahooInterval });
    payload = { ...normalizeYahooKline(raw, tf), market, generatedAt: new Date().toISOString() };
  } else {
    console.log('[markets:kline] fetch cn kline start', { market, code, tf, limit, sessionMode, nowIso: new Date().toISOString() });
    // Today intraday: Sina first for more reliable minute bars.
    const preferSina = INTRADAY_KLINE_INTERVALS.has(tf);
    payload = await fetchCnKlineWithFallback(env, code, tf, { limit, preferSina });
    console.log('[markets:kline] fetch cn kline done', { market, code, tf, payload: describeKlinePayloadForLog(payload) });
  }
  payload = sessionMode === 'all' ? payload : keepLatestCnIntradaySession(payload, market, tf);
  if (tf === '1d' && Number(limit) >= 365) {
    payload = attachKlineHighPoint(payload, {
      interval: tf,
      source: 'daily-kline-365d'
    });
    await writeKlineHighPointCache(env, { market, symbol: code, interval: tf, highPoint: payload.highPoint });
    await writeKlineCloseHighPointCache(env, { market, symbol: code, interval: tf, closeHighPoint: payload.closeHighPoint });
  }
  // Request path must not overwrite durable R2 history with short live windows.
  // Scheduled kline-batch is the only writer for multi-day R2 series.
  if (writeCache) {
    const r2k = klineKey(market, code, tf);
    const existing = await r2GetJson(env, r2k).catch(() => null);
    const toStore = buildKlinePayloadForR2Write(existing, payload, { market, tf });
    await r2PutJson(env, r2k, toStore);
    console.log('[markets:kline] cache write', {
      market,
      code,
      tf,
      r2Key: r2k,
      existingCandles: collectValidKlineCandles(existing).length,
      candidateCandles: collectValidKlineCandles(payload).length,
      storedCandles: collectValidKlineCandles(toStore).length,
      payload: describeKlinePayloadForLog(toStore)
    });
  }
  return payload;
}
