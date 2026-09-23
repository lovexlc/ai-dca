// Market collector core — ported from lovexlc/fund_collector
// (market_collector/{core,sources,calendar_cn}.py).
// Runs on Cloudflare Workers: zero dependency on the cn host.

export const SYMBOLS = [
  '513870', '513390', '513300', '513110', '513100', '159941', '159696', '159660',
  '159659', '159632', '159513', '159509', '159501', '159577', '161125', '161128', '161130',
  '513500', '513650', '159612', '159655', '513850', '563020',
];

const TENCENT_QUOTE_URL = 'https://qt.gtimg.cn/';
const EASTMONEY_ULIST_URL = 'https://push2delay.eastmoney.com/api/qt/ulist.np/get';
const EASTMONEY_FUNDMOB_URL = 'https://fundmobapi.eastmoney.com/FundMNewApi/FundMNFInfo';
const FUNDMOB_UA = 'Mozilla/5.0 (Linux; Android 10; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const EASTMONEY_FIELDS = 'f12,f14,f2,f3,f124,f402,f441';
const MISMATCH_TOLERANCE_PP = 0.05;
export const TTL_SEC = 90;
const FETCH_TIMEOUT_MS = 10_000;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ---- trading calendar (from calendar_cn.py) ----
const HOLIDAY_RANGES = {
  2024: [['2024-01-01','2024-01-01'],['2024-02-09','2024-02-17'],['2024-04-04','2024-04-06'],['2024-05-01','2024-05-05'],['2024-06-10','2024-06-10'],['2024-09-15','2024-09-17'],['2024-10-01','2024-10-07']],
  2025: [['2025-01-01','2025-01-01'],['2025-01-28','2025-02-04'],['2025-04-04','2025-04-06'],['2025-05-01','2025-05-05'],['2025-05-31','2025-06-02'],['2025-10-01','2025-10-08']],
  2026: [['2026-01-01','2026-01-03'],['2026-02-15','2026-02-23'],['2026-04-04','2026-04-06'],['2026-05-01','2026-05-05'],['2026-06-19','2026-06-21'],['2026-09-25','2026-09-27'],['2026-10-01','2026-10-07']],
};

function shanghaiParts(date = new Date()) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, weekday: 'short' }).formatToParts(date);
  const get = (t) => p.find((x) => x.type === t)?.value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hm: `${get('hour')}:${get('minute')}`, weekday: get('weekday') };
}

export function isTradingDay(date = new Date()) {
  const { date: d, weekday } = shanghaiParts(date);
  if (['Sat', 'Sun'].includes(weekday)) return false;
  const ranges = HOLIDAY_RANGES[d.slice(0, 4)] || [];
  return !ranges.some(([s, e]) => s <= d && d <= e);
}

export function classifySession(date = new Date()) {
  if (!isTradingDay(date)) return 'off_hours';
  const { hm } = shanghaiParts(date);
  if (hm >= '09:30' && hm < '11:30') return 'trading';
  if (hm >= '11:30' && hm < '13:00') return 'lunch';
  if (hm >= '13:00' && hm < '15:31') return 'trading';
  return 'off_hours';
}

// ---- parsing helpers ----
function normalizeSymbol(value) {
  let raw = String(value || '').trim().replace(/^(sh|sz|bj)/i, '');
  return /^\d{6}$/.test(raw) ? raw : '';
}
const tencentSymbol = (code) => (/^[56]/.test(code) ? 'sh' : 'sz') + code;
const eastmoneySecid = (code) => (/^[56]/.test(code) ? '1.' : '0.') + code;
const toFloat = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const toPositiveFloat = (v) => { const n = toFloat(v); return n != null && n > 0 ? n : null; };
const round4 = (v) => (v == null ? null : Math.round(v * 1e4) / 1e4);

function normalizeSourceAsOf(value, fallback) {
  const raw = String(value ?? '').trim();
  if (!raw || raw === '-') return fallback;
  if (/^\d{14}$/.test(raw)) {
    return `${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}T${raw.slice(8,10)}:${raw.slice(10,12)}:${raw.slice(12,14)}+08:00`;
  }
  const numeric = toFloat(raw);
  if (numeric == null) return fallback;
  const ms = numeric < 1e12 ? numeric * 1000 : numeric;
  return new Date(ms).toISOString();
}

