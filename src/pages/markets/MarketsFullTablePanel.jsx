import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X, RefreshCw, LayoutGrid, Table2, SlidersHorizontal, ArrowUpDown, Columns3, Bell, Plus } from 'lucide-react';
import { MarketListTable } from './MarketListTable.jsx';
import { isNativeApp } from '../../app/platform.js';
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
import { MarketDesktopHeader } from './components/MarketDesktopHeader.jsx';
import { ColumnSettingsSheet } from "./components/ColumnSettingsSheet.jsx";
import { MarketFilterBuilderSheet } from "./components/MarketFilterBuilderSheet.jsx";
import { MarketSortSheet } from "./components/MarketSortSheet.jsx";
import { createMarketGroup, defaultMarketGroupState, deleteMarketGroup, loadMarketGroups, MARKET_COLUMN_DEFINITIONS, renameMarketGroup, saveMarketGroups, updateMarketGroup } from './marketGroups.js';
import { MarketWatchlistCard } from '../../components/mobile/MarketWatchlistCard.jsx';
import { useMobileVisibleMarketSymbols } from './useMobileVisibleMarketSymbols.js';
import { resolveCloseHighDrawdown, resolveDayHighDrawdown } from './marketHighDrawdown.js';
import { compareMarketRows, DEFAULT_MARKET_SORTING, normalizeMarketSorting } from './marketListSorting.js';
import { getMarketFilterGroups, matchesMarketFilters } from './marketListFilters.js';
import { DEFAULT_MARKET_COLUMNS } from './marketColumns.js';

