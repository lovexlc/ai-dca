import { test } from 'node:test';
import assert from 'node:assert/strict';
import { base, tx } from './fixtures.mjs';
import { calculateGroupReturn } from '../../src/app/returns/groupReturns.js';
import { normalizeReturnInputs, validateReturnInputs } from '../../src/app/returns/returnInputs.js';
import {
  buildSharesTimeline,
  valueAtBoundary,
  resolveEffectiveWindow
} from '../../src/app/returns/returnValuation.js';
import { resolveSwitchPairs, buildSwitchBridgeTimeline } from '../../src/app/returns/returnCashFlows.js';
import { calculateModifiedDietz, calculateTwr, solveXirr } from '../../src/app/returns/returnMath.js';
import { aggregateByCode, summarizePortfolio } from '../../src/app/holdingsLedgerCore.js';
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
const cross = () => ({
  ...base,
  transactions: base.transactions.map((t) =>
    t.id === 'sell' ? { ...t, switchPairId: 'buy' } : t.id === 'buy' ? { ...t, date: '2025-01-16' } : t
  )
});

test('equal same-day switch: profit 210, Dietz 21%, audit and immutable inputs', () => {
  const before = JSON.stringify(base);
  const result = calculateGroupReturn(base);
  assert.equal(result.netInvestment, 0);
  assert.equal(result.offsetAmount, 1100);
  assert.equal(result.profit, 210);
  close(result.returnRate, 0.21);
  assert.equal(result.method, 'modifiedDietz');
  assert.equal(result.startMarketValue, 1000);
  assert.equal(JSON.stringify(base), before);
  const agg = aggregateByCode(base.transactions, { 510002: { price: 12.1 } }, { todayDate: '2025-01-31' });
  assert.equal(agg.find((h) => h.code === '510002').marketValue, result.endMarketValue);
  assert.equal(summarizePortfolio(agg).marketValue, result.endMarketValue);
});
test('unequal switch and input permutation, exact end-of-day weight', () => {
  const input = {
    ...base,
    transactions: [
      base.transactions[0],
      tx('sell', '510001', 'SELL', '2025-01-15', 1000),
      tx('buy', '510002', 'BUY', '2025-01-15', 1200)
    ]
  };
  const a = calculateGroupReturn(input);
  const b = calculateGroupReturn({ ...input, transactions: [...input.transactions].reverse() });
  assert.equal(a.netInvestment, 200);
  assert.equal(a.offsetAmount, 1000);
  close(a.denominator, 1000 + (200 * 16) / 31);
  close(a.returnRate, 10 / a.denominator);
  assert.deepEqual(a, b);
});
test('cross-day one-sided/bidirectional pairs, bridge, outside-window legs', () => {
  const input = cross();
  const result = calculateGroupReturn(input);
  assert.equal(result.netInvestment, 0);
  close(result.returnRate, 0.21);
  const bridge = buildSwitchBridgeTimeline(
    resolveSwitchPairs(normalizeReturnInputs(input).transactions).pairs
  );
  assert.equal(bridge.valueAt('2025-01-15'), 1100);
  assert.equal(bridge.valueAt('2025-01-16'), 0);
  const interim = calculateGroupReturn({ ...input, to: '2025-01-15' });
  assert.equal(interim.endMarketValue, 0);
  assert.equal(interim.endValue, 1100);
  assert.equal(interim.profit, 100);
  close(interim.returnRate, 0.1);
  const late = calculateGroupReturn({ ...input, from: '2025-01-16' });
  assert.equal(late.startBridgeValue, 1100);
  assert.equal(late.netInvestment, 0);
  assert.equal(late.profit, 110);
  const both = calculateGroupReturn({
    ...input,
    transactions: input.transactions.map((t) => (t.id === 'buy' ? { ...t, switchPairId: 'sell' } : t))
  });
  assert.equal(both.switchPairs.length, 1);
  assert.equal(both.netInvestment, 0);
});
test('cross-day residuals are external group flows', () => {
  const input = cross();
  input.transactions[2] = { ...input.transactions[2], amount: 1300, price: 13 };
  const result = calculateGroupReturn(input);
  assert.equal(result.netInvestment, 200);
  assert.equal(result.profit, 10);
});
test('cross-group paired legs cannot cancel even with another same-day buy', () => {
  const input = {
    ...base,
    transactions: [
      base.transactions[0],
      { ...base.transactions[1], switchPairId: 'other' },
      tx('other', '000001', 'BUY', '2025-01-15', 1100, 100, { kind: 'qdii' }),
      base.transactions[2]
    ]
  };
  const result = calculateGroupReturn(input);
  assert.equal(result.offsetAmount, 0);
  assert.equal(result.endBridgeValue, 0);
  const onlyExit = calculateGroupReturn({ ...input, transactions: input.transactions.slice(0, 3) });
  assert.equal(onlyExit.netInvestment, -1100);
  assert.equal(onlyExit.profit, 100);
});
test('dangling, conflicting, duplicate, reversed, unconfirmed pairs fail explicitly', () => {
  for (const transactions of [
    cross().transactions.map((t) => (t.id === 'sell' ? { ...t, switchPairId: 'absent' } : t)),
    [...cross().transactions, tx('third', '510003', 'BUY', '2025-01-17', 100, 10, { switchPairId: 'sell' })],
    [...cross().transactions, cross().transactions[1]],
    cross().transactions.map((t) => (t.id === 'buy' ? { ...t, date: '2025-01-14' } : t)),
    cross().transactions.map((t) => (t.id === 'buy' ? { ...t, shares: 0 } : t))
  ]) {
    const result = calculateGroupReturn({ ...base, transactions });
    assert.equal(result.returnRate, null);
    assert.ok(result.reason);
  }
});
test('missing dates, prices, overselling, invalid type and negative amount never become zero rates', () => {
  for (const input of [
    { ...base, pricesByCode: {} },
    { ...base, transactions: base.transactions.map((t) => (t.id === 'initial' ? { ...t, date: '' } : t)) },
    { ...base, transactions: base.transactions.map((t) => (t.id === 'sell' ? { ...t, shares: 200 } : t)) },
    { ...base, transactions: base.transactions.map((t) => ({ ...t, type: 'INVALID' })) },
    { ...base, transactions: base.transactions.map((t) => ({ ...t, amount: -100 })) }
  ]) {
    const result = calculateGroupReturn(input);
    assert.equal(result.returnRate, null);
    assert.ok(result.diagnostics.some((d) => d.severity === 'error'));
  }
});
test('no trades, liquidation, first-day position, empty portfolio and denominator guards', () => {
  const hold = {
    ...base,
    transactions: [base.transactions[0]],
    pricesByCode: {
      510001: [
        { date: '2024-12-31', price: 10 },
        { date: '2025-01-31', price: 11 }
      ]
    }
  };
  close(calculateGroupReturn(hold).returnRate, 0.1);
  const sold = calculateGroupReturn({ ...base, transactions: base.transactions.slice(0, 2) });
  assert.equal(sold.endValue, 0);
  assert.equal(sold.profit, 100);
  const fresh = calculateGroupReturn({
    ...hold,
    transactions: [tx('new', '510001', 'BUY', '2025-01-01', 1000)]
  });
  assert.equal(fresh.startValue, 0);
  close(fresh.denominator, (1000 * 30) / 31);
  assert.equal(calculateGroupReturn({ ...base, transactions: [] }).reason, 'non_positive_denominator');
  assert.equal(
    calculateModifiedDietz({
      from: '2025-01-01',
      to: '2025-01-31',
      startValue: 10,
      endValue: 0,
      cashFlows: [{ date: '2025-01-02', amount: -100 }]
    }).returnRate,
    null
  );
});
test('weekend prior prices accepted, future and stale prices rejected, actual dates audited', () => {
  const input = { ...base, to: '2025-02-02' };
  assert.equal(calculateGroupReturn(input).endMarketValue, 1210);
  assert.equal(calculateGroupReturn(input).boundaryValuations.end[0].priceDate, '2025-01-31');
  assert.equal(calculateGroupReturn({ ...input, to: '2025-02-15' }).reason, 'stale_price');
  assert.equal(
    calculateGroupReturn({
      ...base,
      pricesByCode: { ...base.pricesByCode, 510002: [{ date: '2025-02-01', price: 99 }] }
    }).reason,
    'missing_price'
  );
  assert.equal(
    calculateGroupReturn({
      ...base,
      pricesByCode: { ...base.pricesByCode, 510002: [{ date: '2025-01-31', price: 12.1, adjusted: true }] }
    }).reason,
    'adjusted_price_unsupported'
  );
});
test('same code different venues uses independent shares and valuation', () => {
  const transactions = [
    tx('a', '510001', 'BUY', '2024-12-01', 100, 10, { venue: 'one' }),
    tx('b', '510001', 'BUY', '2024-12-01', 200, 20, { venue: 'two' })
  ];
  const timeline = buildSharesTimeline(normalizeReturnInputs({ transactions }).transactions).timeline;
  const pricesByCode = {
    'exchange:one:510001': [{ date: '2024-12-31', price: 11 }],
    'exchange:two:510001': [{ date: '2024-12-31', price: 12 }]
  };
  assert.equal(valueAtBoundary({ timeline, date: '2024-12-31', pricesByCode }).marketValue, 350);
});
test('QDII recognition and amount discrepancy retained, validation rejects malformed windows', () => {
  const result = normalizeReturnInputs({
    ...base,
    transactions: [
      tx('q', '000001', 'BUY', '2024-12-01', 110, 10, { kind: 'otc', name: '海外QDII', price: 10 })
    ]
  });
  assert.equal(result.transactions[0].kind, 'qdii');
  assert.equal(result.transactions[0].amountDifference, 10);
  assert.equal(validateReturnInputs({ ...result, from: '2025-02-30' }).valid, false);
  assert.equal(resolveEffectiveWindow(base).window.startValuationDate, '2024-12-31');
});
test('TWR end-of-day flows compound 10% and 10%, sparse valuations fail', () => {
  const valuations = [
    { date: '2025-01-01', value: 1000 },
    { date: '2025-01-02', value: 1600 },
    { date: '2025-01-03', value: 1760 }
  ];
  close(calculateTwr({ valuations, cashFlows: [{ date: '2025-01-02', amount: 500 }] }).returnRate, 0.21);
  assert.equal(calculateTwr({ valuations: [valuations[0], valuations[2]] }).returnRate, null);
});
test('XIRR positive, negative, intermediate, multiple roots, tangent root and invalid states', () => {
  const flows = (amounts) =>
    amounts.map((amount, i) => ({ date: ['2023-01-01', '2024-01-01', '2024-12-31'][i], amount }));
  close(solveXirr(flows([-1000, 1100])).returnRate, 0.1);
  close(solveXirr(flows([-1000, 900])).returnRate, -0.1);
  const middle = solveXirr(flows([-1000, -500, 1760]));
  close(middle.returnRate, 0.1);
  assert.ok(Math.abs(middle.residual) < 1e-7);
  assert.equal(solveXirr(flows([-100, 230, -132])).reason, 'multiple_roots');
  close(solveXirr(flows([-100, 220, -121])).returnRate, 0.1);
  assert.equal(solveXirr(flows([-100, 10, -100])).returnRate, null);
  assert.equal(solveXirr(flows([100, 110])).reason, 'missing_positive_or_negative_flow');
  assert.equal(
    solveXirr([
      { date: '2025-01-01', amount: -100 },
      { date: '2025-01-01', amount: 110 }
    ]).reason,
    'zero_duration'
  );
});
test('invalid outside-window counterpart cannot create a trusted bridge', () => {
  const input = cross();
  input.to = '2025-01-15';
  input.transactions[2] = { ...input.transactions[2], amount: -1100 };
  const result = calculateGroupReturn(input);
  assert.equal(result.returnRate, null);
  assert.equal(result.reason, 'invalid_or_ambiguous_switch_pair');
});
test('timestamp dates use Shanghai, missing IDs are deterministic errors', () => {
  const raw = { transactions: [tx('', '510001', 'BUY', '2024-12-31T17:00:00Z', 100)] };
  const a = normalizeReturnInputs(raw);
  const b = normalizeReturnInputs(raw);
  assert.deepEqual(a, b);
  assert.equal(a.transactions[0].date, '2025-01-01');
  assert.equal(
    a.diagnostics.some((d) => d.reason === 'missing_id'),
    true
  );
});
test('monetary cents and inferred amount remain auditable', () => {
  const input = { ...base, transactions: base.transactions.map((t) => ({ ...t, amount: undefined })) };
  const result = calculateGroupReturn(input);
  close(result.returnRate, 0.21);
  assert.equal(result.dailyFlows[0].transactions[0].amountSource, 'price_times_shares');
});