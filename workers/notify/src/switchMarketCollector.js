const TENCENT_QUOTE_URL = 'https://qt.gtimg.cn/';
const SINA_QUOTE_URL = 'https://hq.sinajs.cn/';
const EASTMONEY_ULIST_URL = 'https://push2delay.eastmoney.com/api/qt/ulist.np/get';
const EASTMONEY_FIELDS = 'f12,f14,f2,f3,f124,f402,f441';
const EASTMONEY_FUNDMOB_URL = 'https://fundmobapi.eastmoney.com/FundMNewApi/FundMNFInfo';
const EASTMONEY_CLIST_URL = 'https://push2delay.eastmoney.com/api/qt/clist/get';
const EASTMONEY_PUSH_TOKEN = 'bd1d9ddb04089700cf9c27f6f7426281';
const EASTMONEY_CLIST_FS = 'b:MK0021,b:MK0022,b:MK0023,b:MK0024,b:MK0827';
const EASTMONEY_CLIST_PAGE_SIZE = 100;
const EASTMONEY_CLIST_MAX_PAGES = 3;
const MAX_QUOTE_AGE_MS = 120_000;
const QUOTE_TIMEOUT_MS = 8_000;
const ORDER_BOOK_TIMEOUT_MS = 2_500;
const ORDER_BOOK_LEVELS = 5;

