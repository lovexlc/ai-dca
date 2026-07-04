const TENCENT_QUOTE_URL = 'https://qt.gtimg.cn/';
const TENCENT_SEARCH_URL = 'https://smartbox.gtimg.cn/s3/';
const EM_KLINE_URL = 'https://push2his.eastmoney.com/api/qt/stock/kline/get';
const EM_PUSH_TOKEN = '7eea3edcaed734bea9cbfc24409ed989';

const CN_EXCHANGE_PREFIXES = new Set(['15', '50', '51', '52', '53', '54', '56', '58']);

function safeNumber(value) {
  const n = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function compactNumber(value) {
  const n = safeNumber(value);
  return n == null ? null : Math.round(n * 10000) / 10000;
}

function decodeTencentBuffer(buffer) {
  try {
    return new TextDecoder('gbk').decode(buffer);
  } catch (_error) {
    return new TextDecoder().decode(buffer);
  }
}

export function normalizeDirectSymbol(symbol = '') {
  const raw = String(symbol || '').trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  const prefixedCn = /^(sh|sz|bj)(\d{6})$/i.exec(raw);
  if (prefixedCn) {
    return {
      market: 'cn',
      code: prefixedCn[2],
      tencent: prefixedCn[1].toLowerCase() + prefixedCn[2],
      eastmoneySecid: (prefixedCn[1].toLowerCase() === 'sh' ? '1.' : '0.') + prefixedCn[2]
    };
  }
  if (/^\d{6}$/.test(raw)) {
    const prefix = raw.startsWith('6') || raw.startsWith('5') ? 'sh' : 'sz';
    return {
      market: 'cn',
      code: raw,
      tencent: prefix + raw,
      eastmoneySecid: (prefix === 'sh' ? '1.' : '0.') + raw
    };
  }
  const hk = /^hk?(\d{5})$/i.exec(raw);
  if (hk) return { market: 'hk', code: hk[1], tencent: 'hk' + hk[1] };
  if (/^[A-Z][A-Z0-9.-]{0,15}$/i.test(raw) && !raw.startsWith('^')) {
    const code = raw.toUpperCase();
    return { market: 'us', code, tencent: 'us' + code };
  }
  return null;
}

function parseTencentVariables(text = '') {
  const rows = [];
  const re = /v_([^=]+)="([^"]*)";?/g;
  let match;
  while ((match = re.exec(text))) {
    rows.push({ key: match[1], fields: String(match[2] || '').split('~') });
  }
  return rows;
}

function normalizeTencentQuote(key, fields) {
  if (!Array.isArray(fields) || fields.length <= 5 || fields[0] === '') return null;
  const rawCode = fields[2] || key.replace(/^(sh|sz|bj|hk|us)/i, '');
  const market = key.startsWith('hk') ? 'hk' : key.startsWith('us') ? 'us' : 'cn';
  const symbol = market === 'cn' ? rawCode : market === 'hk' ? 'hk' + rawCode : rawCode;
  const previousClose = compactNumber(fields[4]);
  const price = compactNumber(fields[3]);
  const change = compactNumber(fields[31] ?? (price != null && previousClose != null ? price - previousClose : null));
  const changePercent = compactNumber(fields[32] ?? (previousClose ? (change / previousClose) * 100 : null));
  const quote = {
    symbol,
    code: rawCode,
    name: fields[1] || symbol,
    market,
    price,
    currentPrice: price,
    previousClose,
    open: compactNumber(fields[5]),
    high: compactNumber(fields[33]),
    low: compactNumber(fields[34]),
    change,
    changePercent,
    volume: safeNumber(fields[6]),
    turnover: safeNumber(fields[37]),
    amount: safeNumber(fields[37]),
    time: fields[30] || '',
    asOf: new Date().toISOString(),
    currency: market === 'cn' ? '¥' : market === 'hk' ? 'HKD' : 'USD',
    source: 'tencent-direct',
    assetType: market === 'cn' && CN_EXCHANGE_PREFIXES.has(String(rawCode).slice(0, 2)) ? 'exchange_fund' : 'stock'
  };
  if (market === 'cn') {
    quote.high52w = compactNumber(fields[67]);
    quote.low52w = compactNumber(fields[68]);
    quote.marketCapital = safeNumber(fields[45]);
    quote.pe = safeNumber(fields[39]);
    quote.pb = safeNumber(fields[46]);
  } else if (market === 'us') {
    quote.high52w = compactNumber(fields[48]);
    quote.low52w = compactNumber(fields[49]);
    quote.marketCapital = safeNumber(fields[45]);
    quote.pe = safeNumber(fields[39]);
    quote.pb = safeNumber(fields[47]);
  } else if (market === 'hk') {
    quote.marketCapital = safeNumber(fields[45]);
  }
  return quote;
}

export function parseTencentQuoteText(text = '') {
  const quotes = {};
  for (const row of parseTencentVariables(text)) {
    const quote = normalizeTencentQuote(row.key, row.fields);
    if (!quote) continue;
    quotes[quote.symbol] = quote;
    quotes[quote.code] = quote;
    quotes[row.key] = quote;
  }
  return quotes;
}

