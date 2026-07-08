import { useEffect } from 'react';
import { ListPlus, Loader2, Search, X } from 'lucide-react';
import { MarketListTable } from './MarketListTable.jsx';
import { ListExpandButton } from './ListExpandButton.jsx';
import { MarketSymbolSearchBox } from './MarketSymbolSearchBox.jsx';

export function ExpandedMarketListOverlay({
  open,
  rows,
  klineMap,
  selectedSymbol,
  activeName,
  marketLabel,
  onClose,
  onSelect,
  onCreate,
  loading,
  searchOpen,
  searchValue,
  searchResults,
  searchLoading,
  searchError,
  watchSymbols = [],
  onSearchToggle,
  onSearchChange,
  onSearchClear,
  onSearchResultSelect,
  onSearchResultAdd,
  showLimitColumn = false,
  hidePremiumColumn = false,
  hideTrendColumn = false,
  onVisibleSymbolsChange,
  onColumnVisibilityStateChange,
  onViewPresetSave,
}) {
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[115] hidden bg-white/98 px-5 pb-5 pt-3 backdrop-blur-sm lg:block">
      <div className="flex h-full w-full flex-col gap-3">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[#e8eaed] pb-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#5f6368]">
              <span>{marketLabel}</span>
              {loading ? <Loader2 size={12} className="animate-spin" /> : null}
            </div>
            <h2 className="mt-1 truncate text-[22px] font-semibold text-[#1f1f1f]">{activeName || '监控列表'}</h2>
          </div>
          <div className="flex items-center gap-1.5">
            {searchOpen ? (
              <div className="flex w-[360px] items-center gap-1.5">
                <MarketSymbolSearchBox
                  autoFocus
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
                  aria-label="关闭基金搜索"
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#5f6368] transition hover:bg-[#f1f3f4] hover:text-[#1f1f1f]"
                >
                  <X size={16} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={onSearchToggle}
                className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-[#5f6368] transition hover:bg-[#f1f3f4] hover:text-[#1f1f1f]"
              >
                <Search size={16} /> 基金搜索
              </button>
            )}
            <button type="button" onClick={onCreate} className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-[#5f6368] hover:bg-[#f1f3f4] hover:text-[#1f1f1f]">
              <ListPlus size={18} /> 新建列表
            </button>
            <ListExpandButton expanded onClick={onClose} />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto rounded-2xl bg-[#f8fafd] p-3">
          <MarketListTable
            rows={rows}
            klineMap={klineMap}
            selectedSymbol={selectedSymbol}
            onSelect={onSelect}
            stickyHeader
            stickyFirstColumn
            showLimitColumn={showLimitColumn}
            hidePremiumColumn={hidePremiumColumn}
            hideTrendColumn={hideTrendColumn}
            onVisibleSymbolsChange={onVisibleSymbolsChange}
            onColumnVisibilityStateChange={onColumnVisibilityStateChange}
            onViewPresetSave={onViewPresetSave}
            dataTable
            rowTestIdPrefix="market-row-overlay"
          />
        </div>
      </div>
    </div>
  );
}
