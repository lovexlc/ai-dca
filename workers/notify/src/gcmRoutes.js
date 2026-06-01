import { buildPublicGcmRegistration, checkGcmConnection, maskSecret, normalizeGcmPairedClients, normalizeNotifyGroupId, readGcmServiceAccount, resolveGcmProjectId } from './gcm.js';
import { jsonResponse, readOrigin } from './notifyHttp.js';
import { readSettings, writeSettings } from './notifyStorage.js';
import {
  applyGcmCheckState,
  findGcmRegistration,
  findGcmRegistrationByPairingCode,
  removeGcmPairedClient,
  removeGcmPairedGroup,
  upsertGcmPairedClient,
  upsertGcmRegistration
} from './gcmRegistrationState.js';
import {
  buildPublicGcmSetup,
  requireAuthenticatedGcmRegistration
} from './gcmPresentation.js';
import {
  buildPairingCode,
  ensureAuthenticatedClient,
  hashText,
  normalizeClientName,
  normalizeDeviceInstallationId,
  normalizePairingCode,
  normalizeSettings,
  resolveClientGroupId,
  upsertClientRecord
} from './clientSettings.js';

const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;

async function handleGcmPairingKey(request, env) {
  const origin = readOrigin(request);
  const settings = await readSettings(env);
  const payload = await request.json().catch(() => ({}));
  const deviceInstallationId = normalizeDeviceInstallationId(payload.deviceInstallationId || payload.installationId || '');
  const registrationId = String(payload.registrationId || '').trim();
  const token = String(payload.token || payload.registrationToken || '').trim();
  const selectedRegistration = findGcmRegistration(settings, {
    deviceInstallationId,
    registrationId,
    token
  });

  requireAuthenticatedGcmRegistration(selectedRegistration, token);

  const pairingCode = buildPairingCode(8);
  const pairingCodeHash = await hashText(pairingCode);
  const pairingCodeIssuedAt = new Date().toISOString();
  const pairingCodeExpiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MS).toISOString();
  const nextRegistration = {
    ...selectedRegistration,
    pairingCodeHash,
    pairingCodeIssuedAt,
    pairingCodeExpiresAt,
    updatedAt: pairingCodeIssuedAt
  };
  const nextSettings = normalizeSettings({
    ...settings,
    gcmRegistrations: upsertGcmRegistration(settings.gcmRegistrations, nextRegistration)
  });

  await writeSettings(env, nextSettings);

  return jsonResponse({
    ok: true,
    registration: buildPublicGcmRegistration(nextRegistration, {
      includePairedClientIds: true
    }),
    pairing: {
      code: pairingCode,
      issuedAt: pairingCodeIssuedAt,
      expiresAt: pairingCodeExpiresAt
    },
    setup: buildPublicGcmSetup(nextSettings, env)
  }, { origin });
}

