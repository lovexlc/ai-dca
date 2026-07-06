import { trackEvent as trackPostHogEvent, trackPageView as trackPostHogPageView } from './posthog.js';

const STORE_KEY = 'aiDcaAnalyticsEvents_v1';
const PENDING_STORE_KEY = 'aiDcaAnalyticsPendingEvents_v1';
const VISITOR_KEY = 'aiDcaAnalyticsVisitorId_v1';
const SESSION_KEY = 'aiDcaAnalyticsSessionId_v1';
const CLOUD_SESSION_KEY = 'aiDcaCloudSyncSession';
const DEFAULT_SYNC_BASE = 'https://api.freebacktrack.tech/api/sync';
const MAX_EVENTS = 5000;
const MAX_PENDING_EVENTS = 1000;
const ANALYTICS_BATCH_SIZE = 20;
const ANALYTICS_FLUSH_INTERVAL_MS = 30_000;
const ADMIN_USERS = new Set(['lovexl']);
const SESSION_START_KEY = 'aiDcaAnalyticsSessionStarted_v1';
const OPT_OUT_KEY = 'aiDcaAnalyticsOptOut_v1';
const SENSITIVE_META_KEYS = new Set([
  'amount',
  'baseUrl',
  'connectionType',
  'content',
  'cpuCores',
  'deviceMemory',
  'devicePixelRatio',
  'password',
  'hardwareConcurrency',
  'languages',
  'maxTouchPoints',
  'memoryGb',
  'price',
  'platform',
  'raw',
  'remotePath',
  'saveData',
  'screenHeight',
  'screenWidth',
  'sendKey',
  'shares',
  'text',
  'touchPoints',
  'token',
  'uid',
  'url',
  'userAgent',
  'viewportHeight',
  'viewportWidth',
  'username'
]);

let analyticsFlushTimer = null;
let analyticsFlushInFlight = null;
let analyticsFlushHooksInstalled = false;

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

function getAnalyticsEndpoint() {
  if (typeof window !== 'undefined' && window.__AI_DCA_ANALYTICS_ENDPOINT__) {
    return String(window.__AI_DCA_ANALYTICS_ENDPOINT__);
  }
  return `${getAnalyticsBase()}/analytics/track`;
}

function getAnalyticsFlushDelay() {
  if (typeof window === 'undefined') return ANALYTICS_FLUSH_INTERVAL_MS;
  const raw = Number(window.__AI_DCA_ANALYTICS_FLUSH_MS__);
  return Number.isFinite(raw) && raw >= 0 ? raw : ANALYTICS_FLUSH_INTERVAL_MS;
}

