// node --test test/clearedLotsAnalytics.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
	filterLotsByLens,
	lensFromDate,
	computeClearedKpi,
	groupClearedByMonth,
	afterSellChange,
	rankClearedLotsByProfit,
	holdDaysForLot,
	firstBuyDateForLot,
	CLEARED_LENS_KEYS,
	CLEARED_LENS_LABELS
} from '../src/app/clearedLotsAnalytics.js';

const lots = [
	{ id: 'L1', code: '510300', sellDate: '2026-05-10', sellShares: 100, sellPrice: 4, avgCost: 3, costBasis: 300, proceeds: 400, realizedProfit: 100, realizedReturnRate: 33.33 },
	{ id: 'L2', code: '510300', sellDate: '2026-04-20', sellShares: 50, sellPrice: 5, avgCost: 4, costBasis: 200, proceeds: 250, realizedProfit: 50, realizedReturnRate: 25 },
	{ id: 'L3', code: '161725', sellDate: '2025-11-15', sellShares: 1000, sellPrice: 1.2, avgCost: 1.5, costBasis: 1500, proceeds: 1200, realizedProfit: -300, realizedReturnRate: -20 },
	{ id: 'L4', code: '009777', sellDate: '2024-12-05', sellShares: 500, sellPrice: 2, avgCost: 1.8, costBasis: 900, proceeds: 1000, realizedProfit: 100, realizedReturnRate: 11.11 }
];

const ledger = {
	transactions: [
		{ id: 'T1', type: 'BUY', code: '510300', date: '2025-12-10', shares: 80, price: 3 },
		{ id: 'T2', type: 'BUY', code: '510300', date: '2026-01-15', shares: 70, price: 3.5 },
		{ id: 'T3', type: 'BUY', code: '161725', date: '2024-05-01', shares: 1000, price: 1.5 },
		{ id: 'T4', type: 'BUY', code: '009777', date: '2024-06-10', shares: 500, price: 1.8 },
		{ id: 'T5', type: 'SELL', code: '510300', date: '2026-05-10', shares: 100, price: 4 }
	]
};

test('lensFromDate 本月 升为当月 1 号', () => {
	assert.equal(lensFromDate('month', '2026-05-17'), '2026-05-01');
});

test('lensFromDate 近一年 减 12 个月', () => {
	assert.equal(lensFromDate('year', '2026-05-17'), '2025-05-17');
});

test('lensFromDate 近半年 减 6 个月', () => {
	assert.equal(lensFromDate('half', '2026-05-17'), '2025-11-17');
});

test('lensFromDate 投资以来 返回空串', () => {
	assert.equal(lensFromDate('all', '2026-05-17'), '');
});

test('filterLotsByLens 本月 只保留本月 sellDate', () => {
	const out = filterLotsByLens(lots, 'month', '2026-05-17');
	assert.equal(out.length, 1);
	assert.equal(out[0].id, 'L1');
});

test('filterLotsByLens 近半年 严格以 from (含边界)', () => {
	// today=2026-05-17 → lensFromDate('half')=2025-11-17。L3 sellDate=2025-11-15 被排除。
	const out = filterLotsByLens(lots, 'half', '2026-05-17');
	const ids = out.map((l) => l.id).sort();
	assert.deepEqual(ids, ['L1', 'L2']);
	// 边界包含：sellDate 恶好为 from 的 lot 要进
	const onBoundary = filterLotsByLens(
		[{ id: 'B', code: 'X', sellDate: '2025-11-17', realizedProfit: 0, costBasis: 0, proceeds: 0 }],
		'half',
		'2026-05-17'
	);
	assert.equal(onBoundary.length, 1);
	assert.equal(onBoundary[0].id, 'B');
});

test('filterLotsByLens 投资以来 返回全部', () => {
	assert.equal(filterLotsByLens(lots, 'all', '2026-05-17').length, 4);
});

test('filterLotsByLens 空输入 返回空数组', () => {
	assert.deepEqual(filterLotsByLens(null, 'all'), []);
	assert.deepEqual(filterLotsByLens([], 'month', '2026-05-17'), []);
});

