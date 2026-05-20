// ai-dca-markets Worker 主入口。路由统一在 /api/markets/* 下。

import {
  fetchYahooChart,
  normalizeYahooQuote,
  normalizeYahooKline,
  fetchYahooQuotesBatch,
  fetchEastmoneyKline,
  fetchEastmoneyQuote,
  fetchEastmoneyQuotesBatch,
  fetchEastmoneyMovers,
  searchYahooSymbols,
  searchEastmoneySymbols,
  fetchFinnhubQuote,
  fetchFinnhubProfile,
  fetchFinnhubCompanyNews,
  fetchFinnhubMarketNews,
  fetchFinnhubEarningsCalendar,
  fetchTavilyNews,
  fetchCnnFearGreed,
  hostToSourceName
} from './fetchers.js';
import { askWithGrounding, summarizeMarkets } from './ai.js';
import { kvGetJson, kvPutJson, r2GetJson, r2PutJson, klineKey } from './storage.js';
import {
  US_INDICES,
  CN_INDICES,
  US_TOP_TICKERS,
  CN_TOP_TICKERS,
  US_SECTORS,
  classifySymbol
} from './symbols.js';
import { tagIndices } from './data/index-constituents.js';

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization',
  'access-control-max-age': '86400'
};

// 轻量级并发限流：同时跑 worker(items[i]) 不超过 limit 个。
async function mapLimit(items, limit, worker) {
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
const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  ...CORS_HEADERS
};

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload, null, 2), { status, headers: JSON_HEADERS });
}
function errorJson(message, status = 500, extra = {}) {
  return json({ error: String(message || 'internal error'), ...extra }, status);
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/markets/, '');
    try {
      if (path === '/health' || path === '') {
        return json({
          ok: true,
          name: 'ai-dca-markets',
          time: new Date().toISOString(),
          hasKv: !!env.MARKETS_KV,
          hasR2: !!env.MARKETS_R2,
          hasAi: !!env.AI,
          hasFinnhubToken: !!env.FINNHUB_TOKEN,
          hasTavilyKey: !!env.TAVILY_API_KEY
        });
      }
      if (path === '/indices') {
        const market = (url.searchParams.get('market') || 'us').toLowerCase();
        return await handleIndices(env, market, url.searchParams.get('refresh') === '1');
      }
      if (path === '/sectors') {
        const market = (url.searchParams.get('market') || 'us').toLowerCase();
        return await handleSectors(env, market, url.searchParams.get('refresh') === '1');
      }
      if (path === '/quotes') {
        return await handleBatchQuotes(env, url.searchParams.get('symbols') || '');
      }
      if (path === '/search') {
        const market = (url.searchParams.get('market') || 'us').toLowerCase();
        return await handleSearch(env, market, url.searchParams.get('q') || '', url.searchParams.get('limit') || '8');
      }
      let m;
      if ((m = path.match(/^\/quote\/(.+)$/))) {
        return await handleQuote(env, decodeURIComponent(m[1]));
      }
      if ((m = path.match(/^\/kline\/(.+)$/))) {
        return await handleKline(env, decodeURIComponent(m[1]), url.searchParams);
      }
      if (path === '/movers') {
        const market = (url.searchParams.get('market') || 'us').toLowerCase();
        const dirParam = url.searchParams.get('direction') || 'mixed';
        const direction = dirParam === 'gainers' ? 'gainers' : dirParam === 'losers' ? 'losers' : 'mixed';
        return await handleMovers(env, market, direction, url.searchParams.get('refresh') === '1');
      }
      if (path === '/news') {
        const market = (url.searchParams.get('market') || 'us').toLowerCase();
        return await handleNews(env, market, url.searchParams.get('refresh') === '1');
      }
      if (path === '/earnings') {
        const market = (url.searchParams.get('market') || 'us').toLowerCase();
        return await handleEarnings(env, market, url.searchParams.get('refresh') === '1');
      }
      if (path === '/summary') {
        const market = (url.searchParams.get('market') || 'us').toLowerCase();
        return await handleSummary(env, market, url.searchParams.get('refresh') === '1');
      }
      if ((m = path.match(/^\/profile\/(.+)$/))) {
        return await handleProfile(env, decodeURIComponent(m[1]));
      }
      if (path === '/ask' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        return await handleAsk(env, body);
      }
      if (path === '/ask/stream' && request.method === 'POST') {
        return await handleAskStream(env, request);
      }
      if (path === '/refresh' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        return await handleManualRefresh(env, body, ctx);
      }
      return errorJson('not found', 404, { path });
    } catch (err) {
      console.error('markets worker error', err);
      return errorJson((err && err.message) || err);
    }
  },

  async scheduled(event, env, ctx) {
    const cron = event.cron;
    console.log('markets scheduled cron=' + cron + ' time=' + new Date(event.scheduledTime).toISOString());
    ctx.waitUntil(runScheduled(env, cron));
  }
};

