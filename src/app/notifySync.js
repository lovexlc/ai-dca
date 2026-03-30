import { DCA_KEY, readDcaState } from './dca.js';
import { readPlanList } from './plan.js';

const NOTIFY_ENDPOINT = '/api/notify';
const NOTIFY_CLIENT_CONFIG_KEY = 'aiDcaNotifyClientConfig';

function buildDefaultNotifyClientConfig() {
  return {
    gotifyBaseUrl: '',
    gotifyUsername: '',
    gotifyPassword: '',
    barkDeviceKey: '',
    gcmProjectId: '',
    gcmPackageName: '',
    gcmDeviceName: '',
    gcmToken: ''
  };
}

export function readNotifyClientConfig() {
  if (typeof window === 'undefined') {
    return buildDefaultNotifyClientConfig();
  }

  try {
    const saved = JSON.parse(window.localStorage.getItem(NOTIFY_CLIENT_CONFIG_KEY) || 'null');
    return {
      ...buildDefaultNotifyClientConfig(),
      gotifyBaseUrl: String(saved?.gotifyBaseUrl || '').trim(),
      gotifyUsername: String(saved?.gotifyUsername || '').trim(),
      gotifyPassword: String(saved?.gotifyPassword || '').trim(),
      barkDeviceKey: String(saved?.barkDeviceKey || '').trim(),
      gcmProjectId: String(saved?.gcmProjectId || '').trim(),
      gcmPackageName: String(saved?.gcmPackageName || '').trim(),
      gcmDeviceName: String(saved?.gcmDeviceName || '').trim(),
      gcmToken: String(saved?.gcmToken || '').trim()
    };
  } catch (_error) {
    return buildDefaultNotifyClientConfig();
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
    gotifyBaseUrl: String(nextConfig.gotifyBaseUrl ?? current.gotifyBaseUrl ?? '').trim(),
    gotifyUsername: String(nextConfig.gotifyUsername ?? current.gotifyUsername ?? '').trim(),
    gotifyPassword: String(nextConfig.gotifyPassword ?? current.gotifyPassword ?? '').trim(),
    barkDeviceKey: String(nextConfig.barkDeviceKey ?? current.barkDeviceKey ?? '').trim(),
    gcmProjectId: String(nextConfig.gcmProjectId ?? current.gcmProjectId ?? '').trim(),
    gcmPackageName: String(nextConfig.gcmPackageName ?? current.gcmPackageName ?? '').trim(),
    gcmDeviceName: String(nextConfig.gcmDeviceName ?? current.gcmDeviceName ?? '').trim(),
    gcmToken: String(nextConfig.gcmToken ?? current.gcmToken ?? '').trim()
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

async function requestNotify(path, init = {}) {
  const response = await fetch(`${NOTIFY_ENDPOINT}${path}`, {
    ...init,
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

export function loadNotifyStatus() {
  return requestNotify('/status');
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

export function sendNotifyTest() {
  return requestNotify('/test', {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      title: '交易计划测试提醒',
      body: '这是一条测试通知，用来校验当前已接入的提醒通道是否可用。'
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

export function generateGotifyClientAccount() {
  return requestNotify('/gotify-account', {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({})
  });
}

export function registerGcmClient(payload = {}) {
  return requestNotify('/gcm/register', {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
}

export function checkGcmConnection(payload = {}) {
  return requestNotify('/gcm/check', {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
}
