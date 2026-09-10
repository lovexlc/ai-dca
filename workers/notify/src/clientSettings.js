import { normalizeNotifyGroupId, normalizeGcmRegistrations } from './gcm.js';
import { normalizeServerChan3Config } from './channels/serverChan3.js';
import { normalizeEmailConfig } from './channels/email.js';
import { normalizeNotifyPayload } from './rules.js';
import { normalizeNotifyAccountUsername } from './notifyAccount.js';
import { VERIFIED_NOTIFY_USER_ID_HEADER, VERIFIED_NOTIFY_USERNAME_HEADER } from './notifyAccountAuth.js';

export const CLIENT_SECRET_HEADER = 'x-notify-client-secret';
export const CLIENT_ACCOUNT_USERNAME_HEADER = 'x-notify-account-username';
const PAIRING_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export class NotifyClientError extends Error {
  constructor(message, status = 400, code = '') {
    super(message);
    this.name = 'NotifyClientError';
    this.status = status;
    this.code = String(code || '');
  }
}

export function normalizeNotifyUserId(value = '') { return String(value || '').trim().replace(/[^a-zA-Z0-9:_-]/g, '').slice(0, 96); }
export function buildAccountClientId(userId = '') { const id = normalizeNotifyUserId(userId); return id ? normalizeClientId(`account:${id}`) : ''; }
export function normalizeClientId(value = '') { return String(value || '').trim().slice(0, 120); }
export function normalizeClientName(value = '') { return String(value || '').trim().slice(0, 120); }
export function normalizeClientSecret(value = '') { return String(value || '').trim().slice(0, 240); }
export function normalizeDeviceInstallationId(value = '') { return String(value || '').trim().slice(0, 160); }
export function normalizePairingCode(value = '') { return String(value || '').trim().replace(/\s+/g, '').toUpperCase(); }
export { normalizeNotifyAccountUsername };

function emptyState() { return { ruleStates: {}, deliveryFailures: {}, recentEvents: [], deliveryAcks: {}, lastRunAt: '' }; }
function emptyMeta() { return { counts: { planRuleCount: 0, dcaRuleCount: 0, totalRuleCount: 0 }, lastSyncedAt: '', lastCheckedAt: '', lastTestedAt: '' }; }

export function buildDefaultClientRecord(clientId = '', clientLabel = '') {
  const id = normalizeClientId(clientId);
  return { clientId: id, clientLabel: normalizeClientName(clientLabel), accountUsername: '', ownerUserId: '', accountClientId: '', isDeviceOnly: false, notifyGroupId: normalizeNotifyGroupId(id) || id, clientSecretHash: '', barkDeviceKey: '', serverChan3: normalizeServerChan3Config({}), email: normalizeEmailConfig({}), payload: normalizeNotifyPayload({}), state: emptyState(), meta: emptyMeta() };
}

export function normalizeSettings(settings = {}) {
  const rawClients = typeof settings.clients === 'object' && settings.clients ? settings.clients : {};
  const clients = Object.entries(rawClients).reduce((map, [clientId, client]) => {
    const id = normalizeClientId(client?.clientId || clientId);
    if (!id) return map;
    map[id] = {
      clientId: id,
      clientLabel: normalizeClientName(client?.clientLabel || client?.notifyClientLabel || client?.clientName || ''),
      accountUsername: normalizeNotifyAccountUsername(client?.accountUsername || client?.username || ''),
      ownerUserId: normalizeNotifyUserId(client?.ownerUserId || ''),
      accountClientId: normalizeClientId(client?.accountClientId || ''),
      isDeviceOnly: Boolean(client?.isDeviceOnly),
      notifyGroupId: normalizeNotifyGroupId(client?.notifyGroupId || id) || id,
      clientSecretHash: String(client?.clientSecretHash || '').trim(),
      barkDeviceKey: String(client?.barkDeviceKey || '').trim(),
      serverChan3: normalizeServerChan3Config(client?.serverChan3 || {}),
      email: normalizeEmailConfig(client?.email || {}),
      payload: normalizeNotifyPayload(client?.payload || {}),
      state: { ruleStates: typeof client?.state?.ruleStates === 'object' && client.state.ruleStates ? client.state.ruleStates : {}, deliveryFailures: typeof client?.state?.deliveryFailures === 'object' && client.state.deliveryFailures ? client.state.deliveryFailures : {}, recentEvents: Array.isArray(client?.state?.recentEvents) ? client.state.recentEvents : [], deliveryAcks: typeof client?.state?.deliveryAcks === 'object' && client.state.deliveryAcks ? client.state.deliveryAcks : {}, lastRunAt: String(client?.state?.lastRunAt || '').trim() },
      meta: { counts: { planRuleCount: Number(client?.meta?.counts?.planRuleCount) || 0, dcaRuleCount: Number(client?.meta?.counts?.dcaRuleCount) || 0, totalRuleCount: Number(client?.meta?.counts?.totalRuleCount) || 0 }, lastSyncedAt: String(client?.meta?.lastSyncedAt || '').trim(), lastCheckedAt: String(client?.meta?.lastCheckedAt || '').trim(), lastTestedAt: String(client?.meta?.lastTestedAt || '').trim() }
    };
    return map;
  }, {});
  const gotifyClients = Array.isArray(settings.gotifyClients) ? settings.gotifyClients.map((client) => ({ id: String(client?.id || '').trim(), baseUrl: String(client?.baseUrl || '').trim(), username: String(client?.username || '').trim(), token: String(client?.token || '').trim(), appId: Number(client?.appId) || 0, userId: Number(client?.userId) || 0, createdAt: String(client?.createdAt || '').trim() })).filter((client) => client.id && client.baseUrl && client.token) : [];
  return { clients, gotifyBaseUrl: String(settings.gotifyBaseUrl || '').trim(), gotifyUsername: String(settings.gotifyUsername || '').trim(), gotifyPassword: String(settings.gotifyPassword || '').trim(), gotifyToken: String(settings.gotifyToken || '').trim(), gotifyClients, gcmRegistrations: normalizeGcmRegistrations(settings.gcmRegistrations).filter((registration) => registration.isWebClient) };
}

