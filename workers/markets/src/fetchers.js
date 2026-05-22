// 行情数据源封装。所有 fetch 统一返回归一化 schema，失败报 throw。
//
// 所有外部 URL 都拆成 base + path，避免被上游平台误伤为可压缩引用。

import { toEastmoneySecId } from './symbols.js';

const UA = 'Mozilla/5.0 (compatible; ai-dca-markets/1.0)';
const COMMON_HEADERS = { 'user-agent': UA, accept: '*/*' };

const YAHOO_HOST = 'https://' + 'query1.finance.yahoo.com';
const YAHOO_SEARCH_HOST = 'https://' + 'query2.finance.yahoo.com';
const EM_PUSH2_HOST = 'https://' + 'push2.eastmoney.com';
const EM_PUSH2HIS_HOST = 'https://' + 'push2his.eastmoney.com';
const EM_SEARCH_HOST = 'https://' + 'searchapi.eastmoney.com';
const FINNHUB_HOST = 'https://' + 'finnhub.io';

// 轻量级并发限流。与index.js 里的版本语义一致，这里独立定义避免跨文件依赖。
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
const CNN_FNG_HOST = 'https://' + 'production.dataviz.cnn.io';

// CNN 接口认浏览器 UA 严格——不像 Chrome 就给 418。
const CNN_BROWSER_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  accept: 'application/json, text/plain, */*',
  'accept-language': 'en-US,en;q=0.9',
  origin: 'https://edition.cnn.com',
  referer: 'https://edition.cnn.com/'
};

function round(value, precision = 4) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const factor = 10 ** precision;
  return Math.round(n * factor) / factor;
}

function toIso(unixSeconds) {
  if (!Number.isFinite(unixSeconds) || unixSeconds <= 0) return '';
  return new Date(unixSeconds * 1000).toISOString();
}

function buildUrl(base, path, params = {}) {
  const u = new URL(path, base);
  for (const [k, v] of Object.entries(params)) {
    if (v == null) continue;
    u.searchParams.set(k, String(v));
  }
  return u.toString();
}

// ===================== Yahoo Finance Chart API（美股 quotes + K 线） =====================

export async function fetchYahooChart(symbol, { range = '1d', interval = '1m' } = {}) {
  const url = buildUrl(YAHOO_HOST, '/v8/finance/chart/' + encodeURIComponent(symbol), {
    range,
    interval,
    includePrePost: 'false'
  });
  const res = await fetch(url, { headers: COMMON_HEADERS, cf: { cacheTtl: 30 } });
  if (!res.ok) throw new Error('yahoo ' + symbol + ' HTTP ' + res.status);
  const data = await res.json();
  const result = data && data.chart && data.chart.result && data.chart.result[0];
  if (!result) {
    const err = data && data.chart && data.chart.error;
    throw new Error('yahoo ' + symbol + ' ' + ((err && err.code) || 'no-result'));
  }
  return result;
}

export function normalizeYahooQuote(raw, fallbackName = '') {
  const meta = (raw && raw.meta) || {};
  const price = round(meta.regularMarketPrice != null ? meta.regularMarketPrice : meta.previousClose, 4);
  const previousClose = round(meta.chartPreviousClose != null ? meta.chartPreviousClose : meta.previousClose, 4);
  const change = price !== null && previousClose !== null ? round(price - previousClose, 4) : null;
  const changePercent = previousClose ? round(((price - previousClose) / previousClose) * 100, 4) : null;
  return {
    symbol: meta.symbol || '',
    name: fallbackName || meta.shortName || meta.longName || meta.symbol || '',
    market: 'us',
    price,
    previousClose,
    change,
    changePercent,
    open: round(meta.regularMarketOpen, 4),
    high: round(meta.regularMarketDayHigh, 4),
    low: round(meta.regularMarketDayLow, 4),
    volume: Number(meta.regularMarketVolume) || null,
    currency: meta.currency || 'USD',
    exchangeTimezone: meta.exchangeTimezoneName || meta.timezone || 'America/New_York',
    marketState: meta.marketState || '',
    asOf: toIso(meta.regularMarketTime)
  };
}

