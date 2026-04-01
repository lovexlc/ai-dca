const FIREBASE_MESSAGING_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const GOOGLE_OAUTH_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

function base64UrlEncodeBytes(bytes) {
  let binary = '';

  for (const value of bytes) {
    binary += String.fromCharCode(value);
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlEncodeText(value = '') {
  return base64UrlEncodeBytes(new TextEncoder().encode(String(value || '')));
}

function pemToArrayBuffer(pem = '') {
  const normalized = String(pem || '').replace(/-----BEGIN PRIVATE KEY-----/g, '').replace(/-----END PRIVATE KEY-----/g, '').replace(/\s+/g, '');

  if (!normalized) {
    throw new Error('Firebase 服务账号私钥为空。');
  }

  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes.buffer;
}

function parseServiceAccount(rawValue = '') {
  const payload = JSON.parse(String(rawValue || '{}'));
  const clientEmail = String(payload.client_email || '').trim();
  const privateKey = String(payload.private_key || '').trim();
  const projectId = String(payload.project_id || '').trim();

  if (!clientEmail || !privateKey) {
    throw new Error('Firebase 服务账号缺少 client_email 或 private_key。');
  }

  return {
    clientEmail,
    privateKey,
    projectId
  };
}

function buildServiceAccountJwt(serviceAccount, nowUnix) {
  const header = {
    alg: 'RS256',
    typ: 'JWT'
  };
  const claimSet = {
    iss: serviceAccount.clientEmail,
    sub: serviceAccount.clientEmail,
    aud: GOOGLE_OAUTH_TOKEN_ENDPOINT,
    scope: FIREBASE_MESSAGING_SCOPE,
    iat: nowUnix,
    exp: nowUnix + 3600
  };

  return `${base64UrlEncodeText(JSON.stringify(header))}.${base64UrlEncodeText(JSON.stringify(claimSet))}`;
}

async function signJwt(unsignedToken, privateKeyPem) {
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(privateKeyPem),
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256'
    },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsignedToken)
  );

  return `${unsignedToken}.${base64UrlEncodeBytes(new Uint8Array(signature))}`;
}

async function getGoogleAccessToken(serviceAccount) {
  const nowUnix = Math.floor(Date.now() / 1000);
  const assertion = await signJwt(buildServiceAccountJwt(serviceAccount, nowUnix), serviceAccount.privateKey);
  const response = await fetch(GOOGLE_OAUTH_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    }).toString()
  });
  const rawText = await response.text();
  let payload = {};

  if (rawText) {
    try {
      payload = JSON.parse(rawText);
    } catch (_error) {
      payload = { error: rawText };
    }
  }

  if (!response.ok) {
    throw new Error(payload.error_description || payload.error || `获取 Firebase access token 失败：状态 ${response.status}`);
  }

  const accessToken = String(payload.access_token || '').trim();

  if (!accessToken) {
    throw new Error('Firebase access token 为空。');
  }

  return accessToken;
}

function extractGoogleApiError(payload, status) {
  const topLevelError = payload?.error;

  if (typeof topLevelError === 'string' && topLevelError.trim()) {
    return topLevelError.trim();
  }

  if (topLevelError && typeof topLevelError === 'object') {
    return String(topLevelError.message || topLevelError.status || topLevelError.code || '').trim() || `FCM 请求失败：状态 ${status}`;
  }

  return `FCM 请求失败：状态 ${status}`;
}

