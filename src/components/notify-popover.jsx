import { useEffect, useRef, useState } from 'react';
import { Bell, RefreshCw, Loader2 } from 'lucide-react';
import { loadNotifyEvents } from '../app/notifySync.js';
import { readNotifyClientConfig } from '../app/notifySync.js';
import { clearNotifyUnread } from '../app/useNotifyUnreadCount.js';
import { formatEventTimeLabel, resolveEventStatusMeta } from '../app/tradePlansHelpers.js';
import { getVisibleNotifyEvents } from '../pages/notifyHistoryHelpers.js';
import { cx } from './experience-ui.jsx';

function pickEventId(event = {}) {
  return String(event?.id || event?.eventId || event?.createdAt || '');
}

export function NotifyPopover({ notifyHref = './index.html?tab=notify' } = {}) {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [eventsTick, setEventsTick] = useState(0);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const timer = window.setInterval(() => setEventsTick((v) => v + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    clearNotifyUnread();
    const config = readNotifyClientConfig();
    const clientId = config?.notifyClientId;
    if (!clientId) return undefined;

    let cancelled = false;
    setLoading(true);
    loadNotifyEvents(clientId).then((payload) => {
      if (cancelled) return;
      const list = Array.isArray(payload?.events) ? payload.events : [];
      setEvents(list);
    }).catch(() => {}).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined;
    function onClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) setOpen(false);
    }
    function onKey(event) { if (event.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onClickOutside);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const visibleEvents = getVisibleNotifyEvents(events, eventsTick);
  const recent = visibleEvents.slice().reverse().slice(0, 10);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        className="app-header__utility inline-flex"
        aria-label="提醒"
        title="提醒"
        onClick={() => setOpen((v) => !v)}
      >
        <Bell className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden="true" />
        <NotifyBadge />
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-[115] mt-2 w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--a-200)] bg-[var(--bg-100)] shadow-[var(--shadow-drop)]">
          <div className="flex items-center justify-between border-b border-[var(--a-200)] px-4 py-3">
            <span className="text-sm font-semibold text-[var(--fg-1000)]">通知记录</span>
            <button
              type="button"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--fg-700)] hover:bg-[var(--a-100)]"
              aria-label="刷新"
              onClick={() => {
                const config = readNotifyClientConfig();
                if (!config?.notifyClientId) return;
                setLoading(true);
                loadNotifyEvents(config.notifyClientId).then((payload) => {
                  setEvents(Array.isArray(payload?.events) ? payload.events : []);
                }).catch(() => {}).finally(() => setLoading(false));
              }}
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            </button>
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {loading && !events.length ? (
              <div className="px-4 py-8 text-center text-xs text-[var(--fg-700)]">加载中…</div>
            ) : recent.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-[var(--fg-700)]">暂无通知记录</div>
            ) : (
              <ul className="divide-y divide-[var(--a-200)]">
                {recent.map((event, index) => {
                  const statusMeta = resolveEventStatusMeta(event.status);
                  return (
                    <li key={pickEventId(event) || index} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-2">
                        <span className="min-w-0 text-sm font-medium text-[var(--fg-1000)]">{event.title || event.summary || '交易提醒'}</span>
                        <span className={cx('shrink-0 text-[10px] font-semibold', statusMeta?.className || 'text-[var(--fg-700)]')}>{statusMeta?.label || event.status || ''}</span>
                      </div>
                      {event.body || event.message ? (
                        <p className="mt-1 text-xs leading-5 text-[var(--fg-700)]">{event.body || event.message}</p>
                      ) : null}
                      <div className="mt-1 text-[10px] text-[var(--fg-700)]/70">{formatEventTimeLabel(event.createdAt)}</div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 border-t border-[var(--a-200)] bg-[var(--a-100)]/40 p-3">
            <a
              href={`${notifyHref}${notifyHref.includes('?') ? '&' : '?'}section=config`}
              className="rounded-lg border border-[var(--a-200)] bg-[var(--bg-100)] px-3 py-2 text-center text-xs font-semibold text-[var(--fg-800)] hover:border-[var(--brand)] hover:text-[var(--brand-text)]"
              onClick={() => setOpen(false)}
            >
              通知渠道配置
            </a>
            <a
              href={`${notifyHref}${notifyHref.includes('?') ? '&' : '?'}section=rules`}
              className="rounded-lg border border-[var(--a-200)] bg-[var(--bg-100)] px-3 py-2 text-center text-xs font-semibold text-[var(--fg-800)] hover:border-[var(--brand)] hover:text-[var(--brand-text)]"
              onClick={() => setOpen(false)}
            >
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
    function handleCount(e) { setCount(e?.detail?.count || 0); }
    function handleClear() { setCount(0); }
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
