import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateGroupReturn as calc } from '../../src/app/returns/groupReturns.js';
import { base, tx } from './fixtures.mjs';
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const invariant = (r) => close(r.endValue, r.startValue + r.netInvestment + r.profit);
const regroup = (kind) => ({
  ...base,
  scope: kind,
  transactions: base.transactions.map((t) => ({
    ...t,
    kind,
    code: t.code === '510001' ? '000002' : '000003'
  })),
  pricesByCode: { '000002': base.pricesByCode['510001'], '000003': base.pricesByCode['510002'] }
});

test('V2 equal switches yield 21% for every scope regardless of pair fields', () => {
  for (const scope of ['exchange', 'otc', 'qdii', 'otc+qdii', 'mixed']) {
    const input = scope === 'exchange' ? base : regroup('otc');
    for (const pair of [undefined, 'absent', 'initial', 'buy']) {
      const r = calc({
        ...input,
        scope,
        transactions: input.transactions.map((t) => ({
          ...t,
          kind: scope === 'qdii' ? 'qdii' : t.kind,
          switchPairId: pair
        }))
      });
      assert.equal(r.netInvestment, 0);
      assert.equal(r.profit, 210);
      assert.equal(r.denominator, 1000);
      close(r.returnRate, 0.21);
      invariant(r);
    }
  }
});

test('V2 first-day funding, one-day funding, final-day liquidation and empty portfolio', () => {
  const input = {
    ...base,
    transactions: [tx('new', '510002', 'BUY', base.from, 1000)],
    pricesByCode: {
      510002: [
        { date: base.to, price: 11 },
        { date: base.from, price: 10 }
      ]
    }
  };
  const r = calc(input);
  assert.equal(r.profit, 100);
  close(r.returnRate, 100 / ((1000 * 30) / 31));
  invariant(r);
  const single = calc({ ...input, to: base.from });
  assert.equal(single.profit, 0);
  assert.equal(single.returnRate, null);
  assert.equal(single.denominator, 0);
  const sold = calc({
    ...base,
    transactions: [base.transactions[0], { ...base.transactions[1], date: base.to }]
  });
  close(sold.returnRate, 0.1);
  assert.equal(sold.endValue, 0);
  invariant(sold);
  const empty = calc({ ...base, scope: 'mixed', transactions: [] });
  assert.equal(empty.profit, 0);
  assert.equal(empty.returnRate, null);
  invariant(empty);
});

const crossGroup = {
  ...base,
  transactions: [
    base.transactions[0],
    base.transactions[1],
    tx('other', '000002', 'BUY', '2025-01-15', 1100, 100, { kind: 'otc' })
  ],
  pricesByCode: { ...base.pricesByCode, '000002': [{ date: base.to, price: 12.1 }] }
};
const reconcile = (input) => {
  const e = calc({ ...input, scope: 'exchange' });
  const o = calc({ ...input, scope: 'otc+qdii' });
  const m = calc({ ...input, scope: 'mixed' });
  for (const r of [e, o, m]) invariant(r);
  for (const field of ['profit', 'netInvestment', 'denominator']) close(m[field], e[field] + o[field]);
  return { e, o, m };
};
test('V2 cross-group trades cancel only in mixed, with independent Dietz denominators', () => {
  const { e, o, m } = reconcile(crossGroup);
  assert.equal(e.netInvestment, -1100);
  assert.equal(e.profit, 100);
  close(e.denominator, 1000 - (1100 * 16) / 31);
  assert.equal(o.netInvestment, 1100);
  assert.equal(o.profit, 110);
  close(o.denominator, (1100 * 16) / 31);
  close(m.returnRate, 0.21);
});
test('V2 mixed rejects end-value weighting and works with undefined subgroup rate', () => {
  const input = {
    ...base,
    transactions: [
      base.transactions[0],
      tx('o0', '000002', 'BUY', '2024-12-01', 1000),
      tx('o1', '000002', 'BUY', base.to, 1000)
    ],
    pricesByCode: {
      510001: [
        { date: '2024-12-31', price: 10 },
        { date: base.to, price: 11 }
      ],
      '000002': [
        { date: '2024-12-31', price: 10 },
        { date: base.to, price: 11 }
      ]
    }
  };
  const { e, o, m } = reconcile(input);
  close(e.returnRate, 0.1);
  close(o.returnRate, 0.2);
  close(m.returnRate, 0.15);
  assert.notEqual(m.returnRate, (e.returnRate * e.endValue + o.returnRate * o.endValue) / m.endValue);
  const endOnly = { ...input, transactions: input.transactions.filter((t) => t.id !== 'o0') };
  const results = reconcile(endOnly);
  assert.equal(results.o.returnRate, null);
  close(results.m.returnRate, 0.2);
});

