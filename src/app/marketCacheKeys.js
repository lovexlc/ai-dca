export const FUND_METRICS_SNAPSHOT_CACHE_KEY = 'markets:fund-metrics-snapshots:v1';
export const OTC_WATCH_CACHE_KEY = 'markets:otc-watch-cache:v1';

// Keep old browser-direct cache names in the cleanup list so an upgrade can
// remove data written by the retired direct-source implementation.
const LEGACY_MARKET_CACHE_KEYS = [
  'markets:direct-quotes:v1',
  'markets:direct-search:v1',
  'markets:danjuan-quotes:v1',
];

export const MARKET_LOCAL_STORAGE_CACHE_KEYS = [
  ...LEGACY_MARKET_CACHE_KEYS,
  FUND_METRICS_SNAPSHOT_CACHE_KEY,
  OTC_WATCH_CACHE_KEY,
];
