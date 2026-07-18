import { trackAnalyticsEvent, trackFeatureEvent } from './analytics.js';
import { consumeAcceptedConversionPrompt } from './conversionPrompts.js';
import {
  CLOUD_SYNC_SESSION_EVENT,
  CLOUD_SYNC_SESSION_KEY,
  clearCloudSession,
  loadCloudSession,
  saveCloudSession
} from './authSession.js';
import { getAccountDataScope, isAccountDataScopeReady, normalizeAccountUsername } from './accountDataScope.js';
import { getClientId } from './syncClient.js';
import { apiUrl } from './apiBase.js';

export {
  CLOUD_SYNC_SESSION_EVENT,
  CLOUD_SYNC_SESSION_KEY,
  clearCloudSession,
  loadCloudSession,
  saveCloudSession
};

const DEFAULT_SYNC_BASE = apiUrl('/api/sync');
const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

function getSyncBase() {
  if (typeof window !== 'undefined' && window.__AI_DCA_SYNC_BASE__) {
    return String(window.__AI_DCA_SYNC_BASE__).replace(/\/$/, '');
  }
  return DEFAULT_SYNC_BASE;
}

function rightRotate(value, bits) {
  return (value >>> bits) | (value << (32 - bits));
}

function sha256HexFallback(text) {
  const bytes = new TextEncoder().encode(String(text || ''));
  const bitLength = bytes.length * 8;
  const paddedLength = (((bytes.length + 9 + 63) >> 6) << 6);
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const w = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rightRotate(w[i - 15], 7) ^ rightRotate(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rightRotate(w[i - 2], 17) ^ rightRotate(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let i = 0; i < 64; i++) {
      const s1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const s0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7].map((value) => value.toString(16).padStart(8, '0')).join('');
}

async function sha256Hex(text, cryptoLike = globalThis.crypto) {
  const bytes = new TextEncoder().encode(String(text || ''));
  const digestFn = cryptoLike?.subtle?.digest;
  if (typeof digestFn === 'function') {
    const digest = await digestFn.call(cryptoLike.subtle, 'SHA-256', bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  return sha256HexFallback(text);
}

async function passwordHash(username, password) {
  return sha256Hex(`${String(username || '').trim().toLowerCase()}:${String(password || '')}`);
}

export const __internals = {
  sha256Hex,
  sha256HexFallback,
  passwordHash,
  requestSync
};

async function readJson(response) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : {}; } catch { return { message: text }; }
}

const syncRequestControllers = new Map();

function linkAbortSignal(controller, signal) {
  if (!signal || typeof signal.addEventListener !== 'function') return () => {};
  if (signal.aborted) {
    controller.abort(signal.reason);
    return () => {};
  }
  const onAbort = () => controller.abort(signal.reason);
  signal.addEventListener('abort', onAbort, { once: true });
  return () => signal.removeEventListener('abort', onAbort);
}

async function requestSync(path, { token = '', requestKey = '', signal: externalSignal = null, ...init } = {}) {
  const headers = { 'content-type': 'application/json; charset=utf-8', ...(init.headers || {}) };
  if (token) headers.authorization = `Bearer ${token}`;
  const method = String(init.method || 'GET').toUpperCase();
  // 只对读请求按同名 key 去重；写请求不能因为短时间内的第二次保存而丢失第一次提交。
  const key = String(requestKey || (method === 'GET' ? `${method}:${path}` : ''));
  const previousController = key ? syncRequestControllers.get(key) : null;
  previousController?.abort();

  const controller = key && typeof AbortController === 'function' ? new AbortController() : null;
  const unlinkAbortSignal = controller ? linkAbortSignal(controller, externalSignal) : () => {};
  if (controller) syncRequestControllers.set(key, controller);
  try {
    const response = await fetch(`${getSyncBase()}${path}`, {
      ...init,
      headers,
      ...(controller ? { signal: controller.signal } : externalSignal ? { signal: externalSignal } : {})
    });
    const data = await readJson(response);
    if (!response.ok) {
      const error = new Error(data?.message || data?.error || `请求失败：HTTP ${response.status}`);
      error.status = response.status;
      error.data = data;
      error.response = response;
      throw error;
    }
    return data;
  } finally {
    unlinkAbortSignal();
    if (controller && syncRequestControllers.get(key) === controller) {
      syncRequestControllers.delete(key);
    }
  }
}

export async function registerCloudAccount({ username, password }) {
  const normalized = String(username || '').trim().toLowerCase();
  if (normalized.length < 3) throw new Error('用户名至少 3 位');
  if (String(password || '').length < 8) throw new Error('登录密码至少 8 位');
  const data = await requestSync('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username: normalized, passwordHash: await passwordHash(normalized, password) })
  });
  const session = saveCloudSession(data);
  trackAnalyticsEvent('user_register', { username: normalized });
  const conversionPrompt = consumeAcceptedConversionPrompt();
  if (conversionPrompt?.trigger) {
    trackFeatureEvent('conversion', 'register_success', {
      trigger: conversionPrompt.trigger,
      ...(conversionPrompt.meta || {})
    });
  }
  return session;
}