// ===================== 路由处理 =====================

async function handleIndices(env, market, forceRefresh) {
  const key = 'idx:' + market;
  if (!forceRefresh) {
    const cached = await kvGetJson(env, key);
    if (cached && cached.indexes && cached.indexes.length) {
      return json({ ...cached, cached: true });
    }
  }
  const fresh = await refreshIndices(env, market);
  return json({ ...fresh, cached: false });
}

async function refreshIndices(env, market) {
  let indexes = [];
  if (market === 'us') {
    const symbols = US_INDICES.map((it) => it.symbol);
    // range/interval 必须用 1d/5m，Yahoo Chart 的 chartPreviousClose 才是
    // 真正的「昨日收盘」；range=5d 下取到的是 ~5 个交易日前的收盘，
    // 算出来会变成一周累计涨幅，和 /quotes 里 VOO/QQQ 对不上。
    const quoteMap = await fetchYahooQuotesBatch(symbols, { range: '1d', interval: '5m' });
    indexes = US_INDICES.map((it) => {
      const q = quoteMap[it.symbol] || {};
      return { ...q, key: it.key, name: it.name, symbol: it.symbol };
    });
    // 追加 CNN Fear & Greed（失败则静默跳过，不让主要指数卡片整块崩掉）。
    try {
      const fng = await fetchCnnFearGreed();
      if (fng) indexes.push({ ...fng, key: 'cnn_fng' });
    } catch (err) {
      console.warn('cnn fng fetch failed', (err && err.message) || err);
    }
  } else if (market === 'cn') {
    const quoteMap = await fetchEastmoneyQuotesBatch(CN_INDICES.map((it) => it.symbol));
    indexes = CN_INDICES.map((it) => {
      const q = quoteMap[it.symbol] || {};
      return { ...q, key: it.key, name: it.name, symbol: it.symbol };
    });
  } else {
    throw new Error('unknown market ' + market);
  }
  const payload = { market, generatedAt: new Date().toISOString(), indexes };
  await kvPutJson(env, 'idx:' + market, payload, { ttlSeconds: 120 });
  return payload;
}

async function handleSectors(env, market, forceRefresh) {
  if (market !== 'us') {
    return json({ market, generatedAt: new Date().toISOString(), sectors: [], cached: false });
  }
  const key = 'sec:' + market;
  if (!forceRefresh) {
    const cached = await kvGetJson(env, key);
    if (cached && Array.isArray(cached.sectors) && cached.sectors.length) {
      return json({ ...cached, cached: true });
    }
  }
  const fresh = await refreshSectors(env, market);
  return json({ ...fresh, cached: false });
}

async function refreshSectors(env, market) {
  // 目前只实现美股 S&P 11 行业指数（Google Finance "Equity sectors"）。
  // 后续可以加 CN 中信一级行业。
  const symbols = US_SECTORS.map((it) => it.symbol);
  const quoteMap = await fetchYahooQuotesBatch(symbols, { range: '1d', interval: '5m' });
  const sectors = US_SECTORS.map((it) => {
    const q = quoteMap[it.symbol] || {};
    return {
      ...q,
      key: it.key,
      name: it.name,
      symbol: it.symbol,
      shortCode: it.shortCode
    };
  });
  const payload = { market, generatedAt: new Date().toISOString(), sectors };
  await kvPutJson(env, 'sec:' + market, payload, { ttlSeconds: 120 });
  return payload;
}

