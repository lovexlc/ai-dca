import { DCA_KEY, readDcaState } from './dca.js';
import { readPlanList } from './plan.js';

const NOTIFY_ENDPOINT = '/api/notify';
const NOTIFY_CLIENT_CONFIG_KEY = 'aiDcaNotifyClientConfig';

function buildDefaultNotifyClientConfig() {
  return {
    barkDeviceKey: ''
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
      barkDeviceKey: String(saved?.barkDeviceKey || '').trim()
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
    barkDeviceKey: String(nextConfig.barkDeviceKey ?? current.barkDeviceKey ?? '').trim()
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
