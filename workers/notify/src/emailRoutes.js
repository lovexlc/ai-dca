import { jsonResponse, readOrigin } from './notifyHttp.js';
import { readSettings, writeSettings } from './notifyStorage.js';
import { buildAccountClientId, getClientRecord, upsertClientRecord } from './clientSettings.js';
import {
  clearEmailVerification,
  createEmailVerification,
  getRequestIp,
  getVerifiedEmailVerification,
  verifyEmailCode
} from './emailVerification.js';
import { maskEmailAddress, normalizeEmailAddress, normalizeEmailConfig } from './channels/email.js';
import { readVerifiedNotifyAccount } from './notifyAccountAuth.js';

function publicEmailSetup(email = {}) {
  const config = normalizeEmailConfig(email);
  return {
    maskedAddress: maskEmailAddress(config.address),
    verified: config.verified,
    verifiedAt: config.verifiedAt,
    enabled: config.enabled
  };
}

function ensureAccountRecord(request, settings) {
  const account = readVerifiedNotifyAccount(request);
  const accountClientId = buildAccountClientId(account.userId);
  const current = getClientRecord(settings, accountClientId);

  if (current.ownerUserId && current.ownerUserId !== account.userId) {
    const error = new Error('通知账号归属冲突。');
    error.status = 409;
    throw error;
  }

  const nextSettings = upsertClientRecord(settings, accountClientId, {
    clientLabel: current.clientLabel || `账号通知 · ${account.username}`,
    accountUsername: account.username,
    ownerUserId: account.userId,
    accountClientId,
    isDeviceOnly: false,
    notifyGroupId: accountClientId
  });

  return {
    ...account,
    accountClientId,
    settings: nextSettings,
    clientRecord: getClientRecord(nextSettings, accountClientId)
  };
}

export async function handleEmailStatus(request, env) {
  const origin = readOrigin(request);
  const account = ensureAccountRecord(request, await readSettings(env));
  await writeSettings(env, account.settings);
  return jsonResponse({ ok: true, email: publicEmailSetup(account.clientRecord.email) }, { origin });
}

export async function handleEmailSendCode(request, env) {
  const origin = readOrigin(request);
  const payload = await request.json().catch(() => ({}));
  const account = ensureAccountRecord(request, await readSettings(env));
  await writeSettings(env, account.settings);

  const email = normalizeEmailAddress(payload.email);
  if (!email) return jsonResponse({ error: '请输入有效的邮箱地址。' }, { status: 400, origin });

  const result = await createEmailVerification(env, {
    userId: account.userId,
    email,
    ip: getRequestIp(request)
  });

  return jsonResponse({
    ok: true,
    maskedAddress: maskEmailAddress(result.email),
    expiresAt: result.expiresAt
  }, { origin });
}

export async function handleEmailVerify(request, env) {
  const origin = readOrigin(request);
  const payload = await request.json().catch(() => ({}));
  const account = ensureAccountRecord(request, await readSettings(env));
  await writeSettings(env, account.settings);

  const result = await verifyEmailCode(env, {
    userId: account.userId,
    email: payload.email,
    code: payload.code
  });

  return jsonResponse({
    ok: true,
    verified: true,
    pendingSave: true,
    maskedAddress: maskEmailAddress(result.email),
    verifiedAt: result.verifiedAt
  }, { origin });
}

export async function handleEmailSave(request, env) {
  const origin = readOrigin(request);
  const payload = await request.json().catch(() => ({}));
  let settings = await readSettings(env);
  const account = ensureAccountRecord(request, settings);
  settings = account.settings;
  const email = normalizeEmailAddress(payload.email);
  if (!email) return jsonResponse({ error: '请输入有效的邮箱地址。' }, { status: 400, origin });

  const verified = await getVerifiedEmailVerification(env, {
    userId: account.userId,
    email
  });

  settings = upsertClientRecord(settings, account.accountClientId, {
    email: {
      address: verified.email,
      verified: true,
      verifiedAt: verified.verifiedAt,
      enabled: true
    }
  });
  await writeSettings(env, settings);
  await clearEmailVerification(env, account.userId);

  return jsonResponse({
    ok: true,
    email: publicEmailSetup(getClientRecord(settings, account.accountClientId).email)
  }, { origin });
}

export async function handleEmailDisable(request, env) {
  const origin = readOrigin(request);
  let settings = await readSettings(env);
  const account = ensureAccountRecord(request, settings);
  settings = account.settings;
  const current = normalizeEmailConfig(account.clientRecord.email);
  settings = upsertClientRecord(settings, account.accountClientId, {
    email: { ...current, enabled: false }
  });
  await writeSettings(env, settings);
  return jsonResponse({ ok: true, email: publicEmailSetup(getClientRecord(settings, account.accountClientId).email) }, { origin });
}

export async function handleEmailEnable(request, env) {
  const origin = readOrigin(request);
  let settings = await readSettings(env);
  const account = ensureAccountRecord(request, settings);
  settings = account.settings;
  const current = normalizeEmailConfig(account.clientRecord.email);
  if (!current.address || !current.verified) {
    return jsonResponse({ error: '邮箱尚未完成验证。' }, { status: 400, origin });
  }
  settings = upsertClientRecord(settings, account.accountClientId, {
    email: { ...current, enabled: true }
  });
  await writeSettings(env, settings);
  return jsonResponse({ ok: true, email: publicEmailSetup(getClientRecord(settings, account.accountClientId).email) }, { origin });
}