async function handleSearch(env, market, query, limitParam) {
  const q = String(query || '').trim();
  const limit = Math.max(1, Math.min(Number(limitParam) || 8, 12));
  if (!q) return json({ market, query: q, results: [] });
  if (market !== 'us' && market !== 'cn') return errorJson('unknown market ' + market, 400);
  const cacheKey = 'search:' + market + ':' + q.toLowerCase() + ':' + limit;
  const cached = await kvGetJson(env, cacheKey);
  if (cached && Array.isArray(cached.results)) return json({ ...cached, cached: true });
  const results = market === 'cn'
    ? await searchEastmoneySymbols(q, { limit })
    : await searchYahooSymbols(q, { limit });
  const payload = { market, query: q, generatedAt: new Date().toISOString(), results };
  await kvPutJson(env, cacheKey, payload, { ttlSeconds: 3600 });
  return json({ ...payload, cached: false });
}

async function handleQuote(env, rawSymbol) {
  const { market, code } = classifySymbol(rawSymbol);
  if (!market) return errorJson('invalid symbol', 400);
  const cacheKey = 'quote:' + code;
  const cached = await kvGetJson(env, cacheKey);
  if (cached && cached.asOf && Date.now() - new Date(cached.asOf).getTime() < 90000) {
    return json({ ...cached, cached: true });
  }
  let quote;
  if (market === 'us') {
    const raw = await fetchYahooChart(code, { range: '1d', interval: '5m' });
    quote = normalizeYahooQuote(raw);
  } else {
    quote = await fetchEastmoneyQuote(code);
  }
  await kvPutJson(env, cacheKey, quote, { ttlSeconds: 300 });
  return json({ ...quote, cached: false });
}

async function handleBatchQuotes(env, symbolsParam) {
  const list = String(symbolsParam || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!list.length) return json({ quotes: {} });
  // 以前是无限并发 Promise.all；symbols 可能有几十个。上限 60、并发 5。
  if (list.length > 60) {
    return errorJson('symbols too many (max 60)', 400);
  }
  const out = {};
  await mapLimit(list, 5, async (raw) => {
    try {
      const { market, code } = classifySymbol(raw);
      if (!market) return;
      if (market === 'us') {
        const r = await fetchYahooChart(code, { range: '1d', interval: '5m' });
        out[raw] = normalizeYahooQuote(r);
      } else {
        out[raw] = await fetchEastmoneyQuote(code);
      }
    } catch (err) {
      out[raw] = { symbol: raw, error: String((err && err.message) || err) };
    }
  });
  return json({ quotes: out, generatedAt: new Date().toISOString() });
}

async function handleKline(env, rawSymbol, params) {
  const tf = String(params.get('tf') || '1d');
  const { market, code } = classifySymbol(rawSymbol);
  if (!market) return errorJson('invalid symbol', 400);
  const r2k = klineKey(market, code, tf);
  const forceRefresh = params.get('refresh') === '1';
  if (!forceRefresh) {
    const cached = await r2GetJson(env, r2k);
    if (cached && cached.candles && cached.candles.length) {
      const lastT = cached.candles[cached.candles.length - 1].t * 1000;
      const stale = tf === '1d' && Date.now() - lastT > 36 * 3600 * 1000;
      if (!stale) return json({ ...cached, cached: true });
    }
  }
  const fresh = await refreshKline(env, market, code, tf);
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
    payload = { ...(await fetchEastmoneyKline(code, { intervalLabel: tf, limit: 500 })), market, generatedAt: new Date().toISOString() };
  }
  await r2PutJson(env, klineKey(market, code, tf), payload);
  return payload;
}

