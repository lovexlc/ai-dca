/**
 * 场景配置
 * 定义不同使用场景下的可见功能模块和默认首页
 */

export const SCENARIOS = {
  stock: {
    key: 'stock',
    label: '持仓交易',
    icon: 'TrendingUp',
    description: '持仓、交易计划与行情',
    defaultHome: 'holdings',
    visibleTabs: ['holdings', 'tradePlans', 'strategy', 'fundSwitch', 'markets', 'premium', 'notify'],
    requireAdmin: false
  },
  quant: {
    key: 'quant',
    label: '量化研究',
    icon: 'Bot',
    description: 'Python 溢价差执行器',
    defaultHome: 'quant',
    visibleTabs: ['quant'],
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
