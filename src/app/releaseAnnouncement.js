const DEFAULT_RELEASE_ANNOUNCEMENT = {
  enabled: true,
  id: '2026-06-10-switch-rules-analytics-release',
  title: '近期功能更新',
  eyebrow: '更新公告',
  summary: '本期更新集中在基金切换规则、纳指 ETF 交互、通知服务稳定性和数据看板统计口径。',
  sourceLabel: '',
  embedUrl: '',
  externalUrl: '',
  items: [
    '基金切换新增多规则管理，可创建多条切换规则，通过下拉选择当前规则，并按所选规则渲染自动监控与配置卡片。',
    '自动监控区优化规则列表与布局，手动和模拟切换基准已修复，未持仓但已分类的 ETF 也能作为模拟基准。',
    '纳指 ETF 列表的 H/L 分类点击已修复，52 周高低位等内容可以正常进入分类操作。',
    '通知与部署链路做了稳定性整理，包含 notify 认证修复、端到端覆盖、WebSocket 路由拆分和 Pages 部署触发修复。',
    '数据看板新增访客、日活等统计口径，并清理历史未知用户统计，让活跃使用数据更可读。'
  ],
  sourceCommits: [
    'e52926c',
    'a59448b',
    '49e0b8e',
    '6d6d278',
    'dc04160',
    'ccb5895',
    'c05c6f5',
    '30ab387',
    '6da34f6',
    '5d27583',
    '2fe5d63',
    '2064961'
  ]
};

function readRuntimeAnnouncementOverride() {
  if (typeof window === 'undefined') return {};
  const value = window.__AI_DCA_RELEASE_ANNOUNCEMENT__;
  return value && typeof value === 'object' ? value : {};
}

function readEnvValue(key) {
  try {
    return String(import.meta.env?.[key] || '').trim();
  } catch {
    return '';
  }
}

function readEnvBoolean(key) {
  const value = readEnvValue(key).toLowerCase();
  if (['0', 'false', 'off', 'no'].includes(value)) return false;
  if (['1', 'true', 'on', 'yes'].includes(value)) return true;
  return undefined;
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

export function getCurrentReleaseAnnouncement() {
  const runtime = readRuntimeAnnouncementOverride();
  const embedUrl = firstText(
    runtime.embedUrl,
    readEnvValue('VITE_RELEASE_ANNOUNCEMENT_EMBED_URL'),
    DEFAULT_RELEASE_ANNOUNCEMENT.embedUrl
  );
  const externalUrl = firstText(
    runtime.externalUrl,
    readEnvValue('VITE_RELEASE_ANNOUNCEMENT_URL'),
    embedUrl,
    DEFAULT_RELEASE_ANNOUNCEMENT.externalUrl
  );
  const enabledOverride = readEnvBoolean('VITE_RELEASE_ANNOUNCEMENT_ENABLED');
  return {
    ...DEFAULT_RELEASE_ANNOUNCEMENT,
    ...runtime,
    enabled: typeof runtime.enabled === 'boolean' ? runtime.enabled : enabledOverride ?? DEFAULT_RELEASE_ANNOUNCEMENT.enabled,
    id: firstText(runtime.id, readEnvValue('VITE_RELEASE_ANNOUNCEMENT_ID'), DEFAULT_RELEASE_ANNOUNCEMENT.id),
    title: firstText(runtime.title, readEnvValue('VITE_RELEASE_ANNOUNCEMENT_TITLE'), DEFAULT_RELEASE_ANNOUNCEMENT.title),
    summary: firstText(runtime.summary, readEnvValue('VITE_RELEASE_ANNOUNCEMENT_SUMMARY'), DEFAULT_RELEASE_ANNOUNCEMENT.summary),
    sourceLabel: firstText(runtime.sourceLabel, DEFAULT_RELEASE_ANNOUNCEMENT.sourceLabel),
    embedUrl: String(embedUrl || '').trim(),
    externalUrl: String(externalUrl || '').trim(),
    items: Array.isArray(runtime.items) ? runtime.items : DEFAULT_RELEASE_ANNOUNCEMENT.items,
    sourceCommits: Array.isArray(runtime.sourceCommits) ? runtime.sourceCommits : DEFAULT_RELEASE_ANNOUNCEMENT.sourceCommits
  };
}
