import { normalizeGcmPairedClients, normalizeNotifyGroupId } from './gcm.js';
import {
  hashText,
  isFutureIso,
  normalizeClientId,
  normalizeDeviceInstallationId,
  normalizePairingCode
} from './clientSettings.js';

export function applyGcmCheckState(registrations = [], matcher = null, details = {}) {
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

export function upsertGcmRegistration(registrations = [], candidate = {}) {
  const normalizedToken = String(candidate.token || '').trim();
  const normalizedId = String(candidate.id || '').trim();
  const normalizedDeviceInstallationId = normalizeDeviceInstallationId(candidate.deviceInstallationId || candidate.id);
  let replaced = false;
  const nextRegistrations = registrations.map((registration) => {
    const registrationDeviceInstallationId = normalizeDeviceInstallationId(registration.deviceInstallationId || registration.id);
    const sameRegistration = (
      normalizedDeviceInstallationId && registrationDeviceInstallationId === normalizedDeviceInstallationId
    ) || (
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

export function upsertGcmPairedClient(pairedClients = [], candidate = {}) {
  const normalizedClientId = normalizeClientId(candidate.clientId);
  let replaced = false;
  const nextPairedClients = pairedClients.map((client) => {
    if (client.clientId !== normalizedClientId) {
      return client;
    }

    replaced = true;
    return {
      ...client,
      ...candidate
    };
  });

  if (!replaced && normalizedClientId) {
    nextPairedClients.push(candidate);
  }

  return nextPairedClients;
}

export function removeGcmPairedClient(pairedClients = [], clientId = '') {
  const normalizedClientId = normalizeClientId(clientId);

  if (!normalizedClientId) {
    return normalizeGcmPairedClients(pairedClients);
  }

  return normalizeGcmPairedClients(pairedClients).filter((client) => client.clientId !== normalizedClientId);
}

export function removeGcmPairedGroup(pairedClients = [], groupId = '') {
  const normalizedGroupId = normalizeNotifyGroupId(groupId);

  if (!normalizedGroupId) {
    return normalizeGcmPairedClients(pairedClients);
  }

  return normalizeGcmPairedClients(pairedClients).filter((client) => client.groupId !== normalizedGroupId);
}

export function findGcmRegistration(settings, { deviceInstallationId = '', registrationId = '', token = '' } = {}) {
  const registrations = Array.isArray(settings.gcmRegistrations) ? settings.gcmRegistrations : [];
  const normalizedDeviceInstallationId = normalizeDeviceInstallationId(deviceInstallationId);
  const normalizedRegistrationId = String(registrationId || '').trim();
  const normalizedToken = String(token || '').trim();

  if (normalizedDeviceInstallationId) {
    return registrations.find((registration) => (
      normalizeDeviceInstallationId(registration.deviceInstallationId || registration.id) === normalizedDeviceInstallationId
    )) || null;
  }

  if (normalizedRegistrationId) {
    return registrations.find((registration) => registration.id === normalizedRegistrationId) || null;
  }

  if (normalizedToken) {
    return registrations.find((registration) => registration.token === normalizedToken) || null;
  }

  return registrations[0] || null;
}

export async function findGcmRegistrationByPairingCode(settings, pairingCode = '') {
  const normalizedPairingCode = normalizePairingCode(pairingCode);

  if (!normalizedPairingCode) {
    return null;
  }

  const pairingCodeHash = await hashText(normalizedPairingCode);

  return (Array.isArray(settings.gcmRegistrations) ? settings.gcmRegistrations : []).find((registration) => (
    isFutureIso(registration.pairingCodeExpiresAt)
    && String(registration.pairingCodeHash || '').trim() === pairingCodeHash
  )) || null;
}
