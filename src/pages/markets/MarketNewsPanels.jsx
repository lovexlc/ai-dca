import { useCallback, useState } from 'react';
import { Activity, ChevronDown, ChevronRight, ChevronUp, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { Card, cx } from '../../components/experience-ui.jsx';

export function formatClock(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatDateShort(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

export function sourceInitials(source) {
  const s = String(source || '').trim();
  if (!s) return '?';
  const words = s.split(/[\s\-_/]+/).filter(Boolean);
  if ([...s].every((char) => char.charCodeAt(0) <= 0x7f) && words.length) {
    return words.slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  }
  return s.slice(0, 1);
}

function sourceHue(source) {
  const s = String(source || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

function SourceBadge({ source }) {
  const hue = sourceHue(source);
  const badgeStyle = {
    backgroundColor: `hsl(${hue} 70% 92%)`,
    color: `hsl(${hue} 55% 32%)`,
  };
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

function isRecentNow(value, windowMinutes = 15) {
  if (!value) return false;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return false;
  return Date.now() - d.getTime() < windowMinutes * 60 * 1000;
}

function isToday(value) {
  if (!value) return false;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

export function siteHost(url) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '');
  } catch (_) {
    return '';
  }
}

export function siteFavicon(url) {
  const host = siteHost(url);
  if (!host) return '';
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
}

export function NewsList({ items = [] }) {
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

export function SummaryModule({ themes = [], loading, onRefresh }) {
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

function signedMarketText(text, value, { suffix = '' } = {}) {
  const rawText = String(text || '').trim();
  if (!rawText) return value == null || !Number.isFinite(Number(value)) ? '-' : `${Number(value) > 0 ? '+' : ''}${Number(value).toFixed(2)}${suffix}`;
  if (Number(value) > 0 && !/^[+−-]/.test(rawText)) return '+' + rawText;
  return rawText;
}

function marketStateLabel(value) {
  const state = String(value || '').toUpperCase();
  if (state === 'REGULAR') return 'U.S. markets open';
  if (state === 'PRE' || state === 'PREPRE') return 'Pre-market';
  if (state === 'POST' || state === 'POSTPOST') return 'After-hours';
  if (state === 'CLOSED') return 'U.S. markets closed';
  return state ? state.toLowerCase() : 'US market summary';
}

function marketSummaryMeta(summary) {
  const first = Array.isArray(summary?.items) ? summary.items.find((item) => item?.marketState || item?.timeText) : null;
  const parts = [marketStateLabel(first?.marketState)];
  if (first?.timeText) parts.push(first.timeText);
  if (Number(first?.delayMinutes) > 0) parts.push(`Delayed ${first.delayMinutes}m`);
  return parts.filter(Boolean).join(' · ');
}

function MarketSummarySkeleton() {
  return (
    <div className="flex gap-2 overflow-hidden">
      {Array.from({ length: 4 }).map((_, idx) => (
        <div key={idx} className="h-[76px] min-w-[148px] animate-pulse rounded-md border border-slate-200 bg-slate-50" />
      ))}
    </div>
  );
}

export function MarketSummaryStrip({ summary, loading, onRefresh }) {
  const items = Array.isArray(summary?.items) ? summary.items : [];
  if (!items.length && !loading) return null;
  return (
    <section className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Activity size={16} className="shrink-0 text-slate-500" />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-slate-900">{summary?.title || 'US Markets'}</div>
            <div className="truncate text-[11px] text-slate-400">{marketSummaryMeta(summary)}</div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {loading && <Loader2 size={12} className="animate-spin text-slate-400" />}
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              aria-label="刷新美国市场行情"
              className="inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-800"
            >
              <RefreshCw size={12} />
            </button>
          )}
        </div>
      </div>
      {items.length ? (
        <div className="flex gap-2 overflow-x-auto pb-0.5 [scrollbar-width:thin]">
          {items.slice(0, 12).map((item) => {
            const direction = Number(item.changePercent) > 0 ? 'up' : Number(item.changePercent) < 0 ? 'down' : 'flat';
            const toneClass = direction === 'up'
              ? 'text-emerald-600'
              : direction === 'down'
                ? 'text-rose-600'
                : 'text-slate-500';
            return (
              <div
                key={item.symbol}
                className="min-w-[148px] rounded-md border border-slate-200 bg-slate-50/70 px-2.5 py-2"
              >
                <div className="truncate text-[12px] font-semibold leading-4 text-slate-700" title={item.name || item.symbol}>
                  {item.name || item.symbol}
                </div>
                <div className="mt-1 text-[15px] font-semibold leading-5 text-slate-950 tabular-nums">
                  {item.priceText || '-'}
                </div>
                <div className={cx('mt-1 flex items-center gap-1 text-[12px] font-semibold tabular-nums', toneClass)}>
                  <span>{signedMarketText(item.changeText, item.change)}</span>
                  <span>{signedMarketText(item.changePercentText, item.changePercent, { suffix: '%' })}</span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <MarketSummarySkeleton />
      )}
    </section>
  );
}

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

export function LatestNewsList({ items = [], initialLimit = 6 }) {
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

function formatEps(n) {
  if (n == null || !Number.isFinite(Number(n))) return '-';
  return Number(n).toFixed(2);
}

export function EarningsCalendar({ items = [], initialLimit = 5 }) {
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
                {Array.isArray(it.indices) && it.indices.map((idxName) => (
                  <span
                    key={idxName}
                    className="inline-flex shrink-0 items-center rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600"
                  >
                    {idxName}
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