async function handleMovers(env, market, direction, forceRefresh) {
  const key = 'movers:' + market + ':' + direction;
  if (!forceRefresh) {
    const cached = await kvGetJson(env, key);
    if (cached && cached.list) return json({ ...cached, cached: true });
  }
  let list = [];
  if (market === 'cn') {
    if (direction === 'mixed') {
      // 混合榜：拉一份涨幅 + 一份跌幅，按 |涨跌幅| desc 合并去重取 top30。
      const [gainers, losers] = await Promise.all([
        fetchEastmoneyMovers({ direction: 'gainers', limit: 20 }),
        fetchEastmoneyMovers({ direction: 'losers', limit: 20 })
      ]);
      const seen = new Set();
      const merged = [];
      for (const r of [...(gainers || []), ...(losers || [])]) {
        if (!r || !r.symbol || seen.has(r.symbol)) continue;
        seen.add(r.symbol);
        merged.push(r);
      }
      merged.sort((a, b) => Math.abs(Number(b.changePercent) || 0) - Math.abs(Number(a.changePercent) || 0));
      list = merged.slice(0, 30);
    } else {
      list = await fetchEastmoneyMovers({ direction, limit: 30 });
    }
  } else if (market === 'us') {
    // 从热门池中拉 quotes 后按涨跌幅排序。
    const quoteMap = await fetchYahooQuotesBatch(US_TOP_TICKERS, { range: '1d', interval: '5m' });
    const arr = Object.values(quoteMap).filter((q) => q && q.changePercent != null && !q.error);
    if (direction === 'mixed') {
      arr.sort((a, b) => Math.abs(Number(b.changePercent) || 0) - Math.abs(Number(a.changePercent) || 0));
    } else {
      arr.sort((a, b) => (direction === 'losers' ? a.changePercent - b.changePercent : b.changePercent - a.changePercent));
    }
    const limit = direction === 'mixed' ? 30 : 20;
    list = arr.slice(0, limit).map((q) => ({
      symbol: q.symbol,
      code: q.symbol,
      name: q.name,
      price: q.price,
      changePercent: q.changePercent,
      change: q.change
    }));
    list = await enrichWithProfiles(env, list);
  } else {
    return errorJson('unknown market ' + market, 400);
  }
  const payload = { market, direction, generatedAt: new Date().toISOString(), list };
  await kvPutJson(env, key, payload, { ttlSeconds: 1800 });
  return json({ ...payload, cached: false });
}

async function enrichWithProfiles(env, list) {
  if (!env.FINNHUB_TOKEN || !Array.isArray(list) || !list.length) return list;
  // Finnhub profile 单 symbol 一调、且可能冷缓存；list 常见 30 个。限并发 5。
  const out = await mapLimit(list, 5, async (row) => {
    const sym = row && row.symbol;
    if (!sym) return row;
    const cacheKey = 'profile:us:' + sym;
    try {
      let prof = await kvGetJson(env, cacheKey);
      if (!prof) {
        prof = await fetchFinnhubProfile(sym, { token: env.FINNHUB_TOKEN });
        if (prof && typeof prof === 'object') {
          await kvPutJson(env, cacheKey, prof, { ttlSeconds: 7 * 24 * 3600 });
        }
      }
      const industry = (prof && (prof.finnhubIndustry || prof.gicsSector || prof.industry)) || '';
      return industry ? { ...row, industry } : row;
    } catch (err) {
      return row;
    }
  });
  return out;
}

