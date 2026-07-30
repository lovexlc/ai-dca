export const PROJECT_ID = '4075224789216868860';
export const PROJECT_TITLE = '美股策略助手';

// 主 tab 顺序与元数据：所有页面都通过 WorkspacePage（顶部分组导航 + ?tab=）展示。
// 这里维护的是可访问的工作区路由，不等于顶栏上显示的分组数量。
// 加仓计划（home）、定投计划（dca）和卖出计划（sell）已并入交易计划 tab，作为其二级 tab。
// 「高级版」已移出主侧栏，入口改为账户菜单/页脚；admin-only 的「数据」在侧栏底部单独分组。
// 门户首页作为默认入口，行情中心仍保留为一级导航和详情入口。
export const DEFAULT_WORKSPACE_TAB = 'portal';
export const PRIMARY_TAB_ORDER = ['portal', 'markets', 'holdings', 'tradePlans', 'fundSwitch', 'backtest', 'emotion', 'notify'];
export const ADMIN_TAB_ORDER = ['adminData'];

export const PRIMARY_TAB_META = {
  portal: { label: '首页', hrefKey: 'portal' },
  tradePlans: { label: '交易计划', hrefKey: 'tradePlans' },
  fundSwitch: { label: '换基策略', hrefKey: 'fundSwitch' },
  backtest: { label: '回测', hrefKey: 'backtest' },
  markets: { label: '行情', hrefKey: 'markets' },
  holdings: { label: '持仓与收益', hrefKey: 'holdings' },
  emotion: { label: '市场压力', hrefKey: 'emotion' },
  newPlan: { label: '新建计划', hrefKey: 'newPlan' },
  notify: { label: '交易提醒', hrefKey: 'notify' },
  adminData: { label: '数据', hrefKey: 'adminData', adminOnly: true }
};

// 顶部导航按工作场景分组。每个入口保留短说明，方便用户在下拉菜单中判断
// 目的地，同时不改变现有 hash/query 路由。提醒属于跨模块工具，放到 NAV_UTILITY_ITEMS。
export const NAV_GROUPS = [
  {
    key: 'portal',
    label: '首页',
    items: [
      { key: 'portal', label: '首页', description: '查看市场概览、信号和常用功能', hrefKey: 'portal' }
    ]
  },
  {
    key: 'markets',
    label: '市场',
    items: [
      { key: 'markets', label: '行情', description: '自选标的、指数和个股走势', hrefKey: 'markets' },
      { key: 'emotion', label: '市场压力', description: '查看压力因子与转向信号', hrefKey: 'emotion' }
    ]
  },
  {
    key: 'holdings',
    label: '持仓',
    items: [
      { key: 'holdings', label: '持仓与收益', description: '查看持仓、收益和交易记录', hrefKey: 'holdings' }
    ]
  },
  {
    key: 'strategy',
    label: '策略',
    items: [
      { key: 'tradePlans', label: '交易计划', description: '集中管理加仓、定投和卖出计划', targetKey: 'tradePlans', hrefKey: 'tradePlans' },
      { key: 'fundSwitch', label: '换基策略', description: '比较候选基金并管理换基规则', hrefKey: 'fundSwitch' },
      { key: 'backtest', label: '策略回测', description: '用历史行情验证持有与轮动策略', hrefKey: 'backtest' }
    ]
  }
];

export const NAV_UTILITY_ITEMS = [
  { key: 'notify', label: '交易提醒', description: '查看通知记录、配置渠道与提醒规则', hrefKey: 'notify' },
  { key: 'adminData', label: '数据', description: '管理员数据看板', hrefKey: 'adminData', adminOnly: true }
];

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
// links.home 作为门户首页入口，links.dca / links.tradePlansHome 指向交易计划二级视图。
export function createPageLinks({ inPagesDir = false } = {}) {
  const indexHref = inPagesDir ? '../index.html' : './index.html';
  return {
    home: indexHref,
    portal: `${indexHref}?tab=portal`,
    tradePlans: `${indexHref}?tab=tradePlans`,
    tradePlansHome: `${indexHref}?tab=tradePlans#home`,
    dca: `${indexHref}?tab=tradePlans#dca`,
    fundSwitch: `${indexHref}?tab=fundSwitch`,
    backtest: `${indexHref}?tab=backtest`,
    emotion: `${indexHref}?tab=emotion`,
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

export function isWorkspaceGroup(group = '') {
  return PRIMARY_TAB_ORDER.includes(group) || ADMIN_TAB_ORDER.includes(group);
}
