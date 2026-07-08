import {
  detectFundKind,
  getTodayShanghaiDate,
  normalizeFundCode,
  normalizeFundKind,
} from '../../app/holdingsLedgerCore.js';
import { getNearestTradingDayShanghai, getNextTradingDayShanghai } from '../../app/holidaysCN.js';
import { getKnownQdiiFundName } from '../../app/qdiiFundCodes.js';

function resolveTagsFromKind(kind = 'otc') {
  if (kind === 'qdii') return ['qdii', 'otc'];
  return [kind];
}

function sanitizeDecimalInput(value = '') {
  const raw = String(value || '').replace(/[^\d.]/g, '');
  const [integerPart, ...rest] = raw.split('.');
  if (!rest.length) return integerPart;
  return `${integerPart}.${rest.join('')}`;
}

function sanitizeCodeInput(value = '') {
  return String(value || '').replace(/\D/g, '').slice(0, 6);
}

export function computeOtcAutoFillContext({ kind, before3pm }) {
  if (kind === 'exchange') {
    return { confirmDate: '', price: '', hint: '' };
  }
  const today = getTodayShanghaiDate();
  const todayTrading = getNearestTradingDayShanghai(today);
  const confirmDate = before3pm ? todayTrading : getNextTradingDayShanghai(todayTrading);
  return { confirmDate, price: '', hint: '' };
}

export function updateTransactionDraftField(prev, field, value, { aggregateByCodeMap } = {}) {
  if (!prev) return prev;
  if (field === 'code') {
    const nextCode = sanitizeCodeInput(value);
    const normalizedCode = normalizeFundCode(nextCode);
    const existingName = aggregateByCodeMap?.get(normalizedCode)?.name || '';
    const knownQdiiName = getKnownQdiiFundName(normalizedCode);
    const nextName = existingName || knownQdiiName || prev.name;
    const nextKind = prev.kind && prev.kind !== 'otc' ? prev.kind : detectFundKind(nextCode);
    return { ...prev, code: nextCode, name: nextName, kind: nextKind };
  }
  if (field === 'price' || field === 'shares' || field === 'amount' || field === 'costPrice') {
    return { ...prev, [field]: sanitizeDecimalInput(value) };
  }
  if (field === 'before3pm') {
    const nextBefore3pm = Boolean(value);
    if (prev.kind === 'exchange') return { ...prev, before3pm: nextBefore3pm };
    const ctx = computeOtcAutoFillContext({ kind: prev.kind, before3pm: nextBefore3pm });
    return { ...prev, before3pm: nextBefore3pm, date: ctx.confirmDate || prev.date };
  }
  if (field === 'kind') {
    const nextKind = normalizeFundKind(value, prev.code, prev.name);
    const ctx = computeOtcAutoFillContext({ kind: nextKind, before3pm: prev.before3pm ?? true });
    const nextType = String(prev.type || 'BUY').toUpperCase() === 'SELL' ? 'SELL' : 'BUY';
    return {
      ...prev,
      kind: nextKind,
      before3pm: nextKind === 'exchange' ? false : (prev.before3pm ?? true),
      date: nextKind === 'exchange' ? prev.date : (ctx.confirmDate || prev.date),
      amount: nextKind === 'exchange' ? '' : prev.amount,
      shares: nextKind !== 'exchange' && nextType === 'BUY' ? '' : prev.shares,
      tags: resolveTagsFromKind(nextKind)
    };
  }
  return { ...prev, [field]: value };
}

export function prepareTransactionDraftForSubmit(draft = {}) {
  const code = normalizeFundCode(draft.code);
  const kind = normalizeFundKind(draft.kind, code, draft.name);
  const type = String(draft.type || '').toUpperCase() === 'SELL' ? 'SELL' : 'BUY';
  const prepared = {
    ...draft,
    code,
    kind,
    type,
    price: Number(draft.price) || 0,
    shares: Number(draft.shares) || 0,
    amount: Number(draft.amount) || 0,
    costPrice: Number(draft.costPrice) || 0
  };

  if (kind === 'exchange') {
    return { ...prepared, amount: 0 };
  }

  if (type === 'BUY') {
    return { ...prepared, shares: 0 };
  }

  return prepared;
}
