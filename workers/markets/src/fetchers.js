// 行情数据源封装。所有 fetch 统一返回归一化 schema，失败报 throw。
//
// 所有外部 URL 都拆成 base + path，避免被上游平台误伤为可压缩引用。

import { fetchCnnFearGreed } from './newsFetchers.js';

const UA = 'Mozilla/5.0 (compatible; ai-dca-markets/1.0)';
const COMMON_HEADERS = { 'user-agent': UA, accept: '*/*' };

const YAHOO_HOST = 'https://' + 'query1.finance.yahoo.com';
const YAHOO_SEARCH_HOST = 'https://' + 'query2.finance.yahoo.com';
const CBOE_HOST = 'https://' + 'www.cboe.com';
const FRED_HOST = 'https://' + 'fred.stlouisfed.org';
const MULTPL_HOST = 'https://' + 'www.multpl.com';
const EM_SEARCH_HOST = 'https://' + 'searchapi.eastmoney.com';
const XUEQIU_STOCK_HOST = 'https://' + 'stock.xueqiu.com';
const XUEQIU_WEB_HOST = 'https://' + 'xueqiu.com';
const FINNHUB_HOST = 'https://' + 'finnhub.io';
const DANJUAN_HOST = 'https://' + 'danjuanapp.com';
const DANJUAN_FUNDS_HOST = 'https://' + 'danjuanfunds.com';

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

function stripHtml(value) {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#x2002;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function toDateIso(dateText) {
  const raw = String(dateText || '').trim();
  if (!raw) return '';
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? Date.parse(raw + 'T00:00:00Z')
    : Date.parse(raw + ' UTC');
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
}

function normalizeIndicatorQuote({
  symbol,
  name,
  price,
  previousClose = null,
  asOf = '',
  source,
  meta = '',
  extra = {},
}) {
  const value = round(price, 4);
  const previous = previousClose == null ? null : round(previousClose, 4);
  const change = value != null && previous != null ? round(value - previous, 4) : null;
  const changePercent = previous ? round(((value - previous) / previous) * 100, 4) : null;
  return {
    symbol,
    name,
    market: 'us',
    price: value,
    previousClose: previous,
    change,
    changePercent,
    volume: null,
    currency: '',
    exchangeTimezone: 'America/New_York',
    marketState: '',
    asOf: asOf || new Date().toISOString(),
    source,
    meta,
    ...extra
  };
}

function parseSimpleCsvSeries(text, seriesId) {
  const rows = String(text || '').split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const values = [];
  for (const line of rows) {
    if (line.startsWith('observation_date')) continue;
    const parts = line.split(',');
    const date = String(parts[0] || '').trim();
    const rawValue = String(parts[1] || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || rawValue === '.') continue;
    const value = Number(rawValue);
    if (Number.isFinite(value)) values.push({ date, value });
  }
  if (!values.length) throw new Error('fred series empty ' + seriesId);
  return values;
}

async function fetchFredSeriesQuote(seriesId, name) {
  const url = buildUrl(FRED_HOST, '/graph/fredgraph.csv', { id: seriesId });
  const res = await fetch(url, { headers: COMMON_HEADERS, cf: { cacheTtl: 21600 } });
  if (!res.ok) throw new Error('fred ' + seriesId + ' HTTP ' + res.status);
  const rows = parseSimpleCsvSeries(await res.text(), seriesId);
  const latest = rows[rows.length - 1];
  const previous = rows.length > 1 ? rows[rows.length - 2] : null;
  return normalizeIndicatorQuote({
    symbol: seriesId,
    name,
    price: latest.value,
    previousClose: previous?.value ?? null,
    asOf: toDateIso(latest.date),
    source: 'fred',
    meta: 'FRED · monthly',
    extra: { observationDate: latest.date }
  });
}

async function fetchCboePutCallRatio() {
  const url = buildUrl(CBOE_HOST, '/markets/us/options/market-statistics/daily');
  const res = await fetch(url, { headers: COMMON_HEADERS, cf: { cacheTtl: 300 } });
  if (!res.ok) throw new Error('cboe put/call HTTP ' + res.status);
  const text = stripHtml(await res.text());
  const match = text.match(/TOTAL\s+PUT\/CALL\s+RATIO\s+(-?\d+(?:\.\d+)?)/i);
  if (!match) throw new Error('cboe put/call ratio missing');
  return normalizeIndicatorQuote({
    symbol: 'CBOE_PCR',
    name: 'Put/Call Ratio',
    price: Number(match[1]),
    source: 'cboe-daily-market-statistics',
    meta: 'Cboe · daily'
  });
}

