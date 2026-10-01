import { assetKey, daysBetween, issue, money, previousDate, validDate } from './returnInputs.js';

export function resolveEffectiveWindow({ from, to }) {
  if (!validDate(from) || !validDate(to) || from > to)
    return { window: null, diagnostics: [issue('invalid_window')] };
  return {
    window: { from, to, startValuationDate: previousDate(from), endValuationDate: to },
    diagnostics: []
  };
}

export function buildSharesTimeline(transactions = []) {
  const shares = new Map();
  const timeline = [];
  const diagnostics = [];
  const sorted = [...transactions].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.type === 'BUY' ? 0 : 1) - (b.type === 'BUY' ? 0 : 1) ||
      a.id.localeCompare(b.id)
  );
  for (const tx of sorted) {
    const key = assetKey(tx);
    const balance =
      Math.round(((shares.get(key)?.shares || 0) + (tx.type === 'BUY' ? tx.shares : -tx.shares)) * 1e8) / 1e8;
    if (balance < -1e-8) diagnostics.push({ ...issue('negative_holdings', tx), date: tx.date });
    shares.set(key, { key, code: tx.code, kind: tx.kind, venue: tx.venue, shares: balance });
    timeline.push({
      date: tx.date,
      transactionId: tx.id,
      holdings: [...shares.values()].map((holding) => ({ ...holding }))
    });
  }
  return { timeline, diagnostics };
}

// pricesByCode entries are dated, unadjusted observations. Asset keys take precedence.
// A caller can explicitly allow a longer holiday gap; stale data never silently passes.
export function valueAtBoundary({ timeline, date, pricesByCode = {}, maxPriceAgeDays = 7 }) {
  if (!validDate(date) || !Number.isFinite(maxPriceAgeDays) || maxPriceAgeDays < 0)
    return { marketValue: null, valuations: [], diagnostics: [issue('invalid_valuation_boundary')] };
  const holdings = timeline.filter((point) => point.date <= date).at(-1)?.holdings || [];
  const diagnostics = [];
  const valuations = [];
  let totalCents = 0;
  for (const holding of holdings) {
    if (holding.shares === 0) continue;
    const records = pricesByCode[holding.key] || pricesByCode[holding.code] || [];
    const price = [...records]
      .filter((p) => validDate(p.date) && p.date <= date && Number.isFinite(p.price) && p.price > 0)
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    const ageDays = price ? daysBetween(price.date, date) : null;
    const reason = !price
      ? 'missing_price'
      : price.adjusted
        ? 'adjusted_price_unsupported'
        : ageDays > maxPriceAgeDays
          ? 'stale_price'
          : null;
    if (reason)
      diagnostics.push({
        ...issue(reason, holding),
        key: holding.key,
        boundaryDate: date,
        priceDate: price?.date,
        ageDays
      });
    const marketValue = price ? money(holding.shares * price.price) : null;
    if (marketValue !== null) totalCents += Math.round(marketValue * 100);
    valuations.push({
      ...holding,
      marketValue,
      price: price?.price ?? null,
      priceDate: price?.date ?? null,
      source: price?.source || 'provided_history',
      ageDays
    });
  }
  return { marketValue: diagnostics.length ? null : totalCents / 100, valuations, diagnostics };
}