/* global URLSearchParams, console */

import {
  fetchDanjuanFundMeta,
  fetchDanjuanFundNav,
  fetchXueqiuQuote,
  fetchYahooChart,
  normalizeYahooKline
} from './fetchers.js';
import { kvGetJson, kvPutJson, r2GetJson, r2PutJson, klineKey } from './storage.js';
import { classifySymbol } from './symbols.js';
import {
  describeKlinePayloadForLog,
  errorJson,
  fetchCnKlineWithFallback,
  getShanghaiTradingMinute,
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
  const spread = Number.isFinite(bidPrice) && Number.isFinite(askPrice)
    ? roundNumber(askPrice - bidPrice, 4)
    : roundNumber(book.spread, 4);
  const mid = Number.isFinite(bidPrice) && Number.isFinite(askPrice) ? (bidPrice + askPrice) / 2 : NaN;
  const spreadPercent = Number.isFinite(mid) && mid > 0 && Number.isFinite(spread)
    ? roundNumber((spread / mid) * 100, 4)
    : roundNumber(book.spreadPercent ?? book.spread_percent, 4);
  if (!Number.isFinite(bidPrice) && !Number.isFinite(askPrice)) return null;
  return {
    bidPrice: Number.isFinite(bidPrice) ? bidPrice : null,
    bidVolume: Number.isFinite(bidVolume) ? bidVolume : null,
    askPrice: Number.isFinite(askPrice) ? askPrice : null,
    askVolume: Number.isFinite(askVolume) ? askVolume : null,
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

export function normalizeFundMetricFromQuote(code, quote, { cached = false, cachePolicy = '', primaryError = '', exchange = isExchangeTradedFund(code), fundKind = '' } = {}) {
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
  return {
    ok: !quote?.error,
    code: String(quote?.code || code || '').trim(),
    symbol: String(quote?.symbol || code || '').trim(),
    name: String(quote?.name || '').trim(),
    market: 'cn',
    fundKind: resolvedFundKind,
    fundType: String(quote?.fundType || quote?.typeDesc || '').trim(),
    fundTypeCode: quote?.fundTypeCode ?? null,
    fullName: String(quote?.fullName || '').trim(),
    price,
    currentPrice: currentValue,
    close: currentValue,
    high: roundNumber(quote?.high, 4),
    low: roundNumber(quote?.low, 4),
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
    ytdReturn: quote?.ytdReturn ?? null,
    return1w: quote?.return1w ?? null,
    return1m: quote?.return1m ?? null,
    return3m: quote?.return3m ?? null,
    return6m: quote?.return6m ?? null,
    return1y: quote?.return1y ?? null,
    returnBase: quote?.returnBase ?? null,
  };
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
  const requestedLimit = Math.max(1, Math.min(Number(limit) || 1000, 1000));
  const limitedCandles = mergedCandles.slice(-requestedLimit);
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
    candles: limitedCandles
  };
  return klinePayloadForSession(payload, market, tf, sessionMode);
}

async function readCachedFundMetric(env, cacheKey, fundKind = '') {
  const cached = await kvGetJson(env, cacheKey).catch(() => null);
  if (!cached || !cached.code) return null;
  const hasNav = Number(cached.latestNav) > 0;
  const hasPrice = Number(cached.price) > 0;
  if (!hasNav && !hasPrice) return null;
  const code = String(cached.code || '').trim();
  if (isExchangeTradedFund(code) && String(cached.source || '').trim() !== 'xueqiu-quote') {
    return null;
  }
  let quote = cached;
  if (!isExchangeTradedFund(code) && !cached.fundKind && !cached.fundType) {
    const meta = await fetchDanjuanFundMetaWithCache(env, code).catch(() => null);
    if (meta) {
      quote = { ...cached, ...meta };
      await kvPutJson(env, cacheKey, quote, { ttlSeconds: 24 * 3600 }).catch(() => {});
    }
  }
  return normalizeFundMetricFromQuote(code, quote, { cached: true, cachePolicy: 'kv-closed-session', fundKind });
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

function isDanjuanUpdatedToday(updatedAtMs) {
  if (!updatedAtMs) return false;
  const shanghai = new Date(updatedAtMs).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  return shanghai === today;
}

async function fetchFreshFundMetric(env, code, cachePolicy, fundKind = '') {
  const cacheKey = 'fund-metrics:' + code;
  const exchange = isExchangeTradedFund(code);
  try {
    let quote = exchange
      ? await fetchXueqiuQuote(code, { cookie: env.XUEQIU_COOKIE })
      : await fetchDanjuanFundNav(code);
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
    return item;
  } catch (error) {
    const primaryError = summarizeXueqiuError(error);
    if (exchange) {
      await notifyXueqiuCookieIssue(env, error, { code, endpoint: 'fund-metrics' });
      const cached = await readCachedFundMetric(env, cacheKey);
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
      error: exchange ? `xueqiu quote unavailable: ${primaryError}` : String((error && error.message) || error),
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

  const items = await mapLimit(codes, 5, async (code) => {
    const cacheKey = 'fund-metrics:' + code;
    const exchange = isExchangeTradedFund(code);
    const requestedKind = exchange ? 'exchange' : normalizeFundKindHint(fundKindHints[code]);
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
    if (codeShouldReadCache) {
      const cached = await readCachedFundMetric(env, cacheKey, requestedKind);
      if (cached) return cached;
    }
    return await fetchFreshFundMetric(env, code, codeCachePolicy, requestedKind);
  });

  return json({
    items,
    successCount: items.filter((item) => item && item.ok !== false).length,
    failureCount: items.filter((item) => !item || item.ok === false).length,
    generatedAt: new Date().toISOString(),
    tradingSession
  });
}

export async function handleKline(env, rawSymbol, params) {
  const tf = String(params.get('tf') || '1d');
  const { market, code } = classifySymbol(rawSymbol);
  if (!market) return errorJson('invalid symbol', 400);
  const r2k = klineKey(market, code, tf);
  const forceRefresh = params.get('refresh') === '1';
  const requestedLimit = Math.max(1, Math.min(Number(params.get('limit')) || 500, 1000));
  const sessionMode = params.get('session') === 'all' ? 'all' : 'latest';
  const shouldMergeR2 = params.get('mergeR2') === '1' || params.get('includeR2') === '1';
  const shouldUseDefaultCache = sessionMode === 'latest' && requestedLimit <= 500;

  console.log('[markets:kline] request', {
    rawSymbol,
    market,
    code,
    tf,
    forceRefresh,
    limit: requestedLimit,
    sessionMode,
    mergeR2: shouldMergeR2,
    r2Key: r2k,
    nowIso: new Date().toISOString(),
    tradingMinute: market === 'cn' ? getShanghaiTradingMinute() : null,
    isCnTradingSession: market === 'cn' ? isCnTradingSession() : null
  });

  // 策略：优先从 R2 读取批量保存的历史数据
  // 只有在以下情况才会触发实时抓取：
  // 1. forceRefresh=1 明确要求刷新
  // 2. R2 中没有数据
  // 3. 数据过期且正在交易时段
  if (!forceRefresh && shouldUseDefaultCache) {
    const cached = await r2GetJson(env, r2k);
    if (cached && cached.candles && cached.candles.length) {
      const stale = klineCacheIsStale({ cached, market, tf });
      const sourceOk = market !== 'cn' || cached.source === 'xueqiu-kline';

      console.log('[markets:kline] R2 cache check', {
        rawSymbol,
        market,
        code,
        tf,
        stale,
        sourceOk,
        hasBatchSavedFlag: !!cached.batchSaved,
        cache: describeKlinePayloadForLog(cached)
      });

      // 如果有批量保存的标记，且数据不是太旧，直接使用
      // 批量保存的数据是高质量的完整历史数据，优先使用
      if (cached.batchSaved) {
        const age = Date.now() - new Date(cached.generatedAt || 0).getTime();
        const maxAgeMs = tf === '1d' ? 24 * 60 * 60 * 1000 : 2 * 60 * 60 * 1000; // 日线24h，分钟线2h

        if (age < maxAgeMs) {
          console.log('[markets:kline] Using batch-saved data from R2', {
            rawSymbol, tf, age: Math.round(age / 1000 / 60) + 'min'
          });
          return json({ ...klinePayloadForSession(cached, market, tf, sessionMode), cached: true, source: 'r2-batch' });
        }
      }

      // 非批量保存的数据，使用原有的过期策略
      if (!stale && sourceOk) {
        return json({ ...klinePayloadForSession(cached, market, tf, sessionMode), cached: true, source: 'r2-cache' });
      }
    } else {
      console.log('[markets:kline] R2 cache miss', { rawSymbol, market, code, tf, r2Key: r2k });
    }
  } else {
    console.log('[markets:kline] request skips default cache', { rawSymbol, market, code, tf, forceRefresh, sessionMode, requestedLimit, r2Key: r2k });
  }

  // 只有在必要时才实时抓取
  const cachedForMerge = shouldMergeR2 ? await r2GetJson(env, r2k).catch(() => null) : null;
  const fresh = await refreshKline(env, market, code, tf, { limit: requestedLimit, sessionMode, writeCache: shouldUseDefaultCache });
  if (shouldMergeR2 && cachedForMerge && Array.isArray(cachedForMerge.candles) && cachedForMerge.candles.length) {
    const merged = mergeKlinePayloadsWithR2(cachedForMerge, fresh, {
      market,
      tf,
      limit: requestedLimit,
      sessionMode
    });
    console.log('[markets:kline] response merged with R2', {
      rawSymbol,
      market,
      code,
      tf,
      r2Key: r2k,
      r2CandleCount: merged.r2CandleCount,
      freshCandleCount: merged.freshCandleCount,
      mergedCandleCount: merged.mergedCandleCount,
      payload: describeKlinePayloadForLog(merged)
    });
    return json(merged);
  }
  console.log('[markets:kline] response fresh (realtime fetch)', {
    rawSymbol,
    market,
    code,
    tf,
    payload: describeKlinePayloadForLog(fresh)
  });
  return json({ ...fresh, cached: false, source: 'realtime' });
}

async function refreshKline(env, market, code, tf, { limit = 500, sessionMode = 'latest', writeCache = true } = {}) {
  let payload;
  if (market === 'us') {
    const yahooRange = { '1d': '5y', '1y': '5y', '1w': '5y', '1mo': '5y', '5m': '5d', '15m': '1mo', '60m': '3mo' }[tf] || '5y';
    const yahooInterval = { '1d': '1d', '1y': '1d', '1w': '1wk', '1mo': '1mo', '5m': '5m', '15m': '15m', '60m': '60m' }[tf] || '1d';
    const raw = await fetchYahooChart(code, { range: yahooRange, interval: yahooInterval });
    payload = { ...normalizeYahooKline(raw, tf), market, generatedAt: new Date().toISOString() };
  } else {
    console.log('[markets:kline] fetch xueqiu primary start', { market, code, tf, limit, sessionMode, nowIso: new Date().toISOString() });
    payload = await fetchCnKlineWithFallback(env, code, tf, { limit });
    console.log('[markets:kline] fetch cn kline done', { market, code, tf, payload: describeKlinePayloadForLog(payload) });
  }
  payload = sessionMode === 'all' ? payload : keepLatestCnIntradaySession(payload, market, tf);
  if (writeCache) {
    await r2PutJson(env, klineKey(market, code, tf), payload);
    console.log('[markets:kline] cache write', { market, code, tf, r2Key: klineKey(market, code, tf), payload: describeKlinePayloadForLog(payload) });
  }
  return payload;
}
