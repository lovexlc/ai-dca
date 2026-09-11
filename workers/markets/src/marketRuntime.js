import {
  fetchDanjuanFundNav,
  fetchSinaKline,
  fetchTencentCnQuote,
  fetchTencentCnQuotesBatch,
  fetchXueqiuKline,
  fetchXueqiuQuote,
  fetchXueqiuQuotesBatch
} from './fetchers.js';
import { kvGetJson, kvPutJson } from './storage.js';

export const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization',
  'access-control-max-age': '86400'
};

export const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  ...CORS_HEADERS
};

export const INTRADAY_KLINE_INTERVALS = new Set(['1m', '5m', '15m', '30m', '60m']);

const TEXT_ENCODER = new TextEncoder();

function timingSafeEqualString(left, right) {
  const a = TEXT_ENCODER.encode(String(left || ''));
  const b = TEXT_ENCODER.encode(String(right || ''));
  let diff = a.length ^ b.length;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    diff |= (a[i] || 0) ^ (b[i] || 0);
  }
  return diff === 0;
}

export function getMarketsAdminToken(env = {}) {
  return String(env.MARKETS_ADMIN_TOKEN || env.MARKETS_ADMIN_SECRET || env.ADMIN_TOKEN || '').trim();
}

export function isAuthorizedMarketsAdminRequest(request, env = {}) {
  const expected = getMarketsAdminToken(env);
  if (!expected) return false;
  const header = String(request?.headers?.get?.('authorization') || '').trim();
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  return timingSafeEqualString(match[1].trim(), expected);
}

export function requireMarketsAdminRequest(request, env = {}) {
  if (isAuthorizedMarketsAdminRequest(request, env)) return null;
  const status = getMarketsAdminToken(env) ? 401 : 503;
  const message = status === 401 ? 'admin authorization required' : 'MARKETS_ADMIN_TOKEN missing';
  return errorJson(message, status);
}

export async function mapLimit(items, limit, worker) {
  const list = Array.isArray(items) ? items : [];
  const out = new Array(list.length);
  const n = Math.max(1, Math.min(limit | 0 || 1, list.length));
  let cursor = 0;
  async function runner() {
    while (true) {
      const idx = cursor++;
      if (idx >= list.length) return;
      try {
        out[idx] = await worker(list[idx], idx);
      } catch (err) {
        out[idx] = { __error: err instanceof Error ? err.message : String(err) };
      }
    }
  }
  const runners = [];
  for (let i = 0; i < n; i += 1) runners.push(runner());
  await Promise.all(runners);
  return out;
}

export function json(payload, status = 200) {
  return new Response(JSON.stringify(payload, null, 2), { status, headers: JSON_HEADERS });
}

export function errorJson(message, status = 500, extra = {}) {
  return json({ error: String(message || 'internal error'), ...extra }, status);
}

export function roundNumber(value, precision = 4) {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const factor = 10 ** precision;
  return Math.round(n * factor) / factor;
}

export function getShanghaiTradingMinute(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(date).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  return { weekday: parts.weekday, minuteOfDay: hour * 60 + minute };
}

export function isCnTradingSession(date = new Date()) {
  const { weekday, minuteOfDay } = getShanghaiTradingMinute(date);
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  return (minuteOfDay >= 570 && minuteOfDay <= 690) || (minuteOfDay >= 780 && minuteOfDay <= 900);
}

export function klineCacheMaxAgeMs(market, tf) {
  if (market === 'cn' && INTRADAY_KLINE_INTERVALS.has(tf)) {
    return isCnTradingSession() ? 60 * 1000 : 6 * 3600 * 1000;
  }
  return null;
}

export function klineCacheIsStale({ cached, market, tf }) {
  const maxAgeMs = klineCacheMaxAgeMs(market, tf);
  if (Number.isFinite(maxAgeMs)) {
    const generatedAtMs = Date.parse(String(cached?.generatedAt || ''));
    return !Number.isFinite(generatedAtMs) || Date.now() - generatedAtMs > maxAgeMs;
  }
  const lastCandle = Array.isArray(cached?.candles) && cached.candles.length ? cached.candles[cached.candles.length - 1] : null;
  const lastT = Number(lastCandle?.t) * 1000;
  return tf === '1d' && (!Number.isFinite(lastT) || Date.now() - lastT > 36 * 3600 * 1000);
}

export function describeCandleForLog(candle) {
  if (!candle) return null;
  const t = Number(candle.t);
  return {
    t: Number.isFinite(t) ? t : null,
    iso: Number.isFinite(t) ? new Date(t * 1000).toISOString() : null,
    shanghai: Number.isFinite(t)
      ? new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      }).format(new Date(t * 1000))
      : null,
    o: candle.o,
    h: candle.h,
    l: candle.l,
    c: candle.c,
    v: candle.v
  };
}