async function fetchText(url, timeoutMs = FETCH_TIMEOUT_MS, headers = null) {
  const res = await fetch(url, { headers: headers || { 'user-agent': UA, referer: 'https://quote.eastmoney.com/' }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res;
}

function parseTencentQuoteText(text, capturedAt) {
  const rows = {};
  const pattern = /v_([^=]+)="([^"]*)";?/g;
  let m;
  while ((m = pattern.exec(text)) !== null) {
    const fields = m[2].split('~');
    if (fields.length < 6) continue;
    const code = normalizeSymbol(fields[2] || m[1]);
    if (!code) continue;
    const price = toPositiveFloat(fields[3]);
    const prevClose = toPositiveFloat(fields[4]);
    let turnover = null;
    if (fields.length > 35) {
      const summary = String(fields[35] || '').split('/');
      if (summary.length > 2) turnover = toFloat(summary[2]);
    }
    if (turnover == null && fields.length > 37) {
      const fb = toFloat(fields[37]);
      turnover = fb != null ? fb * 10000 : null;
    }
    const statusFlag = fields.length > 40 ? String(fields[40]).trim() : '';
    rows[code] = {
      symbol: code, name: fields[1] || code,
      price: round4(price), previous_close: round4(prevClose),
      change: round4(fields.length > 31 ? toFloat(fields[31]) : null),
      change_percent: round4(fields.length > 32 ? toFloat(fields[32]) : null),
      open: round4(fields.length > 5 ? toPositiveFloat(fields[5]) : null),
      high: round4(fields.length > 33 ? toPositiveFloat(fields[33]) : null),
      low: round4(fields.length > 34 ? toPositiveFloat(fields[34]) : null),
      volume: fields.length > 6 ? toFloat(fields[6]) : null,
      turnover,
      turnover_rate: round4(fields.length > 38 ? toFloat(fields[38]) : null),
      suspended: statusFlag === 'S',
      source: 'tencent_batch', received_at: capturedAt,
      source_as_of: normalizeSourceAsOf(fields.length > 30 ? fields[30] : null, capturedAt),
    };
  }
  return rows;
}

async function fetchTencentQuotes(symbols) {
  const capturedAt = new Date().toISOString();
  const query = symbols.map(tencentSymbol).join(',');
  const res = await fetchText(`${TENCENT_QUOTE_URL}?q=${encodeURIComponent(query)}`);
  const buf = await res.arrayBuffer();
  let text;
  try { text = new TextDecoder('gbk').decode(buf); }
  catch { text = new TextDecoder().decode(buf); }
  return parseTencentQuoteText(text, capturedAt);
}

function parseEastmoneyListPayload(payload, capturedAt) {
  const rows = {};
  const diff = payload?.data?.diff || [];
  for (const item of diff) {
    const code = normalizeSymbol(item.f12);
    if (!code) continue;
    const price = toPositiveFloat(item.f2);
    const discount = toFloat(item.f402);
    const iopv = toPositiveFloat(item.f441);
    rows[code] = {
      symbol: code, name: String(item.f14 || code),
      price: round4(price), iopv: round4(iopv),
      vendor_discount_percent_raw: round4(discount),
      vendor_premium_percent: round4(discount != null ? -discount : null),
      source: 'eastmoney_push2delay', received_at: capturedAt,
      source_as_of: normalizeSourceAsOf(item.f124, capturedAt),
    };
  }
  return rows;
}

async function fetchTextRetry(url, timeoutMs = FETCH_TIMEOUT_MS, retries = 3, headers = null) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetchText(url, timeoutMs, headers);
    } catch (e) {
      lastErr = e;
      // retry on WAF/transient failures (502/503/network), not on 4xx
      const msg = String(e?.message || e);
      if (!/HTTP 50[23]|network|timeout|abort|fetch failed/i.test(msg)) throw e;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  throw lastErr;
}

async function fetchEastmoneyReferences(symbols) {
  // ulist.np by secid: single request, no pagination, most stable path
  // (clist is WAF-blocked for some egress IPs — skipped by design).
  // Eastmoney WAF is flaky from datacenter IPs: small batches + retries.
  const wanted = [...new Set(symbols.map(normalizeSymbol).filter(Boolean))];
  const found = {};
  const missing = [];
  const batchErrors = [];
  for (let i = 0; i < wanted.length; i += 10) {
    const batch = wanted.slice(i, i + 10);
    const params = new URLSearchParams({ secids: batch.map(eastmoneySecid).join(','), fields: EASTMONEY_FIELDS, fltt: '2', invt: '2' });
    const capturedAt = new Date().toISOString();
    try {
      const res = await fetchTextRetry(`${EASTMONEY_ULIST_URL}?${params}`);
      const payload = await res.json().catch(() => ({}));
      const rows = parseEastmoneyListPayload(payload, capturedAt);
      for (const code of batch) {
        if (rows[code]) found[code] = rows[code];
        else missing.push(code);
      }
    } catch (e) {
      batchErrors.push(`batch[${batch[0]}..${batch[batch.length - 1]}]: ${String(e?.message || e).slice(0, 120)}`);
      for (const code of batch) missing.push(code);
    }
  }
  return { found, missing, batchErrors };
}

