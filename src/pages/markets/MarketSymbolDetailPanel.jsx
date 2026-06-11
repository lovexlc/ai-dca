import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Loader2, Search, Sparkles, Star, X } from 'lucide-react';
import { fetchKline, fetchQuotes, searchSymbols, CN_ETF_WATCHLIST_PRESETS } from '../../app/marketsApi.js';
import { getNavHistory, getNavSnapshot } from '../../app/navService.js';
import { getXueqiuQuote } from '../../app/xueqiuQuote.js';
import { Sparkline } from '../../components/markets/Sparkline.jsx';
import { cx } from '../../components/experience-ui.jsx';
import {
  CHART_TYPE_LABEL,
  CHART_TYPE_OPTIONS,
  CN_FUND_PARAM_LABEL,
  CN_FUND_PARAM_OPTIONS,
  COMPARE_COLORS,
  COMPARE_MAIN_COLOR,
  ChartToolbarPopover,
  INDICATOR_OPTIONS,
  SymbolDetailChart,
  TOOLBAR_ICONS,
} from './MarketChartPanel.jsx';
import { CnFundFlowPanel, CnFundReportPanel, FinancialsPanel, detailValueRow, formatCnAmount, formatCnMoney, formatXueqiuDateMs } from './MarketFinancialPanels.jsx';
import { EarningsCalendar, NewsList, formatClock } from './MarketNewsPanels.jsx';
import {
  CHART_RANGE_TABS,
  buildCnFundParamCandles,
  buildNavSnapshotItems,
  deriveCandlestickExtrema,
  isCnOtcFundQuote,
  navHistoryDaysForRange,
  sliceCandlesForRange,
} from './marketFundMetrics.js';
import { formatMarketPrice, formatNumber, formatPercent, formatSignedPercent, formatSymbolDisplay, normalizeCnFundCode } from './marketDisplayUtils.js';

const SYMBOL_DETAIL_TABS = [
  { key: 'overview', label: '概览' },
  { key: 'fundFlow', label: '资金' },
  { key: 'fundReport', label: '年报' },
  { key: 'earnings', label: '财报' },
  { key: 'financials', label: '财务' },
];

function marketStateLabel(state, marketCode) {
  const v = String(state || '').toUpperCase();
  if (v === 'REGULAR') return '交易中';
  if (v === 'PRE') return '盘前';
  if (v === 'POST' || v === 'POSTPOST') return '盘后';
  if (v === 'CLOSED') return '已收盘';
  if (v === 'PREPRE') return '盘前候开';
  return marketCode === 'cn' ? '已收盘' : '已收盘';
}