async function handleNews(env, market, forceRefresh) {
  const key = 'news:' + market;
  if (!forceRefresh) {
    const cached = await kvGetJson(env, key);
    if (cached && cached.items) return json({ ...cached, cached: true });
  }
  let items = [];
  const sourceErrors = {};
  if (market === 'us') {
    if (!env.FINNHUB_TOKEN) return errorJson('FINNHUB_TOKEN not configured', 500);
    // 多源聚合：Finnhub general wire + Tavily news 多查询。Tavily 补上 Bloomberg/WSJ/Politico/Axios 等多元体。
    const tasks = [
      fetchFinnhubMarketNews({ token: env.FINNHUB_TOKEN, category: 'general' })
        .then((raw) => ({ type: 'finnhub', raw: Array.isArray(raw) ? raw : [] }))
        .catch((e) => { sourceErrors.finnhub = String(e.message || e); return { type: 'finnhub', raw: [] }; })
    ];
    if (env.TAVILY_API_KEY) {
      const queries = [
        'US stock market today S&P 500 Nasdaq Dow Jones',
        'Federal Reserve interest rate decision',
        'big tech earnings AI chip stocks',
        'US economic policy treasury yields',
        'major corporate earnings Wall Street',
        'Federal Reserve chair governor nomination Senate confirmation',
        'White House Congress tariff fiscal policy Wall Street reaction'
      ];
      for (const q of queries) {
        tasks.push(
          fetchTavilyNews({ key: env.TAVILY_API_KEY, query: q, maxResults: 6, days: 2 })
            .then((raw) => ({ type: 'tavily', raw }))
            .catch((e) => { sourceErrors.tavily = String(e.message || e); return { type: 'tavily', raw: [] }; })
        );
      }
    }
    const settled = await Promise.all(tasks);
    const merged = [];
    for (const r of settled) {
      if (r.type === 'finnhub') {
        for (const it of r.raw) {
          merged.push({
            title: it.headline || '',
            url: it.url || '',
            source: it.source || hostToSourceName(it.url || ''),
            publishedAt: it.datetime ? new Date(it.datetime * 1000).toISOString() : '',
            summary: it.summary || '',
            image: it.image || ''
          });
        }
      } else if (r.type === 'tavily') {
        for (const it of r.raw) {
          merged.push({
            title: it.title || '',
            url: it.url || '',
            source: hostToSourceName(it.url || ''),
            publishedAt: it.published_date || '',
            summary: String(it.content || '').replace(/\s+/g, ' ').trim().slice(0, 400),
            image: ''
          });
        }
      }
    }
    // 去重：优先按 URL，同 URL 取首现。
    const seen = new Set();
    const deduped = [];
    for (const it of merged) {
      const k = (it.url || it.title || '').trim().toLowerCase();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      deduped.push(it);
    }
    // 按发布时间倒序，缺时间的放后。
    deduped.sort((a, b) => {
      const ta = a.publishedAt ? Date.parse(a.publishedAt) : 0;
      const tb = b.publishedAt ? Date.parse(b.publishedAt) : 0;
      return tb - ta;
    });
    // 每个来源最多保留 5 条，防止 Reuters/CNBC 等 wire 压满版面；
    // 超出部分放到 overflow中，仅在主列表没装满 30 条时才以补充。
    const PER_SOURCE_CAP = 5;
    const TOTAL_CAP = 30;
    const perSourceCount = new Map();
    const primary = [];
    const overflow = [];
    for (const it of deduped) {
      const src = (it.source || 'unknown').toLowerCase();
      const n = perSourceCount.get(src) || 0;
      if (n < PER_SOURCE_CAP) {
        perSourceCount.set(src, n + 1);
        primary.push(it);
      } else {
        overflow.push(it);
      }
    }
    items = primary.slice(0, TOTAL_CAP);
    if (items.length < TOTAL_CAP) {
      items = items.concat(overflow.slice(0, TOTAL_CAP - items.length));
    }
  } else {
    // A 股新闻：Phase 1 暂用空列表，后续接东财 / 雪球。
    items = [];
  }
  const payload = {
    market,
    generatedAt: new Date().toISOString(),
    items,
    sourceErrors: Object.keys(sourceErrors).length ? sourceErrors : undefined
  };
  await kvPutJson(env, key, payload, { ttlSeconds: 1800 });
  return json({ ...payload, cached: false });
}

async function handleProfile(env, rawSymbol) {
  // placeholder marker; real impl below
  return await _handleProfileImpl(env, rawSymbol);
}

