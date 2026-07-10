export const ACCOUNT_KEY = 'aiDcaAccountAllocationSettings';
export const LEGACY_ACCOUNT_ASSIGNMENTS_KEY = 'aiDcaAccountAssignments';

export const DEFAULT_ACCOUNT_ALLOCATION_SETTINGS = {
  source: 'react-account-allocation-settings',
  version: 1,
  cashAmount: 0,
  cashYieldMode: 'none',
  cashYieldCode: '',
  cashYieldRate: 0,
  cashYieldResolvedRate: null,
  cashYieldResolvedAt: '',
  cashYieldName: '',
  cashYieldLookupStatus: 'idle',
  targetInvestmentPct: 70,
  targetCashPct: 30,
  rebalanceThresholdPct: 5,
  notifyEnabled: true,
  updatedAt: ''
};

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return 0;
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function parseNumber(value, fallback = 0) {
  if (value === '' || value == null) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function normalizeAccountAllocationSettings(value = {}) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const targetInvestmentPct = round(clamp(parseNumber(input.targetInvestmentPct, DEFAULT_ACCOUNT_ALLOCATION_SETTINGS.targetInvestmentPct), 0, 100), 2);
  const targetCashPct = round(100 - targetInvestmentPct, 2);
  return {
    ...DEFAULT_ACCOUNT_ALLOCATION_SETTINGS,
    ...input,
    source: DEFAULT_ACCOUNT_ALLOCATION_SETTINGS.source,
    version: DEFAULT_ACCOUNT_ALLOCATION_SETTINGS.version,
    cashAmount: round(Math.max(parseNumber(input.cashAmount, DEFAULT_ACCOUNT_ALLOCATION_SETTINGS.cashAmount), 0), 2),
    cashYieldMode: ['none', 'code', 'manual'].includes(String(input.cashYieldMode || '').trim()) ? String(input.cashYieldMode).trim() : 'none',
    cashYieldCode: String(input.cashYieldCode || '').trim().replace(/[^0-9]/g, '').slice(0, 6),
    cashYieldRate: round(clamp(parseNumber(input.cashYieldRate, 0), -100, 100), 4),
    cashYieldResolvedRate: Number.isFinite(Number(input.cashYieldResolvedRate)) ? round(clamp(Number(input.cashYieldResolvedRate), -100, 100), 4) : null,
    cashYieldResolvedAt: typeof input.cashYieldResolvedAt === 'string' ? input.cashYieldResolvedAt : '',
    cashYieldName: String(input.cashYieldName || '').trim().slice(0, 120),
    cashYieldLookupStatus: ['idle', 'invalid', 'loading', 'ready', 'unavailable', 'error'].includes(String(input.cashYieldLookupStatus || '').trim()) ? String(input.cashYieldLookupStatus).trim() : 'idle',
    targetInvestmentPct,
    targetCashPct,
    rebalanceThresholdPct: round(clamp(parseNumber(input.rebalanceThresholdPct, DEFAULT_ACCOUNT_ALLOCATION_SETTINGS.rebalanceThresholdPct), 0, 100), 2),
    notifyEnabled: input.notifyEnabled !== false,
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : ''
  };
}

export function readAccountAllocationSettings() {
  if (typeof window === 'undefined') return normalizeAccountAllocationSettings();
  try {
    return normalizeAccountAllocationSettings(JSON.parse(window.localStorage.getItem(ACCOUNT_KEY) || 'null'));
  } catch (_error) {
    return normalizeAccountAllocationSettings();
  }
}

export function writeAccountAllocationSettings(settings = {}) {
  const next = normalizeAccountAllocationSettings({
    ...settings,
    updatedAt: settings.updatedAt || new Date().toISOString()
  });
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(ACCOUNT_KEY, JSON.stringify(next));
  }
  return next;
}

export function updateAccountAllocationSettings(updates = {}, current = readAccountAllocationSettings()) {
  return writeAccountAllocationSettings({ ...current, ...updates });
}

function getInvestmentValue(input) {
  if (Array.isArray(input)) {
    return input.reduce((sum, holding) => {
      if (holding && holding.hasCurrentPrice === false) return sum;
      return sum + Math.max(Number(holding?.marketValue) || 0, 0);
    }, 0);
  }
  if (input && typeof input === 'object') {
    return Math.max(Number(input.investmentValue ?? input.marketValue) || 0, 0);
  }
  return 0;
}

