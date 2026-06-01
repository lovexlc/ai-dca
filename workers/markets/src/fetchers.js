// 行情数据源封装。所有 fetch 统一返回归一化 schema，失败报 throw。
//
// 所有外部 URL 都拆成 base + path，避免被上游平台误伤为可压缩引用。

const UA = 'Mozilla/5.0 (compatible; ai-dca-markets/1.0)';
const COMMON_HEADERS = { 'user-agent': UA, accept: '*/*' };

const YAHOO_HOST = 'https://' + 'query1.finance.yahoo.com';
const YAHOO_SEARCH_HOST = 'https://' + 'query2.finance.yahoo.com';
const EM_SEARCH_HOST = 'https://' + 'searchapi.eastmoney.com';
const SINA_CN_HOST = 'https://' + 'quotes.sina.cn';
const SINA_HQ_HOST = 'https://' + 'hq.sinajs.cn';
const XUEQIU_STOCK_HOST = 'https://' + 'stock.xueqiu.com';
const XUEQIU_WEB_HOST = 'https://' + 'xueqiu.com';
const FINNHUB_HOST = 'https://' + 'finnhub.io';
const DANJUAN_HOST = 'https://' + 'danjuanapp.com';

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
  const prefix = digits.startsWith('6') || digits.startsWith('51') || digits.startsWith('56') || digits.startsWith('58') || digits.startsWith('000')
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
    currency: quote.currency || 'CNY',
    exchangeTimezone: 'Asia/Shanghai',
    marketState: normalizeXueqiuMarketState(quote),
    asOf: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : new Date().toISOString(),
    source: 'xueqiu-quote'
  };
}