function parseMultplRows(html) {
  const rows = [];
  const rowRe = /<tr[^>]*>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/gi;
  let match;
  while ((match = rowRe.exec(String(html || ''))) !== null) {
    const dateText = stripHtml(match[1]);
    const valueText = stripHtml(match[2]);
    const valueMatch = valueText.match(/-?\d+(?:\.\d+)?/);
    if (!dateText || !valueMatch) continue;
    const value = Number(valueMatch[0]);
    if (Number.isFinite(value)) rows.push({ dateText, value });
  }
  return rows;
}

async function fetchSp500PeRatio() {
  const url = buildUrl(MULTPL_HOST, '/s-p-500-pe-ratio/table/by-month');
  const res = await fetch(url, { headers: COMMON_HEADERS, cf: { cacheTtl: 21600 } });
  if (!res.ok) throw new Error('multpl sp500 pe HTTP ' + res.status);
  const rows = parseMultplRows(await res.text());
  if (!rows.length) throw new Error('multpl sp500 pe empty');
  const latest = rows[0];
  const previous = rows[1] || null;
  return normalizeIndicatorQuote({
    symbol: 'SP500_PE',
    name: 'S&P 500 P/E Ratio',
    price: latest.value,
    previousClose: previous?.value ?? null,
    asOf: toDateIso(latest.dateText),
    source: 'multpl-sp500-pe',
    meta: 'Multpl · monthly',
    extra: { observationDate: latest.dateText }
  });
}

async function fetchYahooIndicatorAlias(symbol, yahooSymbol, name) {
  const raw = await fetchYahooChart(yahooSymbol, { range: '1d', interval: '5m' });
  const quote = normalizeYahooQuote(raw, name);
  return {
    ...quote,
    symbol,
    name,
    currency: '',
    source: 'yahoo-market-breadth',
    underlyingSymbol: yahooSymbol,
    meta: 'Yahoo Finance'
  };
}

const SPECIAL_MARKET_INDICATORS = {
  CNN_FNG: () => fetchCnnFearGreed(),
  CBOE_PCR: () => fetchCboePutCallRatio(),
  CPIAUCSL: () => fetchFredSeriesQuote('CPIAUCSL', 'CPI'),
  PCEPI: () => fetchFredSeriesQuote('PCEPI', 'PCE Price Index'),
  SP500_PE: () => fetchSp500PeRatio(),
  NYAD_LINE: () => fetchYahooIndicatorAlias('NYAD_LINE', '^NYAD', 'Advance-Decline Line (NYSE)'),
  NAAD_LINE: () => fetchYahooIndicatorAlias('NAAD_LINE', '^NAAD', 'A/D Line (Nasdaq)'),
};

export function isSpecialMarketIndicator(symbol) {
  const key = String(symbol || '').trim().toUpperCase();
  return Boolean(SPECIAL_MARKET_INDICATORS[key]);
}

export async function fetchSpecialMarketIndicatorQuote(symbol) {
  const key = String(symbol || '').trim().toUpperCase();
  const fetcher = SPECIAL_MARKET_INDICATORS[key];
  if (!fetcher) throw new Error('unknown special indicator ' + symbol);
  return fetcher();
}


function toCnSixDigits(code) {
  const lower = String(code || '').trim().toLowerCase();
  const match = lower.match(/(?:sh|sz|bj)?(\d{6})$/);
  return match ? match[1] : '';
}

function toXueqiuSymbol(code) {
  const lower = String(code || '').trim().toLowerCase();
  if (/^(sh|sz|bj)\d{6}$/.test(lower)) return lower.toUpperCase();
  const digits = toCnSixDigits(lower);
  if (!digits) return '';
  const prefix = digits.startsWith('6') || digits.startsWith('5') || digits.startsWith('000')
    ? 'SH'
    : digits.startsWith('4') || digits.startsWith('8')
      ? 'BJ'
      : 'SZ';
  return prefix + digits;
}