export function getClientRecord(settings, clientId = '', clientLabel = '') {
  const id = normalizeClientId(clientId);
  if (!id) return buildDefaultClientRecord('', clientLabel);
  const existing = settings.clients?.[id] || null;
  const label = normalizeClientName(clientLabel) || String(existing?.clientLabel || '').trim();
  return { ...buildDefaultClientRecord(id, label), ...(existing || {}), clientId: id, clientLabel: label };
}

export function upsertClientRecord(settings, clientId = '', patch = {}) {
  const id = normalizeClientId(clientId);
  if (!id) throw new Error('缺少浏览器 clientId。');
  const current = getClientRecord(settings, id);
  const defaults = buildDefaultClientRecord(id, patch.clientLabel ?? current.clientLabel);
  const next = {
    ...defaults, ...current, ...patch, clientId: id,
    clientLabel: normalizeClientName(patch.clientLabel ?? current.clientLabel ?? ''),
    accountUsername: normalizeNotifyAccountUsername(patch.accountUsername ?? current.accountUsername ?? ''),
    ownerUserId: normalizeNotifyUserId(patch.ownerUserId ?? current.ownerUserId ?? ''),
    accountClientId: normalizeClientId(patch.accountClientId ?? current.accountClientId ?? ''),
    isDeviceOnly: Boolean(patch.isDeviceOnly ?? current.isDeviceOnly),
    notifyGroupId: normalizeNotifyGroupId(patch.notifyGroupId ?? current.notifyGroupId ?? id) || id,
    clientSecretHash: String(patch.clientSecretHash ?? current.clientSecretHash ?? '').trim(),
    barkDeviceKey: String(patch.barkDeviceKey ?? current.barkDeviceKey ?? '').trim(),
    serverChan3: normalizeServerChan3Config(patch.serverChan3 ?? current.serverChan3 ?? {}),
    email: normalizeEmailConfig(patch.email ?? current.email ?? {}),
    payload: normalizeNotifyPayload(patch.payload ?? current.payload ?? {}),
    state: { ...defaults.state, ...(current.state || {}), ...(patch.state || {}) },
    meta: { ...defaults.meta, ...(current.meta || {}), ...(patch.meta || {}), counts: { ...defaults.meta.counts, ...(current.meta?.counts || {}), ...(patch.meta?.counts || {}) } }
  };
  return normalizeSettings({ ...settings, clients: { ...(settings.clients || {}), [id]: next } });
}

export function buildScopedNotifySettings(settings, clientId = '') {
  const c = getClientRecord(settings, clientId);
  return { ...settings, barkDeviceKey: c.barkDeviceKey, serverChan3: c.serverChan3, email: c.email, clientId: c.clientId, clientLabel: c.clientLabel, accountUsername: c.accountUsername, ownerUserId: c.ownerUserId, notifyGroupId: c.notifyGroupId };
}

