import { attachCnExchangeHighPoint } from './cnKlineHighQuote.js';
import { attachUsHighPoint, hasUsHighPoint } from './usKlineHighQuote.js';

export function attachMarketQuoteHighPoint(env, quote, { market = '', symbol = '', hydrateFromR2 = false } = {}) {
  if (market === 'cn') return attachCnExchangeHighPoint(env, quote, symbol, { hydrateFromR2 });
  if (market === 'us') return attachUsHighPoint(env, quote, symbol);
  return quote;
}

export function hasMarketQuoteHighPoint(quote, market = '') {
  return market !== 'us' || hasUsHighPoint(quote);
}
