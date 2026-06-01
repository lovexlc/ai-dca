import {
  fetchDanjuanFundNav,
  fetchYahooChart,
  normalizeYahooKline
} from './fetchers.js';
import { kvGetJson, kvPutJson, r2GetJson, r2PutJson, klineKey } from './storage.js';
import { classifySymbol } from './symbols.js';
import {
  describeKlinePayloadForLog,
  errorJson,
  fetchCnKlineWithFallback,
  fetchCnQuoteWithFallback,
  getShanghaiTradingMinute,
  isCnTradingSession,
  json,
  keepLatestCnIntradaySession,
  klineCacheIsStale,
  mapLimit,
  roundNumber
} from './marketRuntime.js';

function firstPositiveNumber(...values) {
  for (const value of values) {
    const rounded = roundNumber(value, 4);
    if (Number.isFinite(rounded) && rounded > 0) return rounded;
  }
  return null;
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

export function normalizeFundMetricFromQuote(code, quote, { cached = false, cachePolicy = '', primaryError = '', exchange = isExchangeTradedFund(code) } = {}) {
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
  return {
    ok: !quote?.error,
    code: String(quote?.code || code || '').trim(),
    symbol: String(quote?.symbol || code || '').trim(),
    name: String(quote?.name || '').trim(),
    market: 'cn',
    price,
    currentPrice: currentValue,
    close: currentValue,
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
    marketState: String(quote?.marketState || '').trim(),
    asOf: String(quote?.asOf || new Date().toISOString()).trim(),
    source: String(quote?.source || '').trim(),
    fallback: quote?.fallback || '',
    primaryError: primaryError || quote?.primaryError || '',
    error: quote?.error || '',
    cached,
    cachePolicy
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

async function readCachedFundMetric(env, cacheKey) {
  const cached = await kvGetJson(env, cacheKey).catch(() => null);
  if (!cached || !cached.code) return null;
  const hasNav = Number(cached.latestNav) > 0;
  const hasPrice = Number(cached.price) > 0;
  if (!hasNav && !hasPrice) return null;
  return normalizeFundMetricFromQuote(cached.code, cached, { cached: true, cachePolicy: 'kv-closed-session' });
}

function isDanjuanUpdatedToday(updatedAtMs) {
  if (!updatedAtMs) return false;
  const shanghai = new Date(updatedAtMs).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  return shanghai === today;
}

async function fetchFreshFundMetric(env, code, cachePolicy) {
  const cacheKey = 'fund-metrics:' + code;
  const exchange = isExchangeTradedFund(code);
  try {
    const quote = exchange
      ? await fetchCnQuoteWithFallback(env, code, { endpoint: 'fund-metrics' })
      : await fetchDanjuanFundNav(code);
    const item = normalizeFundMetricFromQuote(code, quote, { cached: false, cachePolicy, exchange });
    // 场内始终缓存；场外仅当 updated_at 是今天时缓存（净值已发布）
    const shouldCache = exchange || isDanjuanUpdatedToday(quote?.updatedAt);
    if (shouldCache) {
      await kvPutJson(env, cacheKey, item, { ttlSeconds: 24 * 3600 }).catch(() => {});
    }
    return item;
  } catch (error) {
    return {
      ok: false,
      code,
      symbol: code,
      market: 'cn',
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
      error: String((error && error.message) || error),
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

  const forceRefresh = body?.refresh === true || params.get('refresh') === '1';
  const { weekday, minuteOfDay } = getShanghaiTradingMinute();
  const isWeekday = weekday !== 'Sat' && weekday !== 'Sun';
  const tradingSession = isWeekday && ((minuteOfDay >= 570 && minuteOfDay <= 690) || (minuteOfDay >= 780 && minuteOfDay <= 900));

  const items = await mapLimit(codes, 5, async (code) => {
    const cacheKey = 'fund-metrics:' + code;
    const exchange = isExchangeTradedFund(code);
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
      const cached = await readCachedFundMetric(env, cacheKey);
      if (cached) return cached;
    }
    return await fetchFreshFundMetric(env, code, codeCachePolicy);
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
  console.log('[markets:kline] request', {
    rawSymbol,
    market,
    code,
    tf,
    forceRefresh,
    r2Key: r2k,
    nowIso: new Date().toISOString(),
    tradingMinute: market === 'cn' ? getShanghaiTradingMinute() : null,
    isCnTradingSession: market === 'cn' ? isCnTradingSession() : null
  });
  if (!forceRefresh) {
    const cached = await r2GetJson(env, r2k);
    if (cached && cached.candles && cached.candles.length) {
      const stale = klineCacheIsStale({ cached, market, tf });
      const sourceOk = market !== 'cn' || cached.source === 'xueqiu-kline' || cached.source === 'sina-kline';
      console.log('[markets:kline] cache check', {
        rawSymbol,
        market,
        code,
        tf,
        stale,
        sourceOk,
        cache: describeKlinePayloadForLog(cached)
      });
      if (!stale && sourceOk) return json({ ...cached, cached: true });
    } else {
      console.log('[markets:kline] cache miss', { rawSymbol, market, code, tf, r2Key: r2k });
    }
  } else {
    console.log('[markets:kline] force refresh skips cache', { rawSymbol, market, code, tf, r2Key: r2k });
  }
  const fresh = await refreshKline(env, market, code, tf);
  console.log('[markets:kline] response fresh', {
    rawSymbol,
    market,
    code,
    tf,
    payload: describeKlinePayloadForLog(fresh)
  });
  return json({ ...fresh, cached: false });
}

async function refreshKline(env, market, code, tf) {
  let payload;
  if (market === 'us') {
    const yahooRange = { '1d': '1mo', '1w': '1y', '1mo': '5y', '5m': '5d', '15m': '1mo', '60m': '3mo' }[tf] || '1mo';
    const yahooInterval = { '1d': '1d', '1w': '1wk', '1mo': '1mo', '5m': '5m', '15m': '15m', '60m': '60m' }[tf] || '1d';
    const raw = await fetchYahooChart(code, { range: yahooRange, interval: yahooInterval });
    payload = { ...normalizeYahooKline(raw, tf), market, generatedAt: new Date().toISOString() };
  } else {
    console.log('[markets:kline] fetch xueqiu primary start', { market, code, tf, limit: 500, nowIso: new Date().toISOString() });
    payload = await fetchCnKlineWithFallback(env, code, tf);
    console.log('[markets:kline] fetch cn kline done', { market, code, tf, payload: describeKlinePayloadForLog(payload) });
  }
  payload = keepLatestCnIntradaySession(payload, market, tf);
  await r2PutJson(env, klineKey(market, code, tf), payload);
  console.log('[markets:kline] cache write', { market, code, tf, r2Key: klineKey(market, code, tf), payload: describeKlinePayloadForLog(payload) });
  return payload;
}
