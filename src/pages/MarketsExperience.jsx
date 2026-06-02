import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  cx
} from '../components/experience-ui.jsx';
import {
  addToWatchlist,
  createWatchlist,
  deleteWatchlist,
  fetchEarnings,
  fetchFundFees,
  fetchFinancials,
  fetchXueqiuFundData,
  fetchIndices,
  fetchKline,
  fetchQuote,
  fetchMovers,
  fetchNews,
  fetchQuotes,
  fetchSectors,
  fetchSummary,
  searchSymbols,
  loadWatchlist,
  removeFromWatchlist,
  renameWatchlist,
  setActiveWatchlist,
} from '../app/marketsApi.js';
import { showActionToast } from '../app/toast.js';
import { readLedgerState } from '../app/holdingsLedger.js';
import { readTradeLedger, TRADE_LEDGER_UPDATED_EVENT } from '../app/tradeLedger.js';
import { aggregateByCode } from '../app/holdingsLedgerCore.js';
import { getCnEtfPremiumSnapshot, getNavHistory, getNavSnapshot, getNavSnapshots } from '../app/navService.js';
import { ExpandedMarketListOverlay } from './markets/ExpandedMarketListOverlay.jsx';
import { MarketsMainContent } from './markets/MarketsMainContent.jsx';
import { MarketsResearchShell } from './markets/MarketsResearchShell.jsx';
import { MarketsSidebar } from './markets/MarketsSidebar.jsx';
import { WatchlistNameDialog } from './markets/WatchlistControls.jsx';
import {
  CHART_RANGE_TABS,
  buildNavSnapshotItems,
  buildHoldingTradeMarkers,
  isCnOtcFundQuote,
  navHistoryDaysForRange,
} from './markets/marketFundMetrics.js';
import { loadWatchQuotesWithEnhancements } from './markets/marketsWatchData.js';
import {
  formatNumber,
  formatSymbolDisplay,
  normalizeCnFundCode,
} from './markets/marketDisplayUtils.js';
import {
  formatTime,
} from './markets/marketOtcHelpers.js';
import {
  CN_ETF_PRESET_MAP,
  buildOtcCandidate,
  buildOtcFundQuoteFromSnapshot,
  formatBrowserTitleForQuote,
  hasNasdaqOtcFund,
  normalizeSearchResults,
  resolveCnFundName,
} from './markets/marketsCatalog.js';
import {
  formatSwitchLimitAmount,
  switchLimitToneFor,
  switchLimitLabelFor,
} from './switchStrategyHelpers.js';

const MARKETS = [
  { key: 'us', label: '美股' },
  { key: 'cn', label: 'A股' }
];

const MARKETS_PENDING_SYMBOL_KEY = 'markets:pendingSymbol';

