const FUND_CODE_PATTERN = /^\d{6}$/;
const EXCHANGE_PREFIXES = new Set(['15', '50', '51', '52', '53', '54', '56', '58']);

function round(value, precision = 4) {
  const factor = 10 ** precision;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function normalizeFundCode(value = '') {
  const digits = String(value ?? '').trim().replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 6) return digits;
  if (digits.length < 6) return digits.padStart(6, '0');
  return digits.slice(-6);
}

function normalizeFundKind(value = '', code = '') {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'exchange' || raw === 'qdii') return raw;
  return EXCHANGE_PREFIXES.has(normalizeFundCode(code).slice(0, 2)) ? 'exchange' : 'otc';
}

function normalizeTransactionType(value = '') {
  const raw = String(value || '').trim().toUpperCase();
  return raw === 'SELL' ? 'SELL' : 'BUY';
}

function parsePositiveNumber(value, precision = 4) {
  if (value === null || value === undefined || value === '') return 0;
  const normalized = typeof value === 'string' ? value.replace(/[,\s$]/g, '') : value;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) && numeric > 0 ? round(numeric, precision) : 0;
}

function parseSignedNumber(value, precision = 4) {
  if (value === null || value === undefined || value === '') return 0;
  const normalized = typeof value === 'string' ? value.replace(/[,\s$]/g, '') : value;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? round(numeric, precision) : 0;
}

function isUsableTransactionPrice(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric !== 0;
}

function normalizeTransactionForMarkets(tx = {}, index = 0) {
  const code = normalizeFundCode(tx?.code || tx?.symbol || tx?.fundCode || '');
  const type = normalizeTransactionType(tx?.type || tx?.side || '');
  const kind = normalizeFundKind(tx?.kind || tx?.fundKind, code);
  const price = parseSignedNumber(tx?.price, 4);
  const explicitAmount = parsePositiveNumber(tx?.amount, 2);
  const rawShares = parsePositiveNumber(tx?.shares, 4);
  const canDeriveSharesFromAmount = type === 'BUY' && kind !== 'exchange' && explicitAmount > 0 && price > 0;
  const shares = rawShares || (canDeriveSharesFromAmount ? round(explicitAmount / price, 4) : 0);
  return {
    ...tx,
    id: String(tx?.id || `markets-tx-${index}`).trim(),
    code,
    name: String(tx?.name || '').trim(),
    kind,
    type,
    date: String(tx?.date || '').slice(0, 10),
    price,
    shares,
    amount: explicitAmount || (isUsableTransactionPrice(price) && shares > 0 ? round(price * shares, 2) : 0),
    costPrice: parsePositiveNumber(tx?.costPrice, 4)
  };
}

function compareTxChrono(a, b) {
  const da = String(a?.date || '');
  const db = String(b?.date || '');
  if (da !== db) return da < db ? -1 : 1;
  const ta = a?.type === 'BUY' ? 0 : 1;
  const tb = b?.type === 'BUY' ? 0 : 1;
  if (ta !== tb) return ta - tb;
  const ia = String(a?.id || '');
  const ib = String(b?.id || '');
  return ia < ib ? -1 : (ia > ib ? 1 : 0);
}

function isPendingOtcBuy(tx = {}) {
  if (tx.type !== 'BUY') return false;
  if (tx.kind !== 'otc' && tx.kind !== 'qdii') return false;
  return (!isUsableTransactionPrice(tx.price) || !(Number(tx.shares) > 0)) && Number(tx.amount) > 0;
}

function isPendingOtcSell(tx = {}) {
  if (tx.type !== 'SELL') return false;
  if (Number(tx.costPrice) > 0) return false;
  if (tx.kind !== 'otc' && tx.kind !== 'qdii') return false;
  return !isUsableTransactionPrice(tx.price);
}

export function buildMarketsHeldAggregates(transactions = [], snapshotsByCode = {}) {
  const buckets = new Map();
  const list = Array.isArray(transactions) ? transactions : [];
  list.forEach((rawTx, index) => {
    const tx = normalizeTransactionForMarkets(rawTx, index);
    if (!FUND_CODE_PATTERN.test(tx.code)) return;
    if (!buckets.has(tx.code)) {
      const snapshot = snapshotsByCode?.[tx.code] || {};
      buckets.set(tx.code, {
        code: tx.code,
        name: tx.name || String(snapshot?.name || '').trim(),
        kind: normalizeFundKind(tx.kind, tx.code),
        transactions: [],
        totalShares: 0,
        pendingBuyAmount: 0,
        hasPosition: false
      });
    }
    const bucket = buckets.get(tx.code);
    bucket.transactions.push(tx);
    if (tx.name && !bucket.name) bucket.name = tx.name;
    if (tx.kind) bucket.kind = tx.kind;
  });

  const aggregates = [];
  for (const bucket of buckets.values()) {
    let totalShares = 0;
    let pendingBuyAmount = 0;
    for (const tx of [...bucket.transactions].sort(compareTxChrono)) {
      if (tx.type === 'BUY') {
        if (isPendingOtcBuy(tx)) {
          pendingBuyAmount = round(pendingBuyAmount + tx.amount, 2);
        } else {
          totalShares = round(totalShares + tx.shares, 4);
        }
      } else if (!isPendingOtcSell(tx)) {
        totalShares = round(totalShares - tx.shares, 4);
        if (totalShares < 0) totalShares = 0;
      }
    }
    aggregates.push({
      ...bucket,
      totalShares,
      pendingBuyAmount,
      hasPosition: totalShares > 0 || pendingBuyAmount > 0
    });
  }
  return aggregates.sort((a, b) => {
    if (a.hasPosition !== b.hasPosition) return a.hasPosition ? -1 : 1;
    return a.code.localeCompare(b.code);
  });
}
