import {
  createEmptyHoldingRow,
  getHoldingCodeList,
  hasMeaningfulHoldingRow,
  isHoldingCode,
  round,
  sanitizeHoldingRows
} from './holdingsCore.js';

const HOLDINGS_STORAGE_KEY = 'aiDcaFundHoldingsState';
const HOLDINGS_STORAGE_SOURCE = 'react-fund-holdings-workspace';
const HOLDINGS_STORAGE_VERSION = 1;
const HOLDINGS_OCR_ENDPOINT = '/api/holdings/ocr';
const HOLDINGS_NAV_ENDPOINT = '/api/holdings/nav';
const OCR_MAX_FILE_SIZE = 10 * 1024 * 1024;

function now() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }

  return Date.now();
}

function normalizePreviewLines(payload = {}) {
  if (Array.isArray(payload.previewLines) && payload.previewLines.length) {
    return payload.previewLines.filter(Boolean).slice(0, 6);
  }

  if (Array.isArray(payload.warnings) && payload.warnings.length) {
    return payload.warnings.filter(Boolean).slice(0, 6);
  }

  return [];
}

function ensureImageFile(file) {
  if (!file || typeof file !== 'object') {
    throw new Error('未找到要识别的持仓截图。');
  }

  if (!String(file.type || '').startsWith('image/')) {
    throw new Error('当前仅支持 PNG / JPG / JPEG 等常见图片格式。');
  }

  if (Number(file.size) > OCR_MAX_FILE_SIZE) {
    throw new Error('图片请控制在 10MB 内。');
  }
}

function normalizeSnapshotEntry(entry = {}) {
  const code = String(entry?.code || '').trim();
  if (!isHoldingCode(code)) {
    return null;
  }

  return {
    code,
    name: String(entry?.name || '').trim(),
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
    cache: meta?.cache && typeof meta.cache === 'object'
      ? {
        key: String(meta.cache.key || '').trim(),
        hit: meta.cache.hit === true,
        source: String(meta.cache.source || '').trim(),
        stale: meta.cache.stale === true,
        codeCount: Math.max(Number(meta.cache.codeCount) || 0, 0)
      }
      : null,
    errors: Array.isArray(meta?.errors) ? meta.errors.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 8) : []
  };
}

export function createDefaultHoldingsState() {
  return {
    fileName: '',
    rows: [createEmptyHoldingRow('holding-empty-1')],
    snapshotsByCode: {},
    lastNavMeta: normalizeLastNavMeta()
  };
}

export function normalizeHoldingsState(rawState = {}) {
  const rawRows = Array.isArray(rawState?.rows) ? rawState.rows : [];
  const meaningfulRows = sanitizeHoldingRows(rawRows, { filterInvalid: false }).filter((row) => hasMeaningfulHoldingRow(row));

  const snapshotsByCode = {};
  const rawSnapshots = rawState?.snapshotsByCode;

  if (rawSnapshots && typeof rawSnapshots === 'object') {
    for (const [code, entry] of Object.entries(rawSnapshots)) {
      const normalizedEntry = normalizeSnapshotEntry({ ...entry, code });
      if (normalizedEntry) {
        snapshotsByCode[normalizedEntry.code] = normalizedEntry;
      }
    }
  }

  return {
    fileName: String(rawState?.fileName || '').trim(),
    rows: meaningfulRows.length ? meaningfulRows : [createEmptyHoldingRow('holding-empty-1')],
    snapshotsByCode,
    lastNavMeta: normalizeLastNavMeta(rawState?.lastNavMeta)
  };
}

export function readHoldingsState() {
  if (typeof window === 'undefined' || !window.localStorage) {
    return createDefaultHoldingsState();
  }

  try {
    const rawValue = window.localStorage.getItem(HOLDINGS_STORAGE_KEY);
    if (!rawValue) {
      return createDefaultHoldingsState();
    }

    return normalizeHoldingsState(JSON.parse(rawValue));
  } catch (_error) {
    return createDefaultHoldingsState();
  }
}

export function persistHoldingsState(state = {}) {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }

  const normalizedState = normalizeHoldingsState(state);
  const rows = sanitizeHoldingRows(normalizedState.rows, { filterInvalid: false }).filter((row) => hasMeaningfulHoldingRow(row));
  const codeSet = new Set(getHoldingCodeList(rows));
  const snapshotsByCode = Object.fromEntries(
    Object.entries(normalizedState.snapshotsByCode || {}).filter(([code, entry]) => codeSet.has(code) || (entry?.latestNav > 0 && entry?.previousNav > 0))
  );

  const payload = {
    source: HOLDINGS_STORAGE_SOURCE,
    version: HOLDINGS_STORAGE_VERSION,
    fileName: normalizedState.fileName,
    rows,
    snapshotsByCode,
    lastNavMeta: normalizedState.lastNavMeta
  };

  window.localStorage.setItem(HOLDINGS_STORAGE_KEY, JSON.stringify(payload));
}

