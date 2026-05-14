// 指数与默认涨跌榜样本的元数据。前端卡片渲染顺序也由这里决定。

export const US_INDICES = [
  { key: 'dji', name: '道琼斯工业平均指数', symbol: '^DJI' },
  { key: 'spx', name: '标普 500 指数', symbol: '^GSPC' },
  { key: 'ixic', name: '纳斯达克综合指数', symbol: '^IXIC' },
  { key: 'vix', name: 'VIX 波动率', symbol: '^VIX' },
  { key: 'ndx', name: '纳斯达克 100 指数', symbol: '^NDX' },
  { key: 'rut', name: '罗素 2000 指数', symbol: '^RUT' }
];

// A 股主要指数。东方财富 secid 前缀 1=沪市指数 0=深市指数。
export const CN_INDICES = [
  { key: 'sh000001', name: '上证指数', symbol: 'sh000001', em: '1.000001' },
  { key: 'sz399001', name: '深证成指', symbol: 'sz399001', em: '0.399001' },
  { key: 'sz399006', name: '创业板指', symbol: 'sz399006', em: '0.399006' },
  { key: 'sh000300', name: '沪深 300', symbol: 'sh000300', em: '1.000300' },
  { key: 'sh000016', name: '上证 50', symbol: 'sh000016', em: '1.000016' },
  { key: 'sh000688', name: '科创 50', symbol: 'sh000688', em: '1.000688' }
];

// S&P 1500 行业指数（Google Finance "Equity sectors" 同款，11 个行业）。
// 这些是指数不是 ETF，Yahoo Finance 接受 ^SP500-XX 格式。
// shortCode 是 Google Finance 使用的别名（SIXE/SIXB/SIXI 等），用于前端展示。
export const US_SECTORS = [
  { key: 'sixe', name: '能源', symbol: '^SP500-10', shortCode: 'SIXE' },
  { key: 'sixb', name: '材料', symbol: '^SP500-15', shortCode: 'SIXB' },
  { key: 'sixi', name: '工业', symbol: '^SP500-20', shortCode: 'SIXI' },
  { key: 'sixy', name: '可选消费', symbol: '^SP500-25', shortCode: 'SIXY' },
  { key: 'sixr', name: '必需消费', symbol: '^SP500-30', shortCode: 'SIXR' },
  { key: 'sixv', name: '医疗保健', symbol: '^SP500-35', shortCode: 'SIXV' },
  { key: 'sixm', name: '金融', symbol: '^SP500-40', shortCode: 'SIXM' },
  { key: 'sixt', name: '科技', symbol: '^SP500-45', shortCode: 'SIXT' },
  { key: 'sixc', name: '通讯', symbol: '^SP500-50', shortCode: 'SIXC' },
  { key: 'sixu', name: '公用事业', symbol: '^SP500-55', shortCode: 'SIXU' },
  { key: 'sixre', name: '房地产', symbol: '^SP500-60', shortCode: 'SIXRE' }
];

// 默认热门美股池，用于 Phase 1 涨跌榜（之后会按 Finnhub /stock/symbol 全市场动态算）。
export const US_TOP_TICKERS = [
  'AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META', 'TSLA', 'AVGO', 'NFLX', 'AMD',
  'JPM', 'V', 'WMT', 'XOM', 'UNH', 'JNJ', 'PG', 'MA', 'HD', 'COST',
  'ORCL', 'CRM', 'ABNB', 'PLTR', 'COIN', 'UBER', 'BABA', 'PDD', 'TSM', 'ASML'
];

// 默认热门 A 股池。代码格式 sh600000 / sz000001 / sz300xxx。
export const CN_TOP_TICKERS = [
  'sh600519', 'sh601318', 'sh601398', 'sh600036', 'sh600900', 'sh601899', 'sh600276', 'sh600030',
  'sz000333', 'sz000858', 'sz002594', 'sz300750', 'sz300059', 'sz000651', 'sz002415', 'sz000725',
  'sh688981', 'sh603259', 'sh688041', 'sh688256'
];

// 简单的 ticker 归属判断。
export function classifySymbol(input) {
  const s = String(input || '').trim();
  if (!s) return { market: '', code: '' };
  // A 股 sh/sz/bj 前缀
  if (/^(sh|sz|bj)\d{6}$/i.test(s)) {
    return { market: 'cn', code: s.toLowerCase() };
  }
  // A 股 6 位裸代码 → 自动加前缀
  if (/^\d{6}$/.test(s)) {
    const prefix = s.startsWith('6') ? 'sh' : s.startsWith('4') || s.startsWith('8') ? 'bj' : 'sz';
    return { market: 'cn', code: `${prefix}${s}` };
  }
  // 指数（^DJI 等）或裸字母代码 → 美股
  return { market: 'us', code: s.toUpperCase() };
}

// 东财 secid 推导：sh -> 1.xxxxxx, sz/bj -> 0.xxxxxx。
export function toEastmoneySecId(code) {
  const lower = String(code || '').toLowerCase();
  if (lower.startsWith('sh')) return `1.${lower.slice(2)}`;
  if (lower.startsWith('sz') || lower.startsWith('bj')) return `0.${lower.slice(2)}`;
  return '';
}
