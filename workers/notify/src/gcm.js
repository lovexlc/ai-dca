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

export function maskSecret(value = '') {
  const normalized = String(value || '').trim();
  return normalized ? `${normalized.slice(0, 8)}...${normalized.slice(-6)}` : '';
}

export function normalizeGcmRegistrations(registrations = []) {
  return Array.isArray(registrations)
    ? registrations.map((registration) => ({
        id: String(registration?.id || '').trim(),
        deviceName: String(registration?.deviceName || '').trim(),
        packageName: String(registration?.packageName || '').trim(),
        appId: String(registration?.appId || '').trim(),
        senderId: String(registration?.senderId || '').trim(),
        token: String(registration?.token || '').trim(),
        createdAt: String(registration?.createdAt || '').trim(),
        updatedAt: String(registration?.updatedAt || '').trim(),
        lastCheckedAt: String(registration?.lastCheckedAt || '').trim(),
        lastCheckStatus: String(registration?.lastCheckStatus || '').trim(),
        lastCheckDetail: String(registration?.lastCheckDetail || '').trim()
      })).filter((registration) => registration.id && registration.token)
    : [];
}

export function buildPublicGcmRegistration(registration = {}) {
  return {
    id: String(registration?.id || '').trim(),
    deviceName: String(registration?.deviceName || '').trim(),
    packageName: String(registration?.packageName || '').trim(),
    appId: String(registration?.appId || '').trim(),
    senderId: String(registration?.senderId || '').trim(),
    tokenMasked: maskSecret(registration?.token),
    createdAt: String(registration?.createdAt || '').trim(),
    updatedAt: String(registration?.updatedAt || '').trim(),
    lastCheckedAt: String(registration?.lastCheckedAt || '').trim(),
    lastCheckStatus: String(registration?.lastCheckStatus || '').trim(),
    lastCheckDetail: String(registration?.lastCheckDetail || '').trim()
  };
}

export function buildPublicGcmRegistrations(registrations = []) {
  return normalizeGcmRegistrations(registrations).map((registration) => buildPublicGcmRegistration(registration));
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
  const endpoint = `https://fcm.googleapis.com/v1/projects/${normalizedProjectId}/messages:send`;
  const message = {
    token: normalizedToken,
    android: {
      priority: 'high'
    },
    data: {
      source: 'ai-dca',
      type: 'connection-check',
      checkedAt
    }
  };

  if (normalizedPackageName) {
    message.android.restricted_package_name = normalizedPackageName;
  }

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
