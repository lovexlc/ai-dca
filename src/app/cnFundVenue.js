export const CN_UNAMBIGUOUS_EXCHANGE_FUND_PREFIXES = Object.freeze(['15', '50', '51', '52', '53', '54', '56', '58']);
const CN_EXCHANGE_FUND_PREFIXES = new Set(CN_UNAMBIGUOUS_EXCHANGE_FUND_PREFIXES);

function normalizeCnFundCode(value = '') {
  const raw = String(value || '').trim();
  const prefixed = /^(sh|sz|bj|jj)(\d{6})$/i.exec(raw);
  if (prefixed) return prefixed[2];
  const match = raw.match(/(\d{6})/);
  return match ? match[1] : '';
}

/**
 * Resolve CN fund venue from a row. Prefixes cover unambiguous ETF codes;
 * 16xxxx consumes venue context when available because a code can represent
 * both LOF and OTC. Empty context keeps the exchange-only legacy fallback.
 */
export function isCnExchangeFundRow(row = {}) {
  const digits = normalizeCnFundCode(row?.code || row?.symbol);
  if (!/^\d{6}$/.test(digits)) return false;
  if (CN_EXCHANGE_FUND_PREFIXES.has(digits.slice(0, 2))) return true;
  if (digits.slice(0, 2) !== '16') return false;
  const kind = String(row?.fundVenue || row?.fundKind || row?.kind || row?.assetType || '').trim().toLowerCase();
  return !['otc', 'qdii', '场外'].includes(kind);
}

export function isCnUnambiguousExchangeFundCode(value = '') {
  const digits = normalizeCnFundCode(value);
  return /^\d{6}$/.test(digits) && CN_EXCHANGE_FUND_PREFIXES.has(digits.slice(0, 2));
}