function xueqiuHeaders(cookie, refererSymbol = '') {
  const trimmedCookie = String(cookie || '').trim();
  if (!trimmedCookie) throw new Error('XUEQIU_COOKIE missing');
  const referer = refererSymbol ? `${XUEQIU_WEB_HOST}/S/${refererSymbol}` : `${XUEQIU_WEB_HOST}/`;
  return {
    ...COMMON_HEADERS,
    accept: 'application/json, text/plain, */*',
    cookie: trimmedCookie,
    origin: XUEQIU_WEB_HOST,
    referer,
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36'
  };
}

async function readXueqiuJson(res, label) {
  const text = await res.text();
  if (!text || !text.trim()) throw new Error(`${label} empty response; XUEQIU_COOKIE may be expired`);
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error(`${label} invalid json: ${String((err && err.message) || err)}`);
  }
  if (data && data.error_code && Number(data.error_code) !== 0) {
    throw new Error(`${label} error_code=${data.error_code} ${data.error_description || ''}`.trim());
  }
  return data;
}

function normalizeXueqiuMarketState(quote = {}) {
  const status = String(quote.status || quote.market_status || '').toLowerCase();
  if (status === '1' || status.includes('交易') || status.includes('open')) return 'REGULAR';
  return 'CLOSED';
}

function formatShanghaiDateFromMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(n)).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  return parts.year && parts.month && parts.day ? `${parts.year}-${parts.month}-${parts.day}` : '';
}

function finiteNumberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    const n = finiteNumberOrNull(value);
    if (n != null) return n;
  }
  return null;
}

function firstPositiveNumber(...values) {
  for (const value of values) {
    const n = finiteNumberOrNull(value);
    if (n != null && n > 0) return n;
  }
  return null;
}

function normalizeXueqiuOrderBookPayload(data = {}) {
  const root = data && typeof data === 'object' ? data : {};
  const payload = root.data && typeof root.data === 'object' ? root.data : root;
  const quote = payload.quote && typeof payload.quote === 'object' ? payload.quote : {};
  const source = payload.pankou && typeof payload.pankou === 'object' ? payload.pankou : payload;
  const bids = Array.isArray(source.bids) ? source.bids : Array.isArray(source.bid) ? source.bid : [];
  const asks = Array.isArray(source.asks) ? source.asks : Array.isArray(source.ask) ? source.ask : [];
  const bid1 = Array.isArray(bids[0]) ? bids[0] : null;
  const ask1 = Array.isArray(asks[0]) ? asks[0] : null;
  const bidPrice = firstPositiveNumber(
    source.bp1, source.bid1, source.bid1_price, source.bid_price1,
    source.buy1, source.buy1_price, source.buy_price1, quote.bp1, quote.bid1,
    bid1?.[0], bid1?.price
  );
  const askPrice = firstPositiveNumber(
    source.sp1, source.ask1, source.ask1_price, source.ask_price1,
    source.sell1, source.sell1_price, source.sell_price1, quote.sp1, quote.ask1,
    ask1?.[0], ask1?.price
  );
  const bidVolume = firstFiniteNumber(
    source.bc1, source.bid1_volume, source.bid1_vol, source.bid_volume1,
    source.buy1_volume, source.buy1_vol, source.buy_volume1, quote.bc1,
    bid1?.[1], bid1?.volume
  );
  const askVolume = firstFiniteNumber(
    source.sc1, source.ask1_volume, source.ask1_vol, source.ask_volume1,
    source.sell1_volume, source.sell1_vol, source.sell_volume1, quote.sc1,
    ask1?.[1], ask1?.volume
  );
  if (bidPrice == null && askPrice == null) return null;
  const spread = bidPrice != null && askPrice != null ? round(askPrice - bidPrice, 4) : null;
  const mid = bidPrice != null && askPrice != null ? (bidPrice + askPrice) / 2 : null;
  const spreadPercent = spread != null && mid && mid > 0 ? round((spread / mid) * 100, 4) : null;
  return {
    bidPrice: bidPrice != null ? round(bidPrice, 4) : null,
    bidVolume: bidVolume != null ? bidVolume : null,
    askPrice: askPrice != null ? round(askPrice, 4) : null,
    askVolume: askVolume != null ? askVolume : null,
    spread,
    spreadPercent,
    source: 'xueqiu-pankou'
  };
}

