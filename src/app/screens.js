export const PROJECT_ID = '4075224789216868860';
export const PROJECT_TITLE = '美股策略助手';

// 主 tab 顺序与元数据：所有页面都通过 WorkspacePage（侧边栏 + ?tab=）展示。
// 加仓计划（home）和定投计划（dca）已并入交易计划 tab，作为其二级 tab，不再独立出现在侧边栏。
// 「高级版」已移出主侧栏，入口改为账户菜单/页脚；admin-only 的「量化研究」「数据」在侧栏底部单独分组。
// 策略指南已移除，主页默认为持仓总览。
export const DEFAULT_WORKSPACE_TAB = 'holdings';
export const PRIMARY_TAB_ORDER = ['holdings', 'tradePlans', 'fundSwitch', 'markets', 'notify'];
export const ADMIN_TAB_ORDER = ['quant', 'adminData'];
export const QUANT_MODULE_TAB_PREFIX = 'quant:';
export const DEFAULT_QUANT_MODULE_TAB = 'quant:strategy';
export const QUANT_MODULE_TABS = [
  { key: 'quant:strategy', module: 'strategy', label: '策略', hrefKey: 'quantStrategy', adminOnly: true },
  { key: 'quant:backtest', module: 'backtest', label: '回测', hrefKey: 'quantBacktest', adminOnly: true },
  { key: 'quant:live', module: 'live', label: '实盘', hrefKey: 'quantLive', adminOnly: true }
];
// 旧 module 名 → 新 module 名（用于 ?module= 兼容旧链接）
export const LEGACY_QUANT_MODULE_REDIRECTS = {
  v2: 'backtest',
  funds: 'live',
  fills: 'live',
  etf: 'strategy'
};
export const QUANT_MODULE_TAB_KEYS = QUANT_MODULE_TABS.map((tab) => tab.key);

export const PRIMARY_TAB_META = {
  strategy: { label: '策略指南', hrefKey: 'strategy' },
  tradePlans: { label: '交易计划', hrefKey: 'tradePlans' },
  quant: { label: '量化研究', hrefKey: 'quant', adminOnly: true },
  fundSwitch: { label: '基金切换', hrefKey: 'fundSwitch' },
  markets: { label: '行情中心', hrefKey: 'markets' },
  holdings: { label: '持仓总览', hrefKey: 'holdings' },
  newPlan: { label: '新建计划', hrefKey: 'newPlan' },
  notify: { label: '通知管理', hrefKey: 'notify' },
  adminData: { label: '数据', hrefKey: 'adminData', adminOnly: true }
};

export const WORKSPACE_TAB_META = {
  ...PRIMARY_TAB_META,
  ...Object.fromEntries(QUANT_MODULE_TABS.map((tab) => [tab.key, tab]))
};

// Legacy ?tab=home / ?tab=dca 进来时映射到 tradePlans 的对应二级视图。
// WorkspacePage 在 mount 时读取 query，将其重写到 ?tab=tradePlans 并把 hash 设为 LEGACY_TAB_HASH 中的值。
export const LEGACY_TAB_REDIRECTS = {
  home: { tab: 'tradePlans', hash: '#home' },
  dca: { tab: 'tradePlans', hash: '#dca' },
  // 旧量化场景 tab 全部并入新的 3 段 IA：策略 / 回测 / 实盘
  'quant:v2': { tab: 'quant:backtest' },
  'quant:funds': { tab: 'quant:live' },
  'quant:fills': { tab: 'quant:live' },
  'quant:etf': { tab: 'quant:strategy' }
};

// 所有链接都指向唯一的 index.html，通过 ?tab= 查询参数切换。
// 兼容性：原本的 accumNew/accumEdit/addLevel 独立页已合并到主入口，重定向到对应 tab；
// links.home / links.dca 现在都指向交易计划 tab 的二级视图。
export function createPageLinks({ inPagesDir = false } = {}) {
  const indexHref = inPagesDir ? '../index.html' : './index.html';
  return {
    home: indexHref,
    strategy: `${indexHref}?tab=strategy`,
    tradePlans: `${indexHref}?tab=tradePlans`,
    quant: `${indexHref}?tab=quant`,
    quantStrategy: `${indexHref}?tab=quant&module=strategy`,
    quantBacktest: `${indexHref}?tab=quant&module=backtest`,
    quantLive: `${indexHref}?tab=quant&module=live`,
    quantFunds: `${indexHref}?tab=quant&module=live`,
    quantFills: `${indexHref}?tab=quant&module=live`,
    quantEtf: `${indexHref}?tab=quant&module=strategy`,
    quantDashboard: `${indexHref}?tab=quant&module=strategy`,
    quantMarketData: `${indexHref}?tab=quant&module=strategy`,
    quantResearch: `${indexHref}?tab=quant&module=strategy`,
    quantTrading: `${indexHref}?tab=quant&module=live`,
    quantRisk: `${indexHref}?tab=quant&module=strategy`,
    quantPerformance: `${indexHref}?tab=quant&module=live`,
    quantSettings: `${indexHref}?tab=quant&module=strategy`,
    tradePlansHome: `${indexHref}?tab=tradePlans#home`,
    dca: `${indexHref}?tab=tradePlans#dca`,
    fundSwitch: `${indexHref}?tab=fundSwitch`,
    markets: `${indexHref}?tab=markets`,
    holdings: `${indexHref}?tab=holdings`,
    newPlan: `${indexHref}?tab=newPlan`,
    notify: `${indexHref}?tab=notify`,
    adminData: `${indexHref}?tab=adminData`,
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

export function getQuantModuleTabs(links) {
  return QUANT_MODULE_TABS.map((tab) => ({
    key: tab.key,
    label: tab.label,
    href: links[tab.hrefKey]
  }));
}

export function isWorkspaceGroup(group = '') {
  return PRIMARY_TAB_ORDER.includes(group) || ADMIN_TAB_ORDER.includes(group) || QUANT_MODULE_TAB_KEYS.includes(group);
}
