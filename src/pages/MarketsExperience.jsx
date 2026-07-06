import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cx } from '../components/experience-ui.jsx';
import {
  addToWatchlist,
  createWatchlist,
  deleteWatchlist,
  fetchEarnings,
  fetchFundFees,
  fetchFinancials,
  fetchXueqiuFundData,
  fetchKline,
  fetchQuote,
  fetchNews,
  fetchQuotes,
  fetchWorkerQuotes,
  fetchSectors,
  fetchSummary,
  searchSymbols,
  loadWatchlist,
  removeFromWatchlist,
  renameWatchlist,
  setActiveWatchlist,
} from '../app/marketsApi.js';
import { cacheRealtimeDirectQuotes } from '../app/directMarketData.js';
import { useMarketsPageSync } from './markets/useMarketsPageSync.js';
import { useVisibleMarketSymbols } from './markets/useVisibleMarketSymbols.js';
import { selectMarketRealtimeSymbols } from './markets/marketRealtimeSubscription.js';
import { shouldFetchCnEtfPremiumSnapshot, shouldFetchDetailNavHistory, shouldFetchFundFeesForVisibility, shouldFetchMarketNews, shouldFetchXueqiuFundDetail } from './markets/marketDetailDataPolicy.js';
import { showActionToast } from '../app/toast.js';
import { readLedgerState } from '../app/holdingsLedgerStorage.js';
import { readTradeLedger, TRADE_LEDGER_UPDATED_EVENT } from '../app/tradeLedger.js';
import { buildMarketsHeldAggregates } from '../app/marketsHoldingsSnapshot.js';
import { MarketsMainContent } from './markets/MarketsMainContent.jsx';
import { WatchlistNameDialog } from './markets/WatchlistControls.jsx';
import {
  CHART_RANGE_TABS,
  buildNavSnapshotItems,
  buildHoldingTradeMarkers,
  chartKlineLimitForRange,
  defaultChartCustomRange,
  hasEnoughChartCandles,
  isCnOtcFundQuote,
  navHistoryCacheKey,
  navHistoryQueryForRange,
} from './markets/marketFundMetrics.js';
import { deriveMarketListHistoryMetrics } from './markets/marketListHistoryMetrics.js';
import { loadCachedListHistoryMetrics } from './markets/listHistoryCacheLoader.js';
import { loadWatchQuotesWithEnhancements, readCachedFundLimits, writeCachedFundLimits } from './markets/marketsWatchData.js';
import { normalizeCnFundCode } from './markets/marketDisplayUtils.js';
import { useCnFundDailyCandles } from './markets/useCnFundDailyCandles.js';
import { trackActionResult, trackFeatureEvent } from '../app/analytics.js';
import { apiUrl } from '../app/apiBase.js';
import {
  CN_ETF_PRESET_MAP,
  NASDAQ_OTC_FUND_MAP,
  buildOtcCandidate,
  buildOtcFundQuoteFromSnapshot,
  formatBrowserTitleForQuote,
  hasNasdaqOtcFund,
  normalizeSearchResults,
  resolveCnFundName,
  US_INDICATOR_PRESET_MAP,
} from './markets/marketsCatalog.js';
import { updateSymbolInUrl, clearSymbolFromUrl, getChartRangeFromUrl, updateChartRangeInUrl } from './markets/marketsUrlSync.js';
import { useMarketsSearchHistory } from './markets/useMarketsSearchHistory.js';
import { batchAddToWatchlist } from './markets/marketsWatchlistUtils.js';
import { useMarketAlerts } from './markets/useMarketAlerts.js';
import { loadMarketsSidebarForFirstPaint } from './markets/loadMarketsSidebar.js';
import { buildMarketActionDraft, writeMarketActionDraft } from '../app/marketActionDraft.js';
import { FullTableLoadingFallback, MarketsSidebarLoadingFallback } from './markets/FullTableLoadingFallback.jsx';
import {
  getCnEtfPremiumSnapshotForMarkets,
  getNavHistoryForMarkets,
  getNavSnapshotForMarkets,
  getNavSnapshotsForMarkets,
  loadRealtimePricePushToolsForMarkets,
} from './markets/marketsNavServiceLoader.js';

const AlertRuleDialog = lazy(() => import('../components/AlertRuleDialog.jsx').then((module) => ({ default: module.AlertRuleDialog })));
const ExpandedMarketListOverlay = lazy(() => import('./markets/ExpandedMarketListOverlay.jsx').then((module) => ({ default: module.ExpandedMarketListOverlay })));
const MarketsFullTablePanel = lazy(() => import('./markets/MarketsFullTablePanel.jsx').then((module) => ({ default: module.MarketsFullTablePanel })));
const MarketsSidebar = lazy(() => loadMarketsSidebarForFirstPaint().then((module) => ({ default: module.MarketsSidebar })));
const A_SHARE_MARKET = { key: 'cn', label: 'A股' };
const US_MARKET = { key: 'us', label: '美股' };
function normalizeMarketKey(value) {
  return value === US_MARKET.key ? US_MARKET.key : A_SHARE_MARKET.key;
}
function marketMetaFor(value) {
  return normalizeMarketKey(value) === US_MARKET.key ? US_MARKET : A_SHARE_MARKET;
}
function marketForWatchList(list, fallback = A_SHARE_MARKET.key) {
  if (list?.type === 'us_indicator') return US_MARKET.key;
  if (list?.type === 'cn_etf' || list?.type === 'cn_otc') return A_SHARE_MARKET.key;
  const usCount = Array.isArray(list?.us) ? list.us.length : 0;
  const cnCount = Array.isArray(list?.cn) ? list.cn.length : 0;
  if (usCount > 0 && cnCount === 0) return US_MARKET.key;
  if (cnCount > 0 && usCount === 0) return A_SHARE_MARKET.key;
  return normalizeMarketKey(fallback);
}
const MARKETS_PENDING_SYMBOL_KEY = 'markets:pendingSymbol';
function normalizeHoldingLookupKey(value) {
  const code = normalizeCnFundCode(value);
  return code || String(value || '').trim().toUpperCase();
}

function sortHeldRowsFirst(rows = []) {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      if (Boolean(a.row?.isHeld) !== Boolean(b.row?.isHeld)) return a.row?.isHeld ? -1 : 1;
      return a.index - b.index;
    })
    .map((entry) => entry.row);
}

