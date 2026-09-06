import { useEffect, useMemo, useState } from 'react';
import { ArrowUpDown, Check, Filter, RefreshCw, Search, SlidersHorizontal, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
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
  queryMobileFundPage,
  readMobileMetricsConfig,
  writeMobileMetricsConfig,
} from './mobileFundMetrics.js';

function sortOptionsForMode(isOtcList) {
  return MOBILE_SORT_OPTIONS.filter((item) => !((item.id === 'limit' && !isOtcList) || (item.id === 'premium' && isOtcList)));
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
}) {
  const [metricIds, setMetricIds] = useState(() => readMobileMetricsConfig(isOtcList));
  const [metricsOpen, setMetricsOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [heldOnly, setHeldOnly] = useState(false);
  const [listQuery, setListQuery] = useState('');
  const [sorting, setSorting] = useState({ id: 'heldRank', desc: true });
  const [expandedSymbol, setExpandedSymbol] = useState('');
  const [visibleLimit, setVisibleLimit] = useState(MOBILE_PAGE_SIZE);

  useEffect(() => {
    setMetricIds(readMobileMetricsConfig(isOtcList));
    setExpandedSymbol('');
    setVisibleLimit(MOBILE_PAGE_SIZE);
  }, [activeWatchListId, isOtcList]);

  useEffect(() => setVisibleLimit(MOBILE_PAGE_SIZE), [heldOnly, listQuery, sorting]);

  const sortOptions = useMemo(() => sortOptionsForMode(isOtcList), [isOtcList]);
  const activeSort = sortOptions.find((item) => item.id === sorting.id) || sortOptions[0];
  const page = useMemo(() => queryMobileFundPage(rows, {
    sorting,
    heldOnly,
    query: listQuery,
    limit: visibleLimit,
  }), [heldOnly, listQuery, rows, sorting, visibleLimit]);

  useEffect(() => {
    onVisibleSymbolsChange?.(page.items.map((row) => row.symbol).filter(Boolean));
  }, [onVisibleSymbolsChange, page.items]);

  const saveMetrics = (ids) => {
    const next = ids?.length ? ids : defaultMobileMetrics(isOtcList);
    setMetricIds(next);
    writeMobileMetricsConfig(isOtcList, next);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--market-surface)]">
      <div className="sticky top-0 z-20 space-y-2 border-b border-[var(--market-border)] bg-white/95 px-3 pb-2 pt-1 backdrop-blur">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold text-[var(--market-text-muted)]">{marketLabel}</div>
            <WatchlistSelector lists={watchLists} activeListId={activeWatchListId} market={market} onSelect={onSelectWatchlist} onCreate={onCreateWatchlist} onRename={onRenameWatchlist} onDelete={onDeleteWatchlist} />
          </div>
          {onRefresh ? (
            <button type="button" onClick={() => onRefresh?.()} aria-label="刷新数据" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--market-text-muted)]">
              <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
            </button>
          ) : null}
        </div>

        {searchOpen ? (
          <div className="flex items-center gap-1.5">
            <MarketSymbolSearchBox autoFocus compact inline searchValue={searchValue} searchResults={searchResults} searchLoading={searchLoading} searchError={searchError} watchSymbols={watchSymbols} marketLabel={marketLabel} onSearchChange={onSearchChange} onSearchClear={onSearchClear} onSearchResultSelect={onSearchResultSelect} onSearchResultAdd={onSearchResultAdd} />
            <button type="button" onClick={onSearchToggle} aria-label={`关闭${searchLabel}`} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--market-text-muted)]"><X size={16} /></button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <label className="relative min-w-0 flex-1">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--market-text-muted)]" />
              <input value={listQuery} onChange={(event) => setListQuery(event.target.value)} placeholder="搜索列表内基金" className="h-9 w-full rounded-full border border-[var(--market-border)] bg-[var(--market-surface-muted)] pl-8 pr-3 text-sm outline-none placeholder:text-[var(--market-text-subtle)] focus:border-[var(--market-accent)]" />
            </label>
            <button type="button" onClick={onSearchToggle} className="inline-flex h-9 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs font-medium text-[var(--market-text-muted)]"><Search size={14} />添加</button>
          </div>
        )}

        <div className="flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <Popover open={filterOpen} onOpenChange={(open) => { setFilterOpen(open); if (open) setSortOpen(false); }}>
            <PopoverTrigger asChild>
              <button type="button" data-testid="mobile-fund-filter" className={cx('inline-flex h-8 shrink-0 items-center gap-1 rounded-full border px-2.5 text-xs font-medium', heldOnly ? 'border-[var(--market-accent)] bg-[var(--market-accent-soft)] text-[var(--market-accent)]' : 'border-[var(--market-border)] text-[var(--market-text-muted)]')}>
                <Filter size={13} />筛选{heldOnly ? ' 1' : ''}
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" sideOffset={8} className="w-52 border-[var(--market-border)] bg-white p-1 shadow-lg">
              {[{ value: false, label: '全部基金' }, { value: true, label: '仅看持仓' }].map((option) => (
                <button key={String(option.value)} type="button" onClick={() => { setHeldOnly(option.value); setFilterOpen(false); }} className={cx('flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm', heldOnly === option.value ? 'bg-[var(--market-accent-soft)] text-[var(--market-accent)]' : 'text-[var(--market-text-strong)] hover:bg-[var(--market-surface-muted)]')}>
                  {option.label}{heldOnly === option.value ? <Check size={14} /> : null}
                </button>
              ))}
            </PopoverContent>
          </Popover>

          <Popover open={sortOpen} onOpenChange={(open) => { setSortOpen(open); if (open) setFilterOpen(false); }}>
            <PopoverTrigger asChild>
              <button type="button" data-testid="mobile-fund-sort" className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full border border-[var(--market-border)] px-2.5 text-xs font-medium text-[var(--market-text-muted)]">
                <ArrowUpDown size={13} />{activeSort?.label || '排序'}<span className="text-[10px]">{sorting.desc ? '↓' : '↑'}</span>
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" sideOffset={8} className="max-h-[60vh] w-48 overflow-y-auto border-[var(--market-border)] bg-white p-1 shadow-lg">
              {sortOptions.map((option) => {
                const active = sorting.id === option.id;
                return (
                  <button key={option.id} type="button" onClick={() => { setSorting((prev) => prev.id === option.id ? { id: option.id, desc: !prev.desc } : { id: option.id, desc: option.desc }); setSortOpen(false); }} className={cx('flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm', active ? 'bg-[var(--market-accent-soft)] text-[var(--market-accent)]' : 'text-[var(--market-text-strong)] hover:bg-[var(--market-surface-muted)]')}>
                    {option.label}{active ? <span className="text-xs">{sorting.desc ? '↓' : '↑'}</span> : null}
                  </button>
                );
              })}
            </PopoverContent>
          </Popover>

          <button type="button" onClick={() => setMetricsOpen(true)} className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full border border-[var(--market-border)] px-2.5 text-xs font-medium text-[var(--market-text-muted)]"><SlidersHorizontal size={13} />指标</button>
          {heldOnly ? <button type="button" onClick={() => setHeldOnly(false)} className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full bg-[var(--market-surface-muted)] px-2.5 text-xs text-[var(--market-text-muted)]">仅看持仓<X size={12} /></button> : null}
        </div>
      </div>

      <div className="markets-monitor-list-scroll min-h-0 flex-1 overflow-y-auto">
        {page.items.length ? page.items.map((row) => (
          <MobileFundRow key={row.symbol} row={row} isOtcList={isOtcList} metricIds={metricIds} expandedMetricIds={defaultMobileExpanded(isOtcList)} expanded={expandedSymbol === row.symbol} onToggleExpand={(target) => setExpandedSymbol((prev) => prev === target.symbol ? '' : target.symbol)} onOpenDetail={(target) => onSelectSymbol?.(target)} />
        )) : <div className="px-4 py-16 text-center text-sm text-[var(--market-text-muted)]">暂无匹配基金，可调整筛选或搜索</div>}
        <div className="px-4 py-4 text-center text-xs text-[var(--market-text-muted)]">
          {page.nextCursor ? <button type="button" onClick={() => setVisibleLimit((value) => value + MOBILE_PAGE_SIZE)} className="inline-flex flex-col items-center gap-1"><span>已显示 {page.items.length} / {page.total}</span><span className="font-semibold text-[var(--market-accent)]">加载更多</span></button> : page.total ? `已显示 ${page.items.length} / ${page.total}` : null}
        </div>
      </div>

      <MobileMetricsDrawer open={metricsOpen} onOpenChange={setMetricsOpen} isOtc={isOtcList} selectedIds={metricIds} onSave={saveMetrics} />
    </div>
  );
}

export default MobileFundList;
