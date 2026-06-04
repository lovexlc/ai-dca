import { Search, X } from 'lucide-react';
import { cx } from '../../components/experience-ui.jsx';
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
}) {
  if (!fullTableMode) return null;

  const marketLabel = market === 'cn' ? 'A 股监控列表' : '美股监控列表';

  const renderHeader = ({ table, viewOptions }) => {
    const filterCount = table?.getState?.().columnFilters?.length || 0;
    return (
      <div className="flex flex-col gap-3 border-b border-[#e8eaed] pb-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-end gap-3">
            <div className="min-w-0">
              <div className="text-xs font-semibold text-[#5f6368]">{marketLabel}</div>
              <WatchlistSelector
                lists={watchLists}
                activeListId={activeWatchListId}
                onSelect={onSelectWatchlist}
                onCreate={onCreateWatchlist}
                onRename={onRenameWatchlist}
                onDelete={onDeleteWatchlist}
              />
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
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
              className={cx('inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition', searchOpen ? 'bg-[#e8f0fe] text-[#1a73e8]' : 'text-[#5f6368] hover:bg-[#f1f3f4] hover:text-[#1f1f1f]')}
            >
              <Search size={16} /> 基金搜索
            </button>
            {viewOptions}
          </div>
        </div>
        {searchOpen ? (
          <MarketSymbolSearchBox
            autoFocus
            compact
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
        ) : null}
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

      <div className="lg:hidden">
        <MarketListTable
          rows={rows}
          klineMap={klineMap}
          selectedSymbol={selectedSymbol}
          onSelect={onSelectSymbol}
          compact
          stickyFirstColumn
          dataTable
          dataTableHeader={renderHeader}
          autoPinColumn
          showLimitColumn={showLimitColumn}
          hidePremiumColumn={hidePremiumColumn}
          hideTrendColumn={hideTrendColumn}
        />
      </div>
    </>
  );
}
