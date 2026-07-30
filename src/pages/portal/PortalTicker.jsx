import { MarketSummaryStrip } from '../markets/MarketNewsPanels.jsx';

export function PortalTicker({ marketSummary, onSelectItem }) {
  const items = Array.isArray(marketSummary?.summary?.items) ? marketSummary.summary.items : [];
  const loading = Boolean(marketSummary?.loading);
  return (
    <section className="portal-ticker" aria-labelledby="portal-ticker-title">
      <div className="portal-section-heading portal-section-heading--compact">
        <div>
          <h2 id="portal-ticker-title">市场速览</h2>
          <p>主要指数与 ETF 的最新轻量行情</p>
        </div>
        {marketSummary?.summary?.generatedAt ? <span>数据已更新</span> : null}
      </div>
      {items.length || loading ? (
        <MarketSummaryStrip
          summary={marketSummary.summary}
          loading={loading}
          flashSymbols={marketSummary.flashSymbols}
          onSelectItem={onSelectItem}
          marketOptions={marketSummary.marketOptions}
          selectedRegion={marketSummary.selectedRegion}
          onSelectRegion={marketSummary.setSelectedRegion}
        />
      ) : (
        <div className="portal-ticker__empty">行情摘要暂不可用，稍后可在行情页查看完整列表。</div>
      )}
    </section>
  );
}
