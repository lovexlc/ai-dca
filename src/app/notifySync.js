import { DCA_KEY, readDcaState } from './dca.js';
import { readPlanList } from './plan.js';

const NOTIFY_ENDPOINT = '/api/notify';
const NOTIFY_CLIENT_CONFIG_KEY = 'aiDcaNotifyClientConfig';

function buildDefaultNotifyClientConfig() {
  return {
    barkDeviceKey: '',
    notifyClientId: '',
    notifyClientLabel: ''
  };
}

function createNotifyClientId() {
  if (typeof window !== 'undefined' && window.crypto?.randomUUID) {
    return `web:${window.crypto.randomUUID()}`;
  }

  if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    return `web:${Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')}`;
  }

  return `web:${Date.now().toString(36)}`;
}

function normalizeNotifyClientId(value = '') {
  return String(value || '').trim().slice(0, 120);
}

function normalizeNotifyClientLabel(value = '') {
  return String(value || '').trim().slice(0, 120);
}

function buildDefaultNotifyClientLabel() {
  if (typeof window === 'undefined') {
    return 'Web 控制台';
  }

  const hostname = String(window.location?.hostname || '').trim();
  return hostname ? `Web 控制台 @ ${hostname}` : 'Web 控制台';
}

export function readNotifyClientConfig() {
  if (typeof window === 'undefined') {
    return buildDefaultNotifyClientConfig();
  }

  try {
    const saved = JSON.parse(window.localStorage.getItem(NOTIFY_CLIENT_CONFIG_KEY) || 'null');
    const nextConfig = {
      ...buildDefaultNotifyClientConfig(),
      barkDeviceKey: String(saved?.barkDeviceKey || '').trim()
    };

    nextConfig.notifyClientId = normalizeNotifyClientId(saved?.notifyClientId) || createNotifyClientId();
    nextConfig.notifyClientLabel = normalizeNotifyClientLabel(saved?.notifyClientLabel) || buildDefaultNotifyClientLabel();
    window.localStorage.setItem(NOTIFY_CLIENT_CONFIG_KEY, JSON.stringify(nextConfig));

    return nextConfig;
  } catch (_error) {
    const nextConfig = {
      ...buildDefaultNotifyClientConfig(),
      notifyClientId: createNotifyClientId(),
      notifyClientLabel: buildDefaultNotifyClientLabel()
    };

    window.localStorage.setItem(NOTIFY_CLIENT_CONFIG_KEY, JSON.stringify(nextConfig));
    return nextConfig;
  }
}

export function persistNotifyClientConfig(nextConfig = {}) {
  if (typeof window === 'undefined') {
    return;
  }

  const current = readNotifyClientConfig();
  const payload = {
    ...current,
    ...nextConfig,
    barkDeviceKey: String(nextConfig.barkDeviceKey ?? current.barkDeviceKey ?? '').trim(),
    notifyClientId: normalizeNotifyClientId(nextConfig.notifyClientId ?? current.notifyClientId ?? '') || current.notifyClientId,
    notifyClientLabel: normalizeNotifyClientLabel(nextConfig.notifyClientLabel ?? current.notifyClientLabel ?? '') || current.notifyClientLabel
  };

  window.localStorage.setItem(NOTIFY_CLIENT_CONFIG_KEY, JSON.stringify(payload));
}

async function readJsonResponse(response) {
  const rawText = await response.text();

  if (!rawText) {
    return {};
  }

  try {
    return JSON.parse(rawText);
  } catch (_error) {
    return {
      error: rawText
    };
  }
}

function buildNotifyUrl(path, query = {}) {
  const url = new URL(`${NOTIFY_ENDPOINT}${path}`, typeof window === 'undefined' ? 'https://localhost' : window.location.origin);

  Object.entries(query || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      return;
    }

    url.searchParams.set(key, String(value));
  });

  return `${url.pathname}${url.search}`;
}

async function requestNotify(path, init = {}) {
  const response = await fetch(buildNotifyUrl(path, init.query), {
    ...init,
    query: undefined,
    headers: init.headers
  });
  const payload = await readJsonResponse(response);

  if (!response.ok) {
    throw new Error(payload.error || `通知服务请求失败：状态 ${response.status}`);
  }

  return payload;
}

function hasPersistedDca() {
  if (typeof window === 'undefined') {
    return false;
  }

  return Boolean(window.localStorage.getItem(DCA_KEY));
}

export function buildNotifySyncPayload() {
  const plans = readPlanList();
  const dca = hasPersistedDca() ? readDcaState() : null;

  return {
    plans,
    dca,
    syncedAt: new Date().toISOString()
  };
}

export function loadNotifyStatus(clientId = '') {
  return requestNotify('/status', {
    query: {
      clientId
    }
  });
}

export function loadNotifyEvents() {
  return requestNotify('/events');
}

export function syncTradePlanRules(payload = buildNotifySyncPayload()) {
  return requestNotify('/sync', {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
}

export function sendNotifyTest(payload = {}) {
  return requestNotify('/test', {
    query: {
      clientId: payload.clientId || ''
    },
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      title: String(payload.title || '交易计划测试提醒'),
      body: String(payload.body || '这是一条测试通知，用来校验当前已接入的提醒通道是否可用。'),
      summary: String(payload.summary || '测试通知'),
      ruleId: String(payload.ruleId || 'test')
    })
  });
}

export function saveNotifySettings(payload = {}) {
  return requestNotify('/settings', {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
}

export function pairAndroidDevice(payload = {}) {
  return requestNotify('/gcm/pair', {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
}

export function unpairAndroidDevice(payload = {}) {
  return requestNotify('/gcm/unpair', {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
}
