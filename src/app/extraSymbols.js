// 美股标的快选清单：QQQ/VOO 指数 + Mag7 个股 + 台积电 ADR。
// 用于在「新建加仓计划」和「定投计划」页提供一键选择，不依赖纳指基金清单。
// 这些标的不在 data/nasdaq_latest.json 的行情清单里，因此选中后
// 当前价/MA 等字段不会被自动填充，需要用户手动填入触发价与风控价。

export const EXTRA_SYMBOL_GROUPS = [
  {
    key: 'index',
    label: '宽基指数',
    note: '只买不做 T',
    symbols: [
      { code: 'QQQ', name: '纳指 100 ETF', currency: 'USD' },
      { code: 'VOO', name: '标普 500 ETF', currency: 'USD' },
      { code: 'SPY', name: '标普 500 ETF (SPDR)', currency: 'USD' },
      { code: 'DIA', name: '道指 30 ETF', currency: 'USD' },
      { code: 'IWM', name: '罗素 2000 ETF', currency: 'USD' }
    ]
  },
  {
    key: 'mag7',
    label: 'Mag 7',
    note: '可做 T、可负成本',
    symbols: [
      { code: 'AAPL', name: 'Apple', currency: 'USD' },
      { code: 'MSFT', name: 'Microsoft', currency: 'USD' },
      { code: 'GOOGL', name: 'Alphabet', currency: 'USD' },
      { code: 'AMZN', name: 'Amazon', currency: 'USD' },
      { code: 'META', name: 'Meta', currency: 'USD' },
      { code: 'TSLA', name: 'Tesla', currency: 'USD' },
      { code: 'NVDA', name: 'NVIDIA', currency: 'USD' }
    ]
  },
  {
    key: 'tsm',
    label: '台积电',
    note: 'ADR 可做 T',
    symbols: [
      { code: 'TSM', name: '台积电 ADR', currency: 'USD' }
    ]
  },
  {
    key: 'hot',
    label: '热门个股',
    note: '可做 T、可负成本',
    symbols: [
      { code: 'AVGO', name: 'Broadcom', currency: 'USD' },
      { code: 'AMD', name: 'AMD', currency: 'USD' },
      { code: 'NFLX', name: 'Netflix', currency: 'USD' },
      { code: 'ORCL', name: 'Oracle', currency: 'USD' },
      { code: 'PLTR', name: 'Palantir', currency: 'USD' },
      { code: 'COIN', name: 'Coinbase', currency: 'USD' }
    ]
  }
];

export const EXTRA_SYMBOLS = EXTRA_SYMBOL_GROUPS.flatMap((group) =>
  group.symbols.map((symbol) => ({ ...symbol, group: group.key }))
);

export const EXTRA_SYMBOL_CODES = new Set(EXTRA_SYMBOLS.map((s) => s.code));

export function isExtraSymbol(code) {
  return EXTRA_SYMBOL_CODES.has(String(code || '').trim());
}

export function findExtraSymbol(code) {
  const key = String(code || '').trim();
  return EXTRA_SYMBOLS.find((s) => s.code === key) || null;
}
