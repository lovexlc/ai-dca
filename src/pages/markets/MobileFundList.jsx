import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpDown, Filter, RefreshCw, Search, SlidersHorizontal, X } from 'lucide-react';
import { cx } from '../../components/experience-ui.jsx';
import { useClickOutside } from '../../hooks/useClickOutside.js';
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
  readMobileMetricsConfig,
  sortMobileRows,
  writeMobileMetricsConfig,
} from './mobileFundMetrics.js';

function matchesQuery(row, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  const hay = [row?.symbol, row?.code, row?.name, row?.meta].filter(Boolean).join(' ').toLowerCase();
  return hay.includes(q);
}

export function MobileFundList({
  rows = [],
  isOtcList = false,
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
  const [filterHeldOnly, setFilterHeldOnly] = useState(false);
  const [listQuery, setListQuery] = useState('');
  const [sorting, setSorting] = useState({ id: 'heldRank', desc: true });
  const [expandedSymbol, setExpandedSymbol] = useState('');
  const [visibleCount, setVisibleCount] = useState(MOBILE_PAGE_SIZE);
  const [showTop, setShowTop] = useState(false);
  const loadMoreRef = useRef(null);
  const listScrollRef = useRef(null);
  const sortMenuRef = useRef(null);

  useClickOutside(sortMenuRef, () => setSortOpen(false), sortOpen);

  useEffect(() => {
    setMetricIds(readMobileMetricsConfig(isOtcList));
    setExpandedSymbol('');
    setVisibleCount(MOBILE_PAGE_SIZE);
  }, [isOtcList, activeWatchListId]);

  useEffect(() => {
    setVisibleCount(MOBILE_PAGE_SIZE);
    setExpandedSymbol('');
  }, [listQuery, filterHeldOnly, sorting.id, sorting.desc, rows.length]);

  const filteredSorted = useMemo(() => {
    let list = Array.isArray(rows) ? rows : [];
    if (filterHeldOnly) list = list.filter((row) => row?.isHeld);
    if (listQuery.trim()) list = list.filter((row) => matchesQuery(row, listQuery));
    return sortMobileRows(list, sorting);
  }, [rows, filterHeldOnly, listQuery, sorting]);

  const visibleRows = useMemo(
    () => filteredSorted.slice(0, visibleCount),
    [filteredSorted, visibleCount]
  );
  const hasMore = visibleCount < filteredSorted.length;
  const expandedMetricIds = defaultMobileExpanded(isOtcList);

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
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisibleCount((prev) => Math.min(prev + MOBILE_PAGE_SIZE, filteredSorted.length));
        }
      },
      { root: null, rootMargin: '160px 0px', threshold: 0.01 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, filteredSorted.length, visibleCount]);

  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 480);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const activeFilters = [];
  if (filterHeldOnly) activeFilters.push({ key: 'held', label: '持仓' });
  if (listQuery.trim()) activeFilters.push({ key: 'query', label: `搜索 ${listQuery.trim()}` });

  const handleSaveMetrics = (ids) => {
    const next = ids?.length ? ids : defaultMobileMetrics(isOtcList);
    setMetricIds(next);
    writeMobileMetricsConfig(isOtcList, next);
  };

  return (
    <div ref={listScrollRef} className="flex h-full min-h-0 flex-col bg-[var(--market-surface)]">
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
          <button
            type="button"
            onClick={() => setFilterHeldOnly((prev) => !prev)}
            className={cx(
              'inline-flex h-8 shrink-0 items-center gap-1 rounded-full border px-2.5 text-xs font-medium',
              filterHeldOnly
                ? 'border-[var(--market-accent)] bg-[var(--market-accent-soft)] text-[var(--market-accent)]'
                : 'border-[var(--market-border)] text-[var(--market-text-muted)]'
            )}
          >
            <Filter size={13} />
            筛选{filterHeldOnly ? ' 1' : ''}
          </button>

          <div ref={sortMenuRef} className="relative shrink-0">
            <button
              type="button"
              onClick={() => setSortOpen((prev) => !prev)}
              className="inline-flex h-8 items-center gap-1 rounded-full border border-[var(--market-border)] px-2.5 text-xs font-medium text-[var(--market-text-muted)]"
            >
              <ArrowUpDown size={13} />
              排序
            </button>
            {sortOpen ? (
              <div className="absolute left-0 top-9 z-30 w-40 overflow-hidden rounded-xl border border-[var(--market-border)] bg-white shadow-lg">
                {MOBILE_SORT_OPTIONS.filter((option) => {
                  if (option.id === 'limit' && !isOtcList) return false;
                  if (option.id === 'premium' && isOtcList) return false;
                  return true;
                }).map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => {
                      setSorting({ id: option.id, desc: option.desc });
                      setSortOpen(false);
                    }}
                    className={cx(
                      'flex w-full items-center justify-between px-3 py-2 text-left text-sm',
                      sorting.id === option.id
                        ? 'bg-[var(--market-accent-soft)] text-[var(--market-accent)]'
                        : 'text-[var(--market-text-strong)] hover:bg-[var(--market-surface-muted)]'
                    )}
                  >
                    <span>{option.label}</span>
                    {sorting.id === option.id ? <span className="text-xs">{sorting.desc ? '↓' : '↑'}</span> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

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

      <div className="min-h-0 flex-1 overflow-y-auto">
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
            暂无匹配基金
          </div>
        )}

        <div ref={loadMoreRef} className="px-4 py-4 text-center text-xs text-[var(--market-text-muted)]">
          {hasMore ? (
            <button
              type="button"
              onClick={() => setVisibleCount((prev) => Math.min(prev + MOBILE_PAGE_SIZE, filteredSorted.length))}
              className="inline-flex flex-col items-center gap-1 text-[var(--market-text-muted)]"
            >
              <span>已显示 {visibleRows.length} / {filteredSorted.length}</span>
              <span className="font-semibold text-[var(--market-accent)]">加载更多</span>
            </button>
          ) : filteredSorted.length ? (
            `已显示 ${visibleRows.length} / ${filteredSorted.length}`
          ) : null}
        </div>
      </div>

      {showTop ? (
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
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
