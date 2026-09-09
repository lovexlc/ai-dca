import { jsonResponse, readOrigin } from './notifyHttp.js';
import { readSettings, writeSettings } from './notifyStorage.js';
import { ensureAuthenticatedClient, getClientRecord, upsertClientRecord } from './clientSettings.js';
import { createEmailVerification, getRequestIp, verifyEmailCode } from './emailVerification.js';
import { maskEmailAddress, normalizeEmailAddress, normalizeEmailConfig } from './channels/email.js';


function requireLoggedInAccount(auth, origin) {
  if (String(auth?.clientRecord?.accountUsername || '').trim()) return null;
  return jsonResponse({ error: '请先登录账号后再绑定邮箱。' }, { status: 401, origin });
}

function publicEmailSetup(email = {}) {
  const config = normalizeEmailConfig(email);
  return {
    maskedAddress: maskEmailAddress(config.address),
    verified: config.verified,
    verifiedAt: config.verifiedAt,
    enabled: config.enabled
  };
}


export async function handleEmailStatus(request, env) {
  const origin = readOrigin(request);
  let settings = await readSettings(env);
  const auth = await ensureAuthenticatedClient(request, settings);
  settings = auth.settings;
  if (auth.didUpdate) await writeSettings(env, settings);
  const loginError = requireLoggedInAccount(auth, origin);
  if (loginError) return loginError;
  return jsonResponse({ ok: true, email: publicEmailSetup(auth.clientRecord.email) }, { origin });
}

export async function handleEmailSendCode(request, env) {
  const origin = readOrigin(request);
  const payload = await request.json().catch(() => ({}));
  let settings = await readSettings(env);
  const auth = await ensureAuthenticatedClient(request, settings, { payload });
  settings = auth.settings;
  if (auth.didUpdate) await writeSettings(env, settings);
  const loginError = requireLoggedInAccount(auth, origin);
  if (loginError) return loginError;

  const email = normalizeEmailAddress(payload.email);
  if (!email) return jsonResponse({ error: '请输入有效的邮箱地址。' }, { status: 400, origin });
  const current = normalizeEmailConfig(auth.clientRecord.email);

  if (current.address !== email && (current.address || current.verified || current.enabled)) {
    settings = upsertClientRecord(settings, auth.clientId, {
      email: { address: email, verified: false, verifiedAt: '', enabled: false }
    });
    await writeSettings(env, settings);
  }

  const result = await createEmailVerification(env, {
    clientId: auth.clientId,
    email,
    ip: getRequestIp(request)
  });

  settings = upsertClientRecord(settings, auth.clientId, {
    email: { address: email, verified: false, verifiedAt: '', enabled: false }
  });
  await writeSettings(env, settings);

  return jsonResponse({
    ok: true,
    maskedAddress: maskEmailAddress(result.email),
    expiresAt: result.expiresAt
  }, { origin });
}

export async function handleEmailVerify(request, env) {
  const origin = readOrigin(request);
  const payload = await request.json().catch(() => ({}));
  let settings = await readSettings(env);
  const auth = await ensureAuthenticatedClient(request, settings, { payload });
  settings = auth.settings;
  if (auth.didUpdate) await writeSettings(env, settings);
  const loginError = requireLoggedInAccount(auth, origin);
  if (loginError) return loginError;

  const result = await verifyEmailCode(env, {
    clientId: auth.clientId,
    email: payload.email,
    code: payload.code
  });
  settings = upsertClientRecord(settings, auth.clientId, {
    email: {
      address: result.email,
      verified: true,
      verifiedAt: result.verifiedAt,
      enabled: true
    }
  });
  await writeSettings(env, settings);

  return jsonResponse({ ok: true, email: publicEmailSetup(getClientRecord(settings, auth.clientId).email) }, { origin });
}

export async function handleEmailDisable(request, env) {
  const origin = readOrigin(request);
  const payload = await request.json().catch(() => ({}));
  let settings = await readSettings(env);
  const auth = await ensureAuthenticatedClient(request, settings, { payload });
  settings = auth.settings;
  if (auth.didUpdate) await writeSettings(env, settings);
  const loginError = requireLoggedInAccount(auth, origin);
  if (loginError) return loginError;
  const current = normalizeEmailConfig(auth.clientRecord.email);
  settings = upsertClientRecord(settings, auth.clientId, {
    email: { ...current, enabled: false }
  });
  await writeSettings(env, settings);
  return jsonResponse({ ok: true, email: publicEmailSetup(getClientRecord(settings, auth.clientId).email) }, { origin });
}

export async function handleEmailEnable(request, env) {
  const origin = readOrigin(request);
  const payload = await request.json().catch(() => ({}));
  let settings = await readSettings(env);
  const auth = await ensureAuthenticatedClient(request, settings, { payload });
  settings = auth.settings;
  if (auth.didUpdate) await writeSettings(env, settings);
  const loginError = requireLoggedInAccount(auth, origin);
  if (loginError) return loginError;
  const current = normalizeEmailConfig(auth.clientRecord.email);
  if (!current.address || !current.verified) {
    return jsonResponse({ error: '邮箱尚未完成验证。' }, { status: 400, origin });
  }
  settings = upsertClientRecord(settings, auth.clientId, {
    email: { ...current, enabled: true }
  });
  await writeSettings(env, settings);
  return jsonResponse({ ok: true, email: publicEmailSetup(getClientRecord(settings, auth.clientId).email) }, { origin });
}
