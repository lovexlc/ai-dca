export const DEMO_DATA_MARKER_KEY = 'aiDcaDemoDataMeta';

export const LEDGER_KEY = 'aiDcaFundHoldingsLedger';
export const LEGACY_LEDGER_KEY = 'aiDcaFundHoldingsState';
export const PLAN_KEY = 'aiDcaPlanState';
export const PLAN_STORE_KEY = 'aiDcaPlanStore';
export const DCA_KEY = 'aiDcaDcaState';
export const ACCOUNT_KEY = 'aiDcaAccountAssignments';
export const WATCHLIST_KEY = 'markets:watchlist:v1';
export const WORKSPACE_PREFS_KEY = 'aiDcaWorkspacePrefs';

export const DEMO_KEYS = [
  LEDGER_KEY,
  PLAN_KEY,
  PLAN_STORE_KEY,
  DCA_KEY,
  ACCOUNT_KEY,
  WATCHLIST_KEY,
  WORKSPACE_PREFS_KEY
];

export function readDemoDataMeta() {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(DEMO_DATA_MARKER_KEY) || 'null');
    return parsed && parsed.source === 'ai-dca-demo-data' ? parsed : null;
  } catch {
    return null;
  }
}

export function hasDemoData() {
  return Boolean(readDemoDataMeta());
}

export function clearDemoData() {
  if (typeof window === 'undefined' || !window.localStorage) return false;
  const meta = readDemoDataMeta();
  if (!meta) return false;
  for (const key of Array.isArray(meta.keys) ? meta.keys : DEMO_KEYS) {
    window.localStorage.removeItem(key);
  }
  window.localStorage.removeItem(DEMO_DATA_MARKER_KEY);
  return true;
}
