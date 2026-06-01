const HOLDING_CODE_PATTERN = /^\d{6}$/;

function buildHoldingRowId(prefix = 'holding') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function round(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round((Number(value) || 0) * factor) / factor;
}

export function normalizeHoldingCode(code = '') {
  const raw = String(code || '').trim();
  const digitsOnly = raw.replace(/\D/g, '');
  if (digitsOnly.length === 6) {
    return digitsOnly;
  }
  return raw;
}

function normalizeHoldingName(name = '') {
  return String(name || '').replace(/\s+/g, ' ').trim();
}

function parsePositiveNumber(value, precision = 4) {
  if (value === null || value === undefined || value === '') {
    return 0;
  }

  const normalizedText = typeof value === 'string'
    ? value.replace(/[,\s]/g, '')
    : value;
  const numericValue = Number(normalizedText);

  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return 0;
  }

  return round(numericValue, precision);
}

export function createEmptyHoldingRow(id = buildHoldingRowId()) {
  return {
    id,
    code: '',
    name: '',
    avgCost: '',
    shares: ''
  };
}

export function normalizeHoldingRow(row = {}, { idPrefix = 'holding' } = {}) {
  return {
    id: String(row?.id || '').trim() || buildHoldingRowId(idPrefix),
    code: normalizeHoldingCode(row?.code || ''),
    name: normalizeHoldingName(row?.name || ''),
    avgCost: parsePositiveNumber(row?.avgCost, 4),
    shares: parsePositiveNumber(row?.shares, 2)
  };
}

export function sanitizeHoldingRows(rows = [], { filterInvalid = false, idPrefix = 'holding' } = {}) {
  const normalizedRows = (Array.isArray(rows) ? rows : []).map((row) => normalizeHoldingRow(row, { idPrefix }));

  if (!filterInvalid) {
    return normalizedRows;
  }

  return normalizedRows.filter((row) => isHoldingRowComplete(row));
}

export function hasMeaningfulHoldingRow(row = {}) {
  return Boolean(
    String(row?.code || '').trim()
      || String(row?.name || '').trim()
      || String(row?.avgCost || '').trim()
      || String(row?.shares || '').trim()
      || Number(row?.avgCost) > 0
      || Number(row?.shares) > 0
  );
}

export function getHoldingRowErrors(row = {}, { ignoreBlank = false } = {}) {
  const meaningful = hasMeaningfulHoldingRow(row);
  if (ignoreBlank && !meaningful) {
    return {};
  }

  const normalized = normalizeHoldingRow(row);
  const errors = {};

  if (!normalized.code) {
    errors.code = '基金代码必填。';
  } else if (!HOLDING_CODE_PATTERN.test(normalized.code)) {
    errors.code = '基金代码必须为 6 位数字。';
  }

  if (!(normalized.avgCost > 0)) {
    errors.avgCost = '买入均价必须大于 0。';
  }

  if (!(normalized.shares > 0)) {
    errors.shares = '持有份数必须大于 0。';
  }

  return errors;
}

export function isHoldingRowComplete(row = {}, options = {}) {
  return Object.keys(getHoldingRowErrors(row, options)).length === 0;
}

export function getHoldingCodeList(rows = []) {
  const codeSet = new Set();

  for (const row of Array.isArray(rows) ? rows : []) {
    const code = normalizeHoldingCode(row?.code || '');
    if (HOLDING_CODE_PATTERN.test(code)) {
      codeSet.add(code);
    }
  }

  return [...codeSet].sort();
}

export function isHoldingCode(value = '') {
  return HOLDING_CODE_PATTERN.test(normalizeHoldingCode(value));
}
