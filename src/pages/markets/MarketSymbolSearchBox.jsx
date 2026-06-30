import { Loader2, Search, X } from 'lucide-react';
import { cx } from '../../components/experience-ui.jsx';
import { formatSymbolDisplay } from './marketDisplayUtils.js';

export function MarketSymbolSearchBox({
  searchValue = '',
  searchResults = [],
  searchLoading = false,
  searchError = '',
  watchSymbols = [],
  marketLabel = '',
  onSearchChange,
  onSearchClear,
  onSearchResultSelect,
  onSearchResultAdd,
  autoFocus = false,
  compact = false,
  inline = false,
}) {
  const hasQuery = Boolean(searchValue.trim());
  const resultPanel = (
    <div className={cx(
      'overflow-hidden rounded-2xl border border-[#e8eaed] bg-[#f8fafd]',
      inline ? 'mt-2 max-h-[360px] overflow-y-auto shadow-lg' : 'mt-3'
    )}>
      {searchLoading ? (
        <div className="flex items-center gap-2 px-3 py-3 text-sm text-[#5f6368]"><Loader2 size={14} className="animate-spin" />搜索中...</div>
      ) : searchError ? (
        <div className="px-3 py-3 text-sm text-rose-600">{searchError}</div>
      ) : searchResults.length ? (
        <ul className="divide-y divide-[#e8eaed]">
          {searchResults.map((row) => {
            const symbol = formatSymbolDisplay(row.symbol);
            const displayName = row.name || row.exchange || '--';
            const alreadyAdded = watchSymbols.includes(row.symbol);
            const venueKey = row.assetType || row.type || row.exchange || '';
            return (
              <li key={`${row.market || marketLabel}:${row.symbol}:${venueKey}`} className="flex items-center gap-3 px-3 py-2 hover:bg-white">
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
  );

  return (
    <div className={cx(
      inline ? 'relative w-full' : 'rounded-2xl border border-[#e8eaed] bg-white shadow-sm',
      compact && !inline ? 'p-2' : !inline ? 'p-3' : ''
    )}>
      <div className="flex items-center gap-2 rounded-full bg-[#f1f3f4] px-3 py-2">
        <Search size={15} className="shrink-0 text-[#5f6368]" />
        <input
          autoFocus={autoFocus}
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
      {hasQuery ? inline ? (
        <div className="absolute right-0 top-full z-30 w-full min-w-[320px]">
          {resultPanel}
        </div>
      ) : resultPanel : inline ? null : (
        <div className="mt-3 rounded-2xl border border-dashed border-[#e8eaed] bg-[#f8fafd] px-3 py-3 text-sm text-[#5f6368]">
          输入基金代码或名称，搜索后可直接加入当前自选列表。
        </div>
      )}
    </div>
  );
}