function text(value = '', max = 1000) { return String(value ?? '').trim().slice(0, max); }
function number(value) { const result = Number(value); return Number.isFinite(result) ? result : null; }
function positiveNumber(value) { const result = number(value); return Number.isFinite(result) && result > 0 ? result : null; }
function nonNegativeNumber(value) { const result = number(value); return Number.isFinite(result) && result >= 0 ? result : null; }
function round4(value) { return Number.isFinite(value) ? Number(value.toFixed(4)) : null; }
function normalizeCode(value = '') { const code = text(value, 12).replace(/^(?:sh|sz|bj)/i, ''); return /^\d{6}$/.test(code) ? code : ''; }
function tencentSymbol(code) { return `${code.startsWith('5') || code.startsWith('6') ? 'sh' : 'sz'}${code}`; }
function sinaSymbol(code) { return tencentSymbol(code); }
function eastmoneySecid(code) { return `${code.startsWith('5') || code.startsWith('6') ? '1' : '0'}.${code}`; }
function timestamp(value) { const parsed = Date.parse(text(value, 80)); return Number.isFinite(parsed) ? parsed : 0; }
function shanghaiTimestamp(value = '') {
  const raw = text(value, 20);
  const match = raw.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (!match) return '';
  const [, year, month, day, hour, minute, second] = match;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}+08:00`;
}
function sinaTimestamp(date = '', time = '') {
  const day = text(date, 16);
  const clock = text(time, 16);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{2}:\d{2}:\d{2}$/.test(clock)) return '';
  return `${day}T${clock}+08:00`;
}
function eastmoneyTimestamp(value) {
  const raw = number(value);
  if (!Number.isFinite(raw) || raw <= 0) return '';
  return new Date((raw < 1e12 ? raw * 1000 : raw)).toISOString();
}
function decodeGbk(buffer) {
  try { return new TextDecoder('gbk').decode(buffer); } catch { return new TextDecoder().decode(buffer); }
}

function normalizeOrderBook(levels = [], source = '') {
  const normalizedLevels = (Array.isArray(levels) ? levels : [])
    .slice(0, ORDER_BOOK_LEVELS)
    .map((item, index) => ({
      level: Number(item?.level) || index + 1,
      bidPrice: round4(positiveNumber(item?.bidPrice)),
      bidVolume: nonNegativeNumber(item?.bidVolume),
      askPrice: round4(positiveNumber(item?.askPrice)),
      askVolume: nonNegativeNumber(item?.askVolume)
    }))
    .filter((item) => item.bidPrice != null || item.askPrice != null);
  const top = normalizedLevels.find((item) => item.level === 1) || normalizedLevels[0] || null;
  if (!top) return null;
  const bidPrice = top.bidPrice;
  const askPrice = top.askPrice;
  const spread = bidPrice != null && askPrice != null ? round4(askPrice - bidPrice) : null;
  const mid = bidPrice != null && askPrice != null ? (bidPrice + askPrice) / 2 : null;
  return {
    bidPrice,
    bidVolume: top.bidVolume,
    askPrice,
    askVolume: top.askVolume,
    levels: normalizedLevels,
    spread,
    spreadPercent: spread != null && mid && mid > 0 ? round4((spread / mid) * 100) : null,
    source
  };
}

function parseTencentOrderBook(fields = []) {
  const levels = [];
  for (let level = 1; level <= ORDER_BOOK_LEVELS; level += 1) {
    const bidIndex = 9 + (level - 1) * 2;
    const askIndex = 19 + (level - 1) * 2;
    levels.push({
      level,
      bidPrice: fields[bidIndex],
      bidVolume: fields[bidIndex + 1],
      askPrice: fields[askIndex],
      askVolume: fields[askIndex + 1]
    });
  }
  return normalizeOrderBook(levels, 'tencent');
}

function parseSinaOrderBook(fields = []) {
  const levels = [];
  for (let level = 1; level <= ORDER_BOOK_LEVELS; level += 1) {
    const bidVolumeIndex = 10 + (level - 1) * 2;
    const askVolumeIndex = 20 + (level - 1) * 2;
    levels.push({
      level,
      bidPrice: fields[bidVolumeIndex + 1],
      bidVolume: fields[bidVolumeIndex],
      askPrice: fields[askVolumeIndex + 1],
      askVolume: fields[askVolumeIndex]
    });
  }
  return normalizeOrderBook(levels, 'sina');
}

export function parseTencentQuoteText(payload = '') {
  const rows = {};
  const pattern = /v_([^=]+)="([^"]*)";?/g;
  let match;
  while ((match = pattern.exec(String(payload || '')))) {
    const fields = String(match[2] || '').split('~');
    if (fields.length < 6) continue;
    const code = normalizeCode(fields[2] || match[1]);
    if (!code) continue;
    rows[code] = {
      code,
      name: text(fields[1] || code, 80),
      price: number(fields[3]),
      asOf: shanghaiTimestamp(fields[30]),
      suspended: text(fields[40], 4).toUpperCase() === 'S',
      source: 'tencent',
      orderBook: parseTencentOrderBook(fields)
    };
  }
  return rows;
}

export function parseSinaQuoteText(payload = '') {
  const rows = {};
  const pattern = /var\s+hq_str_([^=]+)="([^"]*)";?/g;
  let match;
  while ((match = pattern.exec(String(payload || '')))) {
    const fields = String(match[2] || '').split(',');
    const code = normalizeCode(match[1]);
    if (!code || fields.length < 30) continue;
    rows[code] = {
      code,
      name: text(fields[0] || code, 80),
      price: number(fields[3]),
      asOf: sinaTimestamp(fields[30], fields[31]),
      suspended: !(positiveNumber(fields[3]) > 0),
      source: 'sina',
      orderBook: parseSinaOrderBook(fields)
    };
  }
  return rows;
}

async function fetchTencentQuotes(codes, { timeoutMs = QUOTE_TIMEOUT_MS } = {}) {
  const query = codes.map(tencentSymbol).join(',');
  const response = await fetch(`${TENCENT_QUOTE_URL}?q=${encodeURIComponent(query)}`, {
    headers: { accept: 'text/plain,*/*', referer: 'https://gu.qq.com/' },
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) throw new Error(`Tencent quote failed: HTTP ${response.status}`);
  return parseTencentQuoteText(decodeGbk(await response.arrayBuffer()));
}

async function fetchSinaQuotes(codes, { timeoutMs = QUOTE_TIMEOUT_MS } = {}) {
  const query = codes.map(sinaSymbol).join(',');
  const response = await fetch(`${SINA_QUOTE_URL}list=${query}`, {
    headers: {
      accept: 'text/plain,*/*',
      referer: 'https://finance.sina.com.cn/',
      'user-agent': 'Mozilla/5.0 (compatible; ai-dca-notify/1.0)'
    },
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) throw new Error(`Sina quote failed: HTTP ${response.status}`);
  return parseSinaQuoteText(decodeGbk(await response.arrayBuffer()));
}

function hasUsableOrderBook(quote) {
  const book = quote?.orderBook;
  return Boolean(book && (positiveNumber(book.bidPrice) != null || positiveNumber(book.askPrice) != null));
}

export async function fetchSwitchOrderBooks(codes = []) {
  const requested = Array.from(new Set((codes || []).map(normalizeCode).filter(Boolean))).slice(0, 30);
  if (!requested.length) return { generatedAt: '', books: {}, source: 'tencent+sina-fallback', successCount: 0, failureCount: 0, errors: [] };

  const books = {};
  const errors = [];
  let tencentRows = {};
  try {
    tencentRows = await fetchTencentQuotes(requested, { timeoutMs: ORDER_BOOK_TIMEOUT_MS });
  } catch (error) {
    errors.push(`tencent:${error instanceof Error ? error.message : String(error)}`);
  }

  const fallbackCodes = [];
  for (const code of requested) {
    const quote = tencentRows[code];
    if (hasUsableOrderBook(quote)) {
      books[code] = {
        code,
        name: quote.name || code,
        price: quote.price,
        asOf: quote.asOf || '',
        source: 'tencent',
        orderBook: quote.orderBook
      };
    } else {
      fallbackCodes.push(code);
    }
  }

  if (fallbackCodes.length) {
    try {
      const sinaRows = await fetchSinaQuotes(fallbackCodes, { timeoutMs: ORDER_BOOK_TIMEOUT_MS });
      for (const code of fallbackCodes) {
        const quote = sinaRows[code];
        if (!hasUsableOrderBook(quote)) continue;
        books[code] = {
          code,
          name: quote.name || tencentRows[code]?.name || code,
          price: quote.price ?? tencentRows[code]?.price ?? null,
          asOf: quote.asOf || tencentRows[code]?.asOf || '',
          source: 'sina',
          orderBook: quote.orderBook
        };
      }
    } catch (error) {
      errors.push(`sina:${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    books,
    source: 'tencent+sina-fallback',
    successCount: Object.keys(books).length,
    failureCount: requested.length - Object.keys(books).length,
    errors
  };
}

