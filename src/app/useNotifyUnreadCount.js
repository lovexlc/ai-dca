import { useEffect, useState } from 'react';
import { loadNotifyEvents } from './notifySync.js';
import { readNotifyClientConfig } from './notifySync.js';
import { readWebNotifyConfig, persistWebNotifyConfig } from './webNotifyClient.js';

const POLL_INTERVAL_MS = 30_000;

function pickEventId(event = {}) {
  return String(event?.id || event?.eventId || event?.createdAt || '');
}

function sortEventsAsc(events = []) {
  return (Array.isArray(events) ? events.slice() : []).sort((a, b) => {
    const ta = Date.parse(String(a?.createdAt || '')) || 0;
    const tb = Date.parse(String(b?.createdAt || '')) || 0;
    return ta - tb;
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
    const config = readNotifyClientConfig();
    const clientId = config?.notifyClientId;
    if (!clientId) return undefined;

    let stopped = false;

    async function poll() {
      if (stopped) return;
      try {
        const payload = await loadNotifyEvents(clientId);
        if (stopped) return;
        const events = payload?.events || [];
        const webConfig = readWebNotifyConfig();
        const count = countUnread(events, webConfig.lastSeenEventId);
        setUnreadCount(count);
        window.dispatchEvent(new CustomEvent('ai-dca-notify-unread-count', { detail: { count } }));
      } catch {
        // silent
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
  const config = readNotifyClientConfig();
  const clientId = config?.notifyClientId;
  window.dispatchEvent(new CustomEvent('ai-dca-notify-clear-unread'));
  if (!clientId) return;
  loadNotifyEvents(clientId).then((payload) => {
    const events = payload?.events || [];
    if (!events.length) return;
    const sorted = events.slice().sort((a, b) => {
      const ta = Date.parse(String(a?.createdAt || '')) || 0;
      const tb = Date.parse(String(b?.createdAt || '')) || 0;
      return ta - tb;
    });
    const latestId = pickEventId(sorted[sorted.length - 1]);
    if (latestId) {
      persistWebNotifyConfig({ lastSeenEventId: latestId });
    }
  }).catch(() => {});
}
