import {
  FUND_SWITCH_STRATEGIES,
  buildFundSwitchPositionMetrics,
  deriveFundSwitchComparison as deriveFundSwitchComparisonFromCore,
  getFundSwitchRowAmount,
  replayFundSwitchRows,
  round,
  sanitizeFundSwitchComparison,
  sanitizeFundSwitchRows
} from './fundSwitchCore.js';

export { FUND_SWITCH_STRATEGIES };

const FUND_SWITCH_HISTORY_KEY = 'aiDcaFundSwitchHistory';
const FUND_SWITCH_HISTORY_SOURCE = 'react-fund-switch-history';
const FUND_SWITCH_HISTORY_LIMIT = 12;
const FUND_SWITCH_DOCS_KEY = 'aiDcaFundSwitchDocs';
const FUND_SWITCH_DOCS_SOURCE = 'react-fund-switch-docs';
const FUND_SWITCH_DOC_LIMIT = 24;
const FUND_SWITCH_SESSION_KEY = 'aiDcaFundSwitchSessionState';
const FUND_SWITCH_VIEW_HASH = '#/view';

function createBlankComparison() {
  return {
    strategy: 'trace',
    sourcePositions: [],
    targetPositions: [],
    sourceCode: '',
    sourceSellShares: 0,
    sourceCurrentPrice: 0,
    targetCode: '',
    targetBuyShares: 0,
    targetCurrentPrice: 0,
    switchCost: 0,
    extraCash: 0,
    feeTradeCount: 0,
    priceOverrides: {}
  };
}

function createBlankRow(id = `switch-${Date.now()}`) {
  return sanitizeFundSwitchRows([
    {
      id,
      date: '',
      code: '',
      type: '买入',
      buyPrice: 0,
      sellPrice: 0,
      shares: 0,
      amount: 0
    }
  ])[0];
}

export const defaultFundSwitchState = {
  docId: '',
  historyEntryId: '',
  fileName: '',
  recognizedRecords: 0,
  resultConfirmed: false,
  feePerTrade: 0,
  comparison: createBlankComparison(),
  rows: [createBlankRow('switch-empty-1')]
};

export function createDefaultFundSwitchState() {
  return {
    docId: '',
    historyEntryId: '',
    fileName: '',
    recognizedRecords: 0,
    resultConfirmed: false,
    feePerTrade: 0,
    comparison: createBlankComparison(),
    rows: [createBlankRow('switch-empty-1')]
  };
}

function toPositiveNumber(value) {
  return Math.max(Number(value) || 0, 0);
}

