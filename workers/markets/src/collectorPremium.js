// Eastmoney premium chain shared with the market-collector contract.
const PUSH2_URL = 'https://push2delay.eastmoney.com/api/qt/ulist.np/get';
const NAV_URL = 'https://fundmobapi.eastmoney.com/FundMNewApi/FundMNFInfo';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 10; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const normalizeCode = (value) => String(value || '').trim().replace(/^(sh|sz|bj)/i, '');
const number = (value) => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const positive = (value) => { const n = number(value); return n > 0 ? n : null; };
const round4 = (value) => value == null ? null : Math.round(value * 1e4) / 1e4;
const computePremium = (price, base) => price != null && base > 0 ? round4(((price - base) / base) * 100) : null;

async function fetchJson(url, mobile = false, retries = 0) {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(url, {
      headers: { 'user-agent': mobile ? MOBILE_UA : UA, referer: mobile ? 'https://fund.eastmoney.com/' : 'https://quote.eastmoney.com/' },
      signal: AbortSignal.timeout(10_000)
    });
    if ((response.status === 502 || response.status === 503) && attempt < retries) {
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
      continue;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  }
}

async function fetchIopv(codes) {
  const rows = {};
  // Sequential small batches bound concurrency and isolate partial failures.
  for (let index = 0; index < codes.length; index += 10) {
    const batch = codes.slice(index, index + 10);
    const params = new URLSearchParams({ secids: batch.map((code) => (/^[56]/.test(code) ? '1.' : '0.') + code).join(','), fields: 'f12,f14,f2,f441,f402', fltt: '2', invt: '2' });
    try {
      const payload = await fetchJson(`${PUSH2_URL}?${params}`, false, 3);
      for (const item of Array.isArray(payload?.data?.diff) ? payload.data.diff : []) {
        const code = normalizeCode(item?.f12);
        if (batch.includes(code)) rows[code] = { iopv: round4(positive(item.f441)), vendor: round4(number(item.f402) == null ? null : -number(item.f402)) };
      }
    } catch { /* Keep other batches and the NAV fallback available. */ }
  }
  return rows;
}

async function fetchNav(codes) {
  const params = new URLSearchParams({ pageIndex: '1', pageSize: String(Math.max(200, codes.length)), plat: 'Android', appType: 'ttjj', product: 'EFund', Version: '1', deviceid: 'ai-dca-markets', Fcodes: codes.join(',') });
  try {
    const payload = await fetchJson(`${NAV_URL}?${params}`, true);
    const rows = {};
    for (const item of Array.isArray(payload?.Datas) ? payload.Datas : []) {
      const code = normalizeCode(item?.FCODE);
      if (codes.includes(code)) rows[code] = { latestNav: positive(item.NAV), latestNavDate: String(item.HQDATE || '').trim(), vendor: round4(number(item.ZJL) == null ? null : -number(item.ZJL)) };
    }
    return rows;
  } catch { return {}; }
}

export async function fetchCollectorPremiumBatch(items = []) {
  const codes = [...new Set(items.map((item) => normalizeCode(item.code)).filter((code) => /^\d{6}$/.test(code)))];
  if (!codes.length) return {};
  const [iopvRows, navRows] = await Promise.all([fetchIopv(codes), fetchNav(codes)]);
  const out = {};
  for (const item of items) {
    const code = normalizeCode(item.code);
    const iopv = iopvRows[code]?.iopv ?? null;
    const latestNav = navRows[code]?.latestNav ?? null;
    const vendorPremiumPercent = iopvRows[code]?.vendor ?? navRows[code]?.vendor ?? null;
    const price = positive(item.price);
    const iopvPremium = computePremium(price, iopv);
    const navPremium = computePremium(price, latestNav);
    out[code] = {
      premiumPercent: iopvPremium ?? navPremium ?? vendorPremiumPercent,
      iopv, latestNav, latestNavDate: navRows[code]?.latestNavDate || '', vendorPremiumPercent,
      premiumSource: iopvPremium != null ? 'iopv' : navPremium != null ? 'nav' : vendorPremiumPercent != null ? 'vendor' : null
    };
  }
  return out;
}