export function describeKlinePayloadForLog(payload) {
  const candles = Array.isArray(payload?.candles) ? payload.candles : [];
  return {
    source: payload?.source,
    fallback: payload?.fallback,
    generatedAt: payload?.generatedAt,
    count: candles.length,
    first: describeCandleForLog(candles[0]),
    last: describeCandleForLog(candles[candles.length - 1])
  };
}

export function shanghaiDateKeyFromUnixSeconds(unixSeconds) {
  const t = Number(unixSeconds);
  if (!Number.isFinite(t)) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(t * 1000));
}

export function keepLatestCnIntradaySession(payload, market, tf) {
  if (market !== 'cn' || !INTRADAY_KLINE_INTERVALS.has(tf)) return payload;
  const candles = Array.isArray(payload?.candles) ? payload.candles : [];
  if (!candles.length) return payload;
  const latestDate = shanghaiDateKeyFromUnixSeconds(candles[candles.length - 1]?.t);
  if (!latestDate) return payload;
  const filtered = candles.filter((candle) => shanghaiDateKeyFromUnixSeconds(candle?.t) === latestDate);
  if (!filtered.length || filtered.length === candles.length) return payload;
  console.log('[markets:kline] cn intraday latest-session filter', {
    market,
    tf,
    latestDate,
    beforeCount: candles.length,
    afterCount: filtered.length,
    beforeFirst: describeCandleForLog(candles[0]),
    afterFirst: describeCandleForLog(filtered[0]),
    afterLast: describeCandleForLog(filtered[filtered.length - 1])
  });
  return { ...payload, candles: filtered };
}

export function summarizeXueqiuError(error) {
  return String((error && error.message) || error || 'unknown xueqiu error').slice(0, 300);
}

export async function notifyXueqiuCookieIssue(env, error, context = {}) {
  const reason = summarizeXueqiuError(error);
  const payload = {
    type: 'xueqiu_cookie_issue',
    title: '雪球 Cookie 失效或不可用',
    body: 'markets Worker 雪球行情不可用，场内行情将降级为腾讯价格，并尽量使用基金最新 NAV 补算溢价。',
    reason,
    context,
    generatedAt: new Date().toISOString()
  };
  try {
    const existing = await kvGetJson(env, 'alert:xueqiu-cookie').catch(() => null);
    if (existing) {
      console.warn('[markets:xueqiu] alert suppressed by rate limit', {
        reason,
        previousReason: existing.reason || '',
        previousGeneratedAt: existing.generatedAt || ''
      });
      return;
    }
    await kvPutJson(env, 'alert:xueqiu-cookie', payload, { ttlSeconds: 6 * 3600 }).catch(() => {});
  } catch (_) {}
  console.warn('[markets:xueqiu] cookie issue', payload);
  const notifyEndpoint = String(env.MARKETS_ADMIN_NOTIFY_ENDPOINT || 'https://api.freebacktrack.tech/api/notify/admin/alert').trim();
  const legacyWebhook = String(env.MARKETS_ADMIN_NOTIFY_WEBHOOK || '').trim();
  const token = String(env.MARKETS_ADMIN_NOTIFY_TOKEN || env.ADMIN_NOTIFY_TOKEN || env.ADMIN_TEST_TOKEN || '').trim();
  const targetUrl = notifyEndpoint || legacyWebhook;
  if (!targetUrl) return;
  try {
    const headers = { 'content-type': 'application/json' };
    if (token) headers['x-admin-token'] = token;
    const res = await fetch(targetUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ...payload,
        eventType: 'xueqiu_cookie_issue',
        ruleId: 'xueqiu-cookie',
        strategyName: 'markets Worker',
        triggerCondition: reason,
        detailUrl: 'https://dash.cloudflare.com/'
      })
    });
    if (!res.ok) console.warn('[markets:xueqiu] admin notify non-ok', res.status);
  } catch (notifyError) {
    console.warn('[markets:xueqiu] admin notify failed', String((notifyError && notifyError.message) || notifyError));
  }
}

