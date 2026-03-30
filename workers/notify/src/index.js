import { runNotificationCycle } from './evaluator.js';
import { compileNotifyRules, normalizeNotifyPayload } from './rules.js';

const PAYLOAD_KEY = 'notify:payload';
const STATE_KEY = 'notify:state';
const META_KEY = 'notify:meta';
const SETTINGS_KEY = 'notify:settings';

function jsonResponse(payload, { status = 200, origin = '*' } = {}) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type,x-notify-admin-token'
    }
  });
}

function emptyResponse({ status = 204, origin = '*' } = {}) {
  return new Response(null, {
    status,
    headers: {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type,x-notify-admin-token'
    }
  });
}

function readOrigin(request) {
  return request.headers.get('origin') || '*';
}

function normalizeSettings(settings = {}) {
  return {
    barkDeviceKey: String(settings.barkDeviceKey || '').trim(),
    gotifyBaseUrl: String(settings.gotifyBaseUrl || '').trim(),
    gotifyUsername: String(settings.gotifyUsername || '').trim(),
    gotifyPassword: String(settings.gotifyPassword || '').trim(),
    gotifyToken: String(settings.gotifyToken || '').trim()
  };
}

function hasAdminAccess(request, env) {
  const expectedToken = String(env.NOTIFY_ADMIN_TOKEN || '').trim();
  if (!expectedToken) {
    return true;
  }

  const providedToken = String(request.headers.get('x-notify-admin-token') || '').trim();
  return providedToken === expectedToken;
}

function ensureStateBinding(env) {
  if (!env.NOTIFY_STATE) {
    throw new Error('未配置 NOTIFY_STATE KV 绑定。');
  }
}

async function readJson(env, key, fallback) {
  ensureStateBinding(env);
  const rawValue = await env.NOTIFY_STATE.get(key);
  if (!rawValue) {
    return fallback;
  }

  try {
    return JSON.parse(rawValue);
  } catch (_error) {
    return fallback;
  }
}

async function writeJson(env, key, value) {
  ensureStateBinding(env);
  await env.NOTIFY_STATE.put(key, JSON.stringify(value));
}

function requireAdmin(request, env) {
  const expectedToken = String(env.NOTIFY_ADMIN_TOKEN || '').trim();
  if (!expectedToken) {
    return;
  }

  const providedToken = String(request.headers.get('x-notify-admin-token') || '').trim();
  if (providedToken !== expectedToken) {
    throw new Response(JSON.stringify({ error: '通知服务写接口未授权。' }), {
      status: 401,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'access-control-allow-origin': readOrigin(request),
        'access-control-allow-methods': 'GET,POST,OPTIONS',
        'access-control-allow-headers': 'content-type,x-notify-admin-token'
      }
    });
  }
}

function getRecentEvents(state = {}) {
  return Array.isArray(state?.recentEvents) ? state.recentEvents : [];
}

async function persistCycleResult(env, state, meta = {}) {
  await writeJson(env, STATE_KEY, state);
  await writeJson(env, META_KEY, meta);
}

async function handleStatus(request, env) {
  const origin = readOrigin(request);
  const meta = await readJson(env, META_KEY, {});
  const state = await readJson(env, STATE_KEY, {});
  const settings = normalizeSettings(await readJson(env, SETTINGS_KEY, {}));
  const recentEvents = getRecentEvents(state);
  const adminAccess = hasAdminAccess(request, env);
  const barkDeviceKey = settings.barkDeviceKey || String(env.BARK_DEVICE_KEY || '').trim();
  const gotifyBaseUrl = settings.gotifyBaseUrl || String(env.GOTIFY_BASE_URL || '').trim();
  const gotifyToken = settings.gotifyToken || String(env.GOTIFY_TOKEN || '').trim();

  return jsonResponse({
    configured: {
      bark: Boolean(barkDeviceKey),
      gotify: Boolean(gotifyBaseUrl && gotifyToken)
    },
    requiresAdminToken: Boolean(String(env.NOTIFY_ADMIN_TOKEN || '').trim()),
    hasAdminAccess: adminAccess,
    counts: {
      planRuleCount: Number(meta?.counts?.planRuleCount) || 0,
      dcaRuleCount: Number(meta?.counts?.dcaRuleCount) || 0,
      totalRuleCount: Number(meta?.counts?.totalRuleCount) || 0
    },
    lastSyncedAt: String(meta?.lastSyncedAt || ''),
    lastCheckedAt: String(meta?.lastCheckedAt || ''),
    lastTestedAt: String(meta?.lastTestedAt || ''),
    eventCount: recentEvents.length,
    lastEvent: recentEvents[0] || null,
    setup: adminAccess ? {
      barkDeviceKey,
      gotifyBaseUrl,
      gotifyUsername: settings.gotifyUsername,
      gotifyPassword: settings.gotifyPassword,
      gotifyTokenMasked: gotifyToken ? `${gotifyToken.slice(0, 4)}...${gotifyToken.slice(-3)}` : ''
    } : null
  }, { origin });
}

async function handleEvents(request, env) {
  const origin = readOrigin(request);
  const state = await readJson(env, STATE_KEY, {});

  return jsonResponse({
    events: getRecentEvents(state)
  }, { origin });
}

