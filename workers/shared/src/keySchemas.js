/**
 * Cross-worker cache key schema.
 *
 * Keep keys that are read or written by more than one Worker here. Keys that
 * belong to one Worker only should stay next to that Worker's storage code so
 * this module remains a small, dependency-free boundary.
 */

function text(value) {
  return String(value ?? '').trim();
}

export function canonicalQuoteCode(code = '') {
  const value = text(code);
  return /^(?:sh|sz|bj)\d{6}$/i.test(value) ? value.slice(2) : value;
}

/** The canonical key shared by batch and single quote cache paths. */
export function quoteKey(code = '') {
  return `quote:${canonicalQuoteCode(code)}`;
}

export function navHistoryKey(code = '', month = '') {
  return `navhist:v1:${text(code).replace(/^(?:sh|sz|bj)/i, '')}:${text(month)}`;
}

export function fundLimitKey(code = '') {
  return `limit:${text(code)}`;
}
