import { useCallback, useEffect, useMemo, useState } from 'react';
import { searchSymbols } from './markets/marketsApiLoader.js';
import { CN_ETF_WATCHLIST_PRESETS, loadWatchlist } from '../app/marketsWatchlistStorage.js';
import { readPlanList } from '../app/plan.js';
import { readDcaList } from '../app/dca.js';
import { readSellPlanList } from '../app/sellPlans.js';
import { readLedgerState } from '../app/holdingsLedgerStorage.js';
import { useTodaySignals } from './holdings/useTodaySignals.js';
import { useMarketSummaryStrip } from './markets/useMarketSummaryStrip.js';
import { buildPortalRankings } from './portal/portalMarketData.js';
import { buildPortalStats, readPortalSnapshot } from './portal/portalStats.js';
import { usePortalMarketData } from './portal/usePortalMarketData.js';
import { PortalHero } from './portal/PortalHero.jsx';
import { PortalModuleGrid } from './portal/PortalModuleGrid.jsx';
import { PortalRankings } from './portal/PortalRankings.jsx';
import { PortalSummary } from './portal/PortalSummary.jsx';
import { PortalTicker } from './portal/PortalTicker.jsx';
import { usePortalSummary } from './portal/portalSummary.js';

function readSnapshot() {
  return readPortalSnapshot({
    watchlist: loadWatchlist,
    plans: readPlanList,
    dcaPlans: readDcaList,
    sellPlans: readSellPlanList,
    ledger: readLedgerState,
  });
}

function openSearchUrl(links, tab, symbol) {
  if (typeof window === 'undefined') return null;
  const href = links?.[tab] || `./index.html?tab=${tab}`;
  const url = new URL(href, window.location.href);
  url.searchParams.set('symbol', symbol);
  return url;
}

export function PortalExperience({ links = {}, embedded = false, onSelectTab }) {
  const [snapshot, setSnapshot] = useState(readSnapshot);
  const marketSummary = useMarketSummaryStrip(true);
  const rankingSymbols = useMemo(() => CN_ETF_WATCHLIST_PRESETS.map((item) => item.symbol), []);
  const portalMarketData = usePortalMarketData({ symbols: rankingSymbols, market: 'cn' });
  const portalSummary = usePortalSummary();
  const signalCount = (Number(snapshot.todaySignalCount) || 0);

  const openTab = useCallback((tab) => {
    if (onSelectTab) {
      onSelectTab(tab);
      return true;
    }
    if (typeof window !== 'undefined' && links?.[tab]) {
      window.location.href = links[tab];
      return true;
    }
    return false;
  }, [links, onSelectTab]);

  const openMarket = useCallback((symbol) => {
    const normalized = String(symbol || '').trim();
    if (!normalized) return false;
    const url = openSearchUrl(links, 'markets', normalized);
    if (onSelectTab && url) {
      onSelectTab('markets', { search: url.search });
      return true;
    }
    if (url) {
      window.location.href = url.href;
      return true;
    }
    return false;
  }, [links, onSelectTab]);

  const handleSearch = useCallback(async (query) => {
    const value = String(query || '').trim();
    if (!value) return false;
    if (/^[A-Za-z^][A-Za-z0-9_.^=-]*$/.test(value) || /^\d{6}$/.test(value)) return openMarket(value);
    try {
      const response = await searchSymbols('cn', value, { limit: 1 });
      const result = Array.isArray(response?.results) ? response.results[0] : null;
      const symbol = result?.symbol || result?.code || result?.ticker;
      return symbol ? openMarket(symbol) : false;
    } catch {
      return false;
    }
  }, [openMarket]);

  const handleOpenHolding = useCallback((code) => {
    const normalized = String(code || '').trim();
    if (!normalized) return;
    openTab('holdings');
    window.setTimeout(() => window.dispatchEvent(new CustomEvent('holdings:select-fund', { detail: { code: normalized } })), 80);
  }, [openTab]);

  const todaySignals = useTodaySignals({
    links,
    aggregatesTableData: [],
    setSelectedCode: handleOpenHolding,
    setSidePanelTab: () => {},
    setSidePanelOpen: () => {},
  });

  useEffect(() => {
    const refresh = () => setSnapshot(readSnapshot());
    window.addEventListener('storage', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, []);

  const currentSignalCount = (Number(todaySignals.switchSummary?.count) || 0) + (Number(todaySignals.exitSummary?.count) || 0);
  const stats = useMemo(() => buildPortalStats({ ...snapshot, signalCount: currentSignalCount || signalCount }), [currentSignalCount, signalCount, snapshot]);
  const rankings = useMemo(
    () => buildPortalRankings({ symbols: rankingSymbols, quotes: portalMarketData.quotes, market: 'cn' }),
    [portalMarketData.quotes, rankingSymbols],
  );

  return (
    <div className={embedded ? 'portal-page portal-page--embedded' : 'portal-page'}>
      <PortalHero stats={stats} onSearch={handleSearch} onOpenTab={openTab} />
      <PortalSummary {...portalSummary} />
      <PortalTicker marketSummary={marketSummary} onSelectItem={(item) => openMarket(item?.symbol)} />
      <PortalRankings todaySignals={todaySignals} rankings={rankings} stats={stats} onOpenTab={openTab} onOpenMarket={openMarket} />
      <PortalModuleGrid onOpenTab={openTab} onSearch={() => document.getElementById('portal-fund-search')?.focus()} />
      <footer className="portal-footer">数据来源于行情与信号接口聚合，数据可能存在延迟，仅供策略研究参考，不构成投资建议。</footer>
    </div>
  );
}
