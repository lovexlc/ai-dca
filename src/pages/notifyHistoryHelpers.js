export const TEST_EVENT_TTL_MS = 30 * 60 * 1000;

export function isTestEvent(event = {}) {
  const ruleId = String(event?.ruleId || '').toLowerCase();
  const eventType = String(event?.eventType || event?.type || '').toLowerCase();
  if (ruleId === 'test' || ruleId.startsWith('test:') || ruleId.includes('-test')) return true;
  if (eventType.includes('test')) return true;
  return false;
}

export function humanizeNotifyError(error) {
  const raw = error instanceof Error ? error.message : String(error || '');
  if (typeof console !== 'undefined' && raw) console.warn('[notify]', raw);
  if (!raw) return '通知服务暂时不可用，请稍后重试';
  const text = raw.toLowerCase();
  if (/status\s*5\d\d|http\s*5\d\d|\b5\d\d\b/.test(text)) return '通知服务暂时不可用，请稍后重试';
  if (/status\s*4\d\d|http\s*4\d\d/.test(text)) return '通知服务请求被拒绝，请检查配置';
  if (/network|fetch|abort|timeout|enotfound|econnre/.test(text)) return '网络连接不稳定，请检查网络后重试';
  if (/cors/.test(text)) return '跨域请求被默认限制，请配置 CORS 代理或使用同域部署';
  return raw;
}

export function getVisibleNotifyEvents(notifyEvents, eventsTick) {
  const now = Date.now();
  return (Array.isArray(notifyEvents) ? notifyEvents : []).filter((event) => {
    if (!isTestEvent(event)) return true;
    const createdAt = Date.parse(String(event?.createdAt || ''));
    if (!Number.isFinite(createdAt)) return false;
    return now - createdAt <= TEST_EVENT_TTL_MS;
  });
}
