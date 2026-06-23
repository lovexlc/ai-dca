// 市场页面 URL 同步工具：确保基金详情页 URL 包含 symbol 参数，支持分享和刷新。

/**
 * 更新 URL 中的 symbol 参数
 * @param {string} symbol - 基金代码
 */
export function updateSymbolInUrl(symbol) {
  if (typeof window === 'undefined' || !symbol) return;
  const url = new URL(window.location.href);
  url.searchParams.set('symbol', symbol);
  window.history.replaceState({ tab: 'markets', symbol }, '', url.href);
}

/**
 * 清除 URL 中的 symbol 参数
 */
export function clearSymbolFromUrl() {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.searchParams.delete('symbol');
  window.history.replaceState({ tab: 'markets' }, '', url.href);
}

/**
 * 更新 URL 中的对比基金列表
 * @param {string[]} symbols - 对比基金代码数组
 */
export function updateCompareInUrl(symbols) {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (Array.isArray(symbols) && symbols.length > 0) {
    url.searchParams.set('compare', symbols.join(','));
  } else {
    url.searchParams.delete('compare');
  }
  window.history.replaceState({ ...window.history.state, compare: symbols }, '', url.href);
}

/**
 * 从 URL 读取对比基金列表
 * @returns {string[]} 对比基金代码数组
 */
export function getCompareFromUrl() {
  if (typeof window === 'undefined') return [];
  const params = new URLSearchParams(window.location.search);
  const compare = params.get('compare');
  if (!compare) return [];
  return compare.split(',').map(s => s.trim()).filter(Boolean).slice(0, 3);
}

/**
 * 更新 URL 中的图表配置
 * @param {Object} config - 图表配置对象
 * @param {string} config.chartType - 图表类型
 * @param {Set<string>} config.indicators - 指标集合
 * @param {string} config.cnFundParam - 中国基金参数
 */
export function updateChartConfigInUrl({ chartType, indicators, cnFundParam }) {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);

  // 图表类型（默认 area 不写入 URL）
  if (chartType && chartType !== 'area') {
    url.searchParams.set('chartType', chartType);
  } else {
    url.searchParams.delete('chartType');
  }

  // 指标列表
  if (indicators && indicators.size > 0) {
    url.searchParams.set('indicators', Array.from(indicators).join(','));
  } else {
    url.searchParams.delete('indicators');
  }

  // 中国基金参数（默认 price 不写入 URL）
  if (cnFundParam && cnFundParam !== 'price') {
    url.searchParams.set('cnFundParam', cnFundParam);
  } else {
    url.searchParams.delete('cnFundParam');
  }

  window.history.replaceState({ ...window.history.state, chartType, indicators, cnFundParam }, '', url.href);
}

/**
 * 从 URL 读取图表配置
 * @returns {Object} 图表配置对象
 */
export function getChartConfigFromUrl() {
  if (typeof window === 'undefined') {
    return { chartType: 'area', indicators: new Set(), cnFundParam: 'price' };
  }

  const params = new URLSearchParams(window.location.search);

  // 图表类型
  const chartType = params.get('chartType') || 'area';
  const validChartTypes = ['area', 'line', 'candlestick'];
  const normalizedChartType = validChartTypes.includes(chartType) ? chartType : 'area';

  // 指标列表
  const indicatorsParam = params.get('indicators');
  const indicators = new Set();
  if (indicatorsParam) {
    indicatorsParam.split(',').forEach(ind => {
      const trimmed = ind.trim();
      if (trimmed) indicators.add(trimmed);
    });
  }

  // 中国基金参数
  const cnFundParam = params.get('cnFundParam') || 'price';
  const validCnFundParams = ['price', 'nav', 'premium'];
  const normalizedCnFundParam = validCnFundParams.includes(cnFundParam) ? cnFundParam : 'price';

  return {
    chartType: normalizedChartType,
    indicators,
    cnFundParam: normalizedCnFundParam
  };
}
