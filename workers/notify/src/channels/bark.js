export async function sendBarkNotification({ deviceKey = '', title, body, url = '' } = {}) {
  const normalizedDeviceKey = String(deviceKey || '').trim();
  if (!normalizedDeviceKey) {
    return {
      channel: 'bark',
      status: 'skipped',
      detail: '未配置 Bark 设备密钥'
    };
  }

  const endpoint = new URL(`https://api.day.app/${encodeURIComponent(normalizedDeviceKey)}/${encodeURIComponent(title || '')}/${encodeURIComponent(body || '')}`);
  endpoint.searchParams.set('group', '交易计划提醒');
  if (url) {
    endpoint.searchParams.set('url', url);
  }

  const response = await fetch(endpoint.toString(), {
    method: 'GET'
  });
  const rawText = await response.text();

  if (!response.ok) {
    throw new Error(rawText || `Bark 推送失败：状态 ${response.status}`);
  }

  return {
    channel: 'bark',
    status: 'delivered',
    detail: rawText || '已发送到 Bark'
  };
}
