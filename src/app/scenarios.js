/**
 * 场景配置
 * 定义不同使用场景下的可见功能模块和默认首页
 */

export const SCENARIOS = {
  stock: {
    key: 'stock',
    label: '美股交易',
    icon: 'TrendingUp',
    description: '适合美股投资者',
    defaultHome: 'strategy',
    visibleTabs: ['strategy', 'holdings', 'tradePlans', 'markets', 'premium', 'notify'],
    requireAdmin: false
  },
  fund: {
    key: 'fund',
    label: '基金定投',
    icon: 'PieChart',
    description: '适合基金定投用户',
    defaultHome: 'tradePlans',
    visibleTabs: ['tradePlans', 'holdings', 'fundSwitch', 'markets', 'premium', 'notify'],
    requireAdmin: false
  },
  quant: {
    key: 'quant',
    label: '量化研究',
    icon: 'Bot',
    description: '需要管理员权限',
    defaultHome: 'quant',
    visibleTabs: ['quant', 'adminData', 'holdings', 'markets', 'strategy', 'notify'],
    requireAdmin: true
  }
};

/**
 * 获取场景配置
 * @param {string} scenarioKey - 场景 key
 * @returns {Object} 场景配置对象
 */
export function getScenario(scenarioKey) {
  return SCENARIOS[scenarioKey] || SCENARIOS.stock;
}

/**
 * 获取用户可用的场景列表
 * @param {boolean} isAdmin - 是否是管理员
 * @returns {Array} 可用场景列表
 */
export function getAvailableScenarios(isAdmin = false) {
  return Object.values(SCENARIOS).filter(scenario =>
    !scenario.requireAdmin || isAdmin
  );
}

/**
 * 检查 tab 在当前场景下是否可见
 * @param {string} tabKey - tab key
 * @param {string} scenarioKey - 场景 key
 * @returns {boolean}
 */
export function isTabVisibleInScenario(tabKey, scenarioKey) {
  const scenario = getScenario(scenarioKey);
  return scenario.visibleTabs.includes(tabKey);
}
