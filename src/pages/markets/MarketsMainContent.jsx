import { lazy, Suspense } from 'react';
import { CalendarDays, Loader2 } from 'lucide-react';
import { Pill } from '../../components/experience-ui.jsx';
import { EarningsCalendar, LatestNewsList, SummaryModule } from './MarketNewsPanels.jsx';
import {
  CHART_RANGE_TABS,
  hasEnoughChartCandles,
  navHistoryCacheKey,
  sliceCandlesForRange,
} from './marketFundMetrics.js';

const SymbolDetailPanel = lazy(() => import('./MarketSymbolDetailPanel.jsx').then((module) => ({ default: module.SymbolDetailPanel })));

export function MarketsMainContent({
  mainRef,
  market,
  selectedQuote,
  detailHeaderHidden,
  klineMap,
  news,
  newsLoading,
  earnings,
  earningsLoading,
  summary,
  summaryLoading,
  onRefreshSummary,
  fullTableMode = false,
  fullTablePanel,
  detail,
}) {
  const showFullTable = fullTableMode && !selectedQuote;
  const noSelectedContent = (
    <>
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
  );

  return (
    <main ref={mainRef} className="order-1 flex min-w-0 flex-col gap-5 lg:order-2 lg:h-full lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:pr-1 lg:[scrollbar-gutter:stable]">
      {showFullTable ? (
        fullTablePanel
      ) : selectedQuote ? (
        <Suspense fallback={<div className="h-72 animate-pulse rounded-xl bg-[#f1f3f4]" />}>
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
            chartCustomRange={detail.chartCustomRange}
            onChartCustomRangeChange={detail.onChartCustomRangeChange}
            chartCandles={(() => {
              const cfg = CHART_RANGE_TABS.find((r) => r.key === detail.chartRange);
              if (!cfg) return undefined;
              const cacheKey = `${selectedQuote.symbol}|${cfg.tf}`;
              const candles = detail.chartCandlesMap[cacheKey];
              if (!Array.isArray(candles) || candles.length < 2) return undefined;
              if (!hasEnoughChartCandles(candles, detail.chartRange, detail.chartCustomRange)) return undefined;
              return sliceCandlesForRange(candles, detail.chartRange, detail.chartCustomRange);
            })()}
            dailyCandles={detail.chartCandlesMap[`${selectedQuote.symbol}|1d`]}
            chartTf={(CHART_RANGE_TABS.find((r) => r.key === detail.chartRange) || {}).tf}
            chartLoading={detail.chartLoading}
            premiumState={detail.premiumState}
            navHistoryState={detail.navHistoryMap[navHistoryCacheKey(detail.selectedCnFundCode || selectedQuote.symbol, detail.chartRange, detail.chartCustomRange)]}
            isMobile={detail.isMobile}
            tradeMarkers={detail.tradeMarkers}
            buildOtcCandidate={detail.buildOtcCandidate}
            inWatch={detail.inWatch}
            onToggleWatch={detail.onToggleWatch}
            onBack={detail.onBack}
            onOpenAlertDialog={detail.onOpenAlertDialog}
            onMarketAction={detail.onMarketAction}
            onBacktestEvent={detail.onBacktestEvent}
          />
        </Suspense>
      ) : (
        noSelectedContent
      )}
    </main>
  );
}

export default MarketsMainContent;
