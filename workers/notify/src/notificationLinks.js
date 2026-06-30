const DEFAULT_WEB_BASE_URL = 'https://freebacktrack.tech';

function stripTrailingSlash(value = '') {
  return String(value || '').replace(/\/+$/, '');
}

function normalizeTarget(value = '') {
  const target = String(value || '').trim();
  return target || 'tradePlans';
}

function normalizeCode(value = '') {
  return String(value || '').trim();
}

function buildWebUrl(env, target = 'tradePlans', params = {}) {
  const configuredBase = env?.NOTIFICATION_WEB_BASE_URL || env?.PUBLIC_WEB_BASE_URL;
  const baseUrl = stripTrailingSlash(configuredBase || DEFAULT_WEB_BASE_URL);
  const url = new URL('/index.html', `${baseUrl}/`);
  const normalizedTarget = normalizeTarget(target);

  url.searchParams.set('tab', normalizedTarget);
  url.searchParams.set('source', 'notification');

  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }

  return url.toString();
}

export function buildNotificationLinks(env, target = 'tradePlans', params = {}) {
  return {
    target: normalizeTarget(target),
    params: { ...(params || {}) },
    web: buildWebUrl(env, target, params),
    app: '',
    miniProgram: ''
  };
}

export function buildNotificationAction(env, target = 'tradePlans', params = {}) {
  const links = buildNotificationLinks(env, target, params);
  return {
    target: links.target,
    params: links.params,
    web: links.web,
    app: links.app,
    miniProgram: links.miniProgram,
    links: {
      web: links.web,
      app: links.app,
      miniProgram: links.miniProgram
    },
    detailUrl: links.web,
    url: links.web
  };
}

export function buildTargetParams(code = '', params = {}) {
  const normalizedCode = normalizeCode(code);
  return {
    ...(normalizedCode ? { code: normalizedCode } : {}),
    ...(params || {})
  };
}
