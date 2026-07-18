import {
  hasMeaningfulTransaction,
  isValidFundCode,
  normalizeTransaction
} from './holdingsLedgerBasics.js';

export const HOLDINGS_LEDGER_KEY = 'aiDcaFundHoldingsLedger';
export const LEGACY_TRADE_LEDGER_KEYS = Object.freeze([
  'aiDcaTradeLedger',
  'aiDcaTradeLedgerArchive'
]);

function parseStoredValue(value) {
  if (value == null) return null;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return null; }
}

function listFromStoredValue(value) {
  const parsed = parseStoredValue(value);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.transactions)) return parsed.transactions;
  if (Array.isArray(parsed?.entries)) return parsed.entries;
  return [];
}

function legacyType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'sell' || normalized === 's' ? 'SELL' : 'BUY';
}

function legacyId(raw, sourceKey, index) {
  const existing = String(raw?.id || '').trim();
  if (existing) return existing;
  const suffix = sourceKey === 'aiDcaTradeLedgerArchive' ? 'archive' : 'active';
  return `legacy-${suffix}-${index}`;
}

/** Convert the pre-holdings-ledger { symbol, side, ... } shape to a ledger transaction. */
export function normalizeLegacyTrade(raw, { sourceKey = 'aiDcaTradeLedger', index = 0 } = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const transaction = normalizeTransaction({
    ...raw,
    id: legacyId(raw, sourceKey, index),
    code: raw.code ?? raw.symbol ?? raw.fundCode ?? raw.fund_code,
    name: raw.name ?? raw.fundName,
    type: raw.type ?? legacyType(raw.side),
    date: raw.date ?? raw.tradeDate ?? raw.trade_date,
    price: raw.price ?? raw.unitPrice ?? raw.nav,
    shares: raw.shares ?? raw.quantity,
    amount: raw.amount ?? raw.totalAmount ?? raw.total_amount
  }, { idPrefix: 'legacy-trade' });

  // Invalid historical rows should not make the new ledger unusable. Keep valid
  // amount-only OTC buys as well; the current ledger can fill shares later.
  if (!isValidFundCode(transaction.code) || !hasMeaningfulTransaction(transaction)) return null;
  if (!(Number(transaction.shares) > 0) && !(transaction.type === 'BUY' && Number(transaction.amount) > 0)) return null;
  return transaction;
}

export function extractLegacyTradeTransactions(value, { sourceKey = 'aiDcaTradeLedger' } = {}) {
  return listFromStoredValue(value)
    .map((raw, index) => normalizeLegacyTrade(raw, { sourceKey, index }))
    .filter(Boolean);
}

function transactionCode(transaction) {
  return String(transaction?.code || transaction?.symbol || '').trim();
}

function isSyntheticAggregateTransaction(transaction) {
  const note = String(transaction?.note || '').trim();
  const id = String(transaction?.id || '').trim();
  return note.startsWith('从旧持仓汇总迁入') || id.startsWith('migrated-');
}

function mergeTransactionLists(existing = [], detailed = []) {
  const detailedCodes = new Set(detailed.map(transactionCode).filter(Boolean));
  const map = new Map();
  const withoutId = [];
  const add = (transaction, preferExisting = false) => {
    if (!transaction || typeof transaction !== 'object') return;
    const id = String(transaction.id || '').trim();
    if (!id) {
      withoutId.push(transaction);
      return;
    }
    if (!map.has(id) || !preferExisting) map.set(id, transaction);
  };

  // A previous release could have created one synthetic BUY from the aggregate
  // holdings row. If the detailed old ledger exists for the same fund, discard
  // only that synthetic row so it cannot inflate the user's real position.
  for (const transaction of Array.isArray(existing) ? existing : []) {
    if (isSyntheticAggregateTransaction(transaction) && detailedCodes.has(transactionCode(transaction))) continue;
    add(transaction, true);
  }
  for (const transaction of Array.isArray(detailed) ? detailed : []) add(transaction, false);

  const result = [...map.values(), ...withoutId];
  result.sort((left, right) => (
    String(left?.date || '').localeCompare(String(right?.date || ''))
      || String(left?.id || '').localeCompare(String(right?.id || ''))
  ));
  return result;
}

export function mergeLegacyTradeLedgerValue(existingValue, legacyValues = {}) {
  const existing = parseStoredValue(existingValue);
  const existingState = Array.isArray(existing)
    ? { transactions: existing }
    : (existing && typeof existing === 'object' ? existing : {});
  const detailed = LEGACY_TRADE_LEDGER_KEYS.flatMap((key) => (
    extractLegacyTradeTransactions(legacyValues?.[key], { sourceKey: key })
  ));
  if (!detailed.length) return null;
  return {
    ...existingState,
    source: 'ai-dca-trade-ledger',
    version: 1,
    transactions: mergeTransactionLists(existingState.transactions, detailed)
  };
}

/**
 * Normalize legacy transaction keys inside an old encrypted full snapshot.
 * The old keys are compatibility input only and are removed from the upgraded
 * envelope; the new encrypted holdings resource remains the single write path.
 */
export function upgradeLegacyTradeLedgerPayload(payload = {}) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const legacyValues = Object.fromEntries(LEGACY_TRADE_LEDGER_KEYS.map((key) => [key, source[key]]));
  const detailed = LEGACY_TRADE_LEDGER_KEYS.flatMap((key) => (
    extractLegacyTradeTransactions(legacyValues[key], { sourceKey: key })
  ));
  if (!detailed.length) return source;

  const merged = mergeLegacyTradeLedgerValue(source[HOLDINGS_LEDGER_KEY], legacyValues);
  const upgraded = { ...source };
  if (merged) upgraded[HOLDINGS_LEDGER_KEY] = JSON.stringify(merged);
  LEGACY_TRADE_LEDGER_KEYS.forEach((key) => { delete upgraded[key]; });
  return upgraded;
}

export function upgradeLegacyTradeLedgerEnvelope(envelope = {}) {
  if (!envelope || typeof envelope !== 'object') return envelope;
  const payload = upgradeLegacyTradeLedgerPayload(envelope.payload || {});
  if (payload === envelope.payload) return envelope;
  const keys = Object.keys(payload).sort();
  return {
    ...envelope,
    keys,
    keyCount: keys.length,
    payload
  };
}

/** Migrate old localStorage ledgers before any sync snapshot is collected. */
export function migrateLegacyTradeLedgerStorage(storage) {
  if (!storage || typeof storage.getItem !== 'function') return { changed: false, transactions: [] };
  const legacyValues = Object.fromEntries(LEGACY_TRADE_LEDGER_KEYS.map((key) => [key, storage.getItem(key)]));
  const detailed = LEGACY_TRADE_LEDGER_KEYS.flatMap((key) => (
    extractLegacyTradeTransactions(legacyValues[key], { sourceKey: key })
  ));
  if (!detailed.length) return { changed: false, transactions: [] };

  const merged = mergeLegacyTradeLedgerValue(storage.getItem(HOLDINGS_LEDGER_KEY), legacyValues);
  if (!merged) return { changed: false, transactions: detailed };
  const next = JSON.stringify(merged);
  const changed = storage.getItem(HOLDINGS_LEDGER_KEY) !== next;
  if (changed) storage.setItem(HOLDINGS_LEDGER_KEY, next);
  return { changed, transactions: merged.transactions };
}
