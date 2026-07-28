import { resolveKlineCloseHighPointCache, resolveKlineHighPointCache } from './klineHighPointCache.js';
import { CACHE_STATUS } from './cachePolicy.js';
import { readKlineMetaCache } from './klineMetaCache.js';
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
  const existingCloseHigh = Number(quote.closeHighPoint?.high ?? quote.closeHighPoint?.yearHigh ?? quote.closeHighPoint?.price);
  const existingYearHigh = Number(quote.yearHigh);
  const hasDailyHigh = Number.isFinite(existingHigh) && existingHigh > 0
    || (Number.isFinite(existingYearHigh) && existingYearHigh > 0 && /kline|daily/i.test(String(quote.highSource || '')));
  const hasCloseHigh = Number.isFinite(existingCloseHigh) && existingCloseHigh > 0;
  if (hasDailyHigh && hasCloseHigh && quote.klineMetaStatus) return quote;
  const digits = normalizeCnDigits(quote?.code || quote?.symbol || fallbackSymbol);
  if (!isCnExchangeFundCode(digits)) return quote;
  let next = quote;
  let hasResolvedDailyHigh = hasDailyHigh;
  let hasResolvedCloseHigh = hasCloseHigh;
  for (const candidate of cnKlineSymbolCandidates(quote, fallbackSymbol)) {
    const meta = await readKlineMetaCache(env, { market: 'cn', symbol: candidate, interval: '1d', allowStale: true }).catch(() => null);
    if (meta?.status !== CACHE_STATUS.MISS) {
      const metaPayload = meta.payload || {};
      const metaHigh = metaPayload.highPoint;
      const metaCloseHigh = metaPayload.closeHighPoint;
      const canUseDerivedFields = meta.status === CACHE_STATUS.FRESH || meta.status === CACHE_STATUS.DELAYED;
      next = {
        ...next,
        ...(metaHigh && !hasResolvedDailyHigh ? {
          highPoint: metaHigh,
          yearHigh: metaHigh.high,
          yearHighDate: metaHigh.highDate,
          highDate: metaHigh.highDate,
          highSource: metaHigh.source
        } : {}),
        ...(metaCloseHigh && !hasResolvedCloseHigh ? { closeHighPoint: metaCloseHigh } : {}),
        ...(canUseDerivedFields ? {
          return1w: metaPayload.return1w ?? next.return1w,
          return1m: metaPayload.return1m ?? next.return1m,
          return3m: metaPayload.return3m ?? next.return3m,
          return6m: metaPayload.return6m ?? next.return6m,
          return1y: metaPayload.return1y ?? next.return1y,
          historicalPercentile: metaPayload.historicalPercentile ?? next.historicalPercentile,
          drawdownPercentile: metaPayload.drawdownPercentile ?? next.drawdownPercentile
        } : {}),
        klineMetaStatus: meta.status
      };
      hasResolvedDailyHigh = hasResolvedDailyHigh || Boolean(metaHigh);
      hasResolvedCloseHigh = hasResolvedCloseHigh || Boolean(metaCloseHigh);
    }
    if (!hasResolvedDailyHigh) {
      const highPoint = await resolveKlineHighPointCache(env, {
        market: 'cn',
        symbol: candidate,
        interval: '1d',
        hydrateFromR2
      });
      if (highPoint) {
        next = {
          ...next,
          highPoint,
          yearHigh: highPoint.high,
          yearHighDate: highPoint.highDate,
          highDate: highPoint.highDate,
          highSource: highPoint.source
        };
        hasResolvedDailyHigh = true;
      }
    }
    if (!hasResolvedCloseHigh) {
      const closeHighPoint = await resolveKlineCloseHighPointCache(env, {
        market: 'cn',
        symbol: candidate,
        interval: '1d',
        hydrateFromR2
      });
      if (closeHighPoint) {
        next = {
          ...next,
          closeHighPoint
        };
        hasResolvedCloseHigh = true;
      }
    }
    if (next !== quote && hasResolvedDailyHigh && hasResolvedCloseHigh) {
      return next;
    }
  }
  return next;
}
