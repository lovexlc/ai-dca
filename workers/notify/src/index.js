import { runNotificationCycle } from './evaluator.js';
import { buildPublicGcmRegistration, buildPublicGcmRegistrations, checkGcmConnection, hasGcmServiceAccount, maskSecret, normalizeGcmRegistrations, readGcmServiceAccount, resolveGcmProjectId } from './gcm.js';
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
      'access-control-allow-headers': 'content-type'
    }
  });
}

function emptyResponse({ status = 204, origin = '*' } = {}) {
  return new Response(null, {
    status,
    headers: {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type'
    }
  });
}

function readOrigin(request) {
  return request.headers.get('origin') || '*';
}

function normalizeSettings(settings = {}) {
  const gotifyClients = Array.isArray(settings.gotifyClients)
    ? settings.gotifyClients.map((client) => ({
        id: String(client?.id || '').trim(),
        baseUrl: String(client?.baseUrl || '').trim(),
        username: String(client?.username || '').trim(),
        token: String(client?.token || '').trim(),
        appId: Number(client?.appId) || 0,
        userId: Number(client?.userId) || 0,
        createdAt: String(client?.createdAt || '').trim()
      })).filter((client) => client.id && client.baseUrl && client.token)
    : [];
  const gcmRegistrations = normalizeGcmRegistrations(settings.gcmRegistrations);

  return {
    barkDeviceKey: String(settings.barkDeviceKey || '').trim(),
    gotifyBaseUrl: String(settings.gotifyBaseUrl || '').trim(),
    gotifyUsername: String(settings.gotifyUsername || '').trim(),
    gotifyPassword: String(settings.gotifyPassword || '').trim(),
    gotifyToken: String(settings.gotifyToken || '').trim(),
    gotifyClients,
    gcmProjectId: String(settings.gcmProjectId || '').trim(),
    gcmPackageName: String(settings.gcmPackageName || '').trim(),
    gcmRegistrations,
    gcmLastCheckAt: String(settings.gcmLastCheckAt || '').trim(),
    gcmLastCheckStatus: String(settings.gcmLastCheckStatus || '').trim(),
    gcmLastCheckDetail: String(settings.gcmLastCheckDetail || '').trim()
  };
}

function buildMaskedToken(token = '') {
  const normalized = String(token || '').trim();
  return normalized ? `${normalized.slice(0, 4)}...${normalized.slice(-3)}` : '';
}

function randomString(length = 16) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join('');
}

function buildPublicGcmSetup(settings, env) {
  return {
    gcmProjectId: resolveGcmProjectId(settings, env),
    gcmPackageName: String(settings.gcmPackageName || '').trim(),
    gcmRegistrationCount: Array.isArray(settings.gcmRegistrations) ? settings.gcmRegistrations.length : 0,
    gcmRegistrations: buildPublicGcmRegistrations(settings.gcmRegistrations),
    gcmServiceAccountConfigured: hasGcmServiceAccount(env),
    gcmLastCheckAt: String(settings.gcmLastCheckAt || '').trim(),
    gcmLastCheckStatus: String(settings.gcmLastCheckStatus || '').trim(),
    gcmLastCheckDetail: String(settings.gcmLastCheckDetail || '').trim()
  };
}

function applyGcmCheckState(registrations = [], matcher = null, details = {}) {
  if (typeof matcher !== 'function') {
    return registrations;
  }

  return registrations.map((registration) => (
    matcher(registration)
      ? {
          ...registration,
          lastCheckedAt: String(details.checkedAt || '').trim(),
          lastCheckStatus: String(details.status || '').trim(),
          lastCheckDetail: String(details.detail || '').trim(),
          updatedAt: String(details.updatedAt || registration.updatedAt || '').trim()
        }
      : registration
  ));
}

function upsertGcmRegistration(registrations = [], candidate = {}) {
  const normalizedToken = String(candidate.token || '').trim();
  const normalizedId = String(candidate.id || '').trim();
  let replaced = false;
  const nextRegistrations = registrations.map((registration) => {
    const sameRegistration = (
      normalizedId && registration.id === normalizedId
    ) || (
      normalizedToken && registration.token === normalizedToken
    );

    if (!sameRegistration) {
      return registration;
    }

    replaced = true;
    return {
      ...registration,
      ...candidate
    };
  });

  if (!replaced) {
    nextRegistrations.push(candidate);
  }

  return nextRegistrations;
}

