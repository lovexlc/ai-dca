import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Edit3,
  ExternalLink,
  History,
  Loader2,
  ListPlus,
  Maximize2,
  Newspaper,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Star,
  Trash2,
  TrendingUp
  X,
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
  askMarkets,
  askMarketsStream,
  fetchIndices,
  fetchKline,
  fetchMovers,
  fetchNews,
  fetchQuotes,
  fetchSectors,
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
      className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50/60 px-3 py-1 text-xs font-medium text-indigo-600 transition hover:border-indigo-300 hover:bg-indigo-50"
    >
      <Sparkles size={12} />
      借助 AI 深入探索此主题
    </button>
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

function SidebarRow({ symbol, name, price, changePercent, sparkPoints, onRemove }) {
  const pct = Number(changePercent);
  const tone = !Number.isFinite(pct) || Math.abs(pct) < 0.0001
    ? 'text-slate-500'
    : pct > 0
    ? 'text-emerald-600'
    : 'text-rose-600';
  const ArrowIcon = !Number.isFinite(pct) || Math.abs(pct) < 0.0001
    ? null
    : pct > 0
    ? ArrowUp
    : ArrowDown;
  return (
    <li className="group relative">
      <div className="flex items-center gap-2 rounded-md px-2 py-1.5 transition hover:bg-indigo-50/60">
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-[13px] font-semibold leading-tight text-slate-800">{symbol}</div>
          {name && name !== symbol ? (
            <div className="truncate text-[11px] leading-tight text-slate-400">{name}</div>
          ) : null}
        </div>
        {sparkPoints && sparkPoints.length >= 2 ? (
          <Sparkline points={sparkPoints} width={56} height={20} tone="auto" showFill={false} />
        ) : (
          <div className="h-[20px] w-[56px]" />
        )}
        <div className="flex shrink-0 flex-col items-end leading-tight">
          <div className="font-mono text-[12px] font-semibold tabular-nums text-slate-800">{formatNumber(price)}</div>
          <div className={cx('flex items-center gap-0.5 font-mono text-[11px] tabular-nums', tone)}>
            {ArrowIcon ? <ArrowIcon size={9} /> : null}
            <span>{formatPercent(changePercent)}</span>
          </div>
        </div>
        {onRemove ? (
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRemove(); }}
            className="absolute right-1 top-1/2 hidden -translate-y-1/2 rounded p-0.5 text-slate-300 hover:text-rose-500 group-hover:block"
            title="移除自选"
          >
            <Trash2 size={11} />
          </button>
        ) : null}
      </div>
    </li>
  );
}