export function normalizeYahooKline(raw, intervalLabel) {
  const ts = (raw && raw.timestamp) || [];
  const q = (raw && raw.indicators && raw.indicators.quote && raw.indicators.quote[0]) || {};
  const candles = [];
  for (let i = 0; i < ts.length; i += 1) {
    const c = q.close && q.close[i];
    if (c == null || !Number.isFinite(c)) continue;
    candles.push({
      t: ts[i],
      o: round(q.open && q.open[i], 4),
      h: round(q.high && q.high[i], 4),
      l: round(q.low && q.low[i], 4),
      c: round(c, 4),
      v: Number(q.volume && q.volume[i]) || 0
    });
  }
  return {
    symbol: (raw && raw.meta && raw.meta.symbol) || '',
    interval: intervalLabel,
    candles
  };
}

export async function fetchYahooQuotesBatch(symbols, opts = {}) {
  const out = {};
  // 上游 Yahoo chart 单 symbol 一调；symbols 可能是几十个。限并发 5。
  await mapLimit(symbols, 5, async (sym) => {
    try {
      const raw = await fetchYahooChart(sym, { range: '1d', interval: '5m', ...opts });
      out[sym] = normalizeYahooQuote(raw);
    } catch (err) {
      out[sym] = { symbol: sym, error: String((err && err.message) || err) };
    }
  });
  return out;
}


// Yahoo quoteSummary：三大财务报表（年度 + 季度）。只用于美股详情页的「财务」tab。
export async function fetchYahooFinancials(symbol) {
  const modules = [
    'incomeStatementHistory',
    'incomeStatementHistoryQuarterly',
    'balanceSheetHistory',
    'balanceSheetHistoryQuarterly',
    'cashflowStatementHistory',
    'cashflowStatementHistoryQuarterly'
  ].join(',');
  const url = buildUrl(YAHOO_HOST, '/v10/finance/quoteSummary/' + encodeURIComponent(symbol), { modules });
  const res = await fetch(url, { headers: COMMON_HEADERS, cf: { cacheTtl: 1800 } });
  if (!res.ok) throw new Error('yahoo financials ' + symbol + ' HTTP ' + res.status);
  const data = await res.json().catch(() => ({}));
  const result = data && data.quoteSummary && data.quoteSummary.result && data.quoteSummary.result[0];
  if (!result) {
    const err = data && data.quoteSummary && data.quoteSummary.error;
    throw new Error('yahoo financials ' + symbol + ' ' + ((err && err.code) || 'no-result'));
  }
  return normalizeYahooFinancials(result, symbol);
}

function unwrapFinancialValue(value) {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'object' && Number.isFinite(Number(value.raw))) return Number(value.raw);
  return null;
}

function normalizeStatementRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return list.map((row) => {
    const endRaw = unwrapFinancialValue(row && row.endDate);
    const fields = {};
    for (const [key, value] of Object.entries(row || {})) {
      if (key === 'maxAge' || key === 'endDate') continue;
      const n = unwrapFinancialValue(value);
      if (n != null) fields[key] = n;
    }
    return {
      period: endRaw ? new Date(endRaw * 1000).toISOString().slice(0, 10) : '',
      endDate: endRaw || null,
      fields
    };
  }).filter((row) => row.period && Object.keys(row.fields).length);
}

export function normalizeYahooFinancials(raw, symbol) {
  return {
    symbol,
    market: 'us',
    statements: {
      income: {
        annual: normalizeStatementRows(raw?.incomeStatementHistory?.incomeStatementHistory),
        quarterly: normalizeStatementRows(raw?.incomeStatementHistoryQuarterly?.incomeStatementHistory)
      },
      balance: {
        annual: normalizeStatementRows(raw?.balanceSheetHistory?.balanceSheetStatements),
        quarterly: normalizeStatementRows(raw?.balanceSheetHistoryQuarterly?.balanceSheetStatements)
      },
      cashflow: {
        annual: normalizeStatementRows(raw?.cashflowStatementHistory?.cashflowStatements),
        quarterly: normalizeStatementRows(raw?.cashflowStatementHistoryQuarterly?.cashflowStatements)
      }
    }
  };
}

