import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronDown, ChevronRight, ChevronUp, ListPlus, Loader2, Plus, RefreshCw, Search, Star, TrendingUp, X } from 'lucide-react';
import {
  Card,
  Pill,
  TextInput,
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
  CN_ETF_WATCHLIST_PRESETS
} from '../app/marketsApi.js';
import { showActionToast } from '../app/toast.js';
import { readLedgerState } from '../app/holdingsLedger.js';
import { readTradeLedger, TRADE_LEDGER_UPDATED_EVENT } from '../app/tradeLedger.js';
import { aggregateByCode } from '../app/holdingsLedgerCore.js';
import { getCnEtfPremiumSnapshot, getNavHistory, getNavSnapshot, getNavSnapshots } from '../app/navService.js';
import { ExpandedMarketListOverlay } from './markets/ExpandedMarketListOverlay.jsx';
import { ListExpandButton } from './markets/ListExpandButton.jsx';
import { MarketListTable } from './markets/MarketListTable.jsx';
import { SymbolDetailPanel } from './markets/MarketSymbolDetailPanel.jsx';
import { MarketsResearchPanel } from './markets/MarketsResearchPanel.jsx';
import { IndexCard, MobileSidebarRow, SidebarRow } from './markets/MarketSidebarRows.jsx';
import {
  EarningsCalendar,
  LatestNewsList,
  ThemeExploreButton,
  siteFavicon,
  siteHost,
  sourceInitials,
} from './markets/MarketNewsPanels.jsx';
import { WatchlistNameDialog, WatchlistSelector } from './markets/WatchlistControls.jsx';
import {
  CHART_RANGE_TABS,
  buildNavSnapshotItems,
  buildHoldingTradeMarkers,
  isCnOtcFundQuote,
  navHistoryDaysForRange,
  sliceCandlesForRange,
} from './markets/marketFundMetrics.js';
import {
  formatNumber,
  formatSymbolDisplay,
  normalizeCnFundCode,
} from './markets/marketDisplayUtils.js';
import nasdaqOtcCatalog from '../../data/all_nasdq_otc.json';

const MARKETS = [
  { key: 'us', label: '美股' },
  { key: 'cn', label: 'A股' }
];

const CN_ETF_PRESET_MAP = Object.fromEntries(CN_ETF_WATCHLIST_PRESETS.map((item) => [item.symbol, item]));
const NASDAQ_OTC_FUND_MAP = Object.fromEntries(((nasdaqOtcCatalog && nasdaqOtcCatalog.funds) || []).map((item) => [String(item.code || '').trim(), item]));
const MARKETS_PENDING_SYMBOL_KEY = 'markets:pendingSymbol';

function formatTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('zh-CN', { hour12: false });
}

function formatBrowserTitleForQuote(quote) {
  if (!quote || !quote.symbol) return '行情中心';
  const symbol = formatSymbolDisplay(quote.symbol);
  const price = Number(quote.price);
  const pct = Number(quote.changePercent);
  const currency = String(quote.currency || '').trim().toUpperCase();
  const priceText = Number.isFinite(price)
    ? `${currency && currency !== 'CNY' ? `${currency} ` : ''}${formatNumber(price, 2)}`
    : '--';
  const pctText = Number.isFinite(pct)
    ? `${pct < 0 ? '▼' : pct > 0 ? '▲' : ''} ${Math.abs(pct).toFixed(2)}%`
    : '--';
  return `${symbol} ${priceText} (${pctText})`;
}

function resolveCnFundName(codeOrSymbol, fallback = '') {
  const code = normalizeCnFundCode(codeOrSymbol);
  const fallbackText = String(fallback || '').trim();
  const isCodeOnlyFallback = fallbackText && normalizeCnFundCode(fallbackText) === code;
  return (code && NASDAQ_OTC_FUND_MAP[code]?.name)
    || (!isCodeOnlyFallback ? fallbackText : '')
    || code
    || fallbackText;
}

function buildOtcCandidate(code, fallback = {}) {
  const normalizedCode = normalizeCnFundCode(code || fallback.code || fallback.symbol);
  const catalog = NASDAQ_OTC_FUND_MAP[normalizedCode] || {};
  const name = resolveCnFundName(normalizedCode, fallback.name || fallback.shortName || fallback.displayName);
  return {
    ...fallback,
    symbol: normalizedCode,
    code: normalizedCode,
    name,
    market: 'cn',
    exchange: '场外基金',
    assetType: 'otc_fund',
    linkedSymbol: catalog.link_to || fallback.linkedSymbol || '',
    indexKey: catalog.index_key || fallback.indexKey || ''
  };
}

