/**
 * POST /list-rows — SQL-style ORDER BY + LIMIT list page over caller-supplied symbols.
 *
 * Body:
 * {
 *   symbols: string[],          // universe (e.g. watchlist)
 *   market?: 'cn'|'us',
 *   isOtcList?: boolean,
 *   heldSymbols?: string[],     // optional held set for isHeld + heldRank
 *   orderBy?: [{ field, dir }],
 *   limit?: number,
 *   cursor?: string,
 *   offset?: number,
 *   filters?: [{ field, op, value }],
 * }
 *
 * Response:
 * { items, total, nextCursor, hasMore, applied, quotes partial metadata }
 *
 * Sorting uses quote KV cache (+ high-point attach). Does not scan R2 klines.
 * Fund-limit sort uses optional limitByCode map if provided in body (OCR is separate worker).
 */

import { fillCnBatchQuotes } from './cnBatchQuotes.js';
import {
  isUsableQuoteCache,
  quoteCacheTtlSeconds,
  readFreshQuoteCacheMap,
  writeQuoteCache,
} from './quoteCache.js';
import { attachHistoricalPercentile } from './historicalPercentile.js';
import { attachMarketQuoteHighPoint, hasMarketQuoteHighPoint } from './marketQuoteHighPoint.js';
import { getOtcFundFromCache } from './otcFundSync.js';
import { OTC_ALL_FUNDS } from './otcFundList.js';
import { hasOtcD1, loadOtcQuotesFromD1 } from './otcFundD1.js';
import { classifySymbol } from './symbols.js';
import { errorJson, json, mapLimit } from './marketRuntime.js';
import {
  isKvCacheEnabled,
  shouldFetchLiveOnMiss,
} from './kvCache.js';
import {
  LIST_QUERY_MAX_LIMIT,
  normalizeListQuery,
  parseOrderByParam,
  queryListRows,
  serializeOrderBy,
} from './listQuery.js';

const MAX_SYMBOLS = 200;

function normalizeCode(raw) {
  return String(raw || '').replace(/^(sh|sz|bj|jj)/i, '').trim();
}

function normalizeSymbolList(symbols) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(symbols) ? symbols : []) {
    const s = String(raw || '').trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= MAX_SYMBOLS) break;
  }
  return out;
}

function heldSetFrom(heldSymbols) {
  const set = new Set();
  for (const raw of Array.isArray(heldSymbols) ? heldSymbols : []) {
    const s = String(raw || '').trim();
    if (s) set.add(s);
    const code = normalizeCode(s);
    if (code) set.add(code);
  }
  return set;
}

function isOtcCode(code, isOtcList) {
  const digits = normalizeCode(code);
  if (isOtcList) return true;
  return OTC_ALL_FUNDS.includes(digits);
}

function pickPrice(quote) {
  const n = Number(quote?.price ?? quote?.latestNav ?? quote?.currentPrice ?? quote?.close);
  return Number.isFinite(n) ? n : null;
}

function pickChangePercent(quote) {
  const n = Number(quote?.changePercent);
  return Number.isFinite(n) ? n : null;
}

function pickPremium(quote) {
  const n = Number(quote?.premiumPercent ?? quote?.premium_rate);
  return Number.isFinite(n) ? n : null;
}

/**
 * Build a lightweight sort/display row from a quote cache entry.
 * Keeps payload small: list page fields only.
 */