test('computeClearedKpi 总盈亏 / 总本金 / 盈利率（Q4-2）', () => {
	const kpi = computeClearedKpi(lots);
	assert.equal(kpi.totalProfit, -50);
	assert.equal(kpi.totalSellCostBasis, 2900);
	// -50 / 2900 = -1.72%
	assert.equal(kpi.profitRate, -1.72);
	assert.equal(kpi.lotCount, 4);
	assert.equal(kpi.codeCount, 3);
});

test('computeClearedKpi 空 / 零本金 不报错', () => {
	const empty = computeClearedKpi([]);
	assert.equal(empty.totalProfit, 0);
	assert.equal(empty.profitRate, 0);
	assert.equal(empty.lotCount, 0);
	assert.equal(empty.codeCount, 0);
	assert.equal(empty.avgHoldDays, null);
});

test('firstBuyDateForLot 取同代码最早 BUY', () => {
	assert.equal(firstBuyDateForLot(lots[0], ledger), '2025-12-10'); // 510300 最早 BUY
	assert.equal(firstBuyDateForLot(lots[2], ledger), '2024-05-01'); // 161725
});

test('firstBuyDateForLot 无 ledger 返回空串', () => {
	assert.equal(firstBuyDateForLot(lots[0], null), '');
	assert.equal(firstBuyDateForLot(lots[0], { transactions: [] }), '');
});

test('holdDaysForLot 计算正确天数', () => {
	// L1 sellDate 2026-05-10, firstBuy 2025-12-10 → 约 151 天
	assert.equal(holdDaysForLot(lots[0], ledger), 151);
	// L3 sellDate 2025-11-15, firstBuy 2024-05-01 → 约 563 天
	assert.equal(holdDaysForLot(lots[2], ledger), 563);
});

test('computeClearedKpi 含 ledger 时 计算 avgHoldDays', () => {
	const kpi = computeClearedKpi(lots, { ledger });
	assert.ok(Number.isInteger(kpi.avgHoldDays));
	assert.ok(kpi.avgHoldDays > 0);
});

test('groupClearedByMonth 按月倒序', () => {
	const groups = groupClearedByMonth(lots);
	assert.equal(groups.length, 4);
	assert.equal(groups[0].month, '2026-05');
	assert.equal(groups[0].totalProfit, 100);
	assert.equal(groups[1].month, '2026-04');
	assert.equal(groups[2].month, '2025-11');
	assert.equal(groups[3].month, '2024-12');
});

test('rankClearedLotsByProfit 默认降序', () => {
	const ranked = rankClearedLotsByProfit(lots);
	assert.equal(ranked[0].realizedProfit, 100);
	assert.equal(ranked[ranked.length - 1].realizedProfit, -300);
});

test('rankClearedLotsByProfit asc 升序', () => {
	const ranked = rankClearedLotsByProfit(lots, 'asc');
	assert.equal(ranked[0].realizedProfit, -300);
	assert.equal(ranked[ranked.length - 1].realizedProfit, 100);
});

test('afterSellChange 起点取 sellDate 沉兇价、终点取最后一点', () => {
	const navByCode = {
		'510300': [
			{ date: '2026-05-09', nav: 3.9 },
			{ date: '2026-05-10', nav: 4.0 },
			{ date: '2026-05-12', nav: 4.2 },
			{ date: '2026-05-17', nav: 4.4 }
		]
	};
	// (4.4 - 4.0) / 4.0 * 100 = 10.00
	assert.equal(afterSellChange(lots[0], navByCode), 10);
});

test('afterSellChange nav 缺失返回 null', () => {
	assert.equal(afterSellChange(lots[0], {}), null);
	assert.equal(afterSellChange(lots[0], { '510300': [] }), null);
	assert.equal(afterSellChange(null, { '510300': [{ date: '2026-05-10', nav: 4 }] }), null);
});

test('导出镜头常量', () => {
	assert.deepEqual(CLEARED_LENS_KEYS, ['month', 'half', 'year', 'all']);
	assert.equal(CLEARED_LENS_LABELS.month, '本月');
	assert.equal(CLEARED_LENS_LABELS.all, '投资以来');
});
