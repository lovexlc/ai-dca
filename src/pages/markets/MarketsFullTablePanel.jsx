import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X, RefreshCw, LayoutGrid, Table2, SlidersHorizontal, ArrowUpDown, Columns3, Bell } from 'lucide-react';
import { MarketListTable } from './MarketListTable.jsx';
import {
  formatFeeRate,
  formatMarketPrice,
  formatPercent,
  formatPremiumPercent,
  formatRedeemFeeRate,
  formatSignedPercent,
  formatSymbolDisplay,
  formatTotalShares,
  formatTurnover,
} from './marketDisplayUtils.js';
import { MarketSymbolSearchBox } from './MarketSymbolSearchBox.jsx';
import { cx } from "../../components/experience-ui.jsx";
import { Sparkline } from '../../components/markets/Sparkline.jsx';
import { MarketGroupTabs } from "./components/MarketGroupTabs.jsx";
import { ColumnSettingsSheet } from "./components/ColumnSettingsSheet.jsx";
import { MarketFilterBuilderSheet } from "./components/MarketFilterBuilderSheet.jsx";
import { createMarketGroup, defaultMarketGroupState, deleteMarketGroup, loadMarketGroups, MARKET_COLUMN_DEFINITIONS, renameMarketGroup, saveMarketGroups, updateMarketGroup } from './marketGroups.js';
import { MarketWatchlistCard } from '../../components/mobile/MarketWatchlistCard.jsx';
import { useMobileVisibleMarketSymbols } from './useMobileVisibleMarketSymbols.js';
import { resolveCloseHighDrawdown, resolveDayHighDrawdown } from './marketHighDrawdown.js';

