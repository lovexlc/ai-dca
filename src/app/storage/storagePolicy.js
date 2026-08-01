// Storage selection contract. Keep new features aligned with the existing
// cache layers instead of choosing a store based on convenience.
export const STORAGE_POLICY = Object.freeze({
  userHoldingsAndPlans: 'localStorage (cross-device sync uses syncV2)',
  completeKlineHistory: 'IndexedDB (marketHistoryCache.js; local large object)',
  quoteSnapshot: 'Worker KV (quote:<code>; short TTL)',
  largeKlineAndFinancialObjects: 'Worker R2',
  canonicalFundMetadata: 'Worker D1'
});
