export const PROJECT_ID = '4075224789216868860';
export const PROJECT_TITLE = '美股策略助手';

// 主 tab 顺序与元数据：所有页面都通过 WorkspacePage（侧边栏 + ?tab=）展示。
// 加仓计划（home）和定投计划（dca）已并入交易计划 tab，作为其二级 tab，不再独立出现在侧边栏。
// 「高级版」已移出主侧栏，入口改为账户菜单/页脚；admin-only 的「数据」在侧栏底部单独分组。
// 策略指南已移除，主页默认为行情中心，由标的详情进入持仓和交易计划。
export const DEFAULT_WORKSPACE_TAB = 'markets';
export const PRIMARY_TAB_ORDER = ['markets', 'holdings', 'tradePlans', 'fundSwitch', 'notify'];
export const ADMIN_TAB_ORDER = ['adminData', 'cloudData'];

export const PRIMARY_TAB_META = {
  tradePlans: { label: '交易计划', hrefKey: 'tradePlans' },
  fundSwitch: { label: '基金切换', hrefKey: 'fundSwitch' },
  markets: { label: '行情中心', hrefKey: 'markets' },
  holdings: { label: '持仓总览', hrefKey: 'holdings' },
  newPlan: { label: '新建计划', hrefKey: 'newPlan' },
  notify: { label: '通知管理', hrefKey: 'notify' },
  adminData: { label: '数据', hrefKey: 'adminData', adminOnly: true },
  cloudData: { label: '云端数据', hrefKey: 'cloudData', adminOnly: true }
};

export const WORKSPACE_TAB_META = {
  ...PRIMARY_TAB_META
};

// Legacy ?tab=home / ?tab=dca 进来时映射到 tradePlans 的对应二级视图。
// WorkspacePage 在 mount 时读取 query，将其重写到 ?tab=tradePlans 并把 hash 设为 LEGACY_TAB_HASH 中的值。
export const LEGACY_TAB_REDIRECTS = {
  home: { tab: 'tradePlans', hash: '#home' },
  dca: { tab: 'tradePlans', hash: '#dca' },
  quant: { tab: DEFAULT_WORKSPACE_TAB },
  'quant:v2': { tab: DEFAULT_WORKSPACE_TAB },
  'quant:funds': { tab: DEFAULT_WORKSPACE_TAB },
  'quant:fills': { tab: DEFAULT_WORKSPACE_TAB },
  'quant:etf': { tab: DEFAULT_WORKSPACE_TAB }
};

// 所有链接都指向唯一的 index.html，通过 ?tab= 查询参数切换。
// 兼容性：原本的 accumNew/accumEdit/addLevel 独立页已合并到主入口，重定向到对应 tab；
// links.home / links.dca 现在都指向交易计划 tab 的二级视图。
export function createPageLinks({ inPagesDir = false } = {}) {
  const indexHref = inPagesDir ? '../index.html' : './index.html';
  return {
    home: indexHref,
    tradePlans: `${indexHref}?tab=tradePlans`,
    tradePlansHome: `${indexHref}?tab=tradePlans#home`,
    dca: `${indexHref}?tab=tradePlans#dca`,
    fundSwitch: `${indexHref}?tab=fundSwitch`,
    markets: `${indexHref}?tab=markets`,
    holdings: `${indexHref}?tab=holdings`,
    newPlan: `${indexHref}?tab=newPlan`,
    notify: `${indexHref}?tab=notify`,
    adminData: `${indexHref}?tab=adminData`,
    cloudData: `${indexHref}?tab=cloudData`,
    // 旧入口已并入交易计划 tab 的 #new 子视图
    accumNew: `${indexHref}?tab=tradePlans#new`,
    accumEdit: indexHref,
    addLevel: indexHref,
    catalog: indexHref
  };
}

export function getPrimaryTabs(links) {
  return PRIMARY_TAB_ORDER.map((key) => ({
    key,
    label: PRIMARY_TAB_META[key].label,
    href: links[PRIMARY_TAB_META[key].hrefKey]
  }));
}

export function getAdminTabs(links) {
  return ADMIN_TAB_ORDER.map((key) => ({
    key,
    label: PRIMARY_TAB_META[key].label,
    href: links[PRIMARY_TAB_META[key].hrefKey]
  }));
}

export function isWorkspaceGroup(group = '') {
  return PRIMARY_TAB_ORDER.includes(group) || ADMIN_TAB_ORDER.includes(group);
}