function nullableNumber(value) {
  if (value == null) return null;
  const raw = String(value).trim().replace(/%$/, '');
  if (!raw || raw === '--' || raw === '-') return null;
  const result = Number(raw);
  return Number.isFinite(result) ? result : null;
}

function fundMobTimestamp(value) {
  const raw = text(value, 80);
  if (!raw || raw === '--') return '';
  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})[\sT]?(\d{2}):?(\d{2}):?(\d{2})$/);
  if (compact) {
    const [, year, month, day, hour, minute, second] = compact;
    return year + '-' + month + '-' + day + 'T' + hour + ':' + minute + ':' + second + '+08:00';
  }
  const local = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (local) {
    const [, year, month, day, hour, minute, second = '00'] = local;
    return year + '-' + month + '-' + day + 'T' + hour + ':' + minute + ':' + second + '+08:00';
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
}

function getEastmoneyItems(payload) {
  const diff = payload?.data?.diff;
  return Array.isArray(diff) ? diff : diff && typeof diff === 'object' ? Object.values(diff) : [];
}

function parseEastmoneyReferenceItems(payload, source = 'eastmoney-push2delay') {
  const rows = {};
  for (const item of getEastmoneyItems(payload)) {
    const code = normalizeCode(item?.f12);
    if (!code) continue;
    const vendorDiscountPct = nullableNumber(item?.f402);
    const referenceAsOf = eastmoneyTimestamp(item?.f124);
    rows[code] = {
      code,
      name: text(item?.f14 || code, 80),
      iopv: positiveNumber(nullableNumber(item?.f441)),
      vendorPremiumPct: Number.isFinite(vendorDiscountPct) ? -vendorDiscountPct : null,
      premiumSource: 'eastmoney-vendor-premium',
      referenceAsOf,
      asOf: referenceAsOf,
      source
    };
  }
  return rows;
}

