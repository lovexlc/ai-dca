import { DCA_KEY, readDcaState } from './dca.js';
import { readPlanList } from './plan.js';

const NOTIFY_ENDPOINT = '/api/notify';
const NOTIFY_CLIENT_CONFIG_KEY = 'aiDcaNotifyClientConfig';
const NOTIFY_CLIENT_SECRET_HEADER = 'x-notify-client-secret';

function buildDefaultNotifyClientConfig() {
  return {
    barkDeviceKey: '',
    notifyClientId: '',
    notifyClientLabel: '',
    notifyClientSecret: ''
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

function normalizeNotifyClientSecret(value = '') {
  return String(value || '').trim().slice(0, 240);
}

function buildDefaultNotifyClientLabel() {
  if (typeof window === 'undefined') {
    return 'Web 控制台';
  }

  const hostname = String(window.location?.hostname || '').trim();
  return hostname ? `Web 控制台 @ ${hostname}` : 'Web 控制台';
}

function createNotifyClientSecret() {
  if (typeof window !== 'undefined' && window.crypto?.randomUUID) {
    return `${window.crypto.randomUUID()}${window.crypto.randomUUID()}`.replace(/-/g, '');
  }

  if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
    const bytes = new Uint8Array(32);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  }

  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
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
    nextConfig.notifyClientSecret = normalizeNotifyClientSecret(saved?.notifyClientSecret) || createNotifyClientSecret();
    window.localStorage.setItem(NOTIFY_CLIENT_CONFIG_KEY, JSON.stringify(nextConfig));

    return nextConfig;
  } catch (_error) {
    const nextConfig = {
      ...buildDefaultNotifyClientConfig(),
      notifyClientId: createNotifyClientId(),
      notifyClientLabel: buildDefaultNotifyClientLabel(),
      notifyClientSecret: createNotifyClientSecret()
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
    notifyClientLabel: normalizeNotifyClientLabel(nextConfig.notifyClientLabel ?? current.notifyClientLabel ?? '') || current.notifyClientLabel,
    notifyClientSecret: normalizeNotifyClientSecret(nextConfig.notifyClientSecret ?? current.notifyClientSecret ?? '') || current.notifyClientSecret
  };

  window.localStorage.setItem(NOTIFY_CLIENT_CONFIG_KEY, JSON.stringify(payload));
}

function resolveNotifyClientConfig(payload = {}) {
  const current = readNotifyClientConfig();

  return {
    clientId: normalizeNotifyClientId(payload?.clientId || payload?.notifyClientId || current.notifyClientId),
    clientLabel: normalizeNotifyClientLabel(payload?.clientLabel || payload?.clientName || payload?.notifyClientLabel || current.notifyClientLabel),
    clientSecret: normalizeNotifyClientSecret(payload?.clientSecret || payload?.notifyClientSecret || current.notifyClientSecret) || current.notifyClientSecret
  };
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
  const headers = new Headers(init.headers || {});
  const clientSecret = normalizeNotifyClientSecret(init.clientConfig?.clientSecret);

  if (clientSecret) {
    headers.set(NOTIFY_CLIENT_SECRET_HEADER, clientSecret);
  }

  const response = await fetch(buildNotifyUrl(path, init.query), {
    ...init,
    query: undefined,
    clientConfig: undefined,
    headers
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
  const clientConfig = resolveNotifyClientConfig({
    clientId
  });

  return requestNotify('/status', {
    clientConfig,
    query: {
      clientId: clientConfig.clientId
    }
  });
}

export function loadNotifyEvents(clientId = '') {
  const clientConfig = resolveNotifyClientConfig({
    clientId
  });

  return requestNotify('/events', {
    clientConfig,
    query: {
      clientId: clientConfig.clientId
    }
  });
}

export function syncTradePlanRules(payload = buildNotifySyncPayload()) {
  const clientConfig = resolveNotifyClientConfig(payload);

  return requestNotify('/sync', {
    clientConfig,
    query: {
      clientId: clientConfig.clientId
    },
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      ...payload,
      clientLabel: clientConfig.clientLabel
    })
  });
}

export function sendNotifyTest(payload = {}) {
  const clientConfig = resolveNotifyClientConfig(payload);

  return requestNotify('/test', {
    clientConfig,
    query: {
      clientId: clientConfig.clientId
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
  const clientConfig = resolveNotifyClientConfig(payload);

  return requestNotify('/settings', {
    clientConfig,
    query: {
      clientId: clientConfig.clientId
    },
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      ...payload,
      clientLabel: clientConfig.clientLabel
    })
  });
}

export function issueNotifyGroupShareCode(payload = {}) {
  const clientConfig = resolveNotifyClientConfig(payload);

  return requestNotify('/group/share-code', {
    clientConfig,
    query: {
      clientId: clientConfig.clientId
    },
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      clientId: clientConfig.clientId,
      clientLabel: clientConfig.clientLabel
    })
  });
}