function buildHistoryEntryId() {
  return `fund-switch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildFundSwitchDocId() {
  return `fund-switch-doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function safeDecodeHashPart(value = '') {
  try {
    return decodeURIComponent(String(value || ''));
  } catch {
    return String(value || '');
  }
}

function hasMeaningfulRowContent(row) {
  return Boolean(
    String(row?.date || '').trim()
      || String(row?.code || '').trim()
      || Number(row?.price) > 0
      || Number(row?.shares) > 0
      || Number(row?.amount) > 0
  );
}

function buildPositionCodeLabel(positions = [], fallbackCode = '') {
  const codes = [...new Set(
    (Array.isArray(positions) ? positions : [])
      .map((position) => String(position?.code || '').trim())
      .filter(Boolean)
  )];
  const normalizedFallbackCode = String(fallbackCode || '').trim();

  if (!codes.length && normalizedFallbackCode) {
    codes.push(normalizedFallbackCode);
  }

  if (!codes.length) {
    return '';
  }

  if (codes.length === 1) {
    return codes[0];
  }

  if (codes.length === 2) {
    return `${codes[0]}、${codes[1]}`;
  }

  return `${codes[0]}、${codes[1]} 等${codes.length}只`;
}

function buildFundSwitchHistoryTitle(state = {}, computed = {}) {
  const comparison = sanitizeFundSwitchComparison(computed?.comparison || state?.comparison);
  const sourceLabel = buildPositionCodeLabel(comparison.sourcePositions, comparison.sourceCode);
  const targetLabel = buildPositionCodeLabel(comparison.targetPositions, comparison.targetCode);

  if (sourceLabel && targetLabel) {
    return `${sourceLabel} → ${targetLabel}`;
  }

  const fileName = String(state?.fileName || '').trim();
  if (fileName) {
    return fileName;
  }

  return '基金切换收益分析';
}

function normalizeFundSwitchHistoryEntry(entry = {}) {
  const rows = sanitizeFundSwitchRows(Array.isArray(entry.rows) ? entry.rows : [], { filterInvalid: false });
  const meaningfulRows = rows.filter((row) => hasMeaningfulRowContent(row));
  const comparison = sanitizeFundSwitchComparison(entry.comparison);
  const createdAt = String(entry.createdAt || entry.updatedAt || '');
  const updatedAt = String(entry.updatedAt || createdAt || '');

  if (!String(entry.id || '').trim() || !meaningfulRows.length) {
    return null;
  }

  return {
    source: FUND_SWITCH_HISTORY_SOURCE,
    version: 1,
    id: String(entry.id || '').trim(),
    docId: String(entry.docId || '').trim(),
    title: String(entry.title || '').trim() || buildFundSwitchHistoryTitle({ fileName: entry.fileName, comparison }, { comparison }),
    fileName: String(entry.fileName || '').trim(),
    historyLabel: String(entry.historyLabel || '').trim(),
    rows: meaningfulRows,
    comparison,
    feePerTrade: round(toPositiveNumber(entry.feePerTrade), 2),
    recognizedRecords: Math.max(Number(entry.recognizedRecords) || 0, meaningfulRows.length),
    resultConfirmed: entry.resultConfirmed !== false,
    snapshot: {
      switchAdvantage: round(Number(entry?.snapshot?.switchAdvantage) || 0, 2),
      stayValue: round(Number(entry?.snapshot?.stayValue) || 0, 2),
      switchedValue: round(Number(entry?.snapshot?.switchedValue) || 0, 2),
      recordCount: Math.max(Number(entry?.snapshot?.recordCount) || 0, meaningfulRows.length),
      strategy: comparison.strategy
    },
    createdAt,
    updatedAt
  };
}

function normalizeFundSwitchRuntimeState(state = {}) {
  const rows = sanitizeFundSwitchRows(
    Array.isArray(state?.rows) && state.rows.length ? state.rows : defaultFundSwitchState.rows,
    { filterInvalid: false }
  );

  return {
    docId: String(state?.docId || '').trim(),
    historyEntryId: String(state?.historyEntryId || '').trim(),
    fileName: String(state?.fileName || '').trim(),
    recognizedRecords: Math.max(Number(state?.recognizedRecords) || 0, rows.filter((row) => hasMeaningfulRowContent(row)).length),
    resultConfirmed: state?.resultConfirmed === true,
    feePerTrade: round(toPositiveNumber(state?.feePerTrade), 2),
    comparison: sanitizeFundSwitchComparison(state?.comparison),
    rows
  };
}

function hasRuntimePayload(state = {}) {
  return Boolean(
    String(state?.fileName || '').trim()
      || Number(state?.recognizedRecords) > 0
      || (Array.isArray(state?.rows) ? state.rows : []).some((row) => hasMeaningfulRowContent(row))
  );
}

export function parseFundSwitchHashRoute(hash = '') {
  const normalizedHash = String(hash || '').trim();
  const withoutHash = normalizedHash.startsWith('#') ? normalizedHash.slice(1) : normalizedHash;
  const normalizedPath = withoutHash || '/';
  const viewMatch = normalizedPath.match(/^\/?view(?:\/([^/?#]+))?$/);

  if (viewMatch) {
    return {
      mode: 'view',
      docId: safeDecodeHashPart(viewMatch[1] || '').trim()
    };
  }

  return {
    mode: 'upload',
    docId: ''
  };
}

export function isFundSwitchViewHash(hash = '') {
  return parseFundSwitchHashRoute(hash).mode === 'view';
}

export function buildFundSwitchViewHash(docId = '') {
  const normalizedDocId = String(docId || '').trim();
  return normalizedDocId ? `${FUND_SWITCH_VIEW_HASH}/${encodeURIComponent(normalizedDocId)}` : FUND_SWITCH_VIEW_HASH;
}

function normalizeFundSwitchDocumentEntry(entry = {}) {
  const state = normalizeFundSwitchRuntimeState(entry.state || entry);
  const normalizedState = {
    ...state,
    docId: String(entry.id || state.docId || '').trim()
  };
  const id = normalizedState.docId;
  const createdAt = String(entry.createdAt || entry.updatedAt || '');
  const updatedAt = String(entry.updatedAt || createdAt || '');

  if (!id || !hasRuntimePayload(normalizedState)) {
    return null;
  }

  return {
    source: FUND_SWITCH_DOCS_SOURCE,
    version: 1,
    id,
    title: String(entry.title || '').trim() || buildFundSwitchHistoryTitle(normalizedState, { comparison: normalizedState.comparison }),
    fileName: normalizedState.fileName,
    workflowStatus: ['idle', 'uploading', 'processing', 'ready', 'error'].includes(String(entry.workflowStatus || ''))
      ? String(entry.workflowStatus)
      : normalizedState.resultConfirmed ? 'ready' : 'processing',
    ocrStatus: String(entry.ocrStatus || '').trim(),
    ocrMessage: String(entry.ocrMessage || '').trim(),
    ocrDurationMs: Math.max(Number(entry.ocrDurationMs) || 0, 0),
    recognizedRecords: normalizedState.recognizedRecords,
    resultConfirmed: normalizedState.resultConfirmed,
    historyEntryId: normalizedState.historyEntryId,
    createdAt,
    updatedAt,
    state: normalizedState
  };
}

function readFundSwitchDocumentStore() {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const rawStore = JSON.parse(window.localStorage.getItem(FUND_SWITCH_DOCS_KEY) || 'null');
    return (Array.isArray(rawStore?.entries) ? rawStore.entries : [])
      .map((entry) => normalizeFundSwitchDocumentEntry(entry))
      .filter(Boolean)
      .sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')));
  } catch {
    return [];
  }
}

function persistFundSwitchDocumentStore(entries = []) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(FUND_SWITCH_DOCS_KEY, JSON.stringify({
    source: FUND_SWITCH_DOCS_SOURCE,
    version: 1,
    entries
  }));
}

function readFundSwitchHistoryStore() {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const rawStore = JSON.parse(window.localStorage.getItem(FUND_SWITCH_HISTORY_KEY) || 'null');
    return (Array.isArray(rawStore?.entries) ? rawStore.entries : [])
      .map((entry) => normalizeFundSwitchHistoryEntry(entry))
      .filter(Boolean)
      .sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')));
  } catch {
    return [];
  }
}

function persistFundSwitchHistoryStore(entries = []) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(FUND_SWITCH_HISTORY_KEY, JSON.stringify({
    source: FUND_SWITCH_HISTORY_SOURCE,
    version: 1,
    entries
  }));
}

export function createEmptyFundSwitchRow() {
  return createBlankRow();
}

export function deriveFundSwitchComparison(rows, comparison = {}, strategyOverride) {
  return deriveFundSwitchComparisonFromCore(rows, comparison, strategyOverride);
}

export function readFundSwitchDocuments() {
  return readFundSwitchDocumentStore();
}

export function readFundSwitchDocument(docId = '') {
  const normalizedDocId = String(docId || '').trim();
  if (!normalizedDocId) {
    return null;
  }
  return readFundSwitchDocumentStore().find((entry) => entry.id === normalizedDocId) || null;
}

export function buildFundSwitchStateFromDocument(entry = {}) {
  const normalizedEntry = normalizeFundSwitchDocumentEntry(entry);
  if (!normalizedEntry) {
    return createDefaultFundSwitchState();
  }

  return {
    ...normalizedEntry.state,
    docId: normalizedEntry.id
  };
}

function resolveDocumentWorkflowStatus(ocrState = {}, fallbackStatus = 'processing', resultConfirmed = false) {
  const normalizedStatus = String(ocrState?.status || '').trim();
  if (normalizedStatus === 'error') {
    return 'error';
  }
  if (resultConfirmed || normalizedStatus === 'success' || normalizedStatus === 'warning') {
    return 'ready';
  }
  if (normalizedStatus === 'loading') {
    return 'processing';
  }
  return fallbackStatus;
}

export function saveFundSwitchDocument(state, { ocrState, workflowStatus } = {}) {
  if (typeof window === 'undefined') {
    return null;
  }

  const normalizedState = normalizeFundSwitchRuntimeState(state);
  const nextId = normalizedState.docId || buildFundSwitchDocId();
  const currentEntries = readFundSwitchDocumentStore();
  const existingEntry = currentEntries.find((entry) => entry.id === nextId) || null;
  const timestamp = new Date().toISOString();
  const nextEntry = normalizeFundSwitchDocumentEntry({
    ...existingEntry,
    id: nextId,
    title: buildFundSwitchHistoryTitle({ ...normalizedState, docId: nextId }, { comparison: normalizedState.comparison }),
    fileName: normalizedState.fileName,
    workflowStatus: workflowStatus || resolveDocumentWorkflowStatus(ocrState, existingEntry?.workflowStatus || 'processing', normalizedState.resultConfirmed),
    ocrStatus: ocrState?.status || existingEntry?.ocrStatus || '',
    ocrMessage: ocrState?.message || existingEntry?.ocrMessage || '',
    ocrDurationMs: Number(ocrState?.durationMs) > 0 ? Number(ocrState.durationMs) : Number(existingEntry?.ocrDurationMs) || 0,
    createdAt: existingEntry?.createdAt || timestamp,
    updatedAt: timestamp,
    state: {
      ...normalizedState,
      docId: nextId
    }
  });

  if (!nextEntry) {
    return null;
  }

  const nextEntries = [
    nextEntry,
    ...currentEntries.filter((entry) => entry.id !== nextEntry.id)
  ].slice(0, FUND_SWITCH_DOC_LIMIT);
  persistFundSwitchDocumentStore(nextEntries);
  return nextEntry;
}

export function buildFundSwitchSummary(state, { getCurrentPrice } = {}) {
  const comparison = sanitizeFundSwitchComparison(state?.comparison);
  const feePerTrade = round(toPositiveNumber(state?.feePerTrade), 2);
  const rows = sanitizeFundSwitchRows(
    Array.isArray(state?.rows) && state.rows.length ? state.rows : defaultFundSwitchState.rows
  );
  const validRows = sanitizeFundSwitchRows(rows, { filterInvalid: true });
  const processedAmount = round(validRows.reduce((sum, row) => sum + getFundSwitchRowAmount(row), 0), 2);
  const sellAmount = round(validRows.reduce((sum, row) => sum + (row.type === '卖出' ? getFundSwitchRowAmount(row) : 0), 0), 2);
  const buyAmount = round(validRows.reduce((sum, row) => sum + (row.type === '买入' ? getFundSwitchRowAmount(row) : 0), 0), 2);
  const estimatedYield = round(sellAmount - buyAmount, 2);
  const sourcePositions = buildFundSwitchPositionMetrics(comparison.sourcePositions, 'source', comparison, getCurrentPrice);
  const targetPositions = buildFundSwitchPositionMetrics(comparison.targetPositions, 'target', comparison, getCurrentPrice);
  const stayValue = round(sourcePositions.reduce((sum, position) => sum + position.marketValue, 0), 2);
  const switchedValue = round(targetPositions.reduce((sum, position) => sum + position.marketValue, 0), 2);
  const feeTotal = round(feePerTrade * comparison.feeTradeCount, 2);
  const switchedPositionProfit = round(switchedValue - comparison.switchCost - feeTotal, 2);
  const switchAdvantage = round(switchedValue - stayValue - comparison.extraCash - feeTotal, 2);
  const missingPriceCodes = [...new Set(
    [...sourcePositions, ...targetPositions]
      .filter((position) => position.currentPrice <= 0)
      .map((position) => position.code)
  )];
  const resolvedComparison = sanitizeFundSwitchComparison({
    ...comparison,
    sourceCurrentPrice: sourcePositions.length === 1 ? sourcePositions[0].currentPrice : 0,
    targetCurrentPrice: targetPositions.length === 1 ? targetPositions[0].currentPrice : 0
  });
  const replay = replayFundSwitchRows(validRows);

  return {
    rows,
    validRows,
    comparison: resolvedComparison,
    feePerTrade,
    feeTotal,
    processedAmount,
    sellAmount,
    buyAmount,
    estimatedYield,
    stayValue,
    switchedValue,
    switchedPositionProfit,
    switchAdvantage,
    recordCount: rows.length,
    validRecordCount: validRows.length,
    sourcePositions,
    targetPositions,
    missingPriceCodes,
    strategy: resolvedComparison.strategy,
    switchEvents: replay.switchEvents,
    currentLots: replay.currentLots
  };
}

export function readFundSwitchState() {
  if (typeof window === 'undefined') {
    return createDefaultFundSwitchState();
  }

  try {
    const route = parseFundSwitchHashRoute(window.location.hash);
    if (route.mode !== 'view') {
      return createDefaultFundSwitchState();
    }

    if (route.docId) {
      const documentEntry = readFundSwitchDocument(route.docId);
      if (documentEntry) {
        return buildFundSwitchStateFromDocument(documentEntry);
      }
    }

    const rawStore = JSON.parse(window.sessionStorage.getItem(FUND_SWITCH_SESSION_KEY) || 'null');
    const normalizedState = normalizeFundSwitchRuntimeState(rawStore?.state);
    return hasRuntimePayload(normalizedState) ? normalizedState : createDefaultFundSwitchState();
  } catch (_error) {
    return createDefaultFundSwitchState();
  }
}

export function persistFundSwitchState(state, computed = buildFundSwitchSummary(state)) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    const normalizedState = normalizeFundSwitchRuntimeState({
      ...state,
      comparison: computed?.comparison || state?.comparison
    });

    if (!hasRuntimePayload(normalizedState)) {
      window.sessionStorage.removeItem(FUND_SWITCH_SESSION_KEY);
      return;
    }

    window.sessionStorage.setItem(FUND_SWITCH_SESSION_KEY, JSON.stringify({
      version: 1,
      updatedAt: new Date().toISOString(),
      state: normalizedState
    }));
  } catch (_error) {
    // Ignore transient session persistence errors.
  }
}