// 即将发布的财报日历（仅美股 Finnhub）。默认 [today, today+14d]。
async function handleEarnings(env, market, forceRefresh) {
  if (market !== 'us') {
    return json({ market, items: [], generatedAt: new Date().toISOString() });
  }
  if (!env.FINNHUB_TOKEN) return errorJson('FINNHUB_TOKEN not configured', 500);
  const key = 'earnings:' + market;
  if (!forceRefresh) {
    const cached = await kvGetJson(env, key);
    if (cached && Array.isArray(cached.items)) return json({ ...cached, cached: true });
  }
  let items = [];
  try {
    const raw = await fetchFinnhubEarningsCalendar({ token: env.FINNHUB_TOKEN });
    const list = (raw && Array.isArray(raw.earningsCalendar)) ? raw.earningsCalendar : [];
    items = list.map((it) => ({
      symbol: it.symbol || '',
      name: it.symbol || '',
      date: it.date || '',
      hour: it.hour || '',
      year: it.year || null,
      quarter: it.quarter || null,
      epsActual: typeof it.epsActual === 'number' ? it.epsActual : null,
      epsEstimate: typeof it.epsEstimate === 'number' ? it.epsEstimate : null,
      revenueActual: typeof it.revenueActual === 'number' ? it.revenueActual : null,
      revenueEstimate: typeof it.revenueEstimate === 'number' ? it.revenueEstimate : null,
      indices: tagIndices(it.symbol || ''),
    }));
    // 优先以估算收入降序（大企业优先），同时在同一天内准备。后续可以接 profile 丰富中文名。
    items.sort((a, b) => {
      const da = a.date || '9999-12-31';
      const db = b.date || '9999-12-31';
      if (da !== db) return da < db ? -1 : 1;
      const ra = Number.isFinite(a.revenueEstimate) ? a.revenueEstimate : -1;
      const rb = Number.isFinite(b.revenueEstimate) ? b.revenueEstimate : -1;
      return rb - ra;
    });
    // 只留第一页给前端（防止 KV 过胖）
    items = items.slice(0, 60);
  } catch (err) {
    return errorJson('finnhub earnings calendar failed: ' + String((err && err.message) || err), 502);
  }
  const payload = { market, generatedAt: new Date().toISOString(), items };
  await kvPutJson(env, key, payload, { ttlSeconds: 1800 });
  return json({ ...payload, cached: false });
}

async function _handleProfileImpl(env, rawSymbol) {
  const { market, code } = classifySymbol(rawSymbol);
  if (!market) return errorJson('invalid symbol', 400);
  if (market !== 'us') return errorJson('profile only supports US for now', 400);
  if (!env.FINNHUB_TOKEN) return errorJson('FINNHUB_TOKEN not configured', 500);
  const profile = await fetchFinnhubProfile(code, { token: env.FINNHUB_TOKEN });
  return json({ symbol: code, profile });
}

async function handleAsk(env, body) {
  const question = String((body && body.question) || '').trim();
  if (!question) return errorJson('missing question', 400);
  const depth = body && body.depth === 'deep' ? 'deep' : 'fast';
  const extraContext = typeof (body && body.context) === 'string' ? body.context.slice(0, 4000) : '';
  const wantSymbols = Array.isArray(body && body.symbols) ? body.symbols.slice(0, 8) : [];
  // 附带行情快照。
  const quoteSnapshots = [];
  for (const raw of wantSymbols) {
    try {
      const { market, code } = classifySymbol(raw);
      if (!market) continue;
      const q = market === 'us'
        ? normalizeYahooQuote(await fetchYahooChart(code, { range: '1d', interval: '5m' }))
        : await fetchEastmoneyQuote(code);
      quoteSnapshots.push(q);
    } catch (err) {
      console.warn('snapshot fail', raw, err);
    }
  }
  const result = await askWithGrounding({ env, question, quoteSnapshots, depth, extraContext });
  return json(result);
}

// =====================================================================
// /ask/stream：深度问答 SSE 透传。
// 请求体 = /ask 的请求体。响应为 text/event-stream，事件类型由
// MoltWorker 容器定义：started / progress / tool_start / tool_end / source /
// token / reasoning / done / error。
// 此路由仅依赖 [[services]] AGENT 绑定 + INTERNAL_TOKEN secret，与
// DEEP_BACKEND var 无关。同步 /ask 的后端选择仍由 DEEP_BACKEND 控制。
// =====================================================================
async function handleAskStream(env, request) {
  if (!env.AGENT) {
    return errorJson('AGENT service binding missing; deploy with [[services]] AGENT', 500);
  }
  if (!env.INTERNAL_TOKEN) {
    return errorJson('INTERNAL_TOKEN secret missing on markets worker', 500);
  }
  const bodyText = await request.text();
  const upstream = await env.AGENT.fetch('http://agent/internal/ask/stream', {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + env.INTERNAL_TOKEN,
      'content-type': 'application/json',
      accept: 'text/event-stream'
    },
    body: bodyText,
    // M4: 客户端 abort 后这里 signal aborted，会传递到 markets-agent worker 、
    // 再到 container。container/server.js 已听 res.on('close', ctrl.abort()) 做上游中断。
    signal: request.signal
  });
  if (!upstream.body) {
    return errorJson('agent upstream returned empty body', 502, { status: upstream.status });
  }
  // 直接透传上游 SSEて到浏览器。保留心跳 + token 增量。
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
      ...CORS_HEADERS
    }
  });
}

