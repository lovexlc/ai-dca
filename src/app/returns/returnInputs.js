import { normalizeTransaction, detectQdiiByName } from '../holdingsLedgerBasics.js';

export const cents = (value) => Math.round(value * 100);
export const money = (value) => cents(value) / 100;
export const assetKey = (tx) => `${tx.kind}:${tx.venue || ''}:${tx.code}`;
export const scopeKinds = (scope) =>
  Array.isArray(scope)
    ? scope
    : scope === 'mixed'
      ? ['exchange', 'otc', 'qdii']
      : scope === 'otc+qdii'
        ? ['otc', 'qdii']
        : [scope];
export const inScope = (tx, scope) => scopeKinds(scope).includes(tx.kind);
export const validDate = (date) =>
  typeof date === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(date) &&
  Number.isFinite(Date.parse(date)) &&
  new Date(date).toISOString().slice(0, 10) === date;
export const daysBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / 86400000;
export const previousDate = (date) => new Date(Date.parse(date) - 86400000).toISOString().slice(0, 10);
export const issue = (reason, tx = {}, severity = 'error') => ({
  reason,
  severity,
  transactionId: tx.id,
  code: tx.code
});

// No generated IDs or clock dependencies: missing identity remains an explicit error.
export function normalizeReturnInputs(input = {}) {
  const diagnostics = [];
  const transactions = (input.transactions || []).map((raw, index) => {
    const date =
      typeof raw.date === 'string' &&
      /T.*(?:Z|[+-]\d{2}:?\d{2})$/.test(raw.date) &&
      Number.isFinite(Date.parse(raw.date))
        ? new Date(Date.parse(raw.date) + 8 * 3600000).toISOString().slice(0, 10)
        : raw.date;
    const tx = normalizeTransaction({ ...raw, date, id: raw.id || `missing-id-${index}` });
    tx.venue = String(raw.venue || '');
    tx.date = typeof date === 'string' ? date : '';
    tx.shares = Number(String(raw.shares ?? '').replace(/[,\s¥$]/g, ''));
    tx.pending = raw.pending === true || raw.status === 'pending' || raw.confirmed === false;
    if (tx.pending) diagnostics.push(issue('pending_transaction', tx));
    if (raw.confirmationDateUnknown === true) diagnostics.push(issue('unknown_confirmation_date', tx));
    if (raw.kind && !['exchange', 'otc', 'qdii'].includes(raw.kind))
      diagnostics.push({ ...issue('invalid_kind', tx), unassignable: true });
    if (raw.currency && raw.currency !== 'CNY') diagnostics.push(issue('unsupported_currency', tx));
    if (raw.hasUnrecordedDistributions || raw.hasUnrecordedShareAdjustments)
      diagnostics.push(issue('missing_distribution_or_share_adjustment', tx));
    if (tx.kind !== 'exchange' && detectQdiiByName(tx.name, tx.code)) tx.kind = 'qdii';
    if (!raw.id) diagnostics.push(issue('missing_id', tx));
    if (!['BUY', 'SELL'].includes(raw.type)) diagnostics.push(issue('invalid_type', tx));
    if (!validDate(tx.date)) diagnostics.push(issue('missing_or_invalid_date', tx));
    if (!/^\d{6}$/.test(tx.code)) diagnostics.push(issue('invalid_code', tx));
    if (!Number.isFinite(tx.shares) || tx.shares <= 0 || tx.amount <= 0)
      diagnostics.push(issue('unconfirmed_or_invalid_transaction', tx));
    for (const field of ['amount', 'price', 'shares']) {
      if (
        raw[field] !== undefined &&
        raw[field] !== null &&
        raw[field] !== '' &&
        (!Number.isFinite(Number(String(raw[field]).replace(/[,\s¥$]/g, ''))) ||
          Number(String(raw[field]).replace(/[,\s¥$]/g, '')) <= 0)
      )
        diagnostics.push(issue(`invalid_${field}`, tx));
    }
    tx.amountSource =
      Number(String(raw.amount ?? '').replace(/[,\s¥$]/g, '')) > 0 ? 'amount' : 'price_times_shares';
    tx.amountDifference = tx.price > 0 ? money(tx.amount - tx.price * tx.shares) : null;
    diagnostics.push({ ...issue('fees_unknown', tx, 'warning'), amountDifference: tx.amountDifference });
    tx.confirmed = !diagnostics.some((d) => d.transactionId === tx.id && d.severity === 'error');
    return tx;
  });
  const seen = new Set();
  for (const tx of transactions) {
    if (seen.has(tx.id)) diagnostics.push(issue('duplicate_id', tx));
    seen.add(tx.id);
  }
  transactions.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.type === 'BUY' ? 0 : 1) - (b.type === 'BUY' ? 0 : 1) ||
      a.id.localeCompare(b.id)
  );
  diagnostics.sort(
    (a, b) =>
      String(a.transactionId || '').localeCompare(String(b.transactionId || '')) ||
      a.reason.localeCompare(b.reason)
  );
  return { ...input, scope: input.scope || 'exchange', transactions, diagnostics };
}

export function validateReturnInputs(input) {
  const diagnostics = [...(input.diagnostics || [])];
  if (!validDate(input.from) || !validDate(input.to) || input.from > input.to)
    diagnostics.push(issue('invalid_window'));
  if (!scopeKinds(input.scope).every((kind) => ['exchange', 'otc', 'qdii'].includes(kind)))
    diagnostics.push(issue('invalid_scope'));
  return { valid: !diagnostics.some((d) => d.severity === 'error'), diagnostics };
}