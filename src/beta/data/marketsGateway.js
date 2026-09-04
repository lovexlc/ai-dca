// beta 行情网关：把小程序 tidbMarket 的 action 调用翻译成网页端 markets worker 请求。
//
// 约束与取舍：
//   - 浏览器里没有 wx.cloud，小程序那份 37KB 的 tidbMarketApi.js 不能照搬。
//   - 网页端的缓存与回源本来就由 markets worker 在服务端完成，
//     客户端只保留 etf_quotes 那一层 90s 新鲜度语义。
//   - 真实 client 动态引入 src/app/marketsApi.js，测试可注入替身，
//     因此单测不会触碰 fetch / localStorage 等浏览器全局。

import {
  actionFailure,
  actionSuccess,
  isQuoteFresh,
  normalizeAction,
  normalizeFundCode,
  normalizeFundCodes
} from './marketActions.js';

let defaultClientPromise = null;

export function getDefaultMarketsClient() {
  if (!defaultClientPromise) {
    defaultClientPromise = import('../../app/marketsApi.js');
  }
  return defaultClientPromise;
}

// 网页端暂未提供对应接口的 action：明确报 unsupported，不去猜端点。
const UNSUPPORTED_ACTIONS = {
  'home-series': 'home-series 需要 markets worker 补一个首页序列端点',
  'premium-history': 'premium-history 需要 markets worker 补溢价历史端点',
  'fund-limit-overview': 'fund-limit-overview 需要 markets worker 补限购概览端点'
};

function pickNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function pickCode(input) {
  return normalizeFundCode(input.code != null ? input.code : input.symbol);
}

export function createMarketsGateway({ client = null, now = () => Date.now() } = {}) {
  const quoteCache = { updateTime: 0, byCode: new Map() };

  async function resolveClient() {
    if (client) return client;
    return getDefaultMarketsClient();
  }

  function readCachedQuotes(codes) {
    const quotes = {};
    for (const code of codes) {
      const cached = quoteCache.byCode.get(code);
      if (cached) quotes[code] = cached;
    }
    return quotes;
  }

  function writeCachedQuotes(quotes, stamp) {
    for (const [code, quote] of Object.entries(quotes || {})) {
      const normalized = normalizeFundCode(code) || String(code || '').trim();
      if (normalized) quoteCache.byCode.set(normalized, quote);
    }
    quoteCache.updateTime = stamp;
  }

  async function handleFundQuote(activeClient, input) {
    const requested = input.codes != null ? input.codes
      : input.code != null ? input.code
        : input.symbols != null ? input.symbols
          : input.symbol;
    const codes = normalizeFundCodes(requested);
    if (!codes.length) return actionFailure('fund-quote 需要至少一个 6 位基金代码');
    const stamp = now();
    const fresh = isQuoteFresh(quoteCache.updateTime, stamp);
    const cached = fresh ? readCachedQuotes(codes) : {};
    const missing = codes.filter((code) => !cached[code]);
    if (fresh && !missing.length) {
      return actionSuccess({ action: 'fund-quote', quotes: cached, cacheHit: true, cacheFresh: true });
    }
    const payload = await activeClient.fetchQuotes(missing.length ? missing : codes);
    const fetched = (payload && payload.quotes) || {};
    writeCachedQuotes(fetched, stamp);
    return actionSuccess({
      action: 'fund-quote',
      quotes: { ...cached, ...fetched },
      cacheHit: Object.keys(cached).length > 0,
      cacheFresh: false
    });
  }

  async function callAction(action, params = {}) {
    const normalized = normalizeAction(action);
    if (!normalized) return actionFailure('未知 action: ' + String(action || ''));
    if (UNSUPPORTED_ACTIONS[normalized]) {
      return actionFailure(UNSUPPORTED_ACTIONS[normalized], { action: normalized, unsupported: true });
    }
    if (normalized === 'ping') return actionSuccess({ action: 'ping', pong: true });

    const input = params && typeof params === 'object' ? params : {};
    const activeClient = await resolveClient();

    if (normalized === 'fund-quote') return handleFundQuote(activeClient, input);

    if (normalized === 'fund-list') {
      const codes = normalizeFundCodes(input.codes != null ? input.codes : input.symbols);
      const payload = await activeClient.fetchExchangeFundList({
        symbols: codes,
        limit: pickNumber(input.limit, 100),
        offset: Number(input.offset) || 0,
        sortBy: input.sortBy || '',
        order: input.order || '',
        query: input.query || '',
        heldOnly: Boolean(input.heldOnly)
      });
      return actionSuccess({ ...(payload || {}), action: normalized });
    }

    if (normalized === 'fund-detail') {
      const code = pickCode(input);
      if (!code) return actionFailure('fund-detail 需要 6 位基金代码');
      const payload = await activeClient.fetchFundMetrics([code], { refresh: Boolean(input.refresh) });
      const items = (payload && payload.items) || [];
      return actionSuccess({ action: normalized, code, item: items[0] || null, items });
    }

    if (normalized === 'fund-history') {
      const code = pickCode(input);
      if (!code) return actionFailure('fund-history 需要 6 位基金代码');
      const payload = await activeClient.fetchKline(code, {
        timeframe: input.timeframe || '1d',
        limit: pickNumber(input.limit, 500)
      });
      return actionSuccess({ ...(payload || {}), action: normalized, code });
    }

    if (normalized === 'fund-intraday') {
      const code = pickCode(input);
      if (!code) return actionFailure('fund-intraday 需要 6 位基金代码');
      const options = { timeframe: input.timeframe || '1m', limit: pickNumber(input.limit, 300) };
      if (input.session) options.session = String(input.session);
      const payload = await activeClient.fetchKline(code, options);
      return actionSuccess({ ...(payload || {}), action: normalized, code });
    }

    if (normalized === 'home-overview') {
      const payload = await activeClient.fetchMarketSummary(input.region || 'CN', {
        refresh: Boolean(input.refresh)
      });
      return actionSuccess({ ...(payload || {}), action: normalized });
    }

    return actionFailure('action 未接线: ' + normalized, { action: normalized });
  }

  return {
    callAction,
    getQuoteCacheState() {
      return { updateTime: quoteCache.updateTime, codes: Array.from(quoteCache.byCode.keys()) };
    },
    clearQuoteCache() {
      quoteCache.updateTime = 0;
      quoteCache.byCode.clear();
    }
  };
}
