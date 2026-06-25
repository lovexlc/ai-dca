import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addToQuickHistory,
  buildQuickTransactionDraft,
  clearQuickHistory,
  getRegularInvestmentSuggestions,
  saveLastTransaction
} from '../src/pages/holdings/holdingsQuickTransaction.js';

function createStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    }
  };
}

test.beforeEach(() => {
  globalThis.window = { localStorage: createStorage() };
  clearQuickHistory();
});

test.afterEach(() => {
  delete globalThis.window;
});

test('quick fill detects exchange fund and fills shares instead of hidden amount', () => {
  const draft = buildQuickTransactionDraft({
    code: '513100',
    name: '纳指 ETF',
    type: 'BUY',
    amount: 1000,
    shares: 950,
    price: 1.0526
  });

  assert.equal(draft.kind, 'exchange');
  assert.equal(draft.amount, '');
  assert.equal(draft.shares, '950');
  assert.equal(draft.price, '1.0526');
});

test('quick fill detects OTC fund and fills amount for buy', () => {
  const draft = buildQuickTransactionDraft({
    code: '888888',
    name: '场外基金',
    type: 'BUY',
    amount: 1000,
    shares: 650.6189,
    price: 1.536
  });

  assert.equal(draft.kind, 'otc');
  assert.equal(draft.amount, '1000');
  assert.equal(draft.shares, '');
  assert.equal(draft.price, '');
});

test('regular investment suggestions preserve exchange kind and suggested shares', () => {
  addToQuickHistory('513100', '纳指 ETF', 'BUY', 1000, {
    kind: 'exchange',
    shares: 900,
    price: 1.1111
  });
  addToQuickHistory('513100', '纳指 ETF', 'BUY', 1200, {
    kind: 'exchange',
    shares: 1000,
    price: 1.2
  });

  const [suggestion] = getRegularInvestmentSuggestions();
  assert.equal(suggestion.code, '513100');
  assert.equal(suggestion.kind, 'exchange');
  assert.equal(suggestion.suggestedShares, 950);

  const draft = buildQuickTransactionDraft({ ...suggestion, type: 'BUY' });
  assert.equal(draft.kind, 'exchange');
  assert.equal(draft.amount, '');
  assert.equal(draft.shares, '950');
});

test('last transaction persists kind and can be repeated as exchange shares', () => {
  saveLastTransaction({
    code: '513100',
    name: '纳指 ETF',
    type: 'BUY',
    kind: 'exchange',
    amount: 1000,
    shares: 900,
    price: 1.1111
  });

  const raw = window.localStorage.getItem('holdings:lastTransaction');
  const lastTx = JSON.parse(raw);
  assert.equal(lastTx.kind, 'exchange');
  assert.equal(lastTx.shares, 900);

  const draft = buildQuickTransactionDraft(lastTx);
  assert.equal(draft.kind, 'exchange');
  assert.equal(draft.amount, '');
  assert.equal(draft.shares, '900');
});