export function joinNotifyGroup(payload = {}) {
  const clientConfig = resolveNotifyClientConfig(payload);

  return requestNotify('/group/join', {
    clientConfig,
    query: {
      clientId: clientConfig.clientId
    },
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      shareCode: String(payload.shareCode || payload.code || '').trim(),
      clientId: clientConfig.clientId,
      clientLabel: clientConfig.clientLabel
    })
  });
}

export function pairAndroidDevice(payload = {}) {
  const clientConfig = resolveNotifyClientConfig(payload);

  return requestNotify('/gcm/pair', {
    clientConfig,
    query: {
      clientId: clientConfig.clientId
    },
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      ...payload,
      clientId: clientConfig.clientId,
      clientName: clientConfig.clientLabel
    })
  });
}

export function unpairAndroidDevice(payload = {}) {
  const clientConfig = resolveNotifyClientConfig(payload);

  return requestNotify('/gcm/unpair', {
    clientConfig,
    query: {
      clientId: clientConfig.clientId
    },
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      ...payload,
      clientId: clientConfig.clientId
    })
  });
}

function normalizeHoldingsDigest(digest) {
  const result = { version: 1, generatedAt: '', exchange: [], otc: [] };
  if (!digest || typeof digest !== 'object') return result;
  if (digest.generatedAt) result.generatedAt = String(digest.generatedAt);
  for (const bucket of ['exchange', 'otc']) {
    const list = Array.isArray(digest[bucket]) ? digest[bucket] : [];
    for (const entry of list) {
      const code = String(entry?.code || '').trim();
      const weight = Number(entry?.weight);
      if (!/^\d{6}$/.test(code)) continue;
      if (!Number.isFinite(weight) || weight <= 0) continue;
      result[bucket].push({ code, weight });
    }
  }
  return result;
}

/** 读取当前 client 的「持仓当日总收益」通知规则；未配置时返回禁用状态。 */
export function loadHoldingsNotifyRule() {
  const clientConfig = resolveNotifyClientConfig();

  return requestNotify('/holdings-rule', {
    clientConfig,
    query: {
      clientId: clientConfig.clientId
    }
  });
}

/**
 * 保存当前 client 的「持仓当日总收益」通知规则。
 * 仅同步代码 + 组合权重，不上传份额/成本/金额。
 */
export function saveHoldingsNotifyRule({ enabled = false, digest = null } = {}) {
  const clientConfig = resolveNotifyClientConfig();
  const normalizedDigest = normalizeHoldingsDigest(digest);

  return requestNotify('/holdings-rule', {
    clientConfig,
    query: {
      clientId: clientConfig.clientId
    },
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      clientId: clientConfig.clientId,
      clientLabel: clientConfig.clientLabel,
      enabled: Boolean(enabled),
      digest: normalizedDigest
    })
  });
}
