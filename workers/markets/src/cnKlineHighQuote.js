import { resolveKlineHighPointCache } from './klineHighPointCache.js';
import { classifySymbol } from './symbols.js';

const CN_EXCHANGE_FUND_PREFIXES = new Set(['15', '16', '50', '51', '52', '53', '54', '56', '58']);

function normalizeCnDigits(value = '') {
  const digits = String(value || '').replace(/^(sh|sz|bj)/i, '').replace(/\D/g, '');
  return digits.length === 6 ? digits : '';
}

function isCnExchangeFundCode(value = '') {
  const digits = normalizeCnDigits(value);
  return Boolean(digits && CN_EXCHANGE_FUND_PREFIXES.has(digits.slice(0, 2)));
}

function normalizeCnKlineSymbol(value = '') {
  const raw = String(value || '').trim();
  if (/^(sh|sz|bj)\d{6}$/i.test(raw)) return raw.toLowerCase();
  const digits = normalizeCnDigits(raw);
  return digits ? classifySymbol(digits).code : '';
}

function cnKlineSymbolCandidates(quote = {}, fallback = '') {
  const values = [fallback, quote.symbol, quote.code].filter(Boolean);
  return Array.from(new Set([
    ...values.map(normalizeCnKlineSymbol).filter(Boolean),
    ...values.map(normalizeCnDigits).filter(Boolean)
  ]));
}

export async function attachCnExchangeHighPoint(env, quote, fallbackSymbol = '', { hydrateFromR2 = false } = {}) {
  if (!quote || quote.error) return quote;
  const existingHigh = Number(quote.highPoint?.high ?? quote.highPoint?.yearHigh ?? quote.highPoint?.price);
  if (Number.isFinite(existingHigh) && existingHigh > 0) return quote;
  const existingYearHigh = Number(quote.yearHigh);
  if (Number.isFinite(existingYearHigh) && existingYearHigh > 0 && /kline|daily/i.test(String(quote.highSource || ''))) return quote;
  const digits = normalizeCnDigits(quote?.code || quote?.symbol || fallbackSymbol);
  if (!isCnExchangeFundCode(digits)) return quote;
  for (const candidate of cnKlineSymbolCandidates(quote, fallbackSymbol)) {
    const highPoint = await resolveKlineHighPointCache(env, {
      market: 'cn',
      symbol: candidate,
      interval: '1d',
      hydrateFromR2
    });
    if (highPoint) {
      return {
        ...quote,
        highPoint,
        yearHigh: highPoint.high,
        yearHighDate: highPoint.highDate,
        highDate: highPoint.highDate,
        highSource: highPoint.source
      };
    }
  }
  return quote;
}
