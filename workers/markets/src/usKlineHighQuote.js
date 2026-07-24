import { CACHE_STATUS } from './cachePolicy.js';
import { readKlineMetaCache } from './klineMetaCache.js';
import { classifySymbol } from './symbols.js';

function positiveNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return 0;
}

function normalizeUsSymbol(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return classifySymbol(raw).code;
}

function buildYahooHighPoint(quote = {}) {
  const high = positiveNumber(
    quote.highPoint?.high,
    quote.yearHigh,
    quote.high52w,
    quote.fiftyTwoWeekHigh
  );
  if (!(high > 0)) return null;
  return quote.highPoint?.high > 0
    ? quote.highPoint
    : {
        high,
        highDate: String(quote.high52wDate || quote.yearHighDate || '').trim(),
        source: 'yahoo-52w'
      };
}

function applyHighPoint(quote, highPoint) {
  if (!highPoint) return quote;
  return {
    ...quote,
    highPoint,
    yearHigh: highPoint.high,
    yearHighDate: highPoint.highDate,
    highDate: highPoint.highDate,
    highSource: highPoint.source
  };
}

export function hasUsHighPoint(quote) {
  return Boolean(buildYahooHighPoint(quote));
}

/**
 * Attach the small US daily-high metadata object to a quote.
 * The list endpoint may read KV metadata, but must never scan R2 K-lines.
 */
export async function attachUsHighPoint(env, quote, fallbackSymbol = '') {
  if (!quote || quote.error) return quote;

  const existing = buildYahooHighPoint(quote);
  const candidates = Array.from(new Set([
    normalizeUsSymbol(quote.symbol),
    normalizeUsSymbol(fallbackSymbol)
  ].filter(Boolean)));

  for (const symbol of candidates) {
    const meta = await readKlineMetaCache(env, {
      market: 'us',
      symbol,
      interval: '1d',
      allowStale: true
    }).catch(() => null);
    if (meta?.status !== CACHE_STATUS.MISS && meta.payload?.highPoint) {
      return applyHighPoint(quote, meta.payload.highPoint);
    }
  }

  return applyHighPoint(quote, existing);
}
