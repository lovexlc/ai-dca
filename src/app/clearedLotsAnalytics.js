// clearedLotsAnalytics.js
//
// 纯函数集：「收益明细 · 清仓分析」的 KPI / 镜头过滤 / 按月分组 / 盈亏排行。
// 所有函数都不有副作用，不涉 IO，以便单测。
//
// soldLot 奇数据源：holdingsLedgerCore.js buildSoldLots()。每个 lot 包含：
//   { id, code, name, kind, sellDate, sellShares, sellPrice, avgCost,
//     costBasis, proceeds, realizedProfit, realizedReturnRate,
//     hasAvgCost, standalone, isSwitch, switchPairId, ... , tx }
//
// 提供的 KPI（4.4 清仓分析页使用）：
//   - totalProfit：清仓总收益 = Σ realizedProfit
//   - totalSellCostBasis：总卖出本金 = Σ costBasis
//   - sellCostProfitRate：清仓盈利率 = totalProfit / totalSellCostBasis（4.0 问题 Q4-2）
//   - codeCount：清仓产品数（unique code）
//   - lotCount：清仓次数（lot 总条数）
//   - avgHoldDays：平均持有天数（sellDate - firstBuyDate(code, sellDate)）

function round(value, decimals = 2) {
	if (!Number.isFinite(value)) return 0;
	const factor = 10 ** decimals;
	return Math.round(value * factor) / factor;
}