export function parseFundMobApiReferences(payload = {}) {
  const datas = Array.isArray(payload?.Datas) ? payload.Datas : [];
  const rows = {};
  for (const item of datas) {
    const code = normalizeCode(item?.FCODE);
    if (!code) continue;
    const price = positiveNumber(nullableNumber(item?.NEWPRICE));
    const latestNav = positiveNumber(nullableNumber(item?.NAV));
    const zjl = nullableNumber(item?.ZJL);
    const vendorPremiumPct = Number.isFinite(zjl) ? -zjl : null;
    const denominator = Number.isFinite(vendorPremiumPct) ? 1 + vendorPremiumPct / 100 : null;
    const iopv = price != null && denominator > 0 ? positiveNumber(price / denominator) : null;
    const asOf = fundMobTimestamp(item?.HQDATE);
    rows[code] = {
      code,
      name: text(item?.SHORTNAME || code, 80),
      price,
      priceSource: 'eastmoney-fundmobapi',
      latestNav,
      iopv: round4(iopv),
      vendorPremiumPct,
      premiumSource: Number.isFinite(vendorPremiumPct) ? 'eastmoney-fundmobapi-zjl' : '',
      priceAsOf: asOf,
      referenceAsOf: asOf,
      asOf,
      source: 'eastmoney-fundmobapi'
    };
  }
  return rows;
}

async function fetchFundMobApiReferences(codes) {
  if (!codes.length) return {};
  const params = new URLSearchParams({
    pageIndex: '1',
    pageSize: '200',
    plat: 'Android',
    appType: 'ttjj',
    product: 'EFund',
    Version: '1',
    deviceid: 'ai-dca-notify-worker',
    Fcodes: codes.join(',')
  });
  const response = await fetch(EASTMONEY_FUNDMOB_URL + '?' + params.toString(), {
    headers: {
      accept: 'application/json, text/plain, */*',
      referer: 'https://fund.eastmoney.com/',
      'user-agent': 'Mozilla/5.0 (Linux; Android 10; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'
    },
    signal: AbortSignal.timeout(QUOTE_TIMEOUT_MS)
  });
  if (!response.ok) throw new Error('Eastmoney fundmob reference failed: HTTP ' + response.status);
  const payload = await response.json().catch(() => null);
  if (!payload || payload.Success === false || !Array.isArray(payload.Datas)) {
    const message = text(payload?.ErrMsg || payload?.ErrCode || 'invalid response', 120);
    throw new Error('Eastmoney fundmob reference failed: ' + message);
  }
  return parseFundMobApiReferences(payload);
}

async function fetchEastmoneyReferences(codes) {
  if (!codes.length) return {};
  const params = new URLSearchParams({
    secids: codes.map(eastmoneySecid).join(','),
    fields: EASTMONEY_FIELDS,
    fltt: '2',
    invt: '2'
  });
  const response = await fetch(EASTMONEY_ULIST_URL + '?' + params.toString(), {
    headers: { accept: 'application/json', referer: 'https://quote.eastmoney.com/' },
    signal: AbortSignal.timeout(QUOTE_TIMEOUT_MS)
  });
  if (!response.ok) throw new Error('Eastmoney ulist reference failed: HTTP ' + response.status);
  const payload = await response.json().catch(() => null);
  if (!payload) throw new Error('Eastmoney ulist reference failed: invalid JSON');
  return parseEastmoneyReferenceItems(payload);
}

async function fetchEastmoneyClistReferences(codes) {
  const remaining = new Set(codes);
  const found = {};
  for (let page = 1; page <= EASTMONEY_CLIST_MAX_PAGES && remaining.size; page += 1) {
    const params = new URLSearchParams({
      pn: String(page),
      pz: String(EASTMONEY_CLIST_PAGE_SIZE),
      po: '1',
      np: '1',
      ut: EASTMONEY_PUSH_TOKEN,
      fltt: '2',
      invt: '2',
      fid: 'f3',
      fs: EASTMONEY_CLIST_FS,
      fields: EASTMONEY_FIELDS
    });
    const response = await fetch(EASTMONEY_CLIST_URL + '?' + params.toString(), {
      headers: { accept: 'application/json', referer: 'https://quote.eastmoney.com/' },
      signal: AbortSignal.timeout(2_500)
    });
    if (!response.ok) throw new Error('Eastmoney clist reference failed: HTTP ' + response.status);
    const payload = await response.json().catch(() => null);
    if (!payload) throw new Error('Eastmoney clist reference failed: invalid JSON');
    const rows = parseEastmoneyReferenceItems(payload, 'eastmoney-clist');
    for (const code of Array.from(remaining)) {
      if (!rows[code]) continue;
      found[code] = rows[code];
      remaining.delete(code);
    }
    if (!Object.keys(rows).length) break;
    const total = nullableNumber(payload?.data?.total);
    if (Number.isFinite(total) && page * EASTMONEY_CLIST_PAGE_SIZE >= total) break;
  }
  return found;
}