function normalizeSearchResults(rawRows, marketKey, query = '') {
  const seen = new Set();
  const rows = Array.isArray(rawRows) ? [...rawRows] : [];
  const otcCode = normalizeCnFundCode(query);
  if (marketKey === 'cn' && /^\d{6}$/.test(otcCode) && !rows.some((row) => normalizeCnFundCode(row.symbol || row.code || row.ticker) === otcCode)) {
    rows.push(buildOtcCandidate(otcCode));
  }
  return rows.map((row) => {
    const symbol = String(row && (row.symbol || row.code || row.ticker) || '').trim().toUpperCase();
    if (!symbol || seen.has(symbol)) return null;
    seen.add(symbol);
    return {
      ...row,
      symbol,
      market: marketKey,
      marketLabel: marketKey === 'cn' ? 'A股' : '美股',
    };
  }).filter(Boolean);
}

function buildOtcFundQuoteFromSnapshot(symbol, snapshot, fallback = {}) {
  const latestNav = Number(snapshot?.latestNav);
  if (!Number.isFinite(latestNav) || latestNav <= 0) return null;
  const previousNav = Number(snapshot?.previousNav);
  const hasPrevious = Number.isFinite(previousNav) && previousNav > 0;
  const change = hasPrevious ? latestNav - previousNav : 0;
  return {
    ...fallback,
    symbol: String(symbol || snapshot?.code || fallback.symbol || '').trim().toUpperCase(),
    code: String(snapshot?.code || symbol || fallback.code || '').replace(/\D/g, '').slice(-6),
    name: resolveCnFundName(snapshot?.code || symbol || fallback.code, snapshot?.name || fallback.name || fallback.displayName || fallback.shortName),
    market: 'cn',
    exchange: '场外基金',
    currency: 'CNY',
    price: latestNav,
    previousClose: hasPrevious ? previousNav : latestNav,
    change,
    changePercent: hasPrevious ? (change / previousNav) * 100 : 0,
    latestNav,
    latestNavDate: snapshot?.latestNavDate || '',
    previousNav: hasPrevious ? previousNav : null,
    previousNavDate: snapshot?.previousNavDate || '',
    asOf: snapshot?.updatedAt || new Date().toISOString(),
    lastUpdated: snapshot?.updatedAt || new Date().toISOString(),
    source: 'otc-fund-nav-fallback',
    valueType: 'nav',
    assetType: 'otc_fund'
  };
}

