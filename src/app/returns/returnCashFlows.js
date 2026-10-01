import { cents, inScope } from './returnInputs.js';

// Every trade crosses the fund-only boundary. Pair metadata has no effect.
export function netDailyGroupFlows({ transactions = [], scope = 'exchange', from, to }) {
  const days = new Map();
  for (const tx of transactions.filter((t) => inScope(t, scope) && t.date >= from && t.date <= to)) {
    if (!days.has(tx.date)) days.set(tx.date, { date: tx.date, buy: 0, sell: 0, transactions: [] });
    const day = days.get(tx.date);
    day[tx.type === 'BUY' ? 'buy' : 'sell'] += cents(tx.amount);
    day.transactions.push({ ...tx });
  }
  const dailyFlows = [...days.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({
      date: d.date,
      buyAmount: d.buy / 100,
      sellAmount: d.sell / 100,
      offsetAmount: Math.min(d.buy, d.sell) / 100,
      amount: (d.buy - d.sell) / 100,
      transactions: d.transactions
    }));
  return {
    dailyFlows,
    netInvestment: dailyFlows.reduce((sum, d) => sum + cents(d.amount), 0) / 100,
    offsetAmount: dailyFlows.reduce((sum, d) => sum + cents(d.offsetAmount), 0) / 100
  };
}