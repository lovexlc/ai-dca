import { MARKET_EMPTY_VALUE, normalizeCnFundCode } from './marketDisplayUtils.js';
import { formatShanghaiDateTime } from '../../app/timeZone.js';

export function formatTime(value) {
  if (!value) return '';
  return formatShanghaiDateTime(value);
}

export function formatBrowserTitleForQuote(quote, formatNumber, formatSymbolDisplay) {
  if (!quote || !quote.symbol) return '行情中心';
  const symbol = formatSymbolDisplay(quote.symbol);
  const price = Number(quote.price);
  const pct = Number(quote.changePercent);
  const currency = String(quote.currency || '').trim().toUpperCase();
  const priceText = Number.isFinite(price)
    ? `${currency && currency !== 'CNY' ? `${currency} ` : ''}${formatNumber(price, 2)}`
    : MARKET_EMPTY_VALUE;
  const pctText = Number.isFinite(pct)
    ? `${pct < 0 ? '▼' : pct > 0 ? '▲' : ''} ${Math.abs(pct).toFixed(2)}%`
    : MARKET_EMPTY_VALUE;
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
    fundKind: 'otc',
    kind: 'otc',
    assetType: 'otc_fund',
    linkedSymbol: meta.link_to || fallback.linkedSymbol || '',
    indexKey: meta.index_key || fallback.indexKey || ''
  };
}

function inferFundVenue(row = {}) {
  const rawSymbol = String(row.symbol || row.code || row.ticker || '').trim().toLowerCase();
  if (/^jj\d{6}$/.test(rawSymbol) || String(row.fundKind || '').toLowerCase() === 'otc') return 'otc';
  if (/^(sh|sz|bj)\d{6}$/.test(rawSymbol) || String(row.fundKind || '').toLowerCase() === 'exchange') return 'exchange';
  const text = String(row.assetType || row.type || row.exchange || '').toLowerCase();
  if (text.includes('otc') || text.includes('场外')) return 'otc';
  if (text.includes('exchange') || text.includes('场内') || text.includes('交易所')) return 'exchange';
  const name = String(row.name || row.shortName || row.displayName || '');
  if (/(etf联接|指数联接|联接基金)/i.test(name)) return 'otc';
  if (/ETF/i.test(name) && !/联接/i.test(name)) return 'exchange';
  return '';
}

function compareCandidatePriority(row = {}) {
  const rawSymbol = String(row.symbol || row.code || row.ticker || '').trim().toLowerCase();
  const venue = inferFundVenue(row);
  if (/^(sh|ss|sz|bj)\d{6}$/.test(rawSymbol)) return 3;
  if (venue === 'exchange') return 2;
  if (venue === 'otc') return 0;
  return 1;
}

export function dedupeCompareCandidates(rawRows, marketKey, currentSymbol = '') {
  const isCn = String(marketKey || '').trim().toLowerCase() === 'cn';
  const currentRaw = String(currentSymbol || '').trim().toUpperCase();
  const currentKey = isCn ? (normalizeCnFundCode(currentRaw) || currentRaw) : currentRaw;
  const byKey = new Map();

  for (const row of Array.isArray(rawRows) ? rawRows : []) {
    const symbol = String(row?.symbol || row?.code || row?.ticker || '').trim().toUpperCase();
    const key = isCn ? (normalizeCnFundCode(symbol) || symbol) : symbol;
    if (!symbol || !key || key === currentKey) continue;
    const normalized = {
      ...row,
      symbol,
      name: row?.name || row?.shortName || row?.displayName || symbol,
      market: row?.market || marketKey
    };
    const existing = byKey.get(key);
    if (!existing || compareCandidatePriority(normalized) > compareCandidatePriority(existing)) {
      byKey.set(key, normalized);
    }
  }

  return Array.from(byKey.values());
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
    const rawSymbol = String(row?.symbol || row?.code || row?.ticker || '').trim();
    const symbol = /^jj[0-9]{6}$/i.test(rawSymbol) ? normalizeCnFundCode(rawSymbol) : rawSymbol.toUpperCase();
    const venueKey = inferFundVenue(row) || 'default';
    const dedupeKey = symbol + ':' + venueKey;
    if (!symbol || seen.has(dedupeKey)) return null;
    seen.add(dedupeKey);
    return {
      ...row,
      symbol,
      market: marketKey,
      marketLabel: marketKey === 'cn' ? 'A股' : '美股',
      ...(venueKey === 'otc' ? { fundKind: 'otc', fundVenue: 'otc', assetType: 'otc_fund', exchange: '场外基金' } : {}),
      ...(venueKey === 'exchange' ? { fundKind: 'exchange', fundVenue: 'exchange', assetType: 'exchange_fund' } : {}),
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
    fundKind: 'otc',
    kind: 'otc',
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