export function readFundSwitchHistory() {
  return readFundSwitchHistoryStore();
}

export function buildFundSwitchStateFromHistoryEntry(entry = {}) {
  const normalizedEntry = normalizeFundSwitchHistoryEntry(entry);
  if (!normalizedEntry) {
    return createDefaultFundSwitchState();
  }

  return {
    docId: normalizedEntry.docId || '',
    historyEntryId: normalizedEntry.id,
    fileName: normalizedEntry.fileName || normalizedEntry.title,
    recognizedRecords: normalizedEntry.recognizedRecords,
    resultConfirmed: true,
    feePerTrade: normalizedEntry.feePerTrade,
    comparison: normalizedEntry.comparison,
    rows: normalizedEntry.rows
  };
}

export function saveFundSwitchHistoryEntry(state, computed = buildFundSwitchSummary(state)) {
  if (typeof window === 'undefined') {
    return null;
  }

  const timestamp = new Date().toISOString();
  const normalizedRows = sanitizeFundSwitchRows(
    Array.isArray(state?.rows) ? state.rows.filter((row) => hasMeaningfulRowContent(row)) : [],
    { filterInvalid: false }
  );
  const comparison = sanitizeFundSwitchComparison(computed?.comparison || state?.comparison);
  if (!normalizedRows.length) {
    return null;
  }

  const currentEntries = readFundSwitchHistoryStore();
  const existingEntry = currentEntries.find((entry) => entry.id === String(state?.historyEntryId || '').trim()) || null;
  const nextEntry = normalizeFundSwitchHistoryEntry({
    id: existingEntry?.id || buildHistoryEntryId(),
    docId: String(state?.docId || '').trim(),
    title: buildFundSwitchHistoryTitle(state, computed),
    fileName: String(state?.fileName || '').trim(),
    historyLabel: buildFundSwitchHistoryTitle(state, computed),
    rows: normalizedRows,
    comparison,
    feePerTrade: round(toPositiveNumber(state?.feePerTrade), 2),
    recognizedRecords: Math.max(Number(state?.recognizedRecords) || 0, computed?.validRecordCount || normalizedRows.length),
    resultConfirmed: true,
    snapshot: {
      switchAdvantage: round(Number(computed?.switchAdvantage) || 0, 2),
      stayValue: round(Number(computed?.stayValue) || 0, 2),
      switchedValue: round(Number(computed?.switchedValue) || 0, 2),
      recordCount: Math.max(Number(computed?.validRecordCount) || 0, normalizedRows.length),
      strategy: comparison.strategy
    },
    createdAt: existingEntry?.createdAt || timestamp,
    updatedAt: timestamp
  });

  if (!nextEntry) {
    return null;
  }

  const nextEntries = [
    nextEntry,
    ...currentEntries.filter((entry) => entry.id !== nextEntry.id)
  ].slice(0, FUND_SWITCH_HISTORY_LIMIT);
  persistFundSwitchHistoryStore(nextEntries);
  return nextEntry;
}

export function deleteFundSwitchHistoryEntry(entryId = '') {
  if (typeof window === 'undefined') {
    return;
  }

  const normalizedEntryId = String(entryId || '').trim();
  if (!normalizedEntryId) {
    return;
  }

  const nextEntries = readFundSwitchHistoryStore().filter((entry) => entry.id !== normalizedEntryId);
  persistFundSwitchHistoryStore(nextEntries);
}

// 删除一份“最近上传”文档，与删除历史分析的语义对齐：
// 只动文档库，不连带清理历史分析。调用方需自行处理当前打开的 docId。
export function deleteFundSwitchDocument(docId = '') {
  if (typeof window === 'undefined') {
    return;
  }

  const normalizedDocId = String(docId || '').trim();
  if (!normalizedDocId) {
    return;
  }

  const nextEntries = readFundSwitchDocumentStore().filter((entry) => entry.id !== normalizedDocId);
  persistFundSwitchDocumentStore(nextEntries);
}
