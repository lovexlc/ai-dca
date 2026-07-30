/**
 * OTC + batch quotes handlers (D1-first when OTC_READ_FROM_D1 / MARKETS_ENV=test).
 */
import { attachHistoricalPercentile } from './historicalPercentile.js';
import { attachMarketQuoteHighPoint, hasMarketQuoteHighPoint } from './marketQuoteHighPoint.js';
import { fillCnBatchQuotes } from './cnBatchQuotes.js';
import {
  isNewerOtcQuote,
  isQuoteDelayed,
  isUsableQuoteCache,
  quoteCacheTtlSeconds,
  readFreshQuoteCacheMap,
  readStaleQuoteCache,
  writeQuoteCache,
} from './quoteCache.js';
import {
  fetchOtcFundFullData,
  getOtcFundFromCache,
  OTC_FUND_STORAGE_TTL_SECONDS,
  transformOtcFundData,
} from './otcFundSync.js';
import { OTC_ALL_FUNDS } from './otcFundList.js';
import { classifySymbol } from './symbols.js';
import { errorJson, json, mapLimit } from './marketRuntime.js';
import { CACHE_TTL, isKvCacheEnabled, shouldFetchLiveOnMiss } from './kvCache.js';
import { markThirdPartyApiFailure } from './thirdPartyApiAlert.js';
import { loadOtcD1QuotesIfEnabled, pickOtcD1Quote } from './otcQuoteRead.js';
import {
  fetchYahooChart,
  isSpecialMarketIndicator,
  normalizeYahooQuote,
  fetchSpecialMarketIndicatorQuote,
} from './fetchers.js';
import { quoteKey } from '../../shared/src/keySchemas.js';

const otcQuoteInflight = new Map();

export async function fetchOtcQuote(env, code) {
  const normalizedCode = String(code || '').replace(/^(sh|sz|bj)/i, '');
  // Test/read-split: D1 is the list SQL store (nav + limit); no write on read.
  {
    const d1Map = await loadOtcD1QuotesIfEnabled(env, [normalizedCode]);
    const d1q = pickOtcD1Quote(d1Map, normalizedCode);
    if (d1q) {
      const otcWithPct = await attachHistoricalPercentile(env, d1q, 'cn');
      return {
        ...otcWithPct,
        cached: true,
        cache: { hit: true, source: 'd1', status: 'fresh' },
      };
    }
  }
  const staleQuote = await readStaleQuoteCache(env, normalizedCode, 'otc');
  const cachedOtc = await getOtcFundFromCache(normalizedCode, env.MARKETS_KV);
  const delayedQuote = [staleQuote, cachedOtc].find((candidate) => candidate
    && isQuoteDelayed(candidate, 'otc')
    && isUsableQuoteCache(candidate, 'otc', { allowStale: true }));
  if (delayedQuote) {
    const otcWithPct = await attachHistoricalPercentile(env, delayedQuote, 'cn');
    return { ...otcWithPct, cached: true, cache: { hit: true, source: 'kv', status: 'delayed' } };
  }
  if (cachedOtc && (cachedOtc.price || cachedOtc.latestNav || cachedOtc.currentPrice)
    && isUsableQuoteCache(cachedOtc, 'otc')) {
    console.log('[quote] OTC fund from cache:', normalizedCode);
    const otcWithPct = await attachHistoricalPercentile(env, cachedOtc, 'cn');
    return { ...otcWithPct, cached: true, cache: { hit: true, source: 'kv', status: 'fresh' } };
  }

  console.log('[quote] OTC fund cache miss, fetching from Danjuan:', normalizedCode);
  const fullData = await fetchOtcFundFullData(normalizedCode);
  const quote = transformOtcFundData(fullData);
  if (!quote) return null;
  const otcWithPct = await attachHistoricalPercentile(env, quote, 'cn');
  const previous = staleQuote || cachedOtc || null;
  const writeCache = isNewerOtcQuote(otcWithPct, previous);
  if (writeCache) {
    await env.MARKETS_KV?.put(`otc-raw:${normalizedCode}`, JSON.stringify(fullData), {
      expirationTtl: OTC_FUND_STORAGE_TTL_SECONDS
    });
    console.log('[quote] OTC fund saved to cache:', normalizedCode);
  } else {
    console.log('[quote] OTC fund source has no newer NAV; skip cache write:', normalizedCode);
  }
  return {
    ...otcWithPct,
    cached: false,
    cache: {
      hit: false,
      source: 'live',
      write: writeCache,
      ...(writeCache ? {} : { reason: 'source-nav-not-newer' })
    },
    ...(writeCache ? {} : { stale: true })
  };
}

export function fetchOtcQuoteDeduped(env, code) {
  const normalizedCode = String(code || '').replace(/^(sh|sz|bj)/i, '');
  const active = otcQuoteInflight.get(normalizedCode);
  if (active) return active;
  const promise = fetchOtcQuote(env, normalizedCode).finally(() => {
    if (otcQuoteInflight.get(normalizedCode) === promise) otcQuoteInflight.delete(normalizedCode);
  });
  otcQuoteInflight.set(normalizedCode, promise);
  return promise;
}