export async function searchYahooSymbols(query, { limit = 8 } = {}) {
  const q = String(query || '').trim();
  if (!q) return [];
  const url = buildUrl(YAHOO_SEARCH_HOST, '/v1/finance/search', {
    q,
    quotesCount: Math.max(1, Math.min(Number(limit) || 8, 12)),
    newsCount: 0
  });
  const res = await fetch(url, { headers: COMMON_HEADERS, cf: { cacheTtl: 300 } });
  if (!res.ok) throw new Error('yahoo search HTTP ' + res.status);
  const data = await res.json().catch(() => ({}));
  const rows = Array.isArray(data && data.quotes) ? data.quotes : [];
  const allowed = new Set(['EQUITY', 'ETF', 'MUTUALFUND', 'INDEX']);
  return rows
    .filter((row) => row && row.symbol && (!row.quoteType || allowed.has(row.quoteType)))
    .slice(0, Math.max(1, Math.min(Number(limit) || 8, 12)))
    .map((row) => ({
      symbol: String(row.symbol || '').toUpperCase(),
      name: row.shortname || row.longname || row.symbol || '',
      market: 'us',
      exchange: row.exchDisp || row.exchange || '',
      type: row.quoteType || row.typeDisp || '',
      industry: row.industryDisp || row.industry || '',
      sector: row.sectorDisp || row.sector || ''
    }));
}

// ===================== 东方财富 push2his K 线（A 股 + 指数） =====================

// klt: 1=1m, 5=5m, 15=15m, 30=30m, 60=60m, 101=日, 102=周, 103=月
const EM_KLT_MAP = { '1m': 1, '5m': 5, '15m': 15, '30m': 30, '60m': 60, '1d': 101, '1w': 102, '1mo': 103 };

export async function fetchEastmoneyKline(code, { intervalLabel = '1d', limit = 250 } = {}) {
  const secid = toEastmoneySecId(code);
  if (!secid) throw new Error('eastmoney bad code ' + code);
  const klt = EM_KLT_MAP[intervalLabel] || 101;
  const url = buildUrl(EM_PUSH2HIS_HOST, '/api/qt/stock/kline/get', {
    secid,
    fields1: 'f1,f2,f3,f4,f5,f6',
    fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
    klt,
    fqt: 1,
    end: '20500101',
    lmt: limit,
    _: Date.now()
  });
  const res = await fetch(url, { headers: COMMON_HEADERS, cf: { cacheTtl: 30 } });
  if (!res.ok) throw new Error('eastmoney ' + code + ' HTTP ' + res.status);
  const data = await res.json();
  const klines = (data && data.data && data.data.klines) || [];
  const candles = klines.map((line) => {
    const parts = String(line).split(',');
    // 格式：date, open, close, high, low, volume, amount
    const t = Math.floor(new Date(parts[0] + 'T00:00:00+08:00').getTime() / 1000);
    return {
      t,
      o: round(parts[1], 4),
      h: round(parts[3], 4),
      l: round(parts[4], 4),
      c: round(parts[2], 4),
      v: Number(parts[5]) || 0
    };
  });
  return {
    symbol: code,
    interval: intervalLabel,
    name: (data && data.data && data.data.name) || '',
    candles
  };
}

