export const PORTAL_QUOTE_CACHE_TTL_MS = 30_000;

function aliasesFor(symbol, quote = {}) {
  return new Set([
    symbol,
    quote.symbol,
    quote.code,
    quote.shortCode,
    quote.ticker,
  ].map((value) => String(value || '').trim()).filter(Boolean));
}

function isCacheableQuote(quote) {
  return Boolean(quote && typeof quote === 'object' && !quote.error);
}

export function createPortalQuoteCache({ ttlMs = PORTAL_QUOTE_CACHE_TTL_MS, now = () => Date.now() } = {}) {
  const entries = new Map();

  function setMany(quotes = {}) {
    const expiresAt = now() + ttlMs;
    Object.entries(quotes || {}).forEach(([symbol, quote]) => {
      if (!isCacheableQuote(quote)) return;
      aliasesFor(symbol, quote).forEach((alias) => entries.set(alias, { quote, expiresAt }));
    });
  }

  function get(symbol, { source = '' } = {}) {
    const key = String(symbol || '').trim();
    if (!key) return null;
    const entry = entries.get(key);
    if (!entry || entry.expiresAt <= now()) {
      if (entry) entries.delete(key);
      return null;
    }
    if (source && String(entry.quote.source || '').trim() !== String(source).trim()) return null;
    return entry.quote;
  }

  return {
    get,
    setMany,
    clear: () => entries.clear(),
    get size() { return entries.size; },
  };
}