function SummaryModule({ themes = [], loading, onRefresh }) {
  const hasContent = Array.isArray(themes) && themes.length > 0;
  const [expanded, setExpanded] = useState({ 0: true });
  const toggleTheme = useCallback((idx) => {
    setExpanded((prev) => ({ ...prev, [idx]: !prev[idx] }));
  }, []);
  return (
    <Card className="space-y-0">
      <div className="flex items-center justify-between gap-3 pb-1">
        <h2 className="text-lg font-semibold text-slate-900">美国市场概况</h2>
        <div className="flex items-center gap-2">
          {loading && <Loader2 size={12} className="animate-spin text-slate-400" />}
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              aria-label="重新生成主题"
              className="inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-indigo-600"
            >
              <RefreshCw size={12} />
            </button>
          )}
        </div>
      </div>
      {hasContent ? (
        <ul className="divide-y divide-slate-200/70">
          {themes.map((t, idx) => {
            const isOpen = !!expanded[idx];
            const sources = (t.sources || []).filter((s) => s && s.url);
            return (
              <li key={idx} className="py-3.5 first:pt-3 last:pb-3">
                <button
                  type="button"
                  onClick={() => toggleTheme(idx)}
                  className="flex w-full items-start justify-between gap-4 text-left"
                  aria-expanded={isOpen}
                >
                  <span className="min-w-0 flex-1 text-[16px] font-semibold leading-snug text-slate-900">{t.title}</span>
                  <span className="flex shrink-0 items-center gap-2 pt-0.5">
                    {sources.length > 0 && (
                      <span className="flex items-center gap-1.5">
                        <span className="flex -space-x-1">
                          {sources.slice(0, 3).map((s, i) => {
                            const fav = siteFavicon(s.url);
                            return fav ? (
                              <img
                                key={i}
                                src={fav}
                                alt=""
                                loading="lazy"
                                className="h-4 w-4 rounded-full ring-2 ring-white"
                                onError={(e) => { e.currentTarget.style.display = 'none'; }}
                              />
                            ) : (
                              <span key={i} className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-slate-200 text-[8px] font-semibold text-slate-500 ring-2 ring-white">
                                {sourceInitials(s.source || siteHost(s.url))}
                              </span>
                            );
                          })}
                        </span>
                        <span className="text-[11px] text-slate-500">{sources.length}个网站</span>
                      </span>
                    )}
                    {isOpen
                      ? <ChevronUp size={18} className="text-slate-400" />
                      : <ChevronDown size={18} className="text-slate-400" />}
                  </span>
                </button>
                {isOpen && (
                  <div className="space-y-3 pt-3">
                    <p className="text-[13.5px] leading-[1.7] text-slate-600">{t.detail}</p>
                    <ThemeExploreButton theme={t} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : !loading ? (
        <p className="py-3 text-sm text-slate-400">暂未生成主题摘要。点右侧刷新按钮可请求重新生成。</p>
      ) : null}
    </Card>
  );
}

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
      const r = await fetchQuotes(list);
      const quotes = r.quotes || {};
      if (market === 'cn') {
        const otcCodes = list.map((sym) => normalizeCnFundCode(sym)).filter((code) => code && NASDAQ_OTC_FUND_MAP[code]);
        if (otcCodes.length) {
          try {
            const snapshotsPayload = await getNavSnapshots(otcCodes);
            const snapshots = Object.fromEntries((snapshotsPayload.items || []).map((item) => [item.code, item]));
            setWatchNavSnapshots((prev) => ({ ...prev, ...snapshots }));
            otcCodes.forEach((code) => {
              const existing = quotes[code] || quotes[`SZ${code}`] || quotes[`SH${code}`] || {};
              const quote = buildOtcFundQuoteFromSnapshot(code, snapshots[code], existing);
              if (quote) quotes[code] = quote;
            });
          } catch (_error) {
            // 场外基金净值是增强信息，失败时仍展示行情源返回的结果。
          }
        }
        const feeCodes = list.map((sym) => normalizeCnFundCode(sym)).filter((code) => /^\d{6}$/.test(code));
        if (feeCodes.length) {
          try {
            const feePayload = await fetchFundFees(feeCodes);
            const nextFees = {};
            (feePayload.items || []).forEach((item) => {
              if (item?.ok && item?.data?.code) nextFees[item.data.code] = item.data;
            });
            if (Object.keys(nextFees).length) {
              setFundFeesByCode((prev) => ({ ...prev, ...nextFees }));
            }
          } catch (_error) {
            // 费率是增强信息，失败时保留行情与本地 fallback。
          }
        }
      }
      setWatchQuotes(quotes);
    } catch (err) {
      // ignore
    } finally {
      setWatchLoading(false);
    }
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
    if (!/^\d{6}$/.test(code) || NASDAQ_OTC_FUND_MAP[code]) return;
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
    const otcQuote = market === 'cn' && code && NASDAQ_OTC_FUND_MAP[code]
      ? buildOtcFundQuoteFromSnapshot(sym, snapshot, q)
      : null;
    const merged = otcQuote || q;
    const latestNavDate = merged.latestNavDate || snapshot?.latestNavDate || '';
    const baseMeta = isCnOtcFundQuote(merged) || (market === 'cn' && code && NASDAQ_OTC_FUND_MAP[code])
      ? ['场外基金', latestNavDate ? `净值日 ${latestNavDate.slice(5)}` : '净值'].join(' · ')
      : '';
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
      market,
      meta: baseMeta
    };
  }, [watchQuotes, watchNavSnapshots, fundFeesByCode, market]);

  const watchRows = useMemo(
    () => watchSymbols.map((sym) => buildSidebarRow(sym)),
    [watchSymbols, buildSidebarRow]
  );

  const activeSidebarRows = watchRows;
  const activeSidebarEmptyText = '未配置自选。';

  const watchTopMovers = useMemo(
    () => watchRows.filter((row) => Number.isFinite(Number(row.changePercent))).slice().sort((a, b) => Math.abs(Number(b.changePercent)) - Math.abs(Number(a.changePercent))).slice(0, 6),
    [watchRows]
  );

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

  const marketStatusLabel = indicesLoading ? '刷新中' : (indices.length ? `${indices.length} 个指数` : '待加载');

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
    />
    <div className={cx(
      "flex flex-col gap-5 lg:grid lg:h-[calc(100vh-6rem)] lg:min-h-0 lg:grid-cols-[280px_minmax(0,1fr)_360px] lg:items-stretch lg:gap-4 lg:overflow-hidden lg:pb-0 xl:grid-cols-[320px_minmax(0,1fr)_400px]",
      selectedSymbol ? "pb-4" : "pb-[140px]"
    )}>
      {/* Mobile-only sidebar: Google Finance Beta style */}
      <aside className={cx("order-2 flex flex-col gap-2 lg:hidden", selectedSymbol && "hidden")}>
        <div className="px-1">
          <div className="flex items-center justify-between pt-1">
            <WatchlistSelector
              lists={watchLists}
              activeListId={watch.activeListId}
              onSelect={handleSelectWatchlist}
              onCreate={handleCreateWatchlist}
              onRename={handleRenameWatchlist}
              onDelete={handleDeleteWatchlist}
            />
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="新建列表"
                onClick={handleCreateWatchlist}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full text-[#5f6368] hover:bg-[#f1f3f4]"
              >
                <ListPlus size={22} />
              </button>
            </div>
          </div>
          <div className="mt-1 h-px w-full bg-[#e8eaed]" />
        </div>


        {/* 监控列表 */}
        <div className="px-1">
          <div className="flex items-center justify-between py-2">
            <h3 className="text-base font-semibold text-[#1f1f1f]">监控列表</h3>
            <button
              type="button"
              onClick={() => setWatchOpen((v) => !v)}
              aria-label={watchOpen ? '折叠' : '展开'}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[#5f6368] hover:bg-[#f1f3f4]"
            >
              {watchOpen ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
            </button>
          </div>
          {watchOpen && (
            <>
              {activeSidebarRows.length === 0 ? (
                <p className="px-2 py-2 text-sm text-[#5f6368]">{activeSidebarEmptyText}</p>
              ) : (
                <MarketListTable
                  rows={activeSidebarRows}
                  klineMap={klineMap}
                  selectedSymbol={selectedSymbol}
                  onSelect={handleSelectSymbol}
                  compact
                  stickyFirstColumn
                />
              )}
            </>
          )}
        </div>

        {/* 搜索与板块 */}
        <div className="px-1">
            <div className="flex items-center justify-between gap-2 py-2">
              {sectorSearchOpen ? (
                <form className="flex min-w-0 flex-1 items-center" onSubmit={handleAddSymbol}>
                  <div className="relative min-w-0 flex-1">
                    <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#5f6368]" />
                    <TextInput
                      autoFocus
                      className="h-10 w-full rounded-full border-[#dadce0] bg-white pl-9 pr-9 text-sm"
                      value={symbolInput}
                      onChange={(e) => setSymbolInput(e.target.value)}
                      placeholder={market === 'cn' ? '搜索 ETF / 股票，如 513100 / 标普500' : '搜索股票，如 AAPL / Apple'}
                    />
                    <button
                      type="button"
                      aria-label="关闭搜索"
                      className="absolute right-1.5 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-[#5f6368] hover:bg-[#f1f3f4]"
                      onClick={() => {
                        setSectorSearchOpen(false);
                        setSymbolInput('');
                        setSymbolSearchResults([]);
                      }}
                    >
                      <X size={15} />
                    </button>
                  </div>
                </form>
              ) : (
                <h3 className="text-base font-semibold text-[#1f1f1f]">{market === 'cn' ? 'ETF / 股票' : '股票板块'}</h3>
              )}
              <div className="flex shrink-0 items-center gap-0.5">
                {!sectorSearchOpen && (
                  <button
                    type="button"
                    onClick={() => {
                      setSectorsOpen(true);
                      setSectorSearchOpen(true);
                    }}
                    aria-label="搜索并添加自选"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[#5f6368] hover:bg-[#f1f3f4]"
                  >
                    <Search size={19} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSectorsOpen((v) => !v)}
                  aria-label={sectorsOpen ? '折叠' : '展开'}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[#5f6368] hover:bg-[#f1f3f4]"
                >
                  {sectorsOpen ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                </button>
              </div>
            </div>
            {sectorsOpen && sectorSearchOpen && symbolInput.trim() ? (
              <div className="mb-2 rounded-2xl border border-[#e8eaed] bg-white shadow-sm">
                {symbolSearchLoading ? (
                  <div className="flex items-center gap-2 px-3 py-2 text-sm text-[#5f6368]"><Loader2 size={14} className="animate-spin" />搜索中…</div>
                ) : symbolSearchError ? (
                  <div className="px-3 py-2 text-sm text-rose-600">{symbolSearchError}</div>
                ) : symbolSearchResults.length ? (
                  <ul className="divide-y divide-[#e8eaed]">
                    {symbolSearchResults.map((row) => (
                      <li key={`${row.market || market}:${row.symbol}`}>
                        <button type="button" className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-[#f8fafd]" onClick={() => handlePickSymbolSearch(row)}>
                          <span className="min-w-0"><span className="block truncate text-sm font-semibold text-[#1f1f1f]">{formatSymbolDisplay(row.symbol)}</span><span className="block truncate text-xs text-[#5f6368]">{row.marketLabel ? `${row.marketLabel} · ` : ''}{row.name || row.exchange || '--'}</span></span>
                          <span className="shrink-0 rounded-full bg-[#e8f0fe] px-2 py-1 text-xs font-semibold text-[#1a73e8]">查看</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="px-3 py-2 text-sm text-[#5f6368]">没有找到匹配标的</div>
                )}
              </div>
            ) : null}
            {sectorsOpen && (
              sectors.length === 0 ? (
                <p className="px-2 py-2 text-sm text-[#5f6368]">{sectorsLoading ? '加载中…' : (market === 'cn' ? '可搜索并添加更多 A股 / ETF 标的' : '暂无数据')}</p>
              ) : (
                <ul className="divide-y divide-[#e8eaed]">
                  {sectors.map((row) => (
                    <MobileSidebarRow
                      key={row.symbol}
                      symbol={row.shortCode || row.symbol}
                      name={row.name}
                      price={row.price}
                      changePercent={row.changePercent}
                      sparkPoints={klineMap[row.symbol]}
                    />
                  ))}
                </ul>
              )
            )}
          </div>
      </aside>

      {/* PC-only sidebar: Google Finance Beta-style compact (设计不变) */}
      <aside className="order-2 hidden flex-col gap-3 lg:order-1 lg:flex lg:h-full lg:min-h-0 lg:overflow-hidden">
        <div className="flex h-full min-h-0 flex-col overflow-y-auto overscroll-contain bg-transparent pr-1 [scrollbar-gutter:stable]">
          {/* 顶部工具栏：「列表 ▾」下拉 + 添加 + 全屏 */}
          <div className="flex items-center justify-between gap-1 px-1 py-2">
            <WatchlistSelector
              lists={watchLists}
              activeListId={watch.activeListId}
              onSelect={handleSelectWatchlist}
              onCreate={handleCreateWatchlist}
              onRename={handleRenameWatchlist}
              onDelete={handleDeleteWatchlist}
            />
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="新建列表"
                title="新建列表"
                onClick={handleCreateWatchlist}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[#5f6368] hover:bg-[#f1f3f4] hover:text-[#1f1f1f]"
              >
                <ListPlus size={19} />
              </button>
              <ListExpandButton expanded={watchListExpanded} onClick={() => setWatchListExpanded((v) => !v)} />
            </div>
          </div>


          {/* 组 1：监控列表 */}
          <div className="px-1 pt-1">
            <button
              type="button"
              onClick={() => setWatchOpen((v) => !v)}
              className="flex w-full items-center gap-1.5 rounded-md px-2 py-2 text-[15px] font-medium text-[#1f1f1f] hover:bg-[#f1f3f4]"
            >
              {watchOpen ? <ChevronDown size={16} className="text-[#5f6368]" /> : <ChevronRight size={16} className="text-[#5f6368]" />}
              <Star size={14} className="text-amber-400" />
              <span>监控列表</span>
              {watchLoading && <Loader2 size={12} className="ml-1 animate-spin text-slate-400" />}
            </button>
          </div>
          {watchOpen && (
            <div className="px-1 pb-1">
              {activeSidebarRows.length === 0 ? (
                <p className="px-2 py-1 text-xs text-slate-400">{activeSidebarEmptyText}</p>
              ) : (
                <ul>
                  {activeSidebarRows.map((row) => (
                    <SidebarRow
                      key={row.symbol}
                      symbol={row.symbol}
                      name={row.name}
                      price={row.price}
                      changePercent={row.changePercent}
                      sparkPoints={klineMap[row.symbol]}
                      meta={row.meta}
                      selected={row.symbol === selectedSymbol}
                      onSelect={() => handleSelectSymbol(row)}
                    />
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* 组 2：搜索与板块。美股显示 S&P 11 行业；A股用于添加 ETF / 股票。 */}
          <>
              <div className="border-t border-slate-200/60 px-1 pt-1">
                <div className={cx('flex items-center gap-1 rounded-md', !sectorSearchOpen && 'hover:bg-[#f1f3f4]')}>
                  {sectorSearchOpen ? (
                    <form className="flex min-w-0 flex-1 items-center gap-2 py-1" onSubmit={handleAddSymbol}>
                      <button type="button" onClick={() => setSectorsOpen((v) => !v)} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#5f6368] hover:bg-[#f1f3f4]">
                        {sectorsOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      </button>
                      <div className="relative min-w-0 flex-1">
                        <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#5f6368]" />
                        <TextInput
                          autoFocus
                          className="h-8 w-full rounded-full border-[#dadce0] bg-white pl-8 pr-8 text-sm"
                          value={symbolInput}
                          onChange={(e) => setSymbolInput(e.target.value)}
                          placeholder={market === 'cn' ? '513100 / 标普500' : 'AAPL / Apple'}
                        />
                        <button
                          type="button"
                          aria-label="关闭搜索"
                          className="absolute right-1 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-[#5f6368] hover:bg-[#f1f3f4]"
                          onClick={() => {
                            setSectorSearchOpen(false);
                            setSymbolInput('');
                            setSymbolSearchResults([]);
                          }}
                        >
                          <X size={13} />
                        </button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => setSectorsOpen((v) => !v)}
                        className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-2 text-left text-[15px] font-medium text-[#1f1f1f]"
                      >
                        {sectorsOpen ? <ChevronDown size={16} className="text-[#5f6368]" /> : <ChevronRight size={16} className="text-[#5f6368]" />}
                        <TrendingUp size={14} className="text-indigo-400" />
                        <span>{market === 'cn' ? 'ETF / 股票' : '股票板块'}</span>
                        {sectorsLoading && <Loader2 size={12} className="ml-1 animate-spin text-slate-400" />}
                      </button>
                      <button
                        type="button"
                        title="搜索并添加自选"
                        aria-label="搜索并添加自选"
                        onClick={() => {
                          setSectorsOpen(true);
                          setSectorSearchOpen(true);
                        }}
                        className="mr-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#5f6368] hover:bg-white"
                      >
                        <Search size={16} />
                      </button>
                    </>
                  )}
                </div>
              </div>
              {sectorsOpen && (
                <div className="px-1 pb-2 pt-1">
                  {sectorSearchOpen && symbolInput.trim() ? (
                    <div className="mb-2 overflow-hidden rounded-xl border border-[#e8eaed] bg-white shadow-sm">
                      {symbolSearchLoading ? (
                        <div className="flex items-center gap-2 px-3 py-2 text-xs text-[#5f6368]"><Loader2 size={13} className="animate-spin" />搜索中…</div>
                      ) : symbolSearchError ? (
                        <div className="px-3 py-2 text-xs text-rose-600">{symbolSearchError}</div>
                      ) : symbolSearchResults.length ? (
                        <ul className="divide-y divide-[#e8eaed]">
                          {symbolSearchResults.map((row) => (
                            <li key={`${row.market || market}:${row.symbol}`}>
                              <button type="button" className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-[#f8fafd]" onClick={() => handlePickSymbolSearch(row)}>
                                <span className="min-w-0"><span className="block truncate text-xs font-semibold text-[#1f1f1f]">{formatSymbolDisplay(row.symbol)}</span><span className="block truncate text-[11px] text-[#5f6368]">{row.marketLabel ? `${row.marketLabel} · ` : ''}{row.name || row.exchange || '--'}</span></span>
                                <span className="shrink-0 rounded-full bg-[#e8f0fe] px-2 py-0.5 text-[11px] font-semibold text-[#1a73e8]">查看</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <div className="px-3 py-2 text-xs text-[#5f6368]">没有找到匹配标的</div>
                      )}
                    </div>
                  ) : null}
                  {sectors.length === 0 ? (
                    <p className="px-2 py-1 text-xs text-slate-400">{sectorsLoading ? '加载中…' : (market === 'cn' ? '可搜索并添加更多 A股 / ETF 标的' : '暂无数据')}</p>
                  ) : (
                    <ul>
                      {sectors.map((row) => (
                        <SidebarRow
                          key={row.symbol}
                          symbol={row.shortCode || row.symbol}
                          name={row.name}
                          price={row.price}
                          changePercent={row.changePercent}
                          sparkPoints={klineMap[row.symbol]}
                        />
                      ))}
                    </ul>
                  )}
                </div>
              )}
          </>
        </div>
      </aside>

      <main ref={mainRef} className="order-1 flex min-w-0 flex-col gap-5 lg:order-2 lg:h-full lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:pr-1 lg:[scrollbar-gutter:stable]">
        <div className={cx(
          "sticky top-0 z-20 items-center justify-between gap-3 bg-white/95 px-1 py-2 backdrop-blur transition-all duration-500 ease-out will-change-transform",
          selectedQuote ? "hidden" : "flex",
          !selectedQuote && detailHeaderHidden && "pointer-events-none -translate-y-full opacity-0"
        )}>
          <div className="flex items-center gap-3">
            {MARKETS.map((m) => (
              <button
                key={m.key}
                type="button"
                className={cx(
                  'rounded-full px-3 py-1 text-sm transition',
                  market === m.key
                    ? 'border border-slate-900 font-medium text-slate-900'
                    : 'text-slate-600 hover:text-slate-900'
                )}
                onClick={() => setMarket(m.key)}
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
              onClick={() => {
                refreshIndices(true);
                refreshNews();
                refreshEarnings(true);
                refreshWatch();
                refreshSummary(true);
              }}
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
            financials={financialsMap[selectedQuote.symbol]}
            financialsLoading={financialsLoading && !financialsMap[selectedQuote.symbol]}
            xueqiuFundData={xueqiuFundDataMap[selectedQuote.symbol]}
            xueqiuFundLoading={xueqiuFundLoading && !xueqiuFundDataMap[selectedQuote.symbol]}
            activeTab={symbolDetailTab}
            onTabChange={setSymbolDetailTab}
            chartRange={chartRange}
            onChartRangeChange={setChartRange}
            chartCandles={(() => {
              const cfg = CHART_RANGE_TABS.find((r) => r.key === chartRange);
              if (!cfg) return undefined;
              const cacheKey = `${selectedQuote.symbol}|${cfg.tf}`;
              const candles = chartCandlesMap[cacheKey];
              if (!Array.isArray(candles) || candles.length < 2) return undefined;
              return sliceCandlesForRange(candles, chartRange);
            })()}
            chartTf={(CHART_RANGE_TABS.find((r) => r.key === chartRange) || {}).tf}
            chartLoading={chartLoading}
            premiumState={premiumMap[selectedCnFundCode || selectedQuote.symbol]}
            navHistoryState={navHistoryMap[`${selectedCnFundCode || selectedQuote.symbol}|${navHistoryDaysForRange(chartRange)}`]}
            isMobile={isMobile}
            tradeMarkers={selectedTradeMarkers}
            buildOtcCandidate={buildOtcCandidate}
            inWatch={watchSymbols.includes(selectedQuote.symbol)}
            onToggleWatch={() => {
              if (watchSymbols.includes(selectedQuote.symbol)) {
                setWatch(removeFromWatchlist(market, selectedQuote.symbol, watch.activeListId));
              } else {
                setWatch(addToWatchlist(market, selectedQuote.symbol, watch.activeListId));
              }
            }}
            onAnalyze={() => {
              handleSelectSymbol(selectedQuote, { openResearch: true });
              setPendingAnalysis({ symbol: selectedQuote.symbol, name: selectedQuote.name });
            }}
            onBack={() => {
              setSelectedSymbol('');
              setSymbolDetailTab('overview');
            }}
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
                      onPick={(e) => handlePickMover(e)}
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
                  onRefresh={() => refreshSummary(true)}
                />
              </div>
            )}

            {/* 最新动态（去重卡片为分组小节） */}
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

      {/* Backdrop when conversation */}
      {researchMode === 'conversation' && (
        <div className="fixed inset-0 z-30 bg-white lg:hidden" onClick={() => setResearchMode('peek')} />
      )}
      {/* Research panel: PC = sticky aside / Mobile = bottom sheet */}
      <aside
        id="markets-research-anchor"
        ref={asideRef}
        className={cx(
          'bg-white',
          'lg:relative lg:z-auto lg:order-3 lg:flex lg:h-full lg:min-h-0 lg:flex-col lg:gap-3 lg:bg-transparent lg:overflow-hidden lg:rounded-none lg:border-t-0 lg:shadow-none',
          selectedSymbol ? 'hidden lg:flex' : 'fixed inset-x-0 bottom-0 z-40 flex flex-col overflow-hidden border-t border-[#e8eaed] shadow-[0_-4px_16px_rgba(0,0,0,0.06)] [transition:height_300ms_ease-out]',
          !selectedSymbol && (researchMode === 'conversation' ? 'top-0 rounded-none' : 'rounded-t-2xl')
        )}
        style={isMobile && !isDraggingRef.current ? {
          height: (
            researchMode === 'conversation'
              ? (vpHeight || (typeof window !== 'undefined' ? window.innerHeight : 844))
              : researchMode === 'search'
                ? (vpHeight || (typeof window !== 'undefined' ? window.innerHeight : 844))
                : 130
          ) + 'px'
        } : undefined}
      >
        {/* Drag handle */}
        <div
          role="button"
          tabIndex={0}
          aria-label={researchMode === 'peek' ? '展开研究' : '收起研究'}
          className="flex h-9 w-full shrink-0 cursor-pointer touch-none select-none items-center justify-center bg-white lg:hidden"
          onClick={() => {
            if (researchDragRef.current.moved) { researchDragRef.current.moved = false; return; }
            setResearchMode((m) => m === 'peek' ? 'conversation' : 'peek');
          }}
          onPointerDown={(e) => {
            const a = asideRef.current;
            const startH = a ? a.offsetHeight : (researchMode === 'peek' ? 130 : 600);
            researchDragRef.current = { startY: e.clientY, lastY: e.clientY, startH, startT: Date.now(), dragging: true, moved: false };
            try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_error) { /* best-effort */ }
            isDraggingRef.current = true;
            if (a) {
              a.style.transition = 'none';
              a.style.height = startH + 'px';
            }
            // 从 peek 拖动开始时立即切到 conversation，让用户马上看到当前面板内容随高度出现
            if (researchMode === 'peek') setResearchMode('conversation');
          }}
          onPointerMove={(e) => {
            const r = researchDragRef.current;
            if (!r.dragging) return;
            const dy = e.clientY - r.startY;
            r.lastY = e.clientY;
            if (Math.abs(dy) > 6) r.moved = true;
            // 跟手改 height：上拉(dy<0)长高，下滑(dy>0)变矮；边界外做阻尼
            const vh = (vpHeight || (typeof window !== 'undefined' ? window.innerHeight : 844));
            const peekH = 130;
            const fullH = vh;
            let newH = r.startH - dy;
            if (newH > fullH) newH = fullH + Math.min((newH - fullH) * 0.3, 36);
            if (newH < peekH) newH = peekH - Math.min((peekH - newH) * 0.3, 36);
            const a = asideRef.current;
            if (a) a.style.height = newH + 'px';
          }}
          onPointerUp={(e) => {
            const r = researchDragRef.current;
            if (!r.dragging) return;
            r.dragging = false;
            const dy = e.clientY - r.startY;
            const dt = Math.max(Date.now() - r.startT, 1);
            const v = dy / dt; // px/ms
            let next = researchMode;
            if (researchMode === 'peek' && (dy < -60 || v < -0.4)) next = 'conversation';
            else if (researchMode === 'conversation' && (dy > 60 || v > 0.4)) next = 'peek';
            const a = asideRef.current;
            if (a) {
              a.style.transition = '';
              // 显式写一次目标 height 触发 className 上的 height transition；React render 后会写相同值，不打断动画
              const vh = (vpHeight || (typeof window !== 'undefined' ? window.innerHeight : 844));
              const target = next === 'conversation' ? vh : next === 'search' ? vh : 130;
              a.style.height = target + 'px';
            }
            isDraggingRef.current = false;
            if (next !== researchMode) setResearchMode(next);
            else if (researchMode === 'conversation' && next === 'conversation') {
              // pointerDown 时已 setResearchMode('conversation')，松手没切回，强制一次 re-render 让 React style 接管
              setResearchMode((m) => m);
            }
          }}
          onPointerCancel={() => {
            researchDragRef.current.dragging = false;
            const a = asideRef.current;
            if (a) {
              a.style.transition = '';
              const vh = (vpHeight || (typeof window !== 'undefined' ? window.innerHeight : 844));
              const target = researchMode === 'conversation' ? vh : researchMode === 'search' ? vh : 130;
              a.style.height = target + 'px';
            }
            isDraggingRef.current = false;
          }}
          onTouchMove={(e) => { e.preventDefault(); }}
        >
          <span className="h-1 w-9 rounded-full bg-[#dadce0]" />
        </div>
        <MarketsResearchPanel
          market={market}
          mode={researchMode}
          onModeChange={setResearchMode}
          watchSymbols={watchSymbols}
          watchQuotes={watchQuotes}
          selectedSymbol={selectedSymbol}
          selectedQuote={selectedQuote}
          pendingAnalysis={pendingAnalysis}
          onAnalysisConsumed={() => setPendingAnalysis(null)}
        />
      </aside>
    </div>
    </>
  );
}
