import { isKnownQdiiFundCode } from './qdiiFundCodes.js';
import { getNearestTradingDayShanghai, getPreviousTradingDayShanghai } from './holidaysCN.js';

export const FUND_CODE_PATTERN = /^\d{6}$/;
export const EXCHANGE_PREFIXES = ['15', '50', '51', '52', '56', '58', '53', '54'];

export const TRANSACTION_TYPES = ['BUY', 'SELL'];
export const FUND_KINDS = ['otc', 'exchange', 'qdii'];

export function round(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round((Number(value) || 0) * factor) / factor;
}

export function getTodayShanghaiDate() {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
  } catch {
    const shifted = new Date(Date.now() + 8 * 60 * 60 * 1000);
    return shifted.toISOString().slice(0, 10);
  }
}

export function getExpectedLatestNavDate(kind = 'otc', todayDate = getTodayShanghaiDate()) {
  const today = String(todayDate || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    return today;
  }
  const normalizedKind = kind === 'exchange' || kind === 'qdii' ? kind : 'otc';
  const T = getNearestTradingDayShanghai(today);
  if (normalizedKind === 'exchange' || normalizedKind === 'otc') {
    return T;
  }
  return getPreviousTradingDayShanghai(T);
}

export function normalizeFundCode(code = '') {
  const raw = String(code ?? '').trim();
  const digits = raw.replace(/\D/g, '');
  if (!digits) {
    return raw;
  }
  if (digits.length === 6) {
    return digits;
  }
  if (digits.length < 6) {
    return digits.padStart(6, '0');
  }
  return digits.slice(-6);
}

export function isValidFundCode(code = '') {
  return FUND_CODE_PATTERN.test(normalizeFundCode(code));
}

export function detectQdiiByName(name = '', code = '') {
  const normalizedCode = normalizeFundCode(code);
  return Boolean(normalizedCode && isKnownQdiiFundCode(normalizedCode));
}

export function detectFundKind(code = '', name = '') {
  const normalized = normalizeFundCode(code);
  if (FUND_CODE_PATTERN.test(normalized)) {
    const prefix = normalized.slice(0, 2);
    if (EXCHANGE_PREFIXES.includes(prefix)) {
      return 'exchange';
    }
  }
  if (detectQdiiByName(name, normalized)) {
    return 'qdii';
  }
  return 'otc';
}

export function normalizeFundKind(value = '', code = '', name = '') {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'exchange' || raw === 'qdii') {
    return raw;
  }
  return detectFundKind(code, name);
}

export function normalizeTransactionType(value = '') {
  const raw = String(value || '').trim().toUpperCase();
  return TRANSACTION_TYPES.includes(raw) ? raw : 'BUY';
}

export function normalizeFundName(name = '') {
  return String(name || '').replace(/\s+/g, ' ').trim();
}