export async function fetchEastmoneyQuote(code) {
  const secid = toEastmoneySecId(code);
  if (!secid) throw new Error('eastmoney bad code ' + code);
  const url = buildUrl(EM_PUSH2_HOST, '/api/qt/stock/get', {
    secid,
    fields: 'f43,f44,f45,f46,f47,f48,f57,f58,f60,f168,f169,f170,f86,f292,f1,f59',
    _: Date.now()
  });
  const res = await fetch(url, { headers: COMMON_HEADERS, cf: { cacheTtl: 30 } });
  if (!res.ok) throw new Error('eastmoney quote ' + code + ' HTTP ' + res.status);
  const data = await res.json();
  const d = data && data.data;
  if (!d) throw new Error('eastmoney quote ' + code + ' empty');
  // f1 精度（例如 2 = 小数点后 2 位），f59 同。
  const scale = Math.pow(10, d.f1 != null ? d.f1 : 2);
  const price = d.f43 != null ? round(d.f43 / scale, 4) : null;
  const previousClose = d.f60 != null ? round(d.f60 / scale, 4) : null;
  const change = price != null && previousClose != null ? round(price - previousClose, 4) : null;
  const changePercent = d.f170 != null ? round(d.f170 / 100, 4) : null;
  return {
    symbol: code,
    name: d.f58 || '',
    market: 'cn',
    price,
    previousClose,
    change,
    changePercent,
    open: d.f46 != null ? round(d.f46 / scale, 4) : null,
    high: d.f44 != null ? round(d.f44 / scale, 4) : null,
    low: d.f45 != null ? round(d.f45 / scale, 4) : null,
    volume: Number(d.f47) || null,
    turnover: Number(d.f48) || null,
    currency: 'CNY',
    exchangeTimezone: 'Asia/Shanghai',
    marketState: d.f292 === 1 ? 'REGULAR' : 'CLOSED',
    asOf: d.f86 ? new Date(d.f86 * 1000).toISOString() : new Date().toISOString()
  };
}

export async function fetchEastmoneyQuotesBatch(codes) {
  const out = {};
  // 东财 NAV 较便宜、上限 8 并发。
  await mapLimit(codes, 8, async (code) => {
    try {
      out[code] = await fetchEastmoneyQuote(code);
    } catch (err) {
      out[code] = { symbol: code, error: String((err && err.message) || err) };
    }
  });
  return out;
}

export async function searchEastmoneySymbols(query, { limit = 8 } = {}) {
  const q = String(query || '').trim();
  if (!q) return [];
  const url = buildUrl(EM_SEARCH_HOST, '/api/suggest/get', {
    input: q,
    type: 14,
    token: 'D43BF722C8E33BDC906FB84D85E326E8',
    count: Math.max(1, Math.min(Number(limit) || 8, 12))
  });
  const res = await fetch(url, {
    headers: { ...COMMON_HEADERS, referer: 'https://quote.eastmoney.com/' },
    cf: { cacheTtl: 300 }
  });
  if (!res.ok) throw new Error('eastmoney search HTTP ' + res.status);
  const data = await res.json().catch(() => ({}));
  const rows = (((data || {}).QuotationCodeTable || {}).Data) || [];
  const normalized = Array.isArray(rows) ? rows : [];
  return normalized
    .filter((row) => row && row.Code && (row.Classify === 'AStock' || row.SecurityType === '1' || row.SecurityTypeName))
    .slice(0, Math.max(1, Math.min(Number(limit) || 8, 12)))
    .map((row) => {
      const code = String(row.Code || '').trim();
      const mkt = String(row.MktNum || row.MarketType || '').trim();
      const prefix = mkt === '1' ? 'sh' : mkt === '0' ? 'sz' : mkt === '2' ? 'bj' : code.startsWith('6') ? 'sh' : code.startsWith('4') || code.startsWith('8') ? 'bj' : 'sz';
      return {
        symbol: prefix + code,
        code,
        name: row.Name || code,
        market: 'cn',
        exchange: row.SecurityTypeName || (prefix === 'sh' ? '沪A' : prefix === 'bj' ? '北交所' : '深A'),
        type: row.Classify || row.SecurityTypeName || '',
        pinyin: row.PinYin || ''
      };
    });
}