export function getAccountAllocation(input = [], settings = readAccountAllocationSettings()) {
  const normalizedSettings = normalizeAccountAllocationSettings(settings);
  const investmentValue = round(getInvestmentValue(input), 2);
  const cashValue = round(normalizedSettings.cashAmount, 2);
  const cashYieldRate = normalizedSettings.cashYieldMode === 'manual' ? normalizedSettings.cashYieldRate : normalizedSettings.cashYieldMode === 'code' ? (normalizedSettings.cashYieldResolvedRate ?? 0) : 0;
  const cashAnnualIncome = round(cashValue * cashYieldRate / 100, 2);
  const totalAccountValue = round(investmentValue + cashValue, 2);
  const investmentPct = totalAccountValue > 0 ? round((investmentValue / totalAccountValue) * 100, 2) : 0;
  const cashPct = totalAccountValue > 0 ? round((cashValue / totalAccountValue) * 100, 2) : 0;
  const investmentDeviationPct = round(investmentPct - normalizedSettings.targetInvestmentPct, 2);
  const cashDeviationPct = round(cashPct - normalizedSettings.targetCashPct, 2);
  const maxDeviationPct = Math.max(Math.abs(investmentDeviationPct), Math.abs(cashDeviationPct));
  const rebalanceNeeded = maxDeviationPct >= normalizedSettings.rebalanceThresholdPct && totalAccountValue > 0;
  const direction = !rebalanceNeeded
    ? 'balanced'
    : investmentDeviationPct > 0
      ? 'investment_high'
      : 'cash_high';

  return {
    version: 1,
    settings: normalizedSettings,
    investmentValue,
    cashValue,
    cashYieldMode: normalizedSettings.cashYieldMode,
    cashYieldCode: normalizedSettings.cashYieldCode,
    cashYieldRate,
    cashAnnualIncome,
    totalAccountValue,
    investmentPct,
    cashPct,
    targetInvestmentPct: normalizedSettings.targetInvestmentPct,
    targetCashPct: normalizedSettings.targetCashPct,
    rebalanceThresholdPct: normalizedSettings.rebalanceThresholdPct,
    notifyEnabled: normalizedSettings.notifyEnabled,
    investmentDeviationPct,
    cashDeviationPct,
    maxDeviationPct: round(maxDeviationPct, 2),
    rebalanceNeeded,
    direction,
    statusLabel: direction === 'investment_high' ? '投资偏高' : direction === 'cash_high' ? '现金偏高' : '比例正常',
    items: [
      {
        key: 'investment',
        label: '投资',
        marketValue: investmentValue,
        ratio: investmentPct,
        targetRatio: normalizedSettings.targetInvestmentPct,
        deviationPct: investmentDeviationPct,
        color: 'rose'
      },
      {
        key: 'cash',
        label: '现金',
        marketValue: cashValue,
        ratio: cashPct,
        targetRatio: normalizedSettings.targetCashPct,
        deviationPct: cashDeviationPct,
        color: 'emerald'
      }
    ]
  };
}

export function buildAccountAllocationDigest(input = [], settings = readAccountAllocationSettings()) {
  const allocation = getAccountAllocation(input, settings);
  if (!(allocation.totalAccountValue > 0)) return null;
  return {
    version: 2,
    generatedAt: new Date().toISOString(),
    investmentValue: allocation.investmentValue,
    cashValue: allocation.cashValue,
    cashYieldMode: allocation.cashYieldMode,
    cashYieldCode: allocation.cashYieldCode,
    cashYieldRate: allocation.cashYieldRate,
    cashAnnualIncome: allocation.cashAnnualIncome,
    totalAccountValue: allocation.totalAccountValue,
    investmentPct: allocation.investmentPct,
    cashPct: allocation.cashPct,
    targetInvestmentPct: allocation.targetInvestmentPct,
    targetCashPct: allocation.targetCashPct,
    rebalanceThresholdPct: allocation.rebalanceThresholdPct,
    investmentDeviationPct: allocation.investmentDeviationPct,
    cashDeviationPct: allocation.cashDeviationPct,
    maxDeviationPct: allocation.maxDeviationPct,
    rebalanceNeeded: allocation.rebalanceNeeded,
    direction: allocation.direction,
    notifyEnabled: allocation.notifyEnabled
  };
}
