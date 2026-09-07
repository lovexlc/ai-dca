/** 场景配置：CN 默认进入本地数据首页。 */
export const SCENARIOS = {
  stock: {
    key: 'stock',
    label: '持仓交易',
    icon: 'TrendingUp',
    description: '首页、持仓、交易计划与行情',
    defaultHome: 'home',
    visibleTabs: ['home', 'markets', 'holdings', 'tradePlans', 'fundSwitch', 'notify', 'adminData'],
    requireAdmin: false
  }
};

export function getScenario(scenarioKey) {
  return SCENARIOS[scenarioKey] || SCENARIOS.stock;
}

export function getAvailableScenarios(isAdmin = false) {
  return Object.values(SCENARIOS).filter((scenario) => !scenario.requireAdmin || isAdmin);
}

export function isTabVisibleInScenario(tabKey, scenarioKey) {
  return getScenario(scenarioKey).visibleTabs.includes(tabKey);
}
