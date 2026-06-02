import { CalendarDays, Loader2, RefreshCw } from 'lucide-react';
import { Pill, cx } from '../../components/experience-ui.jsx';
import { SymbolDetailPanel } from './MarketSymbolDetailPanel.jsx';
import { EarningsCalendar, LatestNewsList, SummaryModule } from './MarketNewsPanels.jsx';
import { IndexCard } from './MarketSidebarRows.jsx';
import {
  CHART_RANGE_TABS,
  navHistoryDaysForRange,
  sliceCandlesForRange,
} from './marketFundMetrics.js';

const MARKET_TABS = [
  { key: 'us', label: '美股' },
  { key: 'cn', label: 'A股' },
];

export function MarketsMainContent({
  mainRef,
  market,
  onMarketChange,
  selectedQuote,
  detailHeaderHidden,
  indices,
  indicesLoading,
  klineMap,
  onPickIndex,
  onRefreshAll,
  news,
  newsLoading,
  earnings,
  earningsLoading,
  summary,
  summaryLoading,
  onRefreshSummary,
  detail,
}) {
  return (
    <main ref={mainRef} className="order-1 flex min-w-0 flex-col gap-5 lg:order-2 lg:h-full lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:pr-1 lg:[scrollbar-gutter:stable]">
      <div className={cx(
        "sticky top-0 z-20 items-center justify-between gap-3 bg-white/95 px-1 py-2 backdrop-blur transition-all duration-500 ease-out will-change-transform",
        selectedQuote ? "hidden" : "flex",
        !selectedQuote && detailHeaderHidden && "pointer-events-none -translate-y-full opacity-0"
      )}>
        <div className="flex items-center gap-3">
          {MARKET_TABS.map((m) => (
            <button
              key={m.key}
              type="button"
              className={cx(
                'rounded-full px-3 py-1 text-sm transition',
                market === m.key
                  ? 'border border-slate-900 font-medium text-slate-900'
                  : 'text-slate-600 hover:text-slate-900'
              )}
              onClick={() => onMarketChange(m.key)}
            >
              {m.label}
            </button>
          ))}
          {indicesLoading && <Loader2 size={12} className="animate-spin text-slate-400" />}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="刷新"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            onClick={onRefreshAll}
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {selectedQuote ? (
        <SymbolDetailPanel
          row={selectedQuote}
          market={market}
          sparkPoints={klineMap[selectedQuote.symbol]}
          news={news}
          earnings={earnings}
          financials={detail.financials}
          financialsLoading={detail.financialsLoading}
          xueqiuFundData={detail.xueqiuFundData}
          xueqiuFundLoading={detail.xueqiuFundLoading}
          activeTab={detail.activeTab}
          onTabChange={detail.onTabChange}
          chartRange={detail.chartRange}
          onChartRangeChange={detail.onChartRangeChange}
          chartCandles={(() => {
            const cfg = CHART_RANGE_TABS.find((r) => r.key === detail.chartRange);
            if (!cfg) return undefined;
            const cacheKey = `${selectedQuote.symbol}|${cfg.tf}`;
            const candles = detail.chartCandlesMap[cacheKey];
            if (!Array.isArray(candles) || candles.length < 2) return undefined;
            return sliceCandlesForRange(candles, detail.chartRange);
          })()}
          chartTf={(CHART_RANGE_TABS.find((r) => r.key === detail.chartRange) || {}).tf}
          chartLoading={detail.chartLoading}
          premiumState={detail.premiumState}
          navHistoryState={detail.navHistoryMap[`${detail.selectedCnFundCode || selectedQuote.symbol}|${navHistoryDaysForRange(detail.chartRange)}`]}
          isMobile={detail.isMobile}
          tradeMarkers={detail.tradeMarkers}
          buildOtcCandidate={detail.buildOtcCandidate}
          inWatch={detail.inWatch}
          onToggleWatch={detail.onToggleWatch}
          onAnalyze={detail.onAnalyze}
          onBack={detail.onBack}
        />
      ) : (
        <>
          {indices.length ? (
            <div className="-mx-2 min-h-[176px] overflow-x-auto px-2 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <div className="flex min-h-[156px] snap-x snap-mandatory items-stretch gap-3 pb-1">
                {indices.map((entry) => (
                  <IndexCard
                    key={entry.symbol}
                    entry={entry}
                    onPick={onPickIndex}
                    sparkPoints={klineMap[entry.symbol]}
                  />
                ))}
              </div>
            </div>
          ) : !indicesLoading ? (
            <p className="text-sm text-slate-400">指数数据暂未加载。</p>
          ) : null}

          {market === 'us' && (
            <div className="hidden lg:block">
              <SummaryModule
                themes={summary.themes}
                loading={summaryLoading}
                generatedAt={summary.generatedAt}
                onRefresh={onRefreshSummary}
              />
            </div>
          )}

          <div className="hidden space-y-2 lg:block">
            <div className="flex items-center gap-2 border-b border-[#e8eaed] pb-1.5">
              <h2 className="text-[15px] font-semibold text-[#1f1f1f]">最新动态</h2>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-600">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                实时
              </span>
              {newsLoading && <Loader2 size={12} className="animate-spin text-slate-400" />}
              {market === 'cn' && <Pill tone="slate">A股新闻源建设中</Pill>}
            </div>
            <LatestNewsList items={news} />
          </div>

          {market === 'us' && (
            <div className="hidden space-y-2 lg:block">
              <div className="flex items-center gap-2 border-b border-[#e8eaed] pb-1.5">
                <CalendarDays size={16} className="text-indigo-500" />
                <h2 className="text-[15px] font-semibold text-[#1f1f1f]">即将发布的财报</h2>
                {earningsLoading && <Loader2 size={12} className="animate-spin text-slate-400" />}
              </div>
              <EarningsCalendar items={earnings} />
            </div>
          )}
        </>
      )}
    </main>
  );
}

export default MarketsMainContent;
