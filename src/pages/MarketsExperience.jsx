import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Loader2,
  Newspaper,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Star,
  Trash2,
  TrendingUp
} from 'lucide-react';
import {
  Card,
  Pill,
  TextInput,
  cx,
  primaryButtonClass,
  secondaryButtonClass
} from '../components/experience-ui.jsx';
import {
  addToWatchlist,
  fetchIndices,
  fetchKline,
  fetchMovers,
  fetchNews,
  fetchQuotes,
  fetchSummary,
  loadWatchlist,
  removeFromWatchlist
} from '../app/marketsApi.js';
import { showActionToast } from '../app/toast.js';
import { Sparkline } from '../components/markets/Sparkline.jsx';

const MARKETS = [
  { key: 'us', label: '美股' },
  { key: 'cn', label: 'A股' }
];

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

function formatTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('zh-CN', { hour12: false });
}

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
  if (/^[\x00-\x7f]+$/.test(s) && words.length) {
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
  return n > 0 ? 'text-emerald-600' : 'text-rose-500';
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
function ThemeSourceFavicons({ sources = [] }) {
  const list = (sources || []).filter((s) => s && s.url);
  if (!list.length) return null;
  const preview = list.slice(0, 3);
  return (
    <div className="flex shrink-0 items-center gap-1.5" title={`${list.length} 个网站`}>
      <div className="flex -space-x-1.5">
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
              className="h-4 w-4 rounded-full border border-white bg-white object-cover shadow-sm"
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
          ) : (
            <span
              key={i}
              title={host}
              className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-white bg-slate-100 text-[8px] font-semibold text-slate-500 shadow-sm"
            >
              {sourceInitials(host)}
            </span>
          );
        })}
      </div>
      <span className="whitespace-nowrap text-[11px] text-slate-400">{list.length} 个网站</span>
    </div>
  );
}

// 主题卡底部的可点击新闻 chips：favicon + 来源名，外链打开原文。
function ThemeSourceChips({ sources = [] }) {
  const list = (sources || []).filter((s) => s && s.url);
  if (!list.length) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5">
      {list.map((s, i) => {
        const fav = siteFavicon(s.url);
        const host = s.source || siteHost(s.url);
        return (
          <li key={i} className="min-w-0">
            <a
              href={s.url}
              target="_blank"
              rel="noreferrer noopener"
              title={s.title || host}
              className="inline-flex max-w-[16rem] items-center gap-1 rounded-full border border-slate-200/70 bg-white px-2 py-0.5 text-[11px] text-slate-500 transition hover:border-indigo-300 hover:text-indigo-600"
            >
              {fav ? (
                <img
                  src={fav}
                  alt=""
                  loading="lazy"
                  className="h-3.5 w-3.5 shrink-0 rounded-full"
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
              ) : null}
              <span className="truncate">{host}</span>
              <ExternalLink size={10} className="shrink-0 text-slate-300" />
            </a>
          </li>
        );
      })}
    </ul>
  );
}

function IndexCard({ entry, onPick, sparkPoints }) {
  const positive = Number(entry.changePercent) > 0;
  const negative = Number(entry.changePercent) < 0;
  const tone = positive ? 'up' : negative ? 'down' : 'flat';
  return (
    <button
      type="button"
      onClick={() => onPick && onPick(entry)}
      className="group flex w-[31%] min-w-0 shrink-0 snap-start flex-col items-start gap-0.5 overflow-hidden rounded-xl border border-slate-200/70 bg-white/80 p-2.5 text-left shadow-sm transition hover:border-indigo-300 hover:shadow-md sm:w-40 lg:w-44"
    >
      <div className="line-clamp-1 w-full text-xs font-medium text-slate-600">{entry.name || entry.symbol}</div>
      <div className="w-full truncate text-[15px] font-semibold leading-tight tabular-nums text-slate-900">{formatNumber(entry.price)}</div>
      <div className={cx('inline-flex items-center gap-0.5 text-[11px] font-medium tabular-nums', changeToneClass(entry.changePercent))}>
        {positive ? <ArrowUp size={10} /> : negative ? <ArrowDown size={10} /> : null}
        {formatPercent(entry.changePercent)}
      </div>
      <div className="mt-1 -mx-0.5 w-[calc(100%+0.25rem)]">
        <Sparkline points={sparkPoints} width={160} height={28} tone={tone} className="w-full" />
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
              positive && 'bg-emerald-50/30',
              negative && 'bg-rose-50/30'
            )}>
              <td className="px-3 py-2 align-top font-mono text-xs text-slate-600">
                <div>{row.symbol}</div>
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
                  <Sparkline points={klineMap[row.symbol]} width={72} height={24} tone="auto" />
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

