import { Bell, Loader2, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { loadNotifyEvents, readNotifyClientConfig } from '../app/notifySync.js';
import { clearNotifyUnread } from '../app/useNotifyUnreadCount.js';
import { getVisibleNotifyEvents } from '../pages/notifyHistoryHelpers.js';

function pickEventId(event = {}) {
  return String(event?.id || event?.eventId || event?.createdAt || '');
}

function formatTime(value = '') {
  const timestamp = Date.parse(String(value || ''));
  if (!Number.isFinite(timestamp)) return '--';
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false });
}

function statusLabel(status = '') {
  if (status === 'delivered') return '已送达';
  if (status === 'failed') return '未送达';
  if (status === 'queued') return '待投递';
  return status || '未发送';
}

export function NotifyPopover({ notifyHref = './index.html?tab=notify' } = {}) {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [eventsTick, setEventsTick] = useState(0);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const timer = window.setInterval(() => setEventsTick((value) => value + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    clearNotifyUnread();
    const clientId = readNotifyClientConfig()?.notifyClientId;
    if (!clientId) return undefined;

    let cancelled = false;
    setLoading(true);
    loadNotifyEvents(clientId)
      .then((payload) => {
        if (!cancelled) setEvents(Array.isArray(payload?.events) ? payload.events : []);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) setOpen(false);
    }
    function handleKeyDown(event) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const recent = getVisibleNotifyEvents(events, eventsTick).slice().reverse().slice(0, 10);

  function refresh() {
    const clientId = readNotifyClientConfig()?.notifyClientId;
    if (!clientId) return;
    setLoading(true);
    loadNotifyEvents(clientId)
      .then((payload) => setEvents(Array.isArray(payload?.events) ? payload.events : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        className="app-header__utility"
        aria-label="提醒"
        title="提醒"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Bell className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden="true" />
        <NotifyBadge />
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-[115] mt-2 w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <span className="text-sm font-semibold text-slate-900">通知记录</span>
            <button type="button" className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100" aria-label="刷新" onClick={refresh}>
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            </button>
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {loading && !events.length ? (
              <div className="px-4 py-8 text-center text-xs text-slate-500">加载中…</div>
            ) : recent.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-slate-500">暂无通知记录</div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {recent.map((event, index) => (
                  <li key={pickEventId(event) || index} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0 text-sm font-medium text-slate-900">{event.title || event.summary || '交易提醒'}</span>
                      <span className="shrink-0 text-[10px] font-semibold text-slate-500">{statusLabel(event.status)}</span>
                    </div>
                    {event.body || event.message ? <p className="mt-1 text-xs leading-5 text-slate-600">{event.body || event.message}</p> : null}
                    <div className="mt-1 text-[10px] text-slate-400">{formatTime(event.createdAt)}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 border-t border-slate-200 bg-slate-50 p-3">
            <a href={`${notifyHref}${notifyHref.includes('?') ? '&' : '?'}section=config`} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-center text-xs font-semibold text-slate-700 hover:border-indigo-500 hover:text-indigo-700" onClick={() => setOpen(false)}>
              通知渠道配置
            </a>
            <a href={`${notifyHref}${notifyHref.includes('?') ? '&' : '?'}section=rules`} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-center text-xs font-semibold text-slate-700 hover:border-indigo-500 hover:text-indigo-700" onClick={() => setOpen(false)}>
              通知策略管理
            </a>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function NotifyBadge() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    function handleCount(event) {
      setCount(event?.detail?.count || 0);
    }
    function handleClear() {
      setCount(0);
    }
    window.addEventListener('ai-dca-notify-unread-count', handleCount);
    window.addEventListener('ai-dca-notify-clear-unread', handleClear);
    return () => {
      window.removeEventListener('ai-dca-notify-unread-count', handleCount);
      window.removeEventListener('ai-dca-notify-clear-unread', handleClear);
    };
  }, []);

  if (count <= 0) return null;
  return <span className="app-header__badge">{count > 99 ? '99+' : count}</span>;
}
