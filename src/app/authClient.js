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
  if (String(import.meta.env.VITE_API_ORIGIN || '').trim()) {
    return apiUrl('/api/sync').replace(/\/$/, '');
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
  passwordHash
};

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

export async function fetchCloudBackupVersions(session = loadCloudSession(), limit = 50) {
  if (!session?.accessToken) throw new Error('请先登录账户');
  const size = Math.min(Math.max(Number(limit) || 50, 1), 100);
  return requestSync(`/versions?limit=${size}`, { method: 'GET', token: session.accessToken });
}

export async function rollbackCloudBackupVersion(version, { baseVersion } = {}, session = loadCloudSession()) {
  if (!session?.accessToken) throw new Error('请先登录账户');
  return requestSync('/versions/rollback', {
    method: 'POST',
    token: session.accessToken,
    body: JSON.stringify({ version: Number(version), baseVersion: Number(baseVersion) })
  });
}

export async function uploadLatestCloudBackup(payload, session = loadCloudSession()) {
  if (!session?.accessToken) throw new Error('请先登录账户');
  return requestSync('/latest', {
    method: 'PUT',
    token: session.accessToken,
    body: JSON.stringify(payload || {})
  });
}