export async function loginCloudAccount({ username, password }) {
  const normalized = String(username || '').trim().toLowerCase();
  const data = await requestSync('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: normalized, passwordHash: await passwordHash(normalized, password) })
  });
  const session = saveCloudSession(data);
  trackAnalyticsEvent('user_login', { username: normalized });
  return session;
}

export async function fetchCloudSyncMeta(session = loadCloudSession()) {
  if (!session?.accessToken) return null;
  return requestSync('/meta', { method: 'GET', token: session.accessToken });
}

export async function fetchLatestCloudBackup(session = loadCloudSession()) {
  if (!session?.accessToken) throw new Error('请先登录账户');
  return requestSync('/latest', { method: 'GET', token: session.accessToken });
}

export async function uploadLatestCloudBackup(payload, session = loadCloudSession()) {
  if (!session?.accessToken) throw new Error('请先登录账户');
  return requestSync('/latest', {
    method: 'PUT',
    token: session.accessToken,
    body: JSON.stringify(payload || {})
  });
}

export async function fetchSecureSyncConfig(key, session = loadCloudSession()) {
  return requestSync(`/secure-config?key=${encodeURIComponent(String(key || ''))}`, {
    method: 'GET',
    token: session?.accessToken || ''
  });
}

export async function putSecureSyncConfig(key, encrypted, session = loadCloudSession()) {
  return requestSync('/secure-config', {
    method: 'PUT',
    token: session?.accessToken || '',
    body: JSON.stringify({ key: String(key || ''), encrypted })
  });
}

export async function deleteSecureSyncConfig(key, session = loadCloudSession()) {
  return requestSync(`/secure-config?key=${encodeURIComponent(String(key || ''))}`, {
    method: 'DELETE',
    token: session?.accessToken || ''
  });
}

function normalizeUserDataResource(resource) {
  return encodeURIComponent(String(resource || '').trim());
}

export async function fetchUserDataManifest(session = loadCloudSession(), deviceId = '', { accountScope = false } = {}) {
  const query = new URLSearchParams();
  const resolvedDeviceId = String(deviceId || getClientId()).trim();
  if (accountScope || isAccountDataScopeReady(session, resolvedDeviceId)) {
    query.set('scope', 'account');
    query.set('accountUsername', normalizeAccountUsername(session?.username));
  } else if (resolvedDeviceId) query.set('deviceId', resolvedDeviceId);
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return requestSync(`/data/manifest${suffix}`, { method: 'GET', token: session?.accessToken || '' });
}

export async function fetchUserDataResource(resource, session = loadCloudSession()) {
  const suffix = accountScopeSuffix(session);
  return requestSync(`/data/${normalizeUserDataResource(resource)}${suffix ? `?${suffix}` : ''}`, {
    method: 'GET',
    token: session?.accessToken || ''
  });
}

export async function putUserDataResource(resource, payload = {}, session = loadCloudSession()) {
  const suffix = accountScopeSuffix(session);
  return requestSync(`/data/${normalizeUserDataResource(resource)}${suffix ? `?${suffix}` : ''}`, {
    method: 'PUT',
    token: session?.accessToken || '',
    body: JSON.stringify(payload || {})
  });
}

export async function deleteUserDataResource(resource, payload = {}, session = loadCloudSession()) {
  const suffix = accountScopeSuffix(session);
  return requestSync(`/data/${normalizeUserDataResource(resource)}${suffix ? `?${suffix}` : ''}`, {
    method: 'DELETE',
    token: session?.accessToken || '',
    body: JSON.stringify(payload || {})
  });
}

