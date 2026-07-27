import { cx } from '../../components/experience-ui.jsx';
import { COMPARE_COLORS, COMPARE_MAIN_COLOR } from './MarketChartPanel.jsx';
import {
  MARKET_EMPTY_VALUE,
  formatMarketPrice,
  formatNumber,
  formatSignedPercent,
  formatSymbolDisplay,
} from './marketDisplayUtils.js';

/**
 * Lightweight quote/premium table under the compare chart.
 * Kept separate so MarketSymbolDetailPanel stays under the refactor budget.
 */
export function FundCompareQuoteTable({
  rows = [],
  market = 'cn',
  premiumCompareMode = false,
  premiumSpreadStats = null,
}) {
  if (!Array.isArray(rows) || rows.length < 2) return null;

  return (
    <div className="overflow-hidden bg-white text-xs sm:text-[13px]" data-testid="fund-compare-quote-table">
      <div className="grid h-8 grid-cols-[minmax(44px,1fr)_58px_58px_64px] items-center gap-0.5 border-b border-[rgba(17,24,39,0.08)] px-1 text-right text-xs font-semibold text-[var(--market-text-muted)] sm:h-10 sm:grid-cols-[minmax(160px,1fr)_96px_96px_96px_96px] sm:gap-2 sm:px-4 sm:text-[13px]">
        <div className="min-w-0 truncate text-left">{market === 'cn' ? '基金代码' : '股票代码'}</div>
        <div className="whitespace-nowrap">{premiumCompareMode ? '溢价' : '价格'}</div>
        <div className="whitespace-nowrap">{premiumCompareMode ? '溢价差' : '涨跌额'}</div>
        <div className="whitespace-nowrap">{premiumCompareMode ? '价格' : '涨跌幅'}</div>
        <div className="hidden sm:block">{premiumCompareMode ? '净值' : '昨收盘'}</div>
      </div>
      {rows.map((item, index) => {
        const markerColor = index === 0 ? COMPARE_MAIN_COLOR : COMPARE_COLORS[(index - 1) % COMPARE_COLORS.length];
        const toneValue = premiumCompareMode ? Number(item.price) : Number(item.changePercent);
        const rowPositive = Number.isFinite(toneValue) && toneValue > 0;
        const rowNegative = Number.isFinite(toneValue) && toneValue < 0;
        const toneClass = rowPositive ? 'text-[var(--market-rise)]' : rowNegative ? 'text-[var(--market-fall)]' : 'text-[var(--market-text-strong)]';
        const spreadValue = Number(item.premiumSpread);
        const spreadPositive = Number.isFinite(spreadValue) && spreadValue > 0;
        const spreadNegative = Number.isFinite(spreadValue) && spreadValue < 0;
        const spreadToneClass = spreadPositive ? 'text-[var(--market-rise)]' : spreadNegative ? 'text-[var(--market-fall)]' : 'text-[var(--market-text-strong)]';
        const displayRowSymbol = formatSymbolDisplay(item.symbol);
        return (
          <div
            key={`${item.symbol}-${index}`}
            className="grid h-12 grid-cols-[minmax(44px,1fr)_58px_58px_64px] items-center gap-0.5 border-b border-[rgba(17,24,39,0.08)] px-1 text-right text-[12px] tabular-nums sm:h-16 sm:grid-cols-[minmax(160px,1fr)_96px_96px_96px_96px] sm:gap-2 sm:px-4 sm:text-[16px]"
          >
            <div className="flex min-w-0 items-center gap-1 text-left sm:gap-3">
              <span className="size-2 shrink-0 rounded-sm sm:size-3" style={{ background: markerColor }} />
              <div className="min-w-0">
                <div className="truncate text-[13px] font-bold leading-tight text-[var(--market-text-strong)] sm:text-[18px]">{displayRowSymbol}</div>
                <div className="mt-0.5 hidden truncate text-[12px] text-[rgba(17,24,39,0.64)] sm:block sm:text-[13px]">{item.name}</div>
              </div>
            </div>
            <div className={cx('whitespace-nowrap text-[12px] font-bold transition-colors duration-[120ms] sm:text-[17px]', premiumCompareMode ? toneClass : 'text-[var(--market-text-strong)]')}>
              {Number.isFinite(item.price)
                ? (premiumCompareMode
                  ? formatSignedPercent(item.price)
                  : (market === 'cn' ? formatMarketPrice(item.price, item) : `$${formatNumber(item.price, 2)}`))
                : MARKET_EMPTY_VALUE}
            </div>
            <div className={cx('whitespace-nowrap text-[12px] font-bold transition-colors duration-[120ms] sm:text-[16px]', premiumCompareMode ? spreadToneClass : toneClass)}>
              {premiumCompareMode
                ? (Number.isFinite(spreadValue) ? formatSignedPercent(spreadValue) : MARKET_EMPTY_VALUE)
                : (Number.isFinite(item.change)
                  ? `${item.change > 0 ? '+' : ''}${market === 'cn' ? formatMarketPrice(item.change, item) : formatNumber(item.change, 2)}`
                  : MARKET_EMPTY_VALUE)}
            </div>
            <div className={cx('whitespace-nowrap text-[13px] font-bold transition-colors duration-[120ms] sm:text-[16px]', premiumCompareMode ? 'text-[var(--market-text-strong)]' : toneClass)}>
              {premiumCompareMode
                ? (Number.isFinite(item.marketPrice) ? formatNumber(item.marketPrice, 4) : MARKET_EMPTY_VALUE)
                : (Number.isFinite(item.changePercent) ? formatSignedPercent(item.changePercent) : MARKET_EMPTY_VALUE)}
            </div>
            <div className="hidden whitespace-nowrap text-[15px] font-bold text-[var(--market-text-strong)] transition-colors duration-[120ms] sm:block sm:text-[17px]">
              {premiumCompareMode
                ? (Number.isFinite(item.navValue) ? formatNumber(item.navValue, 4) : MARKET_EMPTY_VALUE)
                : (Number.isFinite(item.previousClose)
                  ? (market === 'cn' ? formatMarketPrice(item.previousClose, item) : `$${formatNumber(item.previousClose, 2)}`)
                  : MARKET_EMPTY_VALUE)}
            </div>
          </div>
        );
      })}
      {premiumSpreadStats ? (
        <div className="flex items-center justify-between gap-2 border-b border-[rgba(17,24,39,0.08)] px-1 py-2 text-xs font-medium text-[var(--market-text-muted)] sm:px-4 sm:text-[13px]">
          <span>最大/最小溢价差</span>
          <span className="text-right tabular-nums text-[var(--market-text-strong)]">
            {formatSignedPercent(premiumSpreadStats.spread)}
            <span className="ml-1 text-[var(--market-text-subtle)]">{premiumSpreadStats.maxSymbol} - {premiumSpreadStats.minSymbol}</span>
          </span>
        </div>
      ) : null}
    </div>
  );
}
