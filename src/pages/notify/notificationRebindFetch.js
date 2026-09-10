const PATCH_KEY = '__aiDcaNotifyRebindFetchPatched';

const COPY = {
  bark: '检测到这条 Bark 配置已绑定其他账号，且 Device Key 与云端记录一致。是否解绑并绑定到当前账号？',
  serverchan3: '检测到这组 Server酱³ UID 和 SendKey 已绑定其他账号，且与你输入的内容一致。是否解绑并绑定到当前账号？'
};

function isNotifySettingsRequest(input, init = {}) {
  const url = typeof input === 'string' ? input : input?.url;
  const method = String(init.method || (typeof input !== 'string' ? input?.method : '') || 'GET').toUpperCase();
  try {
    return method === 'POST' && new URL(url, window.location.href).pathname === '/api/notify/settings';
  } catch {
    return false;
  }
}

function buildAccountScopedRequest(input, init = {}) {
  if (!isNotifySettingsRequest(input, init)) return { input, init };
  const rawUrl = typeof input === 'string' ? input : input?.url;
  const url = new URL(rawUrl, window.location.href);
  url.searchParams.delete('clientId');
  const headers = new Headers(init.headers || (typeof input !== 'string' ? input?.headers : undefined));
  headers.delete('x-notify-client-secret');
  headers.delete('x-notify-account-username');
  return {
    input: url.toString(),
    init: { ...init, headers }
  };
}

async function readRebindError(response) {
  if (response.status !== 409) return null;
  try {
    const payload = await response.clone().json();
    const channel = String(payload?.channel || '').toLowerCase();
    return payload?.code === 'CHANNEL_REBIND_REQUIRED' && COPY[channel] ? channel : null;
  } catch {
    return null;
  }
}

function withRebindChannel(init, channel) {
  if (typeof init?.body !== 'string') return null;
  try {
    return { ...init, body: JSON.stringify({ ...JSON.parse(init.body), rebindChannel: channel }) };
  } catch {
    return null;
  }
}

if (typeof window !== 'undefined' && !window[PATCH_KEY]) {
  window[PATCH_KEY] = true;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const request = buildAccountScopedRequest(input, init);
    const response = await nativeFetch(request.input, request.init);
    if (!isNotifySettingsRequest(input, init)) return response;
    const channel = await readRebindError(response);
    if (!channel) return response;
    if (!window.confirm(COPY[channel])) return response;
    const retryInit = withRebindChannel(request.init, channel);
    return retryInit ? nativeFetch(request.input, retryInit) : response;
  };
}
