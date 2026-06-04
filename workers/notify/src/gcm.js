export function maskSecret(value = '') {
  const normalized = String(value || '').trim();
  return normalized ? `${normalized.slice(0, 8)}...${normalized.slice(-6)}` : '';
}

export function normalizeNotifyGroupId(value = '') {
  return String(value || '').trim().slice(0, 120);
}

export function isWebWsRegistration(registration = {}) {
  return Boolean(registration?.isWebClient)
    || String(registration?.deviceInstallationId || registration?.id || '').startsWith('web-ws:');
}

export function normalizeGcmPairedClients(pairedClients = []) {
  return Array.isArray(pairedClients)
    ? pairedClients.map((client) => ({
        clientId: String(client?.clientId || '').trim(),
        groupId: normalizeNotifyGroupId(client?.groupId || client?.clientId),
        clientName: String(client?.clientName || '').trim(),
        pairedAt: String(client?.pairedAt || '').trim(),
        lastSeenAt: String(client?.lastSeenAt || '').trim()
      })).filter((client) => client.clientId)
    : [];
}

export function isRegistrationPairedToScope(registration = {}, options = {}) {
  const pairedClients = normalizeGcmPairedClients(registration?.pairedClients);
  const currentClientId = String(options?.clientId || '').trim();
  const currentGroupId = normalizeNotifyGroupId(options?.currentGroupId);

  return pairedClients.some((client) => (
    currentGroupId
      ? client.groupId === currentGroupId
      : currentClientId
        ? client.clientId === currentClientId
        : false
  ));
}

export function isActiveGcmPairingCode(registration = {}, nowMs = Date.now()) {
  const expiresAt = String(registration?.pairingCodeExpiresAt || '').trim();
  const expiresAtMs = Date.parse(expiresAt);

  return Boolean(
    String(registration?.pairingCodeHash || '').trim()
    && Number.isFinite(expiresAtMs)
    && expiresAtMs > nowMs
  );
}

export function normalizeGcmRegistrations(registrations = []) {
  return Array.isArray(registrations)
    ? registrations.map((registration) => {
        const normalizedDeviceInstallationId = String(registration?.deviceInstallationId || '').trim();
        const normalizedId = normalizedDeviceInstallationId || String(registration?.id || '').trim();

        return {
          id: normalizedId,
          deviceInstallationId: normalizedDeviceInstallationId,
          deviceName: String(registration?.deviceName || '').trim(),
          packageName: String(registration?.packageName || '').trim(),
          appId: String(registration?.appId || '').trim(),
          senderId: String(registration?.senderId || '').trim(),
          token: String(registration?.token || '').trim(),
          isWebClient: isWebWsRegistration({ ...registration, id: normalizedId, deviceInstallationId: normalizedDeviceInstallationId }),
          createdAt: String(registration?.createdAt || '').trim(),
          updatedAt: String(registration?.updatedAt || '').trim(),
          lastCheckedAt: String(registration?.lastCheckedAt || '').trim(),
          lastCheckStatus: String(registration?.lastCheckStatus || '').trim(),
          lastCheckDetail: String(registration?.lastCheckDetail || '').trim(),
          pairedClients: normalizeGcmPairedClients(registration?.pairedClients),
          pairingCodeHash: String(registration?.pairingCodeHash || '').trim(),
          pairingCodeIssuedAt: String(registration?.pairingCodeIssuedAt || '').trim(),
          pairingCodeExpiresAt: String(registration?.pairingCodeExpiresAt || '').trim()
        };
      }).filter((registration) => registration.id && registration.token)
    : [];
}

export function buildPublicGcmRegistration(registration = {}, options = {}) {
  const normalizedRegistration = normalizeGcmRegistrations([registration])[0] || {};
  const currentClientId = String(options?.clientId || '').trim();
  const currentGroupId = normalizeNotifyGroupId(options?.currentGroupId);
  const includePairedClientIds = Boolean(options?.includePairedClientIds);
  const pairedClients = normalizeGcmPairedClients(normalizedRegistration.pairedClients);

  return {
    id: normalizedRegistration.id,
    deviceInstallationId: normalizedRegistration.deviceInstallationId || normalizedRegistration.id,
    deviceName: normalizedRegistration.deviceName,
    packageName: normalizedRegistration.packageName,
    appId: normalizedRegistration.appId,
    senderId: normalizedRegistration.senderId,
    tokenMasked: maskSecret(normalizedRegistration.token),
    isWebClient: Boolean(normalizedRegistration.isWebClient) || String(normalizedRegistration.deviceInstallationId || normalizedRegistration.id || '').startsWith('web-ws:'),
    createdAt: normalizedRegistration.createdAt,
    updatedAt: normalizedRegistration.updatedAt,
    lastCheckedAt: normalizedRegistration.lastCheckedAt,
    lastCheckStatus: normalizedRegistration.lastCheckStatus,
    lastCheckDetail: normalizedRegistration.lastCheckDetail,
    pairedClientCount: pairedClients.length,
    pairedClients: pairedClients.map((client) => ({
      ...(includePairedClientIds ? { clientId: client.clientId, groupId: client.groupId } : {}),
      clientName: client.clientName,
      pairedAt: client.pairedAt,
      lastSeenAt: client.lastSeenAt
    })),
    pairedToCurrentClient: isRegistrationPairedToScope(normalizedRegistration, {
      clientId: currentClientId,
      currentGroupId
    }),
    pairingCodeActive: isActiveGcmPairingCode(normalizedRegistration),
    pairingCodeExpiresAt: isActiveGcmPairingCode(normalizedRegistration)
      ? normalizedRegistration.pairingCodeExpiresAt
      : ''
  };
}

export function buildPublicGcmRegistrations(registrations = [], options = {}) {
  return normalizeGcmRegistrations(registrations).map((registration) => buildPublicGcmRegistration(registration, options));
}
