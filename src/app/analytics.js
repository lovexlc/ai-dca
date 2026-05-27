const STORE_KEY = 'aiDcaAnalyticsEvents_v1';
const VISITOR_KEY = 'aiDcaAnalyticsVisitorId_v1';
const SESSION_KEY = 'aiDcaAnalyticsSessionId_v1';
const CLOUD_SESSION_KEY = 'aiDcaCloudSyncSession';
const DEFAULT_SYNC_BASE = 'https://tools.freebacktrack.tech/api/sync';
const MAX_EVENTS = 5000;
const ADMIN_USERS = new Set(['lovexl']);

function safeStorage() {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  return window.localStorage;
}

function getAnalyticsBase() {
  if (typeof window !== 'undefined' && window.__AI_DCA_SYNC_BASE__) {
    return String(window.__AI_DCA_SYNC_BASE__).replace(/\/$/, '');
  }
  return DEFAULT_SYNC_BASE;
}

function randomId(prefix) {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return `${prefix}:${crypto.randomUUID()}`;
  return `${prefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
}

export function getAnalyticsVisitorId() {
  const ls = safeStorage();
  if (!ls) return 'server';
  let id = ls.getItem(VISITOR_KEY);
  if (!id) {
    id = randomId('visitor');
    ls.setItem(VISITOR_KEY, id);
  }
  return id;
}

export function getAnalyticsSessionId() {
  const storage = typeof window !== 'undefined' ? window.sessionStorage : null;
  if (!storage) return 'server-session';
  let id = storage.getItem(SESSION_KEY);
  if (!id) {
    id = randomId('session');
    storage.setItem(SESSION_KEY, id);
  }
  return id;
}

function readEvents() {
  const ls = safeStorage();
  if (!ls) return [];
  try {
    const parsed = JSON.parse(ls.getItem(STORE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

function writeEvents(events) {
  const ls = safeStorage();
  if (!ls) return;
  ls.setItem(STORE_KEY, JSON.stringify(events.slice(-MAX_EVENTS)));
}

export function readAnalyticsSession() {
  const ls = safeStorage();
  if (!ls) return null;
  try {
    const parsed = JSON.parse(ls.getItem(CLOUD_SESSION_KEY) || 'null');
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch (_error) {
    return null;
  }
}

export function isAnalyticsAdmin(session = readAnalyticsSession()) {
  const username = String(session?.username || '').trim().toLowerCase();
  return ADMIN_USERS.has(username);
}

export function trackAnalyticsEvent(type, meta = {}) {
  if (!type || typeof window === 'undefined') return null;
  const session = readAnalyticsSession();
  const event = {
    id: randomId('event'),
    type: String(type),
    createdAt: new Date().toISOString(),
    date: new Date().toISOString().slice(0, 10),
    visitorId: getAnalyticsVisitorId(),
    sessionId: getAnalyticsSessionId(),
    userId: String(session?.userId || ''),
    username: String(session?.username || ''),
    path: `${window.location.pathname}${window.location.search}${window.location.hash}`,
    referrer: document.referrer || '',
    userAgent: navigator.userAgent || '',
    meta: meta && typeof meta === 'object' ? meta : {}
  };
  const events = readEvents();
  events.push(event);
  writeEvents(events);

  try {
    window.dispatchEvent(new CustomEvent('analytics:changed', { detail: { event } }));
  } catch (_error) {
    // ignore
  }

  try {
    const endpoint = window.__AI_DCA_ANALYTICS_ENDPOINT__ || `${getAnalyticsBase()}/analytics/track`;
    if (navigator.sendBeacon) {
      navigator.sendBeacon(endpoint, new Blob([JSON.stringify(event)], { type: 'application/json' }));
    } else {
      fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(event),
        keepalive: true
      }).catch(() => {});
    }
  } catch (_error) {
    // 本地轻量统计优先，远程上报失败不影响页面
  }

  return event;
}

export function trackPageView(tab) {
  return trackAnalyticsEvent('page_view', { tab: tab || '' });
}

function daysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function inRange(event, rangeDays) {
  if (!rangeDays || rangeDays <= 0) return true;
  return String(event.date || event.createdAt || '').slice(0, 10) >= daysAgo(rangeDays - 1);
}

function uniqueCount(events, selector) {
  const s = new Set();
  events.forEach((event) => {
    const value = selector(event);
    if (value) s.add(value);
  });
  return s.size;
}

function count(events, type) {
  return events.filter((event) => event.type === type).length;
}

function dailySeries(events, rangeDays, type) {
  const dates = [];
  for (let i = rangeDays - 1; i >= 0; i -= 1) dates.push(daysAgo(i));
  return dates.map((date) => {
    const dayEvents = events.filter((event) => String(event.date || '').slice(0, 10) === date);
    return {
      date: date.slice(5),
      fullDate: date,
      pv: count(dayEvents, 'page_view'),
      uv: uniqueCount(dayEvents.filter((event) => event.type === 'page_view'), (event) => event.visitorId),
      ai: uniqueCount(dayEvents.filter((event) => event.type === 'ai_used'), (event) => event.userId || event.visitorId),
      notify: uniqueCount(dayEvents.filter((event) => event.type === 'notify_used' || event.type === 'notify_enabled'), (event) => event.userId || event.visitorId),
      switchRuns: count(dayEvents, 'switch_worker_run') + count(dayEvents, 'switch_used'),
      value: type ? count(dayEvents, type) : dayEvents.length
    };
  });
}

export function buildAnalyticsSummary({ rangeDays = 30 } = {}) {
  const allEvents = readEvents();
  const events = allEvents.filter((event) => inRange(event, rangeDays));
  const pageEvents = events.filter((event) => event.type === 'page_view');
  const registeredEvents = allEvents.filter((event) => event.type === 'user_register' || event.type === 'user_login');
  const notifyEvents = events.filter((event) => event.type === 'notify_used' || event.type === 'notify_enabled');
  const aiEvents = events.filter((event) => event.type === 'ai_used');
  const switchEvents = events.filter((event) => event.type === 'switch_worker_run' || event.type === 'switch_used');

  const pageMap = new Map();
  pageEvents.forEach((event) => {
    const key = event.meta?.tab || event.path || 'unknown';
    const row = pageMap.get(key) || { key, pv: 0, uvSet: new Set() };
    row.pv += 1;
    if (event.visitorId) row.uvSet.add(event.visitorId);
    pageMap.set(key, row);
  });

  const featureRows = [
    { key: 'AI 使用', value: aiEvents.length, users: uniqueCount(aiEvents, (event) => event.userId || event.visitorId) },
    { key: '通知使用', value: notifyEvents.length, users: uniqueCount(notifyEvents, (event) => event.userId || event.visitorId) },
    { key: '切换运行', value: switchEvents.length, users: uniqueCount(switchEvents, (event) => event.userId || event.visitorId) }
  ];

  return {
    rangeDays,
    generatedAt: new Date().toISOString(),
    totalEvents: events.length,
    cards: {
      registeredUsers: uniqueCount(registeredEvents, (event) => event.userId || event.username || event.visitorId),
      pv: pageEvents.length,
      uv: uniqueCount(pageEvents, (event) => event.visitorId),
      aiUsers: uniqueCount(aiEvents, (event) => event.userId || event.visitorId),
      notifyUsers: uniqueCount(notifyEvents, (event) => event.userId || event.visitorId),
      switchRuns: switchEvents.length
    },
    daily: dailySeries(events, rangeDays),
    pages: Array.from(pageMap.values()).map((row) => ({ key: row.key, pv: row.pv, uv: row.uvSet.size })).sort((a, b) => b.pv - a.pv).slice(0, 8),
    features: featureRows,
    recent: events.slice(-20).reverse()
  };
}


export async function fetchRemoteAnalyticsSummary({ rangeDays = 30, session = readAnalyticsSession() } = {}) {
  if (!session?.accessToken) throw new Error('请先登录管理员账号');
  const url = new URL(`${getAnalyticsBase()}/admin/analytics`);
  url.searchParams.set('rangeDays', String(rangeDays));
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { authorization: `Bearer ${session.accessToken}` }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || payload.error || `统计服务请求失败：HTTP ${response.status}`);
  return payload;
}

export function clearAnalyticsEvents() {
  writeEvents([]);
  try { window.dispatchEvent(new CustomEvent('analytics:changed')); } catch (_error) { /* ignore */ }
}

export { STORE_KEY as ANALYTICS_STORE_KEY };
