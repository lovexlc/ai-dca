// 交易计划中心的纯工具函数与常量。
// 从 TradePlansExperience.jsx 抽离，便于单元测试。

export function formatEventTimeLabel(value = '') {
  const rawValue = String(value || '').trim();
  if (!rawValue) {
    return '--';
  }

  const normalized = rawValue.replace('T', ' ').slice(0, 16);
  return normalized || '--';
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