function buildFcmEndpoint(projectId = '') {
  return `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;
}

function buildFcmMessage({ token = '', packageName = '', title = '', body = '', data = {} } = {}) {
  const normalizedToken = String(token || '').trim();
  const normalizedPackageName = String(packageName || '').trim();
  const normalizedTitle = String(title || '').trim();
  const normalizedBody = String(body || '').trim();
  const normalizedData = Object.entries(data || {}).reduce((map, [key, value]) => {
    if (value === undefined || value === null) {
      return map;
    }

    map[String(key)] = String(value);
    return map;
  }, {});
  const messageData = {
    ...normalizedData
  };

  if (normalizedTitle) {
    messageData.title = normalizedTitle;
  }

  if (normalizedBody) {
    messageData.body = normalizedBody;
  }

  const message = {
    token: normalizedToken,
    android: {
      priority: 'high'
    },
    data: messageData
  }

  if (normalizedPackageName) {
    message.android.restricted_package_name = normalizedPackageName;
  }

  return message;
}

export function maskSecret(value = '') {
  const normalized = String(value || '').trim();
  return normalized ? `${normalized.slice(0, 8)}...${normalized.slice(-6)}` : '';
}

export function normalizeGcmPairedClients(pairedClients = []) {
  return Array.isArray(pairedClients)
    ? pairedClients.map((client) => ({
        clientId: String(client?.clientId || '').trim(),
        clientName: String(client?.clientName || '').trim(),
        pairedAt: String(client?.pairedAt || '').trim(),
        lastSeenAt: String(client?.lastSeenAt || '').trim()
      })).filter((client) => client.clientId)
    : [];
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
  const pairedClients = normalizeGcmPairedClients(normalizedRegistration.pairedClients);

  return {
    id: normalizedRegistration.id,
    deviceInstallationId: normalizedRegistration.deviceInstallationId || normalizedRegistration.id,
    deviceName: normalizedRegistration.deviceName,
    packageName: normalizedRegistration.packageName,
    appId: normalizedRegistration.appId,
    senderId: normalizedRegistration.senderId,
    tokenMasked: maskSecret(normalizedRegistration.token),
    createdAt: normalizedRegistration.createdAt,
    updatedAt: normalizedRegistration.updatedAt,
    lastCheckedAt: normalizedRegistration.lastCheckedAt,
    lastCheckStatus: normalizedRegistration.lastCheckStatus,
    lastCheckDetail: normalizedRegistration.lastCheckDetail,
    pairedClientCount: pairedClients.length,
    pairedClients: pairedClients.map((client) => ({
      clientName: client.clientName,
      pairedAt: client.pairedAt,
      lastSeenAt: client.lastSeenAt
    })),
    pairedToCurrentClient: currentClientId
      ? pairedClients.some((client) => client.clientId === currentClientId)
      : false,
    pairingCodeActive: isActiveGcmPairingCode(normalizedRegistration),
    pairingCodeExpiresAt: isActiveGcmPairingCode(normalizedRegistration)
      ? normalizedRegistration.pairingCodeExpiresAt
      : ''
  };
}

export function buildPublicGcmRegistrations(registrations = [], options = {}) {
  return normalizeGcmRegistrations(registrations).map((registration) => buildPublicGcmRegistration(registration, options));
}

export function readGcmServiceAccount(env) {
  const rawValue = String(
    env.FIREBASE_SERVICE_ACCOUNT_JSON
    || env.FCM_SERVICE_ACCOUNT_JSON
    || env.GCM_SERVICE_ACCOUNT_JSON
    || ''
  ).trim();

  if (!rawValue) {
    return null;
  }

  return parseServiceAccount(rawValue);
}

export function hasGcmServiceAccount(env) {
  try {
    return Boolean(readGcmServiceAccount(env));
  } catch (_error) {
    return false;
  }
}

export function resolveGcmProjectId(settings = {}, env = {}) {
  const explicitProjectId = String(settings.gcmProjectId || '').trim();

  if (explicitProjectId) {
    return explicitProjectId;
  }

  try {
    return String(readGcmServiceAccount(env)?.projectId || '').trim();
  } catch (_error) {
    return '';
  }
}

export async function checkGcmConnection({ env, projectId = '', packageName = '', token = '' } = {}) {
  const serviceAccount = readGcmServiceAccount(env);

  if (!serviceAccount) {
    throw new Error('未配置 Firebase 服务账号，请在 Worker secret 中写入 FIREBASE_SERVICE_ACCOUNT_JSON。');
  }

  const normalizedProjectId = String(projectId || serviceAccount.projectId || '').trim();
  const normalizedPackageName = String(packageName || '').trim();
  const normalizedToken = String(token || '').trim();
  const checkedAt = new Date().toISOString();

  if (!normalizedProjectId) {
    throw new Error('缺少 Firebase Project ID。');
  }

  if (!normalizedToken) {
    return {
      ok: true,
      status: 'credentials-ready',
      checkedAt,
      projectId: normalizedProjectId,
      detail: 'Firebase 服务账号可用，但还没有可校验的 Android registration token。'
    };
  }

  const accessToken = await getGoogleAccessToken(serviceAccount);
  const endpoint = buildFcmEndpoint(normalizedProjectId);
  const message = buildFcmMessage({
    token: normalizedToken,
    packageName: normalizedPackageName,
    data: {
      source: 'ai-dca',
      type: 'connection-check',
      checkedAt
    }
  });

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      validate_only: true,
      message
    })
  });
  const rawText = await response.text();
  let payload = {};

  if (rawText) {
    try {
      payload = JSON.parse(rawText);
    } catch (_error) {
      payload = { error: rawText };
    }
  }

  if (!response.ok) {
    throw new Error(extractGoogleApiError(payload, response.status));
  }

  return {
    ok: true,
    status: 'validated',
    checkedAt,
    projectId: normalizedProjectId,
    detail: 'FCM HTTP v1 validateOnly 校验通过。',
    responseName: String(payload.name || '').trim()
  };
}

export async function sendGcmNotification({ env, projectId = '', packageName = '', token = '', title = '', body = '', data = {} } = {}) {
  const serviceAccount = readGcmServiceAccount(env);

  if (!serviceAccount) {
    return {
      channel: 'gcm',
      status: 'skipped',
      detail: '未配置 Firebase 服务账号'
    };
  }

  const normalizedProjectId = String(projectId || serviceAccount.projectId || '').trim();
  const normalizedToken = String(token || '').trim();

  if (!normalizedProjectId) {
    throw new Error('缺少 Firebase Project ID。');
  }

  if (!normalizedToken) {
    return {
      channel: 'gcm',
      status: 'skipped',
      detail: '未配置 Android registration token'
    };
  }

  const accessToken = await getGoogleAccessToken(serviceAccount);
  const response = await fetch(buildFcmEndpoint(normalizedProjectId), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      message: buildFcmMessage({
        token: normalizedToken,
        packageName,
        title,
        body,
        data: {
          source: 'ai-dca',
          type: 'notify',
          sentAt: new Date().toISOString(),
          ...data
        }
      })
    })
  });
  const rawText = await response.text();
  let payload = {};

  if (rawText) {
    try {
      payload = JSON.parse(rawText);
    } catch (_error) {
      payload = { error: rawText };
    }
  }

  if (!response.ok) {
    throw new Error(extractGoogleApiError(payload, response.status));
  }

  return {
    channel: 'gcm',
    status: 'delivered',
    detail: String(payload.name || rawText || '已发送到 Android 设备').trim()
  };
}
