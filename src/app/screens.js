export const PROJECT_ID = '4075224789216868860';
export const PROJECT_TITLE = 'Stock Accumulation Calculator Dashboard';
export const HOME_SCREEN_ID = '75a393ec1a2d424ebafa1d0e59402d26';

export const GROUP_ORDER = ['home', 'accumEdit', 'accumNew', 'addLevel', 'dca', 'fundSwitch', 'history'];

export const GROUP_META = {
  home: {
    label: '封面与总览',
    description: '首页、仪表盘和移动端封面页面。',
    activeTab: 'home'
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

const SCREEN_GROUP_IDS = {
  home: [
    '75a393ec1a2d424ebafa1d0e59402d26',
    '8692ca0737d74aa78bd270ddbd5b1bf6',
    'd8f0b16bd9d24c62992a5198ba3fa857',
    '8d93d9d89df94ffdafd339da9d50f0b7',
    '0754eda620a54150bd6b646b17aedc95',
    '0b7f16c425a94d759f2a42e81a76be26',
    '26eb098db14e4c4bb059b607c9578acc',
    '42a1829a673444b584ff07bf3d340678',
    '4acb407f6b6f4aa19d48e14db8fc3a02'
  ],
  accumEdit: [
    '81fee20edb5542f08bb363ac837b327c',
    '810ef0f6ff574c049df021d099547b63',
    'd4ce671ce96341e1b4f20743a78c4963',
    '3b3fa48876b2428c8b0da9b5a6d0b21d',
    '13991f2d68d64c138978ca10834cf4e6'
  ],
  addLevel: ['d142c0822784448ab9b8016e300bd25c'],
  accumNew: ['03ef40c5dff048f8b1416a6a4567f9ee', '09c23b22bbfb45f090edd43a2022b1d6'],
  dca: [
    '530f6fe554444798820046dee4d4b889',
    '6878eff12a044d799bb7943f2753cbfa',
    '8a9f687cbc2b43aa8ff9a3fee729d4f0',
    '01a499e7120746da9b03b18b20876e4a',
    '42e23956702a4e488dfd2e7d002b1a1f',
    '328ef14fcb034d1186f1d3fe19c7852f'
  ],
  fundSwitch: ['5e3d43b9c2ea47f9b5d2be752bca564e'],
  history: ['65aaf3e700d3443c9810f6c727b045e8']
};

const SCREEN_GROUPS = Object.fromEntries(
  Object.entries(SCREEN_GROUP_IDS).map(([group, ids]) => [group, new Set(ids)])
);

const RAW_SCREENS = [
  { id: '75a393ec1a2d424ebafa1d0e59402d26', title: '股票左侧建仓计算器 - 金字塔比例增强版', device: 'DESKTOP' },
  { id: '01a499e7120746da9b03b18b20876e4a', title: '定投计划配置 - 灵活执行日期版', device: 'DESKTOP' },
  { id: '3b3fa48876b2428c8b0da9b5a6d0b21d', title: '修改 QQQ 建仓策略配置 - Axiom Trade', device: 'DESKTOP' },
  { id: 'd142c0822784448ab9b8016e300bd25c', title: '新增加仓层级 - Axiom Trade', device: 'DESKTOP' },
  { id: '03ef40c5dff048f8b1416a6a4567f9ee', title: '新增建仓计划 - 配置页面', device: 'DESKTOP' },
  { id: '26eb098db14e4c4bb059b607c9578acc', title: 'Investment Strategy Platform', device: 'MOBILE' },
  { id: 'd4ce671ce96341e1b4f20743a78c4963', title: '修改 QQQ 建仓策略配置', device: 'DESKTOP' },
  { id: '13991f2d68d64c138978ca10834cf4e6', title: '加仓策略配置 - 均线倍率版', device: 'DESKTOP' },
  { id: '65aaf3e700d3443c9810f6c727b045e8', title: 'QQQ 交易历史 - Axiom Trade', device: 'DESKTOP' },
  { id: '328ef14fcb034d1186f1d3fe19c7852f', title: '修改 QQQ 投资策略 - Axiom Trade', device: 'DESKTOP' },
  { id: '42e23956702a4e488dfd2e7d002b1a1f', title: '修改定期定额策略配置 - Axiom Trade', device: 'DESKTOP' },
  { id: '5e3d43b9c2ea47f9b5d2be752bca564e', title: '基金切换收益助手 - 持仓编辑页', device: 'DESKTOP' },
  { id: '0754eda620a54150bd6b646b17aedc95', title: 'QQQ 建仓策略 - 自选股与策略集成版', device: 'DESKTOP' },
  { id: '09c23b22bbfb45f090edd43a2022b1d6', title: '新增建仓计划 - 统一导航版', device: 'DESKTOP' },
  { id: '0b7f16c425a94d759f2a42e81a76be26', title: '股票左侧建仓计算器 - 中文版', device: 'MOBILE' },
  { id: '42a1829a673444b584ff07bf3d340678', title: 'Stock Accumulation Calculator Dashboard', device: 'DESKTOP' },
  { id: '4acb407f6b6f4aa19d48e14db8fc3a02', title: 'Axiom Trade Investment Strategy Flow', device: 'DESKTOP' },
  { id: '530f6fe554444798820046dee4d4b889', title: '定期定额策略配置 - 中文版', device: 'DESKTOP' },
  { id: '6878eff12a044d799bb7943f2753cbfa', title: '定期定额策略配置 - Axiom Trade', device: 'DESKTOP' },
  { id: '810ef0f6ff574c049df021d099547b63', title: '修改 QQQ 建仓策略 - 统一导航版', device: 'DESKTOP' },
  { id: '81fee20edb5542f08bb363ac837b327c', title: '修改 QQQ 建仓策略配置 - 中文版', device: 'DESKTOP' },
  { id: '8692ca0737d74aa78bd270ddbd5b1bf6', title: '股票左侧建仓计算器 - 导航优化版', device: 'DESKTOP' },
  { id: '8a9f687cbc2b43aa8ff9a3fee729d4f0', title: '定期定额策略配置 - 增加执行日期选项', device: 'DESKTOP' },
  { id: '8d93d9d89df94ffdafd339da9d50f0b7', title: '股票建仓追踪仪表盘 - 中文版', device: 'DESKTOP' },
  { id: 'd8f0b16bd9d24c62992a5198ba3fa857', title: '股票左侧建仓计算器 - 中文版', device: 'DESKTOP' }
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
  return inPagesDir ? `./${screenId}.html` : `./pages/${screenId}.html`;
}

export function createPageLinks({ inPagesDir = false } = {}) {
  return {
    home: inPagesDir ? `./${HOME_SCREEN_ID}.html` : './index.html',
    accumEdit: pageHref('81fee20edb5542f08bb363ac837b327c', { inPagesDir }),
    accumNew: pageHref('03ef40c5dff048f8b1416a6a4567f9ee', { inPagesDir }),
    addLevel: pageHref('d142c0822784448ab9b8016e300bd25c', { inPagesDir }),
    dca: pageHref('530f6fe554444798820046dee4d4b889', { inPagesDir }),
    fundSwitch: pageHref('5e3d43b9c2ea47f9b5d2be752bca564e', { inPagesDir }),
    history: pageHref('65aaf3e700d3443c9810f6c727b045e8', { inPagesDir }),
    catalog: inPagesDir ? '../catalog.html' : './catalog.html'
  };
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
      page_url: `pages/${screen.id}.html`,
      screenshot_url: null,
      is_homepage: screen.id === HOME_SCREEN_ID
    }))
  };
}
