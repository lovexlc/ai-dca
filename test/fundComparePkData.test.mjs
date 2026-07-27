import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PK_GROUP_FEES,
  PK_GROUP_LIMITS,
  PK_GROUP_RETURNS,
  buildComparePkColumns,
  buildComparePkRows,
  groupComparePkRows,
  pickBestCellIndexes,
  visiblePkGroups,
} from '../src/pages/markets/fundComparePkData.js';

test('pickBestCellIndexes highlights max / min / minAbs and ties', () => {
  assert.deepEqual(
    pickBestCellIndexes([{ raw: 1 }, { raw: 5 }, { raw: 3 }], 'max'),
    [1],
  );
  assert.deepEqual(
    pickBestCellIndexes([{ raw: 1.2 }, { raw: 0.5 }, { raw: 0.8 }], 'min'),
    [1],
  );
  assert.deepEqual(
    pickBestCellIndexes([{ raw: -12 }, { raw: -5 }, { raw: -20 }], 'minAbs'),
    [1],
  );
  assert.deepEqual(
    pickBestCellIndexes([{ raw: 10 }, { raw: 10 }, { raw: 3 }], 'max'),
    [0, 1],
  );
  assert.deepEqual(pickBestCellIndexes([{ raw: 1 }, { raw: null }], 'max'), []);
  assert.deepEqual(pickBestCellIndexes([{ raw: 1 }], 'max'), []);
  assert.deepEqual(pickBestCellIndexes([{ raw: 1 }, { raw: 2 }], null), []);
});

test('buildComparePkColumns merges main + compare with fee/limit maps', () => {
  const columns = buildComparePkColumns({
    mainRow: { symbol: '000001', name: '华夏成长', return1y: 12, changePercent: 0.5 },
    compareSymbols: ['110022'],
    quoteMap: {
      '110022': { symbol: '110022', name: '易方达消费', return1y: 18, changePercent: 1.2 },
    },
    feeMap: {
      '000001': { managementFeeRate: 1.5, custodyFeeRate: 0.25, annualFeeRate: 1.75 },
      '110022': { managementFeeRate: 1.5, custodyFeeRate: 0.25, annualFeeRate: 1.5 },
    },
    limitMap: {
      '000001': { buyStatusText: '开放申购', maxPurchasePerDay: 10000, minPurchase: 10 },
    },
  });

  assert.equal(columns.length, 2);
  assert.equal(columns[0].isMain, true);
  assert.equal(columns[0].code, '000001');
  assert.equal(columns[0].fee.managementFeeRate, 1.5);
  assert.equal(columns[0].limit.buyStatusText, '开放申购');
  assert.equal(columns[1].symbol, '110022');
  assert.equal(columns[1].name, '易方达消费');
  assert.equal(columns[1].quote.return1y, 18);
});

