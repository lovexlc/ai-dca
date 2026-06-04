import { MarketListTable } from './MarketListTable.jsx';
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
  showLimitColumn = false,
  hidePremiumColumn = false,
  hideTrendColumn = false,
}) {
  if (!fullTableMode) return null;

  const marketLabel = market === 'cn' ? 'A 股监控列表' : '美股监控列表';

  const renderHeader = ({ viewOptions }) => (
    <div className="flex items-center justify-between gap-3 border-b border-[#e8eaed] pb-3">
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
      <div className="shrink-0">{viewOptions}</div>
    </div>
  );

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
