export const PREMIUM_SURVEY_INTEREST_OPTIONS = [
  { key: 'ad_free', label: '少广告 / 无广告' },
  { key: 'advanced_alerts', label: '更强提醒策略' },
  { key: 'ai_research', label: 'AI 复盘分析' },
  { key: 'data_export', label: '导出与备份增强' },
  { key: 'market_tools', label: '行情和切换工具增强' }
];

export const PREMIUM_SURVEY_COMPLETED_OPTIONS = [
  { key: 'advanced_fund_strategy', label: '更强基金策略功能' }
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

export const PREMIUM_SURVEY_COMPLETED_LABELS = Object.fromEntries(
  PREMIUM_SURVEY_COMPLETED_OPTIONS.map((option) => [option.key, option.label])
);
