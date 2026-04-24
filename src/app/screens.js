export const PROJECT_ID = '4075224789216868860';
export const PROJECT_TITLE = '股票建仓策略看板';
export const HOME_SCREEN_ID = '75a393ec1a2d424ebafa1d0e59402d26';

export const GROUP_ORDER = ['tradePlans', 'home', 'accumEdit', 'accumNew', 'addLevel', 'dca', 'fundSwitch', 'history'];
export const PRIMARY_TAB_ORDER = ['tradePlans', 'home', 'dca', 'fundSwitch', 'history', 'holdings', 'newPlan', 'backup'];

export const GROUP_META = {
  home: {
    label: '加仓计划',
    description: '首页、仪表盘和移动端封面页面。',
    activeTab: 'home'
  },
  tradePlans: {
    label: '交易计划',
    description: '统一查看后续待执行的交易计划与通知状态。',
    activeTab: 'tradePlans'
  },
  accumEdit: {
    label: '加仓配置',
    description: '按首笔价格和最大跌幅联动计算每层入场位。',
    activeTab: 'accumEdit'
  },
  accumNew: {
    label: '建仓计划',
    description: '配置总预算、现金留存比例和建仓层级。',
    activeTab: 'home'
  },
  addLevel: {
    label: '新增层级',
    description: '在当前加仓模型上追加一个新的层级。',
    activeTab: 'accumEdit'
  },
  dca: {
    label: '定投计划',
    description: '管理初始投入、定投频率和执行日。',
    activeTab: 'dca'
  },
  fundSwitch: {
    label: '基金切换助手',
    description: '导入交易截图并核对基金切换收益。',
    activeTab: 'fundSwitch'
  },
  history: {
    label: '历史记录',
    description: '查看交易记录和当前层级快照。',
    activeTab: 'accumEdit'
  }
};

export const PRIMARY_TAB_META = {
  tradePlans: { label: '交易计划', hrefKey: 'tradePlans' },
  home: { label: '加仓计划', hrefKey: 'home' },
  dca: { label: '定投计划', hrefKey: 'dca' },
  fundSwitch: { label: '基金切换', hrefKey: 'fundSwitch' },
  history: { label: '交易历史', hrefKey: 'history' },
  holdings: { label: '持仓总览', hrefKey: 'holdings' },
  newPlan: { label: '新建计划', hrefKey: 'newPlan' },
  backup: { label: '数据同步 / 备份', hrefKey: 'backup' }
};

const SCREEN_GROUP_IDS = {
  home: ['75a393ec1a2d424ebafa1d0e59402d26'],
  tradePlans: ['1c4b8d2f5a6748c7a0e3d1b6f9c2a4e8'],
  accumEdit: ['81fee20edb5542f08bb363ac837b327c'],
  addLevel: ['d142c0822784448ab9b8016e300bd25c'],
  accumNew: ['03ef40c5dff048f8b1416a6a4567f9ee'],
  dca: ['530f6fe554444798820046dee4d4b889'],
  fundSwitch: ['5e3d43b9c2ea47f9b5d2be752bca564e'],
  history: ['65aaf3e700d3443c9810f6c727b045e8']
};

const SCREEN_GROUPS = Object.fromEntries(
  Object.entries(SCREEN_GROUP_IDS).map(([group, ids]) => [group, new Set(ids)])
);

const RAW_SCREENS = [
  { id: '75a393ec1a2d424ebafa1d0e59402d26', title: '加仓计划', device: 'DESKTOP' },
  { id: '1c4b8d2f5a6748c7a0e3d1b6f9c2a4e8', title: '交易计划中心', device: 'DESKTOP' },
  { id: '81fee20edb5542f08bb363ac837b327c', title: '加仓策略配置', device: 'DESKTOP' },
  { id: 'd142c0822784448ab9b8016e300bd25c', title: '新增建仓层级', device: 'DESKTOP' },
  { id: '03ef40c5dff048f8b1416a6a4567f9ee', title: '新建建仓计划', device: 'DESKTOP' },
  { id: '65aaf3e700d3443c9810f6c727b045e8', title: '交易历史', device: 'DESKTOP' },
  { id: '5e3d43b9c2ea47f9b5d2be752bca564e', title: '基金切换收益分析', device: 'DESKTOP' },
  { id: '530f6fe554444798820046dee4d4b889', title: '定投计划', device: 'DESKTOP' }
];

function resolveGroup(screenId) {
  for (const [group, ids] of Object.entries(SCREEN_GROUPS)) {
    if (ids.has(screenId)) {
      return group;
    }
  }
  return 'home';
}

export const screens = RAW_SCREENS.map((screen, index) => ({
  ...screen,
  order: index,
  group: resolveGroup(screen.id),
  deviceLabel: screen.device === 'MOBILE' ? '移动端' : '桌面端'
}));

const screenMap = new Map(screens.map((screen) => [screen.id, screen]));

export function getScreen(screenId) {
  return screenMap.get(screenId) || screenMap.get(HOME_SCREEN_ID);
}

export function getGroupedScreens() {
  return GROUP_ORDER.map((key) => ({
    key,
    ...GROUP_META[key],
    screens: screens.filter((screen) => screen.group === key)
  })).filter((group) => group.screens.length > 0);
}

export function pageHref(screenId, { inPagesDir = false } = {}) {
  return inPagesDir ? `./${screenId}.html` : `./pages-v2/${screenId}.html`;
}

export function createPageLinks({ inPagesDir = false } = {}) {
  return {
    home: inPagesDir ? '../index.html' : './index.html',
    tradePlans: pageHref('1c4b8d2f5a6748c7a0e3d1b6f9c2a4e8', { inPagesDir }),
    accumEdit: pageHref('81fee20edb5542f08bb363ac837b327c', { inPagesDir }),
    accumNew: pageHref('03ef40c5dff048f8b1416a6a4567f9ee', { inPagesDir }),
    addLevel: pageHref('d142c0822784448ab9b8016e300bd25c', { inPagesDir }),
    dca: pageHref('530f6fe554444798820046dee4d4b889', { inPagesDir }),
    fundSwitch: pageHref('5e3d43b9c2ea47f9b5d2be752bca564e', { inPagesDir }),
    history: pageHref('65aaf3e700d3443c9810f6c727b045e8', { inPagesDir }),
    holdings: inPagesDir ? '../index.html?tab=holdings' : './index.html?tab=holdings',
    newPlan: inPagesDir ? '../index.html?tab=newPlan' : './index.html?tab=newPlan',
    backup: inPagesDir ? '../index.html?tab=backup' : './index.html?tab=backup',
    catalog: inPagesDir ? '../index.html' : './index.html'
  };
}

export function getPrimaryTabs(links) {
  return PRIMARY_TAB_ORDER.map((key) => ({
    key,
    label: PRIMARY_TAB_META[key].label,
    href: links[PRIMARY_TAB_META[key].hrefKey]
  }));
}

export function isWorkspaceGroup(group = '') {
  return PRIMARY_TAB_ORDER.includes(group);
}

export function buildSiteManifest() {
  return {
    project_id: PROJECT_ID,
    project_title: PROJECT_TITLE,
    homepage_screen_id: HOME_SCREEN_ID,
    html_count: screens.length,
    screenshot_count: 0,
    screens: screens.map((screen) => ({
      screen_id: screen.id,
      title: screen.title,
      device: screen.device,
      page_url: screen.id === HOME_SCREEN_ID ? 'index.html' : `pages-v2/${screen.id}.html`,
      screenshot_url: null,
      is_homepage: screen.id === HOME_SCREEN_ID
    }))
  };
}