async function handleManualRefresh(env, body, ctx) {
  const target = String((body && body.target) || '').toLowerCase();
  if (target === 'us-indices') {
    return json(await refreshIndices(env, 'us'));
  }
  if (target === 'cn-indices') {
    return json(await refreshIndices(env, 'cn'));
  }
  if (target === 'us-movers') {
    return await handleMovers(env, 'us', 'mixed', true);
  }
  if (target === 'cn-movers') {
    return await handleMovers(env, 'cn', 'mixed', true);
  }
  if (target === 'us-news') {
    return await handleNews(env, 'us', true);
  }
  if (target === 'us-summary') {
    return await handleSummary(env, 'us', true);
  }
  return errorJson('unknown target ' + target, 400);
}

// ===================== Scheduled =====================

async function runScheduled(env, cron) {
  // 简化策略：任意 cron 都会跳过试图梳理交易时段，直接按词典驱动“哪些需要创新”。
  // 01-06 UTC MON-FRI 是 A 股盘中，13-20 UTC 是美股盘中。别的 cron 是收盘后。
  const tasks = [];
  const hourUtc = new Date().getUTCHours();
  if (hourUtc >= 1 && hourUtc <= 7) {
    tasks.push(refreshIndices(env, 'cn'));
    tasks.push(handleMovers(env, 'cn', 'mixed', true));
  }
  if (hourUtc >= 13 && hourUtc <= 20) {
    tasks.push(refreshIndices(env, 'us'));
    tasks.push(handleMovers(env, 'us', 'mixed', true));
  }
  if (cron === '30 22 * * *' || cron === '0 7 * * MON-FRI') {
    // 美股收盘后跨天 + A 股盘中际调度。
    tasks.push(refreshIndices(env, 'us'));
    tasks.push(handleNews(env, 'us', true));
  }
  // 每 30 分钟跑一次美股主题摘要（由专门的 cron 触发）。
  if (cron === '*/30 * * * *') {
    tasks.push(handleSummary(env, 'us', true));
  }
  const results = await Promise.allSettled(tasks);
  for (const r of results) {
    if (r.status === 'rejected') {
      console.warn('scheduled task failed', r.reason);
    }
  }
}

// =====================================================================
// /summary：读今日新闻 + 涨跌榜，交 AI 归纳为 4 个主题。
// KV 键 summary:<market>，TTL 2 小时。
// =====================================================================

async function handleSummary(env, market, forceRefresh) {
  const key = 'summary:' + market;
  if (!forceRefresh) {
    const cached = await kvGetJson(env, key);
    if (cached && Array.isArray(cached.themes)) return json({ ...cached, cached: true });
  }
  // 读取上游数据：新闻（含读表）+ 混合榜。
  let news = [];
  let movers = [];
  try {
    const newsCached = await kvGetJson(env, 'news:' + market);
    if (newsCached && Array.isArray(newsCached.items)) news = newsCached.items;
  } catch (_) {}
  try {
    const moversCached = await kvGetJson(env, 'movers:' + market + ':mixed');
    if (moversCached && Array.isArray(moversCached.list)) movers = moversCached.list;
  } catch (_) {}
  // 最低限度：新闻或涨跌榜之一需要有内容，否则不用调 AI。
  if (!news.length && !movers.length) {
    return errorJson('no upstream data (news/movers KV empty)', 503, { market });
  }
  const ai = await summarizeMarkets({ env, market, news, movers });
  const payload = {
    market,
    generatedAt: new Date().toISOString(),
    themes: ai.themes,
    model: ai.model,
    aiError: ai.aiError || undefined,
    inputCounts: { news: news.length, movers: movers.length }
  };
  // 只有拿到主题才写 KV，否则避免覆盖上次好的结果。
  if (Array.isArray(ai.themes) && ai.themes.length) {
    await kvPutJson(env, key, payload, { ttlSeconds: 7200 });
  }
  return json({ ...payload, cached: false });
}
