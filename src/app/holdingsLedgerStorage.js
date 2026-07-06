const LEDGER_STORAGE_KEY = 'aiDcaFundHoldingsLedger';
const LEGACY_STORAGE_KEY = 'aiDcaFundHoldingsState';

function createDefaultLedgerState() {
  return {
    transactions: [],
    snapshotsByCode: {},
    lastNavMeta: { status: 'idle', updatedAt: '', successCount: 0, failureCount: 0, errors: [] },
    migratedFromLegacy: false,
    legacyMigrationAt: '',
    switchChains: []
  };
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function safeParseStoredJson(key) {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isPlainObject(parsed) ? parsed : null;
  } catch (_error) {
    return null;
  }
}

function normalizeFundCode(value = '') {
  const digits = String(value ?? '').trim().replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 6) return digits;
  if (digits.length < 6) return digits.padStart(6, '0');
  return digits.slice(-6);
}

function detectFundKind(code = '') {
  const normalized = normalizeFundCode(code);
  return ['15', '50', '51', '52', '53', '54', '56', '58'].includes(normalized.slice(0, 2))
    ? 'exchange'
    : 'otc';
}

function readPrimaryLedgerState() {
  const parsed = safeParseStoredJson(LEDGER_STORAGE_KEY);
  if (!parsed) return null;
  return {
    ...createDefaultLedgerState(),
    transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
    snapshotsByCode: isPlainObject(parsed.snapshotsByCode) ? parsed.snapshotsByCode : {},
    lastNavMeta: isPlainObject(parsed.lastNavMeta) ? parsed.lastNavMeta : createDefaultLedgerState().lastNavMeta,
    migratedFromLegacy: Boolean(parsed.migratedFromLegacy),
    legacyMigrationAt: String(parsed.legacyMigrationAt || '').trim(),
    switchChains: Array.isArray(parsed.switchChains) ? parsed.switchChains : []
  };
}

function readLegacyLedgerState() {
  const parsed = safeParseStoredJson(LEGACY_STORAGE_KEY);
  const rows = Array.isArray(parsed?.rows) ? parsed.rows : [];
  if (!rows.length) return null;
  return {
    ...createDefaultLedgerState(),
    transactions: rows
      .map((row, index) => {
        const code = normalizeFundCode(row?.code || '');
        const price = Number(row?.avgCost);
        const shares = Number(row?.shares);
        if (!/^\d{6}$/.test(code) || !(price > 0) || !(shares > 0)) return null;
        return {
          id: `markets-legacy-${index}`,
          code,
          name: String(row?.name || '').trim(),
          kind: detectFundKind(code),
          type: 'BUY',
          date: '',
          price,
          shares,
          amount: Number.isFinite(price * shares) ? price * shares : 0,
          costPrice: 0,
          switchPairId: '',
          note: '',
          tags: []
        };
      })
      .filter(Boolean),
    snapshotsByCode: isPlainObject(parsed.snapshotsByCode) ? parsed.snapshotsByCode : {},
    migratedFromLegacy: true
  };
}

export function readLedgerState() {
  return readPrimaryLedgerState() || readLegacyLedgerState() || createDefaultLedgerState();
}