function randomId(prefix) {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return `${prefix}:${crypto.randomUUID()}`;
  return `${prefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
}

function normalizeMetaValue(value, depth = 0) {
  if (value == null) return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.slice(0, 240);
  if (Array.isArray(value)) return value.slice(0, 30).map((item) => normalizeMetaValue(item, depth + 1));
  if (typeof value !== 'object' || depth >= 3) return String(value).slice(0, 240);
  const next = {};
  Object.entries(value).slice(0, 60).forEach(([key, entryValue]) => {
    if (SENSITIVE_META_KEYS.has(String(key))) return;
    next[key] = normalizeMetaValue(entryValue, depth + 1);
  });
  return next;
}

function sanitizeMeta(meta = {}) {
  if (!meta || typeof meta !== 'object') return {};
  return normalizeMetaValue(meta) || {};
}

export function isDoNotTrackEnabled() {
  if (typeof window === 'undefined') return false;
  const nav = window.navigator || {};
  const raw = nav.doNotTrack || window.doNotTrack || nav.msDoNotTrack;
  const value = String(raw == null ? '' : raw).toLowerCase();
  return value === '1' || value === 'yes';
}

export function getAnalyticsOptOut() {
  const ls = safeStorage();
  if (!ls) return false;
  return ls.getItem(OPT_OUT_KEY) === '1';
}

export function setAnalyticsOptOut(optedOut) {
  const ls = safeStorage();
  if (!ls) return;
  if (optedOut) {
    ls.setItem(OPT_OUT_KEY, '1');
    ls.removeItem(PENDING_STORE_KEY);
  } else {
    ls.removeItem(OPT_OUT_KEY);
  }
  try {
    window.dispatchEvent(new CustomEvent('analytics:opt-out-changed', { detail: { optedOut: Boolean(optedOut) } }));
  } catch (_error) {
    // ignore
  }
}

export function isAnalyticsCollectionDisabled() {
  return getAnalyticsOptOut() || isDoNotTrackEnabled();
}

function coarseUserAgent(ua = '') {
  const value = String(ua);
  const os = /Windows/i.test(value) ? 'Windows'
    : /iPhone|iPad|iPod/i.test(value) ? 'iOS'
    : /Android/i.test(value) ? 'Android'
    : /Mac OS X|Macintosh/i.test(value) ? 'macOS'
    : /CrOS/i.test(value) ? 'ChromeOS'
    : /Linux/i.test(value) ? 'Linux'
    : 'Other';
  const browser = /Edg\//i.test(value) ? 'Edge'
    : /OPR\/|Opera/i.test(value) ? 'Opera'
    : /Firefox\//i.test(value) ? 'Firefox'
    : /Chrome\//i.test(value) ? 'Chrome'
    : /Safari\//i.test(value) ? 'Safari'
    : 'Other';
  return `${browser} / ${os}`;
}

function getDeviceContext() {
  if (typeof window === 'undefined') return {};
  const nav = window.navigator || {};
  const standalone = Boolean(
    nav.standalone ||
    window.matchMedia?.('(display-mode: standalone)')?.matches ||
    window.matchMedia?.('(display-mode: fullscreen)')?.matches
  );
  const ua = String(nav.userAgent || '');
  const viewportWidth = Number(window.innerWidth || 0);
  const deviceClass = /iPad|Tablet/i.test(ua) || (viewportWidth >= 768 && viewportWidth <= 1180 && Number(nav.maxTouchPoints || 0) > 0)
    ? 'tablet'
    : /Mobi|Android|iPhone|iPod/i.test(ua) || (viewportWidth > 0 && viewportWidth < 768)
      ? 'mobile'
      : 'desktop';
  return {
    deviceClass,
    language: String(nav.language || '').slice(0, 32),
    timezone: Intl.DateTimeFormat?.().resolvedOptions?.().timeZone || '',
    online: Boolean(nav.onLine),
    standalone
  };
}

function getRouteContext() {
  if (typeof window === 'undefined') return {};
  const hash = String(window.location.hash || '');
  const query = new URLSearchParams(window.location.search || '');
  return {
    hash: hash.slice(0, 120),
    tabQuery: String(query.get('tab') || ''),
    routeDepth: hash ? hash.split('/').filter(Boolean).length : 0
  };
}

export function getAnalyticsVisitorId() {
  const ls = safeStorage();
  if (!ls) return 'server';
  if (isAnalyticsCollectionDisabled()) return 'visitor:disabled';
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
  if (isAnalyticsCollectionDisabled()) return 'session:disabled';
  let id = storage.getItem(SESSION_KEY);
  if (!id) {
    id = randomId('session');
    storage.setItem(SESSION_KEY, id);
  }
  return id;
}

function readEvents() {
  return readStoredEventArray(STORE_KEY);
}

function readStoredEventArray(key) {
  const ls = safeStorage();
  if (!ls) return [];
  try {
    const parsed = JSON.parse(ls.getItem(key) || '[]');
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

function readPendingEvents() {
  return readStoredEventArray(PENDING_STORE_KEY);
}

function writePendingEvents(events) {
  const ls = safeStorage();
  if (!ls) return;
  const cleaned = Array.isArray(events) ? events.filter((event) => event && typeof event === 'object') : [];
  if (!cleaned.length) {
    ls.removeItem(PENDING_STORE_KEY);
    return;
  }
  ls.setItem(PENDING_STORE_KEY, JSON.stringify(cleaned.slice(-MAX_PENDING_EVENTS)));
}

function removePendingEvents(sentEvents) {
  const sentIds = new Set(sentEvents.map((event) => event?.id).filter(Boolean));
  if (!sentIds.size) return;
  writePendingEvents(readPendingEvents().filter((event) => !sentIds.has(event?.id)));
}

function enqueuePendingEvent(event) {
  if (!event) return;
  const pending = readPendingEvents();
  pending.push(event);
  writePendingEvents(pending);
  scheduleAnalyticsFlush({ immediate: pending.length >= ANALYTICS_BATCH_SIZE });
}

function installAnalyticsFlushHooks() {
  if (analyticsFlushHooksInstalled || typeof window === 'undefined' || !window.addEventListener) return;
  analyticsFlushHooksInstalled = true;
  window.addEventListener('online', () => scheduleAnalyticsFlush({ immediate: true }));
  window.addEventListener('pagehide', () => {
    flushAnalyticsEvents({ useBeacon: true });
  });
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushAnalyticsEvents({ useBeacon: true });
    });
  }
}

function scheduleAnalyticsFlush({ immediate = false } = {}) {
  if (typeof window === 'undefined' || isAnalyticsCollectionDisabled()) return;
  installAnalyticsFlushHooks();
  if (analyticsFlushInFlight || !readPendingEvents().length) return;
  if (analyticsFlushTimer) {
    if (!immediate) return;
    window.clearTimeout?.(analyticsFlushTimer);
    analyticsFlushTimer = null;
  }
  const delay = immediate ? 0 : getAnalyticsFlushDelay();
  if (typeof window.setTimeout === 'function') {
    analyticsFlushTimer = window.setTimeout(() => {
      analyticsFlushTimer = null;
      flushAnalyticsEvents();
    }, delay);
  } else if (immediate) {
    flushAnalyticsEvents();
  }
}

export async function flushAnalyticsEvents({ useBeacon = false } = {}) {
  if (typeof window === 'undefined') return { ok: false, sent: 0 };
  if (analyticsFlushTimer) {
    window.clearTimeout?.(analyticsFlushTimer);
    analyticsFlushTimer = null;
  }
  if (isAnalyticsCollectionDisabled()) {
    writePendingEvents([]);
    return { ok: false, sent: 0 };
  }
  if (analyticsFlushInFlight) return analyticsFlushInFlight;
  const batch = readPendingEvents().slice(0, ANALYTICS_BATCH_SIZE);
  if (!batch.length) return { ok: true, sent: 0 };

  const payload = JSON.stringify({ events: batch });
  const endpoint = getAnalyticsEndpoint();
  const nav = window.navigator || {};
  if (useBeacon && nav.sendBeacon) {
    const ok = nav.sendBeacon(endpoint, new Blob([payload], { type: 'application/json' }));
    if (ok) removePendingEvents(batch);
    return { ok, sent: ok ? batch.length : 0 };
  }
  if (typeof fetch !== 'function') return { ok: false, sent: 0 };

  analyticsFlushInFlight = fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: payload,
    keepalive: true
  }).then((response) => {
    if (!response?.ok) return { ok: false, sent: 0 };
    removePendingEvents(batch);
    return { ok: true, sent: batch.length };
  }).catch(() => ({ ok: false, sent: 0 })).finally(() => {
    analyticsFlushInFlight = null;
    if (readPendingEvents().length) scheduleAnalyticsFlush();
  });
  return analyticsFlushInFlight;
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
  if (session?.isAdmin) return true;
  const username = String(session?.username || '').trim().toLowerCase();
  return ADMIN_USERS.has(username);
}

export function trackAnalyticsEvent(type, meta = {}) {
  if (!type || typeof window === 'undefined') return null;
  if (isAnalyticsCollectionDisabled()) return null;
  const session = readAnalyticsSession();
  const safeMeta = sanitizeMeta(meta);
  const nav = window.navigator || {};
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
    userAgent: coarseUserAgent(nav.userAgent || ''),
    meta: {
      ...safeMeta,
      context: {
        ...getRouteContext(),
        ...getDeviceContext(),
        ...(safeMeta.context && typeof safeMeta.context === 'object' ? safeMeta.context : {})
      }
    }
  };
  const events = readEvents();
  events.push(event);
  writeEvents(events);

  try {
    window.dispatchEvent(new CustomEvent('analytics:changed', { detail: { event } }));
  } catch (_error) {
    // ignore
  }

  // 同步到 PostHog
  try {
    trackPostHogEvent(type, {
      ...safeMeta,
      visitorId: event.visitorId,
      sessionId: event.sessionId,
      userId: event.userId,
      username: event.username,
      path: event.path
    });
  } catch (error) {
    // PostHog 错误不应影响核心埋点
  }

  enqueuePendingEvent(event);

  return event;
}

export function trackPageView(tab) {
  // 同步到 PostHog
  try {
    trackPostHogPageView({ tab: tab || '' });
  } catch (error) {
    // ignore
  }

  return trackAnalyticsEvent('page_view', { tab: tab || '', feature: 'navigation', action: 'page_view' });
}

function normalizeAdSlotMeta(meta = {}) {
  return {
    slotId: String(meta.slotId || '').slice(0, 80),
    pageTab: String(meta.pageTab || '').slice(0, 40),
    position: String(meta.position || '').slice(0, 80),
    adProvider: String(meta.adProvider || meta.provider || '').slice(0, 60),
    isMobile: Boolean(meta.isMobile),
    visibleMs: Math.max(0, Math.round(Number(meta.visibleMs) || 0)),
    viewport: String(meta.viewport || '').slice(0, 40)
  };
}

export function trackAdSlotView(meta = {}) {
  const payload = normalizeAdSlotMeta(meta);
  if (!payload.slotId) return null;
  return trackAnalyticsEvent('ad_slot_view', {
    feature: 'ads',
    action: 'slot_view',
    ...payload
  });
}

export function trackAdSlotClick(meta = {}) {
  const payload = normalizeAdSlotMeta(meta);
  if (!payload.slotId) return null;
  return trackAnalyticsEvent('ad_slot_click', {
    feature: 'ads',
    action: 'slot_click',
    ...payload
  });
}

export function trackSessionStart(meta = {}) {
  if (typeof window === 'undefined') return null;
  const storage = window.sessionStorage;
  const sessionId = getAnalyticsSessionId();
  if (storage?.getItem(SESSION_START_KEY) === sessionId) return null;
  storage?.setItem(SESSION_START_KEY, sessionId);
  return trackAnalyticsEvent('session_start', {
    feature: 'session',
    action: 'start',
    ...meta
  });
}

export function trackSessionHeartbeat(meta = {}) {
  return trackAnalyticsEvent('session_heartbeat', {
    feature: 'session',
    action: 'heartbeat',
    ...meta
  });
}

export function trackPageEngagement(meta = {}) {
  return trackAnalyticsEvent('page_engagement', {
    feature: 'engagement',
    action: 'page_engagement',
    tab: String(meta.tab || '').slice(0, 40),
    durationMs: Math.max(0, Math.round(Number(meta.durationMs) || 0)),
    activeTimeMs: Math.max(0, Math.round(Number(meta.activeTimeMs) || 0)),
    maxScrollPct: Math.max(0, Math.min(100, Math.round(Number(meta.maxScrollPct) || 0))),
    visibilityChanges: Math.max(0, Math.round(Number(meta.visibilityChanges) || 0))
  });
}

export function trackFeatureEvent(feature, action, meta = {}) {
  return trackAnalyticsEvent(`${feature}_${action}`, {
    feature,
    action,
    ...meta
  });
}

export function trackActionResult(feature, action, status, meta = {}) {
  return trackFeatureEvent(feature, action, {
    status,
    ok: status === 'success',
    ...meta
  });
}

export async function withAnalyticsTiming(feature, action, fn, meta = {}) {
  const startedAt = Date.now();
  trackFeatureEvent(feature, `${action}_start`, meta);
  try {
    const result = await fn();
    trackActionResult(feature, action, 'success', {
      ...meta,
      durationMs: Date.now() - startedAt
    });
    return result;
  } catch (error) {
    trackActionResult(feature, action, 'error', {
      ...meta,
      durationMs: Date.now() - startedAt,
      errorName: error?.name || '',
      errorMessage: String(error?.message || error || '').slice(0, 160)
    });
    throw error;
  }
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

function notifyUserKey(event) {
  return event.userId || event.visitorId || '';
}

function analyticsIdentity(event) {
  return event.userId || event.visitorId || '';
}

function isBackgroundAnalyticsEvent(event) {
  return event.type === 'switch_worker_run' && event.meta?.reason === 'switch-cron';
}

function isVisitorOnlyEvent(event) {
  return Boolean(event.visitorId) && !event.userId && !event.username;
}

function notifyEventDate(event) {
  return String(event.date || event.createdAt || '').slice(0, 10);
}

function getNotifyPlatforms(event) {
  return Array.isArray(event.meta?.platforms) ? event.meta.platforms.map((platform) => String(platform || '')) : [];
}

function inferNotifyPlatformFromPath(path = '') {
  const value = String(path || '');
  if (value.includes('/ws/')) return 'pc';
  if (value.includes('/settings')) return 'serverchan3';
  if (value) return 'ios';
  return '';
}

function getNotifyUsedPlatform(event) {
  return String(
    event.meta?.notifyPlatform ||
    event.meta?.platform ||
    inferNotifyPlatformFromPath(event.meta?.path) ||
    ''
  );
}

function isKnownNotifyEvent(event, platform) {
  const platforms = getNotifyPlatforms(event);
  if (event.type === 'notify_used') return getNotifyUsedPlatform(event) === platform;
  if (event.type !== 'notify_enabled') return false;
  if (platform === 'ios') return Boolean(event.meta?.hasBark) || platforms.includes('ios');
  return platforms.includes(platform);
}

function isUnknownNotifyEvent(event) {
  const platforms = getNotifyPlatforms(event);
  if (event.type === 'notify_used') return !['ios', 'serverchan3', 'pc'].includes(getNotifyUsedPlatform(event));
  if (event.type === 'notify_enabled') {
    return !event.meta?.hasBark && !platforms.some((platform) => ['ios', 'serverchan3', 'pc'].includes(platform));
  }
  return false;
}

function buildNotifyPlatformUserCounts(notifyEvents) {
  const recentUnknownSince = daysAgo(6);
  const userMap = new Map();
  notifyEvents.forEach((event) => {
    const key = notifyUserKey(event);
    if (!key) return;
    const row = userMap.get(key) || {
      ios: false,
      serverchan3: false,
      pc: false,
      unknown: false,
      lastUnknownDate: ''
    };
    row.ios = row.ios || isKnownNotifyEvent(event, 'ios');
    row.serverchan3 = row.serverchan3 || isKnownNotifyEvent(event, 'serverchan3');
    row.pc = row.pc || isKnownNotifyEvent(event, 'pc');
    if (isUnknownNotifyEvent(event)) {
      row.unknown = true;
      const date = notifyEventDate(event);
      if (date > row.lastUnknownDate) row.lastUnknownDate = date;
    }
    userMap.set(key, row);
  });
  const rows = Array.from(userMap.values());
  return {
    ios: rows.filter((row) => row.ios).length,
    serverchan3: rows.filter((row) => row.serverchan3).length,
    pc: rows.filter((row) => row.pc).length,
    unknown: rows.filter((row) => (
      row.unknown &&
      !row.ios &&
      !row.serverchan3 &&
      !row.pc &&
      row.lastUnknownDate >= recentUnknownSince
    )).length
  };
}

function count(events, type) {
  return events.filter((event) => event.type === type).length;
}

function average(rows, selector) {
  const values = rows.map(selector).filter((value) => Number.isFinite(value));
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function dailySeries(events, rangeDays, type) {
  const dates = [];
  for (let i = rangeDays - 1; i >= 0; i -= 1) dates.push(daysAgo(i));
  return dates.map((date) => {
    const dayEvents = events.filter((event) => String(event.date || '').slice(0, 10) === date);
    const userEvents = dayEvents.filter((event) => !isBackgroundAnalyticsEvent(event));
    return {
      date: date.slice(5),
      fullDate: date,
      pv: count(dayEvents, 'page_view'),
      uv: uniqueCount(dayEvents.filter((event) => event.type === 'page_view'), (event) => event.visitorId),
      activeUsers: uniqueCount(userEvents, analyticsIdentity),
      visitorUsers: uniqueCount(dayEvents.filter(isVisitorOnlyEvent), (event) => event.visitorId),
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
  const visitorOnlyEvents = allEvents.filter(isVisitorOnlyEvent);
  const notifyEvents = events.filter((event) => event.type === 'notify_used' || event.type === 'notify_enabled');
  const switchEvents = events.filter((event) => event.type === 'switch_worker_run' || event.type === 'switch_used');
  const adViewEvents = events.filter((event) => event.type === 'ad_slot_view');
  const adClickEvents = events.filter((event) => event.type === 'ad_slot_click');
  const sessionStartEvents = events.filter((event) => event.type === 'session_start');
  const sessionHeartbeatEvents = events.filter((event) => event.type === 'session_heartbeat');
  const pageEngagementEvents = events.filter((event) => event.type === 'page_engagement');
  const premiumSurveySubmitEvents = events.filter((event) => event.type === 'premium_survey_submit');

  const pageMap = new Map();
  pageEvents.forEach((event) => {
    const key = event.meta?.tab || event.path || 'unknown';
    const row = pageMap.get(key) || { key, pv: 0, uvSet: new Set() };
    row.pv += 1;
    if (event.visitorId) row.uvSet.add(event.visitorId);
    pageMap.set(key, row);
  });

  const featureRows = [
    { key: '通知使用', value: notifyEvents.length, users: uniqueCount(notifyEvents, (event) => event.userId || event.visitorId) },
    { key: '切换运行', value: switchEvents.length, users: uniqueCount(switchEvents, (event) => event.userId || event.visitorId) }
  ];

  const adSlotMap = new Map();
  [...adViewEvents, ...adClickEvents].forEach((event) => {
    const slotId = String(event.meta?.slotId || 'unknown');
    const pageTab = String(event.meta?.pageTab || '');
    const position = String(event.meta?.position || '');
    const adProvider = String(event.meta?.adProvider || '');
    const key = [slotId, pageTab, position, adProvider].join('|');
    const row = adSlotMap.get(key) || {
      slotId,
      pageTab,
      position,
      adProvider,
      views: 0,
      clicks: 0,
      userSet: new Set(),
      visibleMsTotal: 0,
      visibleSamples: 0
    };
    if (event.visitorId) row.userSet.add(event.userId || event.visitorId);
    if (event.type === 'ad_slot_view') {
      row.views += 1;
      const visibleMs = Number(event.meta?.visibleMs);
      if (Number.isFinite(visibleMs) && visibleMs > 0) {
        row.visibleMsTotal += visibleMs;
        row.visibleSamples += 1;
      }
    } else {
      row.clicks += 1;
    }
    adSlotMap.set(key, row);
  });

  const engagementTabMap = new Map();
  pageEngagementEvents.forEach((event) => {
    const tab = String(event.meta?.tab || 'unknown');
    const row = engagementTabMap.get(tab) || {
      tab,
      events: 0,
      userSet: new Set(),
      durationMsTotal: 0,
      activeTimeMsTotal: 0,
      maxScrollPctTotal: 0
    };
    row.events += 1;
    if (event.visitorId) row.userSet.add(event.userId || event.visitorId);
    row.durationMsTotal += Math.max(0, Number(event.meta?.durationMs) || 0);
    row.activeTimeMsTotal += Math.max(0, Number(event.meta?.activeTimeMs) || 0);
    row.maxScrollPctTotal += Math.max(0, Math.min(100, Number(event.meta?.maxScrollPct) || 0));
    engagementTabMap.set(tab, row);
  });

  const surveyInterestMap = new Map();
  const surveyPriceMap = new Map();
  const surveyCompletedMap = new Map();
  const surveyCustomTextMap = new Map();
  premiumSurveySubmitEvents.forEach((event) => {
    const interests = Array.isArray(event.meta?.interestOptions) ? event.meta.interestOptions : [];
    interests.forEach((interest) => {
      const key = String(interest || '').slice(0, 80);
      if (key) surveyInterestMap.set(key, (surveyInterestMap.get(key) || 0) + 1);
    });
    const priceOption = String(event.meta?.priceOption || '').slice(0, 80);
    if (priceOption) surveyPriceMap.set(priceOption, (surveyPriceMap.get(priceOption) || 0) + 1);
    const completedOptions = Array.isArray(event.meta?.completedOptions) ? event.meta.completedOptions : [];
    completedOptions.forEach((option) => {
      const key = String(option || '').slice(0, 80);
      if (key) surveyCompletedMap.set(key, (surveyCompletedMap.get(key) || 0) + 1);
    });
    const customText = String(event.meta?.customText || '').trim().slice(0, 160);
    if (customText) {
      const row = surveyCustomTextMap.get(customText) || { text: customText, count: 0, lastAt: '' };
      row.count += 1;
      if (!row.lastAt || String(event.createdAt || '') > row.lastAt) row.lastAt = String(event.createdAt || '');
      surveyCustomTextMap.set(customText, row);
    }
  });

  // 按 feature 前缀聚合详细事件（trackFeatureEvent / trackActionResult 产生的 event.type = `${feature}_${action}`）
  const FEATURE_PREFIXES = [
    { prefix: 'holdings', label: '持仓管理' },
    { prefix: 'markets', label: '行情中心' },
    { prefix: 'dca_calculator', label: 'DCA 回测' },
    { prefix: 'dca', label: '定投计划' },
    { prefix: 'sell_plan', label: '卖出计划' },
    { prefix: 'new_plan', label: '新建策略' },
    { prefix: 'trade_plans', label: '交易计划' },
    { prefix: 'switch_strategy', label: '切换策略' },
    { prefix: 'fund_switch_analysis', label: '切换分析' },
    { prefix: 'fund_switch', label: '基金切换' },
    { prefix: 'notify', label: '消息通知' },
    { prefix: 'vix', label: 'VIX 面板' },
    { prefix: 'premium', label: '高级版' }
  ];
  const featureDetailMap = new Map();
  for (const event of events) {
    const t = String(event.type || '');
    const matched = FEATURE_PREFIXES.find((fp) => t.startsWith(fp.prefix + '_'));
    if (!matched) continue;
    const action = t.slice(matched.prefix.length + 1);
    const groupKey = matched.prefix;
    let group = featureDetailMap.get(groupKey);
    if (!group) {
      group = { prefix: groupKey, label: matched.label, total: 0, success: 0, error: 0, userSet: new Set(), actionMap: new Map() };
      featureDetailMap.set(groupKey, group);
    }
    group.total += 1;
    if (event.visitorId) group.userSet.add(event.visitorId);
    const status = event.meta?.status;
    if (status === 'success') group.success += 1;
    else if (status === 'error' || status === 'validation_error') group.error += 1;
    let actionRow = group.actionMap.get(action);
    if (!actionRow) {
      actionRow = { action, label: action, count: 0, success: 0, error: 0, userSet: new Set() };
      group.actionMap.set(action, actionRow);
    }
    actionRow.count += 1;
    if (event.visitorId) actionRow.userSet.add(event.visitorId);
    if (status === 'success') actionRow.success += 1;
    else if (status === 'error' || status === 'validation_error') actionRow.error += 1;
  }
  const featureDetails = Array.from(featureDetailMap.values())
    .sort((a, b) => b.total - a.total)
    .map((group) => ({
      prefix: group.prefix,
      label: group.label,
      total: group.total,
      success: group.success,
      error: group.error,
      users: group.userSet.size,
      actions: Array.from(group.actionMap.values())
        .sort((a, b) => b.count - a.count)
        .map((row) => ({ action: row.action, label: row.label, count: row.count, success: row.success, error: row.error, users: row.userSet.size }))
    }));
  const daily = dailySeries(events, rangeDays);
  const latestDaily = daily[daily.length - 1] || null;
  const avgDailyActiveUsers = rangeDays > 0
    ? daily.reduce((sum, row) => sum + (Number(row.activeUsers) || 0), 0) / rangeDays
    : 0;

  return {
    rangeDays,
    generatedAt: new Date().toISOString(),
    totalEvents: events.length,
    cards: {
      registeredUsers: uniqueCount(registeredEvents, (event) => event.userId || event.username),
      visitorUsers: uniqueCount(visitorOnlyEvents, (event) => event.visitorId),
      dailyActiveUsers: Number(latestDaily?.activeUsers) || 0,
      avgDailyActiveUsers,
      dailyActiveDate: latestDaily?.fullDate || '',
      pv: pageEvents.length,
      uv: uniqueCount(pageEvents, (event) => event.visitorId),
      notifyUsers: uniqueCount(notifyEvents, (event) => event.userId || event.visitorId),
      switchRuns: switchEvents.length,
      notifyPlatformUsers: buildNotifyPlatformUserCounts(notifyEvents)
    },
    daily,
    pages: Array.from(pageMap.values()).map((row) => ({ key: row.key, pv: row.pv, uv: row.uvSet.size })).sort((a, b) => b.pv - a.pv).slice(0, 8),
    features: featureRows,
    featureDetails,
    ads: {
      views: adViewEvents.length,
      clicks: adClickEvents.length,
      users: uniqueCount([...adViewEvents, ...adClickEvents], (event) => event.userId || event.visitorId),
      ctr: adViewEvents.length ? adClickEvents.length / adViewEvents.length : 0,
      avgVisibleMs: average(adViewEvents, (event) => Number(event.meta?.visibleMs) || 0),
      slots: Array.from(adSlotMap.values()).map((row) => ({
        slotId: row.slotId,
        pageTab: row.pageTab,
        position: row.position,
        adProvider: row.adProvider,
        views: row.views,
        clicks: row.clicks,
        users: row.userSet.size,
        ctr: row.views ? row.clicks / row.views : 0,
        avgVisibleMs: row.visibleSamples ? row.visibleMsTotal / row.visibleSamples : 0
      })).sort((a, b) => b.views - a.views).slice(0, 20)
    },
    engagement: {
      sessions: sessionStartEvents.length,
      sessionUsers: uniqueCount(sessionStartEvents, (event) => event.userId || event.visitorId),
      heartbeats: sessionHeartbeatEvents.length,
      pageEvents: pageEngagementEvents.length,
      avgDurationMs: average(pageEngagementEvents, (event) => Number(event.meta?.durationMs) || 0),
      avgActiveTimeMs: average(pageEngagementEvents, (event) => Number(event.meta?.activeTimeMs) || 0),
      avgScrollPct: average(pageEngagementEvents, (event) => Number(event.meta?.maxScrollPct) || 0),
      byTab: Array.from(engagementTabMap.values()).map((row) => ({
        tab: row.tab,
        events: row.events,
        users: row.userSet.size,
        avgDurationMs: row.events ? row.durationMsTotal / row.events : 0,
        avgActiveTimeMs: row.events ? row.activeTimeMsTotal / row.events : 0,
        avgScrollPct: row.events ? row.maxScrollPctTotal / row.events : 0
      })).sort((a, b) => b.events - a.events).slice(0, 20)
    },
    premiumSurvey: {
      submits: premiumSurveySubmitEvents.length,
      users: uniqueCount(premiumSurveySubmitEvents, (event) => event.userId || event.visitorId),
      interests: Array.from(surveyInterestMap.entries()).map(([key, countValue]) => ({ key, count: countValue })).sort((a, b) => b.count - a.count),
      priceOptions: Array.from(surveyPriceMap.entries()).map(([key, countValue]) => ({ key, count: countValue })).sort((a, b) => b.count - a.count),
      completedOptions: Array.from(surveyCompletedMap.entries()).map(([key, countValue]) => ({ key, count: countValue })).sort((a, b) => b.count - a.count),
      customTexts: Array.from(surveyCustomTextMap.values()).sort((a, b) => (b.lastAt || '').localeCompare(a.lastAt || '')).slice(0, 20)
    },
    recent: events.slice(-20).reverse(),
    userActivity: (() => {
      const userMap = new Map();
      // 排除后台 worker 自动跑的事件（如 switch-cron），只统计用户真实操作
      const realUserEvents = events.filter((e) => !(e.type === 'switch_worker_run' && e.meta?.reason === 'switch-cron'));
      realUserEvents.forEach((event) => {
        const user = event.username || event.userId || event.visitorId || '';
        if (!user) return;
        const row = userMap.get(user) || { user, username: event.username || '', events: 0, eventTypes: new Set(), lastActive: '' };
        row.events += 1;
        row.eventTypes.add(event.type);
        if (!row.lastActive || event.createdAt > row.lastActive) row.lastActive = event.createdAt;
        userMap.set(user, row);
      });
      return Array.from(userMap.values())
        .sort((a, b) => (b.lastActive || '').localeCompare(a.lastActive || ''))
        .slice(0, 20)
        .map((row) => ({ ...row, eventTypes: row.eventTypes.size }));
    })(),
    hourlyActivity: Array.from({ length: 24 }, (_, hour) => {
      const hourEvents = events.filter((e) => { try { return new Date(e.createdAt).getHours() === hour; } catch { return false; } }).filter((e) => !(e.type === 'switch_worker_run' && e.meta?.reason === 'switch-cron'));
      return { hour, events: hourEvents.length, users: uniqueCount(hourEvents, (e) => e.userId || e.visitorId) };
    }),
    dailyActivity: Array.from({ length: 7 }, (_, dow) => {
      const dowEvents = events.filter((e) => { try { return new Date(e.createdAt).getDay() === dow; } catch { return false; } }).filter((e) => !(e.type === 'switch_worker_run' && e.meta?.reason === 'switch-cron'));
      return { dow, events: dowEvents.length, users: uniqueCount(dowEvents, (e) => e.userId || e.visitorId) };
    })
  };
}


export async function fetchRemoteAnalyticsSummary({ rangeDays = 30, sections = [], session = readAnalyticsSession() } = {}) {
  if (!session?.accessToken) throw new Error('请先登录管理员账号');
  const url = new URL(`${getAnalyticsBase()}/admin/analytics`);
  url.searchParams.set('rangeDays', String(rangeDays));
  if (Array.isArray(sections) && sections.length) {
    url.searchParams.set('sections', sections.join(','));
  }
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
