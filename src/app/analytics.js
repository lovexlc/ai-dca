const STORE_KEY = 'aiDcaAnalyticsEvents_v1';
const VISITOR_KEY = 'aiDcaAnalyticsVisitorId_v1';
const SESSION_KEY = 'aiDcaAnalyticsSessionId_v1';
const CLOUD_SESSION_KEY = 'aiDcaCloudSyncSession';
const DEFAULT_SYNC_BASE = 'https://tools.freebacktrack.tech/api/sync';
const MAX_EVENTS = 5000;
const ADMIN_USERS = new Set(['lovexl']);
const SENSITIVE_META_KEYS = new Set([
  'amount',
  'baseUrl',
  'content',
  'password',
  'price',
  'raw',
  'remotePath',
  'sendKey',
  'shares',
  'text',
  'token',
  'uid',
  'url',
  'username'
]);

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

function getDeviceContext() {
  if (typeof window === 'undefined') return {};
  const nav = window.navigator || {};
  const connection = nav.connection || nav.mozConnection || nav.webkitConnection || {};
  const standalone = Boolean(
    nav.standalone ||
    window.matchMedia?.('(display-mode: standalone)')?.matches ||
    window.matchMedia?.('(display-mode: fullscreen)')?.matches
  );
  return {
    viewportWidth: Math.round(window.innerWidth || 0),
    viewportHeight: Math.round(window.innerHeight || 0),
    screenWidth: Math.round(window.screen?.width || 0),
    screenHeight: Math.round(window.screen?.height || 0),
    devicePixelRatio: Number(window.devicePixelRatio || 1),
    language: String(nav.language || '').slice(0, 32),
    languages: Array.isArray(nav.languages) ? nav.languages.slice(0, 4).join(',') : '',
    timezone: Intl.DateTimeFormat?.().resolvedOptions?.().timeZone || '',
    online: Boolean(nav.onLine),
    platform: String(nav.platform || '').slice(0, 64),
    touchPoints: Number(nav.maxTouchPoints || 0),
    standalone,
    connectionType: String(connection.effectiveType || connection.type || '').slice(0, 32),
    saveData: Boolean(connection.saveData),
    memoryGb: Number(nav.deviceMemory || 0) || null,
    cpuCores: Number(nav.hardwareConcurrency || 0) || null
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
  const safeMeta = sanitizeMeta(meta);
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
  return trackAnalyticsEvent('page_view', { tab: tab || '', feature: 'navigation', action: 'page_view' });
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
    { prefix: 'home', label: '首页' },
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
      switchRuns: switchEvents.length,
      notifyPlatformUsers: {
        ios: uniqueCount(notifyEvents.filter((e) => (e.type === 'notify_enabled' && e.meta?.hasBark) || (e.type === 'notify_used' && e.meta?.platform === 'ios')), (e) => e.userId || e.visitorId),
        serverchan3: uniqueCount(notifyEvents.filter((e) => (e.type === 'notify_used' && e.meta?.platform === 'serverchan3') || (e.type === 'notify_enabled' && Array.isArray(e.meta?.platforms) && e.meta.platforms.includes('serverchan3'))), (e) => e.userId || e.visitorId),
        pc: uniqueCount(notifyEvents.filter((e) => (e.type === 'notify_used' && e.meta?.platform === 'pc') || (e.type === 'notify_enabled' && Array.isArray(e.meta?.platforms) && e.meta.platforms.includes('pc'))), (e) => e.userId || e.visitorId),
        unknown: uniqueCount(notifyEvents.filter((e) => {
          const platforms = Array.isArray(e.meta?.platforms) ? e.meta.platforms : [];
          if (e.type === 'notify_used') return !['ios', 'serverchan3', 'pc'].includes(String(e.meta?.platform || ''));
          if (e.type === 'notify_enabled') return !e.meta?.hasBark && !platforms.some((platform) => ['serverchan3', 'pc'].includes(platform));
          return false;
        }), (e) => e.userId || e.visitorId)
      }
    },
    daily: dailySeries(events, rangeDays),
    pages: Array.from(pageMap.values()).map((row) => ({ key: row.key, pv: row.pv, uv: row.uvSet.size })).sort((a, b) => b.pv - a.pv).slice(0, 8),
    features: featureRows,
    featureDetails,
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