const DESKTOP_DEFAULT_COLUMNS = ['kind', 'symbol', 'name', 'price', 'changePercent', 'change', 'premium'];

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
  const usesLegacyDefaultColumns = activeGroupColumns.length === DEFAULT_MARKET_COLUMNS.length && activeGroupColumns.every((id, index) => id === DEFAULT_MARKET_COLUMNS[index]);
  const desktopGroupColumns = usesLegacyDefaultColumns ? DESKTOP_DEFAULT_COLUMNS : activeGroupColumns;
  const supportedGroupColumns = activeGroupColumns.filter((id) => (id !== 'limit' || showLimitColumn) && (id !== 'premium' || !hidePremiumColumn));
  const supportedDesktopGroupColumns = desktopGroupColumns.filter((id) => (id !== 'limit' || showLimitColumn) && (id !== 'premium' || !hidePremiumColumn));
  const desktopColumnOrder = usesLegacyDefaultColumns
    ? [...DESKTOP_DEFAULT_COLUMNS, ...(activeMarketGroup?.columnOrder || []).filter((id) => !DESKTOP_DEFAULT_COLUMNS.includes(id))]
    : activeMarketGroup?.columnOrder;
  const supportedCardAnalysisColumns = (activeMarketGroup?.cardAnalysisColumns || [])
    .filter((id) => (id !== 'limit' || showLimitColumn) && (id !== 'premium' || !hidePremiumColumn))
    .slice(0, 6);
  const availableGroupColumnIds = Object.keys(MARKET_COLUMN_DEFINITIONS)
    .filter((id) => (id !== 'limit' || showLimitColumn) && (id !== 'premium' || !hidePremiumColumn) && (id !== 'trend' || !hideTrendColumn));
  const activeGroupFilters = activeMarketGroup?.filters || [];
  const viewStorageScope = activeWatchListId || `${market || 'market'}:default`;
  const groupFilteredRows = useMemo(() => rows.filter((row) => matchesMarketFilters(row, activeGroupFilters)), [rows, activeGroupFilters]);
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
  const [mobileSorting, setMobileSorting] = useState(DEFAULT_MARKET_SORTING);
  const [desktopSorting, setDesktopSorting] = useState(DEFAULT_MARKET_SORTING);
  const [sortSheetOpen, setSortSheetOpen] = useState(false);
  const mobileListRef = useRef(null);
  useEffect(() => {
    const nextSorting = normalizeMarketSorting(activeMarketGroup?.sorting);
    setMobileView(activeMarketGroup?.view === "table" ? "table" : "cards");
    setMobileSorting(nextSorting);
    setDesktopSorting(nextSorting);
  }, [activeGroupId, activeMarketGroup?.sorting]);
  const mobileRows = useMemo(() => {
    const filtered = groupFilteredRows.filter((row) => mobileFilter === "all" || (mobileFilter === "exchange" && row?.kind === "exchange") || (mobileFilter === "otc" && row?.kind === "otc") || (mobileFilter === "favorite" && row?.isFavorite));
    return [...filtered].sort((a, b) => compareMarketRows(a, b, mobileSorting));
  }, [groupFilteredRows, mobileFilter, mobileSorting]);
  const isOtcGroup = activeWatchListId === 'default-otc' || activeMarketGroup?.sourceListId === 'default-otc';
  const desktopView = activeMarketGroup?.desktopView === "cards" ? "cards" : "table";
  const desktopRows = useMemo(() => {
    const query = String(searchValue || '').trim().toLowerCase();
    if (!query || !searchOpen) return groupFilteredRows;
    return groupFilteredRows.filter((row) => [row?.symbol, row?.name, row?.meta].some((value) => String(value || '').toLowerCase().includes(query)));
  }, [groupFilteredRows, searchOpen, searchValue]);
  const filterLabels = useMemo(() => {
    const groups = getMarketFilterGroups({ isOtc: isOtcGroup });
    return activeGroupFilters.map((filter) => {
      const group = groups.find((item) => item.id === filter.id);
      const option = group?.options.find(([value]) => value === filter.value);
      return { key: filter.id + ":" + filter.value, label: option?.[1] || group?.label || String(filter.value) };
    });
  }, [activeGroupFilters, isOtcGroup]);
  const handleDesktopSortingChange = (nextSorting) => {
    const resolved = typeof nextSorting === 'function' ? nextSorting(desktopSorting) : nextSorting;
    const normalized = normalizeMarketSorting(resolved);
    setDesktopSorting(normalized);
    persistGroup({ sorting: normalized });
  };
  const mobileRowSymbols = useMemo(() => mobileRows.map((row) => row?.symbol).filter(Boolean), [mobileRows]);
  useMobileVisibleMarketSymbols({
    rootRef: mobileListRef,
    symbols: mobileRowSymbols,
    viewKey: `${activeGroupId}:${mobileView}:${mobileFilter}:${mobileSorting.map((item) => item.id + (item.desc ? ":d" : ":a")).join(",")}`,
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

  const renderHeader = ({ presetControls }) => {
    const marketGroups = marketGroupState.groups.filter((group) => group.market === market);
    return <MarketDesktopHeader
      marketLabel={marketLabel}
      market={market}
      groups={marketGroups}
      activeGroupId={activeGroupId}
      onSelectGroup={handleGroupSelect}
      onCreateGroup={handleGroupCreate}
      searchOpen={searchOpen}
      searchValue={searchValue}
      searchResults={searchResults}
      searchLoading={searchLoading}
      searchError={searchError}
      watchSymbols={watchSymbols}
      onSearchToggle={onSearchToggle}
      onSearchChange={onSearchChange}
      onSearchClear={onSearchClear}
      onSearchResultSelect={onSearchResultSelect}
      onSearchResultAdd={onSearchResultAdd}
      onRefresh={onRefresh}
      refreshing={refreshing}
      onColumnSettings={() => setColumnSheetOpen(true)}
      onFilter={(mode, quickFilter) => {
        if (mode === 'quick' && quickFilter) persistGroup({ filters: [quickFilter] });
        else setFilterSheetOpen(true);
      }}
      onSort={() => setSortSheetOpen(true)}
      onViewChange={(view) => persistGroup({ view, desktopView: view })}
      view={desktopView}
      filterCount={activeGroupFilters.length}
      filterLabels={filterLabels}
      onRemoveFilter={(key) => persistGroup({ filters: activeGroupFilters.filter((filter) => filter.id + ':' + filter.value !== key) })}
      onClearFilters={() => persistGroup({ filters: [] })}
      resultCount={desktopRows.length}
      isOtc={isOtcGroup}
      presets={presetControls}
    />;
  };

  const desktopSheets = <>
    <ColumnSettingsSheet open={columnSheetOpen} columns={supportedGroupColumns} availableColumnIds={availableGroupColumnIds} columnOrder={activeMarketGroup?.columnOrder} columnSizing={activeMarketGroup?.columnSizing} cardAnalysisColumns={supportedCardAnalysisColumns} showTrend={activeMarketGroup?.showTrend} onClose={() => setColumnSheetOpen(false)} onChange={(columns) => persistGroup({ columns })} onOrderChange={(columnOrder) => persistGroup({ columnOrder })} onSizingChange={(columnSizing) => persistGroup({ columnSizing })} onCardAnalysisChange={(cardAnalysisColumns) => persistGroup({ cardAnalysisColumns })} onTrendChange={(showTrend) => persistGroup({ showTrend })} onReset={() => persistGroup({ ...defaultMarketGroupState() })} />
    <MarketFilterBuilderSheet open={filterSheetOpen} filters={activeGroupFilters} isOtc={isOtcGroup} resultCount={desktopRows.length} onClose={() => setFilterSheetOpen(false)} onApply={({ draft, close }) => { persistGroup({ filters: draft }); if (close) setFilterSheetOpen(false); }} onSaveGroup={(filters) => { const name = window.prompt('保存为新行情分组', (activeMarketGroup?.name || '行情') + '筛选'); if (!String(name || '').trim()) return; const createdState = createMarketGroup({ name, market, sourceListId: activeWatchListId }); const created = createdState.groups.find((group) => group.id === createdState.activeGroupId); setMarketGroupState(updateMarketGroup(created?.id, { filters, columns: activeGroupColumns, sorting: activeMarketGroup?.sorting, view: activeMarketGroup?.view, desktopView: activeMarketGroup?.desktopView })); }} />
    <MarketSortSheet open={sortSheetOpen} isOtc={isOtcGroup} sorting={desktopSorting} onClose={() => setSortSheetOpen(false)} onApply={({ draft, close }) => { handleDesktopSortingChange(draft); if (close) setSortSheetOpen(false); }} />
  </>;

  if (isMobile) {
    return (
      <div ref={mobileListRef} className="market-mobile-list-shell lg:hidden">
        <div className={cx("market-mobile-list-header", isNativeApp() ? "market-mobile-list-header--native" : "")}>
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
          <button type="button" className="market-mobile-tool-button" aria-label="排序" onClick={() => setSortSheetOpen(true)}><ArrowUpDown size={14} />排序</button>
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
          isOtc={activeWatchListId === 'default-otc' || activeMarketGroup?.sourceListId === 'default-otc'}
          resultCount={mobileRows.length}
          onClose={() => setFilterSheetOpen(false)}
          onApply={({ draft, close }) => { persistGroup({ filters: draft }); if (close) setFilterSheetOpen(false); }}
          onSaveGroup={(filters) => {
            const name = window.prompt('保存为新行情分组', `${activeMarketGroup?.name || '行情'}筛选`);
            if (!String(name || '').trim()) return;
            const createdState = createMarketGroup({ name, market, sourceListId: activeWatchListId });
            const created = createdState.groups.find((group) => group.id === createdState.activeGroupId);
            const configured = updateMarketGroup(created?.id, {
              filters,
              columns: activeGroupColumns,
              sorting: activeMarketGroup?.sorting,
              view: activeMarketGroup?.view,
            });
            setMarketGroupState(configured);
          }}
        />
        <MarketSortSheet
          isOtc={isOtcGroup}
          open={sortSheetOpen}
          sorting={mobileSorting}
          onClose={() => setSortSheetOpen(false)}
          onApply={({ draft, close }) => { setMobileSorting(draft); persistGroup({ sorting: draft }); if (close) setSortSheetOpen(false); }}
        />
      </div>
    );
  }

  return (
    <div className="market-desktop-panel hidden h-full min-h-0 flex-1 flex-col overflow-hidden lg:flex">
      {desktopView === 'cards' ? (
        <>
          <div className="market-desktop-card-header">{renderHeader({})}</div>
          <div className="market-desktop-card-list">{desktopRows.length ? desktopRows.map((row) => <MarketWatchlistCard key={row.symbol} row={row} kline={klineMap[row.symbol]} selected={row.symbol === selectedSymbol} onClick={onSelectSymbol} columns={supportedDesktopGroupColumns} cardAnalysisColumns={supportedCardAnalysisColumns} showTrend={activeMarketGroup?.showTrend} />) : <div className="market-desktop-empty">暂无符合条件的数据</div>}</div>
        </>
      ) : (
      <MarketListTable
        key={`desktop:${viewStorageScope}`}
        rows={desktopRows}
        marketColumnIds={supportedDesktopGroupColumns}
        marketColumnOrder={desktopColumnOrder}
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
        sorting={desktopSorting}
        onSortingChange={handleDesktopSortingChange}
      />
      )}
      {desktopSheets}
    </div>
  );
}
