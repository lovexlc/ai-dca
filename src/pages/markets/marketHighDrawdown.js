function firstPositiveNumber(...values) {
  for (const value of values) {
    const number = Number(value?.raw ?? value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return null;
}

function normalizeSymbol(value = '') {
  return String(value || '').trim().toUpperCase();
}

function readMappedHighPoint(row = {}, highPointMap = {}) {
  const keys = [
    row.symbol,
    row.code,
    row.ticker,
    normalizeSymbol(row.symbol),
    normalizeSymbol(row.code),
    normalizeSymbol(row.ticker),
  ].filter(Boolean);
  for (const key of keys) {
    const item = highPointMap?.[key];
    const high = firstPositiveNumber(item?.high, item?.yearHigh, item?.price, item);
    if (high) return { high, highDate: String(item?.highDate || item?.date || '').trim(), source: item?.source || 'mapped' };
  }
  return null;
}

function readMappedCloseHighPoint(row = {}, highPointMap = {}) {
  const keys = [
    row.symbol,
    row.code,
    row.ticker,
    normalizeSymbol(row.symbol),
    normalizeSymbol(row.code),
    normalizeSymbol(row.ticker),
  ].filter(Boolean);
  for (const key of keys) {
    const item = highPointMap?.[key];
    const source = item?.closeHighPoint || item;
    const high = firstPositiveNumber(source?.high, source?.yearHigh, source?.price, source);
    if (high) return { high, highDate: String(source?.highDate || source?.date || '').trim(), source: source?.source || 'mapped-close' };
  }
  return null;
}

function readRowHighPoint(row = {}) {
  const item = row.highPoint;
  const high = firstPositiveNumber(item?.high, item?.yearHigh, item?.price);
  if (high) {
    return {
      high,
      highDate: String(item?.highDate || item?.date || row.highDate || row.yearHighDate || '').trim(),
      source: item?.source || row.highSource || 'daily-kline-365d'
    };
  }
  const yearHigh = firstPositiveNumber(row.yearHigh);
  const source = String(row.highSource || '').trim();
  if (yearHigh && /kline/i.test(source)) {
    return {
      high: yearHigh,
      highDate: String(row.highDate || row.yearHighDate || '').trim(),
      source
    };
  }
  return null;
}

function readRowCloseHighPoint(row = {}) {
  const item = row.closeHighPoint;
  const high = firstPositiveNumber(item?.high, item?.yearHigh, item?.price);
  if (high) {
    return {
      high,
      highDate: String(item?.highDate || item?.date || row.closeHighDate || '').trim(),
      source: item?.source || row.closeHighSource || 'daily-close-kline-365d'
    };
  }
  return null;
}

function normalizeCode(value = '') {
  const digits = String(value || '').replace(/^(sh|sz|bj)/i, '').replace(/\D/g, '');
  return digits.length === 6 ? digits : '';
}

function shouldRequireMappedHigh(row = {}) {
  const market = String(row.market || '').toLowerCase();
  const kind = String(row.fundKind || row.kind || row.assetType || row.type || '').toLowerCase();
  const code = normalizeCode(row.code || row.symbol || row.ticker);
  const looksLikeCn = market === 'cn' || Boolean(code);
  return looksLikeCn && (kind.includes('exchange') || kind.includes('场内') || /^(15|16|50|51|52|53|54|56|58)/.test(code));
}

export function resolveHighDrawdown(row = {}, highPointMap = {}) {
  const cachedHighPoint = readRowHighPoint(row) || readMappedHighPoint(row, highPointMap);
  if (!cachedHighPoint && shouldRequireMappedHigh(row)) return null;
  const high = firstPositiveNumber(
    cachedHighPoint?.high,
    row.allTimeHigh,
    row.all_time_high,
    row.historyHigh,
    row.history_high,
    row.historicalHigh,
    row.highest,
    row.highestPrice,
    row.highest_price,
    row.maxPrice,
    row.max_price,
    row.yearHigh,
    row.high52w,
    row.high_52w,
    row.high52Week,
    row.fiftyTwoWeekHigh
  );
  const current = firstPositiveNumber(row.price, row.currentPrice, row.close, row.latestNav);

  if (!high || !current) return null;

  return {
    high,
    highDate: cachedHighPoint?.highDate || String(row.highDate || row.yearHighDate || row.high52wDate || '').trim(),
    highSource: cachedHighPoint?.source || 'quote',
    current,
    drawdownPct: Math.max(((high - current) / high) * 100, 0)
  };
}

export function resolveDayHighDrawdown(row = {}) {
  const high = firstPositiveNumber(
    row.high,
    row.regularMarketDayHigh,
    row.dayHigh,
    row.day_high
  );
  const current = firstPositiveNumber(
    row.price,
    row.currentPrice,
    row.regularMarketPrice,
    row.close,
    row.latestNav
  );

  if (!high || !current) return null;

  return {
    high,
    highDate: String(row.quoteDate || row.quoteAt || row.asOf || row.date || '').trim(),
    highSource: 'quote-day-high',
    current,
    drawdownPct: Math.min((current / high - 1) * 100, 0)
  };
}

export function resolveCloseHighDrawdown(row = {}, highPointMap = {}) {
  const cachedHighPoint = readRowCloseHighPoint(row) || readMappedCloseHighPoint(row, highPointMap);
  if (!cachedHighPoint && shouldRequireMappedHigh(row)) return null;
  const high = firstPositiveNumber(
    cachedHighPoint?.high,
    row.closeHigh,
    row.close_high,
    row.closeHighPrice,
    row.close_high_price,
    row.yearCloseHigh,
    row.year_close_high,
    row.highestClose,
    row.highest_close,
    row.highestClosePrice,
    row.highest_close_price
  );
  const current = firstPositiveNumber(row.price, row.currentPrice, row.close, row.latestNav);

  if (!high || !current) return null;

  return {
    high,
    highDate: cachedHighPoint?.highDate || String(row.closeHighDate || row.yearCloseHighDate || '').trim(),
    highSource: cachedHighPoint?.source || 'quote-close',
    current,
    drawdownPct: Math.min((current / high - 1) * 100, 0)
  };
}