function MobileSidebarRow({ symbol, name, price, changePercent, sparkPoints }) {
  const pct = Number(changePercent);
  const flat = !Number.isFinite(pct) || Math.abs(pct) < 0.0001;
  const up = pct > 0;
  const textTone = flat ? 'text-[#5f6368]' : up ? 'text-[#137333]' : 'text-[#a50e0e]';
  const circleBg = flat ? 'bg-[#bdc1c6]' : up ? 'bg-[#137333]' : 'bg-[#a50e0e]';
  const ArrowIcon = flat ? null : up ? ArrowUp : ArrowDown;
  return (
    <li className="flex items-center gap-3 px-1 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="truncate text-base font-semibold leading-tight text-[#1f1f1f]">{symbol}</div>
        {name && name !== symbol ? (
          <div className="truncate text-sm leading-tight text-[#5f6368]">{name}</div>
        ) : null}
      </div>
      {sparkPoints && sparkPoints.length >= 2 ? (
        <Sparkline points={sparkPoints} width={86} height={32} tone="auto" showFill markLast />
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

// 美股今日主题摘要。仿 Google Finance：首条默认展开（粗体标题 + 段落正文 + AI 探索按钮），
// 其余条目折叠，每条右侧显示新闻来源 favicon 疆叠 + “N 个网站”。
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
                  <span className="min-w-0 flex-1 text-[15px] font-semibold leading-snug text-slate-900">{t.title}</span>
                  <span className="flex shrink-0 items-center gap-2 pt-0.5">
                    {isOpen && sources.length > 0 && (
                      <span className="hidden items-center gap-1.5 sm:flex">
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
                    <p className="text-[14px] leading-relaxed text-slate-700">{t.detail}</p>
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
function MarketsResearchPanel({ market, mode, onModeChange }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  const send = useCallback(
    async (raw, opts = {}) => {
      const question = String(raw || '').trim();
      if (!question || pending) return;
      const useDepth = opts.depth === 'deep' ? 'deep' : 'fast';
      const useContext = typeof opts.context === 'string' ? opts.context : '';
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
        const symbols = Array.isArray(wl[market]) ? wl[market].slice(0, 10) : [];
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
    [market, pending, onModeChange],
  );

  const onSubmit = useCallback(
    (e) => {
      if (e && e.preventDefault) e.preventDefault();
      send(input);
    },
    [input, send],
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
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
    if (mode === 'conversation' && inputRef.current) {
      const t = setTimeout(() => inputRef.current?.focus(), 300);
      return () => clearTimeout(t);
    }
  }, [mode]);

  const fmtTime = (ts) => {
    if (!ts) return '';
    try { return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }); }
    catch { return ''; }
  };

  const conversationUI = (
    <>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
        {messages.length === 0 ? (
          <p className="mt-2 text-[14px] text-[#9aa0a6]">向我询问任何金融问题…</p>
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
                      <div className="flex items-center gap-1.5 text-[14px] text-[#5f6368]">
                        <Loader2 size={14} className="animate-spin" />
                        <span>{m.stage || '正在思考…'}</span>
                      </div>
                    ) : (
                      <p className={cx('whitespace-pre-wrap text-[14px] leading-relaxed', m.error ? 'text-rose-600' : 'text-[#1f1f1f]')}>
                        {m.content}
                      </p>
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
      <form onSubmit={onSubmit} className="mx-3 mb-3 mt-1 flex h-12 items-center gap-2 rounded-full bg-[#f1f3f4] px-4">
        <Sparkles size={16} className="shrink-0 text-[#1a73e8]" />
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
    <div className="flex h-full min-h-0 w-full flex-col bg-white lg:h-[calc(100vh-1.5rem)] lg:max-h-[820px] lg:rounded-2xl lg:border lg:border-slate-200">
      {pending && <div className="h-0.5 w-full shrink-0 animate-pulse bg-[#1a73e8]" />}
      <div className="flex items-center justify-between border-b border-[#e8eaed] px-4 py-3 lg:border-slate-200">
        <h2 className="text-base font-semibold text-[#1f1f1f]">研究</h2>
        <div className="flex items-center gap-0.5 text-[#5f6368]">
          <button
            type="button"
            aria-label="新对话"
            onClick={() => { setMessages([]); onModeChange?.(’peek’); }}
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
          onClick={() => onModeChange?.('conversation')}
          className="mx-3 mt-3 flex h-12 items-center gap-2 rounded-full bg-[#f1f3f4] px-4 text-left lg:hidden"
        >
          <Sparkles size={16} className="shrink-0 text-[#1a73e8]" />
          <span className="flex-1 text-[14px] text-[#5f6368]">搜索或提问</span>
        </button>
      )}
      <div className={cx('flex min-h-0 flex-1 flex-col', mode === 'peek' ? 'hidden lg:flex' : 'flex')}>
        {conversationUI}
      </div>
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
  const [watch, setWatch] = useState(() => loadWatchlist());
  const [watchQuotes, setWatchQuotes] = useState({});
  const [watchLoading, setWatchLoading] = useState(false);
  const [symbolInput, setSymbolInput] = useState('');
  const [generatedAt, setGeneratedAt] = useState('');
  const reqIdRef = useRef(0);
  const [klineMap, setKlineMap] = useState({});
  const klineInflightRef = useRef(new Set());
  const [sectors, setSectors] = useState([]);
  const [sectorsLoading, setSectorsLoading] = useState(false);
  // 侧边折叠状态：默认两组都展开。
  const [watchOpen, setWatchOpen] = useState(true);
  const [sectorsOpen, setSectorsOpen] = useState(true);
  // 研究底部抽屉模式（仅 mobile）：peek=小片 / conversation=全屏展开
  const [researchMode, setResearchMode] = useState('peek');

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
      ensureKlines(list.map((it) => it.symbol).filter(Boolean));
    } catch (err) {
      // 行业是增量信息，失败不弹 toast，避免骩扰。
      setSectors([]);
    } finally {
      setSectorsLoading(false);
    }
  }, [market, ensureKlines]);

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

  useEffect(() => {
    refreshSectors(false);
  }, [refreshSectors]);

  // 自选股变化时拉一下迷你图（能复用则复用 inflight，不会重发）。
  useEffect(() => {
    ensureKlines(watchSymbols);
  }, [watchSymbols, ensureKlines]);

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
    <div className="flex flex-col gap-5 pb-[140px] lg:grid lg:grid-cols-[260px_minmax(0,1fr)_320px] lg:items-start lg:gap-4 lg:pb-6">
      {/* Mobile-only sidebar: Google Finance Beta style */}
      <aside className="order-2 flex flex-col gap-2 lg:hidden">
        <div className="px-1">
          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md py-1 text-[28px] leading-8 font-normal tracking-tight text-[#1f1f1f]"
              title="列表切换　（后续启用多人多列表）"
            >
              <span>列表</span>
              <ChevronDown size={22} className="text-[#5f6368]" />
            </button>
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="管理列表"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full text-[#5f6368] hover:bg-[#f1f3f4]"
              >
                <ListPlus size={22} />
              </button>
              <button
                type="button"
                aria-label="全屏"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full text-[#5f6368] hover:bg-[#f1f3f4]"
                onClick={() => {
                  try {
                    if (document.fullscreenElement) document.exitFullscreen();
                    else document.documentElement.requestFullscreen?.();
                  } catch {}
                }}
              >
                <Maximize2 size={20} />
              </button>
            </div>
          </div>
          <div className="mt-1 h-px w-full bg-[#e8eaed]" />
        </div>

        {/* 监控列表 */}
        <div className="px-1">
          <div className="flex items-center justify-between py-2">
            <h3 className="text-base font-semibold text-[#1f1f1f]">监控列表</h3>
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                aria-label="添加自选"
                className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[#5f6368] hover:bg-[#f1f3f4]"
                onClick={() => {
                  const el = document.getElementById('markets-watch-add-input-mobile');
                  if (el) el.focus();
                }}
              >
                <Plus size={20} />
              </button>
              <button
                type="button"
                onClick={() => setWatchOpen((v) => !v)}
                aria-label={watchOpen ? '折叠' : '展开'}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[#5f6368] hover:bg-[#f1f3f4]"
              >
                {watchOpen ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
              </button>
            </div>
          </div>
          {watchOpen && (
            <>
              <form className="flex items-center gap-2 px-1 pb-2" onSubmit={handleAddSymbol}>
                <TextInput
                  id="markets-watch-add-input-mobile"
                  className="flex-1"
                  value={symbolInput}
                  onChange={(e) => setSymbolInput(e.target.value)}
                  placeholder={market === 'cn' ? 'sh600519' : 'AAPL'}
                />
                <button type="submit" className={cx(primaryButtonClass, 'inline-flex shrink-0 items-center gap-1 px-3 py-2 text-sm')}>
                  <Plus size={14} /> 添加
                </button>
              </form>
              {watchRows.length === 0 ? (
                <p className="px-2 py-2 text-sm text-[#5f6368]">尚未添加自选。</p>
              ) : (
                <ul className="divide-y divide-[#e8eaed]">
                  {watchRows.map((row) => (
                    <MobileSidebarRow
                      key={row.symbol}
                      symbol={row.symbol}
                      name={row.name}
                      price={row.price}
                      changePercent={row.changePercent}
                      sparkPoints={klineMap[row.symbol]}
                    />
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        {/* 股票板块（仅美股） */}
        {market === 'us' && (
          <div className="px-1">
            <div className="flex items-center justify-between py-2">
              <h3 className="text-base font-semibold text-[#1f1f1f]">股票板块</h3>
              <button
                type="button"
                onClick={() => setSectorsOpen((v) => !v)}
                aria-label={sectorsOpen ? '折叠' : '展开'}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[#5f6368] hover:bg-[#f1f3f4]"
              >
                {sectorsOpen ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
              </button>
            </div>
            {sectorsOpen && (
              sectors.length === 0 ? (
                <p className="px-2 py-2 text-sm text-[#5f6368]">{sectorsLoading ? '加载中…' : '暂无数据'}</p>
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
        )}
      </aside>

      {/* PC-only sidebar: Google Finance Beta-style compact (设计不变) */}
      <aside className="order-2 hidden flex-col gap-3 lg:order-1 lg:sticky lg:top-2 lg:flex">
        <div className="rounded-2xl border border-slate-200/70 bg-white/95 shadow-sm">
          {/* 顶部工具栏：「列表 ▾」下拉 + 添加 + 全屏 */}
          <div className="flex items-center justify-between gap-1 border-b border-slate-200/70 px-2 py-1.5">
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-slate-700 hover:bg-slate-100"
              title="列表切换（后续启用多人多列表）"
            >
              <span>列表</span>
              <ChevronDown size={14} className="text-slate-400" />
            </button>
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-indigo-600"
                title="添加自选"
                onClick={() => {
                  const el = document.getElementById('markets-watch-add-input');
                  if (el) el.focus();
                }}
              >
                <Plus size={14} />
              </button>
              <button
                type="button"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-indigo-600"
                title="全屏查看（后续接入）"
              >
                <Maximize2 size={14} />
              </button>
            </div>
          </div>

          {/* 组 1：监控列表 */}
          <div className="px-1 pt-1">
            <button
              type="button"
              onClick={() => setWatchOpen((v) => !v)}
              className="flex w-full items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold uppercase tracking-wider text-slate-500 hover:bg-slate-50"
            >
              {watchOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              <Star size={11} className="text-amber-400" />
              <span>监控列表</span>
              {watchLoading && <Loader2 size={10} className="ml-1 animate-spin text-slate-400" />}
            </button>
          </div>
          {watchOpen && (
            <div className="px-1 pb-1">
              <form className="flex items-center gap-1 px-1 pb-2 pt-1" onSubmit={handleAddSymbol}>
                <TextInput
                  id="markets-watch-add-input"
                  className="flex-1"
                  value={symbolInput}
                  onChange={(e) => setSymbolInput(e.target.value)}
                  placeholder={market === 'cn' ? 'sh600519' : 'AAPL'}
                />
                <button type="submit" className={cx(primaryButtonClass, 'inline-flex shrink-0 items-center gap-1 px-2 py-1 text-xs')}>
                  <Plus size={12} /> 添加
                </button>
              </form>
              {watchRows.length === 0 ? (
                <p className="px-2 py-1 text-xs text-slate-400">尚未添加自选。</p>
              ) : (
                <ul>
                  {watchRows.map((row) => (
                    <SidebarRow
                      key={row.symbol}
                      symbol={row.symbol}
                      name={row.name}
                      price={row.price}
                      changePercent={row.changePercent}
                      sparkPoints={klineMap[row.symbol]}
                      onRemove={() => handleRemove(market, row.symbol)}
                    />
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* 组 2：股票板块（仅美股），S&P 11 行业指数 */}
          {market === 'us' && (
            <>
              <div className="border-t border-slate-200/60 px-1 pt-1">
                <button
                  type="button"
                  onClick={() => setSectorsOpen((v) => !v)}
                  className="flex w-full items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold uppercase tracking-wider text-slate-500 hover:bg-slate-50"
                >
                  {sectorsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  <TrendingUp size={11} className="text-indigo-400" />
                  <span>股票板块</span>
                  {sectorsLoading && <Loader2 size={10} className="ml-1 animate-spin text-slate-400" />}
                </button>
              </div>
              {sectorsOpen && (
                <div className="px-1 pb-2 pt-1">
                  {sectors.length === 0 ? (
                    <p className="px-2 py-1 text-xs text-slate-400">加载中…</p>
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
          )}
        </div>
      </aside>

      <main className="order-1 flex min-w-0 flex-col gap-5 lg:order-2">
        <div className="sticky top-0 z-20 flex items-center justify-between gap-3 rounded-2xl border border-slate-200/70 bg-white/95 px-4 py-2 backdrop-blur">
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

        {market === 'us' && (
          <SummaryModule
            themes={summary.themes}
            loading={summaryLoading}
            generatedAt={summary.generatedAt}
            onRefresh={() => refreshSummary(true)}
          />
        )}

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
          <div className="flex items-center gap-2">
            <Newspaper size={16} className="text-indigo-500" />
            <h2 className="text-base font-semibold text-slate-800">市场新闻</h2>
            {newsLoading && <Loader2 size={12} className="animate-spin text-slate-400" />}
            {market === 'cn' && <Pill tone="slate">A 股新闻源建设中</Pill>}
          </div>
          <NewsList items={news} />
        </Card>
      </main>

      {/* Backdrop when conversation */}
      {researchMode === 'conversation' && (
        <div className="fixed inset-0 z-30 bg-black/20 lg:hidden" onClick={() => setResearchMode('peek')} />
      )}
      {/* Research panel: PC = sticky aside / Mobile = bottom sheet */}
      <aside
        id="markets-research-anchor"
        className={cx(
          'bg-white',
          'lg:relative lg:z-auto lg:order-3 lg:flex lg:flex-col lg:gap-3 lg:bg-transparent lg:sticky lg:top-2 lg:rounded-none lg:border-t-0 lg:shadow-none',
          'fixed inset-x-0 z-40 flex flex-col overflow-hidden rounded-t-2xl border-t border-[#e8eaed] shadow-[0_-4px_16px_rgba(0,0,0,0.06)] transition-all duration-300 ease-out',
          researchMode === 'conversation' ? 'top-20 bottom-0 h-auto' : 'bottom-0 h-[130px]'
        )}
      >
        {/* Drag handle */}
        <button
          type="button"
          onClick={() => setResearchMode((m) => m === 'peek' ? 'conversation' : 'peek')}
          className="flex h-6 w-full shrink-0 items-center justify-center bg-white lg:hidden"
          aria-label={researchMode === 'peek' ? '展开研究' : '收起研究'}
        >
          <span className="h-1 w-9 rounded-full bg-[#dadce0]" />
        </button>
        <MarketsResearchPanel market={market} mode={researchMode} onModeChange={setResearchMode} />
      </aside>
    </div>
  );
}
