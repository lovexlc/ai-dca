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
  fetchFinnhubQuote,
  fetchFinnhubProfile,
  fetchFinnhubCompanyNews,
  fetchFinnhubMarketNews
} from './fetchers.js';
import { askWithGrounding } from './ai.js';
import { kvGetJson, kvPutJson, r2GetJson, r2PutJson, klineKey } from './storage.js';
import {
  US_INDICES,
  CN_INDICES,
  US_TOP_TICKERS,
  CN_TOP_TICKERS,
  classifySymbol
} from './symbols.js';

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization',
  'access-control-max-age': '86400'
};
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
      if (path === '/quotes') {
        return await handleBatchQuotes(env, url.searchParams.get('symbols') || '');
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
        const direction = url.searchParams.get('direction') === 'losers' ? 'losers' : 'gainers';
        return await handleMovers(env, market, direction, url.searchParams.get('refresh') === '1');
      }
      if (path === '/news') {
        const market = (url.searchParams.get('market') || 'us').toLowerCase();
        return await handleNews(env, market, url.searchParams.get('refresh') === '1');
      }
      if ((m = path.match(/^\/profile\/(.+)$/))) {
        return await handleProfile(env, decodeURIComponent(m[1]));
      }
      if (path === '/ask' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        return await handleAsk(env, body);
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
    const quoteMap = await fetchYahooQuotesBatch(symbols, { range: '5d', interval: '1d' });
    indexes = US_INDICES.map((it) => {
      const q = quoteMap[it.symbol] || {};
      return { ...q, key: it.key, name: it.name, symbol: it.symbol };
    });
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
  await kvPutJson(env, 'idx:' + market, payload, { ttlSeconds: 3600 });
  return payload;
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
  const out = {};
  await Promise.all(
    list.map(async (raw) => {
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
    })
  );
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
    list = await fetchEastmoneyMovers({ direction, limit: 30 });
  } else if (market === 'us') {
    // 从热门池中拉 quotes 后按涨跌幅排序。
    const quoteMap = await fetchYahooQuotesBatch(US_TOP_TICKERS, { range: '1d', interval: '5m' });
    const arr = Object.values(quoteMap).filter((q) => q && q.changePercent != null && !q.error);
    arr.sort((a, b) => (direction === 'losers' ? a.changePercent - b.changePercent : b.changePercent - a.changePercent));
    list = arr.slice(0, 20).map((q) => ({
      symbol: q.symbol,
      code: q.symbol,
      name: q.name,
      price: q.price,
      changePercent: q.changePercent,
      change: q.change
    }));
  } else {
    return errorJson('unknown market ' + market, 400);
  }
  const payload = { market, direction, generatedAt: new Date().toISOString(), list };
  await kvPutJson(env, key, payload, { ttlSeconds: 1800 });
  return json({ ...payload, cached: false });
}

async function handleNews(env, market, forceRefresh) {
  const key = 'news:' + market;
  if (!forceRefresh) {
    const cached = await kvGetJson(env, key);
    if (cached && cached.items) return json({ ...cached, cached: true });
  }
  let items = [];
  if (market === 'us') {
    if (!env.FINNHUB_TOKEN) return errorJson('FINNHUB_TOKEN not configured', 500);
    const raw = await fetchFinnhubMarketNews({ token: env.FINNHUB_TOKEN, category: 'general' });
    items = (raw || []).slice(0, 30).map((it) => ({
      title: it.headline || '',
      url: it.url || '',
      source: it.source || '',
      publishedAt: it.datetime ? new Date(it.datetime * 1000).toISOString() : '',
      summary: it.summary || '',
      image: it.image || ''
    }));
  } else {
    // A 股新闻：Phase 1 暂用空列表，后续接东财 / 雪球。
    items = [];
  }
  const payload = { market, generatedAt: new Date().toISOString(), items };
  await kvPutJson(env, key, payload, { ttlSeconds: 1800 });
  return json({ ...payload, cached: false });
}

async function handleProfile(env, rawSymbol) {
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
  const result = await askWithGrounding({ env, question, quoteSnapshots, depth });
  return json(result);
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
    return await handleMovers(env, 'us', 'gainers', true);
  }
  if (target === 'cn-movers') {
    return await handleMovers(env, 'cn', 'gainers', true);
  }
  if (target === 'us-news') {
    return await handleNews(env, 'us', true);
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
    tasks.push(handleMovers(env, 'cn', 'gainers', true));
  }
  if (hourUtc >= 13 && hourUtc <= 20) {
    tasks.push(refreshIndices(env, 'us'));
    tasks.push(handleMovers(env, 'us', 'gainers', true));
  }
  if (cron === '30 22 * * *' || cron === '0 7 * * MON-FRI') {
    // 美股收盘后跨天 + A 股盘中际调度。
    tasks.push(refreshIndices(env, 'us'));
    tasks.push(handleNews(env, 'us', true));
  }
  const results = await Promise.allSettled(tasks);
  for (const r of results) {
    if (r.status === 'rejected') {
      console.warn('scheduled task failed', r.reason);
    }
  }
}