function normalizeXueqiuQuotePayload(data, code) {
  const quote = data?.data?.quote || data?.quote || data?.data || {};
  if (!quote || typeof quote !== 'object') throw new Error('xueqiu quote empty');
  const symbol = String(quote.symbol || toXueqiuSymbol(code) || code || '').trim().toUpperCase();
  const price = round(quote.current != null ? quote.current : quote.last_close, 4);
  const previousClose = round(quote.last_close, 4);
  if (price == null || price <= 0) throw new Error('xueqiu quote invalid price ' + symbol);
  const change = quote.chg != null ? round(quote.chg, 4) : (previousClose != null ? round(price - previousClose, 4) : null);
  const changePercent = quote.percent != null ? round(quote.percent, 4) : (previousClose ? round(((price - previousClose) / previousClose) * 100, 4) : null);
  const timestamp = Number(quote.timestamp || quote.time || Date.now());
  return {
    symbol: symbol.toLowerCase(),
    code: String(quote.code || toCnSixDigits(symbol) || toCnSixDigits(code) || '').trim(),
    name: quote.name || symbol,
    market: 'cn',
    price,
    previousClose,
    change,
    changePercent,
    open: round(quote.open, 4),
    high: round(quote.high, 4),
    low: round(quote.low, 4),
    volume: Number(quote.volume) || null,
    turnover: Number(quote.amount) || null,
    marketCapital: Number(quote.market_capital) || null,
    iopv: round(quote.iopv, 4),
    latestNav: round(quote.unit_nav, 4),
    accumulatedNav: round(quote.acc_unit_nav, 4),
    latestNavDate: formatShanghaiDateFromMs(quote.nav_date),
    premiumPercent: round(quote.premium_rate, 4),
    currentYearPercent: round(quote.current_year_percent, 4),
    totalShares: Number(quote.total_shares) || null,
    volumeRatio: round(quote.volume_ratio, 4),
    high52w: round(quote.high52w, 4),
    low52w: round(quote.low52w, 4),
    orderBook: normalizeXueqiuOrderBookPayload(data),
    currency: quote.currency || 'CNY',
    exchangeTimezone: 'Asia/Shanghai',
    marketState: normalizeXueqiuMarketState(quote),
    asOf: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : new Date().toISOString(),
    source: 'xueqiu-quote'
  };
}

async function fetchXueqiuOrderBook(symbol, { cookie } = {}) {
  const url = buildUrl(XUEQIU_STOCK_HOST, '/v5/stock/realtime/pankou.json', { symbol });
  const res = await fetch(url, { headers: xueqiuHeaders(cookie, symbol), cf: { cacheTtl: 5 } });
  if (!res.ok) throw new Error('xueqiu pankou ' + symbol + ' HTTP ' + res.status);
  const data = await readXueqiuJson(res, 'xueqiu pankou ' + symbol);
  return normalizeXueqiuOrderBookPayload(data);
}

