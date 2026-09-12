const TENCENT_QUOTE_URL = 'https://qt.gtimg.cn/';
const EASTMONEY_ULIST_URL = 'https://push2delay.eastmoney.com/api/qt/ulist.np/get';
const EASTMONEY_FIELDS = 'f12,f14,f2,f3,f124,f402,f441';
const MAX_QUOTE_AGE_MS = 120_000;

function text(value = '', max = 1000) { return String(value ?? '').trim().slice(0, max); }
function number(value) { const result = Number(value); return Number.isFinite(result) ? result : null; }
function round4(value) { return Number.isFinite(value) ? Number(value.toFixed(4)) : null; }
function normalizeCode(value = '') { const code = text(value, 12).replace(/^(?:sh|sz|bj)/i, ''); return /^\d{6}$/.test(code) ? code : ''; }
function tencentSymbol(code) { return `${code.startsWith('5') || code.startsWith('6') ? 'sh' : 'sz'}${code}`; }
function eastmoneySecid(code) { return `${code.startsWith('5') || code.startsWith('6') ? '1' : '0'}.${code}`; }
function timestamp(value) { const parsed = Date.parse(text(value, 80)); return Number.isFinite(parsed) ? parsed : 0; }
function shanghaiTimestamp(value = '') {
  const raw = text(value, 20);
  const match = raw.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (!match) return '';
  const [, year, month, day, hour, minute, second] = match;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}+08:00`;
}
function eastmoneyTimestamp(value) {
  const raw = number(value);
  if (!Number.isFinite(raw) || raw <= 0) return '';
  return new Date((raw < 1e12 ? raw * 1000 : raw)).toISOString();
}
function decodeTencent(buffer) {
  try { return new TextDecoder('gbk').decode(buffer); } catch { return new TextDecoder().decode(buffer); }
}
async function fetchTencentQuotes(codes) {
  const query = codes.map(tencentSymbol).join(',');
  const response = await fetch(`${TENCENT_QUOTE_URL}?q=${encodeURIComponent(query)}`, {
    headers: { accept: 'text/plain,*/*', referer: 'https://gu.qq.com/' },
    signal: AbortSignal.timeout(8_000)
  });
  if (!response.ok) throw new Error(`Tencent quote failed: HTTP ${response.status}`);
  const payload = decodeTencent(await response.arrayBuffer());
  const rows = {};
  const pattern = /v_([^=]+)="([^"]*)";?/g;
  let match;
  while ((match = pattern.exec(payload))) {
    const fields = String(match[2] || '').split('~');
    if (fields.length < 6) continue;
    const code = normalizeCode(fields[2] || match[1]);
    if (!code) continue;
    rows[code] = {
      code,
      name: text(fields[1] || code, 80),
      price: number(fields[3]),
      asOf: shanghaiTimestamp(fields[30]),
      suspended: text(fields[40], 4).toUpperCase() === 'S'
    };
  }
  return rows;
}
async function fetchEastmoneyReferences(codes) {
  const params = new URLSearchParams({
    secids: codes.map(eastmoneySecid).join(','),
    fields: EASTMONEY_FIELDS,
    fltt: '2',
    invt: '2'
  });
  const response = await fetch(`${EASTMONEY_ULIST_URL}?${params.toString()}`, {
    headers: { accept: 'application/json', referer: 'https://quote.eastmoney.com/' },
    signal: AbortSignal.timeout(8_000)
  });
  if (!response.ok) throw new Error(`Eastmoney reference failed: HTTP ${response.status}`);
  const payload = await response.json().catch(() => ({}));
  const diff = payload?.data?.diff;
  const items = Array.isArray(diff) ? diff : diff && typeof diff === 'object' ? Object.values(diff) : [];
  const rows = {};
  for (const item of items) {
    const code = normalizeCode(item?.f12);
    if (!code) continue;
    const vendorDiscountPct = number(item?.f402);
    rows[code] = {
      code,
      name: text(item?.f14 || code, 80),
      iopv: number(item?.f441),
      vendorPremiumPct: Number.isFinite(vendorDiscountPct) ? -vendorDiscountPct : null,
      asOf: eastmoneyTimestamp(item?.f124)
    };
  }
  return rows;
}
function normalizeItem(code, quote, reference, now) {
  const price = number(quote?.price);
  const iopv = number(reference?.iopv);
  const vendorPremiumPct = number(reference?.vendorPremiumPct);
  const computedPremiumPct = price > 0 && iopv > 0 ? ((price - iopv) / iopv) * 100 : null;
  const premiumPct = Number.isFinite(computedPremiumPct) ? computedPremiumPct : vendorPremiumPct;
  const premiumSource = Number.isFinite(computedPremiumPct) ? 'eastmoney-iopv' : Number.isFinite(vendorPremiumPct) ? 'eastmoney-vendor-premium' : 'unavailable';
  const priceAsOf = text(quote?.asOf, 80);
  const referenceAsOf = text(reference?.asOf, 80);
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
    premiumPct: round4(premiumPct),
    premiumSource,
    asOf: priceAsOf || referenceAsOf,
    priceAsOf,
    referenceAsOf,
    expiresAt: '',
    source: `tencent+${premiumSource}`,
    orderBook: null,
    valid: issues.length === 0,
    invalidReasons: issues
  };
}
export async function fetchSwitchCollectorSnapshot(_env, codes = []) {
  const requested = Array.from(new Set((codes || []).map(normalizeCode).filter(Boolean))).slice(0, 30);
  if (!requested.length) return { generatedAt: '', funds: {}, source: 'tencent+eastmoney', successCount: 0, failureCount: 0 };
  const [quotes, references] = await Promise.all([
    fetchTencentQuotes(requested),
    fetchEastmoneyReferences(requested)
  ]);
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
