// URL-triggered HTTP push endpoints (推送 URL 调用).
// Routes (GET + POST) under /api/notify/quick/...
//   /api/notify/quick/:key/:body
//   /api/notify/quick/:key/:title/:body
//   /api/notify/quick/:key/:title/:subtitle/:body
//
// :key matches a paired Android device by its registration id
// (deviceInstallationId, fallback to id). All query string and form/JSON
// body params are forwarded to FCM `data`.
//
// Legacy alias: /api/notify/bark/... is still accepted for back-compat with
// any out-of-tree callers, but the client UI no longer surfaces it.

import { normalizeGcmRegistrations, resolveGcmProjectId, sendGcmNotification } from './gcm.js';

const QUICK_PATH_PREFIX = '/api/notify/quick/';
const LEGACY_PATH_PREFIX = '/api/notify/bark/';

export function isBarkRoute(url) {
  if (!url || !url.pathname) return false;
  return url.pathname.startsWith(QUICK_PATH_PREFIX)
      || url.pathname.startsWith(LEGACY_PATH_PREFIX);
}

function safeDecode(segment) {
  if (typeof segment !== 'string') return '';
  try {
    return decodeURIComponent(segment);
  } catch (_error) {
    return segment;
  }
}

function parseBarkPath(pathname) {
  const prefix = pathname.startsWith(QUICK_PATH_PREFIX)
    ? QUICK_PATH_PREFIX
    : pathname.startsWith(LEGACY_PATH_PREFIX)
      ? LEGACY_PATH_PREFIX
      : null;
  if (!prefix) return null;
  const tail = pathname.slice(prefix.length);
  if (!tail) return null;
  const segments = tail.split('/').filter((seg) => seg.length > 0);
  if (segments.length < 2 || segments.length > 4) return null;
  const [key, a, b, c] = segments.map(safeDecode);
  if (segments.length === 2) return { key, title: '', subtitle: '', body: a };
  if (segments.length === 3) return { key, title: a, subtitle: '', body: b };
  return { key, title: a, subtitle: b, body: c };
}

async function readBodyParams(request) {
  if (request.method !== 'POST') return {};
  const ct = (request.headers.get('content-type') || '').toLowerCase();
  try {
    if (ct.includes('application/json')) {
      const obj = await request.json();
      return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
    }
    if (ct.includes('application/x-www-form-urlencoded')) {
      const text = await request.text();
      const params = new URLSearchParams(text);
      const out = {};
      for (const [k, v] of params) out[k] = v;
      return out;
    }
    if (ct.includes('multipart/form-data')) {
      const fd = await request.formData();
      const out = {};
      for (const [k, v] of fd.entries()) {
        if (typeof v === 'string') out[k] = v;
      }
      return out;
    }
  } catch (_error) {
    return {};
  }
  return {};
}

function collectQueryParams(searchParams) {
  const out = {};
  for (const [k, v] of searchParams.entries()) {
    if (Object.prototype.hasOwnProperty.call(out, k)) {
      out[k] = `${out[k]},${v}`;
    } else {
      out[k] = v;
    }
  }
  return out;
}

function findRegistrationByKey(registrations, rawKey) {
  const key = String(rawKey || '').trim();
  if (!key) return null;
  for (const reg of registrations) {
    if (reg.deviceInstallationId && reg.deviceInstallationId === key) return reg;
  }
  for (const reg of registrations) {
    if (reg.id && String(reg.id) === key) return reg;
  }
  return null;
}

export async function handleBark(request, env, deps = {}) {
  const { jsonResponse, readSettings, readOrigin } = deps;
  if (typeof jsonResponse !== 'function' || typeof readSettings !== 'function' || typeof readOrigin !== 'function') {
    return new Response(JSON.stringify({ ok: false, code: 500, message: 'bark deps missing' }), {
      status: 500,
      headers: { 'content-type': 'application/json; charset=utf-8' }
    });
  }

  const origin = readOrigin(request);
  const url = new URL(request.url);
  const parsed = parseBarkPath(url.pathname);
  if (!parsed) {
    return jsonResponse({
      ok: false,
      code: 404,
      message: 'invalid bark path; expected /api/notify/bark/:key/:body, /:key/:title/:body, or /:key/:title/:subtitle/:body'
    }, { status: 404, origin });
  }

  const { key } = parsed;
  let { title, subtitle, body } = parsed;

  const queryParams = collectQueryParams(url.searchParams);
  const bodyParams = await readBodyParams(request);
  const merged = { ...queryParams, ...bodyParams };

  if (typeof merged.title === 'string' && merged.title.length > 0) title = merged.title;
  if (typeof merged.subtitle === 'string' && merged.subtitle.length > 0) subtitle = merged.subtitle;
  if (typeof merged.body === 'string' && merged.body.length > 0) body = merged.body;

  if (!body) {
    return jsonResponse({ ok: false, code: 400, message: 'body required' }, { status: 400, origin });
  }

  const settings = await readSettings(env);
  const registrations = normalizeGcmRegistrations(settings && settings.gcmRegistrations);
  const registration = findRegistrationByKey(registrations, key);
  if (!registration || !registration.token) {
    return jsonResponse({
      ok: false,
      code: 404,
      message: 'unknown or unpaired key'
    }, { status: 404, origin });
  }

  const finalTitle = title || subtitle || '\u901a\u77e5';
  const finalBody = subtitle && title ? `${subtitle}\n${body}` : body;

  const dataPayload = {};
  for (const [k, v] of Object.entries(merged)) {
    if (k === 'title' || k === 'subtitle' || k === 'body') continue;
    dataPayload[k] = v == null ? '' : String(v);
  }
  if (subtitle) dataPayload.subtitle = subtitle;
  dataPayload.barkKey = key;
  dataPayload.source = 'bark';

  const projectId = resolveGcmProjectId(settings, env);

  try {
    const result = await sendGcmNotification({
      env,
      projectId,
      packageName: registration.packageName,
      token: registration.token,
      title: finalTitle,
      body: finalBody,
      data: dataPayload
    });
    const ok = result && result.status === 'delivered';
    return jsonResponse({
      ok: Boolean(ok),
      code: ok ? 200 : 502,
      message: ok ? 'success' : (result && result.detail) || 'delivery not delivered',
      timestamp: Math.floor(Date.now() / 1000),
      registrationId: registration.id || ''
    }, { status: ok ? 200 : 502, origin });
  } catch (error) {
    return jsonResponse({
      ok: false,
      code: 500,
      message: error instanceof Error ? error.message : 'bark dispatch failed',
      timestamp: Math.floor(Date.now() / 1000)
    }, { status: 500, origin });
  }
}
