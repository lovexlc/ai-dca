import { json, errorJson, mapLimit } from './marketRuntime.js';
import { searchEastmoneySymbols } from './fetchers.js';
import { OTC_ALL_FUNDS, OTC_FUND_NAME_BY_CODE } from './otcFundList.js';
import {
  CACHE_TTL,
  isKvCacheEnabled,
  kvCacheGetJson,
  kvCacheSetJson,
  shouldFetchLiveOnMiss
} from './kvCache.js';

const EXCHANGE_PREFIXES = new Set(['15', '50', '51', '52', '54', '56', '58']);
const FUND_VENUE_CACHE_TTL_SECONDS = 30 * 24 * 3600;

function normalizeCode(value = '') {
  const digits = String(value || '').replace(/^(sh|sz|bj|jj)/i, '').replace(/\D/g, '');
  return /^\d{6}$/.test(digits) ? digits : '';
}

function normalizeVenue(value = '') {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'exchange' || raw.includes('场内') || raw.includes('交易所')) return 'exchange';
  if (raw === 'otc' || raw.includes('场外')) return 'otc';
  return '';
}

function inferCategory({ name = '', type = '', assetType = '', fundCategory = '' } = {}) {
  const text = [name, type, assetType, fundCategory].map((value) => String(value || '')).join(' ').toLowerCase();
  if (text.includes('qdii')) return 'qdii';
  if (text.includes('国内') || text.includes('境内')) return 'domestic';
  return 'unknown';
}

function kindForVenue(venue, category) {
  if (venue === 'exchange') return 'exchange';
  if (venue === 'otc' && category === 'qdii') return 'qdii';
  if (venue === 'otc') return 'otc';
  return '';
}

function candidateFromSearchRow(row = {}, code = '') {
  const normalizedCode = normalizeCode(row.code || row.symbol || code);
  if (!normalizedCode || normalizedCode !== code) return null;
  const assetType = String(row.assetType || '').trim().toLowerCase();
  const venue = assetType === 'exchange_fund'
    ? 'exchange'
    : assetType === 'otc_fund'
      ? 'otc'
      : normalizeVenue(row.fundVenue || row.exchange);
  if (!venue) return null;
  const name = String(row.name || '').trim();
  const type = String(row.type || '').trim();
  const fundCategory = inferCategory({ name, type, assetType });
  return {
    code,
    symbol: String(row.symbol || code).trim(),
    name,
    type,
    exchange: String(row.exchange || '').trim(),
    assetType: assetType || (venue === 'exchange' ? 'exchange_fund' : 'otc_fund'),
    fundVenue: venue,
    fundCategory,
    fundKind: kindForVenue(venue, fundCategory),
    source: 'eastmoney-search',
    confidence: 'upstream'
  };
}

function catalogCandidate(code) {
  if (!OTC_ALL_FUNDS.includes(code)) return null;
  return {
    code,
    symbol: code,
    name: OTC_FUND_NAME_BY_CODE[code] || code,
    type: 'OTC QDII catalog',
    exchange: '场外基金',
    assetType: 'otc_fund',
    fundVenue: 'otc',
    fundCategory: 'qdii',
    fundKind: 'qdii',
    source: 'otc-catalog',
    confidence: 'catalog'
  };
}

function prefixCandidate(code) {
  if (!EXCHANGE_PREFIXES.has(code.slice(0, 2))) return null;
  return {
    code,
    symbol: code,
    name: code,
    type: 'exchange fund prefix fallback',
    exchange: '交易所基金',
    assetType: 'exchange_fund',
    fundVenue: 'exchange',
    fundCategory: 'unknown',
    fundKind: 'exchange',
    source: 'code-prefix-fallback',
    confidence: 'fallback'
  };
}

function dedupeCandidates(candidates = []) {
  const byVenue = new Map();
  for (const candidate of candidates) {
    if (!candidate?.fundVenue || byVenue.has(candidate.fundVenue)) continue;
    byVenue.set(candidate.fundVenue, candidate);
  }
  return Array.from(byVenue.values());
}

function buildVenueItem(code, candidates = [], error = '') {
  const unique = dedupeCandidates(candidates);
  const ambiguous = unique.length > 1;
  const selected = unique.length === 1 ? unique[0] : null;
  const category = unique.some((item) => item.fundCategory === 'qdii') ? 'qdii' : unique.length ? 'unknown' : '';
  return {
    code,
    name: selected?.name || unique.find((item) => item.name)?.name || OTC_FUND_NAME_BY_CODE[code] || code,
    fundVenue: selected?.fundVenue || '',
    fundCategory: category || selected?.fundCategory || 'unknown',
    fundKind: selected?.fundKind || '',
    assetType: selected?.assetType || '',
    ambiguous,
    candidates: unique,
    source: unique.map((item) => item.source).filter(Boolean).join('+'),
    confidence: selected?.confidence || (ambiguous ? 'ambiguous' : 'unknown'),
    error: String(error || '').trim()
  };
}

async function classifyOne(env, code) {
  const cacheKey = `fund-venue:${code}`;
  const cached = await kvCacheGetJson(env, cacheKey);
  if (cached?.code === code && (cached.fundVenue || cached.ambiguous || cached.candidates?.length)) {
    return { ...cached, cache: 'kv' };
  }

  const fallbackCandidates = [catalogCandidate(code), prefixCandidate(code)].filter(Boolean);
  let upstreamCandidates = [];
  let upstreamError = '';
  if (!isKvCacheEnabled(env) || shouldFetchLiveOnMiss(env)) {
    try {
      const rows = await searchEastmoneySymbols(code, { limit: 12 });
      upstreamCandidates = rows.map((row) => candidateFromSearchRow(row, code)).filter(Boolean);
    } catch (error) {
      upstreamError = error?.message || String(error);
    }
  } else {
    upstreamError = 'kv cache miss';
  }

  const item = buildVenueItem(code, [...upstreamCandidates, ...fallbackCandidates], upstreamError);
  if (item.candidates.length || item.ambiguous) {
    await kvCacheSetJson(env, cacheKey, item, { ttlSeconds: FUND_VENUE_CACHE_TTL_SECONDS }).catch(() => false);
  }
  return { ...item, cache: 'live' };
}

export async function handleFundVenue(env, body = {}) {
  const rawCodes = Array.isArray(body?.codes) ? body.codes : [];
  const codes = Array.from(new Set(rawCodes.map(normalizeCode).filter(Boolean))).slice(0, 60);
  if (!codes.length) return errorJson('missing valid cn fund codes', 400);
  const items = await mapLimit(codes, 5, (code) => classifyOne(env, code));
  return json({
    items,
    successCount: items.filter((item) => item.candidates?.length || item.ambiguous).length,
    failureCount: items.filter((item) => !item.candidates?.length && !item.ambiguous).length,
    generatedAt: new Date().toISOString(),
    cache: { source: 'kv+search', codeCount: codes.length },
    searchCacheTtl: CACHE_TTL.search
  });
}

export const __internals = {
  buildVenueItem,
  candidateFromSearchRow,
  catalogCandidate,
  prefixCandidate,
  normalizeCode
};