async function handleSync(request, env) {
  requireAdmin(request, env);
  const origin = readOrigin(request);
  const payload = normalizeNotifyPayload(await request.json().catch(() => ({})));
  const compiled = compileNotifyRules(payload);
  const existingState = await readJson(env, STATE_KEY, {});
  const allowedRuleIds = new Set(compiled.allRules.map((rule) => rule.ruleId));
  const nextRuleStates = Object.entries(existingState?.ruleStates || {}).reduce((map, [ruleId, state]) => {
    if (allowedRuleIds.has(ruleId)) {
      map[ruleId] = state;
    }
    return map;
  }, {});
  const nextState = {
    ...existingState,
    ruleStates: nextRuleStates,
    recentEvents: getRecentEvents(existingState)
  };
  const nextMeta = {
    ...(await readJson(env, META_KEY, {})),
    counts: compiled.summary,
    lastSyncedAt: payload.syncedAt
  };

  await writeJson(env, PAYLOAD_KEY, payload);
  await persistCycleResult(env, nextState, nextMeta);

  return jsonResponse({
    ok: true,
    counts: compiled.summary,
    lastSyncedAt: payload.syncedAt
  }, { origin });
}

async function handleSettings(request, env) {
  requireAdmin(request, env);
  const origin = readOrigin(request);
  const existingSettings = normalizeSettings(await readJson(env, SETTINGS_KEY, {}));
  const payload = await request.json().catch(() => ({}));
  const nextSettings = normalizeSettings({
    ...existingSettings,
    ...payload
  });

  await writeJson(env, SETTINGS_KEY, nextSettings);

  return jsonResponse({
    ok: true,
    setup: {
      barkDeviceKey: nextSettings.barkDeviceKey,
      gotifyBaseUrl: nextSettings.gotifyBaseUrl,
      gotifyUsername: nextSettings.gotifyUsername,
      gotifyPassword: nextSettings.gotifyPassword,
      gotifyTokenMasked: nextSettings.gotifyToken ? `${nextSettings.gotifyToken.slice(0, 4)}...${nextSettings.gotifyToken.slice(-3)}` : ''
    }
  }, { origin });
}

async function handleTest(request, env) {
  requireAdmin(request, env);
  const origin = readOrigin(request);
  const payload = await request.json().catch(() => ({}));
  const existingState = await readJson(env, STATE_KEY, {});
  const meta = await readJson(env, META_KEY, {});
  const cycle = await runNotificationCycle(env, {}, existingState, {
    reason: 'manual-test',
    testPayload: {
      title: String(payload.title || '交易计划测试提醒'),
      body: String(payload.body || '这是一条测试通知，用来校验 Bark 和 Gotify 是否可用。')
    }
  });
  const nextMeta = {
    ...meta,
    lastTestedAt: new Date().toISOString()
  };

  await persistCycleResult(env, cycle.state, nextMeta);

  return jsonResponse({
    ok: true,
    summary: cycle.summary
  }, { origin });
}

async function runDetection(env, reason = 'manual-run') {
  const payload = await readJson(env, PAYLOAD_KEY, normalizeNotifyPayload({}));
  const state = await readJson(env, STATE_KEY, {});
  const meta = await readJson(env, META_KEY, {});
  env.__notifySettings = normalizeSettings(await readJson(env, SETTINGS_KEY, {}));
  const cycle = await runNotificationCycle(env, payload, state, { reason });
  const nextMeta = {
    ...meta,
    counts: compileNotifyRules(payload).summary,
    lastCheckedAt: new Date().toISOString()
  };

  await persistCycleResult(env, cycle.state, nextMeta);

  return cycle.summary;
}

async function handleRun(request, env) {
  requireAdmin(request, env);
  const origin = readOrigin(request);
  const summary = await runDetection(env, 'manual-run');

  return jsonResponse({
    ok: true,
    summary
  }, { origin });
}

export default {
  async fetch(request, env) {
    const origin = readOrigin(request);
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return emptyResponse({ origin });
    }

    try {
      if (request.method === 'GET' && url.pathname === '/api/notify/status') {
        return await handleStatus(request, env);
      }

      if (request.method === 'GET' && url.pathname === '/api/notify/events') {
        return await handleEvents(request, env);
      }

      if (request.method === 'POST' && url.pathname === '/api/notify/sync') {
        return await handleSync(request, env);
      }

      if (request.method === 'POST' && url.pathname === '/api/notify/test') {
        env.__notifySettings = normalizeSettings(await readJson(env, SETTINGS_KEY, {}));
        return await handleTest(request, env);
      }

      if (request.method === 'POST' && url.pathname === '/api/notify/settings') {
        return await handleSettings(request, env);
      }

      if (request.method === 'POST' && url.pathname === '/api/notify/run') {
        return await handleRun(request, env);
      }

      if (request.method === 'GET' && url.pathname === '/api/notify/health') {
        return jsonResponse({ ok: true }, { origin });
      }

      return jsonResponse({ error: '未找到通知接口。' }, { status: 404, origin });
    } catch (error) {
      if (error instanceof Response) {
        return error;
      }

      return jsonResponse({
        error: error instanceof Error ? error.message : '通知服务异常'
      }, {
        status: 500,
        origin
      });
    }
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(runDetection(env, 'scheduled'));
  }
};