function normalizeTabResourcePart(value) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.includes('/') || normalized === '.' || normalized === '..') {
    throw new Error('同步资源路径不合法');
  }
  return encodeURIComponent(normalized);
}

function accountScopeSuffix(session = loadCloudSession(), explicitDeviceId = '') {
  const deviceId = String(explicitDeviceId || getClientId()).trim();
  const query = new URLSearchParams();
  if (isAccountDataScopeReady(session, deviceId)) {
    query.set('scope', 'account');
    query.set('accountUsername', normalizeAccountUsername(session?.username));
  } else if (explicitDeviceId) {
    query.set('deviceId', deviceId);
  }
  return query.toString();
}

function tabResourcePath(tab, resource, session = loadCloudSession()) {
  const path = `/${normalizeTabResourcePart(tab)}/${normalizeTabResourcePart(resource)}`;
  const suffix = accountScopeSuffix(session);
  return suffix ? `${path}?${suffix}` : path;
}

export async function fetchTabResource(tab, resource, session = loadCloudSession()) {
  return requestSync(tabResourcePath(tab, resource, session), {
    method: 'GET',
    token: session?.accessToken || ''
  });
}

export async function putTabResource(tab, resource, payload = {}, session = loadCloudSession()) {
  return requestSync(tabResourcePath(tab, resource, session), {
    method: 'PUT',
    token: session?.accessToken || '',
    body: JSON.stringify(payload || {})
  });
}

export async function postTabResource(tab, resource, payload = {}, session = loadCloudSession()) {
  return requestSync(tabResourcePath(tab, resource, session), {
    method: 'POST',
    token: session?.accessToken || '',
    body: JSON.stringify(payload || {})
  });
}

export async function deleteTabResource(tab, resource, payload = {}, session = loadCloudSession()) {
  return requestSync(tabResourcePath(tab, resource, session), {
    method: 'DELETE',
    token: session?.accessToken || '',
    body: JSON.stringify(payload || {})
  });
}

export async function fetchUserDataMigration(deviceId, session = loadCloudSession()) {
  const query = deviceId ? `?deviceId=${encodeURIComponent(String(deviceId))}` : '';
  return requestSync(`/migration${query}`, { method: 'GET', token: session?.accessToken || '' });
}

export async function updateUserDataMigration(payload = {}, session = loadCloudSession()) {
  return requestSync('/migration', {
    method: 'POST',
    token: session?.accessToken || '',
    body: JSON.stringify(payload || {})
  });
}

function normalizeSyncDevice(device = {}) {
  return {
    deviceId: String(device.deviceId || device.id || '').trim(),
    deviceType: String(device.deviceType || device.type || '').trim().slice(0, 40),
    sessionId: String(device.sessionId || '').trim().slice(0, 120),
    localSignature: String(device.localSignature || '').trim(),
    hasLocalData: Boolean(device.hasLocalData)
  };
}

export async function fetchSyncV2Snapshot(device = {}, session = loadCloudSession()) {
  const normalized = normalizeSyncDevice(device);
  const query = new URLSearchParams();
  if (normalized.deviceId) query.set('deviceId', normalized.deviceId);
  if (normalized.deviceType) query.set('deviceType', normalized.deviceType);
  if (normalized.sessionId) query.set('sessionId', normalized.sessionId);
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return requestSync(`/v2/snapshot${suffix}`, { method: 'GET', token: session?.accessToken || '' });
}

export async function registerSyncDevice(device = {}, session = loadCloudSession()) {
  return requestSync('/v2/devices/register', {
    method: 'POST',
    token: session?.accessToken || '',
    body: JSON.stringify(normalizeSyncDevice(device))
  });
}

export async function acquireSyncWriter({ deviceId, deviceType, sessionId = '', takeover = false, migration = false } = {}, session = loadCloudSession()) {
  return requestSync('/v2/writer/acquire', {
    method: 'POST',
    token: session?.accessToken || '',
    body: JSON.stringify({
      deviceId: String(deviceId || '').trim(),
      deviceType: String(deviceType || '').trim().slice(0, 40),
      sessionId: String(sessionId || '').trim().slice(0, 120),
      takeover: Boolean(takeover),
      migration: Boolean(migration)
    })
  });
}

