import { useEffect, useMemo, useState } from 'react';
import { Search, X, RefreshCw, LayoutGrid, Table2, SlidersHorizontal, ArrowUpDown, Columns3, Bookmark, ChevronRight, Bell } from 'lucide-react';
import { MarketListTable } from './MarketListTable.jsx';
import { formatMarketPrice, formatPercent, formatSymbolDisplay } from "./marketDisplayUtils.js";
import { MarketSymbolSearchBox } from './MarketSymbolSearchBox.jsx';
import { WatchlistSelector } from './WatchlistControls.jsx';
import { cx } from "../../components/experience-ui.jsx";
import { MarketGroupTabs } from "./components/MarketGroupTabs.jsx";
import { ColumnSettingsSheet } from "./components/ColumnSettingsSheet.jsx";
import { MarketFilterBuilderSheet } from "./components/MarketFilterBuilderSheet.jsx";
import { createMarketGroup, defaultMarketGroupState, deleteMarketGroup, loadMarketGroups, renameMarketGroup, saveMarketGroups, updateMarketGroup } from "./marketGroups.js";
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
  const [marketGroupState, setMarketGroupState] = useState(() => loadMarketGroups());
  const [columnSheetOpen, setColumnSheetOpen] = useState(false);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const activeMarketGroup = marketGroupState.groups.find((group) => group.market === market && group.id === marketGroupState.activeGroupId)
    || marketGroupState.groups.find((group) => group.market === market && group.sourceListId === activeWatchListId)
    || marketGroupState.groups.find((group) => group.market === market)
    || marketGroupState.groups[0];
  const activeGroupId = activeMarketGroup?.id || (market === 'us' ? 'us-default' : 'cn-etf');
  const activeGroupColumns = activeMarketGroup?.columns || defaultMarketGroupState().columns;
  const activeGroupFilters = activeMarketGroup?.filters || [];
  const viewStorageScope = `${market || 'market'}:${activeGroupId}`;
  const groupFilteredRows = useMemo(() => rows.filter((row) => activeGroupFilters.every((filter) => {
    if (filter.id === 'kind') return row?.kind === filter.value;
    if (filter.id === 'isHeld') return String(Boolean(row?.isHeld)) === String(filter.value);
    if (filter.id === 'changePercentMin') return Number(row?.changePercent) >= Number(filter.value);
    return true;
  })), [rows, activeGroupFilters]);
  const persistGroup = (patch) => {
    const next = updateMarketGroup(activeGroupId, patch);
    setMarketGroupState(next);
  };
  useEffect(() => {
    if (!activeMarketGroup || activeMarketGroup.sourceListId === activeWatchListId || marketGroupState.activeGroupId === activeGroupId) return;
    const next = saveMarketGroups({ ...marketGroupState, activeGroupId });
    setMarketGroupState(next);
  }, [activeWatchListId]);
  const [mobileView, setMobileView] = useState("cards");
  const [mobileFilter, setMobileFilter] = useState("all");
  const [mobileSort, setMobileSort] = useState("default");
  useEffect(() => { setMobileView(activeMarketGroup?.view === "table" ? "table" : "cards"); setMobileSort(activeMarketGroup?.sorting?.[0]?.id === "changePercent" ? "change" : activeMarketGroup?.sorting?.[0]?.id === "name" ? "name" : "default"); }, [activeGroupId]);
  const mobileRows = useMemo(() => {
    const filtered = groupFilteredRows.filter((row) => {
      const basic = mobileFilter === "all" || (mobileFilter === "exchange" && row?.kind === "exchange") || (mobileFilter === "otc" && row?.kind === "otc") || (mobileFilter === "favorite" && row?.isFavorite);
      if (!basic) return false;
      return activeGroupFilters.every((filter) => filter.id === "kind" ? row?.kind === filter.value : filter.id === "isHeld" ? String(Boolean(row?.isHeld)) === String(filter.value) : filter.id === "changePercentMin" ? Number(row?.changePercent) >= Number(filter.value) : true);
    });
    return [...filtered].sort((a, b) => {
      if (mobileSort === "change") return (Number(b?.changePercent) || 0) - (Number(a?.changePercent) || 0);
      if (mobileSort === "name") return String(a?.name || "").localeCompare(String(b?.name || ""), "zh-CN");
      if (Boolean(a?.isHeld) !== Boolean(b?.isHeld)) return a?.isHeld ? -1 : 1;
      return 0;
    });
  }, [groupFilteredRows, mobileFilter, mobileSort]);
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
          {!searchOpen ? <div className="min-w-0"><div className="text-xs font-semibold text-slate-500">{marketLabel}</div><MarketGroupTabs
              groups={marketGroupState.groups.filter((group) => group.market === market)}
              activeGroupId={activeGroupId}
              onSelect={(groupId) => {
                const group = marketGroupState.groups.find((item) => item.id === groupId);
                const next = saveMarketGroups({ ...marketGroupState, activeGroupId: groupId });
                setMarketGroupState(next);
                onSelectWatchlist?.(group?.sourceListId || activeWatchListId);
              }}
              onCreate={() => {
                const name = window.prompt('新行情分组名称', `分组 ${marketGroupState.groups.filter((group) => group.market === market).length + 1}`);
                if (!String(name || '').trim()) return;
                const next = createMarketGroup({ name, market, sourceListId: activeWatchListId });
                const created = next.groups.find((group) => group.id === next.activeGroupId);
                setMarketGroupState(next);
                if (created?.sourceListId) onSelectWatchlist?.(created.sourceListId);
              }}
              onRename={(group) => {
                const name = window.prompt('重命名行情分组', group.name);
                if (!String(name || '').trim()) return;
                setMarketGroupState(renameMarketGroup(group.id, name));
              }}
              onDelete={(group) => {
                if (!window.confirm(`确认删除“${group.name}”吗？`)) return;
                setMarketGroupState(deleteMarketGroup(group.id));
              }}
            /></div> : <MarketSymbolSearchBox autoFocus compact inline searchValue={searchValue} searchResults={searchResults} searchLoading={searchLoading} searchError={searchError} watchSymbols={watchSymbols} marketLabel={marketLabel} onSearchChange={onSearchChange} onSearchClear={onSearchClear} onSearchResultSelect={onSearchResultSelect} onSearchResultAdd={onSearchResultAdd} />}
          <div className="flex shrink-0 items-center gap-1">{onRefresh ? <button type="button" onClick={() => onRefresh?.()} aria-label="刷新数据" className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-500"><RefreshCw size={16} className={refreshing ? "animate-spin" : ""} /></button> : null}<button type="button" onClick={onSearchToggle} aria-label={searchOpen ? `关闭${searchLabel}` : searchLabel} className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-500">{searchOpen ? <X size={16} /> : <Search size={16} />}</button></div>
        </div>
        <div className="market-mobile-toolbar" aria-label="行情工具栏"><div className="market-mobile-view-switch" role="tablist" aria-label="视图"><button type="button" role="tab" aria-selected={mobileView === "cards"} className={mobileView === "cards" ? "is-active" : ""} onClick={() => { setMobileView("cards"); persistGroup({ view: "cards" }); }}><LayoutGrid size={14} />卡片</button><button type="button" role="tab" aria-selected={mobileView === "table"} className={mobileView === "table" ? "is-active" : ""} onClick={() => { setMobileView("table"); persistGroup({ view: "table" }); }}><Table2 size={14} />表格</button></div><button type="button" className="market-mobile-tool-button" aria-label="筛选" onClick={() => setFilterSheetOpen(true)}><SlidersHorizontal size={14} />筛选</button><button type="button" className="market-mobile-tool-button" aria-label="排序" onClick={() => { const next = mobileSort === "default" ? "change" : mobileSort === "change" ? "name" : "default"; setMobileSort(next); persistGroup({ sorting: [{ id: next === "default" ? "heldRank" : next === "change" ? "changePercent" : "name", desc: true }] }); }}><ArrowUpDown size={14} />排序</button><button type="button" className="market-mobile-tool-button" aria-label="列设置" onClick={() => setColumnSheetOpen(true)}><Columns3 size={14} />列</button><button type="button" className="market-mobile-tool-button" aria-label="保存视图" onClick={() => onViewPresetSave?.({ source: "mobile-toolbar", mode: mobileView })}><Bookmark size={14} />保存</button></div>
        {mobileView === "table" ? <div className="market-mobile-table-view">{mobileRows.map((row) => { const otc = row?.kind === "otc"; const price = Number.isFinite(Number(row?.price)) ? (otc ? `¥${Number(row.price).toFixed(4)}` : formatMarketPrice(row.price, row)) : "—"; const delta = Number.isFinite(Number(row?.change)) ? `${Number(row.change) > 0 ? "+" : ""}${otc ? `¥${Number(row.change).toFixed(4)}` : formatMarketPrice(row.change, row)}` : "—"; return <button type="button" key={row.symbol} onClick={() => onSelectSymbol?.(row)}><span className="font-mono font-bold">{formatSymbolDisplay(row.symbol)}</span><span className="min-w-0 flex-1 truncate text-left"><b>{row.name || row.symbol}</b><small>{otc ? "场外基金" : "场内 ETF"}</small></span><span className="tabular-nums">{price}</span><span className={cx("tabular-nums", Number(row.changePercent) > 0 ? "text-rose-600" : Number(row.changePercent) < 0 ? "text-emerald-600" : "text-slate-500")}>{formatPercent(row.changePercent)}</span><span className="tabular-nums">{delta}</span><span className="tabular-nums">{row.latestNavDate || row.updatedAt || "—"}</span><span>{row.isHeld ? "持仓" : "—"}</span><Bell size={15} /></button>; })}</div> : <div className="space-y-2">{mobileRows.map((row) => <MarketWatchlistCard key={row.symbol} row={row} kline={klineMap[row.symbol]} selected={row.symbol === selectedSymbol} onClick={onSelectSymbol} columns={activeGroupColumns} />)}</div>}
        <ColumnSettingsSheet open={columnSheetOpen} columns={activeGroupColumns} onClose={() => setColumnSheetOpen(false)} onChange={(columns) => persistGroup({ columns })} onReset={() => persistGroup({ columns: defaultMarketGroupState().columns })} />
        <MarketFilterBuilderSheet
          open={filterSheetOpen}
          filters={activeGroupFilters}
          onClose={() => setFilterSheetOpen(false)}
          onChange={(filters) => persistGroup({ filters })}
          onSaveGroup={() => {
            const name = window.prompt('保存为新行情分组', `${activeMarketGroup?.name || '行情'}筛选`);
            if (!String(name || '').trim()) return;
            const createdState = createMarketGroup({ name, market, sourceListId: activeWatchListId });
            const created = createdState.groups.find((group) => group.id === createdState.activeGroupId);
            const configured = updateMarketGroup(created?.id, {
              filters: activeGroupFilters,
              columns: activeGroupColumns,
              sorting: activeMarketGroup?.sorting,
              view: activeMarketGroup?.view,
            });
            setMarketGroupState(configured);
          }}
        />
        {!groupFilteredRows.length ? <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">暂无监控基金</div> : null}
      </div>
    );
  }

  return (
    <div className="hidden h-full min-h-0 flex-1 flex-col overflow-hidden lg:flex">
      <MarketListTable
        key={`desktop:${viewStorageScope}`}
        rows={groupFilteredRows}
        marketColumnIds={activeGroupColumns}
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
