export async function sendGotifyNotification(env, { title, body, priority = 8 } = {}) {
  const baseUrl = String(env.GOTIFY_BASE_URL || '').trim();
  const token = String(env.GOTIFY_TOKEN || '').trim();

  if (!baseUrl || !token) {
    return {
      channel: 'gotify',
      status: 'skipped',
      detail: '未配置 Gotify 服务地址或 token'
    };
  }

  const endpoint = new URL('/message', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  endpoint.searchParams.set('token', token);

  const response = await fetch(endpoint.toString(), {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      title: title || '交易计划提醒',
      message: body || '',
      priority
    })
  });
  const rawText = await response.text();

  if (!response.ok) {
    throw new Error(rawText || `Gotify 推送失败：状态 ${response.status}`);
  }

  return {
    channel: 'gotify',
    status: 'delivered',
    detail: rawText || '已发送到 Gotify'
  };
}