// 东财涨跌榜：沪深 A 股 (m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23)。
export async function fetchEastmoneyMovers({ direction = 'gainers', limit = 20 } = {}) {
  const order = direction === 'losers' ? 0 : 1;
  // Eastmoney expects literal `+` in `fs`. Build query manually to avoid URL encoding it as %2B.
  const qs = [
    'pn=1',
    'pz=' + limit,
    'po=' + order,
    'fid=f3',
    'fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23',
    'fields=f2,f3,f4,f12,f13,f14,f15,f16,f17,f18',
    '_=' + Date.now()
  ].join('&');
  const url = EM_PUSH2_HOST + '/api/qt/clist/get?' + qs;
  const res = await fetch(url, {
    headers: { ...COMMON_HEADERS, referer: 'https://quote.eastmoney.com/' },
    cf: { cacheTtl: 30 }
  });
  if (!res.ok) {
    console.warn('eastmoney movers HTTP ' + res.status);
    return [];
  }
  const data = await res.json().catch(() => null);
  const diff = data && data.data && data.data.diff;
  const rows = Array.isArray(diff)
    ? diff
    : diff && typeof diff === 'object'
      ? Object.values(diff)
      : [];
  return rows.map((row) => {
    const prefix = row.f13 === 1 ? 'sh' : 'sz';
    return {
      symbol: prefix + row.f12,
      code: row.f12,
      name: row.f14 || '',
      price: row.f2,
      changePercent: row.f3,
      change: row.f4
    };
  });
}

// ===================== Finnhub（美股基本面 + 新闻） =====================

export async function fetchFinnhubQuote(symbol, { token }) {
  const url = buildUrl(FINNHUB_HOST, '/api/v1/quote', { symbol, token });
  const res = await fetch(url, { headers: COMMON_HEADERS, cf: { cacheTtl: 30 } });
  if (!res.ok) throw new Error('finnhub quote ' + symbol + ' HTTP ' + res.status);
  return res.json();
}

export async function fetchFinnhubProfile(symbol, { token }) {
  const url = buildUrl(FINNHUB_HOST, '/api/v1/stock/profile2', { symbol, token });
  const res = await fetch(url, { headers: COMMON_HEADERS, cf: { cacheTtl: 86400 } });
  if (!res.ok) throw new Error('finnhub profile ' + symbol + ' HTTP ' + res.status);
  return res.json();
}

export async function fetchFinnhubCompanyNews(symbol, { token, from, to }) {
  const f = from || new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10);
  const t = to || new Date().toISOString().slice(0, 10);
  const url = buildUrl(FINNHUB_HOST, '/api/v1/company-news', { symbol, from: f, to: t, token });
  const res = await fetch(url, { headers: COMMON_HEADERS, cf: { cacheTtl: 300 } });
  if (!res.ok) throw new Error('finnhub news ' + symbol + ' HTTP ' + res.status);
  return res.json();
}

export async function fetchFinnhubMarketNews({ token, category = 'general' }) {
  const url = buildUrl(FINNHUB_HOST, '/api/v1/news', { category, token });
  const res = await fetch(url, { headers: COMMON_HEADERS, cf: { cacheTtl: 300 } });
  if (!res.ok) throw new Error('finnhub market news HTTP ' + res.status);
  return res.json();
}

// Finnhub 财报日历：默认拉 [today, today+14d] 区间。结构 { earningsCalendar: [...] }。
export async function fetchFinnhubEarningsCalendar({ token, from, to }) {
  const f = from || new Date().toISOString().slice(0, 10);
  const t = to || new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  const url = buildUrl(FINNHUB_HOST, '/api/v1/calendar/earnings', { from: f, to: t, token });
  const res = await fetch(url, { headers: COMMON_HEADERS, cf: { cacheTtl: 1800 } });
  if (!res.ok) throw new Error('finnhub earnings calendar HTTP ' + res.status);
  return res.json();
}