const aligned = {
  from: '2025-01-01',
  to: '2025-01-31',
  windowMode: 'current',
  transactions: [
    tx('e', '510001', 'BUY', '2024-12-01', 1000),
    tx('o', '000002', 'BUY', '2024-12-01', 100, 100, { kind: 'otc' }),
    tx('q', '000003', 'BUY', '2024-12-01', 100, 100, { kind: 'qdii' }),
    tx('late', '510001', 'BUY', '2025-01-31', 1000)
  ],
  pricesByCode: {
    510001: [
      { date: '2024-12-31', price: 10 },
      { date: '2025-01-30', price: 11 },
      { date: '2025-01-31', price: 12 }
    ],
    '000002': [
      { navDate: '2024-12-31', price: 1 },
      { navDate: '2025-01-30', price: 1.1 },
      { navDate: '2025-01-31', price: 1.2 }
    ],
    '000003': [
      { navDate: '2024-12-31', price: 1 },
      { navDate: '2025-01-30', publishedAt: '2025-01-31', price: 1.1 }
    ]
  }
};

test('V2 QDII uses owned NAV date without a second lag in historical windows', () => {
  const r = calc({ ...aligned, scope: 'qdii', windowMode: 'historical', to: '2025-01-30' });
  assert.equal(r.effectiveWindow.to, '2025-01-30');
  assert.equal(r.profit, 10);
  assert.equal(r.boundaryValuations.end[0].priceDate, '2025-01-30');
});
test('V2 current OTC and mixed use common cutoff and exclude later exchange trades', () => {
  const o = calc({ ...aligned, scope: 'otc+qdii' });
  const m = calc({ ...aligned, scope: 'mixed' });
  for (const r of [o, m]) {
    assert.equal(r.effectiveWindow.to, '2025-01-30');
    assert.equal(r.netInvestment, 0);
    invariant(r);
  }
  assert.equal(m.endValue, 1320);
  const e = calc({ ...aligned, scope: 'exchange', to: m.effectiveWindow.to });
  close(m.profit, e.profit + o.profit);
  close(m.denominator, e.denominator + o.denominator);
  assert.equal(calc({ ...aligned, scope: 'exchange' }).effectiveWindow.to, '2025-01-31');
});
test('V2 new funds near cutoff are considered, even if absent from earlier holdings', () => {
  const r = calc({
    ...aligned,
    scope: 'mixed',
    transactions: [
      ...aligned.transactions,
      tx('near', '000004', 'BUY', '2025-01-31', 100, 100, { kind: 'otc' })
    ],
    pricesByCode: { ...aligned.pricesByCode, '000004': [{ navDate: '2025-01-29', price: 1 }] }
  });
  assert.equal(r.effectiveWindow.to, '2025-01-29');
  assert.equal(r.returnRate, null); // existing funds lack that boundary's NAV
});
test('V2 historical missing NAV fails, verified closures allow carry-forward, no common window fails', () => {
  const input = { ...aligned, scope: 'qdii', windowMode: 'historical' };
  assert.equal(calc(input).reason, 'stale_price');
  const closure = calc({ ...input, closedDatesByAsset: { 'qdii::000003': ['2025-01-31'] } });
  assert.equal(closure.profit, 10);
  assert.equal(closure.effectiveWindow.to, '2025-01-31');
  assert.equal(closure.boundaryValuations.end[0].priceDate, '2025-01-30');
  const none = calc({ ...aligned, scope: 'qdii', from: '2025-01-31' });
  assert.equal(none.reason, 'no_calculable_window');
  assert.equal(none.profit, null);
});
test('V2 missing start/end price never exposes partial totals or profit', () => {
  for (const code of ['510001', '000002']) {
    const r = calc({
      ...crossGroup,
      scope: 'mixed',
      pricesByCode: { ...crossGroup.pricesByCode, [code]: [] }
    });
    assert.equal(r.returnRate, null);
    assert.equal(r.profit, null);
    assert.equal(r.reason, 'missing_price');
  }
});
test('V2 pending/unknown confirmation, raw missing shares and invalid kinds block affected windows', () => {
  for (const [extra, reason] of [
    [{ pending: true }, 'pending_transaction'],
    [{ status: 'pending' }, 'pending_transaction'],
    [{ confirmed: false }, 'pending_transaction'],
    [{ confirmationDateUnknown: true }, 'unknown_confirmation_date'],
    [{ shares: undefined }, 'unconfirmed_or_invalid_transaction'],
    [{ kind: 'unknown' }, 'invalid_kind'],
    [{ currency: 'USD' }, 'unsupported_currency']
  ]) {
    const r = calc({
      ...regroup('otc'),
      transactions: regroup('otc').transactions.map((t) => (t.id === 'buy' ? { ...t, ...extra } : t))
    });
    assert.equal(r.returnRate, null);
    assert.equal(r.profit, null);
    assert.ok(
      r.diagnostics.some((d) => d.reason === reason),
      reason
    );
  }
  const future = calc({
    ...base,
    transactions: [
      ...base.transactions,
      tx('future', '510002', 'SELL', '2025-02-01', 10, 1, { pending: true })
    ]
  });
  close(future.returnRate, 0.21);
});
test('V2 unrelated scope errors do not block exchange, unassignable facts do', () => {
  const extra = tx('bad', '000002', 'BUY', '2025-01-02', -1, 0, { kind: 'otc' });
  close(calc({ ...base, transactions: [...base.transactions, extra, { ...extra }] }).returnRate, 0.21);
  assert.equal(
    calc({ ...base, transactions: [...base.transactions, { ...extra, kind: 'unknown' }] }).returnRate,
    null
  );
});
test('V2 high precision shares are preserved and explicit amounts need no trade price', () => {
  const r = calc({
    ...base,
    transactions: [tx('precise', '510001', 'BUY', '2024-12-01', 1000, 100.000001, { price: undefined })],
    pricesByCode: {
      510001: [
        { date: '2024-12-31', price: 10000 },
        { date: base.to, price: 11000 }
      ]
    }
  });
  assert.equal(r.startValue, 1000000.01);
  assert.equal(r.endValue, 1100000.01);
  invariant(r);
});

