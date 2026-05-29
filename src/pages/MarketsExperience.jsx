import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import '../styles/ai-chat.css';
import { ArrowDown, ArrowUp, CalendarDays, ChevronDown, ChevronRight, ChevronUp, Edit3, ExternalLink, History, ListPlus, Loader2, Maximize2, Minimize2, Plus, RefreshCw, Search, Send, Sparkles, Star, Trash2, TrendingUp, Wallet, X } from 'lucide-react';
import {
  Card,
  Pill,
  TextInput,
  cx
} from '../components/experience-ui.jsx';
import {
  addToWatchlist,
  askMarkets,
  askMarketsStream,
  createWatchlist,
  deleteWatchlist,
  fetchEarnings,
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
import { buildStockAnalysisPrompt } from '../app/stockAnalysisPrompt.js';
import { getCnEtfPremiumSnapshot, getNavHistory, getNavSnapshot, getNavSnapshots } from '../app/navService.js';
import { Sparkline } from '../components/markets/Sparkline.jsx';
import { MarketsChartCodeBlock } from '../components/markets/MarketsChartBlock.jsx';
import { Area, Bar, CartesianGrid, ComposedChart, Customized, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import nasdaqOtcCatalog from '../../data/all_nasdq_otc.json';

const MARKETS = [
  { key: 'us', label: '美股' },
  { key: 'cn', label: 'A股' }
];

const CN_ETF_PRESET_MAP = Object.fromEntries(CN_ETF_WATCHLIST_PRESETS.map((item) => [item.symbol, item]));
const NASDAQ_OTC_FUND_MAP = Object.fromEntries(((nasdaqOtcCatalog && nasdaqOtcCatalog.funds) || []).map((item) => [String(item.code || '').trim(), item]));
const CN_FUND_FEE_RATE_FALLBACK = {
  '513100': 0.8,
};
const MARKETS_PENDING_SYMBOL_KEY = 'markets:pendingSymbol';

function formatNumber(value, fractionDigits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  return n.toLocaleString('zh-CN', { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits });
}

function formatPercent(value, fractionDigits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  const sign = n > 0 ? '+' : '';
  return sign + n.toFixed(fractionDigits) + '%';
}

function formatSignedPercent(value, fractionDigits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  const sign = n > 0 ? '+' : '';
  return sign + n.toFixed(fractionDigits) + '%';
}

function formatPercentNoPlus(value, fractionDigits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  return n.toFixed(fractionDigits) + '%';
}

function formatTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('zh-CN', { hour12: false });
}

function formatSymbolDisplay(value) {
  const raw = String(value || '').trim();
  const match = /^(sh|sz|bj)(\d{6})$/i.exec(raw);
  return match ? match[2] : raw;
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

function normalizeCnFundCode(value) {
  const raw = String(value || '').trim();
  const prefixed = /^(sh|sz|bj)(\d{6})$/i.exec(raw);
  if (prefixed) return prefixed[2];
  const sixDigits = /(\d{6})/.exec(raw);
  return sixDigits ? sixDigits[1] : '';
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

function buildNavSnapshotItems(snapshot) {
  if (!snapshot) return [];
  const rows = [];
  const previousDate = String(snapshot.previousNavDate || '').slice(0, 10);
  const previousNav = Number(snapshot.previousNav);
  if (/^\d{4}-\d{2}-\d{2}$/.test(previousDate) && Number.isFinite(previousNav) && previousNav > 0) {
    rows.push({ date: previousDate, nav: previousNav });
  }
  const latestDate = String(snapshot.latestNavDate || snapshot.navDate || '').slice(0, 10);
  const latestNav = Number(snapshot.latestNav ?? snapshot.baseNav);
  if (/^\d{4}-\d{2}-\d{2}$/.test(latestDate) && Number.isFinite(latestNav) && latestNav > 0) {
    rows.push({ date: latestDate, nav: latestNav });
  }
  const seen = new Set();
  return rows
    .sort((a, b) => a.date.localeCompare(b.date))
    .filter((item) => {
      if (seen.has(item.date)) return false;
      seen.add(item.date);
      return true;
    });
}


function formatLargeNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  const abs = Math.abs(n);
  if (abs >= 1e12) return (n / 1e12).toFixed(2) + 'T';
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (abs >= 1e4) return (n / 1e4).toFixed(1) + '万';
  return n.toLocaleString('zh-CN');
}

function valueOrDash(value, digits = 2) {
  const n = Number(value);
  return Number.isFinite(n) ? formatNumber(n, digits) : '--';
}

function rowMetric(row, keys = []) {
  for (const key of keys) {
    const value = row && row[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

function normalizePremiumPercentValue(value, forceRate = false) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (forceRate || Math.abs(n) <= 1) return n * 100;
  return n;
}

function resolvePremiumPercent(row) {
  if (!row) return null;
  const explicitPercent = rowMetric(row, ['premiumPercent', 'premium_rate', 'premiumPct']);
  if (explicitPercent !== null) return normalizePremiumPercentValue(explicitPercent, false);
  const explicitRate = rowMetric(row, ['premiumRate', 'premium']);
  if (explicitRate !== null) return normalizePremiumPercentValue(explicitRate, false);
  const price = Number(rowMetric(row, ['price', 'regularMarketPrice', 'latestPrice']));
  const nav = Number(rowMetric(row, ['nav', 'latestNav', 'iopv', 'baseNav', 'estimateNav']));
  if (!Number.isFinite(price) || !Number.isFinite(nav) || nav <= 0) return null;
  return ((price - nav) / nav) * 100;
}

function formatPremiumPercent(row) {
  const pct = resolvePremiumPercent(row);
  return Number.isFinite(Number(pct)) ? formatSignedPercent(pct) : '—';
}

function resolveFundFeeRate(row) {
  if (!row) return null;
  const explicit = rowMetric(row, ['feeRate', 'expenseRatio', 'managementFeeRate', 'fundFeeRate', 'annualFeeRate']);
  const n = Number(explicit);
  if (Number.isFinite(n)) return Math.abs(n) <= 1 ? n * 100 : n;
  const code = normalizeCnFundCode(row.code || row.symbol);
  const fallback = code ? CN_FUND_FEE_RATE_FALLBACK[code] : null;
  return Number.isFinite(Number(fallback)) ? Number(fallback) : null;
}

function formatFeeRate(row) {
  const rate = resolveFundFeeRate(row);
  return Number.isFinite(Number(rate)) ? `${formatNumber(rate, 2).replace(/\.00$/, '')}%` : '—';
}

function formatTotalShares(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n >= 100000000) return `${formatNumber(n / 100000000, 2)}亿`;
  if (n >= 10000) return `${formatNumber(n / 10000, 2)}万`;
  return formatNumber(n, 2);
}

function formatYearPercent(row) {
  const pct = Number(rowMetric(row, ['currentYearPercent', 'ytdPercent', 'yearPercent']));
  return Number.isFinite(pct) ? formatSignedPercent(pct) : '—';
}

function sortableMetric(row, key) {
  if (key === 'symbol' || key === 'name') return String(row[key] || '').toLowerCase();
  if (key === 'trend') return Number(row.changePercent) || 0;
  const value = rowMetric(row, MARKET_TABLE_METRICS[key] || [key]);
  const n = Number(value);
  return Number.isFinite(n) ? n : -Infinity;
}

const MARKET_TABLE_METRICS = {
  price: ['price', 'regularMarketPrice'],
  changePercent: ['changePercent', 'regularMarketChangePercent'],
  previousClose: ['previousClose', 'prevClose', 'regularMarketPreviousClose'],
  open: ['open', 'regularMarketOpen'],
  high: ['high', 'regularMarketDayHigh', 'dayHigh'],
  low: ['low', 'regularMarketDayLow', 'dayLow'],
  volume: ['volume', 'regularMarketVolume'],
  marketCap: ['marketCap', 'marketCapitalization'],
};

// HH:mm 格式，用于新闻列表左侧时间戳列。
function formatClock(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

// 仅月日，用于跨天新闻的辅助显示。
function formatDateShort(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

// 根据来源名取首字母，多字取前 2；中文取首字。
function sourceInitials(source) {
  const s = String(source || '').trim();
  if (!s) return '?';
  // 英文：取前两个单词首字母。
  const words = s.split(/[\s\-_/]+/).filter(Boolean);
  if ([...s].every((char) => char.charCodeAt(0) <= 0x7f) && words.length) {
    return words.slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  }
  // 中文或混合：取首字。
  return s.slice(0, 1);
}

// 以来源名计算一个稳定的 hue，避免所有 badge 同色。
function sourceHue(source) {
  const s = String(source || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

function SourceBadge({ source }) {
  const hue = sourceHue(source);
  const bg = `hsl(${hue} 70% 92%)`;
  const fg = `hsl(${hue} 55% 32%)`;
  const badgeStyle = { backgroundColor: bg, color: fg };
  return (
    <span
      title={source || ''}
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold"
      style={badgeStyle}
    >
      {sourceInitials(source)}
    </span>
  );
}

// 发布时间 < 15 分钟 认为是“实时”。
function isRecentNow(value, windowMinutes = 15) {
  if (!value) return false;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return false;
  return Date.now() - d.getTime() < windowMinutes * 60 * 1000;
}

// 跨天新闻需要额外显示日期。
function isToday(value) {
  if (!value) return false;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

function changeToneClass(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return 'text-slate-500';
  return n > 0 ? 'text-rose-600' : 'text-emerald-600';
}

// 从 URL 中抽取 host。解析失败时返回空字符串。
function siteHost(url) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '');
  } catch (_) {
    return '';
  }
}

// 用 Google s2 favicon 服务拼 favicon URL，方便在主题卡、涨跌榜、新闻列表复用。
function siteFavicon(url) {
  const host = siteHost(url);
  if (!host) return '';
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
}

// 主题卡右上角的叠加 favicon + “N 个网站”徽标，仿 Google Finance。
// 主题卡右上角的叠加 favicon + “N 个网站”按钮：点击展开/收起新闻引用卡。
function ThemeSourceFavicons({ sources = [], expanded = false, onToggle }) {
  const list = (sources || []).filter((s) => s && s.url);
  if (!list.length) return null;
  const preview = list.slice(0, 3);
  const label = `${list.length} 个网站`;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      aria-label={`${expanded ? '收起' : '展开'}${label}`}
      title={label}
      className={cx(
        'inline-flex shrink-0 items-center gap-1 rounded-full border border-slate-200/70 bg-white px-1.5 py-0.5 text-[11px] text-slate-500 shadow-sm transition hover:border-indigo-300 hover:text-indigo-600',
        expanded && 'border-indigo-300 text-indigo-600',
      )}
    >
      <span className="flex -space-x-1.5">
        {preview.map((s, i) => {
          const fav = siteFavicon(s.url);
          const host = s.source || siteHost(s.url);
          return fav ? (
            <img
              key={i}
              src={fav}
              alt=""
              title={host}
              loading="lazy"
              className="h-4 w-4 rounded-full border border-white bg-white object-cover"
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
          ) : (
            <span
              key={i}
              title={host}
              className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-white bg-slate-100 text-[8px] font-semibold text-slate-500"
            >
              {sourceInitials(host)}
            </span>
          );
        })}
      </span>
      <span className="whitespace-nowrap">{label}</span>
      {expanded
        ? <ChevronDown size={11} className="shrink-0 text-slate-400" />
        : <ChevronRight size={11} className="shrink-0 text-slate-400" />}
    </button>
  );
}

// 仿 Google Finance：每条新闻一张 rich card，显示标题 + favicon + 站点域名。
function ThemeSourceCards({ sources = [] }) {
  const list = (sources || []).filter((s) => s && s.url);
  if (!list.length) return null;
  return (
    <ul className="mt-3 space-y-2">
      {list.map((s, i) => {
        const fav = siteFavicon(s.url);
        const host = siteHost(s.url);
        const display = host ? `www.${host}` : (s.source || '');
        return (
          <li key={i}>
            <a
              href={s.url}
              target="_blank"
              rel="noreferrer noopener"
              className="group block rounded-2xl border border-slate-200/70 bg-slate-50/80 px-3 py-2.5 transition hover:border-indigo-300 hover:bg-white"
            >
              <div className="line-clamp-2 text-[13px] font-medium leading-snug text-slate-800 group-hover:text-indigo-700">
                {s.title || display || s.url}
              </div>
              <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-500">
                {fav ? (
                  <img
                    src={fav}
                    alt=""
                    loading="lazy"
                    className="h-3.5 w-3.5 shrink-0 rounded-full"
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  />
                ) : (
                  <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[8px] font-semibold text-slate-500">
                    {sourceInitials(s.source || host)}
                  </span>
                )}
                <span className="truncate">{display}</span>
                <ExternalLink size={10} className="ml-auto shrink-0 text-slate-300" />
              </div>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

// “借助 AI 深入探索此主题” 胶囊按钮：点击后在右侧“研究”面板以深度模式自动执行，
// 主题概要与新闻引用作为 context 传给后端。不再弹出右下角 AI 抽屉。
function ThemeExploreButton({ theme }) {
  const onClick = useCallback(() => {
    if (!theme) return;
    const title = String(theme.title || '').trim();
    const detail = String(theme.detail || '').trim();
    const refs = (theme.sources || [])
      .filter((s) => s && s.url)
      .slice(0, 6)
      .map((s, i) => {
        const host = s.source || siteHost(s.url) || '';
        const t = s.title || host || s.url;
        return `${i + 1}. ${t}${host ? `（${host}）` : ''} ${s.url}`;
      })
      .join('\n');
    // 输入框只填一句话，避免长提示闪现。
    const question = title
      ? `深入解读主题「${title}」`
      : '深入解读今日主题';
    // 上下文交给服务端，不走输入框。
    const ctxLines = [
      title ? `主题标题：${title}` : '',
      detail ? `主题概要：${detail}` : '',
      refs ? `相关新闻引用：\n${refs}` : '',
    ].filter(Boolean).join('\n\n');
    try {
      window.dispatchEvent(new CustomEvent('markets:research', {
        detail: {
          question,
          depth: 'deep',
          context: ctxLines,
        },
      }));
    } catch (_) { /* ignore */ }
  }, [theme]);
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800"
    >
      <Search size={12} />
      借助 AI 深入探索此主题
    </button>
  );
}

function IndexCard({ entry, onPick, sparkPoints }) {
  const positive = Number(entry.changePercent) > 0;
  const negative = Number(entry.changePercent) < 0;
  const tone = positive ? 'up' : negative ? 'down' : 'flat';
  const change = Number(entry.change);
  const hasChange = Number.isFinite(change);
  return (
    <button
      type="button"
      onClick={() => onPick && onPick(entry)}
      className="group flex min-h-[112px] w-[140px] min-w-0 shrink-0 snap-start flex-col items-start gap-1 overflow-hidden rounded-xl border border-slate-200/70 bg-white p-2 text-left shadow-sm transition hover:shadow-md sm:w-[152px] lg:w-[160px]"
    >
      <div className="w-full flex items-start justify-between gap-2">
        <div className="line-clamp-2 min-h-[30px] text-[13px] font-semibold leading-tight text-slate-900">{entry.name || formatSymbolDisplay(entry.symbol)}</div>
        <div className="flex flex-col items-end ml-2">
          <span className={cx(
            'text-[11px] font-semibold tabular-nums',
            positive ? 'text-rose-600' : negative ? 'text-emerald-600' : 'text-slate-500'
          )}>{formatPercent(entry.changePercent)}</span>
          <span className={cx(
            'inline-flex h-[16px] w-[16px] items-center justify-center rounded-full text-white mt-1',
            positive ? 'bg-rose-500' : negative ? 'bg-emerald-500' : 'bg-slate-300'
          )}>
            {positive ? <ArrowUp size={10} strokeWidth={2} /> : negative ? <ArrowDown size={10} strokeWidth={2} /> : null}
          </span>
        </div>
      </div>
      <div className="w-full flex items-center justify-between">
        <div className="w-2/3 truncate text-[12px] font-medium leading-tight tabular-nums text-slate-700">{formatNumber(entry.price)}</div>
        {hasChange && (
          <div className="text-[10px] leading-none tabular-nums text-slate-500">({change >= 0 ? '+' : ''}{formatNumber(Math.abs(change))})</div>
        )}
      </div>
      <div className="mt-auto -mx-1 w-[calc(100%+0.5rem)] pt-1">
        <Sparkline points={sparkPoints} width={140} height={36} tone={tone} className="h-[36px] w-full" />
      </div>
    </button>
  );
}

function MoversTable({ rows = [], onPick, klineMap = {}, initialLimit = 4 }) {
  const [expanded, setExpanded] = useState(false);
  if (!rows.length) {
    return <p className="text-sm text-slate-400">暂无榜单数据。</p>;
  }
  const total = rows.length;
  const visibleRows = expanded ? rows : rows.slice(0, initialLimit);
  const hiddenCount = Math.max(0, total - initialLimit);
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white/80">
      <table className="min-w-full divide-y divide-slate-200/70 text-sm">
        <thead className="bg-slate-50/70 text-xs font-medium uppercase tracking-wider text-slate-500">
          <tr>
            <th className="px-3 py-2 text-left">代码</th>
            <th className="px-3 py-2 text-left">名称</th>
            <th className="px-3 py-2 text-right">最新价</th>
            <th className="px-3 py-2 text-right">涨跌幅</th>
            <th className="px-3 py-2 text-right">趋势</th>
            <th className="px-3 py-2 text-right">操作</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {visibleRows.map((row) => {
            const pct = Number(row.changePercent);
            const positive = Number.isFinite(pct) && pct > 0;
            const negative = Number.isFinite(pct) && pct < 0;
            return (
            <tr key={row.symbol} className={cx(
              'hover:bg-indigo-50/40',
              positive && 'bg-rose-50/30',
              negative && 'bg-emerald-50/30'
            )}>
              <td className="px-3 py-2 align-top font-mono text-xs text-slate-600">
                <div>{formatSymbolDisplay(row.symbol)}</div>
                {row.industry ? (
                  <div className="mt-0.5 text-[10px] font-normal text-slate-400">{row.industry}</div>
                ) : null}
              </td>
              <td className="px-3 py-2 align-top text-slate-800">{row.name}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatNumber(row.price)}</td>
              <td className={cx('px-3 py-2 text-right tabular-nums font-semibold', changeToneClass(row.changePercent))}>
                <span className="inline-flex items-center justify-end gap-0.5">
                  {positive ? <ArrowUp size={11} /> : negative ? <ArrowDown size={11} /> : null}
                  {formatPercent(row.changePercent)}
                </span>
              </td>
              <td className="px-3 py-2 text-right">
                <div className="inline-flex justify-end">
                  <Sparkline
                    points={klineMap[row.symbol]}
                    width={72}
                    height={24}
                    tone={positive ? 'up' : negative ? 'down' : 'flat'}
                  />
                </div>
              </td>
              <td className="px-3 py-2 text-right">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:border-indigo-300 hover:text-indigo-600"
                  onClick={() => onPick && onPick(row)}
                  title="加入自选"
                >
                  <Plus size={12} /> 自选
                </button>
              </td>
            </tr>
          );
          })}
        </tbody>
      </table>
      {hiddenCount > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center justify-center gap-1 border-t border-slate-100 bg-slate-50/60 py-2 text-xs font-medium text-indigo-600 hover:bg-indigo-50/60"
        >
          {expanded ? (
            <>收起 <ChevronDown size={12} className="rotate-180" /></>
          ) : (
            <>显示更多 ({hiddenCount}) <ChevronDown size={12} /></>
          )}
        </button>
      ) : null}
    </div>
  );
}


function SortableMarketTable({ title = '', rows = [], market, onPick, onRemove, klineMap = {}, emptyText = '暂无数据。', initialSort = 'changePercent', initialDirection = 'desc', action = 'pick', compact = false }) {
  const [sortKey, setSortKey] = useState(initialSort);
  const [direction, setDirection] = useState(initialDirection);
  const sortedRows = useMemo(() => {
    const dir = direction === 'asc' ? 1 : -1;
    return (rows || []).slice().sort((a, b) => {
      const av = sortableMetric(a, sortKey);
      const bv = sortableMetric(b, sortKey);
      if (typeof av === 'string' || typeof bv === 'string') return String(av).localeCompare(String(bv)) * dir;
      const an = Number.isFinite(Number(av)) ? Number(av) : -Infinity;
      const bn = Number.isFinite(Number(bv)) ? Number(bv) : -Infinity;
      return (an - bn) * dir;
    });
  }, [rows, sortKey, direction]);
  const setSort = (key) => {
    if (sortKey === key) setDirection((v) => v === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setDirection(key === 'symbol' || key === 'name' ? 'asc' : 'desc'); }
  };
  const Head = ({ id, children, right = false }) => (
    <th className={cx('whitespace-nowrap px-3 py-2', right ? 'text-right' : 'text-left')}>
      <button type="button" onClick={() => setSort(id)} className={cx('inline-flex items-center gap-1 hover:text-slate-800', right && 'justify-end')}>
        <span>{children}</span>
        {sortKey === id ? <ChevronDown size={11} className={cx('transition', direction === 'asc' && 'rotate-180')} /> : null}
      </button>
    </th>
  );
  if (!rows.length) return <p className="text-sm text-slate-400">{emptyText}</p>;
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white/80">
      {title ? <div className="border-b border-slate-100 px-3 py-2 text-sm font-semibold text-slate-900">{title}</div> : null}
      <div className="overflow-x-auto">
        <table className="min-w-[960px] divide-y divide-slate-200/70 text-sm">
          <thead className="bg-slate-50/70 text-xs font-medium uppercase tracking-wider text-slate-500">
            <tr>
              <Head id="symbol">代码</Head>
              <Head id="name">名称</Head>
              <Head id="price" right>价格</Head>
              <Head id="changePercent" right>% Change</Head>
              <Head id="trend" right>Trend</Head>
              <Head id="previousClose" right>Prev Close</Head>
              <Head id="open" right>Open</Head>
              <Head id="high" right>High</Head>
              <Head id="low" right>Low</Head>
              <Head id="volume" right>Volume</Head>
              <Head id="marketCap" right>Mkt Cap</Head>
              <th className="px-3 py-2 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sortedRows.map((row) => {
              const pct = Number(row.changePercent);
              const positive = Number.isFinite(pct) && pct > 0;
              const negative = Number.isFinite(pct) && pct < 0;
              return (
                <tr key={`${market || row.market || ''}:${row.symbol}`} className={cx('hover:bg-indigo-50/40', positive && 'bg-rose-50/20', negative && 'bg-emerald-50/20')}>
                  <td className="px-3 py-2 align-top font-mono text-xs text-slate-600">
                    <div>{formatSymbolDisplay(row.symbol)}</div>
                    {row.exchange || row.industry ? <div className="mt-0.5 text-[10px] font-normal text-slate-400">{row.exchange || row.industry}</div> : null}
                  </td>
                  <td className="px-3 py-2 align-top text-slate-800">{row.name || formatSymbolDisplay(row.symbol)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{valueOrDash(rowMetric(row, MARKET_TABLE_METRICS.price))}</td>
                  <td className={cx('px-3 py-2 text-right tabular-nums font-semibold', changeToneClass(row.changePercent))}>{formatPercent(row.changePercent)}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="inline-flex justify-end">
                      <Sparkline points={klineMap[row.symbol]} width={compact ? 56 : 72} height={24} tone={positive ? 'up' : negative ? 'down' : 'flat'} />
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{valueOrDash(rowMetric(row, MARKET_TABLE_METRICS.previousClose))}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{valueOrDash(rowMetric(row, MARKET_TABLE_METRICS.open))}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{valueOrDash(rowMetric(row, MARKET_TABLE_METRICS.high))}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{valueOrDash(rowMetric(row, MARKET_TABLE_METRICS.low))}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatLargeNumber(rowMetric(row, MARKET_TABLE_METRICS.volume))}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatLargeNumber(rowMetric(row, MARKET_TABLE_METRICS.marketCap))}</td>
                  <td className="px-3 py-2 text-right">
                    {action === 'remove' ? (
                      <button type="button" className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-400 hover:border-rose-300 hover:text-rose-500" onClick={() => onRemove && onRemove(market, row.symbol)} title="移除自选"><Trash2 size={12} /> 移除</button>
                    ) : (
                      <button type="button" className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:border-indigo-300 hover:text-indigo-600" onClick={() => onPick && onPick(row)} title="加入自选"><Plus size={12} /> 自选</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function WatchlistSelector({ lists = [], activeListId, onSelect, onCreate, onRename, onDelete }) {
  const [open, setOpen] = useState(false);
  const active = (lists || []).find((item) => item.id === activeListId) || lists[0];
  const canDelete = (item) => item?.id !== 'default' && (lists || []).length > 1;
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} className="inline-flex items-center gap-1 rounded-md px-1 py-1 text-[20px] leading-7 font-normal tracking-tight text-[#1f1f1f] hover:bg-[#f1f3f4]" title="列表切换">
        <span>{active?.name || '列表'}</span>
        <ChevronDown size={18} className="text-[#5f6368]" />
      </button>
      {open ? (
        <div className="absolute left-0 top-full z-30 mt-1 w-64 overflow-hidden rounded-2xl border border-[#e8eaed] bg-white py-1 shadow-lg">
          {(lists || []).map((item) => (
            <div key={item.id} className={cx('flex w-full items-center gap-1 px-3 py-2 text-sm hover:bg-[#f8fafd]', item.id === activeListId ? 'text-[#1a73e8]' : 'text-[#1f1f1f]')}>
              <button type="button" onClick={() => { onSelect?.(item.id); setOpen(false); }} className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left">
                <span className="truncate">{item.name}</span>
                <span className="text-[11px] text-[#9aa0a6]">{(item.us?.length || 0) + (item.cn?.length || 0)}</span>
              </button>
              <button
                type="button"
                aria-label={`重命名${item.name}`}
                title="改名"
                onClick={(event) => { event.stopPropagation(); onRename?.(item); setOpen(false); }}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#5f6368] hover:bg-[#e8f0fe] hover:text-[#1a73e8]"
              >
                <Edit3 size={13} />
              </button>
              {canDelete(item) ? (
                <button
                  type="button"
                  aria-label={`删除${item.name}`}
                  title="删除"
                  onClick={(event) => { event.stopPropagation(); onDelete?.(item); setOpen(false); }}
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#5f6368] hover:bg-[#fce8e6] hover:text-[#d93025]"
                >
                  <Trash2 size={13} />
                </button>
              ) : null}
            </div>
          ))}
          <button type="button" onClick={() => { onCreate?.(); setOpen(false); }} className="flex w-full items-center gap-2 border-t border-[#e8eaed] px-3 py-2 text-left text-sm font-medium text-[#1a73e8] hover:bg-[#f8fafd]"><ListPlus size={14} /> 新建列表</button>
        </div>
      ) : null}
    </div>
  );
}

function WatchlistNameDialog({ dialog, onChangeName, onCancel, onSubmit }) {
  if (!dialog) return null;
  const isDelete = dialog.type === 'delete';
  const title = isDelete ? '删除列表' : (dialog.type === 'rename' ? '编辑列表名称' : '新建列表');
  const total = (dialog.list?.us?.length || 0) + (dialog.list?.cn?.length || 0);
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/30 px-4 py-6 sm:items-center" onMouseDown={onCancel}>
      <div className="w-full max-w-sm rounded-[28px] bg-white p-6 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <div className="mb-5 text-center text-xl font-semibold leading-snug text-[#1f1f1f]">{title}</div>
        {isDelete ? (
          <div className="mb-5 rounded-2xl bg-[#f8fafd] px-4 py-3 text-sm text-[#5f6368]">
            确认删除「<span className="font-semibold text-[#1f1f1f]">{dialog.list?.name || '列表'}</span>」？{total ? `其中 ${total} 个标的也会移除。` : ''}
          </div>
        ) : (
          <label className="mb-5 block text-sm text-[#5f6368]">
            输入新的列表名称
            <input
              autoFocus
              value={dialog.name || ''}
              onChange={(event) => onChangeName(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') onSubmit(); }}
              className="mt-3 h-14 w-full rounded-2xl border-0 bg-[#f1f3f4] px-4 text-base text-[#1f1f1f] outline-none focus:ring-2 focus:ring-[#1a73e8]/35"
            />
          </label>
        )}
        <div className="grid grid-cols-2 gap-3">
          <button type="button" onClick={onCancel} className="h-12 rounded-2xl bg-[#f1f3f4] text-base font-semibold text-[#1f1f1f] hover:bg-[#e8eaed]">取消</button>
          <button type="button" onClick={onSubmit} className={cx('h-12 rounded-2xl text-base font-semibold text-white', isDelete ? 'bg-[#d93025] hover:bg-[#b3261e]' : 'bg-[#1a73e8] hover:bg-[#1557b0]')}>{isDelete ? '删除' : '确定'}</button>
        </div>
      </div>
    </div>
  );
}

function ListExpandButton({ expanded = false, onClick, className = '' }) {
  const Icon = expanded ? Minimize2 : Maximize2;
  return (
    <button
      type="button"
      aria-label={expanded ? '缩小列表' : '放大列表'}
      title={expanded ? '缩小列表' : '放大列表'}
      onClick={onClick}
      className={cx('inline-flex h-9 w-9 items-center justify-center rounded-full text-[#5f6368] hover:bg-[#f1f3f4] hover:text-[#1f1f1f]', className)}
    >
      <Icon size={19} strokeWidth={2.2} />
    </button>
  );
}

function MarketListTable({ rows = [], klineMap = {}, selectedSymbol = '', onSelect, compact = false, stickyHeader = false }) {
  if (!rows.length) {
    return <p className="px-2 py-2 text-sm text-[#5f6368]">未配置自选。</p>;
  }
  return (
    <div className={cx('overflow-x-auto', compact ? 'rounded-xl border border-[#e8eaed] bg-white' : 'rounded-2xl border border-[#e8eaed] bg-white shadow-sm')}>
      <table className={cx('w-full min-w-[980px] border-separate border-spacing-0 text-sm', compact && 'min-w-[520px] text-[12px]')}>
        <thead className={cx('bg-[#f8fafd] text-[11px] font-semibold text-[#5f6368]', stickyHeader && 'sticky top-0 z-10')}>
          <tr>
            <th className={cx('px-3 py-2 text-left', compact && 'px-2')}>代码</th>
            <th className={cx('px-3 py-2 text-left', compact && 'px-2')}>名称</th>
            <th className={cx('px-3 py-2 text-right', compact && 'px-2')}>最新价</th>
            <th className={cx('px-3 py-2 text-right', compact && 'px-2')}>涨跌幅</th>
            <th className={cx('px-3 py-2 text-right', compact && 'px-2')}>溢价</th>
            {!compact ? <th className="px-3 py-2 text-right">年内涨幅</th> : null}
            {!compact ? <th className="px-3 py-2 text-right">总份额</th> : null}
            {!compact ? <th className="px-3 py-2 text-right">费率</th> : null}
            {!compact ? <th className="px-3 py-2 text-right">趋势</th> : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#e8eaed]">
          {rows.map((row) => {
            const displaySymbol = formatSymbolDisplay(row.symbol);
            const pct = Number(row.changePercent);
            const flat = !Number.isFinite(pct) || Math.abs(pct) < 0.0001;
            const up = pct > 0;
            const premiumPct = resolvePremiumPercent(row);
            const selected = row.symbol === selectedSymbol;
            return (
              <tr
                key={row.symbol}
                role="button"
                tabIndex={0}
                aria-pressed={selected}
                onClick={() => onSelect?.(row)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelect?.(row);
                  }
                }}
                className={cx(
                  'cursor-pointer transition hover:bg-[#f1f3f4] focus:outline-none focus:ring-2 focus:ring-[#1a73e8]/30',
                  selected && 'bg-[#e8f0fe] hover:bg-[#e8f0fe]'
                )}
              >
                <td className={cx('whitespace-nowrap px-3 py-2 font-mono text-xs font-semibold text-[#1f1f1f]', compact && 'px-2')}>{displaySymbol}</td>
                <td className={cx('min-w-[120px] px-3 py-2 text-[#1f1f1f]', compact && 'px-2')}>
                  <div className="truncate font-medium">{row.name || displaySymbol}</div>
                  {row.meta ? <div className="truncate text-[10px] text-[#5f6368]">{row.meta}</div> : null}
                </td>
                <td className={cx('whitespace-nowrap px-3 py-2 text-right tabular-nums text-[#1f1f1f]', compact && 'px-2')}>{formatNumber(row.price)}</td>
                <td className={cx('whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums', compact && 'px-2', flat ? 'text-[#5f6368]' : up ? 'text-[#a50e0e]' : 'text-[#137333]')}>{formatPercent(row.changePercent)}</td>
                <td className={cx('whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums', compact && 'px-2', changeToneClass(premiumPct))}>{formatPremiumPercent(row)}</td>
                {!compact ? <td className={cx('whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums', changeToneClass(Number(row.currentYearPercent)))}>{formatYearPercent(row)}</td> : null}
                {!compact ? <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-[#1f1f1f]">{formatTotalShares(row.totalShares)}</td> : null}
                {!compact ? <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-[#1f1f1f]">{formatFeeRate(row)}</td> : null}
                {!compact ? (
                  <td className="px-3 py-2 text-right">
                    <div className="inline-flex justify-end">
                      <Sparkline points={klineMap[row.symbol]} width={86} height={26} tone={flat ? 'flat' : up ? 'up' : 'down'} showFill markLast />
                    </div>
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ExpandedMarketListOverlay({ open, rows, klineMap, selectedSymbol, activeName, marketLabel, onClose, onSelect, onCreate, loading }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed bottom-0 z-[70] hidden bg-white/98 px-5 pb-5 pt-3 backdrop-blur-sm lg:left-[var(--console-active-sidebar-w)] lg:right-[var(--console-ctx-w)] lg:top-[34px] lg:block">
      <div className="flex h-full w-full flex-col gap-3">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[#e8eaed] pb-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#5f6368]">
              <span>{marketLabel}</span>
              {loading ? <Loader2 size={12} className="animate-spin" /> : null}
            </div>
            <h2 className="mt-1 truncate text-[22px] font-semibold text-[#1f1f1f]">{activeName || '监控列表'}</h2>
          </div>
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={onCreate} className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-[#5f6368] hover:bg-[#f1f3f4] hover:text-[#1f1f1f]">
              <ListPlus size={18} /> 新建列表
            </button>
            <ListExpandButton expanded onClick={onClose} />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto rounded-2xl bg-[#f8fafd] p-3">
          <MarketListTable rows={rows} klineMap={klineMap} selectedSymbol={selectedSymbol} onSelect={onSelect} stickyHeader />
        </div>
      </div>
    </div>
  );
}

function SidebarRow({ symbol, name, price, changePercent, sparkPoints, selected = false, onSelect, meta = '' }) {
  const pct = Number(changePercent);
  const flat = !Number.isFinite(pct) || Math.abs(pct) < 0.0001;
  const up = pct > 0;
  const textTone = flat ? 'text-[#5f6368]' : up ? 'text-[#a50e0e]' : 'text-[#137333]';
  const ArrowIcon = flat ? null : up ? ArrowUp : ArrowDown;
  const sparkTone = flat ? 'flat' : up ? 'up' : 'down';
  const displaySymbol = formatSymbolDisplay(symbol);
  const showName = name && name !== symbol && name !== displaySymbol;
  const detailText = [showName ? name : '', meta].filter(Boolean).join(' · ');
  return (
    <li className="group relative">
      <div
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        onClick={() => onSelect?.()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect?.();
          }
        }}
        className={cx(
          'flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 transition hover:bg-[#f1f3f4] focus:outline-none focus:ring-2 focus:ring-[#1a73e8]/30',
          selected && 'bg-[#e8f0fe] ring-1 ring-[#1a73e8]/25 hover:bg-[#e8f0fe]'
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium leading-tight text-[#1f1f1f]">{displaySymbol}</div>
          {detailText ? <div className="truncate text-[11px] leading-tight text-[#5f6368]">{detailText}</div> : null}
        </div>
        {sparkPoints && sparkPoints.length >= 2 ? (
          <Sparkline points={sparkPoints} width={76} height={28} tone={sparkTone} showFill markLast />
        ) : (
          <div className="h-[28px] w-[76px]" />
        )}
        <div className="flex shrink-0 flex-col items-end leading-tight">
          <div className="text-[13px] font-medium tabular-nums text-[#1f1f1f]">{formatNumber(price)}</div>
          <div className={cx('flex items-center gap-0.5 text-[11px] tabular-nums', textTone)}>
            {ArrowIcon ? <ArrowIcon size={10} /> : null}
            <span>{formatPercent(changePercent)}</span>
          </div>
        </div>
      </div>
    </li>
  );
}

function MobileSidebarRow({ symbol, name, price, changePercent, sparkPoints, selected = false, onSelect, meta = '' }) {
  const pct = Number(changePercent);
  const flat = !Number.isFinite(pct) || Math.abs(pct) < 0.0001;
  const up = pct > 0;
  // 统一“涨红跌绿”：上涨用红 (#a50e0e)，下跌用绿 (#137333)。
  const textTone = flat ? 'text-[#5f6368]' : up ? 'text-[#a50e0e]' : 'text-[#137333]';
  const circleBg = flat ? 'bg-[#bdc1c6]' : up ? 'bg-[#a50e0e]' : 'bg-[#137333]';
  const ArrowIcon = flat ? null : up ? ArrowUp : ArrowDown;
  const sparkTone = flat ? 'flat' : up ? 'up' : 'down';
  const displaySymbol = formatSymbolDisplay(symbol);
  const showName = name && name !== symbol && name !== displaySymbol;
  const detailText = [showName ? name : '', meta].filter(Boolean).join(' · ');
  return (
    <li
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={() => onSelect?.()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect?.();
        }
      }}
      className={cx(
        'flex cursor-pointer items-center gap-3 rounded-2xl px-2 py-3.5 transition hover:bg-[#f1f3f4] focus:outline-none focus:ring-2 focus:ring-[#1a73e8]/30',
        selected && 'bg-[#e8f0fe] ring-1 ring-[#1a73e8]/25 hover:bg-[#e8f0fe]'
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-base font-semibold leading-tight text-[#1f1f1f]">{displaySymbol}</div>
        {detailText ? <div className="truncate text-sm leading-tight text-[#5f6368]">{detailText}</div> : null}
      </div>
      {sparkPoints && sparkPoints.length >= 2 ? (
        <Sparkline points={sparkPoints} width={86} height={32} tone={sparkTone} showFill markLast />
      ) : (
        <div className="h-[32px] w-[86px]" />
      )}
      <div className="flex shrink-0 flex-col items-end gap-0.5 leading-tight">
        <div className="text-base font-medium tabular-nums text-[#1f1f1f]">{formatNumber(price)}</div>
        <div className="flex items-center gap-1">
          <span className={cx('text-sm font-medium tabular-nums', textTone)}>{formatPercent(changePercent)}</span>
          {ArrowIcon ? (
            <span className={cx('inline-flex h-5 w-5 items-center justify-center rounded-full text-white', circleBg)}>
              <ArrowIcon size={12} strokeWidth={3} />
            </span>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function NewsList({ items = [] }) {
  if (!items.length) {
    return <p className="text-sm text-slate-400">今日暂无动态。</p>;
  }
  return (
    <ul className="divide-y divide-slate-100">
      {items.slice(0, 20).map((it) => {
        const realtime = isRecentNow(it.publishedAt);
        const today = isToday(it.publishedAt);
        return (
          <li key={it.url || it.title} className="py-2 first:pt-0 last:pb-0">
            <a
              href={it.url}
              target="_blank"
              rel="noreferrer noopener"
              className="flex items-start gap-3 rounded-lg px-1 py-1 transition hover:bg-indigo-50/40"
            >
              <div className="flex w-14 shrink-0 flex-col items-end pt-0.5 text-xs tabular-nums text-slate-400">
                {it.publishedAt ? (
                  <>
                    <span className="font-medium text-slate-600">{formatClock(it.publishedAt)}</span>
                    {!today && <span className="text-[10px] text-slate-400">{formatDateShort(it.publishedAt)}</span>}
                  </>
                ) : (
                  <span>--:--</span>
                )}
              </div>
              <SourceBadge source={it.source} />
              <div className="min-w-0 flex-1">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1 text-sm font-medium leading-snug text-slate-800">
                    {it.title}
                  </div>
                  {realtime && (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-600">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-rose-500" />
                      实时
                    </span>
                  )}
                  <ExternalLink size={12} className="mt-1 shrink-0 text-slate-300" />
                </div>
                {it.source && (
                  <div className="mt-0.5 text-[11px] text-slate-400">{it.source}</div>
                )}
              </div>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

// 美股今日主题摘要。仿 Google Finance：首条默认展开（粗体标题 + 段落正文 + AI 探索按钮），
// 其余条目折叠，每条右侧显示新闻来源 favicon 疆叠 + “N 个网站”。
// 最新动态：仿 Google Finance。单行、点列表、“X 分钟前” 相对时间、来源 favicon + 标题裁切。
function formatAgo(iso) {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const diff = Date.now() - t;
  if (diff < 60_000) return '刚刚';
  const m = Math.floor(diff / 60_000);
  if (m < 60) return m + ' 分钟前';
  const h = Math.floor(m / 60);
  if (h < 24) return h + ' 小时前';
  const d = Math.floor(h / 24);
  if (d < 7) return d + ' 天前';
  try { return new Date(iso).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }); }
  catch (_) { return ''; }
}

function LatestNewsList({ items = [], initialLimit = 6 }) {
  const [expanded, setExpanded] = useState(false);
  if (!items.length) {
    return <p className="text-sm text-slate-400">今日暂无动态。</p>;
  }
  const limit = expanded ? items.length : Math.min(initialLimit, items.length);
  const visible = items.slice(0, limit);
  const hasMore = items.length > initialLimit;
  return (
    <div>
      <ul className="divide-y divide-slate-100">
        {visible.map((it) => {
          const ago = formatAgo(it.publishedAt);
          return (
            <li key={it.url || it.title} className="py-2 first:pt-0">
              <a
                href={it.url}
                target="_blank"
                rel="noreferrer noopener"
                className="group flex items-center gap-3 rounded-lg px-1 py-1 transition hover:bg-indigo-50/40"
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
                <span className="w-16 shrink-0 text-xs tabular-nums text-slate-400">{ago || '刚刚'}</span>
                <SourceBadge source={it.source} />
                <span className="min-w-0 flex-1 truncate text-sm text-slate-700">
                  <span className="text-slate-500">{it.source || '评论'}</span>
                  <span className="px-1 text-slate-400">-</span>
                  <span className="text-slate-800 underline decoration-transparent underline-offset-2 transition group-hover:decoration-slate-400">{it.title}</span>
                </span>
              </a>
            </li>
          );
        })}
      </ul>
      {hasMore && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800"
        >
          {expanded ? '收起' : '显示更多内容'}
          <ChevronDown size={12} className={cx('transition', expanded && 'rotate-180')} />
        </button>
      )}
    </div>
  );
}

// 即将发布的财报日历。仿 Google Finance：左侧日期 chip + 公司 / 时间 + 周期 + 估算每股收益 + 估算收入。
const WEEKDAY_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
function parseEarningsDateLocal(d) {
  if (!d) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}
function formatEarningsHourCST(hourCode) {
  if (hourCode === 'bmo') return '盘前公布 UTC+8';
  if (hourCode === 'amc') return '盘后公布 UTC+8';
  if (hourCode === 'dmh') return '盘中公布 UTC+8';
  return '';
}
function formatRevenue(n) {
  if (n == null || !Number.isFinite(Number(n))) return '-';
  const v = Math.abs(Number(n));
  if (v >= 1e12) return (Number(n) / 1e12).toFixed(2) + ' 万亿';
  if (v >= 1e8) return (Number(n) / 1e8).toFixed(2) + ' 亿';
  if (v >= 1e4) return (Number(n) / 1e4).toFixed(2) + ' 万';
  return String(n);
}
function formatCnMoney(value) {
  if (value == null || !Number.isFinite(Number(value))) return '--';
  return formatRevenue(Number(value));
}
function formatCnAmount(value) {
  if (value == null || !Number.isFinite(Number(value))) return '--';
  return formatRevenue(Number(value));
}
function formatMaybeDate(value) {
  if (!value) return '--';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10) || '--';
  return d.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' });
}
function formatXueqiuDateMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '--';
  return new Date(n).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' });
}
function firstPairValue(value) {
  return Array.isArray(value) ? value[0] : value;
}
function getXueqiuQuote(fundData) {
  return fundData?.results?.quote_detail?.raw?.data?.quote || fundData?.results?.quote_detail?.summary?.quote || null;
}
function getXueqiuPayload(fundData, key) {
  return fundData?.results?.[key]?.raw?.data || null;
}
function getLatestFinanceRow(fundData, key) {
  const list = getXueqiuPayload(fundData, key)?.list;
  return Array.isArray(list) && list.length ? list[0] : null;
}

function isCnMarketOpenNow(date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Shanghai',
      hour12: false,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(date);
    const get = (type) => parts.find((p) => p.type === type)?.value;
    const weekday = String(get('weekday') || '').toLowerCase();
    if (weekday === 'sat' || weekday === 'sun') return false;
    const hour = Number(get('hour'));
    const minute = Number(get('minute'));
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return false;
    const hm = hour * 60 + minute;
    const morningOpen = 9 * 60 + 30;
    const morningClose = 11 * 60 + 30;
    const afternoonOpen = 13 * 60;
    const afternoonClose = 15 * 60;
    return (hm >= morningOpen && hm <= morningClose) || (hm >= afternoonOpen && hm <= afternoonClose);
  } catch (_error) {
    return false;
  }
}
function detailValueRow(label, value, className = '') {
  return { label, value, className };
}
function buildXueqiuPremiumSnapshotFromQuote(row, symbol) {
  const price = Number(row?.price);
  const latestNav = Number(row?.latestNav ?? row?.unitNav);
  const iopv = Number(row?.iopv);
  const premiumPercent = Number(row?.premiumPercent ?? row?.premium_rate);
  if (!Number.isFinite(price) || price <= 0) return null;
  if (!Number.isFinite(latestNav) || latestNav <= 0) return null;
  const effectiveIopv = Number.isFinite(iopv) && iopv > 0 ? iopv : latestNav;
  return {
    symbol: String(symbol || row?.symbol || '').trim(),
    price,
    baseNav: latestNav,
    latestNav,
    navDate: row?.latestNavDate || row?.navDate || '',
    iopv: effectiveIopv,
    premiumPercent: Number.isFinite(premiumPercent) ? premiumPercent : ((price - effectiveIopv) / effectiveIopv) * 100,
    updatedAt: row?.lastUpdated || row?.asOf || new Date().toISOString(),
    cache: { hit: false, source: 'xueqiu-quote', key: '' }
  };
}
function formatEps(n) {
  if (n == null || !Number.isFinite(Number(n))) return '-';
  return Number(n).toFixed(2);
}
function EarningsCalendar({ items = [], initialLimit = 5 }) {
  const [expanded, setExpanded] = useState(false);
  if (!items.length) {
    return <p className="text-sm text-slate-400">今日暂无财报计划。</p>;
  }
  const limit = expanded ? items.length : Math.min(initialLimit, items.length);
  const visible = items.slice(0, limit);
  const hasMore = items.length > initialLimit;
  return (
    <div className="divide-y divide-slate-100">
      {visible.map((it, idx) => {
        const d = parseEarningsDateLocal(it.date);
        const weekday = d ? WEEKDAY_CN[d.getDay()] : '';
        const dayOfMonth = d ? d.getDate() : '';
        const hourLabel = formatEarningsHourCST(it.hour);
        const epsValue = it.epsActual != null ? it.epsActual : it.epsEstimate;
        const epsForecast = it.epsActual == null;
        const revValue = it.revenueActual != null ? it.revenueActual : it.revenueEstimate;
        const revForecast = it.revenueActual == null;
        return (
          <div key={it.symbol + '-' + it.date + '-' + idx} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
            <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-md bg-slate-100 text-slate-600">
              <span className="text-[10px] leading-none">{weekday}</span>
              <span className="text-base font-semibold leading-tight">{dayOfMonth}</span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="truncate text-sm font-medium text-slate-800">{it.name || it.symbol}</span>
                {Array.isArray(it.indices) && it.indices.map((idx) => (
                  <span
                    key={idx}
                    className="inline-flex shrink-0 items-center rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600"
                  >
                    {idx}
                  </span>
                ))}
              </div>
              {hourLabel && <div className="text-xs text-slate-400">{hourLabel}</div>}
            </div>
            <div className="hidden w-28 shrink-0 text-xs sm:block">
              <div className="text-slate-400">周期</div>
              <div className="text-slate-700">{it.year ? it.year + ' 财年第 ' + (it.quarter || '-') + ' 季度' : '-'}</div>
            </div>
            <div className="hidden w-24 shrink-0 text-xs sm:block">
              <div className="text-slate-400">{epsForecast ? '估算每股收益' : '每股收益'}</div>
              <div className="text-slate-700 tabular-nums">{formatEps(epsValue)}</div>
            </div>
            <div className="w-20 shrink-0 text-xs sm:w-24">
              <div className="text-slate-400">{revForecast ? '估算收入' : '收入'}</div>
              <div className="text-slate-700 tabular-nums">{formatRevenue(revValue)}</div>
            </div>
          </div>
        );
      })}
      {hasMore && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 inline-flex items-center gap-1 py-2 text-xs text-slate-500 hover:text-slate-800"
        >
          {expanded ? '收起' : '更多即将发布的财报'}
          <ChevronRight size={12} className={cx('transition', expanded && 'rotate-90')} />
        </button>
      )}
    </div>
  );
}

const SYMBOL_DETAIL_TABS = [
  { key: 'overview', label: '概览' },
  { key: 'fundFlow', label: '资金' },
  { key: 'fundReport', label: '年报' },
  { key: 'earnings', label: '财报' },
  { key: 'financials', label: '财务' },
];

// 图表时间范围 tab：Google Finance 风格。每个 range 映射到 worker 接受的 tf。
// 客户端再按 range 截取 candles 最后一段，保证视觉粒度合理。
const CHART_RANGE_TABS = [
  { key: '1d', label: '1 天', tabId: '1dayTab', tf: '5m', daysBack: 1 },
  { key: '5d', label: '5 天', tabId: '5dayTab', tf: '5m', daysBack: 5 },
  { key: '1mo', label: '1 个月', tabId: '1monthTab', tf: '1d', daysBack: 31 },
  { key: '6mo', label: '6 个月', tabId: '6monthTab', tf: '1d', daysBack: 31 * 6 },
  { key: 'ytd', label: '年初至今', tabId: 'ytdTab', tf: '1d', daysBack: null },
  { key: '1y', label: '1 年', tabId: '1yearTab', tf: '1d', daysBack: 365 },
  { key: '5y', label: '5 年', tabId: '5yearTab', tf: '1d', daysBack: 365 * 5 },
  { key: 'max', label: '最大', tabId: 'maxTab', tf: '1d', daysBack: null },
];

function sliceCandlesForRange(candles, rangeKey) {
  const arr = Array.isArray(candles) ? candles : [];
  if (!arr.length) return arr;
  const cfg = CHART_RANGE_TABS.find((r) => r.key === rangeKey);
  if (!cfg) return arr;
  if (rangeKey === 'ytd') {
    const y = new Date().getFullYear();
    const startSec = Date.UTC(y, 0, 1) / 1000;
    return arr.filter((c) => Number(c && c.t) >= startSec);
  }
  if (cfg.daysBack == null) return arr;
  const maxSec = arr.reduce((max, candle) => {
    const t = Number(candle && candle.t);
    return Number.isFinite(t) && t > max ? t : max;
  }, 0);
  const anchorSec = maxSec > 0 ? maxSec : Math.floor(Date.now() / 1000);
  const cutoffSec = anchorSec - cfg.daysBack * 86400;
  const filtered = arr.filter((c) => Number(c && c.t) >= cutoffSec);
  return filtered.length >= 2 ? filtered : arr;
}

function shanghaiDateFromEpochSec(sec) {
  const n = Number(sec);
  if (!Number.isFinite(n) || n <= 0) return '';
  try {
    return new Date(n * 1000).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  } catch (_error) {
    return new Date(n * 1000).toISOString().slice(0, 10);
  }
}

function epochSecFromShanghaiDate(date, time = '15:00:00') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return 0;
  const safeTime = /^\d{2}:\d{2}(?::\d{2})?$/.test(String(time || '')) ? String(time) : '15:00:00';
  const t = Date.parse(`${date}T${safeTime}+08:00`);
  return Number.isFinite(t) ? Math.floor(t / 1000) : 0;
}

function buildHoldingTradeMarkers(transactions = [], code = '', aliases = []) {
  const normalizedCode = normalizeCnFundCode(code);
  const normalizeAliasText = (value = '') => String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
  const aliasSet = new Set(
    [code, normalizedCode, ...(Array.isArray(aliases) ? aliases : [])]
      .map(normalizeAliasText)
      .filter(Boolean)
  );
  if (!normalizedCode && !aliasSet.size) return [];
  return (Array.isArray(transactions) ? transactions : [])
    .map((tx, index) => {
      const rawCandidates = [
        tx?.code,
        tx?.symbol,
        tx?.fundCode,
        tx?.securityCode,
        tx?.name,
      ].map(normalizeAliasText).filter(Boolean);
      const rawSymbol = rawCandidates[0] || '';
      const txCode = normalizeCnFundCode(rawCandidates.find((item) => normalizeCnFundCode(item)) || rawSymbol);
      const symbolMatches = Boolean(
        (normalizedCode && txCode === normalizedCode)
        || rawCandidates.some((item) => aliasSet.has(item))
        || (normalizedCode && rawCandidates.some((item) => item.includes(normalizedCode)))
      );
      const rawType = String(tx?.type || '').toUpperCase();
      const side = String(tx?.side || '').toLowerCase();
      const type = rawType === 'BUY' || rawType === '买入' || side === 'buy'
        ? 'BUY'
        : rawType === 'SELL' || rawType === '卖出' || side === 'sell'
          ? 'SELL'
          : '';
      const date = String(tx?.date || '').slice(0, 10);
      if (!symbolMatches || !type || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
      return {
        id: tx.id || `${type}-${date}-${index}`,
        type,
        date,
        t: epochSecFromShanghaiDate(date, '15:00:00'),
        price: Number(tx.price ?? tx.nav ?? tx.costPrice),
        shares: Number(tx.shares),
      };
    })
    .filter((marker) => marker && marker.t > 0)
    .filter((marker, index, markers) => {
      const key = `${marker.type}|${marker.date}|${Number(marker.price) || 0}|${Number(marker.shares) || 0}`;
      return markers.findIndex((item) => `${item.type}|${item.date}|${Number(item.price) || 0}|${Number(item.shares) || 0}` === key) === index;
    })
    .sort((a, b) => a.t - b.t);
}

function navHistoryDaysForRange(rangeKey) {
  const cfg = CHART_RANGE_TABS.find((r) => r.key === rangeKey);
  if (rangeKey === '1d') return 30;
  if (rangeKey === '5d') return 45;
  if (rangeKey === 'ytd') {
    const start = new Date(new Date().getFullYear(), 0, 1);
    return Math.max(30, Math.ceil((Date.now() - start.getTime()) / 86400000) + 10);
  }
  if (!cfg || cfg.daysBack == null) return 3650;
  return Math.max(30, Math.min(3650, cfg.daysBack + 10));
}

function findNavOnOrBefore(navItems, date) {
  if (!Array.isArray(navItems) || !date) return null;
  let found = null;
  for (const item of navItems) {
    if (item.date <= date) found = item;
    else break;
  }
  return found;
}

function buildCnFundParamCandles(priceCandles, navItems, param, premiumState, rangeKey = '') {
  if (param === 'price') return priceCandles;
  let sortedNav = (Array.isArray(navItems) ? navItems : [])
    .filter((item) => item && /^\d{4}-\d{2}-\d{2}$/.test(String(item.date || '')) && Number(item.nav) > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (param === 'nav') {
    const latestData = premiumState?.data || null;
    const latestDate = String(latestData?.navDate || '').slice(0, 10);
    const latestNav = Number(latestData?.latestNav ?? latestData?.baseNav);
    if (/^\d{4}-\d{2}-\d{2}$/.test(latestDate) && Number.isFinite(latestNav) && latestNav > 0) {
      sortedNav = sortedNav.filter((item) => item.date !== latestDate);
      sortedNav.push({ date: latestDate, nav: latestNav, source: 'xueqiu-quote' });
      sortedNav.sort((a, b) => a.date.localeCompare(b.date));
    }
  }
  if (param === 'nav' && rangeKey === '1d' && sortedNav.length) {
    // 场外基金没有盘中分时。1 天视图用最新确认净值生成同一日水平线，避免把前一净值日连成斜线。
    const latest = sortedNav[sortedNav.length - 1];
    const v = Number(latest.nav);
    const startT = epochSecFromShanghaiDate(latest.date, '09:30:00');
    const endT = epochSecFromShanghaiDate(latest.date, '15:00:00');
    return startT && endT && Number.isFinite(v) && v > 0
      ? [
        { t: startT, o: v, h: v, l: v, c: v, date: latest.date },
        { t: endT, o: v, h: v, l: v, c: v, date: latest.date }
      ]
      : [];
  }
  if (param === 'nav') {
    const priceTimeline = Array.isArray(priceCandles) ? priceCandles : [];
    if (priceTimeline.length >= 2 && rangeKey !== '1d') {
      return priceTimeline
        .map((candle) => {
          const date = shanghaiDateFromEpochSec(candle?.t);
          const navItem = findNavOnOrBefore(sortedNav, date);
          const v = Number(navItem?.nav);
          return date && Number.isFinite(v) && v > 0
            ? { t: Number(candle.t), o: v, h: v, l: v, c: v, date: navItem.date }
            : null;
        })
        .filter(Boolean);
    }
    return sortedNav
      .map((item) => {
        const t = epochSecFromShanghaiDate(item.date);
        const v = Number(item.nav);
        return t && Number.isFinite(v) && v > 0 ? { t, o: v, h: v, l: v, c: v, date: item.date } : null;
      })
      .filter(Boolean);
  }
  if (param === 'premium') {
    const base = (Array.isArray(priceCandles) ? priceCandles : [])
      .map((candle) => {
        const date = shanghaiDateFromEpochSec(candle?.t);
        const navItem = findNavOnOrBefore(sortedNav, date);
        const nav = Number(navItem?.nav);
        if (!date || !Number.isFinite(nav) || nav <= 0) return null;
        const iopv = nav;
        const toPremium = (value) => {
          const n = Number(value);
          return Number.isFinite(n) ? ((n - nav) / nav) * 100 : null;
        };
        const o = toPremium(candle.o);
        const h = toPremium(candle.h);
        const l = toPremium(candle.l);
        const c = toPremium(candle.c);
        if (![o, h, l, c].every(Number.isFinite)) return null;
        return { t: Number(candle.t), o, h, l, c, date, nav, iopv };
      })
      .filter(Boolean);

    // 1 天溢价：补一个“最新点”，让图表跟随实时溢价刷新。
    // 历史仍来自 base（由 candle 价格 + 当日/前一净值映射计算）。
    if (rangeKey === '1d') {
      const latest = premiumState?.data;
      const premiumPercent = Number(latest?.premiumPercent);
      if (Number.isFinite(premiumPercent)) {
        const nowSec = Math.floor(Date.now() / 1000);
        const nowDate = shanghaiDateFromEpochSec(nowSec);
        const navItem = findNavOnOrBefore(sortedNav, nowDate);
        const nav = Number(navItem?.nav);
        if (nowDate && Number.isFinite(nav) && nav > 0) {
          const latestPoint = {
            t: nowSec,
            o: premiumPercent,
            h: premiumPercent,
            l: premiumPercent,
            c: premiumPercent,
            date: nowDate,
            nav,
            iopv: nav,
          };
          return base.length ? [...base, latestPoint] : [latestPoint];
        }
      }
    }
    return base;
  }
  return priceCandles;
}

function isCnOtcFundQuote(row) {
  if (!row) return false;
  const source = String(row.source || '').toLowerCase();
  const assetType = String(row.assetType || row.type || '').toLowerCase();
  const exchange = String(row.exchange || '').toLowerCase();
  return row.valueType === 'nav'
    || assetType.includes('otc')
    || assetType.includes('场外')
    || exchange.includes('场外')
    || source.includes('otc-fund')
    || source.includes('nav-fallback');
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

function marketStateLabel(state, marketCode) {
  const v = String(state || '').toUpperCase();
  if (v === 'REGULAR') return '交易中';
  if (v === 'PRE') return '盘前';
  if (v === 'POST' || v === 'POSTPOST') return '盘后';
  if (v === 'CLOSED') return '已收盘';
  if (v === 'PREPRE') return '盘前候开';
  return marketCode === 'cn' ? '已收盘' : '已收盘';
}

// ---------- 图表工具栏（图表类型 / 指标 / 对比标的） ----------
const toolbarIconClass = 'h-[18px] w-[18px] stroke-[2.2] text-[#202124]';
const TOOLBAR_ICONS = {
  params: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className={toolbarIconClass}><path d="M4 7h10" /><path d="M18 7h2" /><circle cx="16" cy="7" r="2" /><path d="M4 17h2" /><path d="M10 17h10" /><circle cx="8" cy="17" r="2" /></svg>,
  area: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className={toolbarIconClass}><path d="M4 17l4-5 4 2 4-7 4 10" /><path d="M4 20h16" /><path d="M4 17l4-5 4 2 4-7 4 10v3H4z" fill="currentColor" opacity="0.16" stroke="none" /></svg>,
  candle: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className={toolbarIconClass}><path d="M7 4v4" /><path d="M7 16v4" /><rect x="5" y="8" width="4" height="8" rx="1" /><path d="M17 3v5" /><path d="M17 15v6" /><rect x="15" y="8" width="4" height="7" rx="1" /></svg>,
  bar: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className={toolbarIconClass}><path d="M5 20V9" /><path d="M12 20V4" /><path d="M19 20v-7" /><path d="M3 20h18" /></svg>,
  indicators: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className={toolbarIconClass}><path d="M4 17c3-8 6 4 9-4s5 0 7-6" /><path d="M4 7h4" /><path d="M16 17h4" /></svg>,
  compare: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className={toolbarIconClass}><path d="M4 8c2.5-3 5.5-3 8 0s5.5 3 8 0" /><path d="M4 16c2.5 3 5.5 3 8 0s5.5-3 8 0" /></svg>,
};
const CHART_TYPE_OPTIONS = [
  { key: 'candle', label: 'K 线图', hint: '开高低收烛台', icon: TOOLBAR_ICONS.candle },
  { key: 'bar', label: '柱形图', hint: '柱形展示收盘价', icon: TOOLBAR_ICONS.bar },
];
const CHART_TYPE_LABEL = CHART_TYPE_OPTIONS.reduce((acc, o) => { acc[o.key] = o.label; return acc; }, {});
const CN_FUND_PARAM_OPTIONS = [
  { key: 'price', label: '价格', hint: '场内交易价格' },
  { key: 'nav', label: '净值', hint: '上一工作日确认净值' },
  { key: 'premium', label: '溢价', hint: '价格相对估算 IOPV' },
];
const CN_FUND_PARAM_LABEL = CN_FUND_PARAM_OPTIONS.reduce((acc, o) => { acc[o.key] = o.label; return acc; }, {});

const INDICATOR_OPTIONS = [
  { key: 'ma5', label: 'MA5', hint: '5 日均线' },
  { key: 'ma10', label: 'MA10', hint: '10 日均线' },
  { key: 'ma20', label: 'MA20', hint: '20 日均线' },
  { key: 'ma60', label: 'MA60', hint: '60 日均线' },
  { key: 'boll', label: 'BOLL', hint: '布林带 (20, 2)' },
];
const MA_COLORS = { ma5: '#1a73e8', ma10: '#ea4335', ma20: '#f9ab00', ma60: '#9aa0a6' };
const COMPARE_COLORS = ['#e37400', '#9333ea', '#10b981'];
const COMPARE_MAIN_COLOR = '#2563eb';
const COMPARE_TEXT_CLASSES = ['text-[#e37400]', 'text-[#9333ea]', 'text-[#10b981]'];
const COMPARE_DOT_CLASSES = ['bg-[#e37400]', 'bg-[#9333ea]', 'bg-[#10b981]'];
const CHART_UP = '#a50e0e';
const CHART_DOWN = '#137333';

function computeMA(closes, period) {
  const out = new Array(closes.length).fill(null);
  let sum = 0;
  for (let i = 0; i < closes.length; i += 1) {
    sum += closes[i];
    if (i >= period) sum -= closes[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function computeBOLL(closes, period = 20, mult = 2) {
  const upper = []; const mid = []; const lower = [];
  for (let i = 0; i < closes.length; i += 1) {
    if (i < period - 1) { upper.push(null); mid.push(null); lower.push(null); continue; }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j += 1) sum += closes[j];
    const mean = sum / period;
    let sq = 0;
    for (let j = i - period + 1; j <= i; j += 1) sq += (closes[j] - mean) * (closes[j] - mean);
    const sd = Math.sqrt(sq / period);
    mid.push(mean); upper.push(mean + mult * sd); lower.push(mean - mult * sd);
  }
  return { upper, mid, lower };
}

function fmtChartLabel(t, tf) {
  if (!Number.isFinite(Number(t))) return '';
  const d = new Date(Number(t) * 1000);
  if (tf === '5m' || tf === '15m' || tf === '60m') {
    return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('zh-CN', { year: '2-digit', month: '2-digit', day: '2-digit' });
}

function CandlesLayerPanel({ xAxisMap, yAxisMap, data }) {
  if (!xAxisMap || !yAxisMap || !data) return null;
  const xAxis = Object.values(xAxisMap)[0];
  const yAxis = Object.values(yAxisMap)[0];
  if (!xAxis || !yAxis || typeof yAxis.scale !== 'function') return null;
  const xScale = xAxis.scale;
  const yScale = yAxis.scale;
  const step = data.length > 1 && xAxis.width ? Math.max(2, xAxis.width / Math.max(1, data.length - 1)) : 8;
  const w = Math.max(2, Math.min(10, step * 0.54));
  return (
    <g>
      {data.map((d, i) => {
        if (!Number.isFinite(d.o) || !Number.isFinite(d.h) || !Number.isFinite(d.l) || !Number.isFinite(d.c)) return null;
        const cxRaw = xScale(d.label);
        if (typeof cxRaw !== 'number' || Number.isNaN(cxRaw)) return null;
        const cx = cxRaw;
        const up = d.c >= d.o;
        const color = up ? CHART_UP : CHART_DOWN;
        const yH = yScale(d.h);
        const yL = yScale(d.l);
        const yTop = yScale(Math.max(d.o, d.c));
        const yBot = yScale(Math.min(d.o, d.c));
        const bodyH = Math.max(1, yBot - yTop);
        return (
          <g key={i}>
            <line x1={cx} x2={cx} y1={yH} y2={yL} stroke={color} strokeWidth={1} />
            <rect x={cx - w / 2} y={yTop} width={w} height={bodyH} rx={0.8} fill={color} />
          </g>
        );
      })}
    </g>
  );
}

function TradeMarkersLayer({ xAxisMap, yAxisMap, width, height, offset, data, markers = [] }) {
  if (!yAxisMap || !Array.isArray(data) || !data.length || !markers.length) return null;
  const xAxis = xAxisMap ? Object.values(xAxisMap)[0] : null;
  const yAxis = Object.values(yAxisMap)[0];
  if (!yAxis || typeof yAxis.scale !== 'function') return null;
  const xScale = xAxis && typeof xAxis.scale === 'function' ? xAxis.scale : null;
  const yScale = yAxis.scale;
  const rows = data.filter((row) => Number.isFinite(Number(row?.t)) && Number.isFinite(Number(row?.main)));
  if (!rows.length) return null;
  const rowsMeta = rows.map((row) => ({
    t: Number(row.t),
    date: String(row.date || shanghaiDateFromEpochSec(row.t) || '')
  }));
  let minT = Infinity;
  let maxT = -Infinity;
  let minDate = '';
  let maxDate = '';
  rowsMeta.forEach((item) => {
    if (Number.isFinite(item.t)) {
      if (item.t < minT) minT = item.t;
      if (item.t > maxT) maxT = item.t;
    }
    if (item.date) {
      if (!minDate || item.date < minDate) minDate = item.date;
      if (!maxDate || item.date > maxDate) maxDate = item.date;
    }
  });
  const chartOffset = offset || {};
  const plotLeft = Number.isFinite(Number(chartOffset.left)) ? Number(chartOffset.left) : 0;
  const plotWidth = Number.isFinite(Number(chartOffset.width)) ? Number(chartOffset.width) : (Number(width) || 0);
  const yTop = Number.isFinite(Number(yAxis.y)) ? Number(yAxis.y) : (Number.isFinite(Number(chartOffset.top)) ? Number(chartOffset.top) : 0);
  const yHeight = Number.isFinite(Number(yAxis.height)) ? Number(yAxis.height) : (Number.isFinite(Number(height)) ? Number(height) : 0);
  const xFromIndex = (rowIndex) => {
    if (xScale) {
      const raw = xScale(rows[rowIndex]?.label);
      if (typeof raw === 'number' && Number.isFinite(raw)) {
        const bandwidth = typeof xScale.bandwidth === 'function' ? Number(xScale.bandwidth()) : 0;
        return raw + (Number.isFinite(bandwidth) ? bandwidth / 2 : 0);
      }
    }
    if (rows.length <= 1 || !(plotWidth > 0)) return plotLeft + plotWidth / 2;
    return plotLeft + (plotWidth * rowIndex) / (rows.length - 1);
  };
  return (
    <g pointerEvents="none">
      {markers.map((marker, index) => {
        const markerT = Number(marker.t);
        const markerDate = String(marker.date || shanghaiDateFromEpochSec(markerT) || '');
        const inTimeRange = Number.isFinite(markerT) && markerT >= minT && markerT <= maxT;
        const inDateRange = markerDate && minDate && maxDate && markerDate >= minDate && markerDate <= maxDate;
        if (!inTimeRange && !inDateRange) return null;
        let rowIndex = -1;
        if (Number.isFinite(markerT)) {
          let bestDiff = Infinity;
          rowsMeta.forEach((item, idx) => {
            if (!Number.isFinite(item.t)) return;
            const diff = Math.abs(item.t - markerT);
            if (diff < bestDiff) {
              bestDiff = diff;
              rowIndex = idx;
            }
          });
        }
        if (rowIndex < 0 && markerDate) {
          rowIndex = rowsMeta.findIndex((item) => item.date === markerDate);
        }
        if (rowIndex < 0) rowIndex = rows.length - 1;
        if (rowIndex > 0) {
          const prevGap = Math.abs(Number(rows[rowIndex - 1].t) - markerT);
          const nextGap = Math.abs(Number(rows[rowIndex].t) - markerT);
          if (prevGap < nextGap) rowIndex -= 1;
        }
        const row = rows[rowIndex];
        if (!row) return null;
        const cxRaw = xFromIndex(rowIndex);
        const markerPrice = Number(marker.price);
        const markerYValue = Number.isFinite(markerPrice) && markerPrice > 0 ? markerPrice : row.main;
        const cyRaw = yScale(markerYValue);
        if (typeof cxRaw !== 'number' || Number.isNaN(cxRaw) || typeof cyRaw !== 'number' || Number.isNaN(cyRaw)) return null;
        const isBuy = marker.type === 'BUY';
        const color = isBuy ? '#f6a623' : '#5b8def';
        const label = isBuy ? '买入' : '卖出';
        const bubbleW = 34;
        const bubbleH = 20;
        const bubbleX = Math.max(plotLeft + 2, Math.min(plotLeft + plotWidth - bubbleW - 2, cxRaw - bubbleW / 2));
        const rawBubbleY = isBuy ? cyRaw + 14 : cyRaw - bubbleH - 14;
        const bubbleY = Math.max(yTop + 4, Math.min(yTop + yHeight - bubbleH - 4, rawBubbleY));
        const pointerY = isBuy ? bubbleY : bubbleY + bubbleH;
        return (
          <g key={`${marker.id || marker.type}-${marker.date}-${index}`}>
            <line x1={cxRaw} y1={cyRaw} x2={cxRaw} y2={pointerY} stroke={color} strokeWidth={2} strokeLinecap="round" opacity={0.9} />
            <circle cx={cxRaw} cy={cyRaw} r={4.5} fill={color} stroke="white" strokeWidth={2} />
            <rect x={bubbleX} y={bubbleY} width={bubbleW} height={bubbleH} rx={4} fill={color} opacity={0.96} />
            <text x={bubbleX + bubbleW / 2} y={bubbleY + 14} textAnchor="middle" fontSize="12" fontWeight="700" fill="white">{label}</text>
          </g>
        );
      })}
    </g>
  );
}

function SymbolDetailChart({ candles, tf, chartType, indicators, compareSeries, compareMode = 'change', tone, symbol, tradeMarkers = [], onHover, onLeave, onLock, lockOnClick = false }) {
  const chartShellRef = useRef(null);
  const pointersRef = useRef(new Map());
  const pinchRef = useRef(null);
  const [zoomWindow, setZoomWindow] = useState(null);
  const cmpList = (compareSeries || []).filter((series) => Array.isArray(series.candles) && series.candles.length >= 2);
  const cmpSignature = JSON.stringify(cmpList.map((series) => ({
    symbol: series.symbol,
    length: series.candles.length,
    first: series.candles[0] && series.candles[0].t,
    last: series.candles[series.candles.length - 1] && series.candles[series.candles.length - 1].t
  })));
  const displayMainSymbol = formatSymbolDisplay(symbol);
  const hasCompare = cmpList.length > 0;
  const compareAsValue = hasCompare && compareMode === 'value';
  const normalized = hasCompare && !compareAsValue;
  const rows = useMemo(() => {
    const arr = Array.isArray(candles) ? candles : [];
    if (arr.length < 2) return [];
    const base = Number(arr[0].c) || 1;
    return arr.map((candle) => {
      const close = Number(candle.c);
      return {
        label: fmtChartLabel(candle.t, tf),
        t: Number(candle.t),
        o: Number(candle.o),
        h: Number(candle.h),
        l: Number(candle.l),
        c: close,
        main: normalized ? ((close / base) - 1) * 100 : close,
        mainPrice: close,
        mainBase: base,
        mainChange: close - base,
        mainChangePercent: base ? ((close / base) - 1) * 100 : null,
        mainNav: Number(candle.nav),
        mainIopv: Number(candle.iopv),
      };
    });
  }, [candles, tf, normalized]);
  const indicatorLines = useMemo(() => {
    if (normalized || !Array.isArray(candles) || candles.length === 0) return [];
    const closes = candles.map((candle) => Number(candle.c));
    const out = [];
    [['ma5', 5], ['ma10', 10], ['ma20', 20], ['ma60', 60]].forEach(([key, period]) => {
      if (indicators.has(key)) {
        out.push({ key, color: MA_COLORS[key], values: computeMA(closes, period), label: key.toUpperCase(), dashed: false });
      }
    });
    if (indicators.has('boll')) {
      const boll = computeBOLL(closes, 20, 2);
      out.push({ key: 'boll_upper', color: '#94a3b8', values: boll.upper, label: 'BOLL 上', dashed: true });
      out.push({ key: 'boll_mid', color: '#cbd5e1', values: boll.mid, label: 'BOLL 中', dashed: true });
      out.push({ key: 'boll_lower', color: '#94a3b8', values: boll.lower, label: 'BOLL 下', dashed: true });
    }
    return out;
  }, [candles, indicators, normalized]);
  const finalRows = useMemo(() => {
    const alignedCompare = cmpList.map((series) => {
      const candlesSorted = [...series.candles]
        .filter((candle) => Number.isFinite(Number(candle?.t)) && Number.isFinite(Number(candle?.c)))
        .sort((a, b) => Number(a.t) - Number(b.t));
      let cursor = 0;
      const values = rows.map((row) => {
        const rowT = Number(row.t);
        while (cursor + 1 < candlesSorted.length && Number(candlesSorted[cursor + 1].t) <= rowT) cursor += 1;
        const candle = candlesSorted[cursor];
        return candle && Number(candle.t) <= rowT ? candle : null;
      });
      return { values };
    });
    const commonBaseIndex = normalized
      ? rows.findIndex((row, index) => Number.isFinite(Number(row.c)) && alignedCompare.every((series) => Number.isFinite(Number(series.values[index]?.c))))
      : 0;
    const mainBase = Number(rows[Math.max(0, commonBaseIndex)]?.c) || 1;
    const compareBases = alignedCompare.map((series) => Number(series.values[Math.max(0, commonBaseIndex)]?.c) || 1);
    return rows.map((row, index) => {
      const out = { ...row };
      indicatorLines.forEach((line) => { out[line.key] = line.values[index]; });
      if (normalized) {
        if (commonBaseIndex >= 0 && index >= commonBaseIndex) {
          const close = Number(row.c);
          out.main = Number.isFinite(close) ? ((close / mainBase) - 1) * 100 : null;
          out.mainBase = mainBase;
          out.mainChange = Number.isFinite(close) ? close - mainBase : null;
          out.mainChangePercent = mainBase && Number.isFinite(close) ? ((close / mainBase) - 1) * 100 : null;
        } else {
          out.main = null;
          out.mainChange = null;
          out.mainChangePercent = null;
        }
      }
      alignedCompare.forEach((series, ci) => {
        const candle = series.values[index];
        const base = compareBases[ci];
        if (candle && Number.isFinite(Number(candle.c)) && (!normalized || (commonBaseIndex >= 0 && index >= commonBaseIndex))) {
          const close = Number(candle.c);
          out[`cmp_${ci}`] = compareAsValue ? close : ((close / base) - 1) * 100;
          out[`cmp_${ci}_price`] = close;
          out[`cmp_${ci}_base`] = base;
          out[`cmp_${ci}_change`] = close - base;
          out[`cmp_${ci}_changePercent`] = base ? ((close / base) - 1) * 100 : null;
          out[`cmp_${ci}_nav`] = Number(candle.nav);
          out[`cmp_${ci}_iopv`] = Number(candle.iopv);
        }
      });
      return out;
    });
  }, [rows, indicatorLines, cmpSignature, compareAsValue, normalized]);
  const finalRowsSignature = finalRows.length ? `${finalRows.length}|${finalRows[0].t}|${finalRows[finalRows.length - 1].t}` : 'empty';
  useEffect(() => {
    setZoomWindow(null);
    pointersRef.current.clear();
    pinchRef.current = null;
  }, [finalRowsSignature]);
  const clampZoomWindow = useCallback((start, end, total = finalRows.length) => {
    if (total < 2) return null;
    const minSpan = Math.min(total, Math.max(12, Math.ceil(total * 0.08)));
    let nextStart = Math.round(start);
    let nextEnd = Math.round(end);
    if (nextEnd - nextStart + 1 < minSpan) {
      const mid = (nextStart + nextEnd) / 2;
      nextStart = Math.round(mid - (minSpan - 1) / 2);
      nextEnd = nextStart + minSpan - 1;
    }
    if (nextStart < 0) {
      nextEnd -= nextStart;
      nextStart = 0;
    }
    if (nextEnd > total - 1) {
      nextStart -= nextEnd - (total - 1);
      nextEnd = total - 1;
    }
    nextStart = Math.max(0, nextStart);
    nextEnd = Math.min(total - 1, nextEnd);
    if (nextStart <= 0 && nextEnd >= total - 1) return null;
    return { start: nextStart, end: nextEnd };
  }, [finalRows.length]);
  const visibleRows = useMemo(() => {
    if (!zoomWindow || finalRows.length < 2) return finalRows;
    const start = Math.max(0, Math.min(finalRows.length - 1, zoomWindow.start));
    const end = Math.max(start + 1, Math.min(finalRows.length - 1, zoomWindow.end));
    return finalRows.slice(start, end + 1);
  }, [finalRows, zoomWindow]);

  if (finalRows.length < 2) {
    return <div className="flex h-full items-center justify-center text-sm text-[#5f6368]">暂无数据</div>;
  }
  const mainColor = normalized ? COMPARE_MAIN_COLOR : tone === 'up' ? CHART_UP : tone === 'down' ? CHART_DOWN : '#1a73e8';
  const showCandle = chartType === 'candle' && !normalized;
  const showArea = chartType === 'area' && !normalized;
  const showLine = normalized;
  const showBar = chartType === 'bar' && !normalized;
  const pickRowFromPointer = (event) => {
    const rect = chartShellRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || visibleRows.length < 2) return null;
    const x = Math.min(Math.max(event.clientX - rect.left, 0), rect.width);
    const index = Math.min(visibleRows.length - 1, Math.max(0, Math.round((x / rect.width) * (visibleRows.length - 1))));
    return visibleRows[index] || null;
  };
  const getChartPayload = (state) => {
    const index = Number.isInteger(state?.activeTooltipIndex) ? state.activeTooltipIndex : -1;
    return state?.activePayload?.[0]?.payload || (index >= 0 ? visibleRows[index] : null);
  };
  const handleChartPoint = (state) => {
    if (!onHover) return;
    const payload = getChartPayload(state);
    if (payload) onHover(payload);
  };
  const handlePointerMove = (event) => {
    if (!onHover) return;
    const payload = pickRowFromPointer(event);
    if (payload) onHover(payload);
  };
  const handleChartLeave = () => {
    if (onLeave) onLeave();
  };
  const handlePointerLock = (event) => {
    if (!lockOnClick || !onLock) return;
    const payload = pickRowFromPointer(event);
    if (payload) onLock(payload);
  };
  const handleChartLock = (state) => {
    if (!lockOnClick || !onLock) return;
    const payload = getChartPayload(state);
    if (payload) onLock(payload);
  };
  const getPointerDistance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const getPointerCenterX = (a, b) => (a.x + b.x) / 2;
  const handlePointerDown = (event) => {
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointersRef.current.size >= 2) {
      event.preventDefault();
      const [a, b] = Array.from(pointersRef.current.values()).slice(0, 2);
      const rect = chartShellRef.current?.getBoundingClientRect();
      const baseWindow = zoomWindow || { start: 0, end: finalRows.length - 1 };
      pinchRef.current = {
        distance: Math.max(1, getPointerDistance(a, b)),
        centerRatio: rect?.width ? Math.min(1, Math.max(0, (getPointerCenterX(a, b) - rect.left) / rect.width)) : 0.5,
        start: baseWindow.start,
        end: baseWindow.end
      };
      return;
    }
    handlePointerLock(event);
  };
  const handlePointerMoveZoom = (event) => {
    if (pointersRef.current.has(event.pointerId)) {
      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }
    if (pointersRef.current.size >= 2 && pinchRef.current) {
      event.preventDefault();
      const [a, b] = Array.from(pointersRef.current.values()).slice(0, 2);
      const distance = Math.max(1, getPointerDistance(a, b));
      const base = pinchRef.current;
      const baseSpan = Math.max(1, base.end - base.start + 1);
      const nextSpan = baseSpan / Math.max(0.25, Math.min(4, distance / base.distance));
      const anchor = base.start + base.centerRatio * (baseSpan - 1);
      const nextStart = anchor - base.centerRatio * (nextSpan - 1);
      const nextEnd = nextStart + nextSpan - 1;
      setZoomWindow(clampZoomWindow(nextStart, nextEnd));
      return;
    }
    handlePointerMove(event);
  };
  const handlePointerEnd = (event) => {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
  };
  const handleWheelZoom = (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const rect = chartShellRef.current?.getBoundingClientRect();
    const current = zoomWindow || { start: 0, end: finalRows.length - 1 };
    const ratio = rect?.width ? Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) : 0.5;
    const span = current.end - current.start + 1;
    const scale = event.deltaY < 0 ? 0.82 : 1.18;
    const nextSpan = span * scale;
    const anchor = current.start + ratio * (span - 1);
    const nextStart = anchor - ratio * (nextSpan - 1);
    setZoomWindow(clampZoomWindow(nextStart, nextStart + nextSpan - 1));
  };
  const handleDoubleClickReset = () => {
    setZoomWindow(null);
  };
  const legendPayload = normalized
    ? [
      { value: displayMainSymbol || '当前标的', type: 'line', color: mainColor, id: 'main' },
      ...cmpList.map((series, ci) => ({ value: formatSymbolDisplay(series.symbol), type: 'line', color: COMPARE_COLORS[ci % COMPARE_COLORS.length], id: `cmp_${ci}` }))
    ]
    : undefined;
  return (
    <div
      ref={chartShellRef}
      className="h-full w-full touch-none select-none outline-none [-webkit-tap-highlight-color:transparent] [&_*]:outline-none [&_.recharts-surface]:outline-none [&_.recharts-surface]:focus:outline-none [&_.recharts-wrapper]:outline-none"
      tabIndex={-1}
      onPointerMove={handlePointerMoveZoom}
      onPointerLeave={(event) => { handlePointerEnd(event); handleChartLeave(); }}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onWheel={handleWheelZoom}
      onDoubleClick={handleDoubleClickReset}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
        data={visibleRows}
        margin={{ top: 12, right: 12, left: 4, bottom: 8 }}
        onMouseMove={handleChartPoint}
        onMouseLeave={handleChartLeave}
        onClick={undefined}
      >
        <CartesianGrid stroke="rgba(17,24,39,0.09)" vertical strokeDasharray="0" />
        <XAxis dataKey="label" tick={{ fontSize: 12, fill: 'rgba(17,24,39,0.62)' }} minTickGap={40} axisLine={false} tickLine={false} />
        <YAxis
          tick={{ fontSize: 12, fill: 'rgba(17,24,39,0.62)' }}
          domain={['auto', 'auto']}
          width={44}
          axisLine={false}
          tickLine={false}
          tickFormatter={(value) => (normalized || compareAsValue) ? `${Number(value).toFixed(1)}%` : formatNumber(value, 2)}
        />
        <Tooltip
          cursor={false}
          content={({ label, payload }) => {
            const item = Array.isArray(payload) ? payload.find((entry) => entry && entry.dataKey === 'main') : null;
            const row = item && item.payload ? item.payload : null;
            const value = row ? row.main : null;
            const price = row ? Number(row.mainPrice ?? row.c ?? value) : NaN;
            const visibleBase = Number(visibleRows[0]?.mainPrice ?? visibleRows[0]?.c);
            const showValue = !normalized && value != null && Number.isFinite(Number(value));
            const rangePct = Number.isFinite(price) && Number.isFinite(visibleBase) && visibleBase > 0 ? ((price / visibleBase) - 1) * 100 : null;
            const isPremiumPoint = row && Object.prototype.hasOwnProperty.call(row, 'iopv');
            // If this tooltip is for premium data, only show time and premium percent labeled as "溢价%"
            if (isPremiumPoint) {
              return (
                <div className="rounded-xl bg-white/95 px-3 py-2 text-[13px] font-medium text-[#5f6368] shadow-[0_8px_24px_rgba(60,64,67,0.20)] ring-1 ring-black/5">
                  <div>{label}</div>
                  <div className="mt-0.5 tabular-nums text-[#1f1f1f]">{formatPercentNoPlus(value)}</div>
                </div>
              );
            }
            return (
              <div className="rounded-xl bg-white/95 px-3 py-2 text-[13px] font-medium text-[#5f6368] shadow-[0_8px_24px_rgba(60,64,67,0.20)] ring-1 ring-black/5">
                <div>{label}</div>
                {showValue ? <div className="mt-0.5 tabular-nums text-[#1f1f1f]">{formatNumber(value, 2)}</div> : null}
                {rangePct != null ? (
                  <div className={cx("mt-0.5 tabular-nums", rangePct > 0 ? "text-rose-600" : rangePct < 0 ? "text-emerald-600" : "text-[#5f6368]")}>{formatSignedPercent(rangePct)}</div>
                ) : null}
              </div>
            );
          }}
        />
        {showArea ? (
          <Area type="monotone" dataKey="main" name={displayMainSymbol || '当前标的'} stroke={mainColor} fill={mainColor} fillOpacity={0.12} dot={false} strokeWidth={3} isAnimationActive={false} />
        ) : null}
        {showLine ? (
          <Line type="monotone" dataKey="main" name={displayMainSymbol || '当前标的'} stroke={mainColor} dot={false} strokeWidth={3} isAnimationActive={false} />
        ) : null}
        {showBar ? (
          <Bar dataKey="main" name={displayMainSymbol || '当前标的'} fill={mainColor} fillOpacity={0.72} radius={[3, 3, 0, 0]} isAnimationActive={false} />
        ) : null}
        {showCandle ? (
          <Line type="monotone" dataKey="c" stroke="transparent" dot={false} activeDot={false} isAnimationActive={false} />
        ) : null}
        {showCandle ? (
          <Customized component={<CandlesLayerPanel data={visibleRows} />} />
        ) : null}
        {!hasCompare && tradeMarkers.length ? (
          <Customized component={<TradeMarkersLayer data={visibleRows} markers={tradeMarkers} />} />
        ) : null}
        {indicatorLines.map((line) => (
          <Line
            key={line.key}
            type="monotone"
            dataKey={line.key}
            name={line.label}
            stroke={line.color}
            strokeDasharray={line.dashed ? '3 3' : '0'}
            dot={false}
            strokeWidth={1}
            isAnimationActive={false}
          />
        ))}
        {cmpList.map((series, ci) => (
          <Line
            key={`cmp_${ci}`}
            type="monotone"
            dataKey={`cmp_${ci}`}
            name={formatSymbolDisplay(series.symbol)}
            stroke={COMPARE_COLORS[ci % COMPARE_COLORS.length]}
            dot={false}
            activeDot={false}
            strokeWidth={2.5}
            connectNulls
            isAnimationActive={false}
          />
        ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function ChartToolbarPopover({ label, icon, active, children, align = 'left', panelClassName = '', buttonClassName = '', fixedPanel = false }) {
  const [open, setOpen] = useState(false);
  const [panelStyle, setPanelStyle] = useState(null);
  const ref = useRef(null);
  const buttonRef = useRef(null);
  const updateFixedPanelPosition = useCallback(() => {
    if (!fixedPanel || !buttonRef.current || typeof window === 'undefined') return;
    const rect = buttonRef.current.getBoundingClientRect();
    const width = Math.min(360, Math.max(0, window.innerWidth - 16));
    const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - width - 8));
    setPanelStyle({ left, top: rect.bottom + 6, width });
  }, [fixedPanel]);
  useEffect(() => {
    if (!open) return undefined;
    updateFixedPanelPosition();
    function onDown(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    if (fixedPanel) {
      window.addEventListener('resize', updateFixedPanelPosition);
      window.addEventListener('scroll', updateFixedPanelPosition, true);
    }
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      if (fixedPanel) {
        window.removeEventListener('resize', updateFixedPanelPosition);
        window.removeEventListener('scroll', updateFixedPanelPosition, true);
      }
    };
  }, [open, fixedPanel, updateFixedPanelPosition]);
  return (
    <div ref={ref} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cx(
          'inline-flex h-8 items-center gap-1 rounded-[11px] px-2 text-[12px] font-semibold text-[#202124] transition hover:bg-white/70 sm:h-9 sm:gap-1.5 sm:px-2.5 sm:text-[13px]',
          active ? 'border border-[rgba(17,24,39,0.08)] bg-white/60 shadow-[0_2px_8px_rgba(0,0,0,0.06)]' : 'border border-transparent bg-transparent',
          buttonClassName
        )}
      >
        {icon ? <span className="text-[13px] leading-none text-[#202124] sm:text-[14px]" aria-hidden="true">{icon}</span> : null}
        <span>{label}</span>
        <ChevronDown size={12} className={cx('transition', open ? 'rotate-180' : '')} />
      </button>
      {open ? (
        <div
          className={cx(
            fixedPanel
              ? 'fixed z-50 min-w-[190px] rounded-[14px] border border-[rgba(17,24,39,0.08)] bg-white p-1.5 shadow-[0_6px_18px_rgba(0,0,0,0.10)]'
              : 'absolute z-30 mt-1 min-w-[190px] rounded-[14px] border border-[rgba(17,24,39,0.08)] bg-white p-1.5 shadow-[0_6px_18px_rgba(0,0,0,0.10)]',
            panelClassName,
            !fixedPanel && (align === 'right' ? 'right-0' : 'left-0')
          )}
          style={fixedPanel && panelStyle ? panelStyle : undefined}
        >
          {typeof children === 'function' ? children({ close: () => setOpen(false) }) : children}
        </div>
      ) : null}
    </div>
  );
}



const FINANCIAL_TABS = [
  { key: 'income', label: '损益表' },
  { key: 'balance', label: '资产负债表' },
  { key: 'cashflow', label: '现金流量' },
];
const FINANCIAL_PERIODS = [
  { key: 'quarterly', label: '季度' },
  { key: 'annual', label: '年度' },
];
const FINANCIAL_CHART_MARGIN = { top: 8, right: 8, bottom: 0, left: 0 };
const FINANCIAL_AXIS_TICK = { fontSize: 11, fill: '#5f6368' };
const FINANCIAL_TOOLTIP_STYLE = { borderRadius: 10, borderColor: '#e8eaed', boxShadow: 'none' };
const FINANCIAL_FIELDS = {
  income: [
    ['totalRevenue', '收入'],
    ['grossProfit', '毛利润'],
    ['operatingIncome', '营业利润'],
    ['netIncome', '净利润'],
  ],
  balance: [
    ['totalAssets', '总资产'],
    ['totalLiab', '总负债'],
    ['totalStockholderEquity', '股东权益'],
    ['cash', '现金'],
  ],
  cashflow: [
    ['totalCashFromOperatingActivities', '经营现金流'],
    ['capitalExpenditures', '资本开支'],
    ['freeCashFlow', '自由现金流'],
    ['changeInCash', '现金净变化'],
  ],
};
function financialFieldLabel(key) {
  const all = Object.values(FINANCIAL_FIELDS).flat();
  return (all.find(([k]) => k === key) || [key, key])[1];
}
function financialValue(row, key) {
  if (!row || !row.fields) return null;
  if (key === 'freeCashFlow') {
    const op = Number(row.fields.totalCashFromOperatingActivities);
    const capex = Number(row.fields.capitalExpenditures);
    return Number.isFinite(op) && Number.isFinite(capex) ? op + capex : null;
  }
  const n = Number(row.fields[key]);
  return Number.isFinite(n) ? n : null;
}
function formatFinancialCompact(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '--';
  const abs = Math.abs(n);
  if (abs >= 1e12) return (n / 1e12).toFixed(2) + 'T';
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  return formatNumber(n, 0);
}
function FinancialsPanel({ financials, loading }) {
  const [statement, setStatement] = useState('income');
  const [period, setPeriod] = useState('quarterly');
  const rows = useMemo(() => {
    const raw = financials?.statements?.[statement]?.[period];
    return (Array.isArray(raw) ? raw : []).slice().sort((a, b) => Number(a.endDate || 0) - Number(b.endDate || 0)).slice(-6);
  }, [financials, statement, period]);
  const fields = FINANCIAL_FIELDS[statement] || [];
  const chartRows = rows.map((row) => {
    const out = { period: row.period?.slice(0, 7) || row.period };
    fields.slice(0, 3).forEach(([key]) => { out[key] = financialValue(row, key); });
    return out;
  });
  if (loading) {
    return (
      <div className="space-y-3">
        <div className="h-8 w-64 animate-pulse rounded-lg bg-[#f1f3f4]" />
        <div className="h-52 animate-pulse rounded-xl bg-[#f1f3f4]" />
        <div className="h-36 animate-pulse rounded-xl bg-[#f1f3f4]" />
      </div>
    );
  }
  if (!rows.length) {
    return <div className="rounded-xl border border-[#e8eaed] bg-[#f8fafd] px-4 py-6 text-sm text-[#5f6368]">暂无财务报表数据。</div>;
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-full bg-[#f1f3f4] p-1">
          {FINANCIAL_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setStatement(tab.key)}
              className={cx('rounded-full px-3 py-1 text-[13px] font-medium transition', statement === tab.key ? 'bg-white text-[#1f1f1f] shadow-[0_1px_2px_rgba(60,64,67,0.12)]' : 'text-[#5f6368] hover:text-[#1f1f1f]')}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex rounded-full border border-[#dadce0] bg-white p-0.5">
          {FINANCIAL_PERIODS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setPeriod(tab.key)}
              className={cx('rounded-full px-3 py-1 text-[12px] font-medium transition', period === tab.key ? 'bg-[#e8f0fe] text-[#1a73e8]' : 'text-[#5f6368] hover:bg-[#f1f3f4]')}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      <div className="h-56 rounded-xl border border-[#e8eaed] bg-white p-3">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartRows} margin={FINANCIAL_CHART_MARGIN}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f3f4" vertical={false} />
            <XAxis dataKey="period" tick={FINANCIAL_AXIS_TICK} />
            <YAxis tickFormatter={formatFinancialCompact} tick={FINANCIAL_AXIS_TICK} width={48} />
            <Tooltip formatter={(v, name) => [formatFinancialCompact(v), financialFieldLabel(name)]} contentStyle={FINANCIAL_TOOLTIP_STYLE} />
            {fields.slice(0, 3).map(([key], idx) => (
              <Bar key={key} dataKey={key} fill={['#1a73e8', '#34a853', '#f9ab00'][idx % 3]} radius={[4, 4, 0, 0]} />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="overflow-x-auto rounded-xl border border-[#e8eaed] bg-white">
        <table className="min-w-[720px] w-full border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-10 bg-[#f8fafd] text-[12px] text-[#5f6368]">
            <tr>
              <th className="sticky left-0 z-20 border-b border-[#e8eaed] bg-[#f8fafd] px-3 py-2 text-left font-medium">指标</th>
              {rows.map((row) => <th key={row.period} className="border-b border-[#e8eaed] px-3 py-2 text-right font-medium tabular-nums">{row.period}</th>)}
            </tr>
          </thead>
          <tbody>
            {fields.map(([key, label]) => (
              <tr key={key} className="hover:bg-[#f8fafd]">
                <td className="sticky left-0 border-b border-[#f1f3f4] bg-white px-3 py-2 font-medium text-[#1f1f1f]">{label}</td>
                {rows.map((row) => <td key={row.period} className="border-b border-[#f1f3f4] px-3 py-2 text-right tabular-nums text-[#1f1f1f]">{formatFinancialCompact(financialValue(row, key))}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function NavInsightCard({ premiumState }) {
  const data = premiumState && premiumState.data;
  if (premiumState?.loading && !data) {
    return (
      <div className="mt-3 rounded-xl border border-[#e8eaed] bg-[#f8fafd] p-3 text-sm text-[#5f6368]">
        <div className="flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> 正在获取净值…</div>
      </div>
    );
  }
  if (premiumState?.error) {
    return (
      <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
        净值暂不可用：{premiumState.error}
      </div>
    );
  }
  if (!data) return null;
  return (
    <div className="mt-3 rounded-xl border border-[#e8eaed] bg-[#f8fafd] p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[12px] font-medium text-[#5f6368]">上一工作日净值</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-[#1f1f1f]">{formatNumber(data.baseNav, 4)}</div>
          {data.navDate ? <div className="mt-1 text-[11px] text-[#9aa0a6]">确认日期 {data.navDate}</div> : null}
        </div>
        <div className="text-right text-[12px] leading-5 text-[#5f6368]">
          <div>场内价格 <span className="font-medium tabular-nums text-[#1f1f1f]">{formatNumber(data.price, 4)}</span></div>
          <div>最新 IOPV <span className="font-medium tabular-nums text-[#1f1f1f]">{formatNumber(data.iopv, 4)}</span></div>
          <div>最新溢价 <span className={cx('font-medium tabular-nums', Number(data.premiumPercent) > 0 ? 'text-[#a50e0e]' : Number(data.premiumPercent) < 0 ? 'text-[#137333]' : 'text-[#1f1f1f]')}>{formatSignedPercent(data.premiumPercent)}</span></div>
        </div>
      </div>
      <p className="mt-2 text-[11px] leading-4 text-[#9aa0a6]">净值取基金最新确认 NAV，场内基金盘中交易仍以价格为准。</p>
    </div>
  );
}


function CnFundFlowPanel({ fundData, loading }) {
  if (loading) return <div className="h-40 animate-pulse rounded-xl bg-[#f1f3f4]" />;
  const flow = getXueqiuPayload(fundData, 'capital_flow');
  const history = getXueqiuPayload(fundData, 'capital_history');
  const pankou = getXueqiuPayload(fundData, 'pankou');
  const latestFlow = Array.isArray(flow?.items) && flow.items.length ? flow.items[flow.items.length - 1] : null;
  const bidAskRows = [1, 2, 3, 4, 5].map((level) => ({
    level,
    bidPrice: pankou?.[`bp${level}`],
    bidVolume: pankou?.[`bc${level}`],
    askPrice: pankou?.[`sp${level}`],
    askVolume: pankou?.[`sc${level}`]
  }));
  if (!flow && !history && !pankou) return <div className="rounded-xl border border-[#e8eaed] bg-[#f8fafd] px-4 py-6 text-sm text-[#5f6368]">暂无资金和盘口数据。</div>;
  return (
    <div className="space-y-5">
      <div className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex items-center justify-between border-b border-[#e8eaed] py-2"><span className="text-[#5f6368]">最新资金流</span><span className="font-medium tabular-nums text-[#1f1f1f]">{formatCnMoney(latestFlow?.amount)}</span></div>
        <div className="flex items-center justify-between border-b border-[#e8eaed] py-2"><span className="text-[#5f6368]">3日净流入</span><span className="font-medium tabular-nums text-[#1f1f1f]">{formatCnMoney(history?.sum3)}</span></div>
        <div className="flex items-center justify-between border-b border-[#e8eaed] py-2"><span className="text-[#5f6368]">5日净流入</span><span className="font-medium tabular-nums text-[#1f1f1f]">{formatCnMoney(history?.sum5)}</span></div>
        <div className="flex items-center justify-between border-b border-[#e8eaed] py-2"><span className="text-[#5f6368]">20日净流入</span><span className="font-medium tabular-nums text-[#1f1f1f]">{formatCnMoney(history?.sum20)}</span></div>
      </div>
      <div className="overflow-hidden rounded-xl border border-[#e8eaed] bg-white">
        <div className="border-b border-[#e8eaed] bg-[#f8fafd] px-3 py-2 text-sm font-semibold text-[#1f1f1f]">盘口</div>
        <div className="grid grid-cols-5 gap-0 text-right text-[12px] sm:text-sm">
          <div className="px-2 py-2 text-left font-medium text-[#5f6368]">档位</div><div className="px-2 py-2 font-medium text-[#5f6368]">买价</div><div className="px-2 py-2 font-medium text-[#5f6368]">买量</div><div className="px-2 py-2 font-medium text-[#5f6368]">卖价</div><div className="px-2 py-2 font-medium text-[#5f6368]">卖量</div>
          {bidAskRows.map((it) => (
            <div key={it.level} className="contents">
              <div className="border-t border-[#f1f3f4] px-2 py-2 text-left text-[#5f6368]">{it.level}档</div>
              <div className="border-t border-[#f1f3f4] px-2 py-2 tabular-nums text-[#1f1f1f]">{formatNumber(it.bidPrice, 3)}</div>
              <div className="border-t border-[#f1f3f4] px-2 py-2 tabular-nums text-[#1f1f1f]">{formatCnAmount(it.bidVolume)}</div>
              <div className="border-t border-[#f1f3f4] px-2 py-2 tabular-nums text-[#1f1f1f]">{formatNumber(it.askPrice, 3)}</div>
              <div className="border-t border-[#f1f3f4] px-2 py-2 tabular-nums text-[#1f1f1f]">{formatCnAmount(it.askVolume)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CnFundReportPanel({ fundData, loading }) {
  if (loading) return <div className="h-40 animate-pulse rounded-xl bg-[#f1f3f4]" />;
  const indicator = getLatestFinanceRow(fundData, 'finance_indicator');
  const balance = getLatestFinanceRow(fundData, 'finance_balance');
  const income = getLatestFinanceRow(fundData, 'finance_income');
  const cashflow = getLatestFinanceRow(fundData, 'finance_cash_flow');
  const reportName = indicator?.report_name || balance?.report_name || income?.report_name || cashflow?.report_name || '';
  const rows = [
    detailValueRow('报告期', reportName || '--'),
    detailValueRow('总资产', formatCnMoney(firstPairValue(balance?.total_assets))),
    detailValueRow('总负债', formatCnMoney(firstPairValue(balance?.total_liab))),
    detailValueRow('资产负债率', Number.isFinite(Number(firstPairValue(indicator?.asset_liab_ratio))) ? `${formatNumber(firstPairValue(indicator?.asset_liab_ratio), 2)}%` : '--'),
    detailValueRow('营收', formatCnMoney(firstPairValue(income?.revenue))),
    detailValueRow('营收同比', Number.isFinite(Number(firstPairValue(indicator?.operating_income_yoy))) ? `${formatNumber(firstPairValue(indicator?.operating_income_yoy), 2)}%` : '--'),
    detailValueRow('净利润', formatCnMoney(firstPairValue(income?.net_profit))),
    detailValueRow('综合收益', formatCnMoney(firstPairValue(income?.total_compre_income))),
    detailValueRow('经营现金流', formatCnMoney(firstPairValue(cashflow?.ncf_from_oa))),
    detailValueRow('总资本周转', formatNumber(firstPairValue(indicator?.total_capital_turnover), 4)),
  ];
  if (!indicator && !balance && !income && !cashflow) return <div className="rounded-xl border border-[#e8eaed] bg-[#f8fafd] px-4 py-6 text-sm text-[#5f6368]">暂无基金年报数据。</div>;
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-[#e8eaed] bg-[#f8fafd] px-3 py-2 text-[12px] text-[#5f6368]">雪球返回的是基金年报口径数据，不是普通股票财报。</div>
      <div className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        {rows.map((item) => (
          <div key={item.label} className="flex items-center justify-between border-b border-[#e8eaed] py-2">
            <span className="text-[#5f6368]">{item.label}</span>
            <span className="font-medium tabular-nums text-[#1f1f1f]">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SymbolDetailPanel({
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
  chartTf,
  chartLoading,
  inWatch,
  onToggleWatch,
  premiumState,
  navHistoryState,
  isMobile = false,
  tradeMarkers = [],
}) {
  const [chartType, setChartType] = useState('area');
  const [cnFundParam, setCnFundParam] = useState('price');
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
  // 当前 symbol 或时间范围切换时清空对比
  useEffect(() => { setCompareSymbols([]); setHoveredChartRow(null); setLockedChartRow(null); }, [rowSymbol]);
  useEffect(() => { setHoveredChartRow(null); setLockedChartRow(null); }, [chartRange, cnFundParam]);
  useEffect(() => { if (market !== 'cn') setCnFundParam('price'); }, [market]);
  useEffect(() => {
    if (market === 'cn' && cnFundParam !== 'price' && chartType !== 'area') setChartType('area');
  }, [market, cnFundParam, chartType]);
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
  }, [compareSymbols, chartTf, compareCandlesMap, compareLoadingMap, compareErrorMap]);
  useEffect(() => {
    if (market !== 'cn' || cnFundParam === 'price' || !compareSymbols.length) return;
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
  }, [market, cnFundParam, compareSymbols, chartRange, compareNavHistoryMap]);
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
  const isCnOtcFund = market === 'cn' && isCnOtcFundQuote(row);
  const xueqiuQuote = getXueqiuQuote(xueqiuFundData);
  const cnOverviewExtras = market === 'cn' && !isCnOtcFund ? [
    detailValueRow('开盘价', formatNumber(row.open ?? xueqiuQuote?.open, 3)),
    detailValueRow('市值', formatCnMoney(row.marketCapital ?? row.marketCap ?? xueqiuQuote?.market_capital)),
    detailValueRow('52 周最高价', formatNumber(xueqiuQuote?.high52w, 3)),
    detailValueRow('最高价', formatNumber(row.high ?? xueqiuQuote?.high, 3)),
    detailValueRow('平均成交量', formatCnAmount(xueqiuQuote?.avg_volume ?? xueqiuQuote?.avg_volume10 ?? xueqiuQuote?.avg_volume_10)),
    detailValueRow('52 周最低价', formatNumber(xueqiuQuote?.low52w, 3)),
    detailValueRow('最低价', formatNumber(row.low ?? xueqiuQuote?.low, 3)),
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
    detailValueRow(isCnOtcFund ? '最新净值' : '最新价', formatNumber(row.price)),
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
  useEffect(() => {
    const symbols = Array.from(new Set([
      ...compareSearchCandidates.map((item) => item.symbol),
      ...compareSymbols
    ].map((sym) => String(sym || '').toUpperCase()).filter(Boolean)));
    const missing = symbols.filter((sym) => sym !== String(row?.symbol || '').toUpperCase() && !compareQuoteMap[sym]);
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
  }, [compareSearchCandidateKey, compareSymbolKey, compareQuoteMap, row?.symbol]);
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
    const v = String(raw || '').trim().toUpperCase();
    if (!v) return;
    if (compareSymbols.includes(v) || v === String(row && row.symbol || '').toUpperCase()) {
      setCompareInput('');
      return;
    }
    if (compareSymbols.length >= 3) return;
    setCompareSymbols((prev) => [...prev, v]);
    setCompareInput('');
  };
  const addCompare = () => addCompareSymbol(compareInput);
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
    const compareNavItems = compareNavHistoryMap[compareNavKey]?.items;
    const candles = market === 'cn' && cnFundParam !== 'price'
      ? buildCnFundParamCandles(priceCandles, compareNavItems, cnFundParam, premiumState, chartRange)
      : priceCandles;
    return {
      symbol: sym,
      candles
    };
  });
  const comparePendingSymbols = compareSymbols.filter((sym) => {
    if (compareLoadingMap[`${sym}|${chartTf}`]) return true;
    if (market !== 'cn' || cnFundParam === 'price') return false;
    const code = normalizeCnFundCode(sym);
    return Boolean(compareNavHistoryMap[`${code}|${navHistoryDaysForRange(chartRange)}`]?.loading);
  });
  const compareReadyCount = compareSeries.filter((s) => Array.isArray(s.candles) && s.candles.length >= 2).length;
  const activeCursorRow = lockedChartRow || hoveredChartRow;
  const activeCursorTime = activeCursorRow?.t ?? null;
  const activeCursorLabel = activeCursorTime ? activeCursorRow?.label : '';
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
  const effectiveChartType = market === 'cn' && cnFundParam !== 'price' ? 'area' : chartType;
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
              <span className="text-[28px] font-medium leading-none tabular-nums text-[#1f1f1f] sm:text-[32px]">{formatNumber(row.price)}</span>
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
                        onClick={() => addCompareSymbol(item.symbol)}
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
                const loading = compareLoadingMap[`${item.symbol}|${chartTf}`];
                const failed = compareErrorMap[`${item.symbol}|${chartTf}`];
                return (
                  <span
                    key={item.symbol}
                    className="inline-flex h-7 items-center gap-1.5 rounded-2xl border border-[rgba(17,24,39,0.08)] bg-[#f8fafd]/95 py-0.5 pl-2.5 pr-1 font-semibold shadow-[0_2px_8px_rgba(0,0,0,0.06)] sm:h-8 sm:gap-2 sm:pl-3.5 sm:pr-1.5"
                    style={{ color: markerColor }}
                  >
                    <span className="size-2 shrink-0 rounded-full" style={{ background: markerColor }} />
                    <span className="min-w-0 truncate">{formatSymbolDisplay(item.symbol)}{loading ? ' 加载中' : failed ? ' 无数据' : ready ? '' : ' 等待'}</span>
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
function MarketsResearchPanel({ market, mode, onModeChange, watchSymbols = [], watchQuotes = {}, selectedSymbol = '', selectedQuote = null, pendingAnalysis = null, onAnalysisConsumed }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const [searchDepth, setSearchDepth] = useState('fast');
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const displaySelectedSymbol = formatSymbolDisplay(selectedSymbol);

  const send = useCallback(
    async (raw, opts = {}) => {
      const question = String(raw || '').trim();
      if (!question || pending) return;
      const useDepth = opts.depth === 'deep' ? 'deep' : opts.depth === 'fast' ? 'fast' : searchDepth;
      const focusContext = displaySelectedSymbol ? `当前标的：${displaySelectedSymbol}${selectedQuote?.name ? ` / ${selectedQuote.name}` : ''}；价格 ${formatNumber(selectedQuote?.price)} ${formatPercent(selectedQuote?.changePercent)}。` : '';
      const useContext = [focusContext, typeof opts.context === 'string' ? opts.context : ''].filter(Boolean).join('\n');
      setInput('');
      onModeChange?.('conversation');
      setMessages((prev) => [
        ...prev,
        { role: 'user', content: question, depth: useDepth, ts: Date.now() },
        { role: 'assistant', content: '', pending: true },
      ]);
      setPending(true);
      try {
        const wl = loadWatchlist() || {};
        const focusSymbol = String(selectedSymbol || '').trim();
        const listSymbols = Array.isArray(wl[market]) ? wl[market] : [];
        const symbols = Array.from(new Set([focusSymbol, ...listSymbols].filter(Boolean))).slice(0, 10);
        if (useDepth === 'deep') {
          // 深度模式走 SSE 流式 agent，可实时拉取工具调用 / token / sources。
          let streamed = '';
          const streamedSources = [];
          const seenSourceUrls = new Set();
          let stage = '深度搜索启动中…';
          const renderPending = () => {
            setMessages((prev) => {
              const next = prev.slice();
              const last = next[next.length - 1];
              if (!last || !last.pending) return prev;
              next[next.length - 1] = {
                ...last,
                content: streamed,
                stage,
                sources: streamedSources.slice(),
              };
              return next;
            });
          };
          const onEvent = ({ type, payload }) => {
            if (type === 'token' && payload && typeof payload.delta === 'string') {
              streamed += payload.delta;
              renderPending();
            } else if (type === 'progress' && payload && typeof payload.message === 'string') {
              stage = payload.message;
              renderPending();
            } else if (type === 'tool_start' && payload && typeof payload.name === 'string') {
              stage = '调用工具：' + payload.name;
              renderPending();
            } else if (type === 'source' && payload && payload.url) {
              if (!seenSourceUrls.has(payload.url)) {
                seenSourceUrls.add(payload.url);
                streamedSources.push(payload);
                renderPending();
              }
            } else if (type === 'started') {
              stage = '已启动深度模式…';
              renderPending();
            }
          };
          const done = await askMarketsStream({
            question,
            symbols,
            depth: 'deep',
            context: useContext,
            onEvent,
          });
          const finalAnswer = (done && done.answer) || streamed || '抱歉，未获取到回答。';
          const finalSources = (done && Array.isArray(done.sources) && done.sources.length)
            ? done.sources
            : streamedSources;
          setMessages((prev) => {
            const next = prev.slice(0, -1);
            return [...next, { role: 'assistant', content: finalAnswer, sources: finalSources, depth: 'deep' }];
          });
        } else {
          const res = await askMarkets({ question, symbols, depth: 'fast', context: useContext });
          const answer = (res && (res.answer || res.text)) || '抱歉，未获取到回答。';
          const sources = (res && Array.isArray(res.sources)) ? res.sources : [];
          setMessages((prev) => {
            const next = prev.slice(0, -1);
            return [...next, { role: 'assistant', content: answer, sources }];
          });
        }
      } catch (err) {
        const msg = (err && err.message) ? err.message : String(err);
        setMessages((prev) => {
          const next = prev.slice(0, -1);
          return [...next, { role: 'assistant', content: '请求失败：' + msg, error: true }];
        });
      } finally {
        setPending(false);
      }
    },
    [market, pending, onModeChange, displaySelectedSymbol, selectedSymbol, selectedQuote, searchDepth],
  );

  const onSubmit = useCallback(
    (e) => {
      if (e && e.preventDefault) e.preventDefault();
      send(input);
    },
    [input, send],
  );

  // 外部（侧边自选行）点击「AI 分析」时会设置 pendingAnalysis，
  // 这里接收后拼金渐成 prompt、深度模式发送，并通知父级清除标记。
  useEffect(() => {
    if (!pendingAnalysis || !pendingAnalysis.symbol) return;
    if (pending) return; // 上一轮还在跑，等它结束后下个 effect cycle 再试
    const prompt = buildStockAnalysisPrompt({
      symbol: pendingAnalysis.symbol,
      name: pendingAnalysis.name,
      market,
    });
    if (prompt) {
      send(prompt, { depth: 'deep' });
    }
    onAnalysisConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAnalysis]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && messages.length > 0) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // 主题探索按钮触发：在右栏以深度模式自动提问。面板默认仍是快速，此次问答后并不锁定深度。
  useEffect(() => {
    const onResearch = (event) => {
      const detail = event && event.detail ? event.detail : {};
      const q = String(detail.question || '').trim();
      if (!q) return;
      send(q, { depth: 'deep', context: detail.context || '' });
    };
    window.addEventListener('markets:research', onResearch);
    return () => window.removeEventListener('markets:research', onResearch);
  }, [send]);

  // focus input on conversation open
  useEffect(() => {
    if ((mode === 'conversation' || mode === 'search') && inputRef.current) {
      const t = setTimeout(() => inputRef.current?.focus(), 300);
      return () => clearTimeout(t);
    }
  }, [mode]);

  const fmtTime = (ts) => {
    if (!ts) return '';
    try { return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }); }
    catch { return ''; }
  };

  const mdComponents = useMemo(() => ({
    a: ({ node, ...props }) => (
      <a {...props} target="_blank" rel="noreferrer noopener" />
    ),
    code: ({ inline, className, children, ...props }) => {
      const match = /^language-(\w+)/.exec(className || '');
      const lang = match ? match[1].toLowerCase() : '';
      const text = String(children || '').replace(/\n$/, '');
      if (!inline && (lang === 'kline' || lang === 'candle' || lang === 'candlestick' || lang === 'chart' || lang === 'linechart')) {
        const rendered = <MarketsChartCodeBlock lang={lang} value={text} />;
        if (rendered) return rendered;
      }
      return <code className={className} {...props}>{children}</code>;
    },
  }), []);


  const conversationUI = (
    <>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
        {messages.length === 0 ? (
          <div className="flex flex-col gap-5 pb-2">
            {selectedSymbol ? (
              <div className="rounded-xl border border-[#e8eaed] bg-[#f8fafd] px-4 py-3">
                <div className="text-[12px] font-medium text-[#5f6368]">当前研究标的</div>
                <div className="mt-1 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-[16px] font-semibold text-[#1f1f1f]">{displaySelectedSymbol}</div>
                    {selectedQuote?.name ? <div className="truncate text-[12px] text-[#5f6368]">{selectedQuote.name}</div> : null}
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-[14px] font-medium tabular-nums text-[#1f1f1f]">{formatNumber(selectedQuote?.price)}</div>
                    <div className={cx('text-[12px] font-medium tabular-nums', Number(selectedQuote?.changePercent) > 0 ? 'text-[#a50e0e]' : Number(selectedQuote?.changePercent) < 0 ? 'text-[#137333]' : 'text-[#5f6368]')}>
                      {formatPercent(selectedQuote?.changePercent)}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
            <div>
              <p className="text-[18px] font-medium leading-snug text-[#1f1f1f]">您好！试试以下常见问题，或直接输入您的问题</p>
            </div>
            <div className="flex flex-col gap-2">
              {(selectedSymbol ? [
                `${displaySelectedSymbol} 最新行情怎么看？`,
                `${displaySelectedSymbol} 最近有哪些关键变化？`,
                `${displaySelectedSymbol} 和我的监控列表相比表现如何？`,
              ] : [
                '今日市场行情如何？',
                '哪些板块涨幅居前？',
                '我的监控列表近期有哪些关键变化？',
              ]).map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => send(q, { depth: searchDepth })}
                  disabled={pending}
                  title="点击提问"
                  className="group flex w-full items-center justify-between gap-3 rounded-xl border border-[#e8eaed] bg-white px-4 py-3 text-left text-[14px] text-[#1f1f1f] transition hover:border-[#d2e3fc] hover:bg-[#f8fafd] disabled:opacity-60 disabled:hover:border-[#e8eaed] disabled:hover:bg-white"
                >
                  <span className="flex-1">{q}</span>
                  <Send size={16} className="shrink-0 text-slate-400 transition group-hover:text-indigo-600" />
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {messages.map((m, i) => (
              <div key={i}>
                {m.role === 'user' ? (
                  <div className="flex flex-col items-end gap-1">
                    <div className="max-w-[85%] rounded-2xl bg-[#f1f3f4] px-4 py-2.5 text-[14px] leading-relaxed text-[#1f1f1f]">
                      {m.content}
                    </div>
                    {m.ts ? <span className="text-[11px] text-[#9aa0a6]">{fmtTime(m.ts)}</span> : null}
                  </div>
                ) : (
                  <div className="flex flex-col gap-1">
                    {m.pending ? (
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-1.5 text-[14px] text-[#5f6368]">
                          <Loader2 size={14} className="animate-spin" />
                          <span>{m.stage || '正在思考…'}</span>
                        </div>
                        {m.content ? (
                          <div className="ai-chat-md text-[14px] leading-relaxed text-[#1f1f1f]">
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm]}
                              components={mdComponents}
                            >
                              {m.content}
                            </ReactMarkdown>
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      m.error ? (
                        <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-rose-600">{m.content}</p>
                      ) : (
                        <div className="ai-chat-md text-[14px] leading-relaxed text-[#1f1f1f]">
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={mdComponents}
                          >
                            {m.content || ''}
                          </ReactMarkdown>
                        </div>
                      )
                    )}
                    {!m.pending && Array.isArray(m.sources) && m.sources.length > 0 ? (
                      <ul className="mt-1 flex flex-col gap-0.5">
                        {m.sources.slice(0, 3).map((s, si) => (
                          <li key={si}>
                            <a href={s.url} target="_blank" rel="noreferrer" className="text-[11px] text-[#1a73e8] hover:underline">
                              {s.title || s.url}
                            </a>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="mx-3 mt-1 flex items-center gap-2">
        {[{ key: 'fast', label: '普通' }, { key: 'deep', label: '深度' }].map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setSearchDepth(item.key)}
            className={cx('rounded-full px-3 py-1 text-[12px] font-medium transition', searchDepth === item.key ? 'bg-[#e8f0fe] text-[#1a73e8]' : 'bg-[#f1f3f4] text-[#5f6368] hover:text-[#1f1f1f]')}
          >
            {item.label}
          </button>
        ))}
        {selectedSymbol ? <span className="ml-auto truncate text-[11px] text-[#5f6368]">已注入 {displaySelectedSymbol}</span> : null}
      </div>
      <form onSubmit={onSubmit} className="mx-3 mb-3 mt-2 flex h-12 items-center gap-2 rounded-full bg-[#f1f3f4] px-3">
        <button type="button" aria-label="添加上下文或附件" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#5f6368] hover:bg-[#e8eaed]">
          <Plus size={16} />
        </button>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
          placeholder="搜索或提问"
          className="flex-1 bg-transparent text-[14px] text-[#1f1f1f] placeholder:text-[#5f6368] focus:outline-none"
          disabled={pending}
        />
        <button
          type="submit"
          aria-label="发送"
          disabled={pending || !input.trim()}
          className={cx(
            'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition',
            !input.trim() || pending ? 'text-[#9aa0a6]' : 'bg-[#1a73e8] text-white hover:bg-[#1557b0]',
          )}
        >
          {pending ? <Loader2 size={13} className="animate-spin" /> : <ArrowUp size={13} />}
        </button>
      </form>
    </>
  );

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-white lg:h-full lg:min-h-0 lg:rounded-2xl lg:border lg:border-slate-200">
      {pending && (
        <div className="relative h-0.5 w-full shrink-0 overflow-hidden bg-[#e8f0fe]">
          <div className="gf-progress-bar absolute inset-y-0 left-0 bg-[#1a73e8]" />
        </div>
      )}
      <div className="flex items-center justify-between border-b border-[#e8eaed] px-4 py-3 lg:border-slate-200">
        <h2 className="text-base font-semibold text-[#1f1f1f]">研究</h2>
        <div className="flex items-center gap-0.5 text-[#5f6368]">
          <button
            type="button"
            aria-label="新对话"
            onClick={() => { setMessages([]); onModeChange?.('peek'); }}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full hover:bg-[#f1f3f4]"
          >
            <Edit3 size={16} />
          </button>
          <button
            type="button"
            aria-label="历史"
            disabled
            className="inline-flex h-8 w-8 items-center justify-center rounded-full opacity-40"
          >
            <History size={16} />
          </button>
          {mode === 'conversation' && (
            <button
              type="button"
              aria-label="关闭"
              onClick={() => onModeChange?.('peek')}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full hover:bg-[#f1f3f4] lg:hidden"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>
      {mode === 'peek' && (
        <button
          type="button"
          onClick={() => onModeChange?.('search')}
          className="mx-3 mt-3 flex h-12 items-center gap-2 rounded-full bg-[#f1f3f4] px-4 text-left lg:hidden"
        >
          <Sparkles size={16} className="shrink-0 text-[#1a73e8]" />
          <span className="flex-1 text-[14px] text-[#5f6368]">搜索或提问</span>
        </button>
      )}
      {mode === 'search' && (
        <div className="flex flex-1 flex-col overflow-hidden lg:hidden">
          <div className="px-4 pt-3 pb-2">
            <div className="flex items-center gap-2 mb-1.5">
              <Sparkles size={14} className="text-[#1a73e8]" />
              <span className="text-[13px] font-semibold text-[#1f1f1f]">AI 深度探索</span>
            </div>
            <p className="text-[12px] text-[#5f6368]">📈 关于您监控列表的最新数据洞见</p>
          </div>
          {watchSymbols.length > 0 && (
            <div className="flex gap-2 overflow-x-auto px-4 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {watchSymbols.slice(0, 8).map((sym) => {
                const displaySym = formatSymbolDisplay(sym);
                const q = watchQuotes[sym] || {};
                const pct = Number(q.changePercent);
                const pos = pct >= 0;
                return (
                  <button
                    key={sym}
                    type="button"
                    onClick={() => { onModeChange?.('conversation'); send(displaySym + ' 最新行情分析'); }}
                    className="flex shrink-0 items-center gap-1.5 rounded-full border border-[#e8eaed] bg-white px-3 py-1.5"
                  >
                    <span className="text-[12px] font-semibold text-[#1f1f1f]">{displaySym}</span>
                    {q.changePercent != null && (
                      <span className={cx('text-[11px] font-medium tabular-nums', pos ? 'text-[#34a853]' : 'text-[#ea4335]')}>
                        {pos ? '+' : ''}{pct.toFixed(2)}%
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          <div className="mt-auto px-3 pb-3">
            <form onSubmit={onSubmit} className="flex items-center gap-2 rounded-2xl bg-[#f1f3f4] px-4 py-2.5">
              <input
                ref={inputRef}
                autoFocus
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
                placeholder="询问相关问题或进行搜索"
                className="flex-1 bg-transparent text-[14px] text-[#1f1f1f] placeholder:text-[#5f6368] focus:outline-none"
                disabled={pending}
              />
              <button
                type="submit"
                aria-label="发送"
                disabled={pending || !input.trim()}
                className={cx(
                  'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition',
                  !input.trim() || pending ? 'text-[#9aa0a6]' : 'bg-[#1a73e8] text-white hover:bg-[#1557b0]',
                )}
              >
                {pending ? <Loader2 size={13} className="animate-spin" /> : <ArrowUp size={13} />}
              </button>
            </form>
          </div>
        </div>
      )}
      <div className={cx('flex min-h-0 flex-1 flex-col', mode === 'peek' || mode === 'search' ? 'hidden lg:flex' : 'flex')}>
        {conversationUI}
      </div>
    </div>
  );
}
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
  const [watchLoading, setWatchLoading] = useState(false);
  const [symbolInput, setSymbolInput] = useState('');
  const [symbolSearchResults, setSymbolSearchResults] = useState([]);
  const [symbolSearchLoading, setSymbolSearchLoading] = useState(false);
  const [symbolSearchError, setSymbolSearchError] = useState('');
  const [generatedAt, setGeneratedAt] = useState('');
  const reqIdRef = useRef(0);
  const symbolSearchSeqRef = useRef(0);
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
      feeRate: merged.feeRate ?? merged.expenseRatio ?? merged.managementFeeRate,
      latestNavDate,
      valueType: merged.valueType,
      assetType: merged.assetType,
      source: merged.source,
      market,
      meta: baseMeta
    };
  }, [watchQuotes, watchNavSnapshots, market]);

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
    const price = Number(selectedQuote?.price);
    if (!symbol || !Number.isFinite(price) || price <= 0) return;

    // 1 天溢价：优先使用雪球实时返回的溢价率（premium_rate）。
    // 历史仍按原有公式：在 buildCnFundParamCandles() 内用净值与 candle 价格计算。
    if (chartRange === '1d') {
      const xueqiuQuote = getXueqiuQuote(xueqiuFundDataMap[selectedSymbol]);
      const mergedRow = xueqiuQuote ? {
        ...selectedQuote,
        premium_rate: xueqiuQuote?.premium_rate,
        iopv: xueqiuQuote?.iopv,
        unitNav: xueqiuQuote?.unit_nav,
        latestNavDate: xueqiuQuote?.nav_date,
        lastUpdated: xueqiuQuote?.updated_at || xueqiuQuote?.time,
      } : selectedQuote;
      const xueqiuPremium1d = buildXueqiuPremiumSnapshotFromQuote(mergedRow, symbol);
      if (xueqiuPremium1d) {
        setPremiumMap((prev) => ({
          ...prev,
          [symbol]: { loading: false, error: '', data: xueqiuPremium1d }
        }));
        return;
      }
    }
    const cachedState = premiumMap[symbol];
    const cachedPremium = cachedState?.data;
    if (cachedPremium && Math.abs(Number(cachedPremium.price) - price) < 0.000001) {
      if (cachedState?.loading && !premiumInflightRef.current.has(symbol)) {
        setPremiumMap((prev) => ({
          ...prev,
          [symbol]: { ...prev[symbol], loading: false }
        }));
      }
      return;
    }
    const xueqiuPremium = buildXueqiuPremiumSnapshotFromQuote(selectedQuote, symbol);
    if (xueqiuPremium) {
      setPremiumMap((prev) => ({
        ...prev,
        [symbol]: { loading: false, error: '', data: xueqiuPremium }
      }));
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
  }, [market, selectedSymbol, chartRange, selectedQuote?.price, selectedQuote?.latestNav, selectedQuote?.iopv, selectedQuote?.premiumPercent, selectedQuote?.latestNavDate, xueqiuFundDataMap]);

  // 开盘盘中：1 天溢价视图轮询刷新雪球溢价率。
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    if (market !== 'cn' || !selectedSymbol) return undefined;
    if (chartRange !== '1d') return undefined;
    if (!isCnMarketOpenNow()) return undefined;
    const code = normalizeCnFundCode(selectedSymbol);
    if (!/^\d{6}$/.test(code) || NASDAQ_OTC_FUND_MAP[code]) return undefined;
    let cancelled = false;
    const timer = window.setInterval(async () => {
      if (cancelled) return;
      try {
        const r = await fetchXueqiuFundData(selectedSymbol, { raw: true, refresh: true });
        if (cancelled) return;
        setXueqiuFundDataMap((prev) => ({ ...prev, [selectedSymbol]: r }));
      } catch (_error) {
        // best-effort: ignore refresh errors
      }
    }, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [market, selectedSymbol, chartRange]);

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
      onClose={() => setWatchListExpanded(false)}
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
                <ul className="divide-y divide-[#e8eaed]">
                  {activeSidebarRows.map((row) => (
                    <MobileSidebarRow
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
          selectedQuote && detailHeaderHidden && "pointer-events-none -translate-y-full opacity-0"
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