export function randomString(length = 16) { const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'; const bytes = crypto.getRandomValues(new Uint8Array(length)); return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join(''); }
export function buildPairingCode(length = 8) { const bytes = crypto.getRandomValues(new Uint8Array(length)); return Array.from(bytes, (value) => PAIRING_CODE_ALPHABET[value % PAIRING_CODE_ALPHABET.length]).join(''); }
export async function hashText(value = '') { const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value || ''))); return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join(''); }
export function isFutureIso(value = '') { const expiresAt = Date.parse(String(value || '').trim()); return Number.isFinite(expiresAt) && expiresAt > Date.now(); }
export function readCurrentClientId(request) { return normalizeClientId(new URL(request.url).searchParams.get('clientId')); }
export function readCurrentClientSecret(request) { return normalizeClientSecret(request.headers.get(CLIENT_SECRET_HEADER)); }
export function resolveClientGroupId(settings, clientId = '', clientLabel = '') { const c = getClientRecord(settings, clientId, clientLabel); return normalizeNotifyGroupId(c.notifyGroupId || c.clientId) || c.clientId; }
export function getNotifyGroupMembers(settings, groupId = '') { const id = normalizeNotifyGroupId(groupId); return id ? Object.values(settings.clients || {}).filter((client) => resolveClientGroupId(settings, client?.clientId, client?.clientLabel) === id) : []; }

export function requireMatchingClientId(request, payload = {}) {
  const query = readCurrentClientId(request), body = normalizeClientId(payload.clientId), id = query || body;
  if (!id) throw new NotifyClientError('缺少浏览器 clientId。', 400, 'CLIENT_ID_REQUIRED');
  if (query && body && query !== body) throw new NotifyClientError('浏览器 clientId 不匹配。', 400, 'CLIENT_ID_MISMATCH');
  return id;
}

function activity(record = {}) { return Math.max(Date.parse(String(record?.meta?.lastSyncedAt || '')) || 0, Date.parse(String(record?.meta?.lastCheckedAt || '')) || 0, Date.parse(String(record?.meta?.lastTestedAt || '')) || 0, Date.parse(String(record?.state?.lastRunAt || '')) || 0); }
function hasServerChan3(record = {}) { return Boolean(record?.serverChan3?.uid && record?.serverChan3?.sendKey); }
function chooseAccountSource(existing, candidates = []) { if (existing && !existing.isDeviceOnly) return existing; return [...candidates].filter((r) => r && !r.isDeviceOnly).sort((a, b) => activity(b) - activity(a))[0] || null; }
function chooseAccountEmail(existing, source) { const current = normalizeEmailConfig(existing?.email || {}); if (current.verified) return current; const candidate = normalizeEmailConfig(source?.email || {}); return candidate.verified ? candidate : current; }

async function ensureLegacyAuthenticatedClient(request, settings, options, clientId, clientSecret) {
  const label = normalizeClientName(options?.clientLabel || '');
  const username = normalizeNotifyAccountUsername(options?.accountUsername ?? options?.payload?.accountUsername ?? request.headers.get(CLIENT_ACCOUNT_USERNAME_HEADER) ?? '');
  if (!clientSecret) throw new NotifyClientError('缺少浏览器鉴权信息，请刷新页面后重试。', 401);
  const existing = settings.clients?.[clientId] || null, hash = await hashText(clientSecret);
  if (String(existing?.clientSecretHash || '').trim() && existing.clientSecretHash !== hash) throw new NotifyClientError('浏览器鉴权失败，请回到原浏览器页面重新加载后重试。', 401);
  const update = !existing || !String(existing.clientSecretHash || '').trim() || (label && label !== String(existing?.clientLabel || '').trim()) || (username && username !== String(existing?.accountUsername || '').trim());
  if (!update) return { didUpdate: false, clientId, deviceClientId: clientId, clientRecord: getClientRecord(settings, clientId, label), settings };
  const next = upsertClientRecord(settings, clientId, { clientLabel: label || existing?.clientLabel || '', ...(username ? { accountUsername: username } : {}), notifyGroupId: normalizeNotifyGroupId(existing?.notifyGroupId || clientId) || clientId, clientSecretHash: hash });
  return { didUpdate: true, clientId, deviceClientId: clientId, clientRecord: getClientRecord(next, clientId, label), settings: next };
}