// ---- fundmobapi (天天基金移动端): NAV + ZJL 折价率 ----
// push2 IOPV 被 WAF 拦时，用 NAV 做溢价兜底；同时补齐 latest_nav 字段（CN 对齐）。
function parseFundMobDate(value, fallback) {
  const raw = String(value ?? '').trim();
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+08:00`;
  return fallback;
}

function parseFundMobApiPayload(payload, capturedAt) {
  const rows = {};
  const datas = Array.isArray(payload?.Datas) ? payload.Datas : [];
  for (const item of datas) {
    const code = normalizeSymbol(item?.FCODE);
    if (!code) continue;
    const nav = toPositiveFloat(item?.NAV);
    const zjl = toFloat(item?.ZJL);
    rows[code] = {
      symbol: code, name: String(item?.SHORTNAME || code),
      latest_nav: nav,
      nav_timestamp: parseFundMobDate(item?.HQDATE, capturedAt),
      vendor_premium_percent: zjl != null ? round4(-zjl) : null,
      price_backup: round4(toPositiveFloat(item?.NEWPRICE)),
      source: 'eastmoney-fundmobapi', received_at: capturedAt,
    };
  }
  return rows;
}

async function fetchFundMobApi(symbols) {
  const codes = [...new Set(symbols.map(normalizeSymbol).filter(Boolean))];
  if (!codes.length) return {};
  const params = new URLSearchParams({
    pageIndex: '1', pageSize: '200',
    plat: 'Android', appType: 'ttjj', product: 'EFund', Version: '1',
    deviceid: 'ai-dca-market-collector', Fcodes: codes.join(','),
  });
  const capturedAt = new Date().toISOString();
  const headers = {
    'user-agent': FUNDMOB_UA,
    referer: 'https://fund.eastmoney.com/',
    accept: 'application/json, text/plain, */*',
  };
  const res = await fetchTextRetry(`${EASTMONEY_FUNDMOB_URL}?${params}`, FETCH_TIMEOUT_MS, 2, headers);
  const payload = await res.json().catch(() => null);
  if (!payload || payload.Success === false || !Array.isArray(payload.Datas)) {
    throw new Error('Eastmoney fundmobapi invalid response');
  }
  return parseFundMobApiPayload(payload, capturedAt);
}

// ---- last-good IOPV cache (from core.py: 东财整体失败时复用最近成功的 IOPV) ----
// Eastmoney WAF is flaky from datacenter IPs; when a fresh reference is missing,
// reuse the previous snapshot's IOPV (keeping its original timestamp) instead of
// degrading to "missing". Price is not cached (tencent is reliable).
function buildPreviousIopvMap(previousSnapshot) {
  const map = {};
  for (const s of previousSnapshot?.symbols || []) {
    const code = s?.symbol || s?.code;
    if (!code || s?.iopv == null || !(s.iopv > 0)) continue;
    map[code] = {
      symbol: code, name: s.name,
      iopv: s.iopv,
      vendor_premium_percent: s.vendor_premium_percent,
      vendor_discount_percent_raw: s.vendor_discount_percent_raw,
      source: s.sources?.iopv || null,
      received_at: s.iopv_received_at || null,
      source_as_of: s.iopv_timestamp || null,
    };
  }
  return map;
}

// ---- record building (from core.build_symbol_record) ----
function computePremium(price, iopv) {
  if (price == null || iopv == null || iopv <= 0) return null;
  return Math.round(((price - iopv) / iopv) * 100 * 1e4) / 1e4;
}
const symbolCategory = (s) => (s === '161128' || s === '161130' ? 'lof' : 'cross_border_etf');

function buildSymbolRecord(symbol, priceRow, iopvRow, navRow, collectedAt, session, ttlSec, iopvFromCache = false) {
  const price = priceRow?.price ?? navRow?.price_backup ?? null;
  const iopv = iopvRow?.iopv ?? null;
  const latestNav = navRow?.latest_nav ?? null;
  const navPremium = computePremium(price, latestNav);
  // vendor 溢价: push2 f402 优先，fundmobapi ZJL 兜底
  const vendorPremium = iopvRow?.vendor_premium_percent ?? navRow?.vendor_premium_percent ?? null;
  // 溢价链: 实时 IOPV -> NAV -> vendor 公布折溢价
  let computed = computePremium(price, iopv);
  let premiumSource = computed != null ? (iopvFromCache ? 'iopv_cache' : 'iopv') : null;
  let navFallback = false;
  if (computed == null && navPremium != null) {
    computed = navPremium;
    premiumSource = 'nav';
    navFallback = true;
  }
  if (computed == null && vendorPremium != null) {
    computed = vendorPremium;
    premiumSource = premiumSource || 'vendor';
  }
  const mismatchPp = computed != null && vendorPremium != null ? round4(Math.abs(computed - vendorPremium)) : null;
  const issues = [];
  if (price == null) issues.push('missing_price');
  if (iopv == null && latestNav == null) issues.push('missing_iopv');
  if (vendorPremium == null) issues.push('missing_vendor_premium');
  if (iopvFromCache) issues.push('iopv_from_cache');
  if (mismatchPp != null && mismatchPp > MISMATCH_TOLERANCE_PP) issues.push('premium_mismatch');
  const expiresAt = new Date(new Date(collectedAt).getTime() + ttlSec * 1000).toISOString();
  return {
    symbol, code: symbol,
    name: priceRow?.name || iopvRow?.name || navRow?.name || symbol,
    category: symbolCategory(symbol), session, collected_at: collectedAt,
    price_timestamp: priceRow?.source_as_of || priceRow?.received_at || null,
    iopv_timestamp: iopvRow?.source_as_of || iopvRow?.received_at || null,
    nav_timestamp: navRow?.nav_timestamp || null,
    price_received_at: priceRow?.received_at || null,
    iopv_received_at: iopvRow?.received_at || null,
    price, previous_close: priceRow?.previous_close ?? null,
    change: priceRow?.change ?? null, change_percent: priceRow?.change_percent ?? null,
    open: priceRow?.open ?? null, high: priceRow?.high ?? null, low: priceRow?.low ?? null,
    volume: priceRow?.volume ?? null, turnover: priceRow?.turnover ?? null,
    turnover_rate: priceRow?.turnover_rate ?? null,
    suspended: Boolean(priceRow?.suspended),
    iopv, latest_nav: latestNav, nav_premium_percent: navPremium,
    computed_premium_percent: computed, premium_source: premiumSource,
    vendor_premium_percent: vendorPremium,
    vendor_discount_percent_raw: iopvRow?.vendor_discount_percent_raw ?? null,
    mismatch_pp: mismatchPp, expires_at: expiresAt, ttl_sec: ttlSec,
    sources: {
      price: priceRow?.source || (navRow?.price_backup != null ? 'eastmoney-fundmobapi' : null),
      iopv: iopvRow?.source || null,
      nav: navRow?.source || null,
    },
    quality: { status: issues.length === 0 ? 'ok' : (issues.length < 3 ? 'degraded' : 'missing'), issues },
    debug: { eastmoney_page: 0, iopv_from_cache: iopvFromCache, nav_premium_fallback: navFallback },
    source: 'fund-collector',
  };
}

// test hooks (not part of the worker contract)
export { parseTencentQuoteText, parseEastmoneyListPayload, parseFundMobApiPayload, buildSymbolRecord, normalizeSymbol, normalizeSourceAsOf };

export async function collectOnce(symbols = SYMBOLS, previousSnapshot = null) {
  const collectedAt = new Date().toISOString();
  const session = classifySession(new Date());
  const ttlSec = TTL_SEC;
  const sourceErrors = {};
  let priceMap = {};
  try { priceMap = await fetchTencentQuotes(symbols); }
  catch (e) { sourceErrors.tencent_batch = String(e?.message || e); }
  let iopvMap = {}, eastmoneyMeta = { missing_symbols: [...symbols] };
  try {
    const { found, missing, batchErrors } = await fetchEastmoneyReferences(symbols);
    iopvMap = found;
    eastmoneyMeta = { missing_symbols: missing };
    if (batchErrors.length) {
      sourceErrors.eastmoney_push2delay_batches = batchErrors.join(' | ').slice(0, 500);
    }
  } catch (e) {
    sourceErrors.eastmoney_push2delay = String(e?.message || e);
  }
  let navMap = {};
  try { navMap = await fetchFundMobApi(symbols); }
  catch (e) { sourceErrors.fundmobapi = String(e?.message || e); }
  const prevIopv = buildPreviousIopvMap(previousSnapshot);
  const cachedSymbols = [];
  const records = symbols.map((s) => {
    const fresh = iopvMap[s] || null;
    const useCache = !fresh && !!prevIopv[s];
    if (useCache) cachedSymbols.push(s);
    return buildSymbolRecord(s, priceMap[s] || null, fresh || prevIopv[s] || null, navMap[s] || null, collectedAt, session, ttlSec, useCache);
  });
  const healthy = records.filter((r) => r.quality.status === 'ok').length;
  const latest = { kind: 'market-collector-shadow-latest', generated_at: collectedAt, session, symbols: records, source: 'fund-collector' };
  const health = {
    kind: 'market-collector-shadow-health', generated_at: collectedAt, session,
    healthy_symbols: healthy, degraded_symbols: records.length - healthy,
    source_errors: sourceErrors, eastmoney_pagination: eastmoneyMeta,
    iopv_cache_fallback_symbols: cachedSymbols,
  };
  return { latest, health };
}
