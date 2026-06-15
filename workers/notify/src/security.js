/* global TextEncoder, crypto */

import { jsonResponse } from './notifyHttp.js';

const encoder = new TextEncoder();
const RATE_LIMIT_PREFIX = 'security:rate-limit:';

function normalizeSecret(value = '') {
  return String(value || '').trim();
}

function constantTimeEqual(leftValue = '', rightValue = '') {
  const left = encoder.encode(normalizeSecret(leftValue));
  const right = encoder.encode(normalizeSecret(rightValue));
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let idx = 0; idx < length; idx += 1) {
    diff |= (left[idx] || 0) ^ (right[idx] || 0);
  }
  return diff === 0;
}

function readAdminToken(env = {}) {
  return normalizeSecret(env.NOTIFY_ADMIN_TOKEN || env.ADMIN_TOKEN || env.ADMIN_NOTIFY_TOKEN || env.ADMIN_TEST_TOKEN || '');
}

export function readRequestAdminToken(request) {
  const bearer = normalizeSecret(request.headers.get('authorization'));
  if (bearer.toLowerCase().startsWith('bearer ')) {
    return bearer.slice(7).trim();
  }
  return normalizeSecret(request.headers.get('x-admin-token'));
}

export function isValidAdminToken(request, env = {}) {
  const expected = readAdminToken(env);
  const provided = readRequestAdminToken(request);
  return Boolean(expected && provided && constantTimeEqual(provided, expected));
}

export function requireAdminToken(request, env = {}, { origin = '*' } = {}) {
  const expected = readAdminToken(env);
  if (!expected) {
    return jsonResponse({
      error: 'admin_auth_not_configured'
    }, { status: 503, origin });
  }
  if (!isValidAdminToken(request, env)) {
    return jsonResponse({
      error: 'forbidden'
    }, { status: 403, origin });
  }
  return null;
}

function clampInt(value, fallback, { min = 1, max = 100000 } = {}) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function readClientIp(request) {
  const cfIp = normalizeSecret(request.headers.get('cf-connecting-ip'));
  if (cfIp) return cfIp;
  const forwardedFor = normalizeSecret(request.headers.get('x-forwarded-for'));
  return forwardedFor.split(',').map((item) => item.trim()).filter(Boolean)[0] || 'unknown';
}

async function sha256Hex(value = '') {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(String(value || '')));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function enforceFixedWindowRateLimit(env = {}, {
  scope = 'default',
  identifier = '',
  limit = 60,
  windowSeconds = 3600,
  origin = '*'
} = {}) {
  if (!env.NOTIFY_STATE) {
    return jsonResponse({ error: 'rate_limit_not_configured' }, { status: 503, origin });
  }

  const normalizedScope = String(scope || 'default').replace(/[^a-z0-9:_-]/gi, '').slice(0, 80) || 'default';
  const normalizedIdentifier = String(identifier || 'anonymous').trim().slice(0, 240) || 'anonymous';
  const normalizedLimit = clampInt(limit, 60);
  const normalizedWindowSeconds = clampInt(windowSeconds, 3600, { min: 60, max: 86400 });
  const nowSeconds = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(nowSeconds / normalizedWindowSeconds) * normalizedWindowSeconds;
  const idHash = await sha256Hex(`${normalizedScope}:${normalizedIdentifier}`);
  const key = `${RATE_LIMIT_PREFIX}${normalizedScope}:${windowStart}:${idHash}`;

  let state = null;
  try {
    const raw = await env.NOTIFY_STATE.get(key);
    state = raw ? JSON.parse(raw) : null;
  } catch {
    state = null;
  }

  const count = clampInt(state?.count, 0, { min: 0, max: normalizedLimit + 1 });
  if (count >= normalizedLimit) {
    const retryAfter = Math.max(1, windowStart + normalizedWindowSeconds - nowSeconds);
    return jsonResponse({
      error: 'rate_limited',
      retryAfter
    }, { status: 429, origin });
  }

  await env.NOTIFY_STATE.put(key, JSON.stringify({
    count: count + 1,
    updatedAt: new Date().toISOString()
  }), {
    expirationTtl: normalizedWindowSeconds + 120
  });

  return null;
}

export async function enforceClientAndIpRateLimit(request, env = {}, {
  scope = 'default',
  clientId = '',
  clientLimit = 20,
  clientWindowSeconds = 86400,
  ipLimit = 30,
  ipWindowSeconds = 3600,
  origin = '*'
} = {}) {
  if (isValidAdminToken(request, env)) return null;

  const ipError = await enforceFixedWindowRateLimit(env, {
    scope: `${scope}:ip`,
    identifier: readClientIp(request),
    limit: ipLimit,
    windowSeconds: ipWindowSeconds,
    origin
  });
  if (ipError) return ipError;

  return await enforceFixedWindowRateLimit(env, {
    scope: `${scope}:client`,
    identifier: clientId || 'anonymous',
    limit: clientLimit,
    windowSeconds: clientWindowSeconds,
    origin
  });
}