export function buildListRowFromQuote({
  symbol,
  quote = null,
  market = 'cn',
  isOtcList = false,
  heldSet = null,
  limitByCode = null,
}) {
  const code = normalizeCode(symbol);
  const q = quote && !quote.error ? quote : {};
  const otc = isOtcCode(symbol, isOtcList) || isOtcCode(code, isOtcList);
  const held = heldSet
    ? (heldSet.has(symbol) || heldSet.has(code) || heldSet.has(String(q.symbol || '')))
    : Boolean(q.isHeld);
  const fundLimit = (limitByCode && (limitByCode[code] || limitByCode[symbol])) || q.fundLimit || null;

  return {
    symbol,
    code,
    name: q.name || symbol,
    price: pickPrice(q),
    changePercent: pickChangePercent(q),
    change: q.change ?? null,
    premiumPercent: pickPremium(q),
    premium_rate: pickPremium(q),
    latestNav: q.latestNav ?? null,
    latestNavDate: q.latestNavDate || '',
    iopv: q.iopv ?? null,
    return1m: q.return1m ?? null,
    return3m: q.return3m ?? null,
    return1y: q.return1y ?? null,
    historicalPercentile: q.historicalPercentile ?? null,
    highPoint: q.highPoint || null,
    closeHighPoint: q.closeHighPoint || null,
    yearHigh: q.yearHigh ?? q.highPoint?.high ?? null,
    turnover: q.turnover ?? q.amount ?? null,
    volume: q.volume ?? null,
    exchange: q.exchange || '',
    fundKind: otc ? 'otc' : 'exchange',
    kind: otc ? 'otc' : 'exchange',
    isHeld: held,
    fundLimit,
    market: market || (otc ? 'cn' : q.market) || 'cn',
    asOf: q.asOf || q.updatedAt || q.time || '',
    source: q.source || '',
  };
}

/**
 * Load quotes for symbols from KV (and optional live fill for CN exchange).
 * Caps concurrent work; never hydrates R2 candles for sort keys.
 */
export async function loadQuotesForListRows(env, symbols, { market = 'cn', isOtcList = false } = {}) {
  const list = normalizeSymbolList(symbols);
  const out = {};
  if (!list.length) return out;

  const normalizedItems = [];
  for (const raw of list) {
    const classified = classifySymbol(raw);
    let mkt = classified.market || market || 'cn';
    let code = classified.code || normalizeCode(raw);
    const digits = normalizeCode(raw);
    if (mkt === 'cn' && (isOtcList || OTC_ALL_FUNDS.includes(digits))) {
      code = digits;
      mkt = 'cn';
      normalizedItems.push({ raw, market: 'otc', code, isOtc: true });
    } else {
      normalizedItems.push({ raw, market: mkt === 'us' ? 'us' : 'cn', code, isOtc: false });
    }
  }

  // OTC list READ path: prefer D1 full rows (no D1 writes here — cron/admin only).
  const otcItems = normalizedItems.filter((item) => item.isOtc);
  let d1Quotes = null;
  if (otcItems.length && hasOtcD1(env)) {
    try {
      d1Quotes = await loadOtcQuotesFromD1(env.DB, otcItems.map((i) => i.code));
    } catch {
      d1Quotes = null;
    }
  }

  const cacheItems = normalizedItems.map((item) => ({
    market: item.isOtc ? 'otc' : item.market,
    code: item.code,
  }));
  const fresh = await readFreshQuoteCacheMap(env, cacheItems);

  const cnMiss = [];
  const otcMiss = [];
  const usMiss = [];

  for (const item of normalizedItems) {
    if (item.isOtc && d1Quotes) {
      const d1q = d1Quotes[item.code] || d1Quotes[item.raw];
      if (d1q && (d1q.latestNav != null || d1q.name)) {
        out[item.raw] = await attachHistoricalPercentile(env, d1q, 'cn');
        continue;
      }
    }
    const cached = fresh['quote:' + item.code];
    if (cached && (cached.price || cached.currentPrice || cached.close || cached.latestNav)) {
      let q = cached;
      if (!item.isOtc) {
        q = await attachMarketQuoteHighPoint(env, cached, { market: item.market, symbol: item.code });
      }
      if (item.isOtc || hasMarketQuoteHighPoint(q, item.market) || pickPrice(q) != null) {
        out[item.raw] = await attachHistoricalPercentile(env, q, item.isOtc ? 'cn' : item.market);
        continue;
      }
    }
    // Stale / missing OTC from dedicated cache
    if (item.isOtc && env.MARKETS_KV) {
      const otcCached = await getOtcFundFromCache(item.code, env.MARKETS_KV);
      if (otcCached && isUsableQuoteCache(otcCached, 'otc', { allowStale: true })) {
        out[item.raw] = await attachHistoricalPercentile(env, otcCached, 'cn');
        continue;
      }
    }
    if (item.isOtc) otcMiss.push(item);
    else if (item.market === 'cn') cnMiss.push(item);
    else usMiss.push(item);
  }

  // Live fill only when policy allows; list sort prefers cache.
  if (!(isKvCacheEnabled(env) && !shouldFetchLiveOnMiss(env))) {
    if (cnMiss.length) {
      await fillCnBatchQuotes(env, cnMiss.map((i) => ({ raw: i.raw, code: i.code })), out, {
        hydrateHighPoints: false,
      });
      await mapLimit(Object.entries(out), 8, async ([raw, quote]) => {
        const matched = cnMiss.find((i) => i.raw === raw);
        if (!matched || !quote || quote.error) return;
        if (quote.cache?.source === 'kv' || quote.cache?.write === false) return;
        await writeQuoteCache(env, matched.code, quote, { ttlSeconds: quoteCacheTtlSeconds('cn') });
      });
    }
    // OTC / US miss: leave empty sort values rather than hammering third parties in list-rows.
    // Callers can still use /quotes for explicit refresh.
  }

  // Mark misses so rows still appear (null sort keys)
  for (const item of [...otcMiss, ...usMiss, ...cnMiss]) {
    if (!out[item.raw]) {
      out[item.raw] = { symbol: item.raw, code: item.code, error: 'quote_unavailable' };
    }
  }

  return out;
}

