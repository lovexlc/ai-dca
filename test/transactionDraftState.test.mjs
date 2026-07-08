import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeTransaction } from '../src/app/holdingsLedgerCore.js';
import {
  prepareTransactionDraftForSubmit,
  updateTransactionDraftField
} from '../src/pages/holdings/transactionDraftState.js';

test('场外/QDII 买入提交时忽略隐藏份额并按金额和净值推导', () => {
  const prepared = prepareTransactionDraftForSubmit({
    code: '161130',
    name: '易方达纳斯达克100ETF联接(QDII)A',
    kind: 'qdii',
    type: 'BUY',
    date: '2025-10-13',
    price: '3.9936',
    shares: '3.9936',
    amount: '1580'
  });

  assert.equal(prepared.shares, 0);
  assert.equal(prepared.amount, 1580);

  const normalized = normalizeTransaction(prepared);
  assert.equal(normalized.amount, 1580);
  assert.equal(normalized.price, 3.9936);
  assert.equal(normalized.shares, 395.633);
});

test('场内买入提交时忽略隐藏金额并按价格和份额推导', () => {
  const prepared = prepareTransactionDraftForSubmit({
    code: '513100',
    name: '纳指ETF',
    kind: 'exchange',
    type: 'BUY',
    date: '2026-07-08',
    price: '2',
    shares: '100',
    amount: '9999'
  });

  assert.equal(prepared.amount, 0);

  const normalized = normalizeTransaction(prepared);
  assert.equal(normalized.shares, 100);
  assert.equal(normalized.amount, 200);
});

test('切换交易场所时清理不适用的金额或份额草稿字段', () => {
  const otcDraft = updateTransactionDraftField({
    code: '161130',
    name: '易方达纳斯达克100ETF联接(QDII)A',
    kind: 'exchange',
    type: 'BUY',
    date: '2026-07-08',
    price: '4',
    shares: '100',
    amount: ''
  }, 'kind', 'qdii');

  assert.equal(otcDraft.kind, 'qdii');
  assert.equal(otcDraft.shares, '');

  const exchangeDraft = updateTransactionDraftField({
    code: '513100',
    name: '纳指ETF',
    kind: 'otc',
    type: 'BUY',
    date: '2026-07-08',
    price: '2',
    shares: '',
    amount: '1000'
  }, 'kind', 'exchange');

  assert.equal(exchangeDraft.kind, 'exchange');
  assert.equal(exchangeDraft.amount, '');
});
