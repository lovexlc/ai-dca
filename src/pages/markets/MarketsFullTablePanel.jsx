import { useMemo, useState } from 'react';
import { Search, X, RefreshCw, LayoutGrid, Table2, SlidersHorizontal, ArrowUpDown, Columns3, Bookmark, ChevronRight } from 'lucide-react';
import { MarketListTable } from './MarketListTable.jsx';
import { MarketSymbolSearchBox } from './MarketSymbolSearchBox.jsx';
import { WatchlistSelector } from './WatchlistControls.jsx';
import { MarketWatchlistCard } from '../../components/mobile/MarketWatchlistCard.jsx';

export function MarketsFullTablePanel({
  fullTableMode = false,
  rows = [],
  activeWatchListName = '',
  watchLists = [],
  activeWatchListId = '',
  market,
  isMobile = false,
  klineMap = {},
  selectedSymbol = '',
  onSelectWatchlist,
  onCreateWatchlist,
  onRenameWatchlist,
  onDeleteWatchlist,
  onSelectSymbol,
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
  showLimitColumn = false,
  hidePremiumColumn = false,
  hideTrendColumn = false,
  onRefresh,
  refreshing = false,
  onVisibleSymbolsChange,
  onColumnVisibilityStateChange,
  onViewPresetSave,
}) {

  const marketLabel = market === 'cn' ? 'A 股监控列表' : '美股监控列表';
  const searchLabel = market === 'cn' ? '基金搜索' : '标的搜索';
  const viewStorageScope = `${market || 'market'}:${activeWatchListId || activeWatchListName || 'default'}`;
  const [mobileView, setMobileView] = useState("cards");
  const [mobileFilter, setMobileFilter] = useState("all");
  const [mobileSort, setMobileSort] = useState("default");
  const mobileRows = useMemo(() => {
    const filtered = rows.filter((row) => mobileFilter === "all" || (mobileFilter === "exchange" && row?.kind === "exchange") || (mobileFilter === "otc" && row?.kind === "otc") || (mobileFilter === "favorite" && row?.isFavorite));
    return [...filtered].sort((a, b) => {
      if (mobileSort === "change") return (Number(b?.changePercent) || 0) - (Number(a?.changePercent) || 0);
      if (mobileSort === "name") return String(a?.name || "").localeCompare(String(b?.name || ""), "zh-CN");
      if (Boolean(a?.isHeld) !== Boolean(b?.isHeld)) return a?.isHeld ? -1 : 1;
      return 0;
    });
  }, [rows, mobileFilter, mobileSort]);
  if (!fullTableMode) return null;

  // 桌面端 header：包含监控列表、刷新、搜索、列设置
  const renderHeader = ({ table, viewOptions, presetControls }) => {
    const filterCount = table?.getState?.().columnFilters?.length || 0;
    return (
      <div className="flex flex-col gap-3 border-b border-[#e8eaed] pb-3">
        <div className="flex items-start justify-between gap-3">
          {!searchOpen ? (
            <div className="flex min-w-0 items-end gap-3">
              <div className="min-w-0">
                <div className="text-xs font-semibold text-[#5f6368]">{marketLabel}</div>
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
            </div>
          ) : null}
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5 pt-4">
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
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#5f6368] transition hover:bg-[#f1f3f4] hover:text-[#1f1f1f]"
                >
                  <X size={16} />
                </button>
              </div>
            ) : (
              <>
                {onRefresh ? (
                  <button
                    type="button"
                    onClick={() => onRefresh?.()}
                    aria-label="刷新数据"
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#5f6368] transition hover:bg-[#f1f3f4] hover:text-[#1f1f1f]"
                  >
                    <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
                  </button>
                ) : null}
                {filterCount ? (
                  <button
                    type="button"
                    onClick={() => table.resetColumnFilters()}
                    className="inline-flex h-9 items-center gap-1.5 rounded-full border border-dashed border-[#dadce0] px-3 text-sm font-medium text-[#5f6368] transition hover:bg-[#f1f3f4] hover:text-[#1f1f1f]"
                  >
                    <X size={15} /> 重置过滤
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={onSearchToggle}
                  className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-[#5f6368] transition hover:bg-[#f1f3f4] hover:text-[#1f1f1f]"
                >
                  <Search size={16} /> {searchLabel}
                </button>
              </>
            )}
            {viewOptions}
          </div>
        </div>
        {!searchOpen ? (
          <div className="flex min-w-0 items-center">
            {presetControls}
          </div>
        ) : null}
      </div>
    );
  };

  // 移动端 header：只包含监控列表和刷新按钮
  const renderMobileHeader = () => {
    return (
      <div className="flex flex-col gap-3 border-b border-[#e8eaed] px-2 pb-3 pt-1">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-end gap-3">
            <div className="min-w-0">
              <div className="text-xs font-semibold text-[#5f6368]">{marketLabel}</div>
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
          </div>
          {onRefresh ? (
            <button
              type="button"
              onClick={() => onRefresh?.()}
              aria-label="刷新数据"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#5f6368] transition hover:bg-[#f1f3f4] hover:text-[#1f1f1f]"
            >
              <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
            </button>
          ) : null}
        </div>
      </div>
    );
  };

  // 移动端表格内部的工具栏：搜索和列设置
  const renderMobileTableChrome = ({ table, viewOptions, presetControls }) => {
    const filterCount = table?.getState?.().columnFilters?.length || 0;
    return (
      <div className="flex h-11 min-w-0 items-center justify-between gap-2 px-2">
        {searchOpen ? (
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
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
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#5f6368] transition hover:bg-[#f1f3f4] hover:text-[#1f1f1f]"
            >
              <X size={16} />
            </button>
          </div>
        ) : (
          <>
            <div className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <div className="flex min-w-max items-center gap-1.5">
                {presetControls}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {filterCount ? (
                <button
                  type="button"
                  onClick={() => table.resetColumnFilters()}
                  className="inline-flex h-8 items-center gap-1 rounded-full border border-dashed border-[#dadce0] px-2 text-xs font-medium text-[#5f6368] transition hover:bg-[#f1f3f4] hover:text-[#1f1f1f]"
                >
                  <X size={14} /> 重置
                </button>
              ) : null}
              <button
                type="button"
                onClick={onSearchToggle}
                aria-label={searchLabel}
                title={searchLabel}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[#5f6368] transition hover:bg-[#f1f3f4] hover:text-[#1f1f1f]"
              >
                <Search size={16} />
              </button>
              {viewOptions}
            </div>
          </>
        )}
      </div>
    );
  };

  if (isMobile) {
    return (
      <div className="market-mobile-list-shell lg:hidden">
        <div className="market-mobile-list-header">
          {!searchOpen ? <div className="min-w-0"><div className="text-xs font-semibold text-slate-500">{marketLabel}</div><WatchlistSelector lists={watchLists} activeListId={activeWatchListId} market={market} onSelect={onSelectWatchlist} onCreate={onCreateWatchlist} onRename={onRenameWatchlist} onDelete={onDeleteWatchlist} /></div> : <MarketSymbolSearchBox autoFocus compact inline searchValue={searchValue} searchResults={searchResults} searchLoading={searchLoading} searchError={searchError} watchSymbols={watchSymbols} marketLabel={marketLabel} onSearchChange={onSearchChange} onSearchClear={onSearchClear} onSearchResultSelect={onSearchResultSelect} onSearchResultAdd={onSearchResultAdd} />}
          <div className="flex shrink-0 items-center gap-1">{onRefresh ? <button type="button" onClick={() => onRefresh?.()} aria-label="刷新数据" className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-500"><RefreshCw size={16} className={refreshing ? "animate-spin" : ""} /></button> : null}<button type="button" onClick={onSearchToggle} aria-label={searchOpen ? `关闭${searchLabel}` : searchLabel} className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-500">{searchOpen ? <X size={16} /> : <Search size={16} />}</button></div>
        </div>
        <div className="market-mobile-toolbar" aria-label="监控列表工具栏"><div className="market-mobile-view-switch" role="tablist" aria-label="列表视图"><button type="button" role="tab" aria-selected={mobileView === "cards"} className={mobileView === "cards" ? "is-active" : ""} onClick={() => setMobileView("cards")}><LayoutGrid size={14} />卡片</button><button type="button" role="tab" aria-selected={mobileView === "table"} className={mobileView === "table" ? "is-active" : ""} onClick={() => setMobileView("table")}><Table2 size={14} />表格</button></div><button type="button" className="market-mobile-tool-button" aria-label="筛选" onClick={() => setMobileFilter((value) => value === "all" ? "exchange" : value === "exchange" ? "otc" : value === "otc" ? "favorite" : "all")}><SlidersHorizontal size={14} />筛选</button><button type="button" className="market-mobile-tool-button" aria-label="排序" onClick={() => setMobileSort((value) => value === "default" ? "change" : value === "change" ? "name" : "default")}><ArrowUpDown size={14} />排序</button><button type="button" className="market-mobile-tool-button" aria-label="列设置" title="列设置"><Columns3 size={14} /></button><button type="button" className="market-mobile-tool-button" aria-label="保存视图" title="保存视图" onClick={() => onViewPresetSave?.({ source: "mobile-toolbar", mode: mobileView })}><Bookmark size={14} /></button></div><label className="market-mobile-search"><Search size={15} /><input value={searchValue} onChange={(event) => onSearchChange?.(event.target.value)} placeholder={searchLabel === "基金搜索" ? "搜索基金名称或代码" : "搜索标的"} /><button type="button" aria-label="清空搜索" onClick={onSearchClear}><X size={14} /></button></label><div className="market-mobile-filter-chips" role="tablist" aria-label="基金分类"><button type="button" className={mobileFilter === "all" ? "is-active" : ""} onClick={() => setMobileFilter("all")}>全部</button><button type="button" className={mobileFilter === "exchange" ? "is-active" : ""} onClick={() => setMobileFilter("exchange")}>场内 ETF</button><button type="button" className={mobileFilter === "otc" ? "is-active" : ""} onClick={() => setMobileFilter("otc")}>场外基金</button><button type="button" className={mobileFilter === "favorite" ? "is-active" : ""} onClick={() => setMobileFilter("favorite")}>自选分组</button></div>
        {mobileView === "table" ? <div className="market-mobile-table-view">{mobileRows.map((row) => <button type="button" key={row.symbol} onClick={() => onSelectSymbol?.(row)}><span className="font-mono font-bold">{row.symbol}</span><span className="min-w-0 flex-1 truncate text-left">{row.name || row.symbol}</span><span className="tabular-nums">{row.price ?? "—"}</span><ChevronRight size={15} /></button>)}</div> : <div className="space-y-2">{mobileRows.map((row) => <MarketWatchlistCard key={row.symbol} row={row} kline={klineMap[row.symbol]} selected={row.symbol === selectedSymbol} onClick={onSelectSymbol} />)}</div>}
        {!rows.length ? <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">暂无监控基金</div> : null}
      </div>
    );
  }

  return (
    <div className="hidden h-full min-h-0 flex-1 flex-col overflow-hidden lg:flex">
      <MarketListTable
        key={`desktop:${viewStorageScope}`}
        rows={rows}
        klineMap={klineMap}
        selectedSymbol={selectedSymbol}
        onSelect={onSelectSymbol}
        stickyHeader
        stickyFirstColumn
        showLimitColumn={showLimitColumn}
        hidePremiumColumn={hidePremiumColumn}
        hideTrendColumn={hideTrendColumn}
        dataTable
        dataTableHeader={renderHeader}
        containerClassName="h-full min-h-0 flex-1"
        dataTableClassName="min-h-0 flex-1 overflow-hidden"
        dataTableContainerClassName="min-h-0 flex-1 overflow-auto rounded-none border-x-0 border-b-0"
        autoPinColumn
        onVisibleSymbolsChange={onVisibleSymbolsChange}
        onColumnVisibilityStateChange={onColumnVisibilityStateChange}
        onViewPresetSave={onViewPresetSave}
        viewStorageScope={viewStorageScope}
        rowTestIdPrefix="market-row"
      />
    </div>
  );
}