export async function matchListRowsRequest(request, env, path, url) {
  if (path !== '/list-rows') return null;
  if (request.method !== 'POST' && request.method !== 'GET') {
    return errorJson('method not allowed', 405);
  }
  const body = request.method === 'POST'
    ? await request.json().catch(() => ({}))
    : {
        symbols: String(url.searchParams.get('symbols') || '').split(',').map((s) => s.trim()).filter(Boolean),
        market: url.searchParams.get('market') || 'cn',
        isOtcList: url.searchParams.get('isOtcList') === '1',
        orderBy: url.searchParams.get('orderBy') || undefined,
        limit: url.searchParams.get('limit') || undefined,
        cursor: url.searchParams.get('cursor') || undefined,
        offset: url.searchParams.get('offset') || undefined,
      };
  if (typeof body.orderBy === 'string') {
    body.orderBy = parseOrderByParam(body.orderBy);
  }
  return handleListRows(env, body);
}

export async function handleListRows(env, body = {}) {
  const symbols = normalizeSymbolList(body.symbols);
  if (!symbols.length) {
    return json({
      items: [],
      total: 0,
      nextCursor: null,
      hasMore: false,
      applied: normalizeListQuery(body),
    });
  }
  if (symbols.length > MAX_SYMBOLS) {
    return errorJson(`symbols too many (max ${MAX_SYMBOLS})`, 400);
  }

  const market = String(body.market || 'cn').toLowerCase() === 'us' ? 'us' : 'cn';
  const isOtcList = Boolean(body.isOtcList);
  const heldSet = heldSetFrom(body.heldSymbols);
  const limitByCode = body.limitByCode && typeof body.limitByCode === 'object' ? body.limitByCode : null;

  const query = normalizeListQuery({
    orderBy: body.orderBy,
    limit: body.limit,
    cursor: body.cursor,
    offset: body.offset,
    filters: body.filters,
  });
  if (query.limit > LIST_QUERY_MAX_LIMIT) {
    return errorJson(`limit max ${LIST_QUERY_MAX_LIMIT}`, 400);
  }

  const quotes = await loadQuotesForListRows(env, symbols, { market, isOtcList });
  const rows = symbols.map((symbol) => buildListRowFromQuote({
    symbol,
    quote: quotes[symbol],
    market,
    isOtcList,
    heldSet,
    limitByCode,
  }));

  const page = queryListRows(rows, query);

  return json({
    items: page.items,
    total: page.total,
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
    applied: {
      ...page.applied,
      orderBySerialized: serializeOrderBy(page.applied.orderBy),
      market,
      isOtcList,
      symbolCount: symbols.length,
    },
  });
}

export default handleListRows;

export { matchD1ProbeRequest, matchMysqlProbeRequest } from './d1Probe.js';
