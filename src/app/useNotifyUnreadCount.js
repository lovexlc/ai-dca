import { useEffect, useState } from 'react';
import { loadNotifyEvents, readNotifyClientConfig } from './notifySync.js';
import { persistWebNotifyConfig, readWebNotifyConfig } from './webNotifyClient.js';

const POLL_INTERVAL_MS = 30_000;

function pickEventId(event = {}) {
  return String(event?.id || event?.eventId || event?.createdAt || '');
}

function sortEventsAsc(events = []) {
  return (Array.isArray(events) ? events.slice() : []).sort((a, b) => {
    const first = Date.parse(String(a?.createdAt || '')) || 0;
    const second = Date.parse(String(b?.createdAt || '')) || 0;
    return first - second;
  });
}

export function countUnread(events, lastSeenId) {
  if (!Array.isArray(events) || !events.length) return 0;
  if (!lastSeenId) return events.length;
  const sorted = sortEventsAsc(events);
  const lastSeenIndex = sorted.findIndex((event) => pickEventId(event) === lastSeenId);
  return lastSeenIndex < 0 ? sorted.length : sorted.length - lastSeenIndex - 1;
}

export function useNotifyUnreadCount() {
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    const clientId = readNotifyClientConfig()?.notifyClientId;
    if (!clientId) return undefined;
    let stopped = false;

    async function poll() {
      if (stopped) return;
      try {
        const payload = await loadNotifyEvents(clientId);
        if (stopped) return;
        const count = countUnread(payload?.events || [], readWebNotifyConfig().lastSeenEventId);
        setUnreadCount(count);
        window.dispatchEvent(new CustomEvent('ai-dca-notify-unread-count', { detail: { count } }));
      } catch {
        // 顶栏轮询静默失败，不打断页面使用。
      }
    }

    poll();
    const timer = window.setInterval(poll, POLL_INTERVAL_MS);
    function handleClear() {
      setUnreadCount(0);
    }
    window.addEventListener('ai-dca-notify-clear-unread', handleClear);

    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener('ai-dca-notify-clear-unread', handleClear);
    };
  }, []);

  return unreadCount;
}

export function clearNotifyUnread() {
  const clientId = readNotifyClientConfig()?.notifyClientId;
  window.dispatchEvent(new CustomEvent('ai-dca-notify-clear-unread'));
  if (!clientId) return;
  loadNotifyEvents(clientId)
    .then((payload) => {
      const sorted = sortEventsAsc(payload?.events || []);
      const latestId = sorted.length ? pickEventId(sorted[sorted.length - 1]) : '';
      if (latestId) persistWebNotifyConfig({ lastSeenEventId: latestId });
    })
    .catch(() => {});
}
