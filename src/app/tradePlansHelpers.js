// 交易计划中心的纯工具函数与常量。
// 从 TradePlansExperience.jsx 抽离，便于单元测试。

export function formatEventTimeLabel(value = '') {
  const rawValue = String(value || '').trim();
  if (!rawValue) {
    return '--';
  }

  const timestamp = Date.parse(rawValue);
  if (!Number.isFinite(timestamp)) {
    // 未带时区信息且不能解析时，以原始值返回，避免显示 `Invalid Date`。
    const fallback = rawValue.replace('T', ' ').slice(0, 16);
    return fallback || '--';
  }

  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(new Date(timestamp)).replace(/\//g, '-');
  } catch (_error) {
    const fallback = rawValue.replace('T', ' ').slice(0, 16);
    return fallback || '--';
  }
}

export function resolveEventStatusMeta(status = '') {
  switch (status) {
    case 'delivered':
      return {
        label: '已送达',
        tone: 'emerald'
      };
    case 'failed':
      return {
        label: '发送失败',
        tone: 'red'
      };
    default:
      return {
        label: '未发送',
        tone: 'slate'
      };
  }
}

export function buildRuleDetailUrl(row) {
  if (typeof window === 'undefined') {
    return '';
  }

  const url = new URL('/index.html', window.location.origin);
  url.searchParams.set('tab', row?.sourceType === 'dca' ? 'dca' : 'tradePlans');

  if (String(row?.ruleId || '').trim()) {
    url.searchParams.set('ruleId', String(row.ruleId).trim());
  }

  return url.toString();
}

export function extractPurchaseAmount(row) {
  const summary = String(row?.detailSummary || '').trim();
  const match = summary.match(/[¥$]\s?\d+(?:\.\d+)?/);
  return match ? match[0].replace(/\s+/g, '') : '';
}

export const ANDROID_APK_DOWNLOAD_URL = 'https://github.com/yukerui/ai-dca-android-notify';