function WatchlistTable({ rows = [], market, onRemove }) {
  if (!rows.length) {
    return <p className="text-sm text-slate-400">尚未添加自选。可在涨跌榜里加，也可在搜索框输入代码后回车。</p>;
  }
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white/80">
      <table className="min-w-full divide-y divide-slate-200/70 text-sm">
        <thead className="bg-slate-50/70 text-xs font-medium uppercase tracking-wider text-slate-500">
          <tr>
            <th className="px-3 py-2 text-left">代码</th>
            <th className="px-3 py-2 text-left">名称</th>
            <th className="px-3 py-2 text-right">最新价</th>
            <th className="px-3 py-2 text-right">涨跌幅</th>
            <th className="px-3 py-2 text-right">操作</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr key={row.symbol} className="hover:bg-indigo-50/40">
              <td className="px-3 py-2 font-mono text-xs text-slate-600">{row.symbol}</td>
              <td className="px-3 py-2 text-slate-800">{row.name || row.symbol}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatNumber(row.price)}</td>
              <td className={cx('px-3 py-2 text-right tabular-nums', changeToneClass(row.changePercent))}>
                {formatPercent(row.changePercent)}
              </td>
              <td className="px-3 py-2 text-right">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-400 hover:border-rose-300 hover:text-rose-500"
                  onClick={() => onRemove && onRemove(market, row.symbol)}
                  title="移除自选"
                >
                  <Trash2 size={12} /> 移除
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NewsList({ items = [] }) {
  if (!items.length) {
    return <p className="text-sm text-slate-400">暂无新闻。</p>;
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

// 美股今日主题摘要。默认折叠，展开后按顺序列出 4 个主题。
function SummaryModule({ themes = [], loading, generatedAt, open, onToggle, onRefresh }) {
  const hasContent = Array.isArray(themes) && themes.length > 0;
  return (
    <Card className="space-y-3">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <div className="flex items-center gap-2">
          {open ? <ChevronDown size={16} className="text-indigo-500" /> : <ChevronRight size={16} className="text-indigo-500" />}
          <h2 className="text-base font-semibold text-slate-800">美国市场概况</h2>
          {loading && <Loader2 size={12} className="animate-spin text-slate-400" />}
          {!loading && hasContent && (
            <span className="text-xs text-slate-400">AI 总结 · {themes.length} 个主题</span>
          )}
          {!loading && !hasContent && (
            <span className="text-xs text-slate-400">暂无主题摘要</span>
          )}
        </div>
        <span className="text-xs text-slate-400">
          {generatedAt ? '更新于 ' + formatTime(generatedAt) : ''}
        </span>
      </button>
      {open && (
        <div className="space-y-3">
          {hasContent ? (
            <ol className="space-y-2">
              {themes.map((t, idx) => (
                <li
                  key={idx}
                  className="rounded-xl border border-slate-200/70 bg-white/80 p-3"
                >
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-[11px] font-semibold text-indigo-600">
                      {idx + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1 font-medium text-slate-800">{t.title}</div>
                        <ThemeSourceFavicons sources={t.sources} />
                      </div>
                      <p className="mt-1 text-sm leading-relaxed text-slate-500">{t.detail}</p>
                      <ThemeSourceChips sources={t.sources} />
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-slate-400">
              暂未生成主题摘要。点右侧刷新按钮可请求重新生成。
            </p>
          )}
          {onRefresh && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onRefresh}
                className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:border-indigo-300 hover:text-indigo-600"
              >
                <RefreshCw size={11} /> 重新生成
              </button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

// 行情中心底部“搜索或提问”输入条。提交后向全局 AI 抽屉发 prefill 事件，
// 抽屉会自动切到市场行情模式并预填问题。
function MarketsAskBar({ value, onChange }) {
  const submit = useCallback(
    (e) => {
      if (e && e.preventDefault) e.preventDefault();
      const q = String(value || '').trim();
      if (!q) {
        // 空输入：仅打开面板。
        try { window.dispatchEvent(new CustomEvent('aichat:open')); } catch (_) { /* ignore */ }
        return;
      }
      try {
        window.dispatchEvent(
          new CustomEvent('aichat:prefill', {
            detail: { question: q, mode: 'markets', open: true },
          }),
        );
      } catch (_) { /* ignore */ }
      onChange('');
    },
    [value, onChange],
  );

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 px-3 pb-3 sm:px-6 sm:pb-4">
      <form
        onSubmit={submit}
        className="pointer-events-auto mx-auto flex max-w-3xl items-center gap-2 rounded-full border border-slate-200 bg-white/95 px-3 py-2 shadow-lg backdrop-blur"
      >
        <Search size={16} className="shrink-0 text-slate-400" />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="搜索或提问…例如：今晚美股看什么？"
          className="min-w-0 flex-1 border-none bg-transparent text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none"
        />
        <button
          type="submit"
          className={cx(primaryButtonClass, 'inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-xs')}
        >
          <Sparkles size={12} /> 提问
        </button>
      </form>
    </div>
  );
}

export function MarketsExperience() {
  const [market, setMarket] = useState('us');
  const [indices, setIndices] = useState([]);
  const [indicesLoading, setIndicesLoading] = useState(false);
  const [movers, setMovers] = useState([]);
  const [moversLoading, setMoversLoading] = useState(false);
  const [news, setNews] = useState([]);
  const [newsLoading, setNewsLoading] = useState(false);
  const [summary, setSummary] = useState({ themes: [], generatedAt: '' });
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [watch, setWatch] = useState(() => loadWatchlist());
  const [watchQuotes, setWatchQuotes] = useState({});
  const [watchLoading, setWatchLoading] = useState(false);
  const [symbolInput, setSymbolInput] = useState('');
  const [generatedAt, setGeneratedAt] = useState('');
  const [askInput, setAskInput] = useState('');
  const reqIdRef = useRef(0);
  const [klineMap, setKlineMap] = useState({});
  const klineInflightRef = useRef(new Set());

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

  const watchSymbols = useMemo(() => watch[market] || [], [watch, market]);

  const refreshIndices = useCallback(async (forceRefresh = false) => {
    setIndicesLoading(true);
    const reqId = ++reqIdRef.current;
    try {
      const r = await fetchIndices(market, { refresh: forceRefresh });
      if (reqId !== reqIdRef.current) return;
      const list = Array.isArray(r.indexes) ? r.indexes : [];
      setIndices(list);
      ensureKlines(list.map((it) => it.symbol).filter(Boolean));
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
      ensureKlines(list.map((it) => it.symbol).filter(Boolean));
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
    const list = watch[market] || [];
    if (!list.length) {
      setWatchQuotes({});
      return;
    }
    setWatchLoading(true);
    try {
      const r = await fetchQuotes(list);
      setWatchQuotes(r.quotes || {});
    } catch (err) {
      // ignore
    } finally {
      setWatchLoading(false);
    }
  }, [watch, market]);

  useEffect(() => {
    refreshIndices(false);
    refreshNews();
  }, [refreshIndices, refreshNews]);

  useEffect(() => {
    refreshMovers(false);
  }, [refreshMovers]);

  useEffect(() => {
    refreshSummary(false);
  }, [refreshSummary]);

  useEffect(() => {
    refreshWatch();
  }, [refreshWatch]);

  function handleAddSymbol(event) {
    if (event) event.preventDefault();
    const raw = symbolInput.trim();
    if (!raw) return;
    const next = addToWatchlist(market, raw);
    setWatch(next);
    setSymbolInput('');
  }

  function handleRemove(market, symbol) {
    const next = removeFromWatchlist(market, symbol);
    setWatch(next);
  }

  function handlePickMover(row) {
    const next = addToWatchlist(market, row.symbol);
    setWatch(next);
    showActionToast('已加入自选', 'success');
  }

  const watchRows = useMemo(
    () =>
      (watch[market] || []).map((sym) => {
        const q = watchQuotes[sym] || {};
        return {
          symbol: sym,
          name: q.name || sym,
          price: q.price,
          changePercent: q.changePercent,
          change: q.change
        };
      }),
    [watch, market, watchQuotes]
  );

  return (
    <div className="flex flex-col gap-5 pb-24">
      <div className="sticky top-0 z-20 -mx-4 flex items-center justify-between gap-3 border-b border-slate-200/70 bg-white/95 px-4 py-2 backdrop-blur sm:mx-0 sm:rounded-2xl sm:border sm:px-4">
        <div className="flex items-center gap-1.5">
          {MARKETS.map((m) => (
            <button
              key={m.key}
              type="button"
              className={cx(
                'rounded-full px-4 py-1.5 text-sm font-semibold transition',
                market === m.key
                  ? 'bg-indigo-500 text-white shadow-sm'
                  : 'bg-slate-100 text-slate-600 hover:bg-indigo-50 hover:text-indigo-600'
              )}
              onClick={() => setMarket(m.key)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {generatedAt && (
            <span className="hidden text-[11px] text-slate-400 sm:inline">{formatTime(generatedAt)}</span>
          )}
          <button
            type="button"
            aria-label="刷新"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 hover:border-indigo-300 hover:text-indigo-600"
            onClick={() => {
              refreshIndices(true);
              refreshMovers(true);
              refreshNews();
              refreshWatch();
              refreshSummary(true);
            }}
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {market === 'us' && (
        <SummaryModule
          themes={summary.themes}
          loading={summaryLoading}
          generatedAt={summary.generatedAt}
          open={summaryOpen}
          onToggle={() => setSummaryOpen((v) => !v)}
          onRefresh={() => refreshSummary(true)}
        />
      )}

      <Card className="space-y-3">
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-indigo-500" />
          <h2 className="text-base font-semibold text-slate-800">主要指数</h2>
          {indicesLoading && <Loader2 size={12} className="animate-spin text-slate-400" />}
        </div>
        {indices.length ? (
          <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="flex snap-x snap-mandatory gap-3 pb-1">
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
          <p className="text-sm text-slate-400">暂无指数数据。</p>
        ) : null}
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp size={16} className="text-indigo-500" />
              <h2 className="text-base font-semibold text-slate-800">涨跌榜</h2>
              {moversLoading && <Loader2 size={12} className="animate-spin text-slate-400" />}
              <span className="text-xs text-slate-400">默认按 |涨跌幅| 排序</span>
            </div>
          </div>
          <MoversTable rows={movers} onPick={handlePickMover} klineMap={klineMap} />
        </Card>

        <Card className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Star size={16} className="text-amber-400" />
              <h2 className="text-base font-semibold text-slate-800">自选</h2>
              {watchLoading && <Loader2 size={12} className="animate-spin text-slate-400" />}
            </div>
            <form className="flex items-center gap-1" onSubmit={handleAddSymbol}>
              <TextInput
                className="w-32"
                value={symbolInput}
                onChange={(e) => setSymbolInput(e.target.value)}
                placeholder={market === 'cn' ? 'sh600519' : 'AAPL'}
              />
              <button type="submit" className={cx(primaryButtonClass, 'inline-flex items-center gap-1 text-xs')}>
                <Plus size={12} /> 添加
              </button>
            </form>
          </div>
          <WatchlistTable rows={watchRows} market={market} onRemove={handleRemove} />
        </Card>
      </div>


      <Card className="space-y-3">
        <div className="flex items-center gap-2">
          <Newspaper size={16} className="text-indigo-500" />
          <h2 className="text-base font-semibold text-slate-800">市场新闻</h2>
          {newsLoading && <Loader2 size={12} className="animate-spin text-slate-400" />}
          {market === 'cn' && <Pill tone="slate">A 股新闻源建设中</Pill>}
        </div>
        <NewsList items={news} />
      </Card>

      <MarketsAskBar value={askInput} onChange={setAskInput} />
    </div>
  );
}
