import { jsonResponse, readOrigin } from './notifyHttp.js';
import { readSettings, writeSettings } from './notifyStorage.js';
import { buildAccountClientId, getClientRecord, NotifyClientError, upsertClientRecord } from './clientSettings.js';
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

function sameEmailOwner(record, account) {
  if (record?.ownerUserId === account.userId) return true;
  const currentUsername = String(account?.username || '').trim().toLowerCase();
  const recordUsername = String(record?.accountUsername || '').trim().toLowerCase();
  return Boolean(currentUsername && recordUsername === currentUsername);
}

/**
 * Promote a verified device email to the stable account client.
 *
 * Older clients could save email on a device record before account binding was
 * introduced. Keep that data available to the account after the next
 * authenticated request, but never copy an email from another account.
 */
export function promoteVerifiedEmailToAccount(settings, currentClientId, account) {
  const current = getClientRecord(settings, currentClientId);
  const currentEmail = normalizeEmailConfig(current?.email || {});
  if (currentEmail.verified) return settings;

  const source = Object.entries(settings?.clients || {})
    .filter(([clientId]) => clientId !== currentClientId)
    .map(([clientId, client]) => ({ clientId, client }))
    .find(({ client }) => {
      if (!sameEmailOwner(client, account)) return false;
      const email = normalizeEmailConfig(client?.email || {});
      return Boolean(email.address && email.verified);
    });

  if (!source) return settings;

  return upsertClientRecord(settings, currentClientId, {
    email: normalizeEmailConfig(source.client.email)
  });
}

export function prepareUniqueEmailSettings(settings, currentClientId, account, email, options = {}) {
  const normalizedEmail = normalizeEmailAddress(email);
  if (!normalizedEmail) return settings;
  const nextSettings = {
    ...settings,
    clients: { ...(settings.clients || {}) }
  };
  const channelClears = Array.isArray(options?.channelClears) ? options.channelClears : null;

  for (const [clientId, client] of Object.entries(settings.clients || {})) {
    if (clientId === currentClientId) continue;
    const existingEmail = normalizeEmailConfig(client?.email || {});
    if (!existingEmail.verified || existingEmail.address !== normalizedEmail) continue;

    if (!sameEmailOwner(client, account) && options?.rebind !== true) {
      const error = new NotifyClientError(
        '该邮箱已绑定其他账号，验证码已验证通过。需要先解绑原有绑定。',
        409,
        'EMAIL_REBIND_REQUIRED'
      );
      error.channel = 'email';
      error.canRebind = true;
      throw error;
    }

    nextSettings.clients[clientId] = {
      ...client,
      email: normalizeEmailConfig({})
    };
    if (channelClears && !channelClears.some((item) => item?.clientId === clientId && item?.channel === 'email')) {
      channelClears.push({ clientId, channel: 'email' });
    }
  }

  return nextSettings;
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

  let nextSettings = upsertClientRecord(settings, accountClientId, {
    clientLabel: current.clientLabel || `账号通知 · ${account.username}`,
    accountUsername: account.username,
    ownerUserId: account.userId,
    accountClientId,
    isDeviceOnly: false,
    notifyGroupId: accountClientId
  });
  nextSettings = promoteVerifiedEmailToAccount(nextSettings, accountClientId, account);

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
  return jsonResponse({
    ok: true,
    binding: { scope: 'account', accountClientId: account.accountClientId },
    email: publicEmailSetup(account.clientRecord.email)
  }, { origin });
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

  const channelClears = [];
  settings = prepareUniqueEmailSettings(
    settings,
    account.accountClientId,
    account,
    verified.email,
    { rebind: payload?.rebind === true, channelClears }
  );
  settings = upsertClientRecord(settings, account.accountClientId, {
    email: {
      address: verified.email,
      verified: true,
      verifiedAt: verified.verifiedAt,
      enabled: true
    }
  });
  await writeSettings(env, settings, { channelClears });
  await clearEmailVerification(env, account.userId);

  return jsonResponse({
    ok: true,
    binding: { scope: 'account', accountClientId: account.accountClientId },
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
