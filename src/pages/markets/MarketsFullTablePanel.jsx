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

  return (
    <>
      <div className="hidden min-h-0 flex-1 flex-col gap-3 lg:flex">
        <div className="flex items-center justify-between gap-3 border-b border-[#e8eaed] pb-3">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-[#5f6368]">{marketLabel}</div>
            <h2 className="mt-1 truncate text-[22px] font-semibold text-[#1f1f1f]">{activeWatchListName || '监控列表'}</h2>
          </div>
          <WatchlistSelector
            lists={watchLists}
            activeListId={activeWatchListId}
            onSelect={onSelectWatchlist}
            onCreate={onCreateWatchlist}
            onRename={onRenameWatchlist}
            onDelete={onDeleteWatchlist}
          />
        </div>
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
          />
        </div>
      </div>

      <div className="lg:hidden">
        <div className="mb-2 flex items-center justify-between gap-3 border-b border-[#e8eaed] px-1 pb-2">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold text-[#5f6368]">{marketLabel}</div>
            <h2 className="truncate text-base font-semibold text-[#1f1f1f]">{activeWatchListName || '监控列表'}</h2>
          </div>
          <WatchlistSelector
            lists={watchLists}
            activeListId={activeWatchListId}
            onSelect={onSelectWatchlist}
            onCreate={onCreateWatchlist}
            onRename={onRenameWatchlist}
            onDelete={onDeleteWatchlist}
          />
        </div>
        <MarketListTable
          rows={rows}
          klineMap={klineMap}
          selectedSymbol={selectedSymbol}
          onSelect={onSelectSymbol}
          compact
          stickyFirstColumn
          dataTable
          showLimitColumn={showLimitColumn}
          hidePremiumColumn={hidePremiumColumn}
          hideTrendColumn={hideTrendColumn}
        />
      </div>
    </>
  );
}
