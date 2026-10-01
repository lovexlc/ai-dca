import { cents, inScope, issue } from './returnInputs.js';

export function resolveSwitchPairs(transactions = [], scope = 'exchange') {
  const byId = new Map();
  const duplicate = new Set();
  for (const tx of transactions) {
    if (byId.has(tx.id)) duplicate.add(tx.id);
    byId.set(tx.id, tx);
  }
  const edges = new Map();
  const neighbors = new Map();
  const diagnostics = [];
  for (const tx of transactions.filter((t) => t.switchPairId)) {
    const other = byId.get(tx.switchPairId);
    if (!other) {
      diagnostics.push(issue('dangling_switch_pair', tx));
      continue;
    }
    const ids = [tx.id, other.id].sort();
    edges.set(JSON.stringify(ids), [tx, other]);
    for (const [a, b] of [
      [tx, other],
      [other, tx]
    ]) {
      if (!neighbors.has(a.id)) neighbors.set(a.id, new Set());
      neighbors.get(a.id).add(b.id);
    }
  }
  const pairs = [];
  for (const [id, legs] of edges) {
    const sell = legs.find((t) => t.type === 'SELL');
    const buy = legs.find((t) => t.type === 'BUY');
    if (
      !sell ||
      !buy ||
      legs.some((t) => duplicate.has(t.id) || neighbors.get(t.id).size !== 1) ||
      sell.date > buy.date ||
      legs.some((t) => t.confirmed === false || !t.date || t.shares <= 0 || t.price <= 0 || t.amount <= 0)
    ) {
      diagnostics.push(issue('invalid_or_ambiguous_switch_pair', legs[0]));
      continue;
    }
    const internal = inScope(sell, scope) && inScope(buy, scope);
    pairs.push({ id, sell, buy, internal, amount: Math.min(cents(sell.amount), cents(buy.amount)) / 100 });
  }
  return { pairs, diagnostics };
}

export function buildSwitchBridgeTimeline(pairs = []) {
  const events = pairs
    .filter((p) => p.internal && p.sell.date < p.buy.date)
    .flatMap((p) => [
      { date: p.sell.date, amount: p.amount, pairId: p.id },
      { date: p.buy.date, amount: -p.amount, pairId: p.id }
    ])
    .sort((a, b) => a.date.localeCompare(b.date) || a.pairId.localeCompare(b.pairId));
  const valueAt = (date) =>
    events.filter((e) => e.date <= date).reduce((sum, e) => sum + cents(e.amount), 0) / 100;
  return { events, valueAt };
}

export function netDailyGroupFlows({ transactions = [], pairs = [], scope = 'exchange', from, to }) {
  const offsets = new Map();
  const excluded = new Set();
  for (const p of pairs) {
    if (!p.internal) {
      excluded.add(p.sell.id);
      excluded.add(p.buy.id);
      continue;
    }
    if (p.sell.date < p.buy.date) for (const tx of [p.sell, p.buy]) offsets.set(tx.id, cents(p.amount));
  }
  const days = new Map();
  for (const tx of transactions.filter((t) => inScope(t, scope) && t.date >= from && t.date <= to)) {
    if (!days.has(tx.date))
      days.set(tx.date, {
        date: tx.date,
        buy: 0,
        sell: 0,
        eligibleBuy: 0,
        eligibleSell: 0,
        bridgeOffset: 0,
        transactions: []
      });
    const day = days.get(tx.date);
    const side = tx.type === 'BUY' ? 'buy' : 'sell';
    const amount = cents(tx.amount);
    const offset = offsets.get(tx.id) || 0;
    day[side] += amount;
    day.bridgeOffset += offset;
    if (!excluded.has(tx.id)) day[side === 'buy' ? 'eligibleBuy' : 'eligibleSell'] += amount - offset;
    day.transactions.push({ ...tx, bridgeOffset: offset / 100, residualAmount: (amount - offset) / 100 });
  }
  const dailyFlows = [...days.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => {
      const buyOffset = d.transactions
        .filter((t) => t.type === 'BUY')
        .reduce((sum, t) => sum + cents(t.bridgeOffset), 0);
      const sellOffset = d.bridgeOffset - buyOffset;
      return {
        date: d.date,
        buyAmount: d.buy / 100,
        sellAmount: d.sell / 100,
        offsetAmount: Math.min(d.eligibleBuy, d.eligibleSell) / 100,
        bridgeOffset: d.bridgeOffset / 100,
        amount: (d.buy - buyOffset - d.sell + sellOffset) / 100,
        transactions: d.transactions
      };
    });
  return {
    dailyFlows,
    netInvestment: dailyFlows.reduce((sum, d) => sum + cents(d.amount), 0) / 100,
    offsetAmount: dailyFlows.reduce((sum, d) => sum + cents(d.offsetAmount), 0) / 100
  };
}