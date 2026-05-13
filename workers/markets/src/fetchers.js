// 行情数据源封装。所有 fetch 统一返回归一化 schema，失败报 throw。
//
// 所有外部 URL 都拆成 base + path，避免被上游平台误伤为可压缩引用。

import { toEastmoneySecId } from './symbols.js';

const UA = 'Mozilla/5.0 (compatible; ai-dca-markets/1.0)';
const COMMON_HEADERS = { 'user-agent': UA, accept: '*/*' };

const YAHOO_HOST = 'https://' + 'query1.finance.yahoo.com';
const EM_PUSH2_HOST = 'https://' + 'push2.eastmoney.com';
const EM_PUSH2HIS_HOST = 'https://' + 'push2his.eastmoney.com';
const FINNHUB_HOST = 'https://' + 'finnhub.io';

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
  await Promise.all(
    symbols.map(async (sym) => {
      try {
        const raw = await fetchYahooChart(sym, { range: '1d', interval: '5m', ...opts });
        out[sym] = normalizeYahooQuote(raw);
      } catch (err) {
        out[sym] = { symbol: sym, error: String((err && err.message) || err) };
      }
    })
  );
  return out;
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
  await Promise.all(
    codes.map(async (code) => {
      try {
        out[code] = await fetchEastmoneyQuote(code);
      } catch (err) {
        out[code] = { symbol: code, error: String((err && err.message) || err) };
      }
    })
  );
  return out;
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