export async function handleBatchQuotes(env, symbolsParam) {
  const list = String(symbolsParam || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!list.length) return json({ quotes: {} });
  if (list.length > 60) {
    return errorJson('symbols too many (max 60)', 400);
  }
  const out = {};
  const cnItems = [];
  const otcItems = [];
  const usItems = [];
  const normalizedItems = [];
  for (const raw of list) {
    const { market, code } = classifySymbol(raw);
    if (!market) continue;
    const digits = String(raw || code || '').replace(/^(sh|sz|bj)/i, '');
    const normalized = market === 'cn' && OTC_ALL_FUNDS.includes(digits) ? digits : code;
    normalizedItems.push({ raw, market, code: normalized });
  }
  const quoteCacheItems = normalizedItems.map((item) => {
    const digits = String(item.raw || item.code || '').replace(/^(sh|sz|bj)/i, '');
    return item.market === 'cn' && OTC_ALL_FUNDS.includes(digits)
      ? { ...item, market: 'otc' }
      : item;
  });
  const freshQuoteCached = await readFreshQuoteCacheMap(env, quoteCacheItems);

  const otcCodesForD1 = [];
  for (const item of normalizedItems) {
    const digits = String(item.raw || item.code || '').replace(/^(sh|sz|bj)/i, '');
    if (item.market === 'cn' && OTC_ALL_FUNDS.includes(digits)) otcCodesForD1.push(digits);
  }
  const d1OtcQuotes = await loadOtcD1QuotesIfEnabled(env, otcCodesForD1);

  for (const item of normalizedItems) {
    const digits = String(item.raw || item.code || '').replace(/^(sh|sz|bj)/i, '');
    const isOtc = item.market === 'cn' && OTC_ALL_FUNDS.includes(digits);
    if (isOtc) {
      const d1q = pickOtcD1Quote(d1OtcQuotes, digits, item.raw);
      if (d1q) {
        out[item.raw] = {
          ...(await attachHistoricalPercentile(env, d1q, 'cn')),
          cached: true,
          cache: { hit: true, source: 'd1' },
        };
        continue;
      }
    }
    const cached = freshQuoteCached[quoteKey(item.code)];
    if (cached && (cached.price || cached.currentPrice || cached.close || cached.latestNav)) {
      const cachedWithHigh = await attachMarketQuoteHighPoint(env, cached, { market: item.market, symbol: item.code });
      if (hasMarketQuoteHighPoint(cachedWithHigh, item.market)) {
        out[item.raw] = {
          ...(await attachHistoricalPercentile(env, cachedWithHigh, isOtc ? 'cn' : item.market)),
          cached: true,
          cache: { hit: true, source: 'kv' }
        };
        continue;
      }
    }
    if (isOtc) otcItems.push({ raw: item.raw, code: digits });
    else if (item.market === 'cn') cnItems.push({ raw: item.raw, code: item.code });
    else usItems.push({ raw: item.raw, code: item.code });
  }
  if (isKvCacheEnabled(env) && !shouldFetchLiveOnMiss(env) && (otcItems.length || cnItems.length || usItems.length)) {
    return json({ quotes: out, generatedAt: new Date().toISOString(), partial: true, cache: { hit: true, source: 'kv', missing: otcItems.length + cnItems.length + usItems.length } });
  }
  await mapLimit(otcItems, 5, async (item) => {
    try {
      out[item.raw] = await fetchOtcQuoteDeduped(env, item.code) || {
        symbol: item.raw,
        code: item.code,
        error: 'OTC fund data unavailable',
        source: 'danjuan'
      };
    } catch (err) {
      out[item.raw] = { symbol: item.raw, error: String((err && err.message) || err), source: 'danjuan' };
    }
  });
  if (cnItems.length) await fillCnBatchQuotes(env, cnItems, out, { hydrateHighPoints: false });
  await mapLimit(usItems, 5, async (item) => {
    try {
      let q;
      if (isSpecialMarketIndicator(item.code)) {
        q = await fetchSpecialMarketIndicatorQuote(item.code);
      } else {
        const r = await fetchYahooChart(item.code, { range: '1d', interval: '5m' });
        q = normalizeYahooQuote(r);
      }
      const enriched = await attachHistoricalPercentile(env, q, 'us');
      out[item.raw] = await attachMarketQuoteHighPoint(env, enriched, { market: 'us', symbol: item.code });
    } catch (err) {
      out[item.raw] = { symbol: item.raw, error: String((err && err.message) || err) };
    }
  });
  const batchTtlSeconds = normalizedItems.length && normalizedItems.every((item) => item.market === 'cn')
    ? quoteCacheTtlSeconds('cn')
    : CACHE_TTL.quote;
  await mapLimit(Object.entries(out), 8, async ([raw, quote]) => {
    const matched = normalizedItems.find((item) => item.raw === raw);
    if (!matched || !quote || quote.error) return;
    const cacheSource = String(quote.cache?.source || '').trim();
    if (cacheSource === 'kv' || cacheSource === 'kv-stale' || quote.cache?.write === false) return;
    const digits = String(matched.raw || matched.code || '').replace(/^(sh|sz|bj)/i, '');
    if (matched.market === 'cn' && OTC_ALL_FUNDS.includes(digits)) {
      await writeQuoteCache(env, matched.code, quote, { ttlSeconds: quoteCacheTtlSeconds('otc') });
      return;
    }
    await writeQuoteCache(env, matched.code, quote, { ttlSeconds: batchTtlSeconds });
  });
  const failedQuotes = Object.values(out).filter((quote) => quote && quote.error);
  if (failedQuotes.length) {
    markThirdPartyApiFailure(env, {
      source: 'markets quotes',
      error: `${failedQuotes.length} quote request(s) failed`
    });
  }
  return json({ quotes: out, generatedAt: new Date().toISOString() });
}

