export const FUND_VENUES = Object.freeze(['exchange', 'otc']);
export const FUND_CATEGORIES = Object.freeze(['domestic', 'qdii', 'unknown']);
export const FUND_KINDS = Object.freeze(['exchange', 'otc', 'qdii']);

function normalizeCode(value = '') {
  const digits = String(value || '').replace(/^(sh|sz|bj|jj)/i, '').replace(/\D/g, '');
  return /^\d{6}$/.test(digits) ? digits : '';
}

function normalizeVenue(value = '') {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'exchange' || raw === 'otc') return raw;
  if (raw.includes('场内') || raw.includes('交易所')) return 'exchange';
  if (raw.includes('场外') || raw.includes('otc')) return 'otc';
  return '';
}

function normalizeCategory(value = '') {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'qdii' || raw.includes('qdii')) return 'qdii';
  if (raw === 'domestic' || raw === '境内' || raw === '国内') return 'domestic';
  return 'unknown';
}

function normalizeKind(value = '') {
  const raw = String(value || '').trim().toLowerCase();
  return FUND_KINDS.includes(raw) ? raw : '';
}

export function normalizeFundVenueItem(item = {}) {
  const code = normalizeCode(item?.code || item?.symbol);
  const fundVenue = normalizeVenue(item?.fundVenue || item?.venue || item?.exchange);
  const fundCategory = normalizeCategory(item?.fundCategory || item?.category || item?.type);
  const fundKind = normalizeKind(item?.fundKind || item?.kind);
  const candidates = (Array.isArray(item?.candidates) ? item.candidates : [])
    .map((candidate) => normalizeFundVenueItem(candidate))
    .filter((candidate) => candidate.code || candidate.fundVenue);
  return {
    ...item,
    code,
    name: String(item?.name || '').trim(),
    fundVenue,
    fundCategory,
    fundKind,
    ambiguous: item?.ambiguous === true || candidates.length > 1,
    candidates,
    source: String(item?.source || '').trim(),
    confidence: String(item?.confidence || '').trim(),
    error: String(item?.error || '').trim()
  };
}

export function resolveFundKindFromVenue(item = {}, fallback = '') {
  const normalized = normalizeFundVenueItem(item);
  const fallbackKind = normalizeKind(fallback);
  if (normalized.ambiguous) return fallbackKind;
  if (normalized.fundKind) return normalized.fundKind;
  if (normalized.fundVenue === 'exchange') return 'exchange';
  if (normalized.fundVenue === 'otc') {
    return normalized.fundCategory === 'qdii' ? 'qdii' : 'otc';
  }
  return fallbackKind;
}

export function normalizeFundVenueCodes(codes = []) {
  const list = Array.isArray(codes) ? codes : [codes];
  return Array.from(new Set(list.map(normalizeCode).filter(Boolean)));
}