function normalizeXueqiuKlinePayload(data, code, intervalLabel) {
  const payload = data?.data || {};
  const columns = Array.isArray(payload.column) ? payload.column : [];
  const items = Array.isArray(payload.item) ? payload.item : Array.isArray(payload.items) ? payload.items : [];
  if (!items.length) throw new Error('xueqiu kline empty ' + code);
  const idx = Object.fromEntries(columns.map((name, index) => [String(name), index]));
  const get = (row, name) => row[idx[name]];
  const getAny = (row, names) => {
    for (const name of names) {
      if (Object.prototype.hasOwnProperty.call(idx, name)) return row[idx[name]];
    }
    return undefined;
  };
  const candles = items.map((row) => {
    const ts = Number(get(row, 'timestamp'));
    const bidPrice = firstPositiveNumber(getAny(row, [
      'bidPrice', 'bid_price', 'bid', 'bp1', 'bid1', 'bid1_price', 'bid_price1',
      'buy1', 'buy1_price', 'buy_price1'
    ]));
    const askPrice = firstPositiveNumber(getAny(row, [
      'askPrice', 'ask_price', 'ask', 'sp1', 'ask1', 'ask1_price', 'ask_price1',
      'sell1', 'sell1_price', 'sell_price1'
    ]));
    const bidVolume = firstFiniteNumber(getAny(row, [
      'bidVolume', 'bid_volume', 'bidSize', 'bc1', 'bid1_volume', 'bid_volume1',
      'buy1_volume', 'buy_volume1'
    ]));
    const askVolume = firstFiniteNumber(getAny(row, [
      'askVolume', 'ask_volume', 'askSize', 'sc1', 'ask1_volume', 'ask_volume1',
      'sell1_volume', 'sell_volume1'
    ]));
    return {
      t: Number.isFinite(ts) ? Math.floor(ts / 1000) : null,
      o: round(get(row, 'open'), 4),
      h: round(get(row, 'high'), 4),
      l: round(get(row, 'low'), 4),
      c: round(get(row, 'close'), 4),
      v: Number(get(row, 'volume')) || 0,
      bidPrice: bidPrice != null ? round(bidPrice, 4) : null,
      bidVolume: bidVolume != null ? bidVolume : null,
      askPrice: askPrice != null ? round(askPrice, 4) : null,
      askVolume: askVolume != null ? askVolume : null
    };
  }).filter((bar) => bar && Number.isFinite(bar.t) && [bar.o, bar.h, bar.l, bar.c].every((value) => Number.isFinite(value)))
    .sort((left, right) => left.t - right.t);
  if (!candles.length) throw new Error('xueqiu kline invalid candles ' + code);
  return {
    symbol: String(payload.symbol || toXueqiuSymbol(code) || code || '').trim().toLowerCase(),
    interval: intervalLabel,
    name: '',
    source: 'xueqiu-kline',
    candles
  };
}

const XUEQIU_PERIOD_MAP = { '1d': 'day', '1w': 'week', '1mo': 'month', '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m', '60m': '60m' };

export async function fetchXueqiuQuote(code, { cookie } = {}) {
  const symbol = toXueqiuSymbol(code);
  if (!symbol) throw new Error('xueqiu bad code ' + code);
  const url = buildUrl(XUEQIU_STOCK_HOST, '/v5/stock/quote.json', { extend: 'detail', symbol });
  const res = await fetch(url, { headers: xueqiuHeaders(cookie, symbol), cf: { cacheTtl: 15 } });
  if (!res.ok) throw new Error('xueqiu quote ' + symbol + ' HTTP ' + res.status);
  const data = await readXueqiuJson(res, 'xueqiu quote ' + symbol);
  const quote = normalizeXueqiuQuotePayload(data, code);
  const orderBook = await fetchXueqiuOrderBook(symbol, { cookie }).catch(() => null);
  return orderBook ? { ...quote, orderBook } : quote;
}

export async function fetchXueqiuQuotesBatch(codes = [], { cookie } = {}) {
  const out = {};
  await mapLimit(codes || [], 5, async (code) => {
    try {
      out[code] = await fetchXueqiuQuote(code, { cookie });
    } catch (err) {
      out[code] = { symbol: code, error: String((err && err.message) || err) };
    }
  });
  return out;
}

export async function fetchXueqiuKline(code, { cookie, intervalLabel = '1d', limit = 500 } = {}) {
  const symbol = toXueqiuSymbol(code);
  if (!symbol) throw new Error('xueqiu bad code ' + code);
  const period = XUEQIU_PERIOD_MAP[intervalLabel] || 'day';
  const url = buildUrl(XUEQIU_STOCK_HOST, '/v5/stock/chart/kline.json', {
    symbol,
    begin: Date.now(),
    period,
    type: 'before',
    count: -Math.max(1, Math.min(Number(limit) || 500, 1000)),
    indicator: 'kline,pe,pb,ps,pcf,market_capital,agt,ggt,balance'
  });
  const res = await fetch(url, { headers: xueqiuHeaders(cookie, symbol), cf: { cacheTtl: 30 } });
  if (!res.ok) throw new Error('xueqiu kline ' + symbol + ' HTTP ' + res.status);
  const data = await readXueqiuJson(res, 'xueqiu kline ' + symbol);
  return normalizeXueqiuKlinePayload(data, code, intervalLabel);
}


