import {
  buildPublicGcmRegistrations,
  hasGcmServiceAccount,
  resolveGcmProjectId
} from './gcm.js';
import {
  getNotifyGroupMembers,
  normalizeClientId,
  resolveClientGroupId
} from './clientSettings.js';

export function buildPublicGcmSetup(settings, env, options = {}) {
  const currentClientId = normalizeClientId(options?.clientId);
  const currentGroupId = currentClientId ? resolveClientGroupId(settings, currentClientId) : '';
  const gcmRegistrations = buildPublicGcmRegistrations(settings.gcmRegistrations, {
    clientId: currentClientId,
    currentGroupId
  });
  const gcmCurrentClientRegistrations = currentClientId
    ? gcmRegistrations.filter((registration) => registration.pairedToCurrentClient)
    : [];
  const notifyGroupMembers = currentGroupId ? getNotifyGroupMembers(settings, currentGroupId) : [];

  return {
    notifyGroupId: currentGroupId,
    notifyGroupMemberCount: notifyGroupMembers.length,
    notifyGroupMemberClientIds: notifyGroupMembers.map((client) => client.clientId),
    gcmProjectId: resolveGcmProjectId(settings, env),
    gcmPackageName: String(settings.gcmPackageName || '').trim(),
    gcmRegistrationCount: gcmRegistrations.length,
    gcmRegistrations,
    gcmCurrentClientId: currentClientId,
    gcmCurrentClientRegistrationCount: gcmCurrentClientRegistrations.length,
    gcmCurrentClientRegistrations,
    gcmPairedRegistrationCount: gcmRegistrations.filter((registration) => registration.pairedClientCount > 0).length,
    gcmUnpairedRegistrationCount: gcmRegistrations.filter((registration) => registration.pairedClientCount === 0).length,
    gcmServiceAccountConfigured: hasGcmServiceAccount(env),
    gcmLastCheckAt: String(settings.gcmLastCheckAt || '').trim(),
    gcmLastCheckStatus: String(settings.gcmLastCheckStatus || '').trim(),
    gcmLastCheckDetail: String(settings.gcmLastCheckDetail || '').trim()
  };
}

export function requireAuthenticatedGcmRegistration(selectedRegistration, token = '') {
  const normalizedToken = String(token || '').trim();

  if (!normalizedToken) {
    throw new Error('缺少 Android registration token。');
  }

  if (!selectedRegistration) {
    throw new Error('当前设备还没有完成注册，请先调用 /api/notify/gcm/register。');
  }

  if (String(selectedRegistration.token || '').trim() !== normalizedToken) {
    throw new Error('Android 设备鉴权失败，请使用当前 app 里的有效 token 重新请求。');
  }
}
