// beta（小程序版）信息架构：对齐 ai-dca-miniprogram 的 app.json。
// 5 个 tab + 19 个页面。这里只描述导航结构，不含业务逻辑，
// 方便先落地骨架再逐块搬运页面。

export const DEFAULT_BETA_TAB = 'home';

export const BETA_TAB_ORDER = ['home', 'markets', 'holdings', 'tradeplans', 'profile'];

export const BETA_TAB_META = {
  home: { label: '首页', mpPage: 'pages/home/index' },
  markets: { label: '行情', mpPage: 'pages/markets/index' },
  holdings: { label: '持仓', mpPage: 'pages/holdings/index' },
  tradeplans: { label: '计划', mpPage: 'pages/tradeplans/index' },
  profile: { label: '我的', mpPage: 'pages/profile/index' }
};

// tab 为 null 表示二级页面（从某个 tab 或详情入口进入，不出现在底部 tab 栏）。
export const BETA_PAGES = [
  { key: 'home', label: '首页', tab: 'home', status: 'pending' },
  { key: 'premium-history', label: '溢价历史', tab: 'home', status: 'pending' },
  { key: 'markets', label: '行情', tab: 'markets', status: 'pending' },
  { key: 'market-detail', label: '行情详情', tab: null, status: 'pending' },
  { key: 'fund-limit-detail', label: '限购详情', tab: null, status: 'pending' },
  { key: 'holdings', label: '持仓', tab: 'holdings', status: 'pending' },
  { key: 'holdings-detail', label: '持仓详情', tab: null, status: 'pending' },
  { key: 'fund-income', label: '基金收益', tab: null, status: 'pending' },
  { key: 'fund-tx', label: '交易记录', tab: null, status: 'pending' },
  { key: 'tradeplans', label: '交易计划', tab: 'tradeplans', status: 'pending' },
  { key: 'newplan', label: '新建计划', tab: null, status: 'pending' },
  { key: 'dcaplan', label: '定投计划', tab: null, status: 'pending' },
  { key: 'sellplan', label: '卖出计划', tab: null, status: 'pending' },
  { key: 'switch', label: '换基', tab: 'tradeplans', status: 'pending' },
  { key: 'fundswitch', label: '换基策略', tab: null, status: 'pending' },
  { key: 'backtest', label: '回测', tab: 'tradeplans', status: 'pending' },
  { key: 'backtest-detail', label: '回测详情', tab: null, status: 'pending' },
  { key: 'notify', label: '交易提醒', tab: 'profile', status: 'pending' },
  { key: 'profile', label: '我的', tab: 'profile', status: 'pending' }
];

const PAGES_BY_KEY = new Map(BETA_PAGES.map((page) => [page.key, page]));

export function isBetaTab(key = '') {
  return BETA_TAB_ORDER.includes(String(key));
}

export function normalizeBetaTab(key) {
  const value = String(key || '').trim();
  return isBetaTab(value) ? value : DEFAULT_BETA_TAB;
}

export function getBetaTabs() {
  return BETA_TAB_ORDER.map((key) => ({ key, label: BETA_TAB_META[key].label }));
}

export function findBetaPage(key) {
  return PAGES_BY_KEY.get(String(key || '')) || null;
}

export function getPagesForTab(tab) {
  const key = normalizeBetaTab(tab);
  return BETA_PAGES.filter((page) => page.tab === key);
}