export async function recognizeHoldingsFile(file, onProgress) {
  ensureImageFile(file);
  const startedAt = now();

  onProgress?.({
    status: 'loading',
    progress: 18,
    message: '正在上传持仓截图'
  });

  const formData = new FormData();
  formData.append('file', file, file.name || 'holdings-upload');

  onProgress?.({
    status: 'loading',
    progress: 46,
    message: '正在识别当前持仓'
  });

  const response = await fetch(HOLDINGS_OCR_ENDPOINT, {
    method: 'POST',
    headers: {
      Accept: 'application/json'
    },
    body: formData
  });

  const rawText = await response.text();
  let payload = {};

  if (rawText) {
    try {
      payload = JSON.parse(rawText);
    } catch (_error) {
      payload = {
        error: response.ok ? '识别服务返回了非标准响应。' : rawText
      };
    }
  }

  if (!response.ok) {
    throw new Error(payload.error || `识别服务请求失败：状态 ${response.status}`);
  }

  onProgress?.({
    status: 'loading',
    progress: 82,
    message: '正在整理持仓草稿'
  });

  return {
    rows: sanitizeHoldingRows(Array.isArray(payload.rows) ? payload.rows : [], { filterInvalid: false, idPrefix: 'holding-import' }),
    warnings: Array.isArray(payload.warnings) ? payload.warnings.filter(Boolean) : [],
    previewLines: normalizePreviewLines(payload),
    recordCount: Math.max(Number(payload.recordCount) || 0, Array.isArray(payload.rows) ? payload.rows.length : 0),
    confidence: Math.max(Math.min(Number(payload.confidence) || 0, 1), 0),
    provider: payload.provider || 'gemini-worker',
    model: payload.model || '',
    promptVersion: payload.promptVersion || '',
    durationMs: Number(payload.durationMs) || Math.round(now() - startedAt)
  };
}

export async function requestHoldingsNav(codes = []) {
  const normalizedCodes = getHoldingCodeList(codes.map((code) => ({ code })));
  if (!normalizedCodes.length) {
    return {
      items: [],
      cache: null,
      successCount: 0,
      failureCount: 0
    };
  }

  const response = await fetch(HOLDINGS_NAV_ENDPOINT, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      codes: normalizedCodes
    })
  });

  const rawText = await response.text();
  let payload = {};

  if (rawText) {
    try {
      payload = JSON.parse(rawText);
    } catch (_error) {
      payload = {
        error: response.ok ? '净值服务返回了非标准响应。' : rawText
      };
    }
  }

  if (!response.ok) {
    throw new Error(payload.error || `净值服务请求失败：状态 ${response.status}`);
  }

  const rawItems = Array.isArray(payload.items) ? payload.items : [];
  const items = rawItems.map((item) => {
    const code = String(item?.code || '').trim();
    if (!isHoldingCode(code)) {
      return null;
    }

    return {
      ok: item?.ok !== false,
      code,
      name: String(item?.name || '').trim(),
      latestNav: round(Number(item?.latestNav) || 0, 4),
      latestNavDate: String(item?.latestNavDate || '').trim(),
      previousNav: round(Number(item?.previousNav) || 0, 4),
      previousNavDate: String(item?.previousNavDate || '').trim(),
      updatedAt: String(item?.updatedAt || '').trim(),
      error: String(item?.error || '').trim(),
      cacheHit: item?.cacheHit === true,
      cacheSource: String(item?.cacheSource || '').trim(),
      cacheKey: String(item?.cacheKey || '').trim()
    };
  }).filter(Boolean);

  return {
    items,
    cache: payload?.cache && typeof payload.cache === 'object'
      ? {
        key: String(payload.cache.key || '').trim(),
        hit: payload.cache.hit === true,
        source: String(payload.cache.source || '').trim(),
        stale: payload.cache.stale === true,
        codeCount: Math.max(Number(payload.cache.codeCount) || 0, 0)
      }
      : null,
    successCount: Math.max(Number(payload.successCount) || 0, items.filter((item) => item.ok).length),
    failureCount: Math.max(Number(payload.failureCount) || 0, items.filter((item) => item.ok === false).length),
    generatedAt: String(payload.generatedAt || '').trim(),
    expiresAt: String(payload.expiresAt || '').trim()
  };
}
