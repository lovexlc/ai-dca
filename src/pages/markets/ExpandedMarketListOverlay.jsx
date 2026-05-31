import { useEffect } from 'react';
import { ListPlus, Loader2, Search, X } from 'lucide-react';
import { cx } from '../../components/experience-ui.jsx';
import { MarketListTable } from './MarketListTable.jsx';
import { ListExpandButton } from './ListExpandButton.jsx';
import { formatSymbolDisplay } from './marketDisplayUtils.js';

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
    <div className="fixed bottom-0 z-[70] hidden bg-white/98 px-5 pb-5 pt-3 backdrop-blur-sm lg:left-[var(--console-active-sidebar-w)] lg:right-[var(--console-ctx-w)] lg:top-[34px] lg:block">
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
            <button
              type="button"
              onClick={onSearchToggle}
              className={cx('inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition', searchOpen ? 'bg-[#e8f0fe] text-[#1a73e8]' : 'text-[#5f6368] hover:bg-[#f1f3f4] hover:text-[#1f1f1f]')}
            >
              <Search size={16} /> 基金搜索
            </button>
            <button type="button" onClick={onCreate} className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-[#5f6368] hover:bg-[#f1f3f4] hover:text-[#1f1f1f]">
              <ListPlus size={18} /> 新建列表
            </button>
            <ListExpandButton expanded onClick={onClose} />
          </div>
        </div>
        {searchOpen ? (
          <div className="rounded-2xl border border-[#e8eaed] bg-white p-3 shadow-sm">
            <div className="flex items-center gap-2 rounded-full bg-[#f1f3f4] px-3 py-2">
              <Search size={15} className="shrink-0 text-[#5f6368]" />
              <input
                autoFocus
                value={searchValue}
                onChange={(event) => onSearchChange?.(event.target.value)}
                placeholder="搜索基金代码 / 名称，例如 513100、纳指ETF"
                className="min-w-0 flex-1 bg-transparent text-sm text-[#1f1f1f] placeholder:text-[#5f6368] focus:outline-none"
              />
              {searchValue ? (
                <button
                  type="button"
                  aria-label="清空搜索"
                  onClick={onSearchClear}
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#5f6368] hover:bg-white"
                >
                  <X size={14} />
                </button>
              ) : null}
            </div>
            {searchValue.trim() ? (
              <div className="mt-3 overflow-hidden rounded-2xl border border-[#e8eaed] bg-[#f8fafd]">
                {searchLoading ? (
                  <div className="flex items-center gap-2 px-3 py-3 text-sm text-[#5f6368]"><Loader2 size={14} className="animate-spin" />搜索中…</div>
                ) : searchError ? (
                  <div className="px-3 py-3 text-sm text-rose-600">{searchError}</div>
                ) : searchResults.length ? (
                  <ul className="divide-y divide-[#e8eaed]">
                    {searchResults.map((row) => {
                      const symbol = formatSymbolDisplay(row.symbol);
                      const displayName = row.name || row.exchange || '--';
                      const alreadyAdded = watchSymbols.includes(row.symbol);
                      return (
                        <li key={`${row.market || marketLabel}:${row.symbol}`} className="flex items-center gap-3 px-3 py-2 hover:bg-white">
                          <button
                            type="button"
                            className="min-w-0 flex-1 text-left"
                            onClick={() => onSearchResultSelect?.(row)}
                          >
                            <div className="truncate text-sm font-semibold text-[#1f1f1f]">{symbol}</div>
                            <div className="truncate text-xs text-[#5f6368]">{row.marketLabel ? `${row.marketLabel} · ` : ''}{displayName}</div>
                          </button>
                          <button
                            type="button"
                            onClick={() => onSearchResultAdd?.(row)}
                            disabled={alreadyAdded}
                            className={cx(
                              'shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition',
                              alreadyAdded ? 'bg-[#e8eaed] text-[#9aa0a6]' : 'bg-[#e8f0fe] text-[#1a73e8] hover:bg-[#d2e3fc]'
                            )}
                          >
                            {alreadyAdded ? '已加入' : '加入自选'}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <div className="px-3 py-3 text-sm text-[#5f6368]">没有找到匹配标的</div>
                )}
              </div>
            ) : (
              <div className="mt-3 rounded-2xl border border-dashed border-[#e8eaed] bg-[#f8fafd] px-3 py-3 text-sm text-[#5f6368]">
                输入基金代码或名称，搜索后可直接加入当前自选列表。
              </div>
            )}
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-auto rounded-2xl bg-[#f8fafd] p-3">
          <MarketListTable rows={rows} klineMap={klineMap} selectedSymbol={selectedSymbol} onSelect={onSelect} stickyHeader stickyFirstColumn />
        </div>
      </div>
    </div>
  );
}