test('V2 verified expected disclosure rejects abnormal current NAV gaps', () => {
  const r = calc({ ...aligned, scope: 'qdii', expectedNavDatesByAsset: { 'qdii::000003': '2025-01-31' } });
  assert.equal(r.reason, 'missing_nav_disclosure');
  assert.equal(r.returnRate, null);
});
test('V2 cutoff rechecks funds sold after the common date', () => {
  const r = calc({
    ...aligned,
    scope: 'mixed',
    transactions: [
      ...aligned.transactions,
      tx('exit', '000002', 'SELL', '2025-01-31', 120, 100, { kind: 'otc' })
    ],
    pricesByCode: {
      ...aligned.pricesByCode,
      '000002': [
        { navDate: '2024-12-31', price: 1 },
        { navDate: '2025-01-29', price: 1.05 }
      ],
      '000003': [...aligned.pricesByCode['000003'], { navDate: '2025-01-29', price: 1.04 }],
      510001: [...aligned.pricesByCode['510001'], { date: '2025-01-29', price: 10.5 }]
    }
  });
  assert.equal(r.effectiveWindow.to, '2025-01-29');
  assert.equal(r.endValue, 1259);
  assert.equal(r.netInvestment, 0);
  invariant(r);
});
test('V2 accumulated or invalid NAV never completes a historical valuation', () => {
  for (const metadata of [{ accumulated: true }, { quality: 'invalid' }, { quality: 'stale' }]) {
    const input = regroup('otc');
    const r = calc({
      ...input,
      pricesByCode: { ...input.pricesByCode, '000003': [{ navDate: base.to, price: 12.1, ...metadata }] }
    });
    assert.equal(r.reason, 'unreliable_price');
    assert.equal(r.profit, null);
  }
});

test('V2 absent dates return diagnostics rather than throwing', () => {
  for (const date of [undefined, null, 123]) {
    const r = calc({
      ...base,
      transactions: base.transactions.map((t) => (t.id === 'initial' ? { ...t, date } : t))
    });
    assert.equal(r.returnRate, null);
    assert.ok(r.diagnostics.some((d) => d.reason === 'missing_or_invalid_date'));
  }
});
test('V2 current invalid latest NAV does not silently roll back to an older valid price', () => {
  const r = calc({
    ...aligned,
    scope: 'qdii',
    pricesByCode: {
      ...aligned.pricesByCode,
      '000003': [...aligned.pricesByCode['000003'], { navDate: base.to, price: 1.2, adjusted: true }]
    }
  });
  assert.equal(r.reason, 'adjusted_price_unsupported');
  assert.equal(r.profit, null);
});