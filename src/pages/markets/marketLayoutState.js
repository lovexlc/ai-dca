export const DEFAULT_MARKETS_FULL_TABLE_MODE = true;
export const DEFAULT_MARKETS_WATCH_LIST_EXPANDED = false;

export function getInitialMarketsFullTableMode() {
  return DEFAULT_MARKETS_FULL_TABLE_MODE;
}

export function getInitialMarketsWatchListExpanded() {
  return DEFAULT_MARKETS_WATCH_LIST_EXPANDED;
}

export function shouldRenderExpandedMarketListOverlay({ watchListExpanded = false, fullTableMode = false } = {}) {
  return Boolean(watchListExpanded && !fullTableMode);
}
