import { sanitizeTransactions } from '../app/holdingsLedgerCore.js';

const FUND_CODE_PATTERN = /^\d{6}$/;

export function isQuickSwitchRecordValid(record) {
  if (!record) return false;
  const sellCode = String(record.sellCode || '').trim();
  const buyCode = String(record.buyCode || '').trim();
  return Boolean(
    FUND_CODE_PATTERN.test(sellCode)
    && FUND_CODE_PATTERN.test(buyCode)
    && sellCode !== buyCode
    && Number(record.sellPrice) > 0
    && Number(record.sellShares) > 0
    && Number(record.buyPrice) > 0
    && Number(record.buyShares) > 0
  );
}

export function buildQuickSwitchTransactions(record, { baseId, now } = {}) {
  if (!isQuickSwitchRecordValid(record)) return [];
  const createdAt = String(now || new Date().toISOString());
  const pairBaseId = String(baseId || `switch-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);
  const sellId = `${pairBaseId}-sell`;
  const buyId = `${pairBaseId}-buy`;
  const common = {
    date: record.date || createdAt.slice(0, 10),
    note: String(record.note || '').trim(),
    createdAt,
    updatedAt: createdAt
  };
  return [
    {
      ...common,
      id: sellId,
      type: 'SELL',
      code: String(record.sellCode || '').trim(),
      name: String(record.sellName || '').trim(),
      price: Number(record.sellPrice),
      shares: Number(record.sellShares),
      switchPairId: buyId
    },
    {
      ...common,
      id: buyId,
      type: 'BUY',
      code: String(record.buyCode || '').trim(),
      name: String(record.buyName || '').trim(),
      price: Number(record.buyPrice),
      shares: Number(record.buyShares),
      switchPairId: sellId
    }
  ];
}

export function buildAutoSwitchChains(transactions) {
  const txList = sanitizeTransactions(transactions, { filterInvalid: false });
  const txById = new Map();
  for (const tx of txList) if (tx.id) txById.set(tx.id, tx);

  const buysByCode = new Map();
  for (const tx of txList) {
    if (tx.type !== 'BUY' || !tx.code) continue;
    if (!buysByCode.has(tx.code)) buysByCode.set(tx.code, []);
    buysByCode.get(tx.code).push(tx);
  }
  for (const list of buysByCode.values()) {
    list.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  }

  function findLastBuyBefore(code, date) {
    const list = buysByCode.get(code) || [];
    let pick = null;
    for (const tx of list) {
      if (!date || (tx.date || '') <= date) pick = tx;
      else break;
    }
    return pick || (list.length ? list[list.length - 1] : null);
  }

  const switchPairs = [];
  const seenPairKeys = new Set();
  for (const tx of txList) {
    if (!tx.code || !tx.switchPairId) continue;
    const pair = txById.get(tx.switchPairId);
    if (!pair || !pair.code || pair.code === tx.code) continue;
    let sellTx = null;
    let buyTx = null;
    if (tx.type === 'SELL' && pair.type === 'BUY') {
      sellTx = tx;
      buyTx = pair;
    } else if (tx.type === 'BUY' && pair.type === 'SELL') {
      sellTx = pair;
      buyTx = tx;
    }
    if (!sellTx || !buyTx) continue;
    const pairKey = `${sellTx.id || ''}|${buyTx.id || ''}`;
    if (seenPairKeys.has(pairKey)) continue;
    seenPairKeys.add(pairKey);
    switchPairs.push({ sellTx, buyTx });
  }
  switchPairs.sort((a, b) => (a.sellTx.date || '').localeCompare(b.sellTx.date || '') || (a.buyTx.date || '').localeCompare(b.buyTx.date || ''));

  const chains = [];
  const activeByTailCode = new Map();
  let chainSeq = 0;

  for (const { sellTx, buyTx } of switchPairs) {
    const oldCode = sellTx.code;
    const newCode = buyTx.code;
    let chain = activeByTailCode.get(oldCode);
    if (chain) {
      const lastLeg = chain.legs[chain.legs.length - 1];
      if (lastLeg && !lastLeg.sellTxId) lastLeg.sellTxId = sellTx.id;
      chain.legs.push({ buyTxId: buyTx.id, sellTxId: '' });
      activeByTailCode.delete(oldCode);
    } else {
      chainSeq += 1;
      const firstBuy = findLastBuyBefore(oldCode, sellTx.date);
      if (!firstBuy) continue;
      chain = {
        id: `auto-chain-${chainSeq}`,
        name: '',
        legs: [
          { buyTxId: firstBuy.id, sellTxId: sellTx.id },
          { buyTxId: buyTx.id, sellTxId: '' }
        ]
      };
      chains.push(chain);
    }
    activeByTailCode.set(newCode, chain);
  }

  for (const chain of chains) {
    const codes = [];
    for (const leg of chain.legs) {
      const buy = txById.get(leg.buyTxId);
      if (buy?.code) codes.push(buy.code);
    }
    chain.name = codes.join(' → ');
  }

  return chains;
}
