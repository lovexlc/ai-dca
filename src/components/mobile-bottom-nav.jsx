import { useEffect, useState } from 'react';
import {
  IconArrowsExchange,
  IconBell,
  IconChartLine,
  IconHome2,
  IconListCheck,
  IconWallet,
} from '@tabler/icons-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from './ui/sheet.jsx';
import { loadNotifyEvents } from '../app/notifySync.js';
import { readNotifyClientConfig } from '../app/notifySync.js';
import { persistWebNotifyConfig } from '../app/webNotifyClient.js';
import { formatEventTimeLabel, resolveEventStatusMeta } from '../app/tradePlansHelpers.js';
import { getVisibleNotifyEvents } from '../pages/notifyHistoryHelpers.js';
import { cx } from './experience-ui.jsx';

function pickEventId(event = {}) {
  return String(event?.id || event?.eventId || event?.createdAt || '');
}

const ITEMS = [
  { key: 'portal', label: '首页', Icon: IconHome2 },
  { key: 'markets', label: '行情', Icon: IconChartLine },
  { key: 'holdings', label: '持仓', Icon: IconWallet },
  { key: 'tradePlans', label: '计划', Icon: IconListCheck },
  { key: 'fundSwitch', label: '换基', Icon: IconArrowsExchange },
  { key: 'notify', label: '提醒', Icon: IconBell },
];

export function MobileBottomNav({ activeKey = '', visibleTabs = null, onSelectTab }) {
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifySheetOpen, setNotifySheetOpen] = useState(false);
  const [events, setEvents] = useState([]);
  const [eventsTick, setEventsTick] = useState(0);

  useEffect(() => {
    function handleCount(e) {
      setUnreadCount(e?.detail?.count || 0);
    }
    function handleClear() {
      setUnreadCount(0);
    }
    window.addEventListener('ai-dca-notify-unread-count', handleCount);
    window.addEventListener('ai-dca-notify-clear-unread', handleClear);
    return () => {
      window.removeEventListener('ai-dca-notify-unread-count', handleCount);
      window.removeEventListener('ai-dca-notify-clear-unread', handleClear);
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setEventsTick((v) => v + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!notifySheetOpen) return undefined;
    const config = readNotifyClientConfig();
    const clientId = config?.notifyClientId;
    if (!clientId) return undefined;
    loadNotifyEvents(clientId).then((payload) => {
      const list = Array.isArray(payload?.events) ? payload.events : [];
      setEvents(list);
      const sorted = list.slice().sort((a, b) => {
        const ta = Date.parse(String(a?.createdAt || '')) || 0;
        const tb = Date.parse(String(b?.createdAt || '')) || 0;
        return ta - tb;
      });
      if (sorted.length) {
        const latestId = pickEventId(sorted[sorted.length - 1]);
        if (latestId) persistWebNotifyConfig({ lastSeenEventId: latestId });
      }
      window.dispatchEvent(new CustomEvent('ai-dca-notify-clear-unread'));
    }).catch(() => {});
    return undefined;
  }, [notifySheetOpen]);

  const visibleEvents = getVisibleNotifyEvents(events, eventsTick);
  const recent = visibleEvents.slice().reverse().slice(0, 20);

  const items = visibleTabs ? ITEMS.filter((item) => visibleTabs.includes(item.key)) : ITEMS;
  if (items.length === 0) return null;

  return (
    <>
      <nav className="mobile-bottom-nav" aria-label="移动端主导航" data-testid="mobile-bottom-nav">
        {items.map(({ key, label, Icon }) => {
          const active = key === activeKey;
          return (
            <button
              key={key}
              type="button"
              className="mobile-bottom-nav__item"
              data-active={active || undefined}
              aria-current={active ? 'page' : undefined}
              onClick={() => {
                if (key === 'notify') {
                  setNotifySheetOpen(true);
                } else {
                  onSelectTab?.(key);
                }
              }}
            >
              <Icon className="mobile-bottom-nav__icon" strokeWidth={active ? 2 : 1.8} aria-hidden="true" />
              <span>{label}</span>
              {key === 'notify' && unreadCount > 0 ? (
                <span className="mobile-bottom-nav__badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
              ) : null}
            </button>
          );
        })}
      </nav>

      <Sheet open={notifySheetOpen} onOpenChange={setNotifySheetOpen}>
        <SheetContent side="bottom" aria-label="通知记录" className="max-h-[80vh] px-4 pt-6">
          <SheetHeader>
            <SheetTitle>通知记录</SheetTitle>
          </SheetHeader>
          <div className="mt-4 overflow-y-auto pb-8">
            {recent.length === 0 ? (
              <div className="py-8 text-center text-xs text-[var(--fg-700)]">暂无通知记录</div>
            ) : (
              <ul className="divide-y divide-[var(--a-200)]">
                {recent.map((event, index) => {
                  const statusMeta = resolveEventStatusMeta(event.status);
                  return (
                    <li key={pickEventId(event) || index} className="py-3">
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
        </SheetContent>
      </Sheet>
    </>
  );
}