export function MarketsExperience() {
  const { saveSearchHistory } = useMarketsSearchHistory();
  const { marketAlerts, alertDialogOpen, selectedAlertSymbol, handleOpenAlertDialog, handleSaveAlert, handleCloseAlertDialog } = useMarketAlerts();
  const totalAlertCount = marketAlerts.length;
  const isFirstAlert = totalAlertCount === 0;
  const [market, setMarket] = useState(A_SHARE_MARKET.key);
  const [news, setNews] = useState([]);
  const [newsLoading, setNewsLoading] = useState(false);
  const [earnings, setEarnings] = useState([]);
  const [earningsLoading, setEarningsLoading] = useState(false);
  const [summary, setSummary] = useState({ themes: [], generatedAt: '' });
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [watch, setWatch] = useState(() => loadWatchlist());
  const [watchlistDialog, setWatchlistDialog] = useState(null);
  const [watchListExpanded, setWatchListExpanded] = useState(false);
  const [holdingsLedger, setHoldingsLedger] = useState(() => readLedgerState());
  const [tradeLedgerEntries, setTradeLedgerEntries] = useState(() => readTradeLedger());
  const [watchQuotes, setWatchQuotes] = useState({});
  const [watchNavSnapshots, setWatchNavSnapshots] = useState({});
  const [fundFeesByCode, setFundFeesByCode] = useState({});
  const [includeFundFees, setIncludeFundFees] = useState(false);
  const [includePremiumSnapshots, setIncludePremiumSnapshots] = useState(true);
  const [fundLimitsByCode, setFundLimitsByCode] = useState({});
  const [watchLoading, setWatchLoading] = useState(false);
  const [symbolInput, setSymbolInput] = useState('');
  const [symbolSearchResults, setSymbolSearchResults] = useState([]);
  const [symbolSearchLoading, setSymbolSearchLoading] = useState(false);
  const [symbolSearchError, setSymbolSearchError] = useState('');
  const [watchOverlaySearchOpen, setWatchOverlaySearchOpen] = useState(false);
  const [watchOverlaySearchInput, setWatchOverlaySearchInput] = useState('');
  const [watchOverlaySearchResults, setWatchOverlaySearchResults] = useState([]);
  const [watchOverlaySearchLoading, setWatchOverlaySearchLoading] = useState(false);
  const [watchOverlaySearchError, setWatchOverlaySearchError] = useState('');
  const symbolSearchSeqRef = useRef(0);
  const watchOverlaySearchSeqRef = useRef(0);
  const [listHistoryMap, setListHistoryMap] = useState({});
  const listHistoryInflightRef = useRef(new Set());
  const klineMap = useMemo(() => {
    const next = {};
    for (const [symbol, item] of Object.entries(listHistoryMap || {})) {
      if (Array.isArray(item?.candles) && item.candles.length) next[symbol] = item.candles;
    }
    return next;
  }, [listHistoryMap]);
  const [sectors, setSectors] = useState([]);
  const [sectorsLoading, setSectorsLoading] = useState(false);
  const [watchOpen, setWatchOpen] = useState(true);
  const [sectorsOpen, setSectorsOpen] = useState(true);
  const [sectorSearchOpen, setSectorSearchOpen] = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState('');
  const [fullTableMode, setFullTableMode] = useState(false);
  const selectedSymbolRef = useRef('');
  const pendingSymbolHandledRef = useRef('');
  const [selectedQuoteMap, setSelectedQuoteMap] = useState({});
  const [detailHeaderHidden, setDetailHeaderHidden] = useState(false);
  const [symbolDetailTab, setSymbolDetailTab] = useState('overview');
  const [detailCnFundParam, setDetailCnFundParam] = useState('price');
  const [chartRange, setChartRange] = useState(() => getChartRangeFromUrl());
  const [chartCustomRange, setChartCustomRange] = useState(() => defaultChartCustomRange());
  // 各 tf 的 close 序列缓存：键为 `${symbol}|${tf}`。
  const [chartCandlesMap, setChartCandlesMap] = useState({});
  const [chartLoading, setChartLoading] = useState(false);
  const [premiumMap, setPremiumMap] = useState({});
  const [navHistoryMap, setNavHistoryMap] = useState({});
  const premiumInflightRef = useRef(new Set());
  const navHistoryInflightRef = useRef(new Set());
  const [financialsMap, setFinancialsMap] = useState({});
  const [financialsLoading, setFinancialsLoading] = useState(false);
  const financialsInflightRef = useRef(new Set());
  const [xueqiuFundDataMap, setXueqiuFundDataMap] = useState({});
  const [xueqiuFundLoading, setXueqiuFundLoading] = useState(false);
  const xueqiuFundInflightRef = useRef(new Set());
  const chartInflightRef = useRef(new Set());
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' ? window.matchMedia('(max-width: 1023px)').matches : false);
  useMarketsPageSync({ setIsMobile, setWatch, setHoldingsLedger, setTradeLedgerEntries });
  const mainRef = useRef(null);
  const detailScrollRef = useRef({ y: 0 });
  const summarizeMarkets = () => ({
    market,
    selected: Boolean(selectedSymbol),
    selectedSymbolLength: String(selectedSymbol || '').length,
    selectedTab: symbolDetailTab,
    chartRange,
    watchlistCount: Array.isArray(watchLists) ? watchLists.length : 0,
    watchSymbolCount: Array.isArray(watchSymbols) ? watchSymbols.length : 0,
    activeWatchlistType: activeWatchList?.type || '',
    isOtcList: Boolean(isActiveOtcList),
    isMobile
  });
  const watchLists = Array.isArray(watch.lists) ? watch.lists : [];
  const activeWatchList = watchLists.find((item) => item.id === watch.activeListId) || watchLists[0] || {};
  const isActiveOtcList = activeWatchList.type === 'cn_otc' || activeWatchList.id === 'default-otc';
  const watchSymbols = useMemo(() => activeWatchList[market] || [], [activeWatchList, market]);
  useEffect(() => {
    const targetMarket = marketForWatchList(activeWatchList, market);
    if (targetMarket !== market) setMarket(targetMarket);
  }, [activeWatchList?.id, activeWatchList?.type, market]);
  useEffect(() => {
    const refreshHoldingsLedger = () => setHoldingsLedger(readLedgerState());
    const refreshTradeLedger = () => setTradeLedgerEntries(readTradeLedger());
    const refreshAllLedgers = () => { refreshHoldingsLedger(); refreshTradeLedger(); };
    window.addEventListener('holdings:ledger-updated', refreshHoldingsLedger);
    window.addEventListener(TRADE_LEDGER_UPDATED_EVENT, refreshTradeLedger);
    window.addEventListener('storage', refreshAllLedgers);
    window.addEventListener('focus', refreshAllLedgers);
    return () => {
      window.removeEventListener('holdings:ledger-updated', refreshHoldingsLedger);
      window.removeEventListener(TRADE_LEDGER_UPDATED_EVENT, refreshTradeLedger);
      window.removeEventListener('storage', refreshAllLedgers);
      window.removeEventListener('focus', refreshAllLedgers);
    };
  }, []);
  const heldAggregates = useMemo(
    () => buildMarketsHeldAggregates(holdingsLedger.transactions, holdingsLedger.snapshotsByCode).filter((agg) => agg.hasPosition),
    [holdingsLedger]
  );
  const heldCodeMap = useMemo(() => {
    const next = new Map();
    heldAggregates.forEach((agg) => {
      const key = normalizeHoldingLookupKey(agg.code);
      if (key) next.set(key, agg);
    });
    return next;
  }, [heldAggregates]);
  const trackedWatchSymbols = watchSymbols;
  const { requestedSymbols: requestedWatchSymbols, visibleSymbols: visibleWatchSymbols, handleVisibleSymbolsChange: handleVisibleWatchSymbolsChange } = useVisibleMarketSymbols({ fullTableMode, selectedSymbol, trackedSymbols: trackedWatchSymbols, resetKey: `${watch.activeListId}|${market}` });
  useEffect(() => {
    selectedSymbolRef.current = selectedSymbol;
  }, [selectedSymbol]);
  useEffect(() => {
    setDetailHeaderHidden(false);
    requestAnimationFrame(() => {
      mainRef.current?.scrollTo?.({ top: 0, behavior: 'auto' });
      window.scrollTo({ top: 0, behavior: 'auto' });
    });
  }, [selectedSymbol, isMobile]);
  useEffect(() => {
    setDetailHeaderHidden(false);
    detailScrollRef.current = { y: 0 };
    if (!selectedSymbol || typeof window === 'undefined') return undefined;
    const scrollTarget = isMobile ? window : mainRef.current;
    if (!scrollTarget) return undefined;
    const readY = () => isMobile ? window.scrollY : (mainRef.current?.scrollTop || 0);
    detailScrollRef.current.y = readY();
    const handleDetailScroll = () => {
      const y = readY();
      const lastY = detailScrollRef.current.y;
      if (Math.abs(y - lastY) < 6) return;
      setDetailHeaderHidden(y > lastY && y > 28);
      detailScrollRef.current.y = y;
    };
    scrollTarget.addEventListener('scroll', handleDetailScroll, { passive: true });
    return () => scrollTarget.removeEventListener('scroll', handleDetailScroll);
  }, [selectedSymbol, isMobile]);
  const refreshNews = useCallback(async () => {
    if (!shouldFetchMarketNews({ market })) { setNews([]); setNewsLoading(false); return; }
    setNewsLoading(true);
    try {
      const r = await fetchNews(market);
      setNews(Array.isArray(r.items) ? r.items : []);
    } catch (err) {
      // news is optional
    } finally {
      setNewsLoading(false);
    }
  }, [market]);
  // 即将发布的财报日历（仅美股）。失败不弹 toast。
  const refreshEarnings = useCallback(async (forceRefresh = false) => {
    if (market !== 'us') {
      setEarnings([]);
      return;
    }
    setEarningsLoading(true);
    try {
      const r = await fetchEarnings(market, { refresh: forceRefresh });
      setEarnings(Array.isArray(r && r.items) ? r.items : []);
    } catch (err) {
      setEarnings([]);
    } finally {
      setEarningsLoading(false);
    }
  }, [market]);
  // 今日主题摘要（仅美股）。多数时候读 30 分钟 cron 写的缓存；force 时会调 AI 重生成。
  const refreshSummary = useCallback(async (forceRefresh = false) => {
    if (market !== 'us') {
      setSummary({ themes: [], generatedAt: '' });
      return;
    }
    setSummaryLoading(true);
    try {
      const r = await fetchSummary(market, { refresh: forceRefresh });
      setSummary({
        themes: Array.isArray(r && r.themes) ? r.themes : [],
        generatedAt: (r && r.generatedAt) || ''
      });
    } catch (err) {
      // 摘要是纯增量信息，失败不弹 toast，避免骚扰。
      setSummary({ themes: [], generatedAt: '' });
    } finally {
      setSummaryLoading(false);
    }
  }, [market]);
  const refreshWatch = useCallback(async () => {
    const list = requestedWatchSymbols || [];
    if (!list.length) {
      if (!trackedWatchSymbols.length) { setWatchQuotes({}); setWatchNavSnapshots({}); }
      trackActionResult('markets', 'watch_refresh', 'empty', { market });
      return;
    }
    setWatchLoading(true);
    const startedAt = Date.now();
    try {
      const { quotes, navSnapshots, fundFees } = await loadWatchQuotesWithEnhancements({
        symbols: list,
        market,
        fetchQuotes,
        getNavSnapshots: getNavSnapshotsForMarkets,
        fetchFundFees,
        buildOtcFundQuoteFromSnapshot,
        hasNasdaqOtcFund,
        includeFundFees,
        includePremiumSnapshots,
        fetchPremiumQuotes: fetchWorkerQuotes,
        onBaseResult: ({ quotes: baseQuotes, navSnapshots: baseNavSnapshots }) => {
          if (Object.keys(baseNavSnapshots).length) setWatchNavSnapshots((prev) => ({ ...prev, ...baseNavSnapshots }));
          setWatchQuotes((prev) => ({ ...prev, ...baseQuotes })); setWatchLoading(false);
        },
      });
      if (Object.keys(navSnapshots).length) {
        setWatchNavSnapshots((prev) => ({ ...prev, ...navSnapshots }));
      }
      if (Object.keys(fundFees).length) {
        setFundFeesByCode((prev) => ({ ...prev, ...fundFees }));
      }
      // 检查并记录有错误的行情数据
      const quotesWithErrors = Object.entries(quotes).filter(([, q]) => q?.error);
      if (quotesWithErrors.length > 0) {
        console.warn('[Markets] 以下标的获取行情失败:', quotesWithErrors.map(([sym, q]) => ({ symbol: sym, error: q.error })));
      }
      const missingQuoteSymbols = list.filter((symbol) => !quotes?.[symbol]);
      setWatchQuotes((prev) => ({ ...prev, ...quotes }));
      trackActionResult('markets', 'watch_refresh', 'success', {
        market,
        symbolCount: list.length,
        symbolSample: list.slice(0, 30),
        quoteCount: Object.keys(quotes || {}).length,
        navSnapshotCount: Object.keys(navSnapshots || {}).length,
        fundFeeCount: Object.keys(fundFees || {}).length,
        includeFundFees,
        errorSymbols: quotesWithErrors.slice(0, 30).map(([symbol]) => symbol),
        missingQuoteSymbols: missingQuoteSymbols.slice(0, 30),
        durationMs: Date.now() - startedAt
      });
    } catch (err) {
      // ignore
      trackActionResult('markets', 'watch_refresh', 'error', {
        market,
        symbolCount: list.length,
        symbolSample: list.slice(0, 30),
        durationMs: Date.now() - startedAt,
        errorMessage: err?.message || ''
      });
    } finally {
      setWatchLoading(false);
    }
  }, [requestedWatchSymbols, trackedWatchSymbols, market, includeFundFees, includePremiumSnapshots]);

  const handleColumnVisibilityStateChange = useCallback((visibility) => {
    const shouldInclude = shouldFetchFundFeesForVisibility(visibility);
    setIncludeFundFees((prev) => (prev === shouldInclude ? prev : shouldInclude));
    const shouldIncludePremium = visibility?.premium !== false;
    setIncludePremiumSnapshots((prev) => (prev === shouldIncludePremium ? prev : shouldIncludePremium));
  }, []);

  useEffect(() => {
    const symbols = Array.from(new Set((visibleWatchSymbols || []).map((sym) => String(sym || '').trim()).filter(Boolean)))
      .filter((sym) => !listHistoryMap[sym]?.candles?.length && !listHistoryInflightRef.current.has(sym));
    if (!symbols.length) return undefined;
    let cancelled = false;
    symbols.forEach((sym) => listHistoryInflightRef.current.add(sym));

    loadCachedListHistoryMetrics(symbols, { existingMap: listHistoryMap })
      .then((metricsBySymbol) => {
        if (!cancelled && Object.keys(metricsBySymbol).length) {
          setListHistoryMap((prev) => ({ ...prev, ...metricsBySymbol }));
        }
      })
      .catch(() => {})
      .finally(() => {
        symbols.forEach((sym) => listHistoryInflightRef.current.delete(sym));
      });
    return () => { cancelled = true; };
  }, [visibleWatchSymbols, listHistoryMap]);
  useEffect(() => {
    if (market !== 'cn' || !isActiveOtcList) { setFundLimitsByCode({}); return undefined; }
    const codes = (visibleWatchSymbols || [])
      .map((sym) => normalizeCnFundCode(sym))
      .filter((code) => /^\d{6}$/.test(code));
    if (!codes.length) { setFundLimitsByCode({}); return undefined; }
    const cached = readCachedFundLimits(codes);
    if (Object.keys(cached.dataByCode).length) {
      setFundLimitsByCode((prev) => ({ ...prev, ...cached.dataByCode }));
    }
    if (!cached.missing.length) return undefined;
    const ctrl = new AbortController();
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch(apiUrl('/api/fund-limit'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ codes: cached.missing }),
          cache: 'no-store',
          signal: ctrl.signal
        });
        if (!resp.ok) {
          if (resp.status === 405) {
            const entries = await Promise.all(
              cached.missing.map((code) =>
                fetch(apiUrl('/api/fund-limit', { code }), { cache: 'no-store', signal: ctrl.signal })
                  .then((r) => (r.ok ? r.json() : null))
                  .then((data) => [code, data])
                  .catch(() => [code, null])
              )
            );
            if (cancelled) return;
            const next = {};
            for (const [code, data] of entries) {
              if (data && typeof data === 'object') next[code] = data;
            }
            writeCachedFundLimits(next);
            setFundLimitsByCode((prev) => ({ ...prev, ...next }));
            return;
          }
          return;
        }
        const payload = await resp.json();
        if (cancelled) return;
        const next = {};
        const items = Array.isArray(payload?.items) ? payload.items : [];
        for (const item of items) {
          if (item && item.ok && item.code && item.data && typeof item.data === 'object') {
            next[item.code] = item.data;
          }
        }
        writeCachedFundLimits(next);
        setFundLimitsByCode((prev) => ({ ...prev, ...next }));
      } catch (err) {
        if (err && err.name === 'AbortError') return;
      }
    })();
    return () => { cancelled = true; ctrl.abort(); };
  }, [visibleWatchSymbols, market, isActiveOtcList]);
  const refreshSectors = useCallback(async (forceRefresh = false) => {
    if (market !== 'us') {
      setSectors([]);
      return;
    }
    setSectorsLoading(true);
    try {
      const r = await fetchSectors(market, { refresh: forceRefresh });
      const list = Array.isArray(r && r.sectors) ? r.sectors : [];
      setSectors(list);
    } catch (err) {
      // 行业是增量信息，失败不弹 toast，避免骩扰。
      setSectors([]);
    } finally {
      setSectorsLoading(false);
    }
  }, [market]);
  // 当 selectedSymbol / chartRange 变化时拉取对应 tf 的 candles。
  useEffect(() => {
    if (!selectedSymbol) return;
    const cfg = CHART_RANGE_TABS.find((r) => r.key === chartRange);
    if (!cfg) return;
    const cacheKey = `${selectedSymbol}|${cfg.tf}`;
    const requestedLimit = cfg.tf === '1d' ? chartKlineLimitForRange(chartRange, chartCustomRange) : '';
    const cachedCandles = chartCandlesMap[cacheKey];
    if (Array.isArray(cachedCandles) && cachedCandles.length === 0) return;
    if (hasEnoughChartCandles(cachedCandles, chartRange, chartCustomRange)) return;
    const inflightKey = `${cacheKey}|${requestedLimit || 'default'}`;
    if (chartInflightRef.current.has(inflightKey)) return;
    chartInflightRef.current.add(inflightKey);
    setChartLoading(true);
    let cancelled = false;
    (async () => {
      try {
        const r = await fetchKline(selectedSymbol, { timeframe: cfg.tf, limit: requestedLimit });
        const candles = Array.isArray(r && r.candles) ? r.candles : [];
        if (!cancelled) setChartCandlesMap((prev) => ({ ...prev, [cacheKey]: candles }));
      } catch (_) {
        if (!cancelled) setChartCandlesMap((prev) => ({ ...prev, [cacheKey]: [] }));
      } finally {
        chartInflightRef.current.delete(inflightKey);
        if (!cancelled) setChartLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedSymbol, chartRange, chartCustomRange?.from, chartCustomRange?.to, chartCandlesMap]);
  useCnFundDailyCandles({ market, selectedSymbol, chartCandlesMap, chartInflightRef, fetchKline, hasNasdaqOtcFund, setChartCandlesMap });

  useEffect(() => {
    if (!selectedSymbol || market !== 'us' || symbolDetailTab !== 'financials') return;
    if (financialsMap[selectedSymbol]) return;
    if (financialsInflightRef.current.has(selectedSymbol)) return;
    financialsInflightRef.current.add(selectedSymbol);
    setFinancialsLoading(true);
    let cancelled = false;
    (async () => {
      try {
        const r = await fetchFinancials(selectedSymbol);
        if (!cancelled) setFinancialsMap((prev) => ({ ...prev, [selectedSymbol]: r }));
      } catch (_) {
        // Optional financials data can fail silently.
      } finally {
        financialsInflightRef.current.delete(selectedSymbol);
        if (!cancelled) setFinancialsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedSymbol, market, symbolDetailTab, financialsMap]);

  useEffect(() => {
    if (!shouldFetchXueqiuFundDetail({ market, symbol: selectedSymbol, activeTab: symbolDetailTab, hasNasdaqOtcFund })) return;
    const code = normalizeCnFundCode(selectedSymbol);
    if (Object.prototype.hasOwnProperty.call(xueqiuFundDataMap, selectedSymbol)) return;
    if (xueqiuFundInflightRef.current.has(selectedSymbol)) return;
    xueqiuFundInflightRef.current.add(selectedSymbol);
    setXueqiuFundLoading(true);
    let cancelled = false;
    (async () => {
      try {
        const r = await fetchXueqiuFundData(selectedSymbol);
        if (!cancelled) setXueqiuFundDataMap((prev) => ({ ...prev, [selectedSymbol]: r }));
      } catch (_) {
        if (!cancelled) setXueqiuFundDataMap((prev) => ({ ...prev, [selectedSymbol]: null }));
      } finally {
        xueqiuFundInflightRef.current.delete(selectedSymbol);
        if (!cancelled) setXueqiuFundLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedSymbol, market, symbolDetailTab, xueqiuFundDataMap]);

  useEffect(() => {
    refreshNews();
    refreshEarnings(false);
  }, [refreshNews, refreshEarnings]);

  useEffect(() => {
    refreshSummary(false);
  }, [refreshSummary]);

  useEffect(() => {
    refreshWatch();
  }, [refreshWatch]);

  // ---- WS 行情订阅：自选代码变化时重新订阅 ----
  useEffect(() => {
    const symbols = selectMarketRealtimeSymbols({
      trackedWatchSymbols,
      requestedWatchSymbols,
      visibleWatchSymbols,
      selectedSymbol,
      fullTableMode,
    });
    if (typeof window !== 'undefined' && typeof window.__aiDcaSubscribeMarketData === 'function') {
      window.__aiDcaSubscribeMarketData(symbols, { scope: 'markets' });
      if (symbols.length) {
        trackFeatureEvent('markets', 'market_subscribe', {
          market,
          symbolCount: symbols.length,
          activeWatchlistType: activeWatchList?.type || '',
          source: selectedSymbol ? 'detail' : fullTableMode ? 'visible' : 'list'
        });
      }
    }
  }, [trackedWatchSymbols, requestedWatchSymbols, visibleWatchSymbols, selectedSymbol, fullTableMode, market, activeWatchList?.type]);

  // ---- WS 行情推送：接收实时价格更新 ----
  useEffect(() => {
    let alive = true;
    function handlePricePush(event) {
      const items = event?.detail?.items;
      if (!Array.isArray(items) || !items.length) return;
      trackFeatureEvent('markets', 'price_push_receive', {
        itemCount: items.length,
        watchSymbolCount: requestedWatchSymbols.length,
        selected: Boolean(selectedSymbolRef.current)
      });
      loadRealtimePricePushToolsForMarkets().then(({ cacheRealtimeSnapshotItems, mergePricePushItems }) => {
        if (!alive) return;
        setWatchQuotes((prev) => {
          const existingItems = Object.entries(prev || {}).map(([code, quote]) => ({ code, ...quote }));
          const merged = mergePricePushItems(existingItems, items);
          if (merged === existingItems) return prev;
          cacheRealtimeSnapshotItems(merged);
          cacheRealtimeDirectQuotes(merged);
          const next = { ...prev };
          for (const item of merged) {
            const code = String(item?.code || '').trim();
            if (code && Object.prototype.hasOwnProperty.call(prev, code)) {
              next[code] = item;
            }
          }
          return next;
        });
      }).catch(() => {
        // Realtime push is best-effort; the next quote refresh will reconcile.
      });
    }
    window.addEventListener('ai-dca-price-push', handlePricePush);
    return () => {
      alive = false;
      window.removeEventListener('ai-dca-price-push', handlePricePush);
    };
  }, [requestedWatchSymbols]);

  useEffect(() => {
    refreshSectors(false);
  }, [refreshSectors]);

  useEffect(() => {
    const q = symbolInput.trim();
    const seq = ++symbolSearchSeqRef.current;
    if (!sectorSearchOpen || q.length < 1) {
      setSymbolSearchResults([]);
      setSymbolSearchLoading(false);
      setSymbolSearchError('');
      return undefined;
    }
    const controller = new AbortController();
    setSymbolSearchLoading(true);
    setSymbolSearchError('');
    const timer = window.setTimeout(() => {
      const activeMarket = marketMetaFor(market);
      searchSymbols(activeMarket.key, q, { limit: 8, signal: controller.signal })
        .then((r) => {
          if (seq !== symbolSearchSeqRef.current) return;
          const seen = new Set();
          const rawRows = Array.isArray(r && r.results) ? [...r.results] : [];
          const otcCode = normalizeCnFundCode(q);
          if (activeMarket.key === 'cn' && /^\d{6}$/.test(otcCode) && !rawRows.some((row) => normalizeCnFundCode(row.symbol || row.code || row.ticker) === otcCode)) {
            rawRows.push(buildOtcCandidate(otcCode));
          }
          const rows = rawRows.map((row) => ({
            ...row,
            market: activeMarket.key,
            marketLabel: activeMarket.label
          })).filter((row) => {
            const symbol = String(row.symbol || row.code || row.ticker || '').trim().toUpperCase();
            if (!symbol || seen.has(symbol)) return false;
            seen.add(symbol);
            row.symbol = symbol;
            return true;
          });
          setSymbolSearchResults(rows.slice(0, 8));
          trackActionResult('markets', 'symbol_search', 'success', {
            market: activeMarket.key,
            source: 'sidebar',
            queryLength: q.length,
            resultCount: rows.length
          });
        })
        .catch((err) => {
          if (controller.signal.aborted || seq !== symbolSearchSeqRef.current) return;
          setSymbolSearchResults([]);
          setSymbolSearchError('搜索失败，稍后再试');
          trackActionResult('markets', 'symbol_search', 'error', {
            market: activeMarket.key,
            source: 'sidebar',
            queryLength: q.length,
            errorMessage: err?.message || ''
          });
        })
        .finally(() => {
          if (seq === symbolSearchSeqRef.current) setSymbolSearchLoading(false);
        });
    }, 500);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [sectorSearchOpen, symbolInput, market]);

  useEffect(() => {
    const q = watchOverlaySearchInput.trim();
    const seq = ++watchOverlaySearchSeqRef.current;
    if (!watchOverlaySearchOpen || q.length < 1) {
      setWatchOverlaySearchResults([]);
      setWatchOverlaySearchLoading(false);
      setWatchOverlaySearchError('');
      return undefined;
    }
    const controller = new AbortController();
    setWatchOverlaySearchLoading(true);
    setWatchOverlaySearchError('');
    const timer = window.setTimeout(() => {
      const activeMarket = marketMetaFor(market);
      searchSymbols(activeMarket.key, q, { limit: 10, signal: controller.signal })
        .then((r) => {
          if (seq !== watchOverlaySearchSeqRef.current) return;
          const rows = normalizeSearchResults(Array.isArray(r && r.results) ? r.results : [], activeMarket.key, q);
          setWatchOverlaySearchResults(rows.slice(0, 10));
          trackActionResult('markets', 'symbol_search', 'success', {
            market: activeMarket.key,
            source: 'watch_overlay',
            queryLength: q.length,
            resultCount: rows.length
          });
        })
        .catch((err) => {
          if (controller.signal.aborted || seq !== watchOverlaySearchSeqRef.current) return;
          setWatchOverlaySearchResults([]);
          setWatchOverlaySearchError('搜索失败，稍后再试');
          trackActionResult('markets', 'symbol_search', 'error', {
            market: activeMarket.key,
            source: 'watch_overlay',
            queryLength: q.length,
            errorMessage: err?.message || ''
          });
        })
        .finally(() => {
          if (seq === watchOverlaySearchSeqRef.current) setWatchOverlaySearchLoading(false);
        });
    }, 500);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [watchOverlaySearchOpen, watchOverlaySearchInput, market]);

  function rememberSelectedQuote(row, targetMarket = market) {
    if (!row || !row.symbol) return null;
    const symbol = String(row.symbol || row.code || row.ticker || '').trim().toUpperCase();
    if (!symbol) return null;
    const key = `${targetMarket || market}:${symbol}`;
    const indicatorPreset = targetMarket === 'us' ? US_INDICATOR_PRESET_MAP[symbol] || null : null;
    setSelectedQuoteMap((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        ...row,
        symbol,
        name: row.name || row.shortName || row.displayName || prev[key]?.name || CN_ETF_PRESET_MAP[symbol]?.name || indicatorPreset?.name || symbol,
        exchange: row.exchange || prev[key]?.exchange || CN_ETF_PRESET_MAP[symbol]?.exchange,
        currency: row.currency || prev[key]?.currency || CN_ETF_PRESET_MAP[symbol]?.currency,
        premiumPercent: row.premiumPercent ?? row.premium_rate ?? prev[key]?.premiumPercent,
        premium_rate: row.premium_rate ?? row.premiumPercent ?? prev[key]?.premium_rate,
        iopv: row.iopv ?? prev[key]?.iopv,
        latestNav: row.latestNav ?? prev[key]?.latestNav
      }
    }));
    return symbol;
  }

  function handleAddSymbol(event, rawOverride, marketOverride = market) {
    if (event && event.preventDefault) event.preventDefault();
    const raw = (rawOverride != null ? String(rawOverride) : symbolInput).trim().toUpperCase();
    if (!raw) return;
    const targetMarket = normalizeMarketKey(marketOverride || market);
    const next = addToWatchlist(targetMarket, raw, watch.activeListId);
    setWatch(next);
    setMarket(targetMarket);
    rememberSelectedQuote({ symbol: raw }, targetMarket);
    setSelectedSymbol(raw);
    setFullTableMode(false);
    setSymbolDetailTab('overview');
    setSymbolInput('');
    setSymbolSearchResults([]);
    setSectorSearchOpen(false);
    trackFeatureEvent('markets', 'symbol_add', {
      source: rawOverride != null ? 'quick_add_override' : 'manual_input',
      market: targetMarket,
      symbolLength: raw.length,
      ...summarizeMarkets()
    });
  }

  function handlePickSymbolSearch(row) {
    if (!row || !row.symbol) return;
    setWatchListExpanded(false);
    const targetMarket = normalizeMarketKey(row.market || market);
    const symbol = rememberSelectedQuote(row, targetMarket);
    if (!symbol) return;

    // 保存到搜索历史
    saveSearchHistory(
      symbol,
      row.name || row.shortName || row.displayName || '',
      targetMarket
    );

    setMarket(targetMarket);
    setSelectedSymbol(symbol);
    setFullTableMode(false);
    setSymbolDetailTab('overview');
    setSymbolInput('');
    setSymbolSearchResults([]);
    setSectorSearchOpen(false);
    setWatchOverlaySearchOpen(false);
    setWatchOverlaySearchInput('');
    setWatchOverlaySearchResults([]);
    setWatchOverlaySearchError('');
    trackFeatureEvent('markets', 'symbol_select', {
      source: 'search_result',
      market: targetMarket,
      symbolLength: symbol.length,
      hasName: Boolean(row.name || row.shortName || row.displayName)
    });
  }

  function handleToggleWatchOverlaySearch() {
    setWatchOverlaySearchOpen((prev) => {
      const next = !prev;
      if (!next) {
        setWatchOverlaySearchInput('');
        setWatchOverlaySearchResults([]);
        setWatchOverlaySearchError('');
      }
      return next;
    });
    trackFeatureEvent('markets', 'watch_overlay_search_toggle', {
      nextOpen: !watchOverlaySearchOpen,
      ...summarizeMarkets()
    });
  }

  function handleClearWatchOverlaySearch() {
    setWatchOverlaySearchInput('');
    setWatchOverlaySearchResults([]);
    setWatchOverlaySearchError('');
    trackFeatureEvent('markets', 'watch_overlay_search_clear', summarizeMarkets());
  }

  function handleAddSearchResult(row) {
    if (!row || !row.symbol) return;
    const targetMarket = normalizeMarketKey(row.market || market);
    const symbol = String(row.symbol || row.code || row.ticker || '').trim().toUpperCase();
    if (!symbol) return;
    const next = addToWatchlist(targetMarket, symbol, watch.activeListId);
    setWatch(next);
    rememberSelectedQuote(row, targetMarket);
    showActionToast('已加入自选', 'success');
    trackFeatureEvent('markets', 'symbol_add', {
      source: 'watch_overlay_search_result',
      market: targetMarket,
      symbolLength: symbol.length,
      watchSymbolCount: (next?.lists || []).find((item) => item.id === next.activeListId)?.[targetMarket]?.length || 0
    });
  }

  function handleSelectWatchlist(listId) {
    setWatchListExpanded(false);
    const next = setActiveWatchlist(listId);
    const nextLists = Array.isArray(next?.lists) ? next.lists : [];
    const nextActive = nextLists.find((item) => item.id === next.activeListId) || nextLists[0] || {};
    const nextMarket = marketForWatchList(nextActive, market);
    setWatch(next);
    if (nextMarket !== market) setMarket(nextMarket);
    clearSelectedSymbol();
    setFullTableMode(true);
    setSymbolDetailTab('overview');
    trackFeatureEvent('markets', 'watchlist_select', {
      listIdLength: String(listId || '').length,
      listCount: watchLists.length,
      market: nextMarket
    });
  }

  function handleCreateWatchlist() {
    setWatchlistDialog({ type: 'create', name: `列表 ${(watchLists || []).length + 1}` });
    trackFeatureEvent('markets', 'watchlist_dialog_open', { type: 'create', listCount: watchLists.length });
  }

  function handleRenameWatchlist(list) {
    if (!list) return;
    setWatchlistDialog({ type: 'rename', list, name: list.name || '' });
    trackFeatureEvent('markets', 'watchlist_dialog_open', { type: 'rename', listIdLength: String(list.id || '').length });
  }

  function handleDeleteWatchlist(list) {
    if (!list || list.id === 'default') return;
    setWatchlistDialog({ type: 'delete', list, name: list.name || '' });
    trackFeatureEvent('markets', 'watchlist_dialog_open', { type: 'delete', listIdLength: String(list.id || '').length });
  }

  function handleAddPopular(symbols) {
    const next = batchAddToWatchlist(symbols, watch, watch.activeListId);
    if (next === watch) return;
    const activeMarket = marketForWatchList((next?.lists || []).find((item) => item.id === next.activeListId), market);
    const itemLabel = activeMarket === 'us' ? '标的' : '基金';
    setWatch(next);
    showActionToast(`已添加热门${itemLabel}到自选`, 'success', {
      description: `已添加 ${symbols.length} 个${itemLabel}到当前列表`
    });
    trackActionResult('markets', 'popular_batch_add', 'success', {
      count: symbols.length,
      listId: next.activeListId
    });
  }

  function handleWatchlistDialogSubmit() {
    if (!watchlistDialog) return;
    if (watchlistDialog.type === 'delete') {
      const next = deleteWatchlist(watchlistDialog.list?.id);
      setWatch(next);
      clearSelectedSymbol();
      setSymbolDetailTab('overview');
      setWatchlistDialog(null);
      setWatchListExpanded(false);
      showActionToast('列表已删除', 'success');
      trackActionResult('markets', 'watchlist_delete', 'success', {
        listCount: (next?.lists || []).length
      });
      return;
    }
    const trimmed = String(watchlistDialog.name || '').trim();
    if (!trimmed) return;
    if (watchlistDialog.type === 'rename') {
      if (trimmed !== watchlistDialog.list?.name) {
        const next = renameWatchlist(watchlistDialog.list?.id, trimmed);
        setWatch(next);
        showActionToast('列表已改名', 'success');
        trackActionResult('markets', 'watchlist_rename', 'success', {
          nameLength: trimmed.length
        });
      }
      setWatchlistDialog(null);
      return;
    }
    const next = createWatchlist(trimmed);
    setWatch(next);
    clearSelectedSymbol();
    setSymbolDetailTab('overview');
    setWatchlistDialog(null);
    setWatchListExpanded(false);
    showActionToast('已新建列表', 'success');
    trackActionResult('markets', 'watchlist_create', 'success', {
      nameLength: trimmed.length,
      listCount: (next?.lists || []).length
    });
  }

  const clearSelectedSymbol = () => { setSelectedSymbol(''); clearSymbolFromUrl(); };

  function handleSelectSymbol(row, options = {}) {
    if (!row || !row.symbol) return;
    setWatchListExpanded(false);
    const targetMarket = normalizeMarketKey(options.market || row.market || market);
    if (targetMarket && targetMarket !== market) setMarket(targetMarket);
    const symbol = rememberSelectedQuote(row, targetMarket) || row.symbol;
    setSelectedSymbol(symbol);
    setFullTableMode(false);
    setSymbolDetailTab('overview');
    updateSymbolInUrl(symbol);
    trackFeatureEvent('markets', 'symbol_select', {
      source: options.source || 'watchlist',
      market: targetMarket,
      symbolLength: String(symbol || '').length
    });
  }

  const buildSidebarRow = useCallback((sym) => {
    const code = normalizeCnFundCode(sym);
    const holdingKey = normalizeHoldingLookupKey(sym);
    const holding = heldCodeMap.get(holdingKey) || (code ? heldCodeMap.get(code) : null) || null;
    const q = watchQuotes[sym] || (code ? watchQuotes[code] : null) || {};
    const snapshot = code ? watchNavSnapshots[code] : null;
    const indicatorPreset = market === 'us' ? US_INDICATOR_PRESET_MAP[sym] || null : null;
    const otcQuote = market === 'cn' && hasNasdaqOtcFund(code)
      ? buildOtcFundQuoteFromSnapshot(sym, snapshot, q)
      : null;
    const merged = otcQuote || q;
    const rawHistoryMetrics = listHistoryMap[sym] || (code ? listHistoryMap[code] : null) || null;
    const historyMetrics = rawHistoryMetrics?.candles?.length
      ? deriveMarketListHistoryMetrics(rawHistoryMetrics.candles, { currentPrice: merged.price })
      : rawHistoryMetrics;
    const latestNavDate = merged.latestNavDate || snapshot?.latestNavDate || '';
    const isOtc = isCnOtcFundQuote(merged) || (market === 'cn' && hasNasdaqOtcFund(code));
    const fundLimit = code ? fundLimitsByCode[code] || null : null;
    const fundMeta = code ? NASDAQ_OTC_FUND_MAP[code] || null : null;
    const sourceHighPoint = historyMetrics?.highPoint || merged.highPoint;
    const cachedHighPointHigh = Number(sourceHighPoint?.high);
    const cachedHighPoint = Number.isFinite(cachedHighPointHigh) && cachedHighPointHigh > 0
      ? { ...sourceHighPoint, high: cachedHighPointHigh, highDate: String(sourceHighPoint?.highDate || '').trim(), source: sourceHighPoint?.source || merged.highSource || 'daily-kline-365d' }
      : null;
    const quoteYearHigh = merged.yearHigh ?? merged.high52w ?? merged.high52Week ?? merged.fiftyTwoWeekHigh;
    const rowYearHigh = market === 'cn' && !isOtc ? cachedHighPoint?.high : quoteYearHigh;
    const rowHighDate = market === 'cn' && !isOtc
      ? cachedHighPoint?.highDate
      : (merged.highDate ?? merged.yearHighDate ?? merged.high52wDate);

    let baseMeta = '';
    if (isOtc) {
      const parts = ['场外基金'];
      parts.push(latestNavDate ? `净值日 ${latestNavDate.slice(5)}` : '净值');
      baseMeta = parts.join(' · ');
    } else if (indicatorPreset?.source) {
      baseMeta = indicatorPreset.source;
    }
    return {
      symbol: sym,
      name: market === 'cn' ? resolveCnFundName(sym, merged.name || CN_ETF_PRESET_MAP[sym]?.name || sym) : (merged.name || indicatorPreset?.name || sym),
      price: merged.price,
      changePercent: merged.changePercent,
      change: merged.change,
      previousClose: merged.previousClose,
      historicalPercentile: historyMetrics?.historicalPercentile ?? merged.historicalPercentile,
      highPoint: cachedHighPoint,
      allTimeHigh: merged.allTimeHigh ?? merged.all_time_high,
      all_time_high: merged.all_time_high,
      historicalHigh: merged.historicalHigh ?? merged.historyHigh ?? merged.history_high,
      yearHigh: rowYearHigh,
      yearHighDate: cachedHighPoint?.highDate ?? merged.yearHighDate,
      highSource: cachedHighPoint?.source ?? merged.highSource,
      high52w: merged.high52w,
      high_52w: merged.high_52w,
      high52Week: merged.high52Week,
      fiftyTwoWeekHigh: merged.fiftyTwoWeekHigh,
      historyHigh: merged.historyHigh,
      history_high: merged.history_high,
      highest: merged.highest,
      highestPrice: merged.highestPrice,
      highest_price: merged.highest_price,
      maxPrice: merged.maxPrice ?? merged.max_price,
      highDate: rowHighDate,
      open: merged.open,
      high: merged.high,
      low: merged.low,
      volume: merged.volume,
      turnover: merged.turnover,
      marketCapital: merged.marketCapital,
      marketCap: merged.marketCap ?? merged.marketCapital,
      exchange: merged.exchange || CN_ETF_PRESET_MAP[sym]?.exchange,
      currency: merged.currency || CN_ETF_PRESET_MAP[sym]?.currency,
      fundKind: isOtc ? 'otc' : 'exchange',
      kind: isOtc ? 'otc' : 'exchange',
      latestNav: merged.latestNav || snapshot?.latestNav,
      iopv: merged.iopv,
      premiumPercent: merged.premiumPercent ?? merged.premium_rate,
      premium_rate: merged.premium_rate ?? merged.premiumPercent,
      currentYearPercent: historyMetrics?.ytdReturn ?? merged.currentYearPercent ?? merged.current_year_percent,
      ytdReturn: historyMetrics?.ytdReturn ?? merged.ytdReturn ?? null,
      return1w: historyMetrics?.return1w ?? merged.return1w ?? null,
      return1m: historyMetrics?.return1m ?? merged.return1m ?? null,
      return3m: historyMetrics?.return3m ?? merged.return3m ?? null,
      return6m: historyMetrics?.return6m ?? merged.return6m ?? null,
      return1y: historyMetrics?.return1y ?? merged.return1y ?? null,
      returnBase: historyMetrics?.returnBase ?? merged.returnBase ?? null,
      totalShares: merged.totalShares ?? merged.total_shares,
      feeRate: fundFeesByCode[code]?.annualFeeRate ?? merged.feeRate ?? merged.expenseRatio ?? merged.managementFeeRate,
      fundFee: fundFeesByCode[code] || null,
      latestNavDate,
      valueType: merged.valueType,
      assetType: merged.assetType,
      source: merged.source,
      fundLimit,
      fundMeta,
      isHeld: Boolean(holding),
      holding,
      market,
      meta: baseMeta
    };
  }, [watchQuotes, watchNavSnapshots, fundFeesByCode, fundLimitsByCode, heldCodeMap, market, listHistoryMap]);

  const watchRows = useMemo(
    () => sortHeldRowsFirst(watchSymbols.map((sym) => buildSidebarRow(sym))),
    [watchSymbols, buildSidebarRow]
  );

  const activeSidebarRows = watchRows;
  const activeSidebarEmptyText = '未配置自选。';

  const selectedStoredQuote = selectedSymbol ? selectedQuoteMap[`${market}:${selectedSymbol}`] : null;
  const selectedQuote = useMemo(
    () => {
      const watchRow = watchRows.find((row) => row.symbol === selectedSymbol) || null;
      if (selectedStoredQuote && watchRow) {
        return {
          ...selectedStoredQuote,
          ...watchRow,
          name: watchRow.name || selectedStoredQuote.name,
          holding: watchRow.holding || selectedStoredQuote.holding || null,
        };
      }
      if (selectedStoredQuote && Number.isFinite(Number(selectedStoredQuote.price))) return selectedStoredQuote;
      return watchRow || selectedStoredQuote || null;
    },
    [selectedSymbol, selectedStoredQuote, watchRows]
  );
  const selectedCnFundCode = market === 'cn' ? normalizeCnFundCode(selectedSymbol || selectedQuote?.symbol) : '';
  const selectedIsCnOtcFund = isCnOtcFundQuote(selectedQuote);
  const selectedTradeMarkers = useMemo(() => {
    if (!selectedCnFundCode) return [];
    const selectedHolding = heldCodeMap.get(normalizeHoldingLookupKey(selectedCnFundCode));
    if (!selectedHolding?.hasPosition) return [];
    const holdingAlias = heldAggregates.find((agg) => normalizeCnFundCode(agg.code) === selectedCnFundCode);
    return buildHoldingTradeMarkers(
      [...(holdingsLedger.transactions || []), ...(tradeLedgerEntries || [])],
      selectedCnFundCode,
      [selectedSymbol, selectedQuote?.symbol, selectedQuote?.code, selectedQuote?.name, holdingAlias?.name]
    );
  }, [holdingsLedger.transactions, tradeLedgerEntries, selectedCnFundCode, selectedSymbol, selectedQuote?.symbol, selectedQuote?.code, selectedQuote?.name, heldAggregates, heldCodeMap]);

  const handleMarketAction = useCallback((action, quote) => {
    if (!quote?.symbol) return;
    const symbol = String(quote.symbol || '').trim().toUpperCase();
    const code = normalizeCnFundCode(symbol);
    const kind = quote.kind || quote.fundKind || (market === 'cn' && isCnOtcFundQuote(quote) ? 'otc' : 'exchange');
    const draft = buildMarketActionDraft({
      action,
      symbol: code || symbol,
      name: quote.name || quote.displayName || symbol,
      market,
      kind,
      price: Number(quote.price) || 0,
    });
    if (!draft) return;
    writeMarketActionDraft(draft);
    trackFeatureEvent('markets', 'action_click', {
      action,
      market,
      isHeld: Boolean(quote.isHeld || quote.holding),
      symbolLength: symbol.length,
      source: 'symbol_detail',
    });
    const routeByAction = {
      'holding-buy': { tab: 'holdings', hash: '' },
      'plan-new': { tab: 'tradePlans', hash: '#new' },
      'dca-new': { tab: 'tradePlans', hash: '#dca-new' },
      'fund-switch': { tab: 'fundSwitch', search: `symbol=${encodeURIComponent(code || symbol)}` },
    };
    const route = routeByAction[action] || { tab: 'tradePlans', hash: '#sell-new' };
    window.dispatchEvent(new CustomEvent('workspace:navigate', { detail: route }));
  }, [market]);

  function handleBacktestEvent(action, meta = {}) {
    const eventMeta = {
      ...summarizeMarkets(),
      ...meta,
      source: 'symbol_detail_backtest',
    };
    if (action === 'run_success' || action === 'run_error' || action === 'run_validation_error') {
      trackActionResult('markets', 'symbol_detail_backtest_run', action.replace(/^run_/, ''), eventMeta);
      return;
    }
    trackFeatureEvent('markets', `symbol_detail_backtest_${action}`, eventMeta);
  }

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.title = selectedQuote ? formatBrowserTitleForQuote(selectedQuote) : '行情中心';
  }, [selectedQuote]);

  useEffect(() => {
    if (!selectedSymbol) return;
    updateChartRangeInUrl(chartRange, chartRange === 'custom' ? chartCustomRange : null);
  }, [selectedSymbol, chartRange, chartCustomRange]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const openPendingSymbol = (rawValue = '') => {
      const params = new URL(window.location.href).searchParams;
      const raw = rawValue || params.get('symbol') || '';
      const code = normalizeCnFundCode(raw);
      if (!code || pendingSymbolHandledRef.current === code) return;
      pendingSymbolHandledRef.current = code;
      try { window.sessionStorage.removeItem(MARKETS_PENDING_SYMBOL_KEY); } catch (_error) { /* ignore */ }
      const row = watchRows.find((item) => normalizeCnFundCode(item.symbol) === code)
        || buildOtcCandidate(code, { symbol: code });
      handleSelectSymbol({ ...row, symbol: code, market: 'cn' }, { market: 'cn' });
    };
    try { window.sessionStorage.removeItem(MARKETS_PENDING_SYMBOL_KEY); } catch (_error) { /* ignore */ }
    openPendingSymbol();
    const handlePopState = () => {
      pendingSymbolHandledRef.current = '';
      openPendingSymbol();
    };
    const handleSelectEvent = (event) => {
      pendingSymbolHandledRef.current = '';
      openPendingSymbol(event?.detail?.symbol || '');
    };
    window.addEventListener('popstate', handlePopState);
    window.addEventListener('markets:select-symbol', handleSelectEvent);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('markets:select-symbol', handleSelectEvent);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchRows.length]);

  useEffect(() => {
    if (!selectedSymbol) return undefined;
    const selectedWatchRow = watchRows.find((row) => row.symbol === selectedSymbol);
    if (selectedWatchRow && Number.isFinite(Number(selectedWatchRow.price))) return undefined;
    if (Number.isFinite(Number(selectedStoredQuote?.price))) return undefined;
    let cancelled = false;
    fetchQuote(selectedSymbol)
      .then((quote) => {
        if (cancelled || !quote) return;
        setSelectedQuoteMap((prev) => {
          const key = `${market}:${selectedSymbol}`;
          return {
            ...prev,
            [key]: {
              ...prev[key],
              ...quote,
              symbol: String(quote.symbol || selectedSymbol).trim().toUpperCase(),
              name: resolveCnFundName(quote.symbol || selectedSymbol, quote.name || prev[key]?.name || CN_ETF_PRESET_MAP[selectedSymbol]?.name || selectedSymbol)
            }
          };
        });
      })
      .catch(async () => {
        if (cancelled || market !== 'cn') return;
        const code = normalizeCnFundCode(selectedSymbol);
        if (!/^\d{6}$/.test(code)) return;
        try {
          const snapshot = await getNavSnapshotForMarkets(code);
          if (cancelled) return;
          const quote = buildOtcFundQuoteFromSnapshot(selectedSymbol, snapshot, selectedStoredQuote || {});
          if (!quote) return;
          setSelectedQuoteMap((prev) => {
            const key = `${market}:${selectedSymbol}`;
            return {
              ...prev,
              [key]: {
                ...prev[key],
                ...quote,
                name: resolveCnFundName(quote.symbol || selectedSymbol, quote.name || prev[key]?.name || selectedSymbol)
              }
            };
          });
        } catch (_error) {
          // 场外基金净值兜底也失败时保持原占位，不打扰用户。
        }
      });
    return () => { cancelled = true; };
  }, [market, selectedSymbol, selectedStoredQuote?.price, watchRows]);

  useEffect(() => {
    if (!shouldFetchCnEtfPremiumSnapshot({ market, symbol: selectedSymbol, cnFundParam: detailCnFundParam, isCnOtcFund: selectedIsCnOtcFund })) return;
    const symbol = normalizeCnFundCode(selectedSymbol);
    if (!symbol) return;
    const cachedState = premiumMap[symbol];
    const cachedPremium = cachedState?.data;
    const price = Number(selectedQuote?.price);
    if (cachedPremium && Math.abs(Number(cachedPremium.price) - price) < 0.000001) {
      if (cachedState?.loading && !premiumInflightRef.current.has(symbol)) {
        setPremiumMap((prev) => ({
          ...prev,
          [symbol]: { ...prev[symbol], loading: false }
        }));
      }
      return;
    }
    if (premiumInflightRef.current.has(symbol)) return;
    premiumInflightRef.current.add(symbol);
    setPremiumMap((prev) => ({ ...prev, [symbol]: { loading: true, data: prev[symbol]?.data || null, error: '' } }));
    let cancelled = false;
    (async () => {
      try {
        const premium = await getCnEtfPremiumSnapshotForMarkets(symbol, {
          price,
          qqqChangePercent: 0
        });
        if (!cancelled) {
          setPremiumMap((prev) => ({
            ...prev,
            [symbol]: {
              loading: false,
              error: '',
              data: premium
            }
          }));
        }
      } catch (error) {
        if (!cancelled) {
          setPremiumMap((prev) => ({
            ...prev,
            [symbol]: { loading: false, data: prev[symbol]?.data || null, error: error instanceof Error ? error.message : '溢价计算失败' }
          }));
        }
      } finally {
        premiumInflightRef.current.delete(symbol);
      }
    })();
    return () => { cancelled = true; };
  }, [market, selectedSymbol, detailCnFundParam, selectedIsCnOtcFund, selectedQuote?.price]);

  useEffect(() => {
    if (!shouldFetchDetailNavHistory({ market, symbol: selectedSymbol, cnFundParam: detailCnFundParam, isCnOtcFund: selectedIsCnOtcFund })) return;
    const symbol = normalizeCnFundCode(selectedSymbol);
    if (!/^\d{6}$/.test(symbol)) return;
    const query = navHistoryQueryForRange(chartRange, chartCustomRange);
    const key = navHistoryCacheKey(symbol, chartRange, chartCustomRange);
    if (navHistoryMap[key]?.items?.length || navHistoryMap[key]?.loading || navHistoryMap[key]?.error || navHistoryInflightRef.current.has(key)) return;
    let cancelled = false;
    navHistoryInflightRef.current.add(key);
    setNavHistoryMap((prev) => ({ ...prev, [key]: { loading: true, items: prev[key]?.items || [], error: '' } }));
    getNavHistoryForMarkets(symbol, query)
      .then(async (payload) => {
        if (cancelled) return;
        let items = Array.isArray(payload?.items) ? payload.items : [];
        if (items.length < 2) {
          try {
            const snapshot = await getNavSnapshotForMarkets(symbol);
            if (!cancelled) {
              const snapshotItems = buildNavSnapshotItems(snapshot);
              if (snapshotItems.length > items.length) items = snapshotItems;
            }
          } catch (_error) {
            // 快照兜底失败时继续使用 nav-history 的结果。
          }
        }
        if (cancelled) return;
        setNavHistoryMap((prev) => ({ ...prev, [key]: { loading: false, items, error: items.length ? '' : '暂无净值历史数据' } }));
      })
      .catch(async (error) => {
        if (cancelled) return;
        try {
          const snapshot = await getNavSnapshotForMarkets(symbol);
          if (cancelled) return;
          const items = buildNavSnapshotItems(snapshot);
          setNavHistoryMap((prev) => ({ ...prev, [key]: { loading: false, items, error: items.length ? '' : (error instanceof Error ? error.message : '净值历史加载失败') } }));
        } catch (_fallbackError) {
          if (cancelled) return;
          setNavHistoryMap((prev) => ({ ...prev, [key]: { loading: false, items: prev[key]?.items || [], error: error instanceof Error ? error.message : '净值历史加载失败' } }));
        }
      })
      .finally(() => {
        navHistoryInflightRef.current.delete(key);
      });
    return () => { /* keep the in-flight cache write; otherwise loading can stay true after rerender */ };
  }, [market, selectedSymbol, detailCnFundParam, selectedIsCnOtcFund, chartRange, chartCustomRange?.from, chartCustomRange?.to]);

  const listTableColumnProps = { showLimitColumn: isActiveOtcList && market === 'cn', hidePremiumColumn: isActiveOtcList && market === 'cn', hideTrendColumn: true };
  const fullTablePanelProps = { fullTableMode, rows: activeSidebarRows, activeWatchListName: activeWatchList?.name, watchLists, activeWatchListId: watch.activeListId, market, klineMap, selectedSymbol, onSelectWatchlist: handleSelectWatchlist, onCreateWatchlist: handleCreateWatchlist, onRenameWatchlist: handleRenameWatchlist, onDeleteWatchlist: handleDeleteWatchlist, onSelectSymbol: handleSelectSymbol, searchOpen: watchOverlaySearchOpen, searchValue: watchOverlaySearchInput, searchResults: watchOverlaySearchResults, searchLoading: watchOverlaySearchLoading, searchError: watchOverlaySearchError, watchSymbols, onSearchToggle: handleToggleWatchOverlaySearch, onSearchChange: setWatchOverlaySearchInput, onSearchClear: handleClearWatchOverlaySearch, onSearchResultSelect: handlePickSymbolSearch, onSearchResultAdd: handleAddSearchResult, onRefresh: refreshWatch, refreshing: watchLoading, onVisibleSymbolsChange: handleVisibleWatchSymbolsChange, onColumnVisibilityStateChange: handleColumnVisibilityStateChange, ...listTableColumnProps };
  const showMarketsSidebar = !(fullTableMode && !selectedSymbol);

  return (
    <>
    <WatchlistNameDialog
      dialog={watchlistDialog}
      onChangeName={(name) => setWatchlistDialog((prev) => prev ? { ...prev, name } : prev)}
      onCancel={() => setWatchlistDialog(null)}
      onSubmit={handleWatchlistDialogSubmit}
    />
    {watchListExpanded ? (
      <Suspense fallback={null}>
        <ExpandedMarketListOverlay
          open={watchListExpanded}
          rows={activeSidebarRows}
          klineMap={klineMap}
          selectedSymbol={selectedSymbol}
          activeName={activeWatchList?.name}
          marketLabel={market === 'cn' ? 'A 股监控列表' : '美股监控列表'}
          loading={watchLoading}
          searchOpen={watchOverlaySearchOpen}
          searchValue={watchOverlaySearchInput}
          searchResults={watchOverlaySearchResults}
          searchLoading={watchOverlaySearchLoading}
          searchError={watchOverlaySearchError}
          watchSymbols={watchSymbols}
          onSearchToggle={handleToggleWatchOverlaySearch}
          onSearchChange={setWatchOverlaySearchInput}
          onSearchClear={handleClearWatchOverlaySearch}
          onSearchResultSelect={handlePickSymbolSearch}
          onSearchResultAdd={handleAddSearchResult}
          onClose={() => { setWatchListExpanded(false); setWatchOverlaySearchOpen(false); handleClearWatchOverlaySearch(); }}
          onCreate={handleCreateWatchlist}
          onSelect={handleSelectSymbol}
          {...listTableColumnProps}
        />
      </Suspense>
    ) : null}
    <div className={cx(
      "flex flex-col gap-5 lg:grid lg:h-[calc(100vh-6rem)] lg:min-h-0 lg:grid-cols-[280px_minmax(0,1fr)] lg:items-stretch lg:gap-4 lg:overflow-hidden lg:pb-0 xl:grid-cols-[320px_minmax(0,1fr)]",
      fullTableMode && !selectedSymbol && "lg:grid-cols-[minmax(0,1fr)] xl:grid-cols-[minmax(0,1fr)]",
      selectedSymbol ? "pb-4" : "pb-[140px]"
    )}>
      {showMarketsSidebar ? (
        <Suspense fallback={<MarketsSidebarLoadingFallback activeName={activeWatchList?.name} rowCount={watchSymbols.length} rows={activeSidebarRows} />}>
          <MarketsSidebar
            market={market}
            selectedSymbol={selectedSymbol}
            watchLists={watchLists}
            activeWatchListId={watch.activeListId}
            watchListExpanded={watchListExpanded}
            watchOpen={watchOpen}
            sectorsOpen={sectorsOpen}
            sectorSearchOpen={sectorSearchOpen}
            symbolInput={symbolInput}
            symbolSearchResults={symbolSearchResults}
            symbolSearchLoading={symbolSearchLoading}
            symbolSearchError={symbolSearchError}
            activeSidebarRows={activeSidebarRows}
            activeSidebarEmptyText={activeSidebarEmptyText}
            klineMap={klineMap}
            watchLoading={watchLoading}
            sectors={sectors}
            sectorsLoading={sectorsLoading}
            onSelectWatchlist={handleSelectWatchlist}
            onCreateWatchlist={handleCreateWatchlist}
            onRenameWatchlist={handleRenameWatchlist}
            onDeleteWatchlist={handleDeleteWatchlist}
            onAddPopular={handleAddPopular}
            onToggleWatchListExpanded={() => setWatchListExpanded((v) => !v)}
            onToggleWatchOpen={() => setWatchOpen((v) => !v)}
            onToggleSectorsOpen={() => setSectorsOpen((v) => !v)}
            onOpenSectorSearch={() => {
              setSectorsOpen(true);
              setSectorSearchOpen(true);
            }}
            onCloseSectorSearch={() => {
              setSectorSearchOpen(false);
              setSymbolInput('');
              setSymbolSearchResults([]);
            }}
            onSymbolInputChange={setSymbolInput}
            onSubmitSymbol={handleAddSymbol}
            onPickSymbolSearch={handlePickSymbolSearch}
            onSelectSymbol={handleSelectSymbol}
            onColumnVisibilityStateChange={handleColumnVisibilityStateChange}
            {...listTableColumnProps}
            mobileHidden={!isMobile}
            desktopHidden={isMobile}
          />
        </Suspense>
      ) : null}

      <MarketsMainContent
        mainRef={mainRef}
        market={market} isMobile={isMobile}
        selectedQuote={selectedQuote}
        detailHeaderHidden={detailHeaderHidden}
        klineMap={klineMap}
        news={news}
        newsLoading={newsLoading}
        earnings={earnings}
        earningsLoading={earningsLoading}
        summary={summary}
        summaryLoading={summaryLoading}
        onRefreshSummary={() => refreshSummary(true)}
        fullTableMode={fullTableMode}
        fullTablePanel={(
          <Suspense fallback={<FullTableLoadingFallback />}>
            <MarketsFullTablePanel {...fullTablePanelProps} />
          </Suspense>
        )}
        detail={{
          financials: financialsMap[selectedQuote?.symbol],
          financialsLoading: financialsLoading && !financialsMap[selectedQuote?.symbol],
          xueqiuFundData: xueqiuFundDataMap[selectedQuote?.symbol],
          xueqiuFundLoading: xueqiuFundLoading && !xueqiuFundDataMap[selectedQuote?.symbol],
          activeTab: symbolDetailTab,
          onTabChange: setSymbolDetailTab,
          chartRange,
          onChartRangeChange: setChartRange,
          chartCustomRange, onChartCustomRangeChange: setChartCustomRange,
          onCnFundParamChange: setDetailCnFundParam,
          chartCandlesMap,
          chartLoading,
          selectedCnFundCode,
          premiumState: premiumMap[selectedCnFundCode || selectedQuote?.symbol],
          navHistoryMap,
          isMobile,
          tradeMarkers: selectedTradeMarkers,
          buildOtcCandidate,
          inWatch: watchSymbols.includes(selectedQuote?.symbol),
          onToggleWatch: () => {
            if (!selectedQuote) return;
            if (watchSymbols.includes(selectedQuote.symbol)) {
              setWatch(removeFromWatchlist(market, selectedQuote.symbol, watch.activeListId));
            } else {
              setWatch(addToWatchlist(market, selectedQuote.symbol, watch.activeListId));
            }
          },
          onBack: () => {
            clearSelectedSymbol();
            setFullTableMode(true);
            setSymbolDetailTab('overview');
          },
          onOpenAlertDialog: handleOpenAlertDialog,
          onMarketAction: handleMarketAction,
          onBacktestEvent: handleBacktestEvent,
        }}
      />
    </div>
    {alertDialogOpen ? (
      <Suspense fallback={null}>
        <AlertRuleDialog
          open={alertDialogOpen}
          onClose={handleCloseAlertDialog}
          onSave={(config) => handleSaveAlert(config, isFirstAlert)}
          initialRule={selectedAlertSymbol}
          mode="market"
        />
      </Suspense>
    ) : null}
    </>
  );
}
