export const PREMIUM_SURVEY_INTEREST_OPTIONS = [
  { key: 'fund_screener', label: '基金筛选 / 条件选基' },
  { key: 'fund_compare', label: '基金对比 / 横向比较' },
  { key: 'nav_history', label: '历史净值 / 收益走势' },
  { key: 'ranking_rating', label: '基金排行 / 评级' },
  { key: 'holdings_breakdown', label: '持仓拆解 / 风格箱' },
  { key: 'dividend_fee', label: '分红 / 费率 / 申赎状态' },
  { key: 'watchlist_alerts', label: '自选 / 关注 / 提醒' },
  { key: 'dca_tools', label: '定投 / 收益计算器' },
  { key: 'manager_company', label: '基金经理 / 基金公司' },
  { key: 'news_notice', label: '公告 / 研报 / 资讯' },
  { key: 'portfolio_ledger', label: '组合 / 账本 / 资产汇总' }
];

export const PREMIUM_SURVEY_PRICE_OPTIONS = [
  { key: 'free_ads', label: '免费 + 广告' },
  { key: 'monthly_low', label: '低价月付' },
  { key: 'yearly', label: '年付' },
  { key: 'one_time', label: '一次性买断' }
];

export const PREMIUM_SURVEY_INTEREST_LABELS = Object.fromEntries(
  PREMIUM_SURVEY_INTEREST_OPTIONS.map((option) => [option.key, option.label])
);

export const PREMIUM_SURVEY_PRICE_LABELS = Object.fromEntries(
  PREMIUM_SURVEY_PRICE_OPTIONS.map((option) => [option.key, option.label])
);
