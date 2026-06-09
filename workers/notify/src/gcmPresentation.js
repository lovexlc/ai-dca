import {
  buildPublicGcmRegistrations
} from './gcm.js';
import {
  getNotifyGroupMembers,
  normalizeClientId,
  resolveClientGroupId
} from './clientSettings.js';

const MAX_PUBLIC_WEB_WS_REGISTRATIONS = 20;

function registrationTime(registration = {}) {
  return Date.parse(String(registration?.updatedAt || registration?.createdAt || '')) || 0;
}

function limitPublicWebWsRegistrations(registrations = []) {
  const current = registrations.filter((registration) => registration.pairedToCurrentClient);
  const currentIds = new Set(current.map((registration) => registration.deviceInstallationId || registration.id));
  const recent = registrations
    .filter((registration) => !currentIds.has(registration.deviceInstallationId || registration.id))
    .sort((a, b) => registrationTime(b) - registrationTime(a))
    .slice(0, Math.max(0, MAX_PUBLIC_WEB_WS_REGISTRATIONS - current.length));

  return [...current, ...recent].slice(0, MAX_PUBLIC_WEB_WS_REGISTRATIONS);
}

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
  const limitedWebWsRegistrations = limitPublicWebWsRegistrations(webWsRegistrations);

  return {
    notifyGroupId: currentGroupId,
    notifyGroupMemberCount: notifyGroupMembers.length,
    notifyGroupMemberClientIds: notifyGroupMembers.map((client) => client.clientId),
    webWsRegistrationCount: webWsRegistrations.length,
    webWsRegistrations: limitedWebWsRegistrations,
    webWsCurrentClientId: currentClientId,
    webWsCurrentClientRegistrationCount: webWsCurrentClientRegistrations.length,
    webWsCurrentClientRegistrations,
    webWsPairedRegistrationCount: webWsRegistrations.filter((registration) => registration.pairedClientCount > 0).length,
    webWsUnpairedRegistrationCount: webWsRegistrations.filter((registration) => registration.pairedClientCount === 0).length
  };
}
