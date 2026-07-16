import { useCallback, useEffect, useMemo, useState } from 'react';
import { buildMarketSortFetchPolicy } from './marketDetailDataPolicy.js';

export function useMarketSortHydration({
  market,
  activeListId,
  showLimitColumn = false,
  hidePremiumColumn = false,
  includeFundFees = false,
  includePremiumSnapshots = false,
  includeHighPointSnapshots = false,
  includeFundLimits = false,
  includeListHistoryMetrics = false,
} = {}) {
  const [sortHydration, setSortHydration] = useState({ active: false, sorting: [] });
  const sortFetchPolicy = useMemo(() => buildMarketSortFetchPolicy({
    sorting: sortHydration.sorting,
    showLimitColumn,
    hidePremiumColumn,
  }), [hidePremiumColumn, showLimitColumn, sortHydration.sorting]);

  useEffect(() => {
    setSortHydration((previous) => previous.active ? { active: false, sorting: [] } : previous);
  }, [activeListId, market]);

  const handleMarketSortingChange = useCallback((sorting) => {
    setSortHydration({
      active: true,
      sorting: Array.isArray(sorting) ? sorting : [],
    });
  }, []);

  return {
    sortActive: sortHydration.active,
    sortFetchPolicy,
    effectiveIncludeFundFees: includeFundFees || sortFetchPolicy.includeFundFees,
    effectiveIncludePremiumSnapshots: includePremiumSnapshots || sortFetchPolicy.includePremiumSnapshots,
    effectiveIncludeHighPointSnapshots: includeHighPointSnapshots || sortFetchPolicy.includeHighPointSnapshots,
    effectiveIncludeFundLimits: includeFundLimits || sortFetchPolicy.includeFundLimits,
    effectiveIncludeListHistoryMetrics: includeListHistoryMetrics || sortFetchPolicy.includeListHistoryMetrics,
    handleMarketSortingChange,
  };
}