async function readXueqiuEndpoint(path, params = {}, { cookie, refererSymbol = '', label = 'xueqiu endpoint' } = {}) {
  const url = buildUrl(XUEQIU_STOCK_HOST, path, params);
  const res = await fetch(url, { headers: xueqiuHeaders(cookie, refererSymbol), cf: { cacheTtl: 30 } });
  if (!res.ok) throw new Error(`${label} HTTP ${res.status}`);
  return readXueqiuJson(res, label);
}

function summarizeXueqiuPayload(data) {
  const root = data && typeof data === 'object' ? data : {};
  const payload = root.data;
  const summary = {
    topKeys: Object.keys(root).slice(0, 30),
    dataType: Array.isArray(payload) ? 'array' : (payload && typeof payload === 'object' ? 'object' : typeof payload)
  };
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    summary.dataKeys = Object.keys(payload).slice(0, 60);
    if (payload.quote && typeof payload.quote === 'object') {
      const q = payload.quote;
      summary.quoteKeys = Object.keys(q).slice(0, 120);
      summary.quote = q;
    }
    if (Array.isArray(payload.column)) summary.columns = payload.column;
    if (Array.isArray(payload.item)) {
      summary.itemCount = payload.item.length;
      summary.firstItem = payload.item[0] || null;
      summary.lastItem = payload.item[payload.item.length - 1] || null;
    }
    for (const key of ['items', 'list', 'data', 'indicator', 'balance', 'income', 'cash_flow']) {
      const value = payload[key];
      if (Array.isArray(value)) {
        summary[`${key}Count`] = value.length;
        summary[`${key}Sample`] = value[0] || null;
      } else if (value && typeof value === 'object') {
        summary[`${key}Keys`] = Object.keys(value).slice(0, 80);
        summary[`${key}Sample`] = value;
      }
    }
  } else if (Array.isArray(payload)) {
    summary.itemCount = payload.length;
    summary.firstItem = payload[0] || null;
  }
  if (root.error_code || root.code) {
    summary.errorCode = root.error_code || root.code;
    summary.errorMessage = root.error_description || root.message || '';
  }
  return summary;
}