async function handleGcmPair(request, env) {
  const origin = readOrigin(request);
  const payload = await request.json().catch(() => ({}));
  let settings = await readSettings(env);
  const pairingCode = normalizePairingCode(payload.pairingCode || payload.code || '');
  const deviceInstallationId = normalizeDeviceInstallationId(
    payload.deviceInstallationId || payload.installationId || ''
  );
  const clientName = normalizeClientName(payload.clientName) || 'Web 控制台';
  const auth = await ensureAuthenticatedClient(request, settings, {
    payload,
    clientLabel: clientName
  });
  settings = auth.settings;
  const clientId = auth.clientId;
  const currentGroupId = resolveClientGroupId(settings, clientId, auth.clientRecord.clientLabel);

  if (!deviceInstallationId && !pairingCode) {
    throw new Error('缺少设备 ID 或配对码。');
  }

  // 优先使用设备 ID 直接定位；fallback 到配对码（向后兼容旧流程）。
  const selectedRegistration = deviceInstallationId
    ? findGcmRegistration(settings, { deviceInstallationId })
    : await findGcmRegistrationByPairingCode(settings, pairingCode);

  if (!selectedRegistration) {
    throw new Error(
      deviceInstallationId
        ? '未找到该设备 ID。请确认 Android app 已注册并且在线。'
        : '配对码无效或已过期，请回到 Android app 重新生成。'
    );
  }

  const nowIso = new Date().toISOString();
  const nextRegistration = {
    ...selectedRegistration,
    pairedClients: upsertGcmPairedClient(selectedRegistration.pairedClients, {
      clientId,
      groupId: currentGroupId,
      clientName,
      pairedAt: nowIso,
      lastSeenAt: nowIso
    }),
    pairingCodeHash: '',
    pairingCodeIssuedAt: '',
    pairingCodeExpiresAt: '',
    updatedAt: nowIso
  };
  let nextSettings = normalizeSettings({
    ...settings,
    gcmRegistrations: upsertGcmRegistration(settings.gcmRegistrations, nextRegistration)
  });
  nextSettings = upsertClientRecord(nextSettings, clientId, {
    clientLabel: clientName,
    clientSecretHash: auth.clientRecord.clientSecretHash
  });

  await writeSettings(env, nextSettings);

  return jsonResponse({
    ok: true,
    registration: buildPublicGcmRegistration(nextRegistration, {
      clientId
    }),
    setup: buildPublicGcmSetup(nextSettings, env, {
      clientId
    })
  }, { origin });
}

async function handleGcmUnpair(request, env) {
  const origin = readOrigin(request);
  const payload = await request.json().catch(() => ({}));
  let settings = await readSettings(env);
  const auth = await ensureAuthenticatedClient(request, settings, {
    payload
  });
  settings = auth.settings;
  const clientId = auth.clientId;
  const currentGroupId = resolveClientGroupId(settings, clientId, auth.clientRecord.clientLabel);
  const deviceInstallationId = normalizeDeviceInstallationId(payload.deviceInstallationId || payload.installationId || '');
  const registrationId = String(payload.registrationId || '').trim();
  const token = String(payload.token || payload.registrationToken || '').trim();

  const selectedRegistration = findGcmRegistration(settings, {
    deviceInstallationId,
    registrationId,
    token
  });

  if (!selectedRegistration) {
    throw new Error('未找到需要解绑的 Android 设备。');
  }

  if (!normalizeGcmPairedClients(selectedRegistration.pairedClients).some((client) => client.groupId === currentGroupId)) {
    throw new Error('当前共享组与这台 Android 设备还没有建立绑定关系。');
  }

  const nowIso = new Date().toISOString();
  const nextRegistration = {
    ...selectedRegistration,
    pairedClients: removeGcmPairedGroup(selectedRegistration.pairedClients, currentGroupId),
    updatedAt: nowIso
  };
  const nextSettings = normalizeSettings({
    ...settings,
    gcmRegistrations: upsertGcmRegistration(settings.gcmRegistrations, nextRegistration)
  });

  await writeSettings(env, nextSettings);

  return jsonResponse({
    ok: true,
    registration: buildPublicGcmRegistration(nextRegistration, {
      clientId
    }),
    setup: buildPublicGcmSetup(nextSettings, env, {
      clientId
    })
  }, { origin });
}

