/**
 * Frontend boundary for the markets Worker quote payload.
 *
 * Unknown fields are intentionally retained: list/detail features can add
 * display-only metadata without making this normalizer a second API schema.
 */
function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function text(value, fallback = '') {
  const result = String(value ?? '').trim();
  return result || fallback;
}

function timestamp(value, fallback = Date.now()) {
  const numeric = finiteOrNull(value);
  if (numeric !== null) return numeric;
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeQuote(raw, fallbackCode = '', { now = Date.now() } = {}) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const price = finiteOrNull(source.price ?? source.currentPrice ?? source.close ?? source.latestNav);
  const changePct = finiteOrNull(source.changePct ?? source.changePercent ?? source.change_percent);
  return {
    ...source,
    code: text(source.code ?? source.symbol, text(fallbackCode)),
    price,
    changePct,
    ts: timestamp(source.ts ?? source.timestamp ?? source.asOf ?? source.updatedAt, now),
    source: text(source.source, 'unknown')
  };
}

export function normalizeQuoteList(rawList, options = {}) {
  return (Array.isArray(rawList) ? rawList : []).map((item) => normalizeQuote(item, '', options));
}

export function normalizeQuotesPayload(rawPayload, options = {}) {
  const payload = rawPayload && typeof rawPayload === 'object' && !Array.isArray(rawPayload)
    ? rawPayload
    : {};
  const rawQuotes = payload.quotes;
  const quotes = {};
  if (Array.isArray(rawQuotes)) {
    for (const item of rawQuotes) {
      const normalized = normalizeQuote(item, '', options);
      if (normalized.code) quotes[normalized.code] = normalized;
    }
  } else if (rawQuotes && typeof rawQuotes === 'object') {
    for (const [key, item] of Object.entries(rawQuotes)) {
      const normalized = normalizeQuote(item, key, options);
      if (normalized.code) quotes[key] = normalized;
    }
  }
  return { ...payload, quotes };
}
