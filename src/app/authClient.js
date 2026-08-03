import { trackAnalyticsEvent, trackFeatureEvent } from './analytics.js';
import { apiUrl } from './apiBase.js';
import { consumeAcceptedConversionPrompt } from './conversionPrompts.js';
import {
  CLOUD_SYNC_SESSION_EVENT,
  CLOUD_SYNC_SESSION_KEY,
  clearCloudSession,
  loadCloudSession,
  saveCloudSession
} from './authSession.js';

export {
  CLOUD_SYNC_SESSION_EVENT,
  CLOUD_SYNC_SESSION_KEY,
  clearCloudSession,
  loadCloudSession,
  saveCloudSession
};

const DEFAULT_SYNC_BASE = 'https://api.freebacktrack.tech/api/sync';
const AUTH_CLIENT_KDF_ITERATIONS = 310000;

function getSyncBase() {
  if (typeof window !== 'undefined' && window.__AI_DCA_SYNC_BASE__) {
    return String(window.__AI_DCA_SYNC_BASE__).replace(/\/$/, '');
  }
  if (String((import.meta.env || {}).VITE_API_ORIGIN || '').trim()) {
    return apiUrl('/api/sync').replace(/\/$/, '');
  }
  return DEFAULT_SYNC_BASE;
}

function bytesToHex(bytes) {
  return Array.from(new Uint8Array(bytes || []), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function randomHex(bytes = 16) {
  if (!globalThis.crypto?.getRandomValues) throw new Error('当前浏览器不支持安全随机数');
  const output = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(output);
  return bytesToHex(output);
}

async function deriveLoginCredential(password, salt, iterations = AUTH_CLIENT_KDF_ITERATIONS) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('当前浏览器不支持安全密码算法');
  const normalizedPassword = String(password || '');
  const normalizedSalt = String(salt || '');
  const normalizedIterations = Number(iterations);
  if (normalizedPassword.length < 8 || !normalizedSalt || !Number.isSafeInteger(normalizedIterations) || normalizedIterations < 1) {
    throw new Error('登录密码或密码盐不合法');
  }
  const material = await subtle.importKey(
    'raw',
    new TextEncoder().encode(normalizedPassword),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await subtle.deriveBits(
    { name: 'PBKDF2', salt: new TextEncoder().encode(normalizedSalt), iterations: normalizedIterations, hash: 'SHA-256' },
    material,
    256
  );
  return bytesToHex(bits);
}

export const __internals = { deriveLoginCredential, randomHex };

async function readJson(response) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : {}; } catch { return { message: text }; }
}

async function requestSync(path, { token = '', ...init } = {}) {
  const headers = { 'content-type': 'application/json; charset=utf-8', ...(init.headers || {}) };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${getSyncBase()}${path}`, { ...init, headers });
  const data = await readJson(response);
  if (!response.ok) {
    const error = new Error(data?.message || data?.error || `请求失败：HTTP ${response.status}`);
    error.status = response.status;
    error.data = data;
    error.response = response;
    throw error;
  }
  return data;
}

async function fetchAuthChallenge(username, purpose = 'login') {
  return requestSync('/auth/challenge', {
    method: 'POST',
    body: JSON.stringify({ username, purpose })
  });
}

async function buildPasswordCredential(password, challenge) {
  return deriveLoginCredential(password, challenge?.salt, challenge?.iterations || AUTH_CLIENT_KDF_ITERATIONS);
}

// V2 uses the bearer session as the only account identity. The sync key is
// carried by the URL and the body contains only an encrypted item plus its
// optimistic-lock metadata; notifyClientId is intentionally not involved.
export async function fetchCloudSyncV2Meta(session = loadCloudSession()) {
  if (!session?.accessToken) return null;
  return requestSync('/v2/items/meta', { method: 'GET', token: session.accessToken });
}

export async function fetchCloudSyncV2Items(keys = [], session = loadCloudSession()) {
  if (!session?.accessToken) throw new Error('请先登录账户');
  const normalized = Array.from(new Set((Array.isArray(keys) ? keys : [])
    .map((key) => String(key || '').trim())
    .filter(Boolean)));
  const query = normalized.length
    ? `?keys=${normalized.map((key) => encodeURIComponent(key)).join(',')}`
    : '';
  return requestSync(`/v2/items${query}`, { method: 'GET', token: session.accessToken });
}

export async function uploadCloudSyncV2Item(syncKey, payload = {}, session = loadCloudSession()) {
  if (!session?.accessToken) throw new Error('请先登录账户');
  const key = String(syncKey || '').trim();
  if (!key) throw new Error('缺少同步 key');
  return requestSync(`/v2/items/${encodeURIComponent(key)}`, {
    method: 'PUT',
    token: session.accessToken,
    body: JSON.stringify({
      baseRevision: payload.baseRevision == null ? 0 : Number(payload.baseRevision),
      contentHash: String(payload.contentHash || ''),
      encryptedPayload: payload.encryptedPayload || null,
      clientUpdatedAt: String(payload.clientUpdatedAt || ''),
      deletedAt: payload.deletedAt ? String(payload.deletedAt) : ''
    })
  });
}

export async function registerCloudAccount({ username, password }) {
  const normalized = String(username || '').trim().toLowerCase();
  if (normalized.length < 3) throw new Error('用户名至少 3 位');
  if (String(password || '').length < 8) throw new Error('登录密码至少 8 位');
  const challenge = await fetchAuthChallenge(normalized, 'register');
  const passwordCredential = await buildPasswordCredential(password, challenge);
  const data = await requestSync('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      username: normalized,
      passwordCredential,
      passwordSalt: String(challenge?.salt || '')
    })
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
  if (normalized.length < 3) throw new Error('用户名至少 3 位');
  if (String(password || '').length < 8) throw new Error('登录密码至少 8 位');
  const challenge = await fetchAuthChallenge(normalized, 'login');
  const passwordCredential = await buildPasswordCredential(password, challenge);
  const data = await requestSync('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: normalized, passwordCredential })
  });
  const session = saveCloudSession(data);
  trackAnalyticsEvent('user_login', { username: normalized });
  return session;
}

export async function logoutCloudAccount(session = loadCloudSession()) {
  if (!session?.accessToken) return { ok: true, skipped: true };
  return requestSync('/auth/logout', { method: 'POST', token: session.accessToken });
}

export async function changeCloudPassword({ currentPassword, newPassword }, session = loadCloudSession()) {
  if (!session?.accessToken) throw new Error('请先登录账户');
  if (String(currentPassword || '').length < 8) throw new Error('当前登录密码至少 8 位');
  if (String(newPassword || '').length < 8) throw new Error('新登录密码至少 8 位');
  const challenge = await fetchAuthChallenge(String(session.username || '').trim().toLowerCase(), 'change');
  const currentCredential = await buildPasswordCredential(currentPassword, challenge);
  const newSalt = randomHex(16);
  const newCredential = await deriveLoginCredential(newPassword, newSalt, AUTH_CLIENT_KDF_ITERATIONS);
  const data = await requestSync('/auth/change-password', {
    method: 'POST',
    token: session.accessToken,
    body: JSON.stringify({ currentCredential, newCredential, newPasswordSalt: newSalt })
  });
  return saveCloudSession(data);
}
