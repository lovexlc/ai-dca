export function normalizeBarkDeviceKey(input = '') {
  const value = String(input || '').trim();
  if (!value) return '';

  try {
    const url = new URL(value);
    if (String(url.hostname || '').toLowerCase() === 'api.day.app') {
      return decodeURIComponent(url.pathname.split('/').filter(Boolean)[0] || '').trim();
    }
  } catch {
    // Not a full URL; fall through to regex extraction.
  }

  const match = value.match(/api\.day\.app\/([^\s/?#]+)/i);
  if (match) {
    return decodeURIComponent(match[1] || '').trim();
  }

  return value;
}

function parseBarkPayload(rawText = '') {
  const raw = String(rawText || '').trim();
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function buildBarkFailureMessage(response, payload = null, rawText = '') {
  const code = Number(payload?.code);
  const message = String(payload?.message || rawText || '').trim();

  if (/failed to get .*device token/i.test(message)) {
    return 'Bark 推送失败：Device Key 不存在或未在 Bark 服务端注册';
  }

  if (message) {
    return `Bark 推送失败：${message}`;
  }

  if (Number.isFinite(code) && code !== 200) {
    return `Bark 推送失败：Bark 返回 code ${code}`;
  }

  return `Bark 推送失败：状态 ${response.status}`;
}

export async function sendBarkNotification({ deviceKey = '', title, body, url = '' } = {}) {
  const normalizedDeviceKey = normalizeBarkDeviceKey(deviceKey);
  if (!normalizedDeviceKey) {
    return {
      channel: 'bark',
      status: 'skipped',
      detail: '未配置 Bark 设备密钥'
    };
  }

  const payload = {
    device_key: normalizedDeviceKey,
    title: String(title || ''),
    body: String(body || ''),
    group: '交易计划提醒'
  };
  if (url) {
    payload.url = String(url);
  }

  const response = await fetch('https://api.day.app/push', {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  const rawText = await response.text();
  const responsePayload = parseBarkPayload(rawText);
  const barkCode = Number(responsePayload?.code);

  if (!response.ok || (responsePayload && Number.isFinite(barkCode) && barkCode !== 200)) {
    throw new Error(buildBarkFailureMessage(response, responsePayload, rawText));
  }

  return {
    channel: 'bark',
    status: 'delivered',
    detail: '已发送到 Bark'
  };
}
