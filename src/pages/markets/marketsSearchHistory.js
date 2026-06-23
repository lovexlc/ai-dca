// 行情中心搜索历史和热门推荐管理

const SEARCH_HISTORY_KEY = 'markets:searchHistory';
const MAX_HISTORY_ITEMS = 10;

// 热门基金列表（基于使用数据）
const POPULAR_SYMBOLS = [
  { symbol: '513050', name: '中概互联', market: 'cn' },
  { symbol: '159941', name: '纳指ETF', market: 'cn' },
  { symbol: '513100', name: '纳指科技', market: 'cn' },
  { symbol: '510300', name: '沪深300ETF', market: 'cn' },
  { symbol: '510500', name: '中证500ETF', market: 'cn' },
  { symbol: '588000', name: '科创50ETF', market: 'cn' },
  { symbol: '512880', name: '证券ETF', market: 'cn' }
];

/**
 * 读取搜索历史
 * @returns {Array<{symbol: string, name: string, market: string, timestamp: number}>}
 */
export function getSearchHistory() {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(SEARCH_HISTORY_KEY);
    if (!raw) return [];
    const history = JSON.parse(raw);
    return Array.isArray(history) ? history : [];
  } catch (_error) {
    return [];
  }
}

/**
 * 添加到搜索历史（去重并置顶）
 * @param {string} symbol - 基金代码
 * @param {string} name - 基金名称
 * @param {string} market - 市场（cn/us）
 */
export function addToSearchHistory(symbol, name, market) {
  if (typeof window === 'undefined' || !symbol) return;
  try {
    const history = getSearchHistory();
    // 去重：移除已存在的相同 symbol
    const filtered = history.filter(item => item.symbol !== symbol);
    // 添加到开头
    const updated = [
      { symbol, name: name || '', market: market || 'cn', timestamp: Date.now() },
      ...filtered
    ].slice(0, MAX_HISTORY_ITEMS);
    window.localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(updated));
  } catch (_error) {
    // Ignore storage errors
  }
}

/**
 * 清空搜索历史
 */
export function clearSearchHistory() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(SEARCH_HISTORY_KEY);
  } catch (_error) {
    // Ignore
  }
}

/**
 * 获取热门基金列表
 * @param {string} market - 市场（cn/us/all）
 * @returns {Array<{symbol: string, name: string, market: string}>}
 */
export function getPopularSymbols(market = 'all') {
  if (market === 'all') return POPULAR_SYMBOLS;
  return POPULAR_SYMBOLS.filter(item => item.market === market);
}

/**
 * 合并搜索建议：搜索历史 + 热门基金（去重）
 * @param {string} market - 当前市场
 * @returns {Array}
 */
export function getSearchSuggestions(market = 'cn') {
  const history = getSearchHistory().filter(item =>
    market === 'all' || item.market === market
  );
  const popular = getPopularSymbols(market);

  // 去重：历史记录优先
  const seen = new Set(history.map(item => item.symbol));
  const uniquePopular = popular.filter(item => !seen.has(item.symbol));

  return [
    ...history.slice(0, 5), // 最近 5 条历史
    ...uniquePopular.slice(0, 5) // 最多 5 条热门
  ];
}