// Android-side unpair: the device authenticates itself via deviceInstallationId + token,
// and removes one or all paired browsers from its pairedClients list.
// Payload: { deviceInstallationId, token, groupId?, clientId?, registrationId? }
async function handleGcmUnpairFromDevice(request, env) {
  const origin = readOrigin(request);
  const payload = await request.json().catch(() => ({}));
  const deviceInstallationId = normalizeDeviceInstallationId(payload.deviceInstallationId || payload.installationId || '');
  const registrationId = String(payload.registrationId || '').trim();
  const token = String(payload.token || payload.registrationToken || '').trim();
  const groupId = normalizeNotifyGroupId(payload.groupId || '');
  const targetClientId = String(payload.clientId || payload.targetClientId || '').trim();

  if (!token) {
    throw new Error('解绑前端浏览器需要提供当前设备的 FCM token。');
  }
  if (!deviceInstallationId && !registrationId) {
    throw new Error('解绑前端浏览器需要 deviceInstallationId 或 registrationId。');
  }

  const settings = await readSettings(env);
  const selectedRegistration = findGcmRegistration(settings, {
    deviceInstallationId,
    registrationId,
    token
  });

  if (!selectedRegistration) {
    throw new Error('未找到当前 Android 设备的注册记录。');
  }

  if (String(selectedRegistration.token || '').trim() !== token) {
    throw new Error('Token 与注册记录不一致，无法解绑。');
  }

  let nextPairedClients;
  if (groupId) {
    nextPairedClients = removeGcmPairedGroup(selectedRegistration.pairedClients, groupId);
  } else if (targetClientId) {
    nextPairedClients = removeGcmPairedClient(selectedRegistration.pairedClients, targetClientId);
  } else {
    nextPairedClients = [];
  }

  const nowIso = new Date().toISOString();
  const nextRegistration = {
    ...selectedRegistration,
    pairedClients: nextPairedClients,
    updatedAt: nowIso
  };
  const nextSettings = normalizeSettings({
    ...settings,
    gcmRegistrations: upsertGcmRegistration(settings.gcmRegistrations, nextRegistration)
  });

  await writeSettings(env, nextSettings);

  return jsonResponse({
    ok: true,
    registration: buildPublicGcmRegistration(nextRegistration, {
      includePairedClientIds: true
    })
  }, { origin });
}

async function handleGcmRegister(request, env) {
  const origin = readOrigin(request);
  const settings = await readSettings(env);
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
  const deviceInstallationId = normalizeDeviceInstallationId(payload.deviceInstallationId || payload.installationId || '');
  const registrationId = String(payload.registrationId || '').trim();
  const token = String(payload.token || payload.registrationToken || '').trim();
  const appId = String(payload.appId || '').trim();
  const senderId = String(payload.senderId || '').trim();

  if (!projectId) {
    throw new Error('注册 Android GCM 设备前需要先提供 Firebase Project ID。');
  }

  if (!token) {
    throw new Error('缺少 Android registration token。');
  }

  if (!deviceInstallationId) {
    throw new Error('缺少 Android deviceInstallationId。');
  }

  const nowIso = new Date().toISOString();
  const existingRegistration = findGcmRegistration(settings, {
    deviceInstallationId,
    registrationId,
    token
  });
  const registration = {
    ...existingRegistration,
    id: deviceInstallationId,
    deviceInstallationId,
    deviceName,
    packageName,
    appId,
    senderId,
    token,
    createdAt: existingRegistration?.createdAt || nowIso,
    updatedAt: nowIso,
    lastCheckedAt: existingRegistration?.lastCheckedAt || '',
    lastCheckStatus: existingRegistration?.lastCheckStatus || '',
    lastCheckDetail: existingRegistration?.lastCheckDetail || '',
    pairedClients: existingRegistration?.pairedClients || [],
    pairingCodeHash: existingRegistration?.pairingCodeHash || '',
    pairingCodeIssuedAt: existingRegistration?.pairingCodeIssuedAt || '',
    pairingCodeExpiresAt: existingRegistration?.pairingCodeExpiresAt || ''
  };
  const nextSettings = normalizeSettings({
    ...settings,
    gcmProjectId: projectId,
    gcmPackageName: packageName || settings.gcmPackageName,
    gcmRegistrations: upsertGcmRegistration(settings.gcmRegistrations, registration)
  });

  await writeSettings(env, nextSettings);

  return jsonResponse({
    ok: true,
    registration: buildPublicGcmRegistration(registration, {
      includePairedClientIds: true
    }),
    setup: buildPublicGcmSetup(nextSettings, env)
  }, { origin });
}