// ----- Tavily news ---------------------------------------------------------
// 调用 Tavily Search API（topic=news）拉一批近期新闻。
// 主要用来给「今日主题」提供多元化信源（不只是 Reuters/CNBC wire）。
export async function fetchTavilyNews({ key, query, maxResults = 8, days = 1 }) {
  if (!key) throw new Error('missing TAVILY_API_KEY');
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      query,
      topic: 'news',
      search_depth: 'basic',
      include_answer: false,
      include_raw_content: false,
      max_results: maxResults,
      days
    })
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`tavily news HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  return Array.isArray(data?.results) ? data.results : [];
}

// 从 URL 推出人读友好的来源名：reuters.com -> "Reuters"、finance.yahoo.com -> "Yahoo Finance"。
export function hostToSourceName(url) {
  if (!url) return '';
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch (_) { return ''; }
  const map = {
    'reuters.com': 'Reuters',
    'cnbc.com': 'CNBC',
    'wsj.com': 'WSJ',
    'bloomberg.com': 'Bloomberg',
    'nytimes.com': 'NYT',
    'ft.com': 'FT',
    'marketwatch.com': 'MarketWatch',
    'finance.yahoo.com': 'Yahoo Finance',
    'yahoo.com': 'Yahoo Finance',
    'barrons.com': "Barron's",
    'axios.com': 'Axios',
    'politico.com': 'Politico',
    'apnews.com': 'AP',
    'foxbusiness.com': 'Fox Business',
    'theguardian.com': 'Guardian',
    'businessinsider.com': 'Business Insider',
    'seekingalpha.com': 'Seeking Alpha',
    'investing.com': 'Investing.com',
    'forbes.com': 'Forbes',
    'fortune.com': 'Fortune',
    'theverge.com': 'The Verge',
    'techcrunch.com': 'TechCrunch',
    'arstechnica.com': 'Ars Technica',
    'morningstar.com': 'Morningstar',
    'benzinga.com': 'Benzinga',
    'cnn.com': 'CNN',
    'bbc.com': 'BBC',
    'bbc.co.uk': 'BBC',
    'reutersagency.com': 'Reuters',
    'wsj.market': 'WSJ'
  };
  if (map[host]) return map[host];
  // 剖出根域名作为 fallback。
  const parts = host.split('.');
  const base = parts.length >= 2 ? parts.slice(-2).join('.') : host;
  if (map[base]) return map[base];
  return base;
}

// ===================== CNN Fear & Greed Index =====================

const FNG_RATING_ZH = {
  'extreme fear': '极度恐惧',
  fear: '恐惧',
  neutral: '中性',
  greed: '贪婪',
  'extreme greed': '极度贪婪'
};

// CNN 返回的 fear_and_greed：{ score, rating, timestamp, previous_close, previous_1_week, previous_1_month, previous_1_year }
// 装成与 Yahoo 指数 quote 同构的 entry，方便前端复用 IndexCard。
export async function fetchCnnFearGreed() {
  const url = buildUrl(CNN_FNG_HOST, '/index/fearandgreed/graphdata');
  const res = await fetch(url, { headers: CNN_BROWSER_HEADERS, cf: { cacheTtl: 300 } });
  if (!res.ok) throw new Error('cnn fng HTTP ' + res.status);
  const data = await res.json();
  const fg = data && data.fear_and_greed;
  if (!fg || typeof fg.score !== 'number') throw new Error('cnn fng empty');
  const score = round(fg.score, 2);
  const previousClose = round(fg.previous_close, 2);
  const change = score != null && previousClose != null ? round(score - previousClose, 2) : null;
  const changePercent = previousClose ? round(((score - previousClose) / previousClose) * 100, 2) : null;
  const ratingKey = String(fg.rating || '').trim().toLowerCase();
  const ratingZh = FNG_RATING_ZH[ratingKey] || ratingKey;
  return {
    symbol: 'CNN_FNG',
    name: ratingZh ? '恐惧贪婪·' + ratingZh : '恐惧贪婪指数',
    market: 'us',
    price: score,
    previousClose,
    change,
    changePercent,
    rating: ratingKey,
    previousWeek: round(fg.previous_1_week, 2),
    previousMonth: round(fg.previous_1_month, 2),
    previousYear: round(fg.previous_1_year, 2),
    currency: '',
    exchangeTimezone: 'America/New_York',
    marketState: '',
    asOf: fg.timestamp ? new Date(fg.timestamp).toISOString() : new Date().toISOString()
  };
}