export async function heartbeatSyncWriter({ deviceId, sessionId = '', writerToken } = {}, session = loadCloudSession()) {
  return requestSync('/v2/writer/heartbeat', {
    method: 'POST',
    token: session?.accessToken || '',
    body: JSON.stringify({ deviceId: String(deviceId || '').trim(), sessionId: String(sessionId || '').trim().slice(0, 120), writerToken: String(writerToken || '') })
  });
}

export async function releaseSyncWriter({ deviceId, sessionId = '', writerToken } = {}, session = loadCloudSession()) {
  return requestSync('/v2/writer/release', {
    method: 'POST',
    token: session?.accessToken || '',
    body: JSON.stringify({ deviceId: String(deviceId || '').trim(), sessionId: String(sessionId || '').trim().slice(0, 120), writerToken: String(writerToken || '') })
  });
}

export async function putSyncV2Snapshot(payload = {}, session = loadCloudSession()) {
  return requestSync('/v2/snapshot', {
    method: 'PUT',
    token: session?.accessToken || '',
    body: JSON.stringify(payload)
  });
}

export async function fetchSyncDevices(session = loadCloudSession()) {
  const suffix = accountScopeSuffix(session);
  return requestSync(`/v2/devices${suffix ? `?${suffix}` : ''}`, { method: 'GET', token: session?.accessToken || '' });
}

export async function fetchCloudDataCheck(session = loadCloudSession(), deviceId = '') {
  const suffix = accountScopeSuffix(session, deviceId);
  return requestSync(`/v2/device-data-check${suffix ? `?${suffix}` : ''}`, {
    method: 'GET',
    token: session?.accessToken || ''
  });
}

export async function saveCloudDataCheck(payload = {}, session = loadCloudSession()) {
  const deviceId = String(payload.deviceId || '').trim();
  const scope = getAccountDataScope(session, deviceId || getClientId());
  const body = { ...payload };
  // This endpoint records the result for one physical device. Account-scoped
  // data reads/writes switch to accountUsername, but the check itself must
  // retain deviceId so a completed device can be checked again later.
  if (scope?.scope === 'account') body.accountUsername = normalizeAccountUsername(session?.username);
  if (deviceId) body.deviceId = deviceId;
  return requestSync('/v2/device-data-check', {
    method: 'POST',
    token: session?.accessToken || '',
    body: JSON.stringify(body)
  });
}

export async function completeSyncDeviceMigration({ deviceId, accountComplete = false } = {}, session = loadCloudSession()) {
  return requestSync('/v2/devices/complete', {
    method: 'POST',
    token: session?.accessToken || '',
    body: JSON.stringify({ deviceId: String(deviceId || '').trim(), accountComplete: Boolean(accountComplete) })
  });
}

export async function startSyncDeviceMigration({ deviceId } = {}, session = loadCloudSession()) {
  return requestSync('/v2/devices/collecting', {
    method: 'POST',
    token: session?.accessToken || '',
    body: JSON.stringify({ deviceId: String(deviceId || '').trim() })
  });
}

export async function discardSyncDeviceMigration({ deviceId } = {}, session = loadCloudSession()) {
  return requestSync('/v2/devices/discard', {
    method: 'POST',
    token: session?.accessToken || '',
    body: JSON.stringify({ deviceId: String(deviceId || '').trim() })
  });
}

export async function finalizeSyncMigration(session = loadCloudSession()) {
  return requestSync('/v2/migration/finalize', { method: 'POST', token: session?.accessToken || '', body: '{}' });
}

export async function deleteCloudSyncData({ confirmation = 'delete' } = {}, session = loadCloudSession()) {
  if (!session?.accessToken) throw new Error('请先登录账户');
  try {
    return await requestSync('/data', {
      method: 'DELETE',
      token: session.accessToken,
      body: JSON.stringify({ confirmation })
    });
  } catch (error) {
    // 灰度期间兼容尚未部署新路由的旧 Worker；两条路径都由同一清理函数删除新旧数据。
    if (error?.status !== 404) throw error;
    return requestSync('/latest', {
      method: 'DELETE',
      token: session.accessToken,
      body: JSON.stringify({ confirmation })
    });
  }
}