// 行情中心底部“搜索或提问”输入条。提交后向全局 AI 抽屉发 prefill 事件，
// 抽屉会自动切到市场行情模式并预填问题。
// 右栏“研究”面板：inline 问答，点击预设问题或提交输入后直接调 /api/markets/ask。
// 不再弹出右下角 AI 抽屉。
export function MarketsExperience() {
  const [market, setMarket] = useState('cn');
  const [indices, setIndices] = useState([]);
  const [indicesLoading, setIndicesLoading] = useState(false);
  const [movers, setMovers] = useState([]);
  const [moversLoading, setMoversLoading] = useState(false);
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
  const [generatedAt, setGeneratedAt] = useState('');
  const reqIdRef = useRef(0);
  const symbolSearchSeqRef = useRef(0);
  const watchOverlaySearchSeqRef = useRef(0);
  const [klineMap, setKlineMap] = useState({});
  const klineInflightRef = useRef(new Set());
  const [sectors, setSectors] = useState([]);
  const [sectorsLoading, setSectorsLoading] = useState(false);
  // 侧边折叠状态：默认两组都展开。
  const [watchOpen, setWatchOpen] = useState(true);
  const [sectorsOpen, setSectorsOpen] = useState(true);
  const [sectorSearchOpen, setSectorSearchOpen] = useState(false);
  // 研究底部抽屉模式（仅 mobile）：peek=小片 / conversation=全屏展开
  const [researchMode, setResearchMode] = useState('peek');
  const [selectedSymbol, setSelectedSymbol] = useState('');
  const selectedSymbolRef = useRef('');
  const pendingSymbolHandledRef = useRef('');
  const [selectedQuoteMap, setSelectedQuoteMap] = useState({});
  const [detailHeaderHidden, setDetailHeaderHidden] = useState(false);
  const [symbolDetailTab, setSymbolDetailTab] = useState('overview');
  const [chartRange, setChartRange] = useState('1d');
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
  const [vpHeight, setVpHeight] = useState(null);
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' ? window.matchMedia('(max-width: 1023px)').matches : false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 1023px)');
    const h = () => setIsMobile(mq.matches);
    mq.addEventListener ? mq.addEventListener('change', h) : mq.addListener(h);
    return () => { mq.removeEventListener ? mq.removeEventListener('change', h) : mq.removeListener(h); };
  }, []);
  const researchModeRef = useRef('peek');
  useEffect(() => { researchModeRef.current = researchMode; }, [researchMode]);
  useEffect(() => {
    const vp = window.visualViewport;
    if (!vp) return;
    const handler = () => {
      const h = Math.round(vp.height);
      setVpHeight(h);
      // keyboard dismissed→back to peek if in search mode
      if (h > window.innerHeight * 0.85 && researchModeRef.current === 'search') {
        setResearchMode('peek');
      }
    };
    vp.addEventListener('resize', handler);
    return () => vp.removeEventListener('resize', handler);
  }, []);
  const researchDragRef = useRef({ startY: 0, lastY: 0, startT: 0, dragging: false, moved: false });
  const mainRef = useRef(null);
  const detailScrollRef = useRef({ y: 0 });
  const asideRef = useRef(null);
  const isDraggingRef = useRef(false);
  // 供侧边自选行【AI 分析】按钮跨组件触发右侧 ResearchPanel 发起结构化问答。
  // shape: { symbol, name } | null
  const [pendingAnalysis, setPendingAnalysis] = useState(null);

  const ensureKlines = useCallback(async (symbols) => {
    const uniq = Array.from(new Set((symbols || []).filter(Boolean)));
    const pending = uniq.filter((s) => !klineInflightRef.current.has(s));
    pending.forEach((s) => klineInflightRef.current.add(s));
    if (!pending.length) return;
    await Promise.all(
      pending.map(async (sym) => {
        try {
          const r = await fetchKline(sym, { timeframe: '1d' });
          const candles = Array.isArray(r && r.candles) ? r.candles : [];
          const pts = candles.slice(-30).map((c) => Number(c && c.c)).filter((v) => Number.isFinite(v));
          if (pts.length >= 2) setKlineMap((prev) => ({ ...prev, [sym]: pts }));
        } catch (err) {
          // sparkline is best-effort, ignore individual failures
        } finally {
          klineInflightRef.current.delete(sym);
        }
      })
    );
  }, []);

  const watchLists = Array.isArray(watch.lists) ? watch.lists : [];
  const activeWatchList = watchLists.find((item) => item.id === watch.activeListId) || watchLists[0] || { us: [], cn: [], name: '默认列表' };
  const isActiveOtcList = activeWatchList.type === 'cn_otc' || activeWatchList.id === 'default-otc';
  const watchSymbols = useMemo(() => activeWatchList[market] || [], [activeWatchList, market]);
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
    () => aggregateByCode(holdingsLedger.transactions, holdingsLedger.snapshotsByCode).filter((agg) => agg.hasPosition),
    [holdingsLedger]
  );
  const trackedWatchSymbols = useMemo(
    () => watchSymbols,
    [watchSymbols]
  );
  useEffect(() => {
    selectedSymbolRef.current = selectedSymbol;
  }, [selectedSymbol]);

  useEffect(() => {
    if (!selectedSymbol || !isMobile) return;
    setResearchMode('peek');
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

  const refreshIndices = useCallback(async (forceRefresh = false) => {
    setIndicesLoading(true);
    const reqId = ++reqIdRef.current;
    try {
      const r = await fetchIndices(market, { refresh: forceRefresh });
      if (reqId !== reqIdRef.current) return;
      const list = Array.isArray(r.indexes) ? r.indexes : [];
      setIndices(list);
      if (!selectedSymbolRef.current) ensureKlines(list.map((it) => it.symbol).filter(Boolean));
      setGeneratedAt(r.generatedAt || '');
    } catch (err) {
      if (reqId !== reqIdRef.current) return;
      showActionToast('指数加载失败', 'error');
    } finally {
      if (reqId === reqIdRef.current) setIndicesLoading(false);
    }
  }, [market, ensureKlines]);

  const refreshMovers = useCallback(async (forceRefresh = false) => {
    setMoversLoading(true);
    try {
      const r = await fetchMovers(market, { direction: 'mixed', refresh: forceRefresh });
      const list = Array.isArray(r.list) ? r.list : [];
      setMovers(list);
      if (!selectedSymbolRef.current) ensureKlines(list.map((it) => it.symbol).filter(Boolean));
    } catch (err) {
      showActionToast('涨跌榜加载失败', 'error');
    } finally {
      setMoversLoading(false);
    }
  }, [market, ensureKlines]);

  const refreshNews = useCallback(async () => {
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
    const list = trackedWatchSymbols || [];
    if (!list.length) {
      setWatchQuotes({});
      setWatchNavSnapshots({});
      return;
    }
    setWatchLoading(true);
    try {
      const { quotes, navSnapshots, fundFees } = await loadWatchQuotesWithEnhancements({
        symbols: list,
        market,
        fetchQuotes,
        getNavSnapshots,
        fetchFundFees,
        buildOtcFundQuoteFromSnapshot,
        hasNasdaqOtcFund,
      });
      if (Object.keys(navSnapshots).length) {
        setWatchNavSnapshots((prev) => ({ ...prev, ...navSnapshots }));
      }
      if (Object.keys(fundFees).length) {
        setFundFeesByCode((prev) => ({ ...prev, ...fundFees }));
      }
      setWatchQuotes(quotes);
    } catch (err) {
      // ignore
    } finally {
      setWatchLoading(false);
    }
  }, [trackedWatchSymbols, market]);

  // 场外基金申购限额：批量拉取，仅限当前活跃列表含 6 位数代码时触发。
  useEffect(() => {
    if (market !== 'cn') { setFundLimitsByCode({}); return undefined; }
    const codes = (trackedWatchSymbols || [])
      .map((sym) => normalizeCnFundCode(sym))
      .filter((code) => /^\d{6}$/.test(code));
    if (!codes.length) { setFundLimitsByCode({}); return undefined; }
    const ctrl = new AbortController();
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch('/api/fund-limit', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ codes }),
          cache: 'no-store',
          signal: ctrl.signal
        });
        if (!resp.ok) {
          if (resp.status === 405) {
            const entries = await Promise.all(
              codes.map((code) =>
                fetch(`/api/fund-limit?code=${encodeURIComponent(code)}`, { cache: 'no-store', signal: ctrl.signal })
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
            setFundLimitsByCode(next);
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
        setFundLimitsByCode(next);
      } catch (err) {
        if (err && err.name === 'AbortError') return;
      }
    })();
    return () => { cancelled = true; ctrl.abort(); };
  }, [trackedWatchSymbols, market]);

  // 美股 11 大行业指数（Google Finance 同款）。A 股暂未接入。
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
      if (!selectedSymbolRef.current) ensureKlines(list.map((it) => it.symbol).filter(Boolean));
    } catch (err) {
      // 行业是增量信息，失败不弹 toast，避免骩扰。
      setSectors([]);
    } finally {
      setSectorsLoading(false);
    }
  }, [market, ensureKlines]);

  // 当 selectedSymbol / chartRange 变化时拉取对应 tf 的 candles。
  useEffect(() => {
    if (!selectedSymbol) return;
    const cfg = CHART_RANGE_TABS.find((r) => r.key === chartRange);
    if (!cfg) return;
    const cacheKey = `${selectedSymbol}|${cfg.tf}`;
    if (chartCandlesMap[cacheKey]) return;
    if (chartInflightRef.current.has(cacheKey)) return;
    chartInflightRef.current.add(cacheKey);
    setChartLoading(true);
    let cancelled = false;
    (async () => {
      try {
        const r = await fetchKline(selectedSymbol, { timeframe: cfg.tf });
        const candles = Array.isArray(r && r.candles) ? r.candles : [];
        if (!cancelled) setChartCandlesMap((prev) => ({ ...prev, [cacheKey]: candles }));
      } catch (_) {
        if (!cancelled) setChartCandlesMap((prev) => ({ ...prev, [cacheKey]: [] }));
      } finally {
        chartInflightRef.current.delete(cacheKey);
        if (!cancelled) setChartLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedSymbol, chartRange, chartCandlesMap]);





  // 当前标的切到财务 tab 时按需拉 Yahoo quoteSummary 三大表。
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
        if (!cancelled) setFinancialsMap((prev) => ({ ...prev, [selectedSymbol]: { statements: { income: { annual: [], quarterly: [] }, balance: { annual: [], quarterly: [] }, cashflow: { annual: [], quarterly: [] } } } }));
      } finally {
        financialsInflightRef.current.delete(selectedSymbol);
        if (!cancelled) setFinancialsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedSymbol, market, symbolDetailTab, financialsMap]);

  useEffect(() => {
    if (!selectedSymbol || market !== 'cn') return;
    const code = normalizeCnFundCode(selectedSymbol);
    if (!/^\d{6}$/.test(code) || hasNasdaqOtcFund(code)) return;
    if (Object.prototype.hasOwnProperty.call(xueqiuFundDataMap, selectedSymbol)) return;
    if (xueqiuFundInflightRef.current.has(selectedSymbol)) return;
    xueqiuFundInflightRef.current.add(selectedSymbol);
    setXueqiuFundLoading(true);
    let cancelled = false;
    (async () => {
      try {
        const r = await fetchXueqiuFundData(selectedSymbol, { raw: true });
        if (!cancelled) setXueqiuFundDataMap((prev) => ({ ...prev, [selectedSymbol]: r }));
      } catch (_) {
        if (!cancelled) setXueqiuFundDataMap((prev) => ({ ...prev, [selectedSymbol]: null }));
      } finally {
        xueqiuFundInflightRef.current.delete(selectedSymbol);
        if (!cancelled) setXueqiuFundLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedSymbol, market, xueqiuFundDataMap]);

  useEffect(() => {
    refreshIndices(false);
    refreshNews();
    refreshEarnings(false);
  }, [refreshIndices, refreshNews, refreshEarnings]);

  useEffect(() => {
    refreshMovers(false);
  }, [refreshMovers]);

  useEffect(() => {
    refreshSummary(false);
  }, [refreshSummary]);

  useEffect(() => {
    refreshWatch();
  }, [refreshWatch]);

  useEffect(() => {
    refreshSectors(false);
  }, [refreshSectors]);

  // 自选股迷你图只在总览态加载；进入详情后避免为侧栏批量补拉 1d K 线。
  useEffect(() => {
    if (selectedSymbol) return;
    ensureKlines(trackedWatchSymbols);
  }, [selectedSymbol, trackedWatchSymbols, ensureKlines]);

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
      const activeMarket = MARKETS.find((m) => m.key === market) || MARKETS[0];
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
        })
        .catch((err) => {
          if (controller.signal.aborted || seq !== symbolSearchSeqRef.current) return;
          setSymbolSearchResults([]);
          setSymbolSearchError('搜索失败，稍后再试');
        })
        .finally(() => {
          if (seq === symbolSearchSeqRef.current) setSymbolSearchLoading(false);
        });
    }, 220);
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
      const activeMarket = MARKETS.find((m) => m.key === market) || MARKETS[0];
      searchSymbols(activeMarket.key, q, { limit: 10, signal: controller.signal })
        .then((r) => {
          if (seq !== watchOverlaySearchSeqRef.current) return;
          const rows = normalizeSearchResults(Array.isArray(r && r.results) ? r.results : [], activeMarket.key, q);
          setWatchOverlaySearchResults(rows.slice(0, 10));
        })
        .catch((err) => {
          if (controller.signal.aborted || seq !== watchOverlaySearchSeqRef.current) return;
          setWatchOverlaySearchResults([]);
          setWatchOverlaySearchError('搜索失败，稍后再试');
        })
        .finally(() => {
          if (seq === watchOverlaySearchSeqRef.current) setWatchOverlaySearchLoading(false);
        });
    }, 220);
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
    setSelectedQuoteMap((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        ...row,
        symbol,
        name: row.name || row.shortName || row.displayName || prev[key]?.name || CN_ETF_PRESET_MAP[symbol]?.name || symbol,
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
    const targetMarket = marketOverride || market;
    const next = addToWatchlist(targetMarket, raw, watch.activeListId);
    setWatch(next);
    setMarket(targetMarket);
    rememberSelectedQuote({ symbol: raw }, targetMarket);
    setSelectedSymbol(raw);
    setSymbolDetailTab('overview');
    setSymbolInput('');
    setSymbolSearchResults([]);
    setSectorSearchOpen(false);
  }

  function handlePickSymbolSearch(row) {
    if (!row || !row.symbol) return;
    setWatchListExpanded(false);
    const targetMarket = row.market || market;
    const symbol = rememberSelectedQuote(row, targetMarket);
    if (!symbol) return;
    setMarket(targetMarket);
    setSelectedSymbol(symbol);
    setSymbolDetailTab('overview');
    setResearchMode('peek');
    setSymbolInput('');
    setSymbolSearchResults([]);
    setSectorSearchOpen(false);
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
  }

  function handleClearWatchOverlaySearch() {
    setWatchOverlaySearchInput('');
    setWatchOverlaySearchResults([]);
    setWatchOverlaySearchError('');
  }

  function handleAddSearchResult(row) {
    if (!row || !row.symbol) return;
    const targetMarket = row.market || market;
    const symbol = String(row.symbol || row.code || row.ticker || '').trim().toUpperCase();
    if (!symbol) return;
    const next = addToWatchlist(targetMarket, symbol, watch.activeListId);
    setWatch(next);
    rememberSelectedQuote(row, targetMarket);
    showActionToast('已加入自选', 'success');
  }

  function handlePickMover(row) {
    const next = addToWatchlist(market, row.symbol, watch.activeListId);
    setWatch(next);
    setSelectedSymbol(row.symbol);
    setSymbolDetailTab('overview');
    showActionToast('已加入自选', 'success');
  }

  function handleSelectWatchlist(listId) {
    setWatchListExpanded(false);
    const next = setActiveWatchlist(listId);
    setWatch(next);
    setSelectedSymbol('');
    setSymbolDetailTab('overview');
  }

  function handleCreateWatchlist() {
    setWatchlistDialog({ type: 'create', name: `列表 ${(watchLists || []).length + 1}` });
  }

  function handleRenameWatchlist(list) {
    if (!list) return;
    setWatchlistDialog({ type: 'rename', list, name: list.name || '' });
  }

  function handleDeleteWatchlist(list) {
    if (!list || list.id === 'default') return;
    setWatchlistDialog({ type: 'delete', list, name: list.name || '' });
  }

  function handleWatchlistDialogSubmit() {
    if (!watchlistDialog) return;
    if (watchlistDialog.type === 'delete') {
      const next = deleteWatchlist(watchlistDialog.list?.id);
      setWatch(next);
      setSelectedSymbol('');
      setSymbolDetailTab('overview');
      setWatchlistDialog(null);
      setWatchListExpanded(false);
      showActionToast('列表已删除', 'success');
      return;
    }
    const trimmed = String(watchlistDialog.name || '').trim();
    if (!trimmed) return;
    if (watchlistDialog.type === 'rename') {
      if (trimmed !== watchlistDialog.list?.name) {
        const next = renameWatchlist(watchlistDialog.list?.id, trimmed);
        setWatch(next);
        showActionToast('列表已改名', 'success');
      }
      setWatchlistDialog(null);
      return;
    }
    const next = createWatchlist(trimmed);
    setWatch(next);
    setSelectedSymbol('');
    setSymbolDetailTab('overview');
    setWatchlistDialog(null);
    setWatchListExpanded(false);
    showActionToast('已新建列表', 'success');
  }

  function handleSelectSymbol(row, options = {}) {
    if (!row || !row.symbol) return;
    setWatchListExpanded(false);
    const targetMarket = options.market || row.market || market;
    if (targetMarket && targetMarket !== market) setMarket(targetMarket);
    const symbol = rememberSelectedQuote(row, targetMarket) || row.symbol;
    setSelectedSymbol(symbol);
    setSymbolDetailTab('overview');
    setResearchMode(options.openResearch ? 'conversation' : 'peek');
  }

  const buildSidebarRow = useCallback((sym) => {
    const code = normalizeCnFundCode(sym);
    const q = watchQuotes[sym] || (code ? watchQuotes[code] : null) || {};
    const snapshot = code ? watchNavSnapshots[code] : null;
    const otcQuote = market === 'cn' && hasNasdaqOtcFund(code)
      ? buildOtcFundQuoteFromSnapshot(sym, snapshot, q)
      : null;
    const merged = otcQuote || q;
    const latestNavDate = merged.latestNavDate || snapshot?.latestNavDate || '';
    const isOtc = isCnOtcFundQuote(merged) || (market === 'cn' && hasNasdaqOtcFund(code));
    const fundLimit = code ? fundLimitsByCode[code] || null : null;
    let baseMeta = '';
    if (isOtc) {
      const parts = ['场外基金'];
      if (fundLimit) {
        const tone = switchLimitToneFor(fundLimit.buyStatus);
        const label = switchLimitLabelFor(fundLimit.buyStatus);
        const amt = fundLimit.maxPurchasePerDay;
        const amtText = Number(amt) > 0 ? ` 日限${formatSwitchLimitAmount(amt)}` : '';
        parts.push(`${label}${amtText}`);
      }
      parts.push(latestNavDate ? `净值日 ${latestNavDate.slice(5)}` : '净值');
      baseMeta = parts.join(' · ');
    }
    return {
      symbol: sym,
      name: market === 'cn' ? resolveCnFundName(sym, merged.name || CN_ETF_PRESET_MAP[sym]?.name || sym) : (merged.name || CN_ETF_PRESET_MAP[sym]?.name || sym),
      price: merged.price,
      changePercent: merged.changePercent,
      change: merged.change,
      previousClose: merged.previousClose,
      open: merged.open,
      high: merged.high,
      low: merged.low,
      volume: merged.volume,
      marketCap: merged.marketCap,
      exchange: merged.exchange || CN_ETF_PRESET_MAP[sym]?.exchange,
      currency: merged.currency || CN_ETF_PRESET_MAP[sym]?.currency,
      latestNav: merged.latestNav || snapshot?.latestNav,
      iopv: merged.iopv,
      premiumPercent: merged.premiumPercent ?? merged.premium_rate,
      premium_rate: merged.premium_rate ?? merged.premiumPercent,
      currentYearPercent: merged.currentYearPercent ?? merged.current_year_percent,
      totalShares: merged.totalShares ?? merged.total_shares,
      feeRate: fundFeesByCode[code]?.annualFeeRate ?? merged.feeRate ?? merged.expenseRatio ?? merged.managementFeeRate,
      fundFee: fundFeesByCode[code] || null,
      latestNavDate,
      valueType: merged.valueType,
      assetType: merged.assetType,
      source: merged.source,
      fundLimit,
      market,
      meta: baseMeta
    };
  }, [watchQuotes, watchNavSnapshots, fundFeesByCode, fundLimitsByCode, market]);

  const watchRows = useMemo(
    () => watchSymbols.map((sym) => buildSidebarRow(sym)),
    [watchSymbols, buildSidebarRow]
  );

  const activeSidebarRows = watchRows;
  const activeSidebarEmptyText = '未配置自选。';

  const selectedStoredQuote = selectedSymbol ? selectedQuoteMap[`${market}:${selectedSymbol}`] : null;
  const selectedQuote = useMemo(
    () => {
      const watchRow = watchRows.find((row) => row.symbol === selectedSymbol) || null;
      if (selectedStoredQuote && Number.isFinite(Number(selectedStoredQuote.price))) return selectedStoredQuote;
      return watchRow || selectedStoredQuote || null;
    },
    [selectedSymbol, selectedStoredQuote, watchRows]
  );
  const selectedCnFundCode = market === 'cn' ? normalizeCnFundCode(selectedSymbol || selectedQuote?.symbol) : '';
  const selectedTradeMarkers = useMemo(() => {
    if (!selectedCnFundCode) return [];
    const holdingAlias = heldAggregates.find((agg) => normalizeCnFundCode(agg.code) === selectedCnFundCode);
    return buildHoldingTradeMarkers(
      [...(holdingsLedger.transactions || []), ...(tradeLedgerEntries || [])],
      selectedCnFundCode,
      [selectedSymbol, selectedQuote?.symbol, selectedQuote?.code, selectedQuote?.name, holdingAlias?.name]
    );
  }, [holdingsLedger.transactions, tradeLedgerEntries, selectedCnFundCode, selectedSymbol, selectedQuote?.symbol, selectedQuote?.code, selectedQuote?.name, heldAggregates]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.title = selectedQuote ? formatBrowserTitleForQuote(selectedQuote) : '行情中心';
  }, [selectedQuote]);

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
          const snapshot = await getNavSnapshot(code);
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
    if (market !== 'cn' || !selectedSymbol) return;
    const symbol = normalizeCnFundCode(selectedSymbol);
    if (isCnOtcFundQuote(selectedQuote)) {
      if (/^\d{6}$/.test(symbol)) {
        setPremiumMap((prev) => ({
          ...prev,
          [symbol]: {
            loading: false,
            error: '',
            data: {
              symbol,
              price: Number(selectedQuote?.price),
              baseNav: Number(selectedQuote?.latestNav || selectedQuote?.price),
              navDate: selectedQuote?.latestNavDate || '',
              iopv: Number(selectedQuote?.latestNav || selectedQuote?.price),
              premiumPercent: null,
              isOtcFund: true,
              message: '场外基金无溢价数据'
            }
          }
        }));
      }
      return;
    }
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
        const premium = await getCnEtfPremiumSnapshot(symbol, {
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
  }, [market, selectedSymbol, chartRange, selectedQuote?.price]);

  useEffect(() => {
    if (market !== 'cn' || !selectedSymbol) return;
    const symbol = normalizeCnFundCode(selectedSymbol);
    if (!/^\d{6}$/.test(symbol)) return;
    const days = navHistoryDaysForRange(chartRange);
    const key = `${symbol}|${days}`;
    if (navHistoryMap[key]?.items?.length || navHistoryMap[key]?.loading || navHistoryMap[key]?.error || navHistoryInflightRef.current.has(key)) return;
    let cancelled = false;
    navHistoryInflightRef.current.add(key);
    setNavHistoryMap((prev) => ({ ...prev, [key]: { loading: true, items: prev[key]?.items || [], error: '' } }));
    getNavHistory(symbol, { days })
      .then(async (payload) => {
        if (cancelled) return;
        let items = Array.isArray(payload?.items) ? payload.items : [];
        if (items.length < 2) {
          try {
            const snapshot = await getNavSnapshot(symbol);
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
          const snapshot = await getNavSnapshot(symbol);
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
  }, [market, selectedSymbol, chartRange]);

  function handleResearchHandleClick() {
    if (researchDragRef.current.moved) {
      researchDragRef.current.moved = false;
      return;
    }
    setResearchMode((mode) => mode === 'peek' ? 'conversation' : 'peek');
  }

  function handleResearchDragInit(event) {
    const aside = asideRef.current;
    const startH = aside ? aside.offsetHeight : (researchMode === 'peek' ? 130 : 600);
    researchDragRef.current = { startY: event.clientY, lastY: event.clientY, startH, startT: Date.now(), dragging: true, moved: false };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch (_error) { /* best-effort */ }
    isDraggingRef.current = true;
    if (aside) {
      aside.style.transition = 'none';
      aside.style.height = `${startH}px`;
    }
    if (researchMode === 'peek') setResearchMode('conversation');
  }

  function handleResearchDragMove(event) {
    const dragState = researchDragRef.current;
    if (!dragState.dragging) return;
    const dy = event.clientY - dragState.startY;
    dragState.lastY = event.clientY;
    if (Math.abs(dy) > 6) dragState.moved = true;
    const vh = vpHeight || (typeof window !== 'undefined' ? window.innerHeight : 844);
    const peekH = 130;
    const fullH = vh;
    let nextHeight = dragState.startH - dy;
    if (nextHeight > fullH) nextHeight = fullH + Math.min((nextHeight - fullH) * 0.3, 36);
    if (nextHeight < peekH) nextHeight = peekH - Math.min((peekH - nextHeight) * 0.3, 36);
    if (asideRef.current) asideRef.current.style.height = `${nextHeight}px`;
  }

  function handleResearchDragEnd(event) {
    const dragState = researchDragRef.current;
    if (!dragState.dragging) return;
    dragState.dragging = false;
    const dy = event.clientY - dragState.startY;
    const dt = Math.max(Date.now() - dragState.startT, 1);
    const velocity = dy / dt;
    let nextMode = researchMode;
    if (researchMode === 'peek' && (dy < -60 || velocity < -0.4)) nextMode = 'conversation';
    else if (researchMode === 'conversation' && (dy > 60 || velocity > 0.4)) nextMode = 'peek';
    const aside = asideRef.current;
    if (aside) {
      aside.style.transition = '';
      const vh = vpHeight || (typeof window !== 'undefined' ? window.innerHeight : 844);
      const target = nextMode === 'conversation' ? vh : nextMode === 'search' ? vh : 130;
      aside.style.height = `${target}px`;
    }
    isDraggingRef.current = false;
    if (nextMode !== researchMode) setResearchMode(nextMode);
    else if (researchMode === 'conversation' && nextMode === 'conversation') {
      setResearchMode((mode) => mode);
    }
  }

  function handleResearchDragCancel() {
    researchDragRef.current.dragging = false;
    const aside = asideRef.current;
    if (aside) {
      aside.style.transition = '';
      const vh = vpHeight || (typeof window !== 'undefined' ? window.innerHeight : 844);
      const target = researchMode === 'conversation' ? vh : researchMode === 'search' ? vh : 130;
      aside.style.height = `${target}px`;
    }
    isDraggingRef.current = false;
  }

  return (
    <>
    <WatchlistNameDialog
      dialog={watchlistDialog}
      onChangeName={(name) => setWatchlistDialog((prev) => prev ? { ...prev, name } : prev)}
      onCancel={() => setWatchlistDialog(null)}
      onSubmit={handleWatchlistDialogSubmit}
    />
    <ExpandedMarketListOverlay
      open={watchListExpanded}
      rows={activeSidebarRows}
      klineMap={klineMap}
      selectedSymbol={selectedSymbol}
      activeName={activeWatchList?.name}
      marketLabel={market === 'us' ? '美股监控列表' : 'A 股监控列表'}
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
      showLimitColumn={isActiveOtcList && market === 'cn'}
    />
    <div className={cx(
      "flex flex-col gap-5 lg:grid lg:h-[calc(100vh-6rem)] lg:min-h-0 lg:grid-cols-[280px_minmax(0,1fr)_360px] lg:items-stretch lg:gap-4 lg:overflow-hidden lg:pb-0 xl:grid-cols-[320px_minmax(0,1fr)_400px]",
      selectedSymbol ? "pb-4" : "pb-[140px]"
    )}>
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
      />

      <MarketsMainContent
        mainRef={mainRef}
        market={market}
        onMarketChange={setMarket}
        selectedQuote={selectedQuote}
        detailHeaderHidden={detailHeaderHidden}
        indices={indices}
        indicesLoading={indicesLoading}
        klineMap={klineMap}
        onPickIndex={handlePickMover}
        onRefreshAll={() => {
          refreshIndices(true);
          refreshNews();
          refreshEarnings(true);
          refreshWatch();
          refreshSummary(true);
        }}
        news={news}
        newsLoading={newsLoading}
        earnings={earnings}
        earningsLoading={earningsLoading}
        summary={summary}
        summaryLoading={summaryLoading}
        onRefreshSummary={() => refreshSummary(true)}
        detail={{
          financials: financialsMap[selectedQuote?.symbol],
          financialsLoading: financialsLoading && !financialsMap[selectedQuote?.symbol],
          xueqiuFundData: xueqiuFundDataMap[selectedQuote?.symbol],
          xueqiuFundLoading: xueqiuFundLoading && !xueqiuFundDataMap[selectedQuote?.symbol],
          activeTab: symbolDetailTab,
          onTabChange: setSymbolDetailTab,
          chartRange,
          onChartRangeChange: setChartRange,
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
          onAnalyze: () => {
            if (!selectedQuote) return;
            handleSelectSymbol(selectedQuote, { openResearch: true });
            setPendingAnalysis({ symbol: selectedQuote.symbol, name: selectedQuote.name });
          },
          onBack: () => {
            setSelectedSymbol('');
            setSymbolDetailTab('overview');
          },
        }}
      />

      {/* Backdrop when conversation */}
      {researchMode === 'conversation' && (
        <div className="fixed inset-0 z-30 bg-white lg:hidden" onClick={() => setResearchMode('peek')} />
      )}
      {/* Research panel: PC = sticky aside / Mobile = bottom sheet */}
      <MarketsResearchShell
        market={market}
        mode={researchMode}
        onModeChange={setResearchMode}
        watchSymbols={watchSymbols}
        watchQuotes={watchQuotes}
        selectedSymbol={selectedSymbol}
        selectedQuote={selectedQuote}
        pendingAnalysis={pendingAnalysis}
        onAnalysisConsumed={() => setPendingAnalysis(null)}
        isMobile={isMobile}
        vpHeight={vpHeight}
        asideRef={asideRef}
        researchDragRef={researchDragRef}
        isDraggingRef={isDraggingRef}
        onHandleClick={handleResearchHandleClick}
        onDragInit={handleResearchDragInit}
        onDragMove={handleResearchDragMove}
        onDragEnd={handleResearchDragEnd}
        onDragCancel={handleResearchDragCancel}
      />
    </div>
    </>
  );
}
