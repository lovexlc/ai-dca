import {
  normalizeFundCode,
  normalizeFundKind,
  normalizeIsoDate,
  round
} from '../../app/holdingsLedgerCore.js';

function hasMissingPrice(tx = {}) {
  return !(Number(tx?.price) > 0);
}

function isBackfillableOtcTransaction(tx = {}) {
  if (!hasMissingPrice(tx)) return false;
  const type = String(tx?.type || '').toUpperCase();
  if (type !== 'BUY' && type !== 'SELL') return false;
  const code = normalizeFundCode(tx?.code || '');
  const kind = normalizeFundKind(tx?.kind, code, tx?.name || '');
  if (!code || kind === 'exchange') return false;
  if (type === 'BUY') return Number(tx?.amount) > 0 || Number(tx?.shares) > 0;
  return Number(tx?.costPrice) <= 0 && Number(tx?.shares) > 0;
}

function navValue(item = {}) {
  const value = Number(item?.nav ?? item?.unitNav ?? item?.latestNav ?? item?.value);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function navDate(item = {}) {
  return normalizeIsoDate(item?.date || item?.navDate || item?.day || '');
}

function findNavOnOrBefore(items = [], targetDate = '') {
  let picked = null;
  for (const item of Array.isArray(items) ? items : []) {
    const date = navDate(item);
    const nav = navValue(item);
    if (!date || date > targetDate || !(nav > 0)) continue;
    if (!picked || date > picked.date) picked = { date, nav };
  }
  return picked;
}

export function getOtcNavBackfillRequest(transactions = [], { todayDate = '' } = {}) {
  const pending = [];
  const codes = new Set();
  let from = '';
  let latestTransactionDate = '';

  for (const tx of Array.isArray(transactions) ? transactions : []) {
    if (!isBackfillableOtcTransaction(tx)) continue;
    const code = normalizeFundCode(tx?.code || '');
    const date = normalizeIsoDate(tx?.date || '');
    if (!/^\d{6}$/.test(code) || !date) continue;
    pending.push({ tx, code, date });
    codes.add(code);
    if (!from || date < from) from = date;
    if (!latestTransactionDate || date > latestTransactionDate) latestTransactionDate = date;
  }

  const normalizedToday = normalizeIsoDate(todayDate || '');
  const to = normalizedToday && normalizedToday > latestTransactionDate
    ? normalizedToday
    : latestTransactionDate;
  return {
    pending,
    codes: [...codes].sort(),
    from,
    to
  };
}

export function backfillOtcTransactionNav(transactions = [], navByCode = {}) {
  let changed = false;
  let filledCount = 0;
  const nextTransactions = (Array.isArray(transactions) ? transactions : []).map((tx) => {
    if (!isBackfillableOtcTransaction(tx)) return tx;
    const code = normalizeFundCode(tx?.code || '');
    const date = normalizeIsoDate(tx?.date || '');
    const match = findNavOnOrBefore(navByCode?.[code], date);
    if (!match) return tx;

    const existingShares = Number(tx?.shares) || 0;
    const amount = Number(tx?.amount) || 0;
    const nextShares = String(tx?.type || '').toUpperCase() === 'BUY'
      && amount > 0
      ? round(amount / match.nav, 4)
      : existingShares;
    const nextAmount = amount > 0
      ? amount
      : (nextShares > 0 ? round(match.nav * nextShares, 2) : 0);
    const nextPrice = round(match.nav, 4);
    if (nextPrice === (Number(tx?.price) || 0)
      && nextShares === existingShares
      && nextAmount === amount) {
      return tx;
    }
    changed = true;
    filledCount += 1;
    return {
      ...tx,
      price: nextPrice,
      shares: nextShares,
      amount: nextAmount
    };
  });

  return {
    transactions: changed ? nextTransactions : transactions,
    changed,
    filledCount
  };
}

export const __internals = {
  findNavOnOrBefore,
  isBackfillableOtcTransaction,
  navDate,
  navValue
};
