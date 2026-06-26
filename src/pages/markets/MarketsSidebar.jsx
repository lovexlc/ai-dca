import { ChevronDown, ChevronRight, ChevronUp, ListPlus, Loader2, Search, Star, TrendingUp, X, Clock, TrendingUp as Hot } from 'lucide-react';
import { TextInput, cx } from '../../components/experience-ui.jsx';
import { formatSymbolDisplay } from './marketDisplayUtils.js';
import { ListExpandButton } from './ListExpandButton.jsx';
import { MarketListTable } from './MarketListTable.jsx';
import { MobileSidebarRow, SidebarRow } from './MarketSidebarRows.jsx';
import { WatchlistSelector } from './WatchlistControls.jsx';
import { getSearchSuggestions } from './marketsSearchHistory.js';

function SymbolSearchResults({
  compact = false,
  market,
  loading,
  error,
  results,
  onPick,
  searchQuery = '',
}) {
  if (loading) {
    return (
      <div className={cx('flex items-center gap-2 px-3 py-2 text-[#5f6368]', compact ? 'text-xs' : 'text-sm')}>
        <Loader2 size={compact ? 13 : 14} className="animate-spin" />
        搜索中…
      </div>
    );
  }
  if (error) {
    return <div className={cx('px-3 py-2 text-rose-600', compact ? 'text-xs' : 'text-sm')}>{error}</div>;
  }

  // 当没有搜索内容时，显示搜索历史和热门推荐
  if (!searchQuery || searchQuery.trim().length === 0) {
    const suggestions = getSearchSuggestions(market);
    if (!suggestions.length) return null;

    const history = suggestions.filter(item => item.timestamp);
    const popular = suggestions.filter(item => !item.timestamp);

    return (
      <div className="divide-y divide-[#e8eaed]">
        {history.length > 0 && (
          <div className="px-3 py-2">
            <div className={cx('mb-2 flex items-center gap-1.5 text-[#5f6368]', compact ? 'text-xs' : 'text-sm')}>
              <Clock size={compact ? 12 : 14} />
              <span className="font-medium">最近搜索</span>
            </div>
            <ul className="space-y-1">
              {history.map((item) => (
                <li key={item.symbol}>
                  <button
                    type="button"
                    className={cx(
                      'flex w-full items-center justify-between rounded text-left hover:bg-[#f8fafd]',
                      compact ? 'gap-2 px-2 py-1.5' : 'gap-3 px-2 py-2'
                    )}
                    onClick={() => onPick({ symbol: item.symbol, name: item.name, market: item.market })}
                  >
                    <span className="min-w-0 flex-1">
                      <span className={cx('block truncate font-semibold text-[#1f1f1f]', compact ? 'text-xs' : 'text-sm')}>{formatSymbolDisplay(item.symbol)}</span>
                      {item.name && <span className={cx('block truncate text-[#5f6368]', compact ? 'text-[11px]' : 'text-xs')}>{item.name}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {popular.length > 0 && (
          <div className="px-3 py-2">
            <div className={cx('mb-2 flex items-center gap-1.5 text-[#5f6368]', compact ? 'text-xs' : 'text-sm')}>
              <Hot size={compact ? 12 : 14} />
              <span className="font-medium">热门基金</span>
            </div>
            <ul className="space-y-1">
              {popular.map((item) => (
                <li key={item.symbol}>
                  <button
                    type="button"
                    className={cx(
                      'flex w-full items-center justify-between rounded text-left hover:bg-[#f8fafd]',
                      compact ? 'gap-2 px-2 py-1.5' : 'gap-3 px-2 py-2'
                    )}
                    onClick={() => onPick({ symbol: item.symbol, name: item.name, market: item.market })}
                  >
                    <span className="min-w-0 flex-1">
                      <span className={cx('block truncate font-semibold text-[#1f1f1f]', compact ? 'text-xs' : 'text-sm')}>{formatSymbolDisplay(item.symbol)}</span>
                      {item.name && <span className={cx('block truncate text-[#5f6368]', compact ? 'text-[11px]' : 'text-xs')}>{item.name}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  if (!results.length) {
    return <div className={cx('px-3 py-2 text-[#5f6368]', compact ? 'text-xs' : 'text-sm')}>没有找到匹配标的</div>;
  }

  return (
    <ul className="divide-y divide-[#e8eaed]">
      {results.map((row) => (
        <li key={`${row.market || market}:${row.symbol}`}>
          <button
            type="button"
            className={cx(
              'flex w-full items-center justify-between text-left hover:bg-[#f8fafd]',
              compact ? 'gap-2 px-3 py-2' : 'gap-3 px-3 py-2'
            )}
            onClick={() => onPick(row)}
          >
            <span className="min-w-0">
              <span className={cx('block truncate font-semibold text-[#1f1f1f]', compact ? 'text-xs' : 'text-sm')}>{formatSymbolDisplay(row.symbol)}</span>
              <span className={cx('block truncate text-[#5f6368]', compact ? 'text-[11px]' : 'text-xs')}>
                {row.marketLabel ? `${row.marketLabel} · ` : ''}{row.name || row.exchange || '--'}
              </span>
            </span>
            <span className={cx(
              'shrink-0 rounded-full bg-[#e8f0fe] font-semibold text-[#1a73e8]',
              compact ? 'px-2 py-0.5 text-[11px]' : 'px-2 py-1 text-xs'
            )}>
              查看
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function MarketsSidebar({
  market,
  selectedSymbol,
  watchLists,
  activeWatchListId,
  watchListExpanded,
  watchOpen,
  sectorsOpen,
  sectorSearchOpen,
  symbolInput,
  symbolSearchResults,
  symbolSearchLoading,
  symbolSearchError,
  activeSidebarRows,
  activeSidebarEmptyText,
  klineMap,
  watchLoading,
  sectors,
  sectorsLoading,
  onSelectWatchlist,
  onCreateWatchlist,
  onRenameWatchlist,
  onDeleteWatchlist,
  onAddPopular,
  onToggleWatchListExpanded,
  onToggleWatchOpen,
  onToggleSectorsOpen,
  onOpenSectorSearch,
  onCloseSectorSearch,
  onSymbolInputChange,
  onSubmitSymbol,
  onPickSymbolSearch,
  onSelectSymbol,
  showLimitColumn = false,
  hidePremiumColumn = false,
  hideTrendColumn = false,
  mobileHidden = false,
  desktopHidden = false,
}) {
  const sectorEmptyText = sectorsLoading ? '加载中…' : (market === 'cn' ? '可搜索并添加更多 A股 / ETF 标的' : '暂无数据');
  return (
    <>
      <aside className={cx('order-2 flex flex-col gap-2 lg:hidden', (mobileHidden || selectedSymbol) && 'hidden')}>
        <div className="px-1">
          <div className="flex items-center justify-between pt-1">
            <WatchlistSelector
              lists={watchLists}
              activeListId={activeWatchListId}
              market={market}
              onSelect={onSelectWatchlist}
              onCreate={onCreateWatchlist}
              onRename={onRenameWatchlist}
              onDelete={onDeleteWatchlist}
              onAddPopular={onAddPopular}
            />
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="新建列表"
                onClick={onCreateWatchlist}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full text-[#5f6368] hover:bg-[#f1f3f4]"
              >
                <ListPlus size={22} />
              </button>
            </div>
          </div>
          <div className="mt-1 h-px w-full bg-[#e8eaed]" />
        </div>

        <div className="px-1">
          <div className="flex items-center justify-between py-2">
            <h3 className="text-base font-semibold text-[#1f1f1f]">监控列表</h3>
            <button
              type="button"
              onClick={onToggleWatchOpen}
              aria-label={watchOpen ? '折叠' : '展开'}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[#5f6368] hover:bg-[#f1f3f4]"
            >
              {watchOpen ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
            </button>
          </div>
          {watchOpen && (
            activeSidebarRows.length === 0 ? (
              <p className="px-2 py-2 text-sm text-[#5f6368]">{activeSidebarEmptyText}</p>
            ) : (
              <MarketListTable
                rows={activeSidebarRows}
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
            )
          )}
        </div>

        <div className="px-1">
          <div className="flex items-center justify-between gap-2 py-2">
            {sectorSearchOpen ? (
              <form className="flex min-w-0 flex-1 items-center" onSubmit={onSubmitSymbol}>
                <div className="relative min-w-0 flex-1">
                  <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#5f6368]" />
                  <TextInput
                    autoFocus
                    className="h-10 w-full rounded-full border-[#dadce0] bg-white pl-9 pr-9 text-sm"
                    value={symbolInput}
                    onChange={(e) => onSymbolInputChange(e.target.value)}
                    placeholder={market === 'cn' ? '搜索 ETF / 股票，如 513100 / 标普500' : '搜索股票，如 AAPL / Apple'}
                  />
                  <button
                    type="button"
                    aria-label="关闭搜索"
                    className="absolute right-1.5 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-[#5f6368] hover:bg-[#f1f3f4]"
                    onClick={onCloseSectorSearch}
                  >
                    <X size={15} />
                  </button>
                </div>
              </form>
            ) : (
              <h3 className="text-base font-semibold text-[#1f1f1f]">{market === 'cn' ? 'ETF / 股票' : '股票板块'}</h3>
            )}
            <div className="flex shrink-0 items-center gap-0.5">
              {!sectorSearchOpen && (
                <button
                  type="button"
                  onClick={onOpenSectorSearch}
                  aria-label="搜索并添加自选"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[#5f6368] hover:bg-[#f1f3f4]"
                >
                  <Search size={19} />
                </button>
              )}
              <button
                type="button"
                onClick={onToggleSectorsOpen}
                aria-label={sectorsOpen ? '折叠' : '展开'}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[#5f6368] hover:bg-[#f1f3f4]"
              >
                {sectorsOpen ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
              </button>
            </div>
          </div>
          {sectorsOpen && sectorSearchOpen && (
            <div className="mb-2 rounded-2xl border border-[#e8eaed] bg-white shadow-sm">
              <SymbolSearchResults
                market={market}
                loading={symbolSearchLoading}
                error={symbolSearchError}
                results={symbolSearchResults}
                onPick={onPickSymbolSearch}
                searchQuery={symbolInput}
              />
            </div>
          )}
          {sectorsOpen && (
            sectors.length === 0 ? (
              <p className="px-2 py-2 text-sm text-[#5f6368]">{sectorEmptyText}</p>
            ) : (
              <ul className="divide-y divide-[#e8eaed]">
                {sectors.map((row) => (
                  <MobileSidebarRow
                    key={row.symbol}
                    symbol={row.shortCode || row.symbol}
                    name={row.name}
                    price={row.price}
                    changePercent={row.changePercent}
                    sparkPoints={klineMap[row.symbol]}
                    isHeld={row.isHeld}
                  />
                ))}
              </ul>
            )
          )}
        </div>
      </aside>

      <aside className={cx('order-2 hidden flex-col gap-3 lg:order-1 lg:flex lg:h-full lg:min-h-0 lg:overflow-hidden', desktopHidden && 'lg:hidden')}>
        <div className="flex h-full min-h-0 flex-col overflow-y-auto overscroll-contain bg-transparent pr-1 [scrollbar-gutter:stable]">
          <div className="flex items-center justify-between gap-1 px-1 py-2">
            <WatchlistSelector
              lists={watchLists}
              activeListId={activeWatchListId}
              market={market}
              onSelect={onSelectWatchlist}
              onCreate={onCreateWatchlist}
              onRename={onRenameWatchlist}
              onDelete={onDeleteWatchlist}
              onAddPopular={onAddPopular}
            />
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="新建列表"
                title="新建列表"
                onClick={onCreateWatchlist}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[#5f6368] hover:bg-[#f1f3f4] hover:text-[#1f1f1f]"
              >
                <ListPlus size={19} />
              </button>
              <ListExpandButton expanded={watchListExpanded} onClick={onToggleWatchListExpanded} />
            </div>
          </div>

          <div className="px-1 pt-1">
            <button
              type="button"
              onClick={onToggleWatchOpen}
              className="flex w-full items-center gap-1.5 rounded-md px-2 py-2 text-[15px] font-medium text-[#1f1f1f] hover:bg-[#f1f3f4]"
            >
              {watchOpen ? <ChevronDown size={16} className="text-[#5f6368]" /> : <ChevronRight size={16} className="text-[#5f6368]" />}
              <Star size={14} className="text-amber-400" />
              <span>监控列表</span>
              {watchLoading && <Loader2 size={12} className="ml-1 animate-spin text-slate-400" />}
            </button>
          </div>
          {watchOpen && (
            <div className="px-1 pb-1">
              {activeSidebarRows.length === 0 ? (
                <p className="px-2 py-1 text-xs text-slate-400">{activeSidebarEmptyText}</p>
              ) : (
                <ul>
                  {activeSidebarRows.map((row) => (
                    <SidebarRow
                      key={row.symbol}
                      symbol={row.symbol}
                      name={row.name}
                      price={row.price}
                      changePercent={row.changePercent}
                      sparkPoints={klineMap[row.symbol]}
                      meta={row.meta}
                      isHeld={row.isHeld}
                      selected={row.symbol === selectedSymbol}
                      onSelect={() => onSelectSymbol(row)}
                    />
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="border-t border-slate-200/60 px-1 pt-1">
            <div className={cx('flex items-center gap-1 rounded-md', !sectorSearchOpen && 'hover:bg-[#f1f3f4]')}>
              {sectorSearchOpen ? (
                <form className="flex min-w-0 flex-1 items-center gap-2 py-1" onSubmit={onSubmitSymbol}>
                  <button type="button" onClick={onToggleSectorsOpen} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#5f6368] hover:bg-[#f1f3f4]">
                    {sectorsOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </button>
                  <div className="relative min-w-0 flex-1">
                    <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#5f6368]" />
                    <TextInput
                      autoFocus
                      className="h-8 w-full rounded-full border-[#dadce0] bg-white pl-8 pr-8 text-sm"
                      value={symbolInput}
                      onChange={(e) => onSymbolInputChange(e.target.value)}
                      placeholder={market === 'cn' ? '513100 / 标普500' : 'AAPL / Apple'}
                    />
                    <button
                      type="button"
                      aria-label="关闭搜索"
                      className="absolute right-1 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-[#5f6368] hover:bg-[#f1f3f4]"
                      onClick={onCloseSectorSearch}
                    >
                      <X size={13} />
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={onToggleSectorsOpen}
                    className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-2 text-left text-[15px] font-medium text-[#1f1f1f]"
                  >
                    {sectorsOpen ? <ChevronDown size={16} className="text-[#5f6368]" /> : <ChevronRight size={16} className="text-[#5f6368]" />}
                    <TrendingUp size={14} className="text-indigo-400" />
                    <span>{market === 'cn' ? 'ETF / 股票' : '股票板块'}</span>
                    {sectorsLoading && <Loader2 size={12} className="ml-1 animate-spin text-slate-400" />}
                  </button>
                  <button
                    type="button"
                    title="搜索并添加自选"
                    aria-label="搜索并添加自选"
                    onClick={onOpenSectorSearch}
                    className="mr-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#5f6368] hover:bg-white"
                  >
                    <Search size={16} />
                  </button>
                </>
              )}
            </div>
          </div>
          {sectorsOpen && (
            <div className="px-1 pb-2 pt-1">
              {sectorSearchOpen && (
                <div className="mb-2 overflow-hidden rounded-xl border border-[#e8eaed] bg-white shadow-sm">
                  <SymbolSearchResults
                    compact
                    market={market}
                    loading={symbolSearchLoading}
                    error={symbolSearchError}
                    results={symbolSearchResults}
                    onPick={onPickSymbolSearch}
                    searchQuery={symbolInput}
                  />
                </div>
              )}
              {sectors.length === 0 ? (
                <p className="px-2 py-1 text-xs text-slate-400">{sectorEmptyText}</p>
              ) : (
                <ul>
                  {sectors.map((row) => (
                    <SidebarRow
                      key={row.symbol}
                      symbol={row.shortCode || row.symbol}
                      name={row.name}
                      price={row.price}
                      changePercent={row.changePercent}
                      sparkPoints={klineMap[row.symbol]}
                    />
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