export function normalizeIsoDate(value = '') {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  const directMatch = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (directMatch) {
    const [, y, m, d] = directMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const noSepYearMonth = raw.match(/^(\d{4})(\d{2})[-/.](\d{1,2})(?:[-/.](\d{1,2}))?/);
  if (noSepYearMonth) {
    const [, y, m, d1, d2] = noSepYearMonth;
    const day = (d2 || d1);
    return `${y}-${m.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) {
    const [, y, m, d] = compact;
    return `${y}-${m}-${d}`;
  }
  const timestamp = Date.parse(raw);
  if (Number.isFinite(timestamp)) {
    const dateObj = new Date(timestamp);
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return '';
}

function parsePositiveDecimal(value, precision = 4) {
  if (value === null || value === undefined || value === '') {
    return 0;
  }
  const normalized = typeof value === 'string'
    ? value.replace(/[,\s¥$]/g, '')
    : value;
  const num = Number(normalized);
  if (!Number.isFinite(num) || num <= 0) {
    return 0;
  }
  return round(num, precision);
}

export function getTransactionAmount(tx = {}) {
  const explicitAmount = parsePositiveDecimal(tx?.amount, 2);
  if (explicitAmount > 0) {
    return explicitAmount;
  }
  const price = parsePositiveDecimal(tx?.price, 4);
  const shares = parsePositiveDecimal(tx?.shares, 4);
  return price > 0 && shares > 0 ? round(price * shares, 2) : 0;
}

export function buildTransactionId(prefix = 'tx') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createEmptyTransaction(overrides = {}) {
  return {
    id: buildTransactionId('tx'),
    code: '',
    name: '',
    kind: 'otc',
    type: 'BUY',
    date: '',
    price: '',
    shares: '',
    amount: '',
    costPrice: '',
    switchPairId: '',
    note: '',
    tags: [],
    ...overrides
  };
}

export function normalizeTransaction(tx = {}, { idPrefix = 'tx' } = {}) {
  const code = normalizeFundCode(tx?.code || '');
  const kind = normalizeFundKind(tx?.kind, code, tx?.name || '');
  const type = normalizeTransactionType(tx?.type);
  const rawTags = Array.isArray(tx?.tags) ? tx.tags.filter((t) => typeof t === 'string' && t.trim()) : [];
  const tags = rawTags.length > 0 ? rawTags : (kind === 'qdii' ? ['qdii', 'otc'] : [kind]);
  const price = parsePositiveDecimal(tx?.price, 4);
  const explicitAmount = parsePositiveDecimal(tx?.amount, 2);
  const rawShares = parsePositiveDecimal(tx?.shares, 4);
  const canDeriveSharesFromAmount = type === 'BUY' && kind !== 'exchange' && explicitAmount > 0 && price > 0;
  // 场外/QDII 买入页面以金额录入，份额会在净值确认后反推。旧数据可能同时
  // 带着一份过期的隐藏 shares；只要金额和净值都存在，就以金额为准重算份额，
  // 避免持仓成本与交易记录金额出现数量级不一致。
  const shares = canDeriveSharesFromAmount
    ? round(explicitAmount / price, 4)
    : rawShares;
  const amount = explicitAmount > 0 ? explicitAmount : (price > 0 && shares > 0 ? round(price * shares, 2) : 0);
  return {
    id: String(tx?.id || '').trim() || buildTransactionId(idPrefix),
    code,
    name: normalizeFundName(tx?.name || ''),
    kind,
    type,
    date: normalizeIsoDate(tx?.date),
    price,
    shares,
    amount,
    costPrice: parsePositiveDecimal(tx?.costPrice, 4),
    switchPairId: String(tx?.switchPairId || '').trim(),
    note: String(tx?.note || '').trim(),
    tags
  };
}

export function hasMeaningfulTransaction(tx = {}) {
  return Boolean(
    String(tx?.code || '').trim()
      || String(tx?.name || '').trim()
      || String(tx?.date || '').trim()
      || Number(tx?.price) > 0
      || Number(tx?.shares) > 0
      || Number(tx?.amount) > 0
      || Number(tx?.costPrice) > 0
      || String(tx?.note || '').trim()
  );
}

export function sanitizeTransactions(list = [], { filterInvalid = false, idPrefix = 'tx' } = {}) {
  const normalized = (Array.isArray(list) ? list : []).map((tx) => normalizeTransaction(tx, { idPrefix }));
  if (!filterInvalid) {
    return normalized;
  }
  return normalized.filter((tx) => Object.keys(getTransactionErrors(tx)).length === 0);
}

export function getTransactionErrors(tx = {}, { ignoreBlank = false } = {}) {
  const meaningful = hasMeaningfulTransaction(tx);
  if (ignoreBlank && !meaningful) {
    return {};
  }
  const normalized = normalizeTransaction(tx);
  const errors = {};
  if (!normalized.code) {
    errors.code = '基金代码必填。';
  } else if (!FUND_CODE_PATTERN.test(normalized.code)) {
    errors.code = '基金代码必须为 6 位数字。';
  }
  if (!TRANSACTION_TYPES.includes(normalized.type)) {
    errors.type = '交易类型只允许 BUY / SELL。';
  }
  if (normalized.price < 0) {
    errors.price = '交易价格不能为负数。';
  }
  const canUseAmount = normalized.type === 'BUY' && normalized.kind !== 'exchange' && normalized.amount > 0;
  if (!(normalized.shares > 0) && !canUseAmount) {
    errors.shares = normalized.type === 'BUY' && normalized.kind !== 'exchange'
      ? '交易份额或金额必须大于 0。'
      : '交易份额必须大于 0。';
  }
  return errors;
}

export function summarizeTransactionErrors(errors = {}) {
  return Object.values(errors).filter(Boolean).join(' ');
}

export function getLedgerCodeList(transactions = []) {
  const codeSet = new Set();
  for (const tx of Array.isArray(transactions) ? transactions : []) {
    const code = normalizeFundCode(tx?.code || '');
    if (FUND_CODE_PATTERN.test(code)) {
      codeSet.add(code);
    }
  }
  return [...codeSet].sort();
}