function normalizeXueqiuKlinePayload(data, code, intervalLabel) {
  const payload = data?.data || {};
  const columns = Array.isArray(payload.column) ? payload.column : [];
  const items = Array.isArray(payload.item) ? payload.item : Array.isArray(payload.items) ? payload.items : [];
  if (!items.length) throw new Error('xueqiu kline empty ' + code);
  const idx = Object.fromEntries(columns.map((name, index) => [String(name), index]));
  const get = (row, name) => row[idx[name]];
  const candles = items.map((row) => {
    const ts = Number(get(row, 'timestamp'));
    return {
      t: Number.isFinite(ts) ? Math.floor(ts / 1000) : null,
      o: round(get(row, 'open'), 4),
      h: round(get(row, 'high'), 4),
      l: round(get(row, 'low'), 4),
      c: round(get(row, 'close'), 4),
      v: Number(get(row, 'volume')) || 0
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
  return normalizeXueqiuQuotePayload(data, code);
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

function toSinaSymbol(code) {
  const lower = String(code || '').toLowerCase();
  if (/^(sh|sz|bj)\d{6}$/.test(lower)) return lower;
  if (/^\d{6}$/.test(lower)) {
    return lower.startsWith('6') || lower.startsWith('51') || lower.startsWith('56') || lower.startsWith('58')
      ? `sh${lower}`
      : `sz${lower}`;
  }
  return lower;
}

function normalizeSinaKlineRows(rows = [], intervalLabel = '1d') {
  return rows
    .map((row) => {
      const rawDay = String(row?.day || row?.date || '').trim();
      if (!rawDay) return null;
      const dateText = rawDay.includes(' ') ? rawDay.replace(' ', 'T') : `${rawDay}T00:00:00`;
      const t = Math.floor(new Date(`${dateText}+08:00`).getTime() / 1000);
      if (!Number.isFinite(t)) return null;
      return {
        t,
        o: round(row?.open, 4),
        h: round(row?.high, 4),
        l: round(row?.low, 4),
        c: round(row?.close, 4),
        v: Number(row?.volume) || 0
      };
    })
    .filter((bar) => bar && [bar.o, bar.h, bar.l, bar.c].every((value) => Number.isFinite(value)))
    .sort((left, right) => left.t - right.t);
}


function describeSinaRawRowForLog(row) {
  if (!row) return null;
  return {
    day: row.day || row.date || null,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume
  };
}

const SINA_SCALE_MAP = { '1m': 1, '5m': 5, '15m': 15, '30m': 30, '60m': 60, '1d': 240, '1w': 240, '1mo': 240 };

export async function fetchSinaKline(code, { intervalLabel = '1d', limit = 500 } = {}) {
  const symbol = toSinaSymbol(code);
  if (!symbol) throw new Error('sina bad code ' + code);
  const scale = SINA_SCALE_MAP[intervalLabel] || 240;
  const url = buildUrl(SINA_CN_HOST, '/cn/api/json_v2.php/CN_MarketDataService.getKLineData', {
    symbol,
    scale,
    ma: 'no',
    datalen: limit
  });
  console.log('[markets:sina-kline] upstream request', { code, symbol, intervalLabel, scale, limit, url });
  const res = await fetch(url, {
    headers: { ...COMMON_HEADERS, referer: 'https://finance.sina.com.cn' },
    cf: { cacheTtl: 30 }
  });
  console.log('[markets:sina-kline] upstream response', {
    code,
    symbol,
    intervalLabel,
    status: res.status,
    ok: res.ok,
    cacheStatus: res.headers.get('cf-cache-status'),
    date: res.headers.get('date'),
    age: res.headers.get('age')
  });
  if (!res.ok) throw new Error('sina kline ' + code + ' HTTP ' + res.status);
  const rows = await res.json().catch(() => null);
  if (!Array.isArray(rows)) throw new Error('sina kline ' + code + ' invalid response');
  console.log('[markets:sina-kline] upstream rows', {
    code,
    symbol,
    intervalLabel,
    count: rows.length,
    first: describeSinaRawRowForLog(rows[0]),
    last: describeSinaRawRowForLog(rows[rows.length - 1])
  });
  const candles = normalizeSinaKlineRows(rows, intervalLabel);
  if (!candles.length) throw new Error('sina kline ' + code + ' empty');
  console.log('[markets:sina-kline] normalized candles', {
    code,
    symbol,
    intervalLabel,
    count: candles.length,
    first: candles[0],
    last: candles[candles.length - 1]
  });
  return {
    symbol,
    interval: intervalLabel,
    name: '',
    source: 'sina-kline',
    candles
  };
}

async function readSinaQuoteText(response) {
  const buffer = await response.arrayBuffer();
  try {
    return new TextDecoder('gb18030').decode(buffer);
  } catch (_) {
    return new TextDecoder().decode(buffer);
  }
}

function parseSinaQuoteText(text) {
  const map = new Map();
  const re = /var\s+hq_str_(sh|sz)(\d{6})="([^"]*)";?/g;
  let match;
  while ((match = re.exec(String(text || ''))) !== null) {
    const symbol = `${match[1]}${match[2]}`;
    const fields = String(match[3] || '').split(',');
    if (fields.length < 4 || !fields[0]) continue;
    const current = Number(fields[3]);
    const previousClose = Number(fields[2]);
    const price = Number.isFinite(current) && current > 0
      ? current
      : (Number.isFinite(previousClose) && previousClose > 0 ? previousClose : NaN);
    if (!Number.isFinite(price) || price <= 0) continue;
    const change = Number.isFinite(previousClose) && previousClose > 0 ? round(price - previousClose, 4) : null;
    const changePercent = Number.isFinite(previousClose) && previousClose > 0 ? round((change / previousClose) * 100, 4) : null;
    const date = String(fields[30] || '').trim();
    const time = String(fields[31] || '').trim();
    const asOf = date ? new Date(`${date}T${time || '15:00:00'}+08:00`).toISOString() : new Date().toISOString();
    map.set(symbol, {
      symbol,
      name: fields[0] || symbol,
      market: 'cn',
      price: round(price, 4),
      previousClose: Number.isFinite(previousClose) && previousClose > 0 ? round(previousClose, 4) : null,
      change,
      changePercent,
      open: Number.isFinite(Number(fields[1])) ? round(fields[1], 4) : null,
      high: Number.isFinite(Number(fields[4])) ? round(fields[4], 4) : null,
      low: Number.isFinite(Number(fields[5])) ? round(fields[5], 4) : null,
      volume: Number(fields[8]) || null,
      turnover: Number(fields[9]) || null,
      currency: 'CNY',
      exchangeTimezone: 'Asia/Shanghai',
      marketState: time && time < '15:00:00' ? 'REGULAR' : 'CLOSED',
      asOf,
      source: 'sina-quote'
    });
  }
  return map;
}

export async function fetchSinaQuotesBatch(codes = []) {
  const pairs = (codes || [])
    .map((code) => ({ raw: code, symbol: toSinaSymbol(code) }))
    .filter((item) => item.symbol);
  if (!pairs.length) return {};
  const symbols = Array.from(new Set(pairs.map((item) => item.symbol)));
  const url = SINA_HQ_HOST + '/list=' + symbols.join(',');
  const res = await fetch(url, {
    headers: { ...COMMON_HEADERS, referer: 'https://finance.sina.com.cn/' },
    cf: { cacheTtl: 15 }
  });
  if (!res.ok) throw new Error('sina quote batch HTTP ' + res.status);
  const text = await readSinaQuoteText(res);
  const parsed = parseSinaQuoteText(text);
  const out = {};
  for (const item of pairs) {
    const quote = parsed.get(item.symbol);
    if (quote) out[item.raw] = quote;
    else out[item.raw] = { symbol: item.raw, error: 'sina quote ' + item.symbol + ' empty' };
  }
  return out;
}

export async function fetchSinaQuote(code) {
  const symbol = toSinaSymbol(code);
  if (!symbol) throw new Error('sina bad code ' + code);
  const quotes = await fetchSinaQuotesBatch([code]);
  const quote = quotes[code];
  if (!quote || quote.error) throw new Error((quote && quote.error) || ('sina quote ' + symbol + ' empty'));
  return quote;
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
    updatedAt: Number(d.updated_at) || 0
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