export async function fetchDirectQuotes(symbols = [], { signal } = {}) {
  const normalized = (Array.isArray(symbols) ? symbols : [symbols])
    .map((symbol) => ({ raw: String(symbol || '').trim(), meta: normalizeDirectSymbol(symbol) }))
    .filter((item) => item.raw && item.meta?.tencent);
  if (!normalized.length) return null;
  const q = normalized.map((item) => item.meta.tencent).join(',');
  const res = await fetch(`${TENCENT_QUOTE_URL}?q=${encodeURIComponent(q)}`, { signal, cache: 'no-store' });
  if (!res.ok) throw new Error('tencent quote HTTP ' + res.status);
  const text = decodeTencentBuffer(await res.arrayBuffer());
  const parsed = parseTencentQuoteText(text);
  const out = {};
  for (const item of normalized) {
    const quote = parsed[item.meta.tencent] || parsed[item.meta.code] || parsed[item.raw] || null;
    if (quote) out[item.raw] = quote;
  }
  return { quotes: out, generatedAt: new Date().toISOString(), source: 'tencent-direct' };
}

function decodeUnicodeEscapes(value = '') {
  return String(value || '').replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

export function parseTencentSearchText(text = '') {
  const match = String(text || '').match(/v_hint="([^"]*)"/);
  const body = match ? match[1] : '';
  if (!body || body === 'N') return [];
  return body.split('^').filter(Boolean).map((record) => {
    const fields = record.split('~');
    const market = fields[0] || '';
    const code = fields[1] || '';
    const type = fields[4] || '';
    return {
      symbol: market + code,
      code,
      name: decodeUnicodeEscapes(fields[2] || ''),
      market: market === 'us' ? 'us' : market === 'hk' ? 'hk' : 'cn',
      exchange: market,
      type,
      assetType: /ETF|LOF|QDII|JJ|FUND|KJ/i.test(type) ? 'fund' : /ZS|INDEX/i.test(type) ? 'index' : 'stock',
      source: 'tencent-smartbox'
    };
  });
}

function fetchSearchByScript(query, { signal } = {}) {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
      reject(new Error('script search requires browser'));
      return;
    }
    const script = document.createElement('script');
    const cleanup = () => {
      script.remove();
      if (signal) signal.removeEventListener('abort', abort);
    };
    const abort = () => {
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    window.v_hint = '';
    script.src = `${TENCENT_SEARCH_URL}?v=2&t=all&q=${encodeURIComponent(query)}`;
    script.charset = 'utf-8';
    script.onload = () => {
      const result = window.v_hint || '';
      cleanup();
      resolve(result);
    };
    script.onerror = () => {
      cleanup();
      reject(new Error('tencent smartbox script failed'));
    };
    if (signal) signal.addEventListener('abort', abort, { once: true });
    document.body.appendChild(script);
  });
}

export async function searchDirectSymbols(market, query, { limit = 8, signal } = {}) {
  const q = String(query || '').trim();
  if (!q) return { market, query: q, results: [] };
  const text = await fetchSearchByScript(q, { signal });
  const wantedMarket = String(market || '').toLowerCase();
  const results = parseTencentSearchText(text)
    .filter((item) => wantedMarket === 'us' ? item.market === 'us' : item.market === 'cn')
    .slice(0, Math.max(1, Math.min(Number(limit) || 8, 12)));
  return { market, query: q, results, generatedAt: new Date().toISOString(), source: 'tencent-smartbox-direct' };
}

function eastmoneyKlt(timeframe) {
  if (timeframe === '1d' || timeframe === '1y') return '101';
  if (timeframe === '1w') return '102';
  if (timeframe === '1mo') return '103';
  return '';
}

function epochSecFromCnDate(date) {
  const t = Date.parse(`${date}T15:00:00+08:00`);
  return Number.isFinite(t) ? Math.floor(t / 1000) : 0;
}

export function parseEastmoneyKlinePayload(payload, { symbol = '', timeframe = '1d' } = {}) {
  const data = payload?.data;
  const rows = Array.isArray(data?.klines) ? data.klines : [];
  const candles = rows.map((line) => {
    const [date, open, close, high, low, volume, amount] = String(line || '').split(',');
    return {
      t: epochSecFromCnDate(date),
      date,
      o: compactNumber(open),
      h: compactNumber(high),
      l: compactNumber(low),
      c: compactNumber(close),
      v: safeNumber(volume),
      amount: safeNumber(amount)
    };
  }).filter((item) => item.t > 0 && item.c != null);
  return {
    symbol: data?.code || symbol,
    name: data?.name || symbol,
    market: 'cn',
    tf: timeframe,
    candles,
    generatedAt: new Date().toISOString(),
    source: 'eastmoney-direct'
  };
}

export async function fetchDirectKline(symbol, { timeframe = '1d', limit = '' } = {}) {
  const meta = normalizeDirectSymbol(symbol);
  const klt = eastmoneyKlt(timeframe);
  if (!meta || meta.market !== 'cn' || !klt) return null;
  const params = new URLSearchParams({
    secid: meta.eastmoneySecid,
    ut: EM_PUSH_TOKEN,
    fields1: 'f1,f2,f3,f4,f5,f6',
    fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
    klt,
    fqt: '1',
    beg: '19700101',
    end: '20500101'
  });
  const res = await fetch(`${EM_KLINE_URL}?${params.toString()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('eastmoney kline HTTP ' + res.status);
  const payload = await res.json();
  if (payload?.rc !== 0 || !payload?.data) throw new Error('eastmoney kline empty');
  const normalized = parseEastmoneyKlinePayload(payload, { symbol: meta.code, timeframe });
  const requestedLimit = Number(limit);
  if (Number.isFinite(requestedLimit) && requestedLimit > 0) {
    normalized.candles = normalized.candles.slice(-requestedLimit);
  }
  return normalized;
}