export function MarketsFullTablePanel({
  fullTableMode = false,
  rows = [],
  activeWatchListId = '',
  market,
  isMobile = false,
  klineMap = {},
  selectedSymbol = '',
  onSelectWatchlist,
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

  const marketLabel = market === 'cn' ? 'A 股行情' : '美股行情';
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
  const supportedGroupColumns = activeGroupColumns.filter((id) => (id !== 'limit' || showLimitColumn) && (id !== 'premium' || !hidePremiumColumn));
  const supportedCardAnalysisColumns = (activeMarketGroup?.cardAnalysisColumns || [])
    .filter((id) => (id !== 'limit' || showLimitColumn) && (id !== 'premium' || !hidePremiumColumn))
    .slice(0, 6);
  const availableGroupColumnIds = Object.keys(MARKET_COLUMN_DEFINITIONS)
    .filter((id) => (id !== 'limit' || showLimitColumn) && (id !== 'premium' || !hidePremiumColumn) && (id !== 'trend' || !hideTrendColumn));
  const activeGroupFilters = activeMarketGroup?.filters || [];
  const viewStorageScope = activeWatchListId || `${market || 'market'}:default`;
  const groupFilteredRows = useMemo(() => rows.filter((row) => activeGroupFilters.every((filter) => {
    if (filter.id === 'kind') return row?.kind === filter.value;
    if (filter.id === 'isHeld') return String(Boolean(row?.isHeld)) === String(filter.value);
    if (filter.id === 'changePercentMin') return Number(row?.changePercent) >= Number(filter.value);
    return true;
  })), [rows, activeGroupFilters]);
  const handleGroupSelect = (groupId) => {
    const group = marketGroupState.groups.find((item) => item.id === groupId);
    if (!group) return;
    setMarketGroupState(saveMarketGroups({ ...marketGroupState, activeGroupId: groupId }));
    if (group.sourceListId && group.sourceListId !== activeWatchListId) onSelectWatchlist?.(group.sourceListId);
  };
  const handleGroupCreate = () => {
    const name = window.prompt('新行情分组名称', `分组 ${marketGroupState.groups.filter((group) => group.market === market).length + 1}`);
    if (String(name || '').trim()) setMarketGroupState(createMarketGroup({ name, market, sourceListId: activeWatchListId }));
  };
  const handleGroupRename = (group) => {
    const name = window.prompt('重命名行情分组', group?.name || '');
    if (String(name || '').trim()) setMarketGroupState(renameMarketGroup(group.id, name));
  };
  const handleGroupDelete = (group) => {
    if (group && window.confirm(`确认删除“${group.name}”吗？`)) setMarketGroupState(deleteMarketGroup(group.id));
  };
  const renderGroupTabs = () => <MarketGroupTabs groups={marketGroupState.groups.filter((group) => group.market === market)} activeGroupId={activeGroupId} onSelect={handleGroupSelect} onCreate={handleGroupCreate} onRename={handleGroupRename} onDelete={handleGroupDelete} />;
  const notifyColumnPolicy = (columns, cardAnalysisColumns = activeMarketGroup?.cardAnalysisColumns, showTrend = activeMarketGroup?.showTrend) => {
    const visibleIds = new Set([...(columns || []), ...(cardAnalysisColumns || [])]);
    if (showTrend) visibleIds.add('trend');
    const visibility = Object.fromEntries(Object.keys(MARKET_COLUMN_DEFINITIONS).map((id) => [id, visibleIds.has(id)]));
    onColumnVisibilityStateChange?.(visibility);
  };
  const policyColumnsKey = supportedGroupColumns.join('|');
  const policyCardColumnsKey = supportedCardAnalysisColumns.join('|');
  useEffect(() => {
    const visibleIds = new Set([
      ...policyColumnsKey.split('|').filter(Boolean),
      ...policyCardColumnsKey.split('|').filter(Boolean),
    ]);
    if (activeMarketGroup?.showTrend) visibleIds.add('trend');
    const visibility = Object.fromEntries(Object.keys(MARKET_COLUMN_DEFINITIONS).map((id) => [id, visibleIds.has(id)]));
    onColumnVisibilityStateChange?.(visibility);
  }, [activeGroupId, activeMarketGroup?.showTrend, onColumnVisibilityStateChange, policyCardColumnsKey, policyColumnsKey]);
  const persistGroup = (patch) => {
    const next = updateMarketGroup(activeGroupId, patch);
    setMarketGroupState(next);
    notifyColumnPolicy(patch.columns || activeGroupColumns, patch.cardAnalysisColumns || activeMarketGroup?.cardAnalysisColumns, patch.showTrend ?? activeMarketGroup?.showTrend);
  };
  useEffect(() => {
    const currentGroup = marketGroupState.groups.find((group) => group.id === marketGroupState.activeGroupId);
    if (currentGroup?.market === market && currentGroup.sourceListId === activeWatchListId) return;
    const matching = marketGroupState.groups.find((group) => group.market === market && group.sourceListId === activeWatchListId);
    if (!matching || matching.id === marketGroupState.activeGroupId) return;
    setMarketGroupState(saveMarketGroups({ ...marketGroupState, activeGroupId: matching.id }));
  }, [activeWatchListId, market]);
  const [mobileView, setMobileView] = useState("cards");
  const [mobileFilter, setMobileFilter] = useState("all");
  const [mobileSort, setMobileSort] = useState("default");
  const mobileListRef = useRef(null);
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
  const mobileRowSymbols = useMemo(() => mobileRows.map((row) => row?.symbol).filter(Boolean), [mobileRows]);
  useMobileVisibleMarketSymbols({
    rootRef: mobileListRef,
    symbols: mobileRowSymbols,
    viewKey: `${activeGroupId}:${mobileView}:${mobileFilter}:${mobileSort}`,
    onVisibleSymbolsChange,
  });
  const mobileTableColumns = (activeMarketGroup?.columnOrder || supportedGroupColumns)
    .filter((id) => supportedGroupColumns.includes(id) && MARKET_COLUMN_DEFINITIONS[id]?.table);
  const mobileTableTemplate = mobileTableColumns.map((id) => ({
    kind: '72px',
    symbol: '74px',
    name: 'minmax(136px, 1fr)',
    price: '82px',
    changePercent: '88px',
    change: '86px',
    updatedAt: '108px',
    isHeld: '56px',
    isFavorite: '56px',
    alert: '48px',
    premium: '78px',
    limit: '96px',
    trend: '104px',
    highDrawdown: '88px',
    closeHighDrawdown: '108px',
    historicalPercentile: '88px',
    currentYearPercent: '88px',
    return1w: '78px',
    return1m: '78px',
    return3m: '78px',
    return6m: '78px',
    return1y: '78px',
    returnBase: '88px',
    turnover: '92px',
    totalShares: '92px',
    feeRate: '76px',
    redeemFeeRate: '88px',
  }[id] || '88px')).join(' ');
  const renderMobileTableRow = (row) => {
    const otc = row?.kind === 'otc';
    const price = Number.isFinite(Number(row?.price)) ? (otc ? `¥${Number(row.price).toFixed(4)}` : formatMarketPrice(row.price, row)) : '—';
    const delta = Number.isFinite(Number(row?.change)) ? `${Number(row.change) > 0 ? '+' : ''}${otc ? `¥${Number(row.change).toFixed(4)}` : formatMarketPrice(row.change, row)}` : '—';
    const highDrawdown = resolveDayHighDrawdown(row)?.drawdownPct;
    const closeHighDrawdown = resolveCloseHighDrawdown(row)?.drawdownPct;
    const signedValue = (value) => Number.isFinite(Number(value)) ? formatSignedPercent(value) : '—';
    const toneClass = (value) => Number(value) > 0 ? 'text-rose-600' : Number(value) < 0 ? 'text-emerald-600' : 'text-slate-500';
    const values = {
      kind: <span className="market-mobile-table-view__kind">{otc ? '场外基金' : '场内 ETF'}</span>,
      symbol: <span className="font-mono font-bold">{formatSymbolDisplay(row.symbol)}</span>,
      name: <span className="min-w-0 truncate text-left"><b>{row.name || row.symbol}</b></span>,
      price: <span className="tabular-nums">{price}</span>,
      changePercent: <span className={cx('tabular-nums', Number(row.changePercent) > 0 ? 'text-rose-600' : Number(row.changePercent) < 0 ? 'text-emerald-600' : 'text-slate-500')}>{formatPercent(row.changePercent)}</span>,
      change: <span className="tabular-nums">{delta}</span>,
      updatedAt: <span className="tabular-nums">{row.latestNavDate || row.updatedAt || '—'}</span>,
      isHeld: <span>{row.isHeld ? '持仓' : '—'}</span>,
      isFavorite: <span>{row.isFavorite ? '自选' : '—'}</span>,
      alert: <span><Bell size={15} /></span>,
      premium: <span className="tabular-nums">{formatPremiumPercent(row)}</span>,
      limit: <span className="tabular-nums">{row.fundLimit?.maxPurchasePerDay || '—'}</span>,
      trend: Array.isArray(klineMap[row.symbol]) && klineMap[row.symbol].length > 1 ? <Sparkline points={klineMap[row.symbol]} width={80} height={24} tone={Number(row.changePercent) > 0 ? 'up' : Number(row.changePercent) < 0 ? 'down' : 'flat'} showFill markLast /> : <span>—</span>,
      highDrawdown: <span className={cx('tabular-nums', toneClass(highDrawdown))}>{signedValue(highDrawdown)}</span>,
      closeHighDrawdown: <span className={cx('tabular-nums', toneClass(closeHighDrawdown))}>{signedValue(closeHighDrawdown)}</span>,
      historicalPercentile: <span className="tabular-nums">{Number.isFinite(Number(row.historicalPercentile)) ? `${Number(row.historicalPercentile).toFixed(2)}%` : '—'}</span>,
      currentYearPercent: <span className={cx('tabular-nums', toneClass(row.currentYearPercent ?? row.ytdReturn))}>{signedValue(row.currentYearPercent ?? row.ytdReturn)}</span>,
      return1w: <span className={cx('tabular-nums', toneClass(row.return1w))}>{signedValue(row.return1w)}</span>,
      return1m: <span className={cx('tabular-nums', toneClass(row.return1m))}>{signedValue(row.return1m)}</span>,
      return3m: <span className={cx('tabular-nums', toneClass(row.return3m))}>{signedValue(row.return3m)}</span>,
      return6m: <span className={cx('tabular-nums', toneClass(row.return6m))}>{signedValue(row.return6m)}</span>,
      return1y: <span className={cx('tabular-nums', toneClass(row.return1y))}>{signedValue(row.return1y)}</span>,
      returnBase: <span className={cx('tabular-nums', toneClass(row.returnBase))}>{signedValue(row.returnBase)}</span>,
      turnover: <span className="tabular-nums">{formatTurnover(row.turnover ?? row.amount)}</span>,
      totalShares: <span className="tabular-nums">{formatTotalShares(row.totalShares)}</span>,
      feeRate: <span className="tabular-nums">{formatFeeRate(row)}</span>,
      redeemFeeRate: <span className="tabular-nums">{formatRedeemFeeRate(row)}</span>,
    };
    return <button type="button" key={row.symbol} data-market-symbol={row.symbol} onClick={() => onSelectSymbol?.(row)} aria-label={`查看 ${row.name || row.symbol} 行情详情`}>{mobileTableColumns.map((id) => <span key={id}>{values[id]}</span>)}</button>;
  };
  if (!fullTableMode) return null;

  // 桌面端 header：分组、刷新、搜索和列设置
  const renderHeader = ({ table, viewOptions, presetControls }) => {
    const filterCount = table?.getState?.().columnFilters?.length || 0;
    return (
      <div className="flex flex-col gap-3 border-b border-[#e8eaed] pb-3">
        <div className="flex items-start justify-between gap-3">
          {!searchOpen ? (
            <div className="flex min-w-0 items-end gap-3">
              <div className="min-w-0">
                <div className="text-xs font-semibold text-[#5f6368]">{marketLabel}</div>
                {renderGroupTabs()}
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

  if (isMobile) {
    return (
      <div ref={mobileListRef} className="market-mobile-list-shell lg:hidden">
        <div className="market-mobile-list-header">
          {searchOpen ? (
            <>
              <MarketSymbolSearchBox autoFocus compact inline searchValue={searchValue} searchResults={searchResults} searchLoading={searchLoading} searchError={searchError} watchSymbols={watchSymbols} marketLabel={marketLabel} onSearchChange={onSearchChange} onSearchClear={onSearchClear} onSearchResultSelect={onSearchResultSelect} onSearchResultAdd={onSearchResultAdd} />
              <button type="button" onClick={onSearchToggle} aria-label={`关闭${searchLabel}`} className="market-mobile-header-action"><X size={16} /></button>
            </>
          ) : (
            <>
              <div className="min-w-0 flex-1">{renderGroupTabs()}</div>
              {onRefresh ? <button type="button" onClick={() => onRefresh?.()} aria-label="刷新数据" className="market-mobile-header-action"><RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} /></button> : null}
            </>
          )}
        </div>
        <div className="market-mobile-toolbar" aria-label="行情工具栏">
          <div className="market-mobile-view-switch" role="tablist" aria-label="视图">
            <button type="button" role="tab" aria-selected={mobileView === 'cards'} className={mobileView === 'cards' ? 'is-active' : ''} onClick={() => { setMobileView('cards'); persistGroup({ view: 'cards' }); }}><LayoutGrid size={14} />卡片</button>
            <button type="button" role="tab" aria-selected={mobileView === 'table'} className={mobileView === 'table' ? 'is-active' : ''} onClick={() => { setMobileView('table'); persistGroup({ view: 'table' }); }}><Table2 size={14} />表格</button>
          </div>
          <button type="button" className="market-mobile-tool-button" aria-label="筛选" onClick={() => setFilterSheetOpen(true)}><SlidersHorizontal size={14} />筛选</button>
          <button type="button" className="market-mobile-tool-button" aria-label="排序" onClick={() => { const next = mobileSort === 'default' ? 'change' : mobileSort === 'change' ? 'name' : 'default'; setMobileSort(next); persistGroup({ sorting: [{ id: next === 'default' ? 'heldRank' : next === 'change' ? 'changePercent' : 'name', desc: true }] }); }}><ArrowUpDown size={14} />排序</button>
          <button type="button" className="market-mobile-tool-button" aria-label="自定义卡片内容" onClick={() => setColumnSheetOpen(true)}><Columns3 size={14} />自定义</button>
        </div>
        {mobileRows.length ? (
          mobileView === 'table' ? (
            <div className="market-mobile-table-view" style={{ '--market-mobile-table-columns': mobileTableTemplate }}>
              <div className="market-mobile-table-view__header" role="row">{mobileTableColumns.map((id) => <span key={id}>{MARKET_COLUMN_DEFINITIONS[id]?.label || id}</span>)}</div>
              {mobileRows.map(renderMobileTableRow)}
            </div>
          ) : (
            <div className="market-mobile-card-list">{mobileRows.map((row) => <MarketWatchlistCard key={row.symbol} row={row} kline={klineMap[row.symbol]} selected={row.symbol === selectedSymbol} onClick={onSelectSymbol} columns={supportedGroupColumns} cardAnalysisColumns={supportedCardAnalysisColumns} showTrend={activeMarketGroup?.showTrend} />)}</div>
          )
        ) : <div className="market-mobile-empty-state">暂无监控基金</div>}
        <ColumnSettingsSheet
          open={columnSheetOpen}
          columns={supportedGroupColumns}
          availableColumnIds={availableGroupColumnIds}
          columnOrder={activeMarketGroup?.columnOrder}
          columnSizing={activeMarketGroup?.columnSizing}
          cardAnalysisColumns={supportedCardAnalysisColumns}
          showTrend={activeMarketGroup?.showTrend}
          onClose={() => setColumnSheetOpen(false)}
          onChange={(columns) => persistGroup({ columns })}
          onOrderChange={(columnOrder) => persistGroup({ columnOrder })}
          onSizingChange={(columnSizing) => persistGroup({ columnSizing })}
          onCardAnalysisChange={(cardAnalysisColumns) => persistGroup({ cardAnalysisColumns })}
          onTrendChange={(showTrend) => persistGroup({ showTrend })}
          onReset={() => persistGroup({ ...defaultMarketGroupState() })}
        />
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
      </div>
    );
  }

  return (
    <div className="hidden h-full min-h-0 flex-1 flex-col overflow-hidden lg:flex">
      <MarketListTable
        key={`desktop:${viewStorageScope}`}
        rows={groupFilteredRows}
        marketColumnIds={supportedGroupColumns}
        marketColumnOrder={activeMarketGroup?.columnOrder}
        marketColumnSizing={activeMarketGroup?.columnSizing}
        marketColumnPinning={activeMarketGroup?.columnPinning}
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
