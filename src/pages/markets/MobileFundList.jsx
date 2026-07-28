import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpDown, Check, Filter, RefreshCw, Search, SlidersHorizontal, X } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cx } from '../../components/experience-ui.jsx';
import { MarketSymbolSearchBox } from './MarketSymbolSearchBox.jsx';
import { WatchlistSelector } from './WatchlistControls.jsx';
import { MobileFundRow } from './MobileFundRow.jsx';
import { MobileMetricsDrawer } from './MobileMetricsDrawer.jsx';
import {
  MOBILE_PAGE_SIZE,
  MOBILE_SORT_OPTIONS,
  defaultMobileExpanded,
  defaultMobileMetrics,
  isOtcFundRow,
  queryMobileFundPage,
  readMobileMetricsConfig,
  writeMobileMetricsConfig,
} from './mobileFundMetrics.js';
import { useOtcD1ListQuery } from './useOtcD1ListQuery.js';

function mobileSortOptionsForList(isOtcList) {
  return MOBILE_SORT_OPTIONS.filter((option) => {
    if (option.id === 'limit' && !isOtcList) return false;
    if (option.id === 'premium' && isOtcList) return false;
    return true;
  });
}

function findSortOption(id, isOtcList) {
  return mobileSortOptionsForList(isOtcList).find((option) => option.id === id)
    || MOBILE_SORT_OPTIONS.find((option) => option.id === id)
    || MOBILE_SORT_OPTIONS[0];
}

