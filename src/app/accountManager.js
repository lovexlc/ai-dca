import { getAssetType } from './assetType.js';

export const ACCOUNT_KEY = 'aiDcaAccountAssignments';

export const ACCOUNT_TYPES = {
  aggressive: {
    label: '进取型',
    description: 'Mag7 + TSMC 等高成长个股',
    allowedTypes: ['stock'],
    color: 'red'
  },
  stable: {
    label: '稳健型',
    description: 'QQQ/SPY/VOO 宽基指数，占比 68%+',
    allowedTypes: ['index', 'fund'],
    color: 'blue'
  },
  defensive: {
    label: '防守型',
    description: '国债、BRK、KO、JNJ、SCHD 等',
    allowedTypes: ['stock', 'fund'],
    color: 'green'
  }
};

export function getDefaultAccountType(symbol) {
  const assetType = getAssetType(symbol);
  if (assetType === 'index' || assetType === 'fund') return 'stable';
  return 'aggressive';
}

export function readAccountAssignments() {
  if (typeof window === 'undefined') return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(ACCOUNT_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_error) {
    return {};
  }
}

export function getAssignedAccount(symbol, accounts = readAccountAssignments()) {
  const code = String(symbol || '').trim().toUpperCase();
  const assigned = code ? accounts[code] : '';
  return ACCOUNT_TYPES[assigned] ? assigned : getDefaultAccountType(code);
}

export function assignAccount(symbol, accountType, accounts = readAccountAssignments()) {
  const code = String(symbol || '').trim().toUpperCase();
  if (!code || !ACCOUNT_TYPES[accountType]) return accounts;
  const next = { ...accounts, [code]: accountType };
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(ACCOUNT_KEY, JSON.stringify(next));
  }
  return next;
}

export function getAccountAllocation(holdings = [], accounts = readAccountAssignments()) {
  const base = Object.fromEntries(Object.entries(ACCOUNT_TYPES).map(([key, config]) => [
    key,
    { key, ...config, marketValue: 0, ratio: 0, holdings: [] }
  ]));

  const totalMarketValue = holdings.reduce((sum, holding) => {
    const value = Number(holding.marketValue) || 0;
    if (!(value > 0)) return sum;
    const accountType = getAssignedAccount(holding.code || holding.symbol, accounts);
    base[accountType].marketValue += value;
    base[accountType].holdings.push(holding);
    return sum + value;
  }, 0);

  return Object.values(base).map((item) => ({
    ...item,
    ratio: totalMarketValue > 0 ? (item.marketValue / totalMarketValue) * 100 : 0
  }));
}