function findGcmRegistration(settings, { registrationId = '', token = '' } = {}) {
  const registrations = Array.isArray(settings.gcmRegistrations) ? settings.gcmRegistrations : [];
  const normalizedRegistrationId = String(registrationId || '').trim();
  const normalizedToken = String(token || '').trim();

  if (normalizedRegistrationId) {
    return registrations.find((registration) => registration.id === normalizedRegistrationId) || null;
  }

  if (normalizedToken) {
    return registrations.find((registration) => registration.token === normalizedToken) || null;
  }

  return registrations[0] || null;
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

function getRecentEvents(state = {}) {
  return Array.isArray(state?.recentEvents) ? state.recentEvents : [];
}

function getDeliveryFailures(state = {}) {
  return typeof state?.deliveryFailures === 'object' && state.deliveryFailures ? state.deliveryFailures : {};
}

function applySettingsRemovals(settings, removals = []) {
  const nextSettings = normalizeSettings(settings);

  for (const removal of removals) {
    const configType = String(removal?.configType || '').trim();
    const configKey = String(removal?.configKey || '').trim();
    const configId = String(removal?.configId || '').trim();

    if (!configType || !configKey) {
      continue;
    }

    if (configType === 'bark') {
      nextSettings.barkDeviceKey = '';
      continue;
    }

    if (configType === 'gotify-client') {
      nextSettings.gotifyClients = nextSettings.gotifyClients.filter((client) => `gotify-client:${client.id}` !== configKey && String(client.id || '').trim() !== configId);
      continue;
    }

    if (configType === 'gotify-legacy') {
      nextSettings.gotifyBaseUrl = '';
      nextSettings.gotifyToken = '';
    }
  }

  return nextSettings;
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
  const deliveryFailures = Object.values(getDeliveryFailures(state));
  const barkDeviceKey = settings.barkDeviceKey || String(env.BARK_DEVICE_KEY || '').trim();

  return jsonResponse({
    configured: {
      bark: Boolean(barkDeviceKey),
      gotify: false,
      gcm: false
    },
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
    deliveryFailureCount: deliveryFailures.length,
    deliveryFailures,
    setup: {
      barkDeviceKey,
      androidNotice: '开发中，请等待。'
    }
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
  const origin = readOrigin(request);
  const existingSettings = normalizeSettings(await readJson(env, SETTINGS_KEY, {}));
  const payload = await request.json().catch(() => ({}));
  const nextSettings = normalizeSettings({
    ...existingSettings,
    ...payload,
    gotifyBaseUrl: '',
    gotifyUsername: '',
    gotifyPassword: '',
    gotifyToken: '',
    gotifyClients: []
  });

  await writeJson(env, SETTINGS_KEY, nextSettings);

  return jsonResponse({
    ok: true,
    setup: {
      barkDeviceKey: nextSettings.barkDeviceKey,
      androidNotice: '开发中，请等待。'
    }
  }, { origin });
}

async function handleGcmRegister(request, env) {
  const origin = readOrigin(request);
  const settings = normalizeSettings(await readJson(env, SETTINGS_KEY, {}));
  const payload = await request.json().catch(() => ({}));
  const serviceAccount = (() => {
    try {
      return readGcmServiceAccount(env);
    } catch (_error) {
      return null;
    }
  })();
  const projectId = String(payload.projectId || settings.gcmProjectId || serviceAccount?.projectId || '').trim();
  const packageName = String(payload.packageName || settings.gcmPackageName || '').trim();
  const deviceName = String(payload.deviceName || '').trim() || 'Android Device';
  const token = String(payload.token || payload.registrationToken || '').trim();
  const appId = String(payload.appId || '').trim();
  const senderId = String(payload.senderId || '').trim();

  if (!projectId) {
    throw new Error('注册 Android GCM 设备前需要先提供 Firebase Project ID。');
  }

  if (!token) {
    throw new Error('缺少 Android registration token。');
  }

  const nowIso = new Date().toISOString();
  const existingRegistration = findGcmRegistration(settings, { token });
  const registration = {
    id: existingRegistration?.id || `gcm:${randomString(10).toLowerCase()}`,
    deviceName,
    packageName,
    appId,
    senderId,
    token,
    createdAt: existingRegistration?.createdAt || nowIso,
    updatedAt: nowIso,
    lastCheckedAt: existingRegistration?.lastCheckedAt || '',
    lastCheckStatus: existingRegistration?.lastCheckStatus || '',
    lastCheckDetail: existingRegistration?.lastCheckDetail || ''
  };
  const nextSettings = normalizeSettings({
    ...settings,
    gcmProjectId: projectId,
    gcmPackageName: packageName || settings.gcmPackageName,
    gcmRegistrations: upsertGcmRegistration(settings.gcmRegistrations, registration)
  });

  await writeJson(env, SETTINGS_KEY, nextSettings);

  return jsonResponse({
    ok: true,
    registration: buildPublicGcmRegistration(registration),
    setup: buildPublicGcmSetup(nextSettings, env)
  }, { origin });
}

async function handleGcmCheck(request, env) {
  const origin = readOrigin(request);
  const settings = normalizeSettings(await readJson(env, SETTINGS_KEY, {}));
  const payload = await request.json().catch(() => ({}));
  const explicitToken = String(payload.token || payload.registrationToken || '').trim();
  const explicitRegistrationId = String(payload.registrationId || '').trim();
  const selectedRegistration = findGcmRegistration(settings, {
    registrationId: explicitRegistrationId,
    token: explicitToken
  });
  const projectId = String(payload.projectId || settings.gcmProjectId || resolveGcmProjectId(settings, env) || '').trim();
  const packageName = String(payload.packageName || selectedRegistration?.packageName || settings.gcmPackageName || '').trim();
  const token = explicitToken || String(selectedRegistration?.token || '').trim();
  const registrationMatcher = selectedRegistration
    ? (registration) => registration.id === selectedRegistration.id
    : explicitToken
      ? (registration) => registration.token === explicitToken
      : null;

  try {
    const result = await checkGcmConnection({
      env,
      projectId,
      packageName,
      token
    });
    const nextSettings = normalizeSettings({
      ...settings,
      gcmProjectId: projectId,
      gcmPackageName: packageName || settings.gcmPackageName,
      gcmLastCheckAt: result.checkedAt,
      gcmLastCheckStatus: result.status,
      gcmLastCheckDetail: result.detail,
      gcmRegistrations: applyGcmCheckState(settings.gcmRegistrations, registrationMatcher, {
        checkedAt: result.checkedAt,
        status: result.status,
        detail: result.detail,
        updatedAt: new Date().toISOString()
      })
    });

    await writeJson(env, SETTINGS_KEY, nextSettings);

    return jsonResponse({
      ok: true,
      result,
      registration: selectedRegistration
        ? buildPublicGcmRegistration({
            ...selectedRegistration,
            packageName,
            lastCheckedAt: result.checkedAt,
            lastCheckStatus: result.status,
            lastCheckDetail: result.detail
          })
        : explicitToken
          ? {
              id: '',
              deviceName: String(payload.deviceName || '').trim(),
              packageName,
              tokenMasked: maskSecret(explicitToken),
              createdAt: '',
              updatedAt: '',
              lastCheckedAt: result.checkedAt,
              lastCheckStatus: result.status,
              lastCheckDetail: result.detail
            }
          : null,
      setup: buildPublicGcmSetup(nextSettings, env)
    }, { origin });
  } catch (error) {
    const failureMessage = error instanceof Error ? error.message : 'GCM 连接检查失败';
    const checkedAt = new Date().toISOString();
    const failedSettings = normalizeSettings({
      ...settings,
      gcmProjectId: projectId,
      gcmPackageName: packageName || settings.gcmPackageName,
      gcmLastCheckAt: checkedAt,
      gcmLastCheckStatus: 'failed',
      gcmLastCheckDetail: failureMessage,
      gcmRegistrations: applyGcmCheckState(settings.gcmRegistrations, registrationMatcher, {
        checkedAt,
        status: 'failed',
        detail: failureMessage,
        updatedAt: new Date().toISOString()
      })
    });

    await writeJson(env, SETTINGS_KEY, failedSettings);
    throw error;
  }
}

async function createGotifyAccount(settings) {
  const baseUrl = String(settings.gotifyBaseUrl || '').trim();
  const adminUsername = String(settings.gotifyUsername || '').trim();
  const adminPassword = String(settings.gotifyPassword || '').trim();

  if (!baseUrl || !adminUsername || !adminPassword) {
    throw new Error('Gotify 管理配置不完整，无法生成安卓接入账号。');
  }

  const username = `ai-dca-${randomString(8).toLowerCase()}`;
  const password = randomString(18);
  const endpoint = new URL('/user', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  const response = await fetch(endpoint.toString(), {
    method: 'POST',
    headers: {
      authorization: `Basic ${btoa(`${adminUsername}:${adminPassword}`)}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      name: username,
      pass: password,
      admin: false
    })
  });
  const rawText = await response.text();
  let payload = {};

  if (rawText) {
    try {
      payload = JSON.parse(rawText);
    } catch (_error) {
      payload = { error: rawText };
    }
  }

  if (!response.ok) {
    throw new Error(payload.errorDescription || payload.error || `创建 Gotify 用户失败：状态 ${response.status}`);
  }

  const appResponse = await fetch(new URL('/application', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString(), {
    method: 'POST',
    headers: {
      authorization: `Basic ${btoa(`${username}:${password}`)}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      name: `ai-dca-mobile-${randomString(6).toLowerCase()}`,
      description: 'AI DCA 移动端通知接收',
      defaultPriority: 8
    })
  });
  const appRawText = await appResponse.text();
  let appPayload = {};

  if (appRawText) {
    try {
      appPayload = JSON.parse(appRawText);
    } catch (_error) {
      appPayload = { error: appRawText };
    }
  }

  if (!appResponse.ok) {
    throw new Error(appPayload.errorDescription || appPayload.error || `创建 Gotify 应用失败：状态 ${appResponse.status}`);
  }

  return {
    id: `gotify:${username}`,
    gotifyBaseUrl: baseUrl,
    gotifyUsername: username,
    gotifyPassword: password,
    gotifyUserId: Number(payload.id) || 0,
    gotifyAppId: Number(appPayload.id) || 0,
    gotifyToken: String(appPayload.token || '').trim(),
    createdAt: new Date().toISOString()
  };
}

async function handleGotifyAccount(request, env) {
  const origin = readOrigin(request);
  const settings = normalizeSettings(await readJson(env, SETTINGS_KEY, {}));
  const account = await createGotifyAccount(settings);
  const nextSettings = normalizeSettings({
    ...settings,
    gotifyClients: [
      ...(Array.isArray(settings.gotifyClients) ? settings.gotifyClients : []),
      {
        id: account.id,
        baseUrl: account.gotifyBaseUrl,
        username: account.gotifyUsername,
        token: account.gotifyToken,
        appId: account.gotifyAppId,
        userId: account.gotifyUserId,
        createdAt: account.createdAt
      }
    ]
  });

  await writeJson(env, SETTINGS_KEY, nextSettings);

  return jsonResponse({
    ok: true,
    account: {
      gotifyBaseUrl: account.gotifyBaseUrl,
      gotifyUsername: account.gotifyUsername,
      gotifyPassword: account.gotifyPassword
    }
  }, { origin });
}

async function handleTest(request, env) {
  const origin = readOrigin(request);
  const payload = await request.json().catch(() => ({}));
  const existingState = await readJson(env, STATE_KEY, {});
  const meta = await readJson(env, META_KEY, {});
  let settings = normalizeSettings(await readJson(env, SETTINGS_KEY, {}));
  env.__notifySettings = settings;
  const cycle = await runNotificationCycle(env, {}, existingState, {
    reason: 'manual-test',
    testPayload: {
      title: String(payload.title || '交易计划测试提醒'),
      body: String(payload.body || '这是一条测试通知，用来校验 Bark 是否可用。')
    }
  });
  if (Array.isArray(cycle.settingsRemovals) && cycle.settingsRemovals.length) {
    settings = applySettingsRemovals(settings, cycle.settingsRemovals);
    await writeJson(env, SETTINGS_KEY, settings);
    env.__notifySettings = settings;
  }
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
  let settings = normalizeSettings(await readJson(env, SETTINGS_KEY, {}));
  env.__notifySettings = settings;
  const cycle = await runNotificationCycle(env, payload, state, { reason });
  if (Array.isArray(cycle.settingsRemovals) && cycle.settingsRemovals.length) {
    settings = applySettingsRemovals(settings, cycle.settingsRemovals);
    await writeJson(env, SETTINGS_KEY, settings);
    env.__notifySettings = settings;
  }
  const nextMeta = {
    ...meta,
    counts: compileNotifyRules(payload).summary,
    lastCheckedAt: new Date().toISOString()
  };

  await persistCycleResult(env, cycle.state, nextMeta);

  return cycle.summary;
}

async function handleRun(request, env) {
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

      if (request.method === 'POST' && url.pathname === '/api/notify/gotify-account') {
        return jsonResponse({ error: 'Gotify 通知能力已移除。' }, { status: 410, origin });
      }

      if (request.method === 'POST' && url.pathname === '/api/notify/gcm/register') {
        return jsonResponse({ error: 'Android 通知开发中，请等待。' }, { status: 410, origin });
      }

      if (request.method === 'POST' && url.pathname === '/api/notify/gcm/check') {
        return jsonResponse({ error: 'Android 通知开发中，请等待。' }, { status: 410, origin });
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
