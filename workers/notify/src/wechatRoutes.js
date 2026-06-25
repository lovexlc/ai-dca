/* global TextEncoder, btoa, atob, crypto, fetch */

import { jsonResponse } from './notifyHttp.js';
import { readJson, writeJson } from './notifyStorage.js';

const encoder = new TextEncoder();
const TOKEN_VERSION = 'wx1';
const DEFAULT_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const USER_KEY_PREFIX = 'wechat:user:';
const ACTIVE_USERS_KEY = 'wechat:active-users';
const MODES = new Set(['conservative', 'standard', 'aggressive']);

function base64UrlEncode(value) {
  const bytes = typeof value === 'string' ? encoder.encode(value) : value;
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value) {
  const padded = String(value || '').replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(String(value || '').length / 4) * 4, '=');
  const binary = atob(padded);
  return new Uint8Array(Array.from(binary, (char) => char.charCodeAt(0)));
}

function base64UrlDecodeText(value) {
  return new TextDecoder().decode(base64UrlDecode(value));
}

function readWechatAppId(env = {}) {
  return String(env.WECHAT_APPID || env.WX_APPID || env.MINIPROGRAM_APPID || '').trim();
}

function readWechatAppSecret(env = {}) {
  return String(env.WECHAT_APP_SECRET || env.WECHAT_SECRET || env.WX_APP_SECRET || env.MINIPROGRAM_APP_SECRET || '').trim();
}

function readSessionSecret(env = {}) {
  return String(env.WECHAT_SESSION_SECRET || env.WX_SESSION_SECRET || readWechatAppSecret(env)).trim();
}

function clampTtlSeconds(value) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_SESSION_TTL_SECONDS;
  return Math.max(3600, Math.min(parsed, 90 * 24 * 60 * 60));
}

async function hmacSha256(secret, value) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}

function normalizeCodeList(value) {
  const seen = new Set();
  return (Array.isArray(value) ? value : [])
    .map((code) => String(code || '').trim().replace(/^(sh|sz|bj)/i, ''))
    .filter((code) => {
      if (!/^\d{6}$/.test(code) || seen.has(code)) return false;
      seen.add(code);
      return true;
    });
}

function normalizeNotificationPrefs(body = {}) {
  const mode = MODES.has(String(body.mode || '').trim()) ? String(body.mode).trim() : 'standard';
  const subscription = body.subscription && typeof body.subscription === 'object'
    ? {
        templateId: String(body.subscription.templateId || '').trim(),
        status: String(body.subscription.status || '').trim()
      }
    : null;
  return {
    mode,
    notifyEnabled: Boolean(body.notifyEnabled),
    highCodes: normalizeCodeList(body.highCodes),
    lowCodes: normalizeCodeList(body.lowCodes),
    watchedCodes: normalizeCodeList(body.watchedCodes),
    subscription,
    updatedAt: new Date().toISOString()
  };
}

async function signSessionToken(env, session) {
  const secret = readSessionSecret(env);
  if (!secret) {
    const error = new Error('WECHAT_SESSION_SECRET not configured');
    error.status = 503;
    throw error;
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  const ttlSeconds = clampTtlSeconds(env.WECHAT_SESSION_TTL_SECONDS);
  const payload = {
    v: TOKEN_VERSION,
    openid: String(session.openid || '').trim(),
    unionid: String(session.unionid || '').trim(),
    iat: nowSeconds,
    exp: nowSeconds + ttlSeconds
  };
  if (!payload.openid) {
    const error = new Error('openid missing');
    error.status = 502;
    throw error;
  }
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = base64UrlEncode(await hmacSha256(secret, encodedPayload));
  return {
    token: `${TOKEN_VERSION}.${encodedPayload}.${signature}`,
    expiresAt: payload.exp * 1000,
    payload
  };
}

async function verifySessionToken(env, token) {
  const secret = readSessionSecret(env);
  if (!secret) {
    const error = new Error('WECHAT_SESSION_SECRET not configured');
    error.status = 503;
    throw error;
  }
  const parts = String(token || '').trim().split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) {
    const error = new Error('invalid session token');
    error.status = 401;
    throw error;
  }
  const signedValue = parts[1];
  const expected = base64UrlEncode(await hmacSha256(secret, signedValue));
  if (expected !== parts[2]) {
    const error = new Error('invalid session token');
    error.status = 401;
    throw error;
  }
  const payload = JSON.parse(base64UrlDecodeText(signedValue));
  if (payload.v !== TOKEN_VERSION || !payload.openid) {
    const error = new Error('invalid session token');
    error.status = 401;
    throw error;
  }
  if (Number(payload.exp) * 1000 <= Date.now()) {
    const error = new Error('session token expired');
    error.status = 401;
    throw error;
  }
  return payload;
}

