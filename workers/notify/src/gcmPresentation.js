import {
  buildPublicGcmRegistrations
} from './gcm.js';
import {
  getNotifyGroupMembers,
  normalizeClientId,
  resolveClientGroupId
} from './clientSettings.js';

export function buildPublicGcmSetup(settings, env, options = {}) {
  const currentClientId = normalizeClientId(options?.clientId);
  const currentGroupId = currentClientId ? resolveClientGroupId(settings, currentClientId) : '';
  const webWsRegistrations = buildPublicGcmRegistrations(settings.gcmRegistrations, {
    clientId: currentClientId,
    currentGroupId
  }).filter((registration) => (
    registration.isWebClient || String(registration.deviceInstallationId || registration.id || '').startsWith('web-ws:')
  ));
  const webWsCurrentClientRegistrations = currentClientId
    ? webWsRegistrations.filter((registration) => registration.pairedToCurrentClient)
    : [];
  const notifyGroupMembers = currentGroupId ? getNotifyGroupMembers(settings, currentGroupId) : [];

  return {
    notifyGroupId: currentGroupId,
    notifyGroupMemberCount: notifyGroupMembers.length,
    notifyGroupMemberClientIds: notifyGroupMembers.map((client) => client.clientId),
    webWsRegistrationCount: webWsRegistrations.length,
    webWsRegistrations,
    webWsCurrentClientId: currentClientId,
    webWsCurrentClientRegistrationCount: webWsCurrentClientRegistrations.length,
    webWsCurrentClientRegistrations,
    webWsPairedRegistrationCount: webWsRegistrations.filter((registration) => registration.pairedClientCount > 0).length,
    webWsUnpairedRegistrationCount: webWsRegistrations.filter((registration) => registration.pairedClientCount === 0).length
  };
}
