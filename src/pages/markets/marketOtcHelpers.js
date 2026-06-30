import { normalizeCnFundCode } from './marketDisplayUtils.js';

export function formatTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('zh-CN', { hour12: false });
}

export function formatBrowserTitleForQuote(quote, formatNumber, formatSymbolDisplay) {
  if (!quote || !quote.symbol) return '行情中心';
  const symbol = formatSymbolDisplay(quote.symbol);
  const price = Number(quote.price);
  const pct = Number(quote.changePercent);
  const currency = String(quote.currency || '').trim().toUpperCase();
  const priceText = Number.isFinite(price)
    ? `${currency && currency !== 'CNY' ? `${currency} ` : ''}${formatNumber(price, 2)}`
    : '--';
  const pctText = Number.isFinite(pct)
    ? `${pct < 0 ? '▼' : pct > 0 ? '▲' : ''} ${Math.abs(pct).toFixed(2)}%`
    : '--';
  return `${symbol} ${priceText} (${pctText})`;
}

export function resolveCnFundName(codeOrSymbol, fallback = '', catalog = {}) {
  const code = normalizeCnFundCode(codeOrSymbol);
  const fallbackText = String(fallback || '').trim();
  const isCodeOnlyFallback = fallbackText && normalizeCnFundCode(fallbackText) === code;
  return (code && catalog[code]?.name)
    || (!isCodeOnlyFallback ? fallbackText : '')
    || code
    || fallbackText;
}

export function buildOtcCandidate(code, fallback = {}, catalog = {}, resolveName = resolveCnFundName) {
  const normalizedCode = normalizeCnFundCode(code || fallback.code || fallback.symbol);
  const meta = catalog[normalizedCode] || {};
  const name = resolveName(normalizedCode, fallback.name || fallback.shortName || fallback.displayName, catalog);
  return {
    ...fallback,
    symbol: normalizedCode,
    code: normalizedCode,
    name,
    market: 'cn',
    exchange: '场外基金',
    assetType: 'otc_fund',
    linkedSymbol: meta.link_to || fallback.linkedSymbol || '',
    indexKey: meta.index_key || fallback.indexKey || ''
  };
}

export function normalizeSearchResults(rawRows, marketKey, query = '', buildCandidate = buildOtcCandidate, catalog = {}) {
  const seen = new Set();
  const rows = Array.isArray(rawRows) ? [...rawRows] : [];
  const otcCode = normalizeCnFundCode(query);
  if (marketKey === 'cn' && /^\d{6}$/.test(otcCode) && !rows.some((row) => {
    const rowCode = normalizeCnFundCode(row.symbol || row.code || row.ticker);
    const assetText = String(row.assetType || row.type || row.exchange || '').toLowerCase();
    return rowCode === otcCode && (assetText.includes('otc') || assetText.includes('场外'));
  })) {
    rows.push(buildCandidate(otcCode, {}, catalog));
  }
  return rows.map((row) => {
    const symbol = String(row && (row.symbol || row.code || row.ticker) || '').trim().toUpperCase();
    const assetText = String(row?.assetType || row?.type || row?.exchange || '').toLowerCase();
    const venueKey = assetText.includes('otc') || assetText.includes('场外')
      ? 'otc'
      : assetText.includes('exchange') || assetText.includes('场内') || assetText.includes('交易所')
        ? 'exchange'
        : 'default';
    const dedupeKey = `${symbol}:${venueKey}`;
    if (!symbol || seen.has(dedupeKey)) return null;
    seen.add(dedupeKey);
    return {
      ...row,
      symbol,
      market: marketKey,
      marketLabel: marketKey === 'cn' ? 'A股' : '美股',
    };
  }).filter(Boolean);
}

export function buildOtcFundQuoteFromSnapshot(symbol, snapshot, fallback = {}, resolveName = resolveCnFundName, catalog = {}) {
  const latestNav = Number(snapshot?.latestNav);
  if (!Number.isFinite(latestNav) || latestNav <= 0) return null;
  const previousNav = Number(snapshot?.previousNav);
  const hasPrevious = Number.isFinite(previousNav) && previousNav > 0;
  const change = hasPrevious ? latestNav - previousNav : 0;
  return {
    ...fallback,
    symbol: String(symbol || snapshot?.code || fallback.symbol || '').trim().toUpperCase(),
    code: String(snapshot?.code || symbol || fallback.code || '').replace(/\D/g, '').slice(-6),
    name: resolveName(snapshot?.code || symbol || fallback.code, snapshot?.name || fallback.name || fallback.displayName || fallback.shortName, catalog),
    market: 'cn',
    exchange: '场外基金',
    currency: 'CNY',
    price: latestNav,
    previousClose: hasPrevious ? previousNav : latestNav,
    change,
    changePercent: hasPrevious ? (change / previousNav) * 100 : 0,
    latestNav,
    latestNavDate: snapshot?.latestNavDate || '',
    previousNav: hasPrevious ? previousNav : null,
    previousNavDate: snapshot?.previousNavDate || '',
    asOf: snapshot?.updatedAt || new Date().toISOString(),
    lastUpdated: snapshot?.updatedAt || new Date().toISOString(),
    source: 'otc-fund-nav-fallback',
    valueType: 'nav',
    assetType: 'otc_fund',
    ytdReturn: snapshot?.ytdReturn ?? null,
    return1w: snapshot?.return1w ?? null,
    return1m: snapshot?.return1m ?? null,
    return3m: snapshot?.return3m ?? null,
    return6m: snapshot?.return6m ?? null,
    return1y: snapshot?.return1y ?? null,
    returnBase: snapshot?.returnBase ?? null,
  };
}