export function MobileFundList({
  rows = [],
  isOtcList = false,
  serverMode = false,
  serverListSymbols = [],
  serverHeldSymbols = [],
  market = 'cn',
  marketLabel = 'A 股监控列表',
  searchLabel = '基金搜索',
  watchLists = [],
  activeWatchListId = '',
  onSelectWatchlist,
  onCreateWatchlist,
  onRenameWatchlist,
  onDeleteWatchlist,
  searchOpen = false,
  searchValue = '',
  searchResults = [],
  searchLoading = false,
  searchError = '',
  watchSymbols = [],
  onSearchToggle,
  onSearchChange,
  onSearchClear,
  onSearchResultSelect,
  onSearchResultAdd,
  onRefresh,
  refreshing = false,
  onSelectSymbol,
  onVisibleSymbolsChange,
  rowTestIdPrefix = 'market-row-mobile',
}) {
  const [metricIds, setMetricIds] = useState(() => readMobileMetricsConfig(isOtcList));
  const [metricsOpen, setMetricsOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterHeldOnly, setFilterHeldOnly] = useState(false);
  const [listQuery, setListQuery] = useState('');
  // orderBy intent (MySQL-style); primary field exposed as sorting for the menu UI
  const [sorting, setSorting] = useState({ id: 'heldRank', desc: true });
  const [expandedSymbol, setExpandedSymbol] = useState('');
  // Accumulated pages from ORDER BY + LIMIT + cursor
  const [pageItems, setPageItems] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [pageTotal, setPageTotal] = useState(0);
  const [showTop, setShowTop] = useState(false);
  const listScrollRef = useRef(null);
  const loadMoreRef = useRef(null);
  const loadingMoreRef = useRef(false);

  const expandedMetricIds = defaultMobileExpanded(isOtcList);
  const sortOptions = useMemo(() => mobileSortOptionsForList(isOtcList), [isOtcList]);
  const activeSortOption = findSortOption(sorting.id, isOtcList);
  const sortLabel = activeSortOption?.label || '排序';
  const serverFilters = useMemo(() => {
    const filters = [];
    if (filterHeldOnly) filters.push({ field: 'held', op: 'eq', value: true });
    if (listQuery.trim()) filters.push({ field: 'q', op: 'contains', value: listQuery.trim() });
    return filters;
  }, [filterHeldOnly, listQuery]);
  const serverQuery = useOtcD1ListQuery({
    enabled: serverMode && market === 'cn',
    symbols: serverListSymbols,
    heldSymbols: serverHeldSymbols,
    sorting,
    filters: serverFilters,
    limit: MOBILE_PAGE_SIZE,
  });

  // Reset to first page whenever universe / ORDER BY / filters change
  useEffect(() => {
    setMetricIds(readMobileMetricsConfig(isOtcList));
    setExpandedSymbol('');
    if (serverMode) return;
    const page = queryMobileFundPage(rows, {
      sorting,
      limit: MOBILE_PAGE_SIZE,
      cursor: null,
      heldOnly: filterHeldOnly,
      query: listQuery,
    });
    setPageItems(page.items);
    setNextCursor(page.nextCursor);
    setPageTotal(page.total);
  }, [isOtcList, activeWatchListId, rows, sorting.id, sorting.desc, filterHeldOnly, listQuery, serverMode]);

  const hasMore = serverMode ? serverQuery.hasMore : Boolean(nextCursor);
  const visibleRows = serverMode ? serverQuery.items : pageItems;
  const visibleTotal = serverMode ? serverQuery.total : pageTotal;

  const loadMore = () => {
    if (serverMode) {
      void serverQuery.loadMore();
      return;
    }
    if (!nextCursor || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    try {
      const page = queryMobileFundPage(rows, {
        sorting,
        limit: MOBILE_PAGE_SIZE,
        cursor: nextCursor,
        heldOnly: filterHeldOnly,
        query: listQuery,
      });
      setPageItems((prev) => {
        const seen = new Set(prev.map((row) => row.symbol));
        const merged = [...prev];
        for (const row of page.items) {
          if (!seen.has(row.symbol)) {
            seen.add(row.symbol);
            merged.push(row);
          }
        }
        return merged;
      });
      setNextCursor(page.nextCursor);
      setPageTotal(page.total);
    } finally {
      loadingMoreRef.current = false;
    }
  };

  useEffect(() => {
    if (typeof onVisibleSymbolsChange !== 'function') return;
    onVisibleSymbolsChange(visibleRows.map((row) => row.symbol).filter(Boolean));
  }, [visibleRows, onVisibleSymbolsChange]);

  useEffect(() => {
    if (!hasMore) return undefined;
    const node = loadMoreRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore();
      },
      { root: listScrollRef.current, rootMargin: '160px 0px', threshold: 0.01 }
    );
    observer.observe(node);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadMore closes over latest cursor
  }, [hasMore, nextCursor, rows, sorting.id, sorting.desc, filterHeldOnly, listQuery]);

  useEffect(() => {
    const node = listScrollRef.current;
    if (!node) return undefined;
    const onScroll = () => setShowTop(node.scrollTop > 480);
    node.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => node.removeEventListener('scroll', onScroll);
  }, []);

  // If list mode flips OTC/ETF, drop invalid primary sort fields.
  useEffect(() => {
    const allowed = new Set(mobileSortOptionsForList(isOtcList).map((item) => item.id));
    if (!allowed.has(sorting.id)) {
      setSorting({ id: 'heldRank', desc: true });
    }
  }, [isOtcList, sorting.id]);

  const activeFilters = [];
  if (filterHeldOnly) activeFilters.push({ key: 'held', label: '仅看持仓' });
  if (listQuery.trim()) activeFilters.push({ key: 'query', label: `搜索 ${listQuery.trim()}` });
  const filterCount = activeFilters.length;
  const isDefaultSort = sorting.id === 'heldRank' && sorting.desc === true;

  const handleSaveMetrics = (ids) => {
    const next = ids?.length ? ids : defaultMobileMetrics(isOtcList);
    setMetricIds(next);
    writeMobileMetricsConfig(isOtcList, next);
  };

  const applySortOption = (option) => {
    if (!option) return;
    setSorting((prev) => {
      if (prev.id === option.id) {
        // Same field again → toggle direction (matches table header behavior).
        return { id: option.id, desc: !prev.desc };
      }
      return { id: option.id, desc: option.desc };
    });
    setSortOpen(false);
  };

  const clearAllFilters = () => {
    setFilterHeldOnly(false);
    setListQuery('');
    setFilterOpen(false);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--market-surface)]">
      <div className="sticky top-0 z-20 space-y-2 border-b border-[var(--market-border)] bg-white/95 px-3 pb-2 pt-1 backdrop-blur">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold text-[var(--market-text-muted)]">{marketLabel}</div>
            <WatchlistSelector
              lists={watchLists}
              activeListId={activeWatchListId}
              market={market}
              onSelect={onSelectWatchlist}
              onCreate={onCreateWatchlist}
              onRename={onRenameWatchlist}
              onDelete={onDeleteWatchlist}
            />
          </div>
          {onRefresh ? (
            <button
              type="button"
              onClick={() => onRefresh?.()}
              aria-label="刷新数据"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--market-text-muted)]"
            >
              <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
            </button>
          ) : null}
        </div>

        {searchOpen ? (
          <div className="flex items-center gap-1.5">
            <MarketSymbolSearchBox
              autoFocus
              compact
              inline
              searchValue={searchValue}
              searchResults={searchResults}
              searchLoading={searchLoading}
              searchError={searchError}
              watchSymbols={watchSymbols}
              marketLabel={marketLabel}
              onSearchChange={onSearchChange}
              onSearchClear={onSearchClear}
              onSearchResultSelect={onSearchResultSelect}
              onSearchResultAdd={onSearchResultAdd}
            />
            <button
              type="button"
              onClick={onSearchToggle}
              aria-label={`关闭${searchLabel}`}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--market-text-muted)]"
            >
              <X size={16} />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <label className="relative min-w-0 flex-1">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--market-text-muted)]" />
              <input
                value={listQuery}
                onChange={(event) => setListQuery(event.target.value)}
                placeholder="搜索列表内基金"
                className="h-9 w-full rounded-full border border-[var(--market-border)] bg-[var(--market-surface-muted)] pl-8 pr-3 text-sm outline-none placeholder:text-[var(--market-text-subtle)] focus:border-[var(--market-accent)]"
              />
            </label>
            <button
              type="button"
              onClick={onSearchToggle}
              className="inline-flex h-9 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs font-medium text-[var(--market-text-muted)]"
              title={searchLabel}
            >
              <Search size={14} />
              添加
            </button>
          </div>
        )}

        <div className="flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <Popover
            open={filterOpen}
            onOpenChange={(open) => {
              setFilterOpen(open);
              if (open) setSortOpen(false);
            }}
          >
            <PopoverTrigger asChild>
              <button
                type="button"
                data-testid="mobile-fund-filter"
                aria-expanded={filterOpen}
                aria-haspopup="dialog"
                className={cx(
                  'inline-flex h-8 shrink-0 items-center gap-1 rounded-full border px-2.5 text-xs font-medium',
                  filterCount
                    ? 'border-[var(--market-accent)] bg-[var(--market-accent-soft)] text-[var(--market-accent)]'
                    : 'border-[var(--market-border)] text-[var(--market-text-muted)]'
                )}
              >
                <Filter size={13} />
                筛选{filterCount ? ` ${filterCount}` : ''}
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              sideOffset={8}
              className="w-56 border-[var(--market-border)] bg-white p-2 shadow-lg"
              data-testid="mobile-fund-filter-panel"
            >
              <div className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--market-text-muted)]">
                列表筛选
              </div>
              <button
                type="button"
                data-testid="mobile-fund-filter-all"
                onClick={() => {
                  setFilterHeldOnly(false);
                  setFilterOpen(false);
                }}
                className={cx(
                  'flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm',
                  !filterHeldOnly
                    ? 'bg-[var(--market-accent-soft)] text-[var(--market-accent)]'
                    : 'text-[var(--market-text-strong)] hover:bg-[var(--market-surface-muted)]'
                )}
              >
                <span>全部基金</span>
                {!filterHeldOnly ? <Check size={14} /> : null}
              </button>
              <button
                type="button"
                data-testid="mobile-fund-filter-held"
                onClick={() => {
                  setFilterHeldOnly(true);
                  setFilterOpen(false);
                }}
                className={cx(
                  'flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm',
                  filterHeldOnly
                    ? 'bg-[var(--market-accent-soft)] text-[var(--market-accent)]'
                    : 'text-[var(--market-text-strong)] hover:bg-[var(--market-surface-muted)]'
                )}
              >
                <span>仅看持仓</span>
                {filterHeldOnly ? <Check size={14} /> : null}
              </button>
              {filterCount ? (
                <button
                  type="button"
                  data-testid="mobile-fund-filter-clear"
                  onClick={clearAllFilters}
                  className="mt-1 flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-[var(--market-border)] px-2.5 py-2 text-xs font-medium text-[var(--market-text-muted)] hover:bg-[var(--market-surface-muted)]"
                >
                  <X size={12} />
                  清除筛选
                </button>
              ) : null}
            </PopoverContent>
          </Popover>

          <Popover
            open={sortOpen}
            onOpenChange={(open) => {
              setSortOpen(open);
              if (open) setFilterOpen(false);
            }}
          >
            <PopoverTrigger asChild>
              <button
                type="button"
                data-testid="mobile-fund-sort"
                aria-expanded={sortOpen}
                aria-haspopup="listbox"
                className={cx(
                  'inline-flex h-8 shrink-0 items-center gap-1 rounded-full border px-2.5 text-xs font-medium',
                  !isDefaultSort
                    ? 'border-[var(--market-accent)] bg-[var(--market-accent-soft)] text-[var(--market-accent)]'
                    : 'border-[var(--market-border)] text-[var(--market-text-muted)]'
                )}
              >
                <ArrowUpDown size={13} />
                {sortLabel}
                <span className="text-[10px] opacity-80">{sorting.desc ? '↓' : '↑'}</span>
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              sideOffset={8}
              className="w-44 border-[var(--market-border)] bg-white p-1 shadow-lg"
              data-testid="mobile-fund-sort-panel"
              role="listbox"
            >
              {sortOptions.map((option) => {
                const active = sorting.id === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="option"
                    aria-selected={active}
                    data-testid={`mobile-fund-sort-${option.id}`}
                    onClick={() => applySortOption(option)}
                    className={cx(
                      'flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm',
                      active
                        ? 'bg-[var(--market-accent-soft)] text-[var(--market-accent)]'
                        : 'text-[var(--market-text-strong)] hover:bg-[var(--market-surface-muted)]'
                    )}
                  >
                    <span>{option.label}</span>
                    {active ? <span className="text-xs">{sorting.desc ? '↓' : '↑'}</span> : null}
                  </button>
                );
              })}
            </PopoverContent>
          </Popover>

          <button
            type="button"
            onClick={() => setMetricsOpen(true)}
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full border border-[var(--market-border)] px-2.5 text-xs font-medium text-[var(--market-text-muted)]"
          >
            <SlidersHorizontal size={13} />
            指标
          </button>
        </div>

        {activeFilters.length ? (
          <div className="flex flex-wrap gap-1.5">
            <span className="text-[11px] text-[var(--market-text-muted)]">已选：</span>
            {activeFilters.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  if (item.key === 'held') setFilterHeldOnly(false);
                  if (item.key === 'query') setListQuery('');
                }}
                className="inline-flex items-center gap-1 rounded-full bg-[var(--market-surface-muted)] px-2 py-0.5 text-[11px] font-medium text-[var(--market-text-strong)]"
              >
                {item.label}
                <X size={12} />
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div ref={listScrollRef} className="markets-monitor-list-scroll min-h-0 flex-1 overflow-y-auto">
        {visibleRows.length ? (
          visibleRows.map((row) => (
            <MobileFundRow
              key={row.symbol}
              row={row}
              isOtcList={isOtcList || isOtcFundRow(row, isOtcList)}
              metricIds={metricIds}
              expandedMetricIds={expandedMetricIds}
              expanded={expandedSymbol === row.symbol}
              onToggleExpand={(target) => {
                setExpandedSymbol((prev) => (prev === target.symbol ? '' : target.symbol));
              }}
              onOpenDetail={(target) => onSelectSymbol?.(target)}
              rowTestIdPrefix={rowTestIdPrefix}
            />
          ))
        ) : (
          <div className="px-4 py-16 text-center text-sm text-[var(--market-text-muted)]">
            {filterHeldOnly || listQuery.trim()
              ? '暂无匹配基金，可调整筛选或搜索'
              : '暂无匹配基金'}
          </div>
        )}

        <div ref={loadMoreRef} className="px-4 py-4 text-center text-xs text-[var(--market-text-muted)]">
          {hasMore ? (
            <button
              type="button"
              onClick={loadMore}
              className="inline-flex flex-col items-center gap-1 text-[var(--market-text-muted)]"
            >
              <span>已显示 {visibleRows.length} / {visibleTotal}</span>
              <span className="font-semibold text-[var(--market-accent)]">加载更多</span>
            </button>
          ) : visibleTotal ? (
            `已显示 ${visibleRows.length} / ${visibleTotal}`
          ) : null}
        </div>
      </div>

      {showTop ? (
        <button
          type="button"
          onClick={() => listScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
          className="fixed bottom-20 right-4 z-30 inline-flex h-10 items-center rounded-full border border-[var(--market-border)] bg-white px-3 text-xs font-semibold text-[var(--market-text-strong)] shadow-md"
        >
          回到顶部
        </button>
      ) : null}

      <MobileMetricsDrawer
        open={metricsOpen}
        onOpenChange={setMetricsOpen}
        isOtc={isOtcList}
        selectedIds={metricIds}
        onSave={handleSaveMetrics}
      />
    </div>
  );
}

export default MobileFundList;