function isoToMillis(iso) {
	if (typeof iso !== 'string' || iso.length < 8) return Number.NaN;
	const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
	if (!m) return Number.NaN;
	return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function daysBetween(fromIso, toIso) {
	const f = isoToMillis(fromIso);
	const t = isoToMillis(toIso);
	if (!Number.isFinite(f) || !Number.isFinite(t)) return null;
	return Math.round((t - f) / 86400000);
}

/**
 * 在 ledger 里查以 lot.code 为主题、且 BUY 交易日期 ≤ sellDate 的最早 BUY。
 * 返回 ISO 日期字符串，找不到返回 ""。
 */
export function firstBuyDateForLot(lot, ledger) {
	if (!lot || !lot.code || !lot.sellDate) return '';
	const txs = (ledger && Array.isArray(ledger.transactions)) ? ledger.transactions : [];
	let earliest = '';
	for (const tx of txs) {
		if (!tx || tx.type !== 'BUY') continue;
		if (tx.code !== lot.code) continue;
		if (!tx.date) continue;
		if (tx.date > lot.sellDate) continue;
		if (!earliest || tx.date < earliest) earliest = tx.date;
	}
	return earliest;
}

/** 计算单 lot 的持有天数。 */
export function holdDaysForLot(lot, ledger) {
	const firstBuy = firstBuyDateForLot(lot, ledger);
	if (!firstBuy || !lot.sellDate) return null;
	return daysBetween(firstBuy, lot.sellDate);
}

const LENS_KEYS = ['month', 'half', 'year', 'all'];
export const CLEARED_LENS_KEYS = LENS_KEYS;

export const CLEARED_LENS_LABELS = {
	month: '本月',
	half: '近半年',
	year: '近一年',
	all: '投资以来'
};

/** 给定镜头 + 今日，计算 sellDate 过滤下限（含）。 */
export function lensFromDate(lens, todayIso) {
	const today = (typeof todayIso === 'string' && /^\d{4}-\d{2}-\d{2}/.test(todayIso))
		? todayIso.slice(0, 10)
		: new Date().toISOString().slice(0, 10);
	const [yy, mm] = today.split('-').map(Number);
	if (lens === 'month') {
		return `${String(yy).padStart(4, '0')}-${String(mm).padStart(2, '0')}-01`;
	}
	if (lens === 'half') {
		const d = new Date(Date.UTC(yy, mm - 1, Number(today.slice(8, 10))));
		d.setUTCMonth(d.getUTCMonth() - 6);
		return d.toISOString().slice(0, 10);
	}
	if (lens === 'year') {
		const d = new Date(Date.UTC(yy, mm - 1, Number(today.slice(8, 10))));
		d.setUTCFullYear(d.getUTCFullYear() - 1);
		return d.toISOString().slice(0, 10);
	}
	return ''; // all-time
}

/** 按镜头过滤 lots（sellDate ≥ from）。 */
export function filterLotsByLens(lots, lens, todayIso) {
	const safeLots = Array.isArray(lots) ? lots : [];
	if (lens === 'all' || !lens) return safeLots.slice();
	const from = lensFromDate(lens, todayIso);
	if (!from) return safeLots.slice();
	return safeLots.filter((lot) => lot && typeof lot.sellDate === 'string' && lot.sellDate >= from);
}

/**
 * 计算 KPI 总览。
 * @param {Array} lots
 * @param  ledger?: object, todayIso?: string  [opts]
 */
export function computeClearedKpi(lots, opts = {}) {
	const safeLots = Array.isArray(lots) ? lots : [];
	const kpi = {
		totalProfit: 0,
		totalSellCostBasis: 0,
		totalProceeds: 0,
		sellCostProfitRate: 0,
		codeCount: 0,
		lotCount: safeLots.length,
		pendingLotCount: 0,
		avgHoldDays: null
	};
	const codeSet = new Set();
	let holdDaysSum = 0;
	let holdDaysCount = 0;
	for (const lot of safeLots) {
		if (!lot) continue;
		if (lot.code) codeSet.add(lot.code);
		if (lot.pending) {
			kpi.pendingLotCount += 1;
			continue; // 待确认不计入 KPI 汇总，等 NAV 公布后自动转为正常。
		}
		kpi.totalProfit += Number.isFinite(lot.realizedProfit) ? lot.realizedProfit : 0;
		kpi.totalSellCostBasis += Number.isFinite(lot.costBasis) ? lot.costBasis : 0;
		kpi.totalProceeds += Number.isFinite(lot.proceeds) ? lot.proceeds : 0;
		if (opts.ledger) {
			const hd = holdDaysForLot(lot, opts.ledger);
			if (Number.isFinite(hd) && hd >= 0) {
				holdDaysSum += hd;
				holdDaysCount += 1;
			}
		}
	}
	kpi.totalProfit = round(kpi.totalProfit, 2);
	kpi.totalSellCostBasis = round(kpi.totalSellCostBasis, 2);
	kpi.totalProceeds = round(kpi.totalProceeds, 2);
	// Q4-2: 清仓盈利率 = totalProfit / totalSellCostBasis
	kpi.sellCostProfitRate = kpi.totalSellCostBasis > 0
		? round((kpi.totalProfit / kpi.totalSellCostBasis) * 100, 2)
		: 0;
	kpi.codeCount = codeSet.size;
	kpi.avgHoldDays = holdDaysCount > 0 ? Math.round(holdDaysSum / holdDaysCount) : null;
	return kpi;
}

/** 按 sellDate 的 YYYY-MM 分组，返回按时间倒序的数组。 */
export function groupClearedByMonth(lots) {
	const safeLots = Array.isArray(lots) ? lots : [];
	const byMonth = new Map();
	for (const lot of safeLots) {
		if (!lot || typeof lot.sellDate !== 'string' || lot.sellDate.length < 7) continue;
		const ym = lot.sellDate.slice(0, 7);
		if (!byMonth.has(ym)) byMonth.set(ym, []);
		byMonth.get(ym).push(lot);
	}
	const keys = Array.from(byMonth.keys()).sort((a, b) => b.localeCompare(a));
	return keys.map((ym) => {
		const items = byMonth.get(ym);
		const profit = items.reduce((s, lot) => s + (Number.isFinite(lot.realizedProfit) ? lot.realizedProfit : 0), 0);
		return {
			month: ym,
			lots: items.slice().sort((a, b) => (b.sellDate || '').localeCompare(a.sellDate || '')),
			totalProfit: round(profit, 2),
			lotCount: items.length
		};
	});
}

/**
 * 清仓后涨跌幅（Q4-1）：NAV(sellDate) → NAV(latest available, ≥ sellDate)。
 * navHistory：按 code 索引的 array，元素为 { date: 'YYYY-MM-DD', nav: number }，升序。
 * 找不到返回 null。
 */
export function afterSellChange(lot, navByCode) {
	if (!lot || !lot.sellDate) return null;
	const items = navByCode && lot.code ? navByCode[lot.code] : null;
	if (!Array.isArray(items) || items.length === 0) return null;
	let startNav = null;
	let endNav = null;
	// 在 sellDate 当天或之后的最近一个净值作为起点（沉兇价）
	for (const it of items) {
		if (!it || typeof it.nav !== 'number' || !Number.isFinite(it.nav) || it.nav <= 0) continue;
		if (typeof it.date !== 'string') continue;
		if (it.date >= lot.sellDate && startNav === null) {
			startNav = it.nav;
		}
		endNav = it.nav; // 最后一个有效净值作为终点
	}
	if (startNav === null || endNav === null || startNav <= 0) return null;
	return round(((endNav - startNav) / startNav) * 100, 2);
}

/** 对过滤后的 lots 按盈亏排序（默认 realizedProfit desc）。 */
export function rankClearedLotsByProfit(lots, direction = 'desc') {
	// 待确认的笔没有盈亏，不入盈亏排行。
	const safeLots = (Array.isArray(lots) ? lots : []).filter((lot) => lot && !lot.pending).slice();
	const factor = direction === 'asc' ? 1 : -1;
	safeLots.sort((a, b) => {
		const pa = Number.isFinite(a?.realizedProfit) ? a.realizedProfit : 0;
		const pb = Number.isFinite(b?.realizedProfit) ? b.realizedProfit : 0;
		if (pa !== pb) return factor * (pa - pb);
		return (a?.code || '').localeCompare(b?.code || '');
	});
	return safeLots;
}