export async function fetchXueqiuCnFundData(code, { cookie, includeRaw = false } = {}) {
  const symbol = toXueqiuSymbol(code);
  if (!symbol) throw new Error('xueqiu bad code ' + code);
  const endpoints = [
    ['quote_detail', '/v5/stock/quote.json', { extend: 'detail', symbol }],
    ['kline_day', '/v5/stock/chart/kline.json', { symbol, begin: Date.now(), period: 'day', type: 'before', count: -20, indicator: 'kline,pe,pb,ps,pcf,market_capital,agt,ggt,balance' }],
    ['kline_60m', '/v5/stock/chart/kline.json', { symbol, begin: Date.now(), period: '60m', type: 'before', count: -20, indicator: 'kline,pe,pb,ps,pcf,market_capital,agt,ggt,balance' }],
    ['capital_flow', '/v5/stock/capital/flow.json', { symbol }],
    ['capital_history', '/v5/stock/capital/history.json', { symbol }],
    ['f10_indicator', '/v5/stock/f10/cn/indicator.json', { symbol }],
    ['finance_indicator', '/v5/stock/finance/cn/indicator.json', { symbol, type: 'all', is_detail: true, count: 5 }],
    ['finance_balance', '/v5/stock/finance/cn/balance.json', { symbol, type: 'all', is_detail: true, count: 5 }],
    ['finance_income', '/v5/stock/finance/cn/income.json', { symbol, type: 'all', is_detail: true, count: 5 }],
    ['finance_cash_flow', '/v5/stock/finance/cn/cash_flow.json', { symbol, type: 'all', is_detail: true, count: 5 }],
    ['pankou', '/v5/stock/realtime/pankou.json', { symbol }],
    ['quotec', '/v5/stock/realtime/quotec.json', { symbol }]
  ];
  const results = {};
  await mapLimit(endpoints, 4, async ([name, path, params]) => {
    try {
      const data = await readXueqiuEndpoint(path, params, { cookie, refererSymbol: symbol, label: `xueqiu ${name} ${symbol}` });
      results[name] = {
        ok: true,
        summary: summarizeXueqiuPayload(data),
        ...(includeRaw ? { raw: data } : {})
      };
    } catch (err) {
      results[name] = { ok: false, error: String((err && err.message) || err) };
    }
  });
  return {
    symbol,
    code: toCnSixDigits(symbol),
    generatedAt: new Date().toISOString(),
    results
  };
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

// ===================== 东方财富搜索（仅用于 A 股搜索候选） =====================

export async function searchEastmoneySymbols(query, { limit = 8 } = {}) {
  const q = String(query || '').trim();
  if (!q) return [];
  const maxCount = Math.max(1, Math.min(Number(limit) || 8, 12));
  const url = buildUrl(EM_SEARCH_HOST, '/api/suggest/get', {
    input: q,
    type: 14,
    token: 'D43BF722C8E33BDC906FB84D85E326E8',
    count: Math.max(maxCount, 12)
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
    .filter((row) => {
      const code = String(row?.Code || '').trim();
      if (!/^\d{6}$/.test(code)) return false;
      const text = [row.Classify, row.SecurityType, row.SecurityTypeName, row.SecurityTypeName2, row.QuoteType, row.TypeName]
        .map((value) => String(value || '').toLowerCase())
        .join(' ');
      return row.Classify === 'AStock'
        || row.SecurityType === '1'
        || text.includes('stock')
        || text.includes('基金')
        || text.includes('fund')
        || text.includes('lof')
        || text.includes('etf')
        || text.includes('qdii');
    })
    .slice(0, maxCount)
    .map((row) => {
      const code = String(row.Code || '').trim();
      const mkt = String(row.MktNum || row.MarketType || '').trim();
      const typeText = [row.Classify, row.SecurityTypeName, row.SecurityTypeName2, row.QuoteType, row.TypeName]
        .map((value) => String(value || ''))
        .join(' ');
      const isFund = /基金|fund|lof|etf|qdii/i.test(typeText);
      const isExchangeTradedFund = /etf|lof|场内|封闭/i.test(typeText) || ['0', '1', '2'].includes(mkt);
      const isOtcFund = isFund && !isExchangeTradedFund;
      const prefix = mkt === '1' ? 'sh' : mkt === '0' ? 'sz' : mkt === '2' ? 'bj' : code.startsWith('6') ? 'sh' : code.startsWith('4') || code.startsWith('8') ? 'bj' : 'sz';
      return {
        symbol: isOtcFund ? code : prefix + code,
        code,
        name: row.Name || code,
        market: 'cn',
        exchange: isOtcFund ? '场外基金' : (row.SecurityTypeName || (prefix === 'sh' ? '沪A' : prefix === 'bj' ? '北交所' : '深A')),
        type: row.Classify || row.SecurityTypeName || '',
        assetType: isOtcFund ? 'otc_fund' : isFund ? 'exchange_fund' : 'stock',
        pinyin: row.PinYin || ''
      };
    });
}

// ===================== 蛋卷基金（场外基金净值） =====================

export async function fetchDanjuanFundMeta(code) {
  const fundCode = String(code || '').replace(/^(sh|sz|bj)/i, '');
  if (!/^\d{6}$/.test(fundCode)) throw new Error('danjuan invalid fund code: ' + code);
  const url = DANJUAN_FUNDS_HOST + '/djapi/fund/' + fundCode;
  const res = await fetch(url, {
    headers: {
      ...COMMON_HEADERS,
      referer: 'https://danjuanfunds.com/',
      'accept-language': 'zh-CN,zh;q=0.9'
    },
    cf: { cacheTtl: 86400 }
  });
  if (!res.ok) throw new Error('danjuan fund meta HTTP ' + res.status);
  const body = await res.json().catch(() => ({}));
  if (body?.result_code !== 0 && body?.result_code !== '0') {
    throw new Error('danjuan fund meta error: ' + JSON.stringify(body?.result_code));
  }
  const d = body?.data || {};
  return {
    code: String(d.fd_code || fundCode).trim(),
    symbol: String(d.fd_code || fundCode).trim(),
    name: String(d.fd_name || '').trim(),
    fullName: String(d.fd_full_name || '').trim(),
    fundType: String(d.type_desc || '').trim(),
    fundTypeCode: d.fd_type ?? d.type ?? null,
    totalShare: String(d.totshare || '').trim(),
    source: 'danjuan'
  };
}

export async function fetchDanjuanFundDetail(code) {
  const fundCode = String(code || '').replace(/^(sh|sz|bj)/i, '');
  if (!/^\d{6}$/.test(fundCode)) throw new Error('danjuan invalid fund code: ' + code);
  const url = DANJUAN_FUNDS_HOST + '/djapi/fund/detail/' + fundCode;
  const res = await fetch(url, {
    headers: {
      ...COMMON_HEADERS,
      referer: 'https://danjuanfunds.com/',
      'accept-language': 'zh-CN,zh;q=0.9'
    },
    cf: { cacheTtl: 86400 }
  });
  if (!res.ok) throw new Error('danjuan fund detail HTTP ' + res.status);
  const body = await res.json().catch(() => ({}));
  if (body?.result_code !== 0 && body?.result_code !== '0') {
    throw new Error('danjuan fund detail error: ' + JSON.stringify(body?.result_code));
  }
  const d = body?.data || {};
  const position = d.fund_position || {};
  return {
    code: fundCode,
    assetTotal: round(Number(position.asset_tot), 2),
    assetValue: round(Number(position.asset_val), 2),
    stockPercent: round(Number(position.stock_percent), 2),
    cashPercent: round(Number(position.cash_percent), 2),
    source: 'danjuan'
  };
}


export async function fetchDanjuanFundNav(code) {
  const fundCode = String(code || '').replace(/^(sh|sz|bj)/i, '');
  if (!/^\d{6}$/.test(fundCode)) throw new Error('danjuan invalid fund code: ' + code);
  // /djapi/fund/derived/ 返回 unit_nav + nav_grtd（日涨跌幅），/detail/ 不含净值
  const url = DANJUAN_HOST + '/djapi/fund/derived/' + fundCode;
  const res = await fetch(url, {
    headers: {
      ...COMMON_HEADERS,
      referer: 'https://danjuanfunds.com/',
      'accept-language': 'zh-CN,zh;q=0.9'
    },
    cf: { cacheTtl: 300 }
  });
  if (!res.ok) throw new Error('danjuan fund derived HTTP ' + res.status);
  const body = await res.json().catch(() => ({}));
  if (body?.result_code !== 0 && body?.result_code !== '0') {
    throw new Error('danjuan fund derived error: ' + JSON.stringify(body?.result_code));
  }
  const d = body?.data || {};
  const nav = Number(d.unit_nav);
  const changePercent = Number(d.nav_grtd);
  // 从净值和涨跌幅反算前日净值
  const prevNav = Number.isFinite(nav) && Number.isFinite(changePercent) && changePercent !== -100
    ? round(nav / (1 + changePercent / 100), 4) : null;
  const change = Number.isFinite(nav) && Number.isFinite(prevNav)
    ? round(nav - prevNav, 4) : null;

  // 尝试获取基金详情（资产规模）
  let assetTotal = null;
  try {
    const detail = await fetchDanjuanFundDetail(fundCode);
    assetTotal = detail.assetTotal;
  } catch (_err) {
    // 详情接口失败不影响主流程
  }

  return {
    code: fundCode,
    symbol: fundCode,
    name: '',
    price: null,
    currentPrice: null,
    close: null,
    previousClose: Number.isFinite(prevNav) ? prevNav : null,
    change: Number.isFinite(change) ? change : null,
    changePercent: Number.isFinite(changePercent) ? changePercent : null,
    latestNav: Number.isFinite(nav) ? nav : null,
    latestNavDate: String(d.end_date || '').trim(),
    iopv: null,
    marketState: '',
    asOf: new Date().toISOString(),
    source: 'danjuan',
    fallback: 'danjuan',
    primaryError: '',
    fundTypeCode: d.fd_type ?? null,
    updatedAt: Number(d.updated_at) || 0,
    ytdReturn: round(Number(d.nav_grlty), 4),
    return1w: round(Number(d.nav_grl1w), 4),
    return1m: round(Number(d.nav_grl1m), 4),
    return3m: round(Number(d.nav_grl3m), 4),
    return6m: round(Number(d.nav_grl6m), 4),
    return1y: round(Number(d.nav_grl1y), 4),
    returnBase: round(Number(d.nav_grbase), 4),
    fundSize: assetTotal,
  };
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