function hasUsablePremiumReference(reference) {
  return Number.isFinite(nullableNumber(reference?.vendorPremiumPct)) || positiveNumber(reference?.iopv) != null;
}

function mergeEastmoneyReference(primary = {}, fallback = {}) {
  const fallbackPremium = nullableNumber(fallback.vendorPremiumPct);
  const fallbackIopv = positiveNumber(fallback.iopv);
  const useFallback = Number.isFinite(fallbackPremium) || fallbackIopv != null;
  const referenceAsOf = fallback.referenceAsOf || fallback.asOf || primary.referenceAsOf || primary.asOf || '';
  return {
    ...primary,
    ...fallback,
    code: primary.code || fallback.code || '',
    name: text(primary.name || fallback.name || primary.code || fallback.code || '', 80),
    price: positiveNumber(primary.price) ?? positiveNumber(fallback.price),
    priceSource: primary.priceSource || fallback.priceSource || '',
    priceAsOf: primary.priceAsOf || fallback.priceAsOf || '',
    latestNav: positiveNumber(primary.latestNav) ?? positiveNumber(fallback.latestNav),
    iopv: fallbackIopv ?? positiveNumber(primary.iopv),
    vendorPremiumPct: Number.isFinite(fallbackPremium) ? fallbackPremium : nullableNumber(primary.vendorPremiumPct),
    premiumSource: Number.isFinite(fallbackPremium)
      ? (fallback.premiumSource || 'eastmoney-vendor-premium')
      : (primary.premiumSource || fallback.premiumSource || ''),
    referenceAsOf,
    asOf: referenceAsOf,
    source: useFallback ? (fallback.source || 'eastmoney-push2delay') : (primary.source || fallback.source || '')
  };
}

function normalizeItem(code, quote, reference, now) {
  const quotePrice = number(quote?.price);
  const mobilePrice = reference?.priceSource === 'eastmoney-fundmobapi'
    ? positiveNumber(reference?.price)
    : null;
  const price = mobilePrice ?? quotePrice;
  const iopv = positiveNumber(reference?.iopv);
  const vendorPremiumPct = nullableNumber(reference?.vendorPremiumPct);
  const hasFundMobPremium = reference?.premiumSource === 'eastmoney-fundmobapi-zjl' && Number.isFinite(vendorPremiumPct);
  const computedPremiumPct = price > 0 && iopv > 0 ? ((price - iopv) / iopv) * 100 : null;
  const premiumPct = hasFundMobPremium
    ? vendorPremiumPct
    : Number.isFinite(computedPremiumPct)
      ? computedPremiumPct
      : vendorPremiumPct;
  const premiumSource = hasFundMobPremium
    ? 'eastmoney-fundmobapi-zjl'
    : Number.isFinite(computedPremiumPct)
      ? 'eastmoney-iopv'
      : Number.isFinite(vendorPremiumPct)
        ? 'eastmoney-vendor-premium'
        : 'unavailable';
  const priceAsOf = text(mobilePrice != null ? (reference?.priceAsOf || reference?.asOf) : quote?.asOf, 80);
  const referenceAsOf = text(reference?.referenceAsOf || reference?.asOf, 80);
  const priceAt = timestamp(priceAsOf);
  const referenceAt = timestamp(referenceAsOf);
  const issues = [];
  if (!(price > 0)) issues.push('missing_price');
  if (!Number.isFinite(premiumPct)) issues.push('missing_premium');
  if (quote?.suspended) issues.push('suspended');
  if (!priceAt || now - priceAt > MAX_QUOTE_AGE_MS) issues.push('stale_price');
  if (!referenceAt || now - referenceAt > MAX_QUOTE_AGE_MS) issues.push('stale_reference');
  return {
    code,
    name: text(quote?.name || reference?.name || code, 80),
    price: round4(price),
    iopv: round4(iopv),
    latestNav: round4(positiveNumber(reference?.latestNav)),
    premiumPct: round4(premiumPct),
    premiumSource,
    asOf: priceAsOf || referenceAsOf,
    priceAsOf,
    referenceAsOf,
    expiresAt: '',
    source: text((quote?.source || 'tencent') + '+' + premiumSource, 80),
    orderBook: hasUsableOrderBook(quote) ? quote.orderBook : null,
    orderBookSource: hasUsableOrderBook(quote) ? text(quote?.source || quote?.orderBook?.source || 'tencent', 32) : '',
    valid: issues.length === 0,
    invalidReasons: issues
  };
}

