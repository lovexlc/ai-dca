/**
 * Holdings ledger persistence + NAV / OCR wrappers.
 * - Primary storage key: aiDcaFundHoldingsLedger (version 2).
 * - Legacy aggregate storage (aiDcaFundHoldingsState, version 1) auto-migrated
 *   on first read; each aggregate row becomes one BUY transaction (date blank).
 * - NAV fetching and OCR reuse the existing /api/holdings/nav and /api/holdings/ocr
 *   endpoints via helpers in ./holdings.js (keeps the worker contract unchanged).
 */

import { recognizeHoldingsFile, requestHoldingsNav } from './holdings.js';
import {
  buildTransactionId,
  detectFundKind,
  getLedgerCodeList,
  getTransactionErrors,
  hasMeaningfulTransaction,
  isValidFundCode,
  normalizeFundCode,
  normalizeFundKind,
  normalizeFundName,
  normalizeTransaction,
  round,
  sanitizeTransactions,
  normalizeSwitchChains
} from './holdingsLedgerCore.js';

const LEDGER_STORAGE_KEY = 'aiDcaFundHoldingsLedger';
const LEDGER_STORAGE_SOURCE = 'react-fund-holdings-ledger';
const LEDGER_STORAGE_VERSION = 2;
const LEGACY_STORAGE_KEY = 'aiDcaFundHoldingsState';

function normalizeSnapshotEntry(entry = {}) {
  const code = normalizeFundCode(entry?.code || '');
  if (!isValidFundCode(code)) {
    return null;
  }
  return {
    code,
    name: normalizeFundName(entry?.name || ''),
    latestNav: round(Number(entry?.latestNav) || 0, 4),
    latestNavDate: String(entry?.latestNavDate || '').trim(),
    previousNav: round(Number(entry?.previousNav) || 0, 4),
    previousNavDate: String(entry?.previousNavDate || '').trim(),
    updatedAt: String(entry?.updatedAt || '').trim(),
    cacheHit: entry?.cacheHit === true,
    cacheSource: String(entry?.cacheSource || '').trim(),
    cacheKey: String(entry?.cacheKey || '').trim(),
    error: String(entry?.error || '').trim()
  };
}

function normalizeLastNavMeta(meta = {}) {
  return {
    status: String(meta?.status || 'idle').trim() || 'idle',
    updatedAt: String(meta?.updatedAt || '').trim(),
    successCount: Math.max(Number(meta?.successCount) || 0, 0),
    failureCount: Math.max(Number(meta?.failureCount) || 0, 0),
    errors: Array.isArray(meta?.errors)
      ? meta.errors.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 8)
      : []
  };
}

export function createDefaultLedgerState() {
  return {
    transactions: [],
    snapshotsByCode: {},
    lastNavMeta: normalizeLastNavMeta(),
    migratedFromLegacy: false,
    legacyMigrationAt: '',
    switchChains: []
  };
}

export function normalizeLedgerState(rawState = {}) {
  const rawTxs = Array.isArray(rawState?.transactions) ? rawState.transactions : [];
  const transactions = sanitizeTransactions(rawTxs, { filterInvalid: false })
    .filter((tx) => hasMeaningfulTransaction(tx));

  const snapshotsByCode = {};
  const rawSnapshots = rawState?.snapshotsByCode;
  if (rawSnapshots && typeof rawSnapshots === 'object') {
    for (const [code, entry] of Object.entries(rawSnapshots)) {
      const normalized = normalizeSnapshotEntry({ ...entry, code });
      if (normalized) {
        snapshotsByCode[normalized.code] = normalized;
      }
    }
  }

  return {
    transactions,
    snapshotsByCode,
    lastNavMeta: normalizeLastNavMeta(rawState?.lastNavMeta),
    migratedFromLegacy: Boolean(rawState?.migratedFromLegacy),
    legacyMigrationAt: String(rawState?.legacyMigrationAt || '').trim(),
    switchChains: normalizeSwitchChains(rawState?.switchChains)
  };
}

/** Convert a legacy v1 aggregate state (code/avgCost/shares rows) into ledger transactions. */
export function migrateLegacyAggregateState(legacyState = {}) {
  const rows = Array.isArray(legacyState?.rows) ? legacyState.rows : [];
  const transactions = [];

  rows.forEach((row, index) => {
    const code = normalizeFundCode(row?.code || '');
    if (!isValidFundCode(code)) return;
    const price = Number(row?.avgCost);
    const shares = Number(row?.shares);
    if (!(price > 0) || !(shares > 0)) return;
    transactions.push({
      id: buildTransactionId(`migrated-${index}`),
      code,
      name: normalizeFundName(row?.name || ''),
      kind: detectFundKind(code),
      type: 'BUY',
      date: '',
      price: round(price, 4),
      shares: round(shares, 4),
      note: '从旧持仓汇总迁入，请补录交易日期'
    });
  });

  const snapshotsByCode = {};
  const legacySnapshots = legacyState?.snapshotsByCode;
  if (legacySnapshots && typeof legacySnapshots === 'object') {
    for (const [code, entry] of Object.entries(legacySnapshots)) {
      const normalized = normalizeSnapshotEntry({ ...entry, code });
      if (normalized) {
        snapshotsByCode[normalized.code] = normalized;
      }
    }
  }

  return {
    transactions,
    snapshotsByCode,
    lastNavMeta: normalizeLastNavMeta(legacyState?.lastNavMeta),
    migratedFromLegacy: true,
    legacyMigrationAt: new Date().toISOString()
  };
}

