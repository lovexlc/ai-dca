export function normalizeServerChan3Config(config = {}) {
  return {
    uid: String(config?.uid || '').trim(),
    sendKey: String(config?.sendKey || '').trim()
  };
}

export function maskServerChan3SendKey(value = '') {
  const normalized = String(value || '').trim();
  return normalized ? `${normalized.slice(0, 6)}...${normalized.slice(-4)}` : '';
}

export async function sendServerChan3Notification({ uid = '', sendKey = '', title, body, summary = '' } = {}) {
  const normalizedUid = String(uid || '').trim();
  const normalizedSendKey = String(sendKey || '').trim();

  if (!normalizedUid || !normalizedSendKey) {
    return {
      channel: 'serverchan3',
      status: 'skipped',
      detail: '未配置 Server酱³ UID 或 SendKey'
    };
  }

  const endpoint = `https://${encodeURIComponent(normalizedUid)}.push.ft07.com/send/${encodeURIComponent(normalizedSendKey)}.send`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      title: String(title || summary || '交易计划提醒'),
      desp: String(body || summary || ''),
      short: String(summary || body || '').slice(0, 64),
      tags: 'AI-DCA'
    }).toString()
  });
  const rawText = await response.text();

  if (!response.ok) {
    throw new Error(rawText || `Server酱³ 推送失败：状态 ${response.status}`);
  }

  return {
    channel: 'serverchan3',
    status: 'delivered',
    detail: rawText || '已发送到 Server酱³'
  };
}