export async function fetchSwitchCollectorSnapshot(_env, codes = []) {
  const requested = Array.from(new Set((codes || []).map(normalizeCode).filter(Boolean))).slice(0, 30);
  if (!requested.length) return { generatedAt: '', funds: {}, source: 'tencent+eastmoney', successCount: 0, failureCount: 0 };
  const [quotes, fundMobResult] = await Promise.all([
    fetchTencentQuotes(requested),
    fetchFundMobApiReferences(requested)
      .then((rows) => ({ rows, error: null }))
      .catch((error) => ({ rows: {}, error }))
  ]);
  const references = { ...fundMobResult.rows };
  const referenceErrors = [];
  if (fundMobResult.error) referenceErrors.push('fundmobapi: ' + String(fundMobResult.error?.message || fundMobResult.error));
  const fallbackCodes = requested.filter((code) => !hasUsablePremiumReference(references[code]));
  let push2Succeeded = false;
  if (fallbackCodes.length) {
    try {
      const push2Rows = await fetchEastmoneyReferences(fallbackCodes);
      push2Succeeded = true;
      for (const code of fallbackCodes) {
        if (push2Rows[code]) references[code] = mergeEastmoneyReference(references[code], push2Rows[code]);
      }
    } catch (error) {
      referenceErrors.push('push2-ulist: ' + String(error?.message || error));
    }
    const clistCodes = fallbackCodes.filter((code) => !hasUsablePremiumReference(references[code]));
    if (clistCodes.length) {
      try {
        const clistRows = await fetchEastmoneyClistReferences(clistCodes);
        for (const code of clistCodes) {
          if (clistRows[code]) references[code] = mergeEastmoneyReference(references[code], clistRows[code]);
        }
      } catch (error) {
        referenceErrors.push('push2-clist: ' + String(error?.message || error));
      }
    }
  }

  if (referenceErrors.length && requested.some((code) => !hasUsablePremiumReference(references[code]))) {
    console.warn('[switch-market-collector] premium fallback incomplete', JSON.stringify({
      requestedCount: requested.length,
      push2Succeeded,
      errors: referenceErrors
    }));
  }
  const missingBookCodes = requested.filter((code) => !hasUsableOrderBook(quotes[code]));
  if (missingBookCodes.length) {
    try {
      const sinaRows = await fetchSinaQuotes(missingBookCodes);
      for (const code of missingBookCodes) {
        if (!hasUsableOrderBook(sinaRows[code])) continue;
        const primary = quotes[code] || {};
        quotes[code] = {
          ...primary,
          name: primary.name || sinaRows[code].name,
          price: primary.price ?? sinaRows[code].price,
          asOf: primary.asOf || sinaRows[code].asOf,
          orderBook: sinaRows[code].orderBook,
          source: 'sina'
        };
      }
    } catch (_error) {
      // 盘口是增强信息，新浪兜底失败不影响主快照的价格和溢价计算。
    }
  }

  const now = Date.now();
  const funds = {};
  for (const code of requested) funds[code] = normalizeItem(code, quotes[code], references[code], now);
  return {
    generatedAt: new Date(now).toISOString(),
    funds,
    source: 'tencent+eastmoney',
    successCount: Object.values(funds).filter((item) => item.valid).length,
    failureCount: Object.values(funds).filter((item) => !item.valid).length
  };
}