test('buildComparePkRows formats returns fees and highlights best values', () => {
  const columns = buildComparePkColumns({
    mainRow: {
      symbol: '000001',
      name: 'A',
      latestNav: 1.2345,
      changePercent: 0.5,
      return1w: 1,
      return1m: 2,
      return3m: 3,
      return6m: 4,
      return1y: 10,
      ytdReturn: 8,
      returnBase: 50,
      maxDrawdown: -15,
      fundSize: 5e9,
    },
    compareSymbols: ['110022'],
    quoteMap: {
      110022: {
        symbol: '110022',
        name: 'B',
        latestNav: 2.1,
        changePercent: 1.5,
        return1w: 2,
        return1m: 3,
        return3m: 5,
        return6m: 6,
        return1y: 20,
        ytdReturn: 12,
        returnBase: 80,
        maxDrawdown: -8,
        fundSize: 1e10,
      },
    },
    feeMap: {
      '000001': {
        managementFeeRate: 1.5,
        custodyFeeRate: 0.25,
        annualFeeRate: 1.75,
        purchaseRules: [{ value: '1.5', unit: '0' }, { value: '0.15', unit: '0' }],
        redeemRules: [
          { name: '持有期限<7日', value: '1.5', unit: '0' },
          { name: '持有期限≥7日', value: '0', unit: '0' },
        ],
      },
      110022: {
        managementFeeRate: 0.5,
        custodyFeeRate: 0.1,
        annualFeeRate: 0.6,
        purchaseRules: [{ value: '0', unit: '0' }],
        redeemRules: [{ name: '持有期限≥7日', value: '0', unit: '0' }],
      },
    },
  });

  const rows = buildComparePkRows({ columns, showLimits: false });
  const byId = Object.fromEntries(rows.map((row) => [row.id, row]));

  assert.equal(byId.return1y.cells[0].raw, 10);
  assert.equal(byId.return1y.cells[1].raw, 20);
  assert.deepEqual(byId.return1y.bestIndexes, [1]);
  assert.ok(byId.return1y.cells[1].text.includes('20') || byId.return1y.cells[1].text.includes('+'));

  assert.deepEqual(byId.maxDrawdown.bestIndexes, [1]);
  assert.ok(byId.annualFee.cells[0].text.includes('%'));
  assert.deepEqual(byId.annualFee.bestIndexes, [1]);
  assert.deepEqual(byId.managementFee.bestIndexes, [1]);
  assert.equal(byId.purchaseFee.cells[1].raw, 0);
  assert.ok(byId.redeemTiers.cells[0].text.includes('%') || byId.redeemTiers.cells[0].text.includes('日'));
  assert.equal(rows.some((row) => row.group === PK_GROUP_LIMITS), false);
});

test('buildComparePkRows includes limits group when showLimits', () => {
  const columns = buildComparePkColumns({
    mainRow: { symbol: '000001', name: 'A' },
    compareSymbols: ['110022'],
    quoteMap: { 110022: { symbol: '110022', name: 'B' } },
    limitMap: {
      '000001': { buyStatusText: '开放申购', maxPurchasePerDay: 50000, minPurchase: 10 },
      110022: { buyStatusText: '暂停申购', maxPurchasePerDay: 0, minPurchase: 100 },
    },
  });
  const rows = buildComparePkRows({ columns, showLimits: true });
  const limitRows = rows.filter((row) => row.group === PK_GROUP_LIMITS);
  assert.equal(limitRows.length, 3);
  const buyStatus = rows.find((row) => row.id === 'buyStatus');
  assert.equal(buyStatus.cells[0].text, '开放申购');
  assert.equal(buyStatus.cells[1].text, '暂停申购');
});

test('buildComparePkRows shows loading placeholders for missing fees', () => {
  const columns = buildComparePkColumns({
    mainRow: { symbol: '000001' },
    compareSymbols: ['110022'],
    quoteMap: { 110022: { symbol: '110022' } },
  });
  const rows = buildComparePkRows({ columns, loadingFees: true });
  const annual = rows.find((row) => row.id === 'annualFee');
  assert.equal(annual.cells[0].text, '加载中');
  assert.equal(annual.cells[1].text, '加载中');
});

test('groupComparePkRows and visiblePkGroups respect limits flag', () => {
  const columns = buildComparePkColumns({
    mainRow: { symbol: '000001', return1y: 1 },
    compareSymbols: ['110022'],
    quoteMap: { 110022: { return1y: 2 } },
    feeMap: {
      '000001': { annualFeeRate: 1 },
      110022: { annualFeeRate: 0.5 },
    },
    limitMap: {
      '000001': { buyStatusText: '开放' },
      110022: { buyStatusText: '开放' },
    },
  });
  const rows = buildComparePkRows({ columns, showLimits: true });
  const grouped = groupComparePkRows(rows);
  assert.deepEqual(grouped.map((g) => g.key), [PK_GROUP_RETURNS, PK_GROUP_FEES, PK_GROUP_LIMITS]);
  assert.deepEqual(visiblePkGroups({ showLimits: false }).map((g) => g.key), [PK_GROUP_RETURNS, PK_GROUP_FEES]);
  assert.ok(visiblePkGroups({ showLimits: true }).some((g) => g.key === PK_GROUP_LIMITS));
});