export async function ensureAuthenticatedAccountClient(request, settings, options = {}) {
  const userId = normalizeNotifyUserId(request.headers.get(VERIFIED_NOTIFY_USER_ID_HEADER));
  const username = normalizeNotifyAccountUsername(request.headers.get(VERIFIED_NOTIFY_USERNAME_HEADER));
  if (!userId || !username) throw new NotifyClientError('请先登录账户后配置通知。', 401, 'AUTH_REQUIRED');
  const original = normalizeSettings(settings), accountId = buildAccountClientId(userId), existing = original.clients?.[accountId] || null;
  if (existing?.ownerUserId && existing.ownerUserId !== userId) throw new NotifyClientError('通知账号归属冲突。', 409, 'ACCOUNT_OWNERSHIP_CONFLICT');
  const related = Object.values(original.clients || {}).filter((r) => r?.clientId && r.clientId !== accountId && (r.ownerUserId === userId || (!r.ownerUserId && username && r.accountUsername === username)));
  const source = chooseAccountSource(existing, related), candidates = [existing, source, ...related].filter(Boolean);
  const barkSource = candidates.find((r) => String(r?.barkDeviceKey || '').trim());
  const serverSource = candidates.find(hasServerChan3);
  const emailSource = candidates.find((r) => { const e = normalizeEmailConfig(r?.email || {}); return e.address && e.verified; });
  const next = upsertClientRecord(original, accountId, { clientLabel: existing?.clientLabel || `账号通知 · ${username}`, accountUsername: username, ownerUserId: userId, accountClientId: accountId, isDeviceOnly: false, notifyGroupId: accountId, clientSecretHash: '', barkDeviceKey: String(existing?.barkDeviceKey || barkSource?.barkDeviceKey || '').trim(), serverChan3: hasServerChan3(existing) ? existing.serverChan3 : (serverSource?.serverChan3 || {}), email: chooseAccountEmail(existing, emailSource), payload: existing?.payload || source?.payload || {}, state: existing?.state || source?.state || emptyState(), meta: existing?.meta || source?.meta || emptyMeta() });
  return { didUpdate: JSON.stringify(original.clients) !== JSON.stringify(next.clients), clientId: accountId, deviceClientId: '', ownerUserId: userId, accountUsername: username, clientRecord: getClientRecord(next, accountId), settings: next };
}

export async function ensureAuthenticatedClient(request, settings, options = {}) {
  const userId = normalizeNotifyUserId(request.headers.get(VERIFIED_NOTIFY_USER_ID_HEADER));
  const username = normalizeNotifyAccountUsername(request.headers.get(VERIFIED_NOTIFY_USERNAME_HEADER));
  if (!userId || !username) return ensureLegacyAuthenticatedClient(request, settings, options, requireMatchingClientId(request, options?.payload), readCurrentClientSecret(request));
  const query = readCurrentClientId(request), body = normalizeClientId(options?.payload?.clientId);
  if (query && body && query !== body) throw new NotifyClientError('浏览器 clientId 不匹配。', 400, 'CLIENT_ID_MISMATCH');
  const deviceId = query || body, accountAuth = await ensureAuthenticatedAccountClient(request, settings, options);
  if (!deviceId) return accountAuth;
  const secret = readCurrentClientSecret(request);
  if (!secret) throw new NotifyClientError('缺少浏览器鉴权信息，请刷新页面后重试。', 401, 'CLIENT_AUTH_REQUIRED');
  const original = accountAuth.settings, existing = original.clients?.[deviceId] || null, hash = await hashText(secret);
  if (String(existing?.clientSecretHash || '').trim() && existing.clientSecretHash !== hash) throw new NotifyClientError('浏览器鉴权失败，请刷新页面后重试。', 401, 'CLIENT_AUTH_INVALID');
  const existingUsername = normalizeNotifyAccountUsername(existing?.accountUsername);
  if (existing?.ownerUserId && existing.ownerUserId !== userId && existingUsername !== username) {
    const owner = existingUsername || existing.ownerUserId;
    throw new NotifyClientError(`当前浏览器通知身份已属于账号 ${owner}，请清理本地通知配置后重试。`, 403, 'CLIENT_ACCOUNT_MISMATCH');
  }
  const next = upsertClientRecord(original, deviceId, { clientLabel: normalizeClientName(options?.clientLabel || existing?.clientLabel || ''), accountUsername: username, ownerUserId: userId, accountClientId: accountAuth.clientId, isDeviceOnly: true, notifyGroupId: accountAuth.clientId, clientSecretHash: hash, barkDeviceKey: '', serverChan3: {}, email: normalizeEmailConfig({}), payload: {}, state: emptyState(), meta: emptyMeta() });
  return { ...accountAuth, didUpdate: accountAuth.didUpdate || JSON.stringify(original.clients) !== JSON.stringify(next.clients), deviceClientId: deviceId, clientRecord: getClientRecord(next, accountAuth.clientId), settings: next };
}