function readLegacyState() {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (!Array.isArray(parsed.rows) || !parsed.rows.length) return null;
    return parsed;
  } catch (_error) {
    return null;
  }
}

export function readLedgerState() {
  if (typeof window === 'undefined' || !window.localStorage) {
    return createDefaultLedgerState();
  }

  try {
    const raw = window.localStorage.getItem(LEDGER_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return normalizeLedgerState(parsed);
    }
  } catch (_error) {
    // fall through to legacy migration
  }

  const legacy = readLegacyState();
  if (legacy) {
    const migrated = migrateLegacyAggregateState(legacy);
    // Persist the migrated copy so next load doesn't re-migrate.
    try {
      persistLedgerState(migrated);
    } catch (_error) {
      // ignore persistence errors on initial migration
    }
    return normalizeLedgerState(migrated);
  }

  return createDefaultLedgerState();
}

export function persistLedgerState(state = {}) {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }
  const normalized = normalizeLedgerState(state);
  const codeSet = new Set(getLedgerCodeList(normalized.transactions));
  // Drop orphan snapshots that are no longer referenced by any transaction.
  const snapshotsByCode = Object.fromEntries(
    Object.entries(normalized.snapshotsByCode || {}).filter(([code]) => codeSet.has(code))
  );

  const payload = {
    source: LEDGER_STORAGE_SOURCE,
    version: LEDGER_STORAGE_VERSION,
    transactions: normalized.transactions,
    snapshotsByCode,
    lastNavMeta: normalized.lastNavMeta,
    migratedFromLegacy: normalized.migratedFromLegacy,
    legacyMigrationAt: normalized.legacyMigrationAt,
    switchChains: normalized.switchChains
  };

  window.localStorage.setItem(LEDGER_STORAGE_KEY, JSON.stringify(payload));
}

/** Thin wrapper around /api/holdings/nav returning exactly the shape used by the page. */
export async function requestLedgerNav(codes = []) {
  return requestHoldingsNav(codes);
}

/**
 * OCR a holdings screenshot and convert the aggregate rows it returns into
 * draft BUY transactions (one per row, date left blank for user to fill in).
 */
export async function recognizeLedgerFile(file, onProgress) {
  const result = await recognizeHoldingsFile(file, onProgress);
  const draftTransactions = (Array.isArray(result.rows) ? result.rows : [])
    .map((row, index) => {
      const code = normalizeFundCode(row?.code || '');
      if (!isValidFundCode(code)) return null;
      const price = Number(row?.avgCost);
      const shares = Number(row?.shares);
      if (!(price > 0) || !(shares > 0)) return null;
      return normalizeTransaction({
        id: buildTransactionId(`ocr-${index + 1}`),
        code,
        name: row?.name || '',
        kind: detectFundKind(code),
        type: 'BUY',
        date: '',
        price,
        shares,
        note: 'OCR 导入，请核对交易日期与价格'
      }, { idPrefix: 'ocr' });
    })
    .filter(Boolean);

  return {
    draftTransactions,
    warnings: result.warnings,
    previewLines: result.previewLines,
    recordCount: result.recordCount,
    confidence: result.confidence,
    provider: result.provider,
    model: result.model,
    promptVersion: result.promptVersion,
    durationMs: result.durationMs
  };
}

export function mergeSnapshotsFromNavResult(existing = {}, navResult = null) {
  const nextSnapshots = { ...(existing || {}) };
  if (!navResult || !Array.isArray(navResult.items)) {
    return { snapshotsByCode: nextSnapshots, errors: [] };
  }
  const errors = [];
  const updatedAt = navResult.generatedAt || new Date().toISOString();
  for (const item of navResult.items) {
    const code = normalizeFundCode(item?.code || '');
    if (!isValidFundCode(code)) continue;
    if (item?.ok === false) {
      errors.push({ code, message: String(item?.error || '').trim() || '净值更新失败。' });
      // preserve existing snapshot but mark error on the entry
      const prev = nextSnapshots[code] || {};
      nextSnapshots[code] = normalizeSnapshotEntry({
        ...prev,
        code,
        error: item?.error || '净值更新失败。'
      });
      continue;
    }
    nextSnapshots[code] = normalizeSnapshotEntry({
      code,
      name: item?.name || '',
      latestNav: item?.latestNav,
      latestNavDate: item?.latestNavDate,
      previousNav: item?.previousNav,
      previousNavDate: item?.previousNavDate,
      updatedAt: item?.updatedAt || updatedAt,
      cacheHit: item?.cacheHit,
      cacheSource: item?.cacheSource,
      cacheKey: item?.cacheKey,
      error: ''
    });
  }
  return { snapshotsByCode: nextSnapshots, errors };
}

export function buildNavMetaFromResult(navResult = null, errors = []) {
  const items = Array.isArray(navResult?.items) ? navResult.items : [];
  const successCount = items.filter((item) => item?.ok !== false).length;
  const failureCount = items.filter((item) => item?.ok === false).length + (errors.length > successCount ? 0 : 0);
  return normalizeLastNavMeta({
    status: failureCount > 0 && successCount === 0 ? 'error' : 'ok',
    updatedAt: navResult?.generatedAt || new Date().toISOString(),
    successCount,
    failureCount,
    errors: errors.map((entry) => `${entry.code}：${entry.message}`).slice(0, 8)
  });
}
