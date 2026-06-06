export function getXueqiuQuote(fundData) {
  return fundData?.results?.quote_detail?.raw?.data?.quote || fundData?.results?.quote_detail?.summary?.quote || null;
}

export function toFinitePrice(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function resolveQuotePeakPrice(...quotes) {
  const yearHighCandidates = [];
  const dayHighCandidates = [];
  for (const quote of quotes) {
    if (!quote || typeof quote !== 'object') continue;
    yearHighCandidates.push(
      quote.high52w,
      quote.high_52w,
      quote.high52Week,
      quote.fiftyTwoWeekHigh
    );
    dayHighCandidates.push(
      quote.regularMarketDayHigh,
      quote.high
    );
  }
  for (const value of [...yearHighCandidates, ...dayHighCandidates]) {
    const price = toFinitePrice(value);
    if (price > 0) return price;
  }
  return 0;
}