// Android-side device-id rotation: device authenticates with old deviceInstallationId + current
// FCM token, then atomically renames its KV registration record to the new deviceInstallationId.
// Preserves token / pairedClients / pairingCode* / projectId etc so paired browsers stay bound.
// If a stale registration already exists under the new id (e.g. orphaned from an earlier attempt),
// it is dropped to make room for the rename.
// Payload: { oldDeviceInstallationId, newDeviceInstallationId, token }
async function handleGcmResetDeviceId(request, env) {
  const origin = readOrigin(request);
  const payload = await request.json().catch(() => ({}));
  const oldDeviceInstallationId = normalizeDeviceInstallationId(
    payload.oldDeviceInstallationId || payload.deviceInstallationId || payload.installationId || ''
  );
  const newDeviceInstallationId = normalizeDeviceInstallationId(
    payload.newDeviceInstallationId || payload.nextDeviceInstallationId || ''
  );
  const token = String(payload.token || payload.registrationToken || '').trim();

  if (!token) {
    throw new Error('重置设备 ID 需要提供当前设备的 FCM token。');
  }
  if (!oldDeviceInstallationId) {
    throw new Error('重置设备 ID 需要提供旧的 deviceInstallationId。');
  }
  if (!newDeviceInstallationId) {
    throw new Error('重置设备 ID 需要提供新的 deviceInstallationId。');
  }
  if (oldDeviceInstallationId === newDeviceInstallationId) {
    throw new Error('新旧 deviceInstallationId 相同，无需重置。');
  }

  const settings = await readSettings(env);
  const selectedRegistration = findGcmRegistration(settings, {
    deviceInstallationId: oldDeviceInstallationId,
    token
  });

  requireAuthenticatedGcmRegistration(selectedRegistration, token);

  const nowIso = new Date().toISOString();
  const nextRegistration = {
    ...selectedRegistration,
    id: newDeviceInstallationId,
    deviceInstallationId: newDeviceInstallationId,
    updatedAt: nowIso
  };

  const existingRegistrations = Array.isArray(settings.gcmRegistrations) ? settings.gcmRegistrations : [];
  const filteredRegistrations = existingRegistrations.filter((registration) => {
    const registrationId = normalizeDeviceInstallationId(registration.deviceInstallationId || registration.id);
    return registrationId !== oldDeviceInstallationId && registrationId !== newDeviceInstallationId;
  });
  const nextSettings = normalizeSettings({
    ...settings,
    gcmRegistrations: [...filteredRegistrations, nextRegistration]
  });

  await writeSettings(env, nextSettings);

  return jsonResponse({
    ok: true,
    registration: buildPublicGcmRegistration(nextRegistration, {
      includePairedClientIds: true
    })
  }, { origin });
}

async function handleGcmCheck(request, env) {
  const origin = readOrigin(request);
  const settings = await readSettings(env);
  const payload = await request.json().catch(() => ({}));
  const explicitDeviceInstallationId = normalizeDeviceInstallationId(payload.deviceInstallationId || payload.installationId || '');
  const explicitToken = String(payload.token || payload.registrationToken || '').trim();
  const explicitRegistrationId = String(payload.registrationId || '').trim();
  const selectedRegistration = findGcmRegistration(settings, {
    deviceInstallationId: explicitDeviceInstallationId,
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

  requireAuthenticatedGcmRegistration(selectedRegistration, explicitToken);

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

    await writeSettings(env, nextSettings);

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
          }, {
            includePairedClientIds: true
          })
        : explicitToken
          ? {
              id: explicitDeviceInstallationId,
              deviceInstallationId: explicitDeviceInstallationId,
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

    await writeSettings(env, failedSettings);
    throw error;
  }
}

export {
  handleGcmCheck,
  handleGcmPair,
  handleGcmPairingKey,
  handleGcmRegister,
  handleGcmResetDeviceId,
  handleGcmUnpair,
  handleGcmUnpairFromDevice
};