function readBearerToken(request) {
  const header = String(request.headers.get('authorization') || '').trim();
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
}

async function exchangeCodeForSession(env, code) {
  const appid = readWechatAppId(env);
  const secret = readWechatAppSecret(env);
  if (!appid || !secret) {
    const error = new Error('WeChat app credentials not configured');
    error.status = 503;
    throw error;
  }
  const params = new URLSearchParams({
    appid,
    secret,
    js_code: code,
    grant_type: 'authorization_code'
  });
  const response = await fetch(`https://api.weixin.qq.com/sns/jscode2session?${params.toString()}`, {
    method: 'GET'
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.errcode) {
    const error = new Error(payload.errmsg || `WeChat login failed: HTTP ${response.status}`);
    error.status = 502;
    throw error;
  }
  if (!payload.openid) {
    const error = new Error('WeChat login response missing openid');
    error.status = 502;
    throw error;
  }
  return payload;
}

async function addActiveWechatUser(env, openid) {
  const current = await readJson(env, ACTIVE_USERS_KEY, []);
  const list = Array.isArray(current) ? current : [];
  if (!list.includes(openid)) {
    list.push(openid);
    await writeJson(env, ACTIVE_USERS_KEY, list);
  }
}

export async function handleWechatLogin(request, env, { origin = '*' } = {}) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, { status: 405, origin });
  }
  const body = await request.json().catch(() => ({}));
  const code = String(body.code || '').trim();
  if (!code) {
    return jsonResponse({ error: 'code_required' }, { status: 400, origin });
  }
  const session = await exchangeCodeForSession(env, code);
  const signed = await signSessionToken(env, session);
  return jsonResponse({
    token: signed.token,
    openid: session.openid,
    unionid: session.unionid || '',
    expiresAt: signed.expiresAt
  }, { origin });
}

export async function handleWechatNotificationPrefs(request, env, { origin = '*' } = {}) {
  const token = readBearerToken(request);
  const session = await verifySessionToken(env, token);
  const key = `${USER_KEY_PREFIX}${session.openid}:notification-prefs`;

  if (request.method === 'GET') {
    const stored = await readJson(env, key, null);
    return jsonResponse({ ok: true, openid: session.openid, prefs: stored }, { origin });
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, { status: 405, origin });
  }

  const body = await request.json().catch(() => ({}));
  const prefs = normalizeNotificationPrefs(body);
  const record = {
    ...prefs,
    openid: session.openid,
    unionid: String(session.unionid || ''),
    createdAt: String((await readJson(env, key, {}))?.createdAt || new Date().toISOString())
  };
  await writeJson(env, key, record);
  if (record.notifyEnabled) {
    await addActiveWechatUser(env, session.openid);
  }
  return jsonResponse({ ok: true, openid: session.openid, prefs: record }, { origin });
}

export async function handleWechatRoute(request, env, { origin = '*' } = {}) {
  const url = new URL(request.url);
  if (url.pathname === '/api/wechat/login') {
    return await handleWechatLogin(request, env, { origin });
  }
  if (url.pathname === '/api/wechat/notification-prefs') {
    return await handleWechatNotificationPrefs(request, env, { origin });
  }
  return jsonResponse({ error: '未找到微信接口。' }, { status: 404, origin });
}

export const __test = {
  normalizeNotificationPrefs,
  signSessionToken,
  verifySessionToken
};
