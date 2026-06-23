import { Search, X, RefreshCw } from 'lucide-react';
import { MarketListTable } from './MarketListTable.jsx';
import { MarketSymbolSearchBox } from './MarketSymbolSearchBox.jsx';
import { WatchlistSelector } from './WatchlistControls.jsx';

export function MarketsFullTablePanel({
  fullTableMode = false,
  rows = [],
  activeWatchListName = '',
  watchLists = [],
  activeWatchListId = '',
  market,
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
}) {
  if (!fullTableMode) return null;

  const marketLabel = market === 'cn' ? 'A 股监控列表' : '美股监控列表';
  const searchLabel = market === 'cn' ? '基金搜索' : '标的搜索';

  // 桌面端 header：包含监控列表、刷新、搜索、列设置
  const renderHeader = ({ table, viewOptions }) => {
    const filterCount = table?.getState?.().columnFilters?.length || 0;
    return (
      <div className="flex flex-col gap-3 border-b border-[#e8eaed] pb-3">
        <div className="flex items-center justify-between gap-3">
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
          <div className="flex shrink-0 items-center gap-1.5">
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
                    onClick={onRefresh}
                    disabled={refreshing}
                    aria-label="刷新数据"
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#5f6368] transition hover:bg-[#f1f3f4] hover:text-[#1f1f1f] disabled:opacity-50"
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
      </div>
    );
  };

  // 移动端 header：只包含监控列表和刷新按钮
  const renderMobileHeader = () => {
    return (
      <div className="flex flex-col gap-3 border-b border-[#e8eaed] pb-3">
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
              onClick={onRefresh}
              disabled={refreshing}
              aria-label="刷新数据"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#5f6368] transition hover:bg-[#f1f3f4] hover:text-[#1f1f1f] disabled:opacity-50"
            >
              <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
            </button>
          ) : null}
        </div>
      </div>
    );
  };

  // 移动端表格内部的工具栏：搜索和列设置
  const renderMobileTableChrome = ({ table, viewOptions }) => {
    const filterCount = table?.getState?.().columnFilters?.length || 0;
    return (
      <div className="flex min-h-[48px] items-center justify-between gap-2 border-b border-[#e8eaed] px-3 py-2">
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
            <div className="flex items-center gap-1.5">
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
            </div>
            <div className="flex shrink-0 items-center">
              {viewOptions}
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <>
      <div className="hidden min-h-0 flex-1 flex-col lg:flex">
        <div className="min-h-0 flex-1 overflow-auto rounded-2xl bg-[#f8fafd] p-3">
          <MarketListTable
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
            autoPinColumn
          />
        </div>
      </div>

      <div className="px-3 sm:px-0 lg:hidden">
        <MarketListTable
          rows={rows}
          klineMap={klineMap}
          selectedSymbol={selectedSymbol}
          onSelect={onSelectSymbol}
          compact
          stickyFirstColumn
          dataTable
          dataTableHeader={renderMobileHeader}
          dataTableChrome={renderMobileTableChrome}
          autoPinColumn
          showLimitColumn={showLimitColumn}
          hidePremiumColumn={hidePremiumColumn}
          hideTrendColumn={hideTrendColumn}
        />
      </div>
    </>
  );
}
