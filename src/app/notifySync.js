import { DCA_KEY, readDcaState } from './dca.js';
import { readPlanList } from './plan.js';

const NOTIFY_ENDPOINT = '/api/notify';
const NOTIFY_ADMIN_TOKEN_KEY = 'aiDcaNotifyAdminToken';

function buildHeaders(baseHeaders = {}) {
  const headers = new Headers(baseHeaders);
  const adminToken = readNotifyAdminToken();

  if (adminToken) {
    headers.set('x-notify-admin-token', adminToken);
  }

  return headers;
}

export function readNotifyAdminToken() {
  if (typeof window === 'undefined') {
    return '';
  }

  return String(window.localStorage.getItem(NOTIFY_ADMIN_TOKEN_KEY) || '').trim();
}

export function persistNotifyAdminToken(token = '') {
  if (typeof window === 'undefined') {
    return;
  }

  const normalized = String(token || '').trim();
  if (normalized) {
    window.localStorage.setItem(NOTIFY_ADMIN_TOKEN_KEY, normalized);
    return;
  }

  window.localStorage.removeItem(NOTIFY_ADMIN_TOKEN_KEY);
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
    headers: buildHeaders(init.headers)
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
      body: '这是一条测试通知，用来校验 Bark 和 Gotify 是否配置成功。'
    })
  });
}
