/* global window, localStorage, console */
/* eslint-disable no-console */

/**
 * Browser console helper for auditing holdings ledger totals.
 *
 * Usage:
 * 1. Open the app in browser.
 * 2. Open DevTools Console.
 * 3. Paste this whole file and run it.
 *
 * It only reads localStorage key `aiDcaFundHoldingsLedger`; it does not write.
 */
(() => {
  const KEY = 'aiDcaFundHoldingsLedger';
  const raw = localStorage.getItem(KEY);
  if (!raw) {
    console.warn('没有找到', KEY);
    return;
  }

  const ledger = JSON.parse(raw);
  const txsRaw = Array.isArray(ledger.transactions) ? ledger.transactions : [];
  const snapshots = ledger.snapshotsByCode || {};
  const EXCHANGE_PREFIXES = ['15', '50', '51', '52', '56', '58', '53', '54'];
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });

  const round = (value, precision = 2) => Math.round((Number(value) || 0) * 10 ** precision) / 10 ** precision;
  const toNumber = (value) => {
    if (value === null || value === undefined || value === '') return 0;
    const num = Number(String(value).replace(/[,\s¥$]/g, ''));
    return Number.isFinite(num) ? num : 0;
  };
  const normalizeCode = (value) => {
    const digits = String(value ?? '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.length === 6) return digits;
    if (digits.length < 6) return digits.padStart(6, '0');
    return digits.slice(-6);
  };
  const normalizeDate = (value) => {
    const rawValue = String(value || '').trim();
    const match = rawValue.match(/^(\d{4})[-/.]?(\d{2})[-/.]?(\d{2})/);
    return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
  };
  const detectKind = (tx) => {
    const rawKind = String(tx.kind || '').toLowerCase();
    if (rawKind === 'exchange' || rawKind === 'qdii') return rawKind;
    const code = normalizeCode(tx.code);
    return EXCHANGE_PREFIXES.includes(code.slice(0, 2)) ? 'exchange' : 'otc';
  };
  const getAmount = (tx) => {
    const explicitAmount = toNumber(tx.amount);
    if (explicitAmount > 0) return round(explicitAmount, 2);
    const price = toNumber(tx.price);
    const shares = toNumber(tx.shares);
    return price > 0 && shares > 0 ? round(price * shares, 2) : 0;
  };
  const normalizeTx = (tx, index) => {
    const type = String(tx.type || '').toUpperCase() === 'SELL' ? 'SELL' : 'BUY';
    const price = toNumber(tx.price);
    const explicitAmount = toNumber(tx.amount);
    const rawShares = toNumber(tx.shares);
    const code = normalizeCode(tx.code);
    const kind = detectKind({ ...tx, code });
    const shares = rawShares > 0
      ? round(rawShares, 4)
      : (type === 'BUY' && kind !== 'exchange' && explicitAmount > 0 && price > 0
        ? round(explicitAmount / price, 4)
        : 0);

    return {
      ...tx,
      _index: index,
      id: tx.id || `row-${index}`,
      code,
      kind,
      type,
      date: normalizeDate(tx.date),
      price: round(price, 4),
      shares,
      amount: explicitAmount > 0 ? round(explicitAmount, 2) : getAmount({ price, shares }),
    };
  };
  const isPendingBuy = (tx) => tx.type === 'BUY' && tx.kind !== 'exchange' && !(tx.price > 0) && tx.amount > 0;
  const isPendingSell = (tx) => tx.type === 'SELL'
    && tx.kind !== 'exchange'
    && !(tx.price > 0)
    && !(toNumber(tx.costPrice) > 0);
  const compareChrono = (left, right) => {
    const dateOrder = (left.date || '').localeCompare(right.date || '');
    if (dateOrder !== 0) return dateOrder;
    const leftTypeOrder = left.type === 'BUY' ? 0 : 1;
    const rightTypeOrder = right.type === 'BUY' ? 0 : 1;
    if (leftTypeOrder !== rightTypeOrder) return leftTypeOrder - rightTypeOrder;
    return String(left.id).localeCompare(String(right.id));
  };
  const getCurrentPrice = (code, kind) => {
    const snapshot = snapshots[code] || {};
    const candidates = kind === 'exchange'
      ? [snapshot.price, snapshot.currentPrice, snapshot.latestNav]
      : [snapshot.latestNav, snapshot.currentPrice, snapshot.price];
    return round(candidates.map(toNumber).find((value) => value > 0) || 0, 4);
  };

  const txs = txsRaw
    .map(normalizeTx)
    .filter((tx) => tx.code || tx.amount || tx.shares || tx.price);

  const summarizeTransactions = (rows) => rows.reduce((summary, tx) => {
    if (tx.type === 'BUY') {
      summary.buyCount += 1;
      summary.buyAmount = round(summary.buyAmount + getAmount(tx), 2);
    } else if (tx.type === 'SELL') {
      summary.sellCount += 1;
      summary.sellAmount = round(summary.sellAmount + getAmount(tx), 2);
    }
    return summary;
  }, {
    buyCount: 0,
    sellCount: 0,
    buyAmount: 0,
    sellAmount: 0,
  });

  const oneYearFrom = new Date(Date.now() - 366 * 864e5).toISOString().slice(0, 10);
  const allSummary = summarizeTransactions(txs);
  const oneYearSummary = summarizeTransactions(txs.filter((tx) => tx.date >= oneYearFrom));

  console.table([
    { 口径: '全部交易记录', ...allSummary },
    { 口径: '交易记录页默认近一年', ...oneYearSummary },
  ]);

  const txsByCode = new Map();
  for (const tx of txs) {
    if (!tx.code) continue;
    if (!txsByCode.has(tx.code)) txsByCode.set(tx.code, []);
    txsByCode.get(tx.code).push(tx);
  }

  const rows = [];
  const issues = [];

  for (const [code, list] of txsByCode) {
    const sorted = [...list].sort(compareChrono);
    const lots = [];
    let buyAmount = 0;
    let sellAmount = 0;
    let pendingBuy = 0;
    let pendingSellShares = 0;
    let realizedApprox = 0;
    let overSellShares = 0;
    const name = sorted.find((tx) => tx.name)?.name || snapshots[code]?.name || '';
    const kind = sorted.at(-1)?.kind || detectKind({ code });

    for (const tx of sorted) {
      if (tx.type === 'BUY') {
        buyAmount = round(buyAmount + getAmount(tx), 2);
        if (isPendingBuy(tx)) {
          pendingBuy = round(pendingBuy + tx.amount, 2);
        } else if (tx.shares > 0 && tx.price > 0) {
          lots.push({ shares: tx.shares, cost: round(tx.shares * tx.price, 6) });
        }
        continue;
      }

      if (isPendingSell(tx)) {
        pendingSellShares = round(pendingSellShares + tx.shares, 4);
        continue;
      }

      sellAmount = round(sellAmount + getAmount(tx), 2);
      let remaining = tx.shares;
      let consumedCost = 0;
      let consumedShares = 0;
      while (remaining > 0 && lots.length) {
        const lot = lots[0];
        const take = Math.min(remaining, lot.shares);
        const unitCost = lot.cost / lot.shares;
        consumedCost = round(consumedCost + take * unitCost, 6);
        consumedShares = round(consumedShares + take, 4);
        lot.shares = round(lot.shares - take, 4);
        lot.cost = round(lot.cost - take * unitCost, 6);
        if (lot.shares <= 0.0001) lots.shift();
        remaining = round(remaining - take, 4);
      }
      if (remaining > 0) overSellShares = round(overSellShares + remaining, 4);
      realizedApprox = round(realizedApprox + tx.price * consumedShares - consumedCost, 2);
    }

    const remainingShares = round(lots.reduce((sum, lot) => sum + lot.shares, 0), 4);
    const fifoCost = round(lots.reduce((sum, lot) => sum + lot.cost, 0), 2);
    const totalCost = round(fifoCost + pendingBuy, 2);
    const currentPrice = getCurrentPrice(code, kind);
    const marketValue = round((remainingShares > 0 && currentPrice > 0 ? remainingShares * currentPrice : 0) + pendingBuy, 2);
    const row = {
      code,
      name,
      kind,
      txCount: sorted.length,
      buyAmount,
      sellAmount,
      netBuyMinusSell: round(buyAmount - sellAmount, 2),
      remainingShares,
      fifoCost,
      pendingBuy,
      pendingSellShares,
      totalCost,
      currentPrice,
      marketValue,
      unrealized: round(marketValue - totalCost, 2),
      realizedApprox,
      overSellShares,
      latestNavDate: snapshots[code]?.latestNavDate || '',
      quoteDate: snapshots[code]?.quoteDate || '',
      snapshotAsOf: snapshots[code]?.asOf || snapshots[code]?.updatedAt || '',
    };
    rows.push(row);

    if (row.overSellShares > 0) {
      issues.push({ code, type: '卖出份额超过可用买入批次', value: row.overSellShares });
    }
    if ((row.remainingShares > 0 || row.pendingBuy > 0) && !(row.currentPrice > 0)) {
      issues.push({ code, type: '有持仓但缺当前价格/净值快照', value: row.remainingShares });
    }
    if (row.pendingBuy > 0 || row.pendingSellShares > 0) {
      issues.push({
        code,
        type: '有待确认场外/QDII交易',
        pendingBuy: row.pendingBuy,
        pendingSellShares: row.pendingSellShares,
      });
    }

    for (const tx of sorted) {
      const amount = getAmount(tx);
      const computedAmount = tx.price > 0 && tx.shares > 0 ? round(tx.price * tx.shares, 2) : 0;
      const expectedShares = tx.price > 0 && amount > 0 ? round(amount / tx.price, 4) : 0;
      if (
        amount > 0
        && computedAmount > 0
        && Math.abs(amount - computedAmount) > Math.max(1, amount * 0.01)
      ) {
        issues.push({
          code,
          type: '交易金额与价格×份额不一致',
          txId: tx.id,
          date: tx.date,
          side: tx.type,
          amount,
          price: tx.price,
          shares: tx.shares,
          computedAmount,
          expectedShares,
        });
      }
    }
  }

  const activeRows = rows.filter((row) => row.remainingShares > 0 || row.pendingBuy > 0);
  const overview = {
    activeCount: activeRows.length,
    totalCost: round(activeRows.reduce((sum, row) => sum + row.totalCost, 0), 2),
    marketValue: round(activeRows.reduce((sum, row) => sum + row.marketValue, 0), 2),
    unrealized: round(activeRows.reduce((sum, row) => sum + row.unrealized, 0), 2),
    allBuyAmount: allSummary.buyAmount,
    allSellAmount: allSummary.sellAmount,
    allNetBuyMinusSell: round(allSummary.buyAmount - allSummary.sellAmount, 2),
    oneYearBuyAmount: oneYearSummary.buyAmount,
    oneYearSellAmount: oneYearSummary.sellAmount,
    today,
  };

  console.log('汇总对照', overview);
  console.table(rows.sort((left, right) => right.marketValue - left.marketValue || left.code.localeCompare(right.code)));
  console.table(issues.length
    ? issues
    : [{ ok: '没有发现明显异常；重点看“近一年/全部”和 FIFO totalCost 的口径差异' }]);

  window.__holdingsAudit = {
    overview,
    rows,
    issues,
    rawLedger: ledger,
  };
  console.log('已保存到 window.__holdingsAudit；需要完整结果时，在 Console 里运行 JSON.stringify(window.__holdingsAudit, null, 2)');
})();