async function enrichTencentQuoteWithFundNav(code, quote, primaryError = '') {
  const fallback = { ...quote, fallback: 'tencent-price', primaryError: summarizeXueqiuError(primaryError), premiumPercent: null };
  try {
    const nav = await fetchDanjuanFundNav(code, { includeDetail: false });
    const price = roundNumber(quote?.price ?? quote?.currentPrice ?? quote?.close, 4);
    const iopv = roundNumber(nav?.iopv, 4);
    const latestNav = roundNumber(nav?.latestNav, 4);
    const navBase = Number.isFinite(iopv) && iopv > 0 ? iopv : (Number.isFinite(latestNav) && latestNav > 0 ? latestNav : null);
    const premiumPercent = Number.isFinite(price) && price > 0 && Number.isFinite(navBase) && navBase > 0 ? roundNumber(((price - navBase) / navBase) * 100, 4) : null;
    return { ...fallback, latestNav: Number.isFinite(latestNav) ? latestNav : null, latestNavDate: String(nav?.latestNavDate || '').trim(), iopv: Number.isFinite(iopv) ? iopv : null, navBase, premiumPercent, premiumSource: Number.isFinite(iopv) && iopv > 0 ? 'iopv' : (navBase ? 'latest-nav' : 'unavailable'), navSource: nav?.source || 'danjuan' };
  } catch (navError) {
    return { ...fallback, navBase: null, latestNav: null, latestNavDate: '', iopv: null, premiumPercent: null, premiumSource: 'unavailable', navError: String((navError && navError.message) || navError || 'nav unavailable').slice(0, 300) };
  }
}

export async function fetchCnQuoteWithFallback(env, code, context = {}) {
  try { return await fetchXueqiuQuote(code, { cookie: env.XUEQIU_COOKIE }); }
  catch (error) {
    await notifyXueqiuCookieIssue(env, error, { ...context, code, endpoint: 'quote' });
    const primaryError = summarizeXueqiuError(error);
    try { return await enrichTencentQuoteWithFundNav(code, await fetchTencentCnQuote(code), primaryError); }
    catch (fallbackError) { throw new Error(`cn quote ${code} failed; primary: ${primaryError}; fallback: ${summarizeXueqiuError(fallbackError)}`); }
  }
}

export async function fetchCnQuotesBatchWithFallback(env, items = []) {
  const out = {};
  const codeList = items.map((item) => item.code);
  let xueqiuMap = {};
  try { xueqiuMap = await fetchXueqiuQuotesBatch(codeList, { cookie: env.XUEQIU_COOKIE }); }
  catch (error) { await notifyXueqiuCookieIssue(env, error, { endpoint: 'quotes', count: items.length }); xueqiuMap = {}; }
  const fallbackItems = [];
  for (const item of items) {
    const quote = xueqiuMap[item.code];
    if (quote && !quote.error) out[item.raw] = quote;
    else fallbackItems.push({ ...item, primaryError: quote?.error || 'xueqiu quote missing' });
  }
  if (!fallbackItems.length) return out;
  await notifyXueqiuCookieIssue(env, fallbackItems[0].primaryError, { endpoint: 'quotes', count: fallbackItems.length });
  let tencentMap = {};
  try { tencentMap = await fetchTencentCnQuotesBatch(fallbackItems.map((item) => item.code)); }
  catch (fallbackError) {
    const fallbackMessage = summarizeXueqiuError(fallbackError);
    for (const item of fallbackItems) out[item.raw] = { symbol: item.raw, error: `primary: ${item.primaryError || 'xueqiu quote missing'}; fallback: ${fallbackMessage}`, primaryError: item.primaryError || 'xueqiu quote missing', premiumPercent: null };
    return out;
  }
  await mapLimit(fallbackItems, 5, async (item) => {
    const quote = tencentMap[item.code];
    if (!quote || quote.error) { out[item.raw] = { symbol: item.raw, code: String(item.code || '').replace(/^(sh|sz|bj)/i, ''), error: quote?.error || 'tencent quote missing', primaryError: item.primaryError || 'xueqiu quote missing', premiumPercent: null }; return; }
    out[item.raw] = await enrichTencentQuoteWithFundNav(item.code, quote, item.primaryError);
  });
  return out;
}

export async function fetchCnKlineWithFallback(env, code, tf, { limit = 500 } = {}) {
  let primaryError;
  try {
    const payload = await fetchXueqiuKline(code, { cookie: env.XUEQIU_COOKIE, intervalLabel: tf, limit });
    return { ...payload, market: 'cn', generatedAt: new Date().toISOString() };
  } catch (error) {
    primaryError = summarizeXueqiuError(error);
    console.warn('[markets:kline] xueqiu primary failed; trying sina fallback', { code, tf, error: primaryError });
  }

  try {
    const payload = await fetchSinaKline(code, { intervalLabel: tf, limit });
    return {
      ...payload,
      market: 'cn',
      generatedAt: new Date().toISOString(),
      fallback: 'sina',
      primaryError
    };
  } catch (fallbackError) {
    const combinedError = new Error(`cn kline ${code} failed; primary: ${primaryError}; fallback: ${summarizeXueqiuError(fallbackError)}`);
    await notifyXueqiuCookieIssue(env, combinedError, { code, endpoint: 'kline', tf });
    throw combinedError;
  }
}