export function SymbolDetailPanel({
  row,
  market,
  sparkPoints,
  news = [],
  earnings = [],
  financials = null,
  financialsLoading = false,
  xueqiuFundData = null,
  xueqiuFundLoading = false,
  activeTab,
  onTabChange,
  onAnalyze,
  onBack,
  chartRange,
  onChartRangeChange,
  chartCandles,
  dailyCandles,
  chartTf,
  chartLoading,
  inWatch,
  onToggleWatch,
  premiumState,
  navHistoryState,
  isMobile = false,
  tradeMarkers = [],
  buildOtcCandidate = () => null,
}) {
  const [chartType, setChartType] = useState('area');
  const [cnFundParam, setCnFundParam] = useState('price');
  const [premiumView, setPremiumView] = useState('trend');
  const [indicators, setIndicators] = useState(() => new Set());
  const [compareSymbols, setCompareSymbols] = useState([]);
  const [compareInput, setCompareInput] = useState('');
  const [compareSearchResults, setCompareSearchResults] = useState([]);
  const [compareSearchLoading, setCompareSearchLoading] = useState(false);
  const [compareSearchError, setCompareSearchError] = useState('');
  const compareSearchSeqRef = useRef(0);
  const [compareCandlesMap, setCompareCandlesMap] = useState({});
  const [compareLoadingMap, setCompareLoadingMap] = useState({});
  const [compareErrorMap, setCompareErrorMap] = useState({});
  const [compareNavHistoryMap, setCompareNavHistoryMap] = useState({});
  const compareNavInflightRef = useRef(new Set());
  const [compareQuoteMap, setCompareQuoteMap] = useState({});
  const [hoveredChartRow, setHoveredChartRow] = useState(null);
  const [lockedChartRow, setLockedChartRow] = useState(null);
  const indicatorOptions = INDICATOR_OPTIONS;
  const rowSymbol = row && row.symbol ? String(row.symbol).toUpperCase() : '';
  const currentIsCnOtcFund = market === 'cn' && isCnOtcFundQuote(row);
  const compareSearchMetaMap = useMemo(() => {
    const next = {};
    (Array.isArray(compareSearchResults) ? compareSearchResults : []).forEach((item) => {
      const symbol = String(item?.symbol || item?.code || item?.ticker || '').trim().toUpperCase();
      const code = normalizeCnFundCode(symbol);
      if (symbol) next[symbol] = item;
      if (code) next[code] = item;
    });
    return next;
  }, [compareSearchResults]);
  const isCompareCnOtcFund = useCallback((symbol) => {
    if (market !== 'cn') return false;
    const upper = String(symbol || '').trim().toUpperCase();
    const code = normalizeCnFundCode(upper);
    if (!/^\d{6}$/.test(code)) return false;
    const quote = compareQuoteMap[upper] || compareQuoteMap[code] || null;
    const searchMeta = compareSearchMetaMap[upper] || compareSearchMetaMap[code] || null;
    return currentIsCnOtcFund || isCnOtcFundQuote(quote) || isCnOtcFundQuote(searchMeta);
  }, [compareQuoteMap, compareSearchMetaMap, currentIsCnOtcFund, market]);
  // 当前 symbol 或时间范围切换时清空对比
  useEffect(() => { setCompareSymbols([]); setHoveredChartRow(null); setLockedChartRow(null); }, [rowSymbol]);
  useEffect(() => { setHoveredChartRow(null); setLockedChartRow(null); }, [chartRange, cnFundParam]);
  useEffect(() => { if (market !== 'cn') setCnFundParam('price'); }, [market]);
  useEffect(() => {
    if (cnFundParam !== 'premium') setPremiumView('trend');
  }, [cnFundParam]);
  useEffect(() => {
    if (!CHART_TYPE_OPTIONS.some((opt) => opt.key === chartType)) setChartType('area');
  }, [chartType]);
  useEffect(() => {
    const q = compareInput.trim();
    const seq = ++compareSearchSeqRef.current;
    if (q.length < 1 || compareSymbols.length >= 3) {
      setCompareSearchResults([]);
      setCompareSearchLoading(false);
      setCompareSearchError('');
      return undefined;
    }
    const controller = new AbortController();
    setCompareSearchLoading(true);
    setCompareSearchError('');
    const timer = window.setTimeout(() => {
      searchSymbols(market, q, { limit: 10, signal: controller.signal })
        .then((res) => {
          if (seq !== compareSearchSeqRef.current) return;
          const rows = Array.isArray(res && res.results) ? [...res.results] : [];
          const otcCode = normalizeCnFundCode(q);
          if (market === 'cn' && /^\d{6}$/.test(otcCode) && !rows.some((item) => normalizeCnFundCode(item.symbol || item.code || item.ticker) === otcCode)) {
            rows.push(buildOtcCandidate(otcCode));
          }
          const current = String(rowSymbol || '').toUpperCase();
          const seen = new Set();
          setCompareSearchResults(rows.map((item) => {
            const symbol = String(item.symbol || item.code || item.ticker || '').trim().toUpperCase();
            return {
              ...item,
              symbol,
              name: item.name || item.shortName || item.displayName || symbol,
              market: item.market || market
            };
          }).filter((item) => {
            if (!item.symbol || item.symbol === current || seen.has(item.symbol)) return false;
            seen.add(item.symbol);
            return true;
          }));
        })
        .catch(() => {
          if (controller.signal.aborted || seq !== compareSearchSeqRef.current) return;
          setCompareSearchResults([]);
          setCompareSearchError('搜索失败，稍后再试');
        })
        .finally(() => {
          if (seq === compareSearchSeqRef.current) setCompareSearchLoading(false);
        });
    }, 220);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [compareInput, compareSymbols.length, market, rowSymbol]);
  useEffect(() => {
    if (!chartTf || !compareSymbols.length) return;
    compareSymbols.forEach((sym) => {
      if (market === 'cn' && isCompareCnOtcFund(sym)) return;
      const key = `${sym}|${chartTf}`;
      if (compareCandlesMap[key] || compareLoadingMap[key] || compareErrorMap[key]) return;
      setCompareLoadingMap((prev) => ({ ...prev, [key]: true }));
      setCompareErrorMap((prev) => ({ ...prev, [key]: false }));
      fetchKline(sym, { timeframe: chartTf }).then((res) => {
        if (Array.isArray(res && res.candles) && res.candles.length >= 2) {
          setCompareCandlesMap((prev) => ({ ...prev, [key]: res.candles }));
        } else {
          setCompareErrorMap((prev) => ({ ...prev, [key]: true }));
        }
      }).catch(() => {
        setCompareErrorMap((prev) => ({ ...prev, [key]: true }));
      }).finally(() => {
        setCompareLoadingMap((prev) => ({ ...prev, [key]: false }));
      });
    });
  }, [compareSymbols, chartTf, compareCandlesMap, compareLoadingMap, compareErrorMap, isCompareCnOtcFund, market]);
  useEffect(() => {
    if (market !== 'cn' || !compareSymbols.length) return;
    if (cnFundParam === 'price' && !compareSymbols.some((sym) => /^\d{6}$/.test(normalizeCnFundCode(sym)))) return;
    const days = navHistoryDaysForRange(chartRange);
    compareSymbols.forEach((sym) => {
      const code = normalizeCnFundCode(sym);
      if (!/^\d{6}$/.test(code)) return;
      const key = `${code}|${days}`;
      if (compareNavHistoryMap[key]?.items?.length || compareNavHistoryMap[key]?.loading || compareNavHistoryMap[key]?.error || compareNavInflightRef.current.has(key)) return;
      compareNavInflightRef.current.add(key);
      setCompareNavHistoryMap((prev) => ({ ...prev, [key]: { loading: true, items: prev[key]?.items || [], error: '' } }));
      getNavHistory(code, { days })
        .then(async (payload) => {
          let items = Array.isArray(payload?.items) ? payload.items : [];
          if (items.length < 2) {
            try {
              const snapshot = await getNavSnapshot(code);
              const snapshotItems = buildNavSnapshotItems(snapshot);
              if (snapshotItems.length > items.length) items = snapshotItems;
            } catch (_error) {
              // 快照兜底失败时继续使用 nav-history 的结果。
            }
          }
          setCompareNavHistoryMap((prev) => ({ ...prev, [key]: { loading: false, items, error: items.length ? '' : '暂无净值历史数据' } }));
        })
        .catch(async (error) => {
          try {
            const snapshot = await getNavSnapshot(code);
            const items = buildNavSnapshotItems(snapshot);
            setCompareNavHistoryMap((prev) => ({ ...prev, [key]: { loading: false, items, error: items.length ? '' : (error instanceof Error ? error.message : '净值历史加载失败') } }));
          } catch (_fallbackError) {
            setCompareNavHistoryMap((prev) => ({ ...prev, [key]: { loading: false, items: prev[key]?.items || [], error: error instanceof Error ? error.message : '净值历史加载失败' } }));
          }
        })
        .finally(() => {
          compareNavInflightRef.current.delete(key);
        });
    });
  }, [market, cnFundParam, compareSymbols, chartRange, compareNavHistoryMap, isCompareCnOtcFund]);

  const compareCandidates = (() => {
    const base = market === 'cn'
      ? [
        ...CN_ETF_WATCHLIST_PRESETS.map((item) => ({ symbol: item.symbol, name: item.name })),
        { symbol: 'QQQ', name: '纳指 100 ETF' }
      ]
      : [
        { symbol: 'QQQ', name: '纳指 100 ETF' },
        { symbol: 'SPY', name: '标普 500 ETF' },
        { symbol: 'TSLA', name: 'Tesla Inc' },
        { symbol: 'MSFT', name: 'Microsoft Corp' },
        { symbol: 'TQQQ', name: 'ProShares UltraPro QQQ' },
        { symbol: 'VOO', name: '标普 500 ETF' }
      ];
    const current = String(row && row.symbol || '').toUpperCase();
    const seen = new Set();
    return base
      .map((item) => ({ ...item, symbol: String(item.symbol || '').trim().toUpperCase() }))
      .filter((item) => {
        if (!item.symbol || item.symbol === current || seen.has(item.symbol)) return false;
        seen.add(item.symbol);
        return true;
      });
  })();
  const compareSearchCandidates = compareSearchResults
    .map((item) => ({
      ...item,
      symbol: String(item.symbol || '').trim().toUpperCase(),
      name: item.name || item.shortName || item.displayName || item.symbol
    }))
    .filter((item) => item.symbol);
  const compareSearchCandidateKey = compareSearchCandidates.map((item) => item.symbol).join('|');
  const compareSymbolKey = compareSymbols.join('|');
  useEffect(() => {
    if (!rowSymbol) return;
    const symbols = Array.from(new Set([
      ...compareSearchCandidates.map((item) => item.symbol),
      ...compareSymbols
    ].map((sym) => String(sym || '').toUpperCase()).filter(Boolean)));
    const missing = symbols.filter((sym) => sym !== rowSymbol && !compareQuoteMap[sym]);
    if (!missing.length) return;
    let cancelled = false;
    fetchQuotes(missing)
      .then((payload) => {
        if (cancelled) return;
        const quotes = payload?.quotes && typeof payload.quotes === 'object' ? payload.quotes : {};
        setCompareQuoteMap((prev) => {
          const next = { ...prev };
          let changed = false;
          missing.forEach((sym) => {
            const quote = quotes[sym] || quotes[sym.toUpperCase()] || null;
            if (quote) {
              next[sym] = quote;
              changed = true;
            }
          });
          return changed ? next : prev;
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [compareSearchCandidateKey, compareSymbolKey, compareQuoteMap, rowSymbol]);
  const handleChartHover = useCallback((payload) => {
    setHoveredChartRow((prev) => (prev && payload && prev.t === payload.t ? prev : payload));
  }, []);
  const handleChartLeave = useCallback(() => {
    setHoveredChartRow(null);
  }, []);
  const handleChartLock = useCallback((payload) => {
    if (!payload) return;
    setLockedChartRow((prev) => (prev && prev.t === payload.t ? null : payload));
  }, []);
  const clearLockedChartRow = useCallback(() => {
    setLockedChartRow(null);
  }, []);

  if (!row || !row.symbol) return null;
  const displaySymbol = formatSymbolDisplay(row.symbol);
  const pct = Number(row.changePercent);
  const change = Number(row.change);
  const positive = Number.isFinite(pct) && pct > 0;
  const negative = Number.isFinite(pct) && pct < 0;
  const tone = positive ? 'up' : negative ? 'down' : 'flat';
  const symbolKey = String(row.symbol || '').toLowerCase();
  const nameKey = String(row.name || '').toLowerCase();
  const relatedNews = (news || []).filter((it) => {
    const text = `${it.title || ''} ${it.source || ''}`.toLowerCase();
    return text.includes(symbolKey) || (nameKey && nameKey !== symbolKey && text.includes(nameKey));
  });
  const relatedEarnings = (earnings || []).filter((it) => String(it.symbol || '').toUpperCase() === String(row.symbol || '').toUpperCase());
  const exchangeLabel = row.exchange || (market === 'us' ? 'NASDAQ/NYSE' : 'A 股');
  const currencyLabel = row.currency || (market === 'us' ? 'USD' : 'CNY');
  const stateLabel = marketStateLabel(row.marketState, market);
  const isCnOtcFund = currentIsCnOtcFund;
  const xueqiuQuote = getXueqiuQuote(xueqiuFundData);
  const yearExtrema = market === 'cn' && !isCnOtcFund
    ? deriveCandlestickExtrema(dailyCandles, { daysBack: 365 })
    : null;
  const yearHigh = yearExtrema?.count ? yearExtrema.high : null;
  const yearLow = yearExtrema?.count ? yearExtrema.low : null;
  const cnOverviewExtras = market === 'cn' && !isCnOtcFund ? [
    detailValueRow('开盘价', formatNumber(row.open ?? xueqiuQuote?.open, 3)),
    detailValueRow('市值', formatCnMoney(row.marketCapital ?? row.marketCap ?? xueqiuQuote?.market_capital)),
    detailValueRow('最高价', formatNumber(yearHigh ?? row.high ?? xueqiuQuote?.high, 3)),
    detailValueRow('平均成交量', formatCnAmount(xueqiuQuote?.avg_volume ?? xueqiuQuote?.avg_volume10 ?? xueqiuQuote?.avg_volume_10)),
    detailValueRow('最低价', formatNumber(yearLow ?? row.low ?? xueqiuQuote?.low, 3)),
    detailValueRow('成交量', formatCnAmount(row.volume ?? xueqiuQuote?.volume)),
    detailValueRow('Beta 版', formatNumber(xueqiuQuote?.beta, 2)),
    detailValueRow('成交额', formatCnMoney(row.turnover ?? xueqiuQuote?.amount)),
    detailValueRow('iOPV', formatNumber(xueqiuQuote?.iopv, 4)),
    detailValueRow('单位净值', formatNumber(xueqiuQuote?.unit_nav, 4)),
    detailValueRow('累计净值', formatNumber(xueqiuQuote?.acc_unit_nav, 4)),
    detailValueRow('净值日期', formatXueqiuDateMs(xueqiuQuote?.nav_date)),
    detailValueRow('溢价率', Number.isFinite(Number(xueqiuQuote?.premium_rate)) ? formatSignedPercent(xueqiuQuote?.premium_rate) : '--'),
    detailValueRow('年内涨幅', Number.isFinite(Number(xueqiuQuote?.current_year_percent)) ? formatSignedPercent(xueqiuQuote?.current_year_percent) : '--'),
    detailValueRow('总份额', formatCnAmount(xueqiuQuote?.total_shares)),
    detailValueRow('量比', formatNumber(xueqiuQuote?.volume_ratio, 2)),
    detailValueRow('成立日期', formatXueqiuDateMs(xueqiuQuote?.found_date)),
    detailValueRow('上市日期', formatXueqiuDateMs(xueqiuQuote?.issue_date)),
  ].filter((item) => item.value !== '--' && item.value !== '-').slice(0, 18) : [];
  const overviewRows = [
    detailValueRow(isCnOtcFund ? '最新净值' : '最新价', isCnOtcFund ? formatNumber(row.price) : formatMarketPrice(row.price, row)),
    detailValueRow(isCnOtcFund ? '净值涨跌幅' : '今日涨跌幅', formatPercent(row.changePercent), positive ? 'text-[#a50e0e]' : negative ? 'text-[#137333]' : 'text-[#1f1f1f]'),
    detailValueRow('涨跌额', Number.isFinite(change) ? `${change > 0 ? '+' : ''}${formatNumber(change)}` : '--'),
    detailValueRow('昨收', formatNumber(row.previousClose)),
    detailValueRow('市场', market === 'us' ? '美股' : 'A 股'),
    detailValueRow('交易状态', stateLabel),
    ...cnOverviewExtras,
  ];
  const toggleIndicator = (k) => setIndicators((prev) => {
    const next = new Set(prev);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });
  const backgroundStyle = (background) => ({ background });
  const normalizeCompareQuote = (symbol, fallback = {}) => {
    const upper = String(symbol || '').toUpperCase();
    const quote = compareQuoteMap[upper] || (upper === String(row?.symbol || '').toUpperCase() ? row : null) || fallback || {};
    const price = Number(quote.price);
    const pctValue = Number(quote.changePercent);
    const prevClose = Number(quote.previousClose);
    const changeValue = Number.isFinite(Number(quote.change))
      ? Number(quote.change)
      : (Number.isFinite(price) && Number.isFinite(prevClose)
        ? price - prevClose
        : (Number.isFinite(price) && Number.isFinite(pctValue) && pctValue !== -100 ? price - (price / (1 + pctValue / 100)) : NaN));
    const previousClose = Number.isFinite(prevClose)
      ? prevClose
      : (Number.isFinite(price) && Number.isFinite(changeValue) ? price - changeValue : NaN);
    return {
      symbol: upper,
      name: quote.name || fallback.name || upper,
      price,
      change: changeValue,
      changePercent: pctValue,
      previousClose
    };
  };
  const visibleCompareCandidates = (() => {
    const q = compareInput.trim().toUpperCase();
    const source = q
      ? [
        ...compareSearchCandidates,
        ...compareCandidates.filter((item) => item.symbol.includes(q) || String(item.name || '').toUpperCase().includes(q))
      ]
      : compareCandidates;
    const seen = new Set();
    return source.filter((item) => {
      const symbol = String(item.symbol || '').toUpperCase();
      if (!symbol || seen.has(symbol)) return false;
      seen.add(symbol);
      return true;
    });
  })();
  const addCompareSymbol = (raw) => {
    const candidate = raw && typeof raw === 'object' ? raw : null;
    const v = String(candidate?.symbol || raw || '').trim().toUpperCase();
    if (!v) return;
    if (compareSymbols.includes(v) || v === String(row && row.symbol || '').toUpperCase()) {
      setCompareInput('');
      return;
    }
    if (compareSymbols.length >= 3) return;
    const meta = candidate || compareSearchMetaMap[v] || compareSearchMetaMap[normalizeCnFundCode(v)] || null;
    if (meta) {
      setCompareQuoteMap((prev) => (prev[v] ? prev : { ...prev, [v]: meta }));
    }
    setCompareSymbols((prev) => [...prev, v]);
    setCompareInput('');
  };
  const addCompare = () => {
    const v = String(compareInput || '').trim().toUpperCase();
    const code = normalizeCnFundCode(v);
    const matched = visibleCompareCandidates.find((item) => item.symbol === v || normalizeCnFundCode(item.symbol) === code);
    addCompareSymbol(matched || v);
  };
  const removeCompare = (sym) => {
    setCompareSymbols((prev) => prev.filter((x) => x !== sym));
    setHoveredChartRow(null);
    setLockedChartRow(null);
  };
  const compareSeries = compareSymbols.map((sym) => {
    const rawCandles = compareCandlesMap[`${sym}|${chartTf}`];
    const priceCandles = Array.isArray(rawCandles) ? sliceCandlesForRange(rawCandles, chartRange) : rawCandles;
    const compareCode = normalizeCnFundCode(sym);
    const compareNavKey = `${compareCode}|${navHistoryDaysForRange(chartRange)}`;
    const compareNavState = compareNavHistoryMap[compareNavKey];
    const compareNavItems = compareNavState?.items;
    const useNavAsPrice = market === 'cn'
      && cnFundParam === 'price'
      && (isCompareCnOtcFund(sym) || (Array.isArray(compareNavItems) && compareNavItems.length >= 2))
      && (!Array.isArray(priceCandles) || priceCandles.length < 2);
    const candles = market === 'cn' && cnFundParam !== 'price'
      ? buildCnFundParamCandles(priceCandles, compareNavItems, cnFundParam, premiumState, chartRange)
      : (useNavAsPrice ? buildCnFundParamCandles([], compareNavItems, 'nav', premiumState, chartRange) : priceCandles);
    return {
      symbol: sym,
      candles,
      navLoading: Boolean(compareNavState?.loading),
      navError: compareNavState?.error || ''
    };
  });
  const comparePendingSymbols = compareSymbols.filter((sym) => {
    if (compareLoadingMap[`${sym}|${chartTf}`]) return true;
    if (market !== 'cn') return false;
    const code = normalizeCnFundCode(sym);
    if (cnFundParam === 'price' && !/^\d{6}$/.test(code)) return false;
    return Boolean(compareNavHistoryMap[`${code}|${navHistoryDaysForRange(chartRange)}`]?.loading);
  });
  const compareReadyCount = compareSeries.filter((s) => Array.isArray(s.candles) && s.candles.length >= 2).length;
  const activeCursorRow = lockedChartRow || hoveredChartRow;
  const activeCursorTime = activeCursorRow?.t ?? null;
  const activeCursorLabel = activeCursorTime ? activeCursorRow?.label : '';
  const applyHoverSnapshot = (quoteRow, keyPrefix) => {
    if (!activeCursorRow) return quoteRow;
    const priceKey = keyPrefix === 'main' ? 'mainPrice' : `${keyPrefix}price`;
    const baseKey = keyPrefix === 'main' ? 'mainBase' : `${keyPrefix}base`;
    const changeKey = keyPrefix === 'main' ? 'mainChange' : `${keyPrefix}change`;
    const pctKey = keyPrefix === 'main' ? 'mainChangePercent' : `${keyPrefix}changePercent`;
    const price = Number(activeCursorRow[priceKey]);
    const change = Number(activeCursorRow[changeKey]);
    const changePercent = Number(activeCursorRow[pctKey]);
    const previousClose = Number(activeCursorRow[baseKey]);
    if (!Number.isFinite(price)) return quoteRow;
    return {
      ...quoteRow,
      price,
      change: Number.isFinite(change) ? change : quoteRow.change,
      changePercent: Number.isFinite(changePercent) ? changePercent : quoteRow.changePercent,
      previousClose: Number.isFinite(previousClose) ? previousClose : quoteRow.previousClose,
      snapshotLabel: activeCursorRow.label
    };
  };
  const compareTableRows = [
    applyHoverSnapshot(normalizeCompareQuote(row.symbol, row), 'main'),
    ...compareSymbols.map((sym, index) => applyHoverSnapshot(normalizeCompareQuote(sym, compareCandidates.find((item) => item.symbol === sym)), `cmp_${index}_`))
  ];
  const effectiveChartCandles = isCnOtcFund
    ? (cnFundParam === 'premium' ? [] : buildCnFundParamCandles([], navHistoryState?.items, 'nav', premiumState, chartRange))
    : (market !== 'cn' || cnFundParam === 'price'
      ? chartCandles
      : buildCnFundParamCandles(chartCandles, navHistoryState?.items, cnFundParam, premiumState, chartRange));
  const effectiveChartType = chartType;
  const premiumCompareMode = market === 'cn' && cnFundParam === 'premium';
  const premiumUnavailable = isCnOtcFund && cnFundParam === 'premium';
  const buildPremiumTableRow = (quoteRow, keyPrefix, metricCandles) => {
    if (!premiumCompareMode) return quoteRow;
    const lastMetric = Array.isArray(metricCandles) && metricCandles.length ? metricCandles[metricCandles.length - 1] : null;
    const premiumKey = keyPrefix === 'main' ? 'mainPrice' : `${keyPrefix}price`;
    const navKey = keyPrefix === 'main' ? 'mainNav' : `${keyPrefix}nav`;
    const iopvKey = keyPrefix === 'main' ? 'mainIopv' : `${keyPrefix}iopv`;
    const premiumValue = activeCursorRow && Number.isFinite(Number(activeCursorRow[premiumKey]))
      ? Number(activeCursorRow[premiumKey])
      : Number(lastMetric?.c);
    const navValue = activeCursorRow && Number.isFinite(Number(activeCursorRow[navKey]))
      ? Number(activeCursorRow[navKey])
      : Number(lastMetric?.nav);
    const iopvValue = activeCursorRow && Number.isFinite(Number(activeCursorRow[iopvKey]))
      ? Number(activeCursorRow[iopvKey])
      : Number(lastMetric?.iopv);
    const marketPrice = Number.isFinite(iopvValue) && Number.isFinite(premiumValue)
      ? iopvValue * (1 + premiumValue / 100)
      : Number(quoteRow.price);
    return {
      ...quoteRow,
      price: premiumValue,
      change: navValue,
      changePercent: iopvValue,
      previousClose: marketPrice,
      snapshotLabel: activeCursorRow?.label || quoteRow.snapshotLabel
    };
  };
  const premiumTableRows = premiumCompareMode
    ? [
      buildPremiumTableRow(normalizeCompareQuote(row.symbol, row), 'main', effectiveChartCandles),
      ...compareSymbols.map((sym, index) => buildPremiumTableRow(
        normalizeCompareQuote(sym, compareCandidates.find((item) => item.symbol === sym)),
        `cmp_${index}_`,
        compareSeries[index]?.candles
      ))
    ]
    : [];
  const premiumBaseValue = Number(premiumTableRows[0]?.price);
  const premiumRowsWithSpread = premiumTableRows.map((item) => {
    const premiumValue = Number(item.price);
    return {
      ...item,
      premiumPercent: premiumValue,
      navValue: item.change,
      iopvValue: item.changePercent,
      marketPrice: item.previousClose,
      premiumSpread: Number.isFinite(premiumValue) && Number.isFinite(premiumBaseValue) ? premiumValue - premiumBaseValue : null
    };
  });
  const premiumSpreadStats = premiumCompareMode && compareSymbols.length > 1
    ? (() => {
      const values = premiumRowsWithSpread
        .map((item) => ({ item, value: Number(item.premiumPercent) }))
        .filter((entry) => Number.isFinite(entry.value));
      if (values.length < 2) return null;
      const min = values.reduce((best, entry) => entry.value < best.value ? entry : best, values[0]);
      const max = values.reduce((best, entry) => entry.value > best.value ? entry : best, values[0]);
      return {
        spread: max.value - min.value,
        maxSymbol: formatSymbolDisplay(max.item.symbol),
        minSymbol: formatSymbolDisplay(min.item.symbol)
      };
    })()
    : null;
  const displayCompareTableRows = premiumCompareMode
    ? premiumRowsWithSpread
    : compareTableRows;
  const metricLoading = market === 'cn' && (cnFundParam !== 'price' || isCnOtcFund) && navHistoryState?.loading;
  const metricError = market === 'cn' && (cnFundParam !== 'price' || isCnOtcFund) ? navHistoryState?.error : '';
  const hasFullCandles = Array.isArray(effectiveChartCandles) && effectiveChartCandles.length >= 2;
  const sparkFallback = cnFundParam === 'price' && (!hasFullCandles && Array.isArray(sparkPoints) && sparkPoints.length >= 2) ? sparkPoints : null;

  return (
    <section className="mx-0">
      <div className="px-3 pt-0 sm:px-1">
        <button
          type="button"
          onClick={onBack}
          className="mb-0.5 inline-flex items-center gap-1 text-[11px] font-medium text-[#5f6368] hover:text-[#1f1f1f] sm:mb-1 sm:text-[12px]"
        >
          <ArrowUp size={13} className="-rotate-90" />
          首页
        </button>
        {/* Header：极简金融工作台头部 */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[15px] font-medium leading-tight text-[#1f1f1f] sm:text-[17px]">{row.name || displaySymbol}</h2>
            <div className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 sm:gap-x-2">
              <span className="text-[28px] font-medium leading-none tabular-nums text-[#1f1f1f] sm:text-[32px]">{isCnOtcFund ? formatNumber(row.price) : formatMarketPrice(row.price, row)}</span>
              <span className={cx('text-[12px] font-medium tabular-nums sm:text-[13px]', positive ? 'text-[#a50e0e]' : negative ? 'text-[#137333]' : 'text-[#5f6368]')}>
                {Number.isFinite(change) ? `${change > 0 ? '+' : ''}${formatNumber(change)}` : '--'}
                <span className="mx-1 text-[#5f6368]">·</span>
                {formatPercent(row.changePercent)}
              </span>
              <span className="text-[11px] text-[#5f6368]">{isCnOtcFund ? '净值' : '今日'}</span>
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] text-[#5f6368] sm:text-[11px]">
              <span>{stateLabel}</span>
              {row.lastUpdated ? <><span>·</span><span>更新于 {formatClock(row.lastUpdated)}</span></> : null}
              {Number.isFinite(Number(row.previousClose)) ? <><span>·</span><span>{isCnOtcFund ? '前一净值' : '昨收'} <span className="tabular-nums">{formatNumber(row.previousClose)}</span></span></> : null}
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={onToggleWatch}
              className={cx(
                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium transition sm:px-2.5 sm:py-1 sm:text-[13px]',
                inWatch
                  ? 'border border-[#dadce0] bg-white text-[#1f1f1f] hover:bg-[#f1f3f4]'
                  : 'bg-[#1f1f1f] text-white hover:bg-[#3c3c3c]'
              )}
            >
              <Star size={14} className={inWatch ? 'fill-amber-400 text-amber-400' : ''} />
              {inWatch ? '已添加' : '添加自选'}
            </button>
            <button
              type="button"
              onClick={onAnalyze}
              className="inline-flex items-center gap-1 rounded-full bg-[#e8f0fe] px-2 py-0.5 text-[12px] font-medium text-[#1a73e8] transition hover:bg-[#d2e3fc] sm:px-2.5 sm:py-1 sm:text-[13px]"
            >
              <Sparkles size={14} />
              研究
            </button>
          </div>
        </div>

        {/* 图表工具栏 */}
        <div className="mt-1.5 flex min-h-0 flex-wrap items-center gap-1 rounded-[13px] bg-[#f1f3f4] px-1.5 py-1 sm:mt-2 sm:gap-1.5 sm:rounded-[15px] sm:px-2 sm:py-1.5">
          <ChartToolbarPopover
            icon={CHART_TYPE_OPTIONS.find((opt) => opt.key === chartType)?.icon || TOOLBAR_ICONS.area}
            label={CHART_TYPE_LABEL[chartType] || '图形'}
            active={chartType !== 'area'}
          >
            {({ close }) => (
              <div className="flex flex-col gap-0.5">
                {CHART_TYPE_OPTIONS.map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => { setChartType(opt.key); close(); }}
                    className={cx(
                      'flex items-start gap-2 rounded-lg px-2 py-1.5 text-left transition',
                      chartType === opt.key ? 'bg-[#e8f0fe]' : 'hover:bg-[#f1f3f4]'
                    )}
                  >
                    <span className={cx('text-[13px] font-medium', chartType === opt.key ? 'text-[#1a73e8]' : 'text-[#1f1f1f]')}>{opt.label}</span>
                    <span className="ml-auto text-[11px] text-[#9aa0a6]">{opt.hint}</span>
                  </button>
                ))}
              </div>
            )}
          </ChartToolbarPopover>
          {market === 'cn' ? (
            <ChartToolbarPopover
              icon={TOOLBAR_ICONS.params}
              label={CN_FUND_PARAM_LABEL[cnFundParam] || '参数'}
              active={cnFundParam !== 'price'}
            >
              {({ close }) => (
                <div className="flex flex-col gap-0.5">
                  {CN_FUND_PARAM_OPTIONS.map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => { setCnFundParam(opt.key); close(); }}
                      className={cx(
                        'flex items-start gap-2 rounded-lg px-2 py-1.5 text-left transition',
                        cnFundParam === opt.key ? 'bg-[#e8f0fe]' : 'hover:bg-[#f1f3f4]'
                      )}
                    >
                      <span className={cx('text-[13px] font-medium', cnFundParam === opt.key ? 'text-[#1a73e8]' : 'text-[#1f1f1f]')}>{opt.label}</span>
                      <span className="ml-auto text-[11px] text-[#9aa0a6]">{opt.hint}</span>
                    </button>
                  ))}
                </div>
              )}
            </ChartToolbarPopover>
          ) : null}
          {market === 'cn' && cnFundParam === 'premium' ? (
            <ChartToolbarPopover
              icon={premiumView === 'distribution' ? TOOLBAR_ICONS.pie : TOOLBAR_ICONS.bar}
              label={premiumView === 'distribution' ? '分布' : '走势'}
              active={premiumView === 'distribution'}
            >
              {({ close }) => (
                <div className="flex flex-col gap-0.5">
                  {[
                    { key: 'trend', label: '走势', hint: '按时间展示溢价' },
                    { key: 'distribution', label: '分布', hint: '按区间统计占比' },
                  ].map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => { setPremiumView(opt.key); close(); }}
                      className={cx(
                        'flex items-start gap-2 rounded-lg px-2 py-1.5 text-left transition',
                        premiumView === opt.key ? 'bg-[#e8f0fe]' : 'hover:bg-[#f1f3f4]'
                      )}
                    >
                      <span className={cx('text-[13px] font-medium', premiumView === opt.key ? 'text-[#1a73e8]' : 'text-[#1f1f1f]')}>{opt.label}</span>
                      <span className="ml-auto text-[11px] text-[#9aa0a6]">{opt.hint}</span>
                    </button>
                  ))}
                </div>
              )}
            </ChartToolbarPopover>
          ) : null}
          <ChartToolbarPopover
            icon={TOOLBAR_ICONS.indicators}
            label={indicators.size ? `指标 · ${indicators.size}` : '指标'}
            active={indicators.size > 0}
          >
            <div className="flex flex-col gap-0.5">
              {indicatorOptions.map((opt) => (
                <label key={opt.key} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-[#f1f3f4]">
                  <input
                    type="checkbox"
                    checked={indicators.has(opt.key)}
                    onChange={() => toggleIndicator(opt.key)}
                    className="h-3.5 w-3.5 accent-[#1a73e8]"
                  />
                  <span className="text-[13px] text-[#1f1f1f]">{opt.label}</span>
                  <span className="ml-auto text-[11px] text-[#9aa0a6]">{opt.hint}</span>
                </label>
              ))}
            </div>
          </ChartToolbarPopover>

          <ChartToolbarPopover
            icon={TOOLBAR_ICONS.compare}
            label={compareSymbols.length ? `对比 · ${compareSymbols.length}` : '对比'}
            active={compareSymbols.length > 0}
            align="right"
            fixedPanel
            panelClassName="max-w-[calc(100vw-1rem)] overflow-hidden rounded-xl border-[#dfe3eb] bg-white p-0 shadow-lg"
            buttonClassName={compareSymbols.length ? 'border border-[rgba(17,24,39,0.08)] bg-[#eef1f5] text-[#202124] shadow-none' : ''}
          >
            <div className="max-h-[420px] overflow-hidden text-[#202124]">
              <div className="flex h-11 items-center gap-2 border-b border-[#1a73e8] bg-[#f8fafd] px-3">
                <Search size={16} className="shrink-0 text-[#1a73e8]" />
                <input
                  type="text"
                  value={compareInput}
                  onChange={(e) => setCompareInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') addCompare(); }}
                  placeholder="搜索股票代码..."
                  className="min-w-0 flex-1 bg-transparent text-[15px] font-medium text-[#202124] placeholder:text-[#8f96a3] outline-none"
                  disabled={compareSymbols.length >= 3}
                  autoFocus
                />
                {compareInput ? (
                  <button type="button" onClick={() => setCompareInput('')} className="rounded-full p-1 text-[#3c4043] hover:bg-black/5" aria-label="清空搜索">
                    <X size={16} />
                  </button>
                ) : null}
              </div>
              <div className="max-h-[344px] overflow-y-auto px-2.5 py-2">
                <div className="mb-1.5 flex items-center justify-between text-[12px] font-semibold text-[#5f6368]">
                  <span>{compareInput ? '搜索结果' : '所有股票代码'}</span>
                  {compareSearchLoading ? <span className="inline-flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> 搜索中</span> : null}
                </div>
                <div className="flex flex-col">
                  {visibleCompareCandidates.map((item) => {
                    const quote = normalizeCompareQuote(item.symbol, item);
                    const disabled = compareSymbols.includes(item.symbol) || compareSymbols.length >= 3;
                    const rowPositive = Number.isFinite(quote.changePercent) && quote.changePercent > 0;
                    const rowNegative = Number.isFinite(quote.changePercent) && quote.changePercent < 0;
                    const toneClass = rowPositive ? 'text-[#a50e0e]' : rowNegative ? 'text-[#137333]' : 'text-[#5f6368]';
                    return (
                      <button
                        key={item.symbol}
                        type="button"
                        onClick={() => addCompareSymbol(item)}
                        disabled={disabled}
                        className={cx(
                          'flex items-center gap-2 rounded-lg px-2 py-2 text-left transition',
                          disabled ? 'cursor-default opacity-45' : 'hover:bg-[#f8fafd]'
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[16px] font-semibold leading-tight text-[#202124]">{item.symbol}</div>
                          <div className="mt-0.5 truncate text-[12px] font-medium text-[#5f6368]">{quote.name || item.name || item.symbol}</div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="text-[15px] font-semibold tabular-nums text-[#202124]">{Number.isFinite(quote.price) ? `$${formatNumber(quote.price, 2)}` : '--'}</div>
                          <div className={cx('mt-0.5 text-[12px] font-semibold tabular-nums', toneClass)}>
                            {formatSignedPercent(quote.changePercent)} {rowPositive ? '↑' : rowNegative ? '↓' : ''}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                  {compareSearchError ? (
                    <div className="py-10 text-center text-[16px] text-[#a50e0e]">{compareSearchError}</div>
                  ) : !visibleCompareCandidates.length && !compareSearchLoading ? (
                    <div className="py-10 text-center text-[16px] text-[#5f6368]">没有匹配的代码</div>
                  ) : null}
                </div>
              </div>
            </div>
          </ChartToolbarPopover>

          <div className="ml-auto hidden items-center gap-1 text-[11px] text-[#9aa0a6] sm:flex">
            {chartLoading || metricLoading ? <Loader2 size={12} className="animate-spin" /> : null}
            {compareSymbols.length > 0 ? <span>{premiumCompareMode ? '溢价(%)' : '涨幅(%)'}</span> : null}
          </div>
        </div>

        {/* 图表区 */}
        <div
          className="relative mt-1.5 h-[220px] rounded-[14px] bg-[#f1f3f4] p-1.5 sm:mt-2 sm:h-[240px] sm:rounded-[16px] sm:p-2 lg:h-[280px]"
          onClick={(event) => {
            if (isMobile && lockedChartRow && event.target === event.currentTarget) clearLockedChartRow();
          }}
        >
          {compareSymbols.length > 0 ? (
            <div className="absolute left-2 top-2 z-10 flex max-w-[calc(100%-1rem)] flex-wrap items-center gap-1.5 text-[13px] sm:left-3 sm:top-3 sm:max-w-[calc(100%-1.5rem)] sm:gap-2 sm:text-[14px]">
              <span className="inline-flex h-7 items-center gap-1.5 rounded-2xl border border-[rgba(17,24,39,0.08)] bg-[#f8fafd]/95 px-2.5 font-semibold text-[#1a73e8] shadow-[0_2px_8px_rgba(0,0,0,0.06)] sm:h-8 sm:gap-2 sm:px-3.5">
                <span className="size-2 rounded-sm" style={{ background: COMPARE_MAIN_COLOR }} />
                {displaySymbol}
              </span>
              {compareSeries.map((item, ci) => {
                const markerColor = COMPARE_COLORS[ci % COMPARE_COLORS.length];
                const ready = Array.isArray(item.candles) && item.candles.length >= 2;
                const loading = !ready && (compareLoadingMap[`${item.symbol}|${chartTf}`] || item.navLoading);
                const failed = !ready && (compareErrorMap[`${item.symbol}|${chartTf}`] || item.navError);
                return (
                  <span
                    key={item.symbol}
                    className="inline-flex h-7 items-center gap-1.5 rounded-2xl border border-[rgba(17,24,39,0.08)] bg-[#f8fafd]/95 py-0.5 pl-2.5 pr-1 font-semibold shadow-[0_2px_8px_rgba(0,0,0,0.06)] sm:h-8 sm:gap-2 sm:pl-3.5 sm:pr-1.5"
                    style={{ color: markerColor }}
                  >
                    <span className="size-2 shrink-0 rounded-full" style={{ background: markerColor }} />
                    <span className="min-w-0 truncate">{formatSymbolDisplay(item.symbol)}{ready ? '' : loading ? ' 加载中' : failed ? ' 无数据' : ' 等待'}</span>
                    <button
                      type="button"
                      onClick={(event) => { event.stopPropagation(); removeCompare(item.symbol); }}
                      className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[#5f6368] transition hover:bg-black/5 hover:text-[#202124] focus:outline-none focus:ring-2 focus:ring-[#1a73e8]/30 sm:size-6"
                      aria-label={`删除对比标的 ${item.symbol}`}
                      title={`删除 ${item.symbol}`}
                    >
                      <X size={14} aria-hidden="true" />
                    </button>
                  </span>
                );
              })}
            </div>
          ) : null}
          {compareSymbols.length > 0 && compareReadyCount === 0 && comparePendingSymbols.length > 0 ? (
            <div className="pointer-events-none absolute inset-x-0 top-1/2 z-10 flex -translate-y-1/2 justify-center text-[12px] text-[#5f6368]">
              <span className="inline-flex items-center gap-1 rounded-full bg-white/90 px-3 py-1 shadow-sm"><Loader2 size={12} className="animate-spin" /> 正在加载对比线</span>
            </div>
          ) : null}
          {premiumUnavailable ? (
            <div className="flex h-full items-center justify-center text-sm font-medium text-[#5f6368]">场外基金无溢价数据</div>
          ) : hasFullCandles ? (
            <SymbolDetailChart
              candles={effectiveChartCandles}
              tf={chartTf}
              chartType={effectiveChartType}
              indicators={indicators}
              compareSeries={compareSeries}
              compareMode={premiumCompareMode ? 'value' : 'change'}
              tone={tone}
              symbol={cnFundParam === 'price' ? displaySymbol : CN_FUND_PARAM_LABEL[cnFundParam]}
              onHover={handleChartHover}
              onLeave={handleChartLeave}
              onLock={handleChartLock}
              tradeMarkers={compareSymbols.length === 0 ? tradeMarkers : []}
              lockOnClick={isMobile}
              premiumView={premiumView}
            />
          ) : sparkFallback ? (
            <Sparkline points={sparkFallback} width={720} height={210} tone={tone} showFill markLast className="h-full w-full" />
          ) : (
            chartLoading || metricLoading ? (
              <div className="h-full w-full animate-pulse rounded-xl bg-gradient-to-r from-[#f1f3f4] via-white to-[#f1f3f4]" />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-[#5f6368]">{metricError || (cnFundParam === 'price' ? '暂无趋势数据' : `暂无${CN_FUND_PARAM_LABEL[cnFundParam]}历史数据`)}</div>
            )
          )}
        </div>

        {/* 时间范围 tab（Google Finance 风格横向标签） */}
        <div className="mt-1.5 flex h-8 items-center overflow-x-auto rounded-[13px] bg-[#f1f3f4] p-0.5 [scrollbar-width:none] sm:mt-2 sm:h-9 sm:rounded-[15px] sm:p-1 [&::-webkit-scrollbar]:hidden">
          <div
            className="flex w-max items-center gap-0.5 text-[12px] font-medium text-[#5f6368] sm:w-auto sm:gap-1 sm:text-[13px]"
            role="tablist"
            aria-label="股票图表标签页"
          >
            {CHART_RANGE_TABS.map((tab) => {
              const selected = chartRange === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  data-tab-id={tab.tabId}
                  aria-label={tab.label}
                  aria-selected={selected}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => onChartRangeChange && onChartRangeChange(tab.key)}
                  className={cx(
                    'relative flex h-7 min-w-[38px] shrink-0 items-center justify-center rounded-[10px] px-2 transition-colors sm:h-7 sm:min-w-[44px] sm:rounded-[11px] sm:px-2.5',
                    selected
                      ? 'bg-[#EEF1F5] font-bold text-[#202124]'
                      : 'text-[#5f6368] hover:bg-white/60 hover:text-[#202124]'
                  )}
                >
                  {tab.label}
                </button>
              );
            })}
            {chartLoading ? <Loader2 size={12} className="mb-2 animate-spin text-slate-400" /> : null}
          </div>
        </div>

        {premiumUnavailable ? (
          <div className="mt-1.5 rounded-xl border border-[#e8eaed] bg-[#f8fafd] px-3 py-2 text-[12px] font-medium text-[#5f6368] sm:text-[13px]">场外基金无溢价数据</div>
        ) : compareSymbols.length > 0 ? (
          <div className="overflow-hidden bg-white text-[11px] sm:text-[13px]">
            <div className="grid h-8 grid-cols-[minmax(44px,1fr)_58px_58px_64px] items-center gap-0.5 border-b border-[rgba(17,24,39,0.08)] px-1 text-right text-[11px] font-semibold text-[#5f6368] sm:h-10 sm:grid-cols-[minmax(160px,1fr)_96px_96px_96px_96px] sm:gap-2 sm:px-4 sm:text-[13px]">
              <div className="min-w-0 truncate text-left">股票代码</div>
              <div className="whitespace-nowrap">{premiumCompareMode ? '溢价' : '价格'}</div>
              <div className="whitespace-nowrap">{premiumCompareMode ? '溢价差' : '涨跌额'}</div>
              <div className="whitespace-nowrap">{premiumCompareMode ? '价格' : '涨跌幅'}</div>
              <div className="hidden sm:block">{premiumCompareMode ? '净值' : '昨收盘'}</div>
            </div>
            {displayCompareTableRows.map((item, index) => {
              const markerColor = index === 0 ? COMPARE_MAIN_COLOR : COMPARE_COLORS[(index - 1) % COMPARE_COLORS.length];
              const toneValue = premiumCompareMode ? Number(item.price) : Number(item.changePercent);
              const rowPositive = Number.isFinite(toneValue) && toneValue > 0;
              const rowNegative = Number.isFinite(toneValue) && toneValue < 0;
              const toneClass = rowPositive ? 'text-[#a50e0e]' : rowNegative ? 'text-[#137333]' : 'text-[#1f1f1f]';
              const spreadValue = Number(item.premiumSpread);
              const spreadPositive = Number.isFinite(spreadValue) && spreadValue > 0;
              const spreadNegative = Number.isFinite(spreadValue) && spreadValue < 0;
              const spreadToneClass = spreadPositive ? 'text-[#a50e0e]' : spreadNegative ? 'text-[#137333]' : 'text-[#1f1f1f]';
              const displayRowSymbol = formatSymbolDisplay(item.symbol);
              return (
                <div key={`${item.symbol}-${index}`} className="grid h-12 grid-cols-[minmax(44px,1fr)_58px_58px_64px] items-center gap-0.5 border-b border-[rgba(17,24,39,0.08)] px-1 text-right text-[12px] tabular-nums sm:h-16 sm:grid-cols-[minmax(160px,1fr)_96px_96px_96px_96px] sm:gap-2 sm:px-4 sm:text-[16px]">
                  <div className="flex min-w-0 items-center gap-1 text-left sm:gap-3">
                    <span className="size-2 shrink-0 rounded-sm sm:size-3" style={{ background: markerColor }} />
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-bold leading-tight text-[#202124] sm:text-[18px]">{displayRowSymbol}</div>
                      <div className="mt-0.5 hidden truncate text-[12px] text-[rgba(17,24,39,0.64)] sm:block sm:text-[13px]">{item.name}</div>
                    </div>
                  </div>
                  <div className={cx('whitespace-nowrap text-[12px] font-bold transition-colors duration-[120ms] sm:text-[17px]', premiumCompareMode ? toneClass : 'text-[#202124]')}>{Number.isFinite(item.price) ? (premiumCompareMode ? formatSignedPercent(item.price) : (market === 'cn' ? formatNumber(item.price, 2) : `$${formatNumber(item.price, 2)}`)) : '--'}</div>
                  <div className={cx('whitespace-nowrap text-[12px] font-bold transition-colors duration-[120ms] sm:text-[16px]', premiumCompareMode ? spreadToneClass : toneClass)}>{premiumCompareMode ? (Number.isFinite(spreadValue) ? formatSignedPercent(spreadValue) : '--') : (Number.isFinite(item.change) ? `${item.change > 0 ? '+' : ''}${formatNumber(item.change, 2)}` : '--')}</div>
                  <div className={cx('whitespace-nowrap text-[13px] font-bold transition-colors duration-[120ms] sm:text-[16px]', premiumCompareMode ? 'text-[#202124]' : toneClass)}>{premiumCompareMode ? (Number.isFinite(item.marketPrice) ? formatNumber(item.marketPrice, 4) : '--') : (Number.isFinite(item.changePercent) ? formatSignedPercent(item.changePercent) : '--')}</div>
                  <div className="hidden whitespace-nowrap text-[15px] font-bold text-[#202124] transition-colors duration-[120ms] sm:block sm:text-[17px]">{premiumCompareMode ? (Number.isFinite(item.navValue) ? formatNumber(item.navValue, 4) : '--') : (Number.isFinite(item.previousClose) ? (market === 'cn' ? formatNumber(item.previousClose, 2) : `$${formatNumber(item.previousClose, 2)}`) : '--')}</div>
                </div>
              );
            })}
            {premiumSpreadStats ? (
              <div className="flex items-center justify-between gap-2 border-b border-[rgba(17,24,39,0.08)] px-1 py-2 text-[11px] font-medium text-[#5f6368] sm:px-4 sm:text-[13px]">
                <span>最大/最小溢价差</span>
                <span className="text-right tabular-nums text-[#202124]">
                  {formatSignedPercent(premiumSpreadStats.spread)}
                  <span className="ml-1 text-[#9aa0a6]">{premiumSpreadStats.maxSymbol} - {premiumSpreadStats.minSymbol}</span>
                </span>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* 详情 tab */}
        <div className="mt-1.5 flex gap-4 border-b border-[#e8eaed] text-[12px] font-medium text-[#5f6368] sm:mt-2 sm:text-[13px]">
          {(market === 'us' ? SYMBOL_DETAIL_TABS.filter((tab) => tab.key === 'overview' || tab.key === 'earnings' || tab.key === 'financials') : SYMBOL_DETAIL_TABS.filter((tab) => tab.key === 'overview' || (!isCnOtcFund && (tab.key === 'fundFlow' || tab.key === 'fundReport')))).map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => onTabChange(tab.key)}
              className={cx(
                '-mb-px border-b-2 px-1 pb-2 transition',
                activeTab === tab.key ? 'border-[#1a73e8] text-[#1a73e8]' : 'border-transparent hover:text-[#1f1f1f]'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 py-3 sm:px-1 sm:py-4">
        {activeTab === 'overview' ? (
          <div className="space-y-5">
            {xueqiuFundLoading && market === 'cn' && !cnOverviewExtras.length ? (
              <div className="h-20 animate-pulse rounded-xl bg-[#f1f3f4]" />
            ) : null}
            <div className="grid gap-x-10 text-[15px] sm:grid-cols-2 lg:grid-cols-3">
              {overviewRows.map((item) => (
                <div key={item.label} className="flex min-h-11 items-center justify-between gap-5 border-b border-[#e8eaed] py-2.5">
                  <span className="text-[#5f6368]">{item.label}</span>
                  <span className={cx('font-medium tabular-nums text-[#1f1f1f]', item.className)}>{item.value}</span>
                </div>
              ))}
            </div>
            <div className="border-t border-[#e8eaed] pt-4">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-[#1f1f1f]">相关新闻</h3>
                <span className="text-[12px] text-[#5f6368]">按决策优先级后置</span>
              </div>
              <NewsList items={(relatedNews.length ? relatedNews : news.slice(0, 5)).slice(0, 5)} />
            </div>
          </div>
        ) : activeTab === 'fundFlow' ? (
          <CnFundFlowPanel fundData={xueqiuFundData} loading={xueqiuFundLoading} />
        ) : activeTab === 'fundReport' ? (
          <CnFundReportPanel fundData={xueqiuFundData} loading={xueqiuFundLoading} />
        ) : activeTab === 'earnings' ? (
          <EarningsCalendar items={relatedEarnings.length ? relatedEarnings : earnings.slice(0, 5)} />
        ) : (
          <FinancialsPanel financials={financials} loading={financialsLoading} />
        )}
      </div>
    </section>
  );
}
