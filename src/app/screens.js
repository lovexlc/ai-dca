export const PROJECT_ID = '4075224789216868860';
export const PROJECT_TITLE = '美股策略助手';

// 主 tab 顺序与元数据：所有页面都通过 WorkspacePage（侧边栏 + ?tab=）展示。
export const DEFAULT_WORKSPACE_TAB = 'home';
export const PRIMARY_TAB_ORDER = ['home', 'markets', 'holdings', 'tradePlans', 'fundSwitch', 'notify'];
export const ADMIN_TAB_ORDER = ['adminData'];

export const PRIMARY_TAB_META = {
  home: { label: '首页', hrefKey: 'home' },
  strategy: { label: '策略指南', hrefKey: 'strategy' },
  tradePlans: { label: '交易计划', hrefKey: 'tradePlans' },
  fundSwitch: { label: '基金切换', hrefKey: 'fundSwitch' },
  markets: { label: '行情中心', hrefKey: 'markets' },
  holdings: { label: '持仓总览', hrefKey: 'holdings' },
  newPlan: { label: '新建计划', hrefKey: 'newPlan' },
  notify: { label: '通知管理', hrefKey: 'notify' },
  adminData: { label: '数据', hrefKey: 'adminData', adminOnly: true }
};

export const WORKSPACE_TAB_META = { ...PRIMARY_TAB_META };

// 历史独立页继续映射到现有主 tab；home 已恢复为真实首页。
export const LEGACY_TAB_REDIRECTS = {
  dca: { tab: 'tradePlans', hash: '#dca' },
  quant: { tab: DEFAULT_WORKSPACE_TAB },
  'quant:v2': { tab: DEFAULT_WORKSPACE_TAB },
  'quant:funds': { tab: DEFAULT_WORKSPACE_TAB },
  'quant:fills': { tab: DEFAULT_WORKSPACE_TAB },
  'quant:etf': { tab: DEFAULT_WORKSPACE_TAB }
};

export function createPageLinks({ inPagesDir = false } = {}) {
  const indexHref = inPagesDir ? '../index.html' : './index.html';
  return {
    home: `${indexHref}?tab=home`,
    strategy: `${indexHref}?tab=strategy`,
    tradePlans: `${indexHref}?tab=tradePlans`,
    tradePlansHome: `${indexHref}?tab=tradePlans#home`,
    dca: `${indexHref}?tab=tradePlans#dca`,
    fundSwitch: `${indexHref}?tab=fundSwitch`,
    markets: `${indexHref}?tab=markets`,
    holdings: `${indexHref}?tab=holdings`,
    newPlan: `${indexHref}?tab=newPlan`,
    notify: `${indexHref}?tab=notify`,
    adminData: `${indexHref}?tab=adminData`,
    accumNew: `${indexHref}?tab=tradePlans#new`,
    accumEdit: indexHref,
    addLevel: indexHref,
    catalog: indexHref
  };
}

export function getPrimaryTabs(links) {
  return PRIMARY_TAB_ORDER.map((key) => ({ key, label: PRIMARY_TAB_META[key].label, href: links[PRIMARY_TAB_META[key].hrefKey] }));
}

export function getAdminTabs(links) {
  return ADMIN_TAB_ORDER.map((key) => ({ key, label: PRIMARY_TAB_META[key].label, href: links[PRIMARY_TAB_META[key].hrefKey] }));
}

export function isWorkspaceGroup(group = '') {
  return PRIMARY_TAB_ORDER.includes(group) || ADMIN_TAB_ORDER.includes(group);
}
