/**
 * 持仓交易账本。
 *
 * 交易行是唯一的账户事实来源；snapshotsByCode 只存在于当前页面内存中，
 * 用作外部 NAV/行情输入，不再写入 aiDcaFundHoldingsLedger，也不参与账号同步。
 */

import { recognizeHoldingsFile } from './holdings.js';
import { getNavSnapshots } from './navService.js';
import {
  buildTransactionId,
  detectFundKind,
  getLedgerCodeList,
  normalizeFundCode,
  normalizeFundName,
  normalizeTransaction,
  sanitizeTransactions,
  round
} from './holdingsLedgerCore.js';

const LEDGER_STORAGE_KEY = 'aiDcaFundHoldingsLedger';
const LEGACY_STORAGE_KEY = 'aiDcaFundHoldingsState';
const LEDGER_STORAGE_SOURCE = 'react-fund-holdings-ledger';
const LEDGER_STORAGE_VERSION = 3;

function safeStorage() {
  return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
}

function safeParse(key) {
  const ls = safeStorage();
  if (!ls) return null;
  try {
    const value = JSON.parse(ls.getItem(key) || 'null');
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

export function createDefaultLedgerState() {
  return {
    transactions: [],
    snapshotsByCode: {},
    lastNavMeta: { status: 'idle', updatedAt: '', successCount: 0, failureCount: 0, errors: [] },
    migratedFromLegacy: false,
    legacyMigrationAt: '',
    switchChains: []
  };
}

export function normalizeLedgerState(rawState = {}) {
  return {
    ...createDefaultLedgerState(),
    ...rawState,
    transactions: sanitizeTransactions(rawState?.transactions, { filterInvalid: false }),
    // 允许页面运行时携带行情快照，但 persistLedgerState 会明确排除它。
    snapshotsByCode: rawState?.snapshotsByCode && typeof rawState.snapshotsByCode === 'object'
      ? rawState.snapshotsByCode
      : {},
    lastNavMeta: rawState?.lastNavMeta && typeof rawState.lastNavMeta === 'object'
      ? rawState.lastNavMeta
      : createDefaultLedgerState().lastNavMeta,
    switchChains: Array.isArray(rawState?.switchChains) ? rawState.switchChains : []
  };
}

export function migrateLegacyAggregateState(legacyState = {}) {
  const transactions = [];
  const rows = Array.isArray(legacyState?.rows) ? legacyState.rows : [];
  rows.forEach((row, index) => {
    const code = normalizeFundCode(row?.code || '');
    const price = Number(row?.avgCost);
    const shares = Number(row?.shares);
    if (!/^\d{6}$/.test(code) || !Number.isFinite(price) || price === 0 || !(shares > 0)) return;
    transactions.push(normalizeTransaction({
      id: buildTransactionId(`migrated-${index}`),
      code,
      name: normalizeFundName(row?.name || ''),
      kind: detectFundKind(code, row?.name || ''),
      type: 'BUY',
      date: '',
      price: round(price, 4),
      shares: round(shares, 4),
      note: '从旧持仓汇总迁入，请补录交易日期'
    }));
  });
  return {
    ...createDefaultLedgerState(),
    transactions,
    migratedFromLegacy: true,
    legacyMigrationAt: new Date().toISOString()
  };
}

export function readLedgerState() {
  const primary = safeParse(LEDGER_STORAGE_KEY);
  if (primary && Array.isArray(primary.transactions)) {
    return normalizeLedgerState({
      ...primary,
      // 旧版本可能在这里留下 snapshotsByCode；读取时也不再把它当账户事实。
      snapshotsByCode: {}
    });
  }
  const legacy = safeParse(LEGACY_STORAGE_KEY);
  if (legacy && Array.isArray(legacy.rows) && legacy.rows.length) {
    const migrated = migrateLegacyAggregateState(legacy);
    persistLedgerState(migrated);
    return migrated;
  }
  return createDefaultLedgerState();
}

export function persistLedgerState(state = {}) {
  const ls = safeStorage();
  if (!ls) return;
  const normalized = normalizeLedgerState(state);
  const codeSet = new Set(getLedgerCodeList(normalized.transactions));
  const payload = {
    source: LEDGER_STORAGE_SOURCE,
    version: LEDGER_STORAGE_VERSION,
    transactions: normalized.transactions,
    // 仅保留交易关联的本地元数据；不保存 snapshotsByCode。
    migratedFromLegacy: Boolean(normalized.migratedFromLegacy),
    legacyMigrationAt: String(normalized.legacyMigrationAt || '').trim(),
    switchChains: Array.isArray(normalized.switchChains) ? normalized.switchChains : [],
    transactionCodeCount: codeSet.size
  };
  ls.setItem(LEDGER_STORAGE_KEY, JSON.stringify(payload));
  try {
    window.dispatchEvent(new CustomEvent('holdings:ledger-updated', { detail: { state: payload } }));
  } catch {
    // ignore event dispatch errors
  }
}

function normalizeSnapshotEntry(entry = {}) {
  const code = normalizeFundCode(entry?.code || '');
  if (!/^\d{6}$/.test(code)) return null;
  return {
    ...entry,
    code,
    name: normalizeFundName(entry?.name || ''),
    latestNav: round(Number(entry?.latestNav) || 0, 4),
    previousNav: round(Number(entry?.previousNav) || 0, 4),
    latestNavDate: String(entry?.latestNavDate || '').trim(),
    previousNavDate: String(entry?.previousNavDate || '').trim(),
    updatedAt: String(entry?.updatedAt || '').trim(),
    error: String(entry?.error || '').trim()
  };
}

export function mergeSnapshotsFromNavResult(existing = {}, navResult = null) {
  const next = { ...(existing || {}) };
  const errors = [];
  const generatedAt = navResult?.generatedAt || new Date().toISOString();
  for (const item of Array.isArray(navResult?.items) ? navResult.items : []) {
    const code = normalizeFundCode(item?.code || '');
    if (!/^\d{6}$/.test(code)) continue;
    if (item?.ok === false) {
      errors.push({ code, message: String(item?.error || '').trim() || '净值更新失败。' });
      next[code] = normalizeSnapshotEntry({ ...(next[code] || {}), code, error: item?.error || '净值更新失败。' });
      continue;
    }
    next[code] = normalizeSnapshotEntry({
      code,
      name: item?.name || '',
      latestNav: item?.latestNav,
      latestNavDate: item?.latestNavDate,
      previousNav: item?.previousNav ?? item?.previousClose,
      previousNavDate: item?.previousNavDate,
      price: item?.price ?? item?.currentPrice ?? item?.close,
      currentPrice: item?.currentPrice ?? item?.price ?? item?.close,
      previousClose: item?.previousClose,
      change: item?.change,
      changePercent: item?.changePercent,
      asOf: item?.asOf,
      quoteDate: item?.quoteDate,
      marketState: item?.marketState,
      updatedAt: item?.asOf || item?.updatedAt || generatedAt,
      cacheHit: item?.cacheHit,
      cacheSource: item?.cacheSource,
      cacheKey: item?.cacheKey,
      error: ''
    });
  }
  return { snapshotsByCode: next, errors };
}

export function buildNavMetaFromResult(navResult = null, errors = []) {
  const items = Array.isArray(navResult?.items) ? navResult.items : [];
  const successCount = items.filter((item) => item?.ok !== false).length;
  const failureCount = items.filter((item) => item?.ok === false).length;
  return {
    status: failureCount > 0 && successCount === 0 ? 'error' : 'ok',
    updatedAt: String(navResult?.generatedAt || new Date().toISOString()),
    successCount,
    failureCount,
    errors: errors.map((entry) => `${entry.code}：${entry.message}`).slice(0, 8)
  };
}

export async function requestLedgerNav(codes = []) {
  return getNavSnapshots(codes);
}

export async function recognizeLedgerFile(file, onProgress) {
  const result = await recognizeHoldingsFile(file, onProgress);
  const drafts = (Array.isArray(result.rows) ? result.rows : []).map((row, index) => normalizeTransaction({
    id: buildTransactionId(`ocr-${index + 1}`),
    code: row?.code || '',
    name: row?.name || '',
    kind: row?.kind || 'otc',
    type: 'BUY',
    date: '',
    price: row?.avgCost || 0,
    shares: row?.shares || 0,
    amount: row?.amount || 0,
    note: 'OCR 导入，请核对交易日期与价格'
  }, { idPrefix: 'ocr' }));
  return {
    draftTransactions: drafts,
    warnings: result.warnings || [],
    previewLines: result.previewLines || [],
    recordCount: result.recordCount || drafts.length,
    confidence: result.confidence || 0,
    provider: result.provider || 'gemini-worker',
    model: result.model || '',
    promptVersion: result.promptVersion || '',
    durationMs: result.durationMs || 0
  };
}
