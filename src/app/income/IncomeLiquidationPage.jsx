// IncomeLiquidationPage.jsx — #/liquidation 清仓分析
//
// 第四刀 4.4：参考用户图 2，把「已卖出明细」从 HoldingsExperience 主 tab
// 迁移到「收益明细 · 清仓分析」子页。
//
// 结构：
//   ① 镜头 chips：本月 / 近半年 / 近一年 / 投资以来
//   ② KPI 5 列：清仓总收益 / 清仓盈利率 / 清仓产品数 / 平均持有天数 / 清仓次数
//   ③ Tabs：清仓明细 / 盈亏排行
//   ④ 清仓明细：按月分组列表（YYYY-MM 月份头 + 当月汇总 + lot 行）
//   ⑤ 盈亏排行：按 realizedProfit 降序，正负分块
//
// 数据：ledger.transactions → buildSoldLots() → filterLotsByLens(lens)
//      → computeClearedKpi({ ledger })
//
// 颜色：涨红跌绿（profit>0 = rose-600；profit<0 = emerald-600）

import { useMemo, useState } from 'react';
import SubPageShell from './SubPageShell.jsx';
import { buildSoldLots } from '../holdingsLedgerCore.js';
import {
	CLEARED_LENS_KEYS,
	CLEARED_LENS_LABELS,
	computeClearedKpi,
	filterLotsByLens,
	groupClearedByMonth,
	rankClearedLotsByProfit,
	holdDaysForLot,
} from '../clearedLotsAnalytics.js';
import { cx } from '../../components/experience-ui.jsx';

const TONE_UP = 'text-rose-600';
const TONE_DOWN = 'text-emerald-600';
const TONE_NEUTRAL = 'text-slate-700';
const TONE_DIM = 'text-slate-400';

function toneOf(value) {
	const n = Number(value);
	if (!Number.isFinite(n) || n === 0) return TONE_NEUTRAL;
	return n > 0 ? TONE_UP : TONE_DOWN;
}

function formatCurrency(value, digits = 2) {
	if (!Number.isFinite(Number(value))) return '—';
	return `¥${Number(value).toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function formatSignedCurrency(value, digits = 2) {
	const n = Number(value);
	if (!Number.isFinite(n)) return '—';
	const sign = n > 0 ? '+' : (n < 0 ? '-' : '');
	return `${sign}¥${Math.abs(n).toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function formatPercent(value, digits = 2) {
	if (!Number.isFinite(Number(value))) return '—';
	const n = Number(value);
	const sign = n > 0 ? '+' : (n < 0 ? '-' : '');
	return `${sign}${Math.abs(n).toFixed(digits)}%`;
}

function Kpi({ label, value, valueTone, sub }) {
	return (
		<div className="flex min-w-0 flex-col gap-1 rounded-2xl border border-slate-200/70 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-4">
			<div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400 sm:text-[11px]">{label}</div>
			<div className={cx('truncate text-lg font-semibold tabular-nums sm:text-xl', valueTone || TONE_NEUTRAL)}>{value}</div>
			{sub ? <div className="truncate text-[10px] text-slate-400 sm:text-[11px]">{sub}</div> : null}
		</div>
	);
}

function LotRow({ lot, ledger }) {
	const hd = holdDaysForLot(lot, ledger);
	const rateTone = toneOf(lot.realizedReturnRate);
	return (
		<div className="flex items-center justify-between gap-2 border-b border-slate-100 px-2 py-2 last:border-b-0">
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<div className="flex items-center gap-1.5 truncate">
					<span className="truncate text-sm font-medium text-slate-800">{lot.name || lot.code}</span>
					<span className="shrink-0 text-[10px] text-slate-400">{lot.code}</span>
					{lot.isSwitch ? (
						<span className="shrink-0 rounded-full bg-indigo-50 px-1.5 py-px text-[9px] font-semibold text-indigo-600">转换</span>
					) : null}
				</div>
				<div className="flex items-center gap-2 text-[11px] text-slate-500">
					<span className="tabular-nums">{lot.sellDate}</span>
					<span>·</span>
					<span className="tabular-nums">{lot.sellShares.toLocaleString('zh-CN', { maximumFractionDigits: 2 })} 份</span>
					{Number.isFinite(hd) ? (<><span>·</span><span className="tabular-nums">持有 {hd} 天</span></>) : null}
				</div>
			</div>
			<div className="flex shrink-0 flex-col items-end gap-0.5 text-right">
				<div className={cx('text-sm font-semibold tabular-nums', toneOf(lot.realizedProfit))}>
					{formatSignedCurrency(lot.realizedProfit)}
				</div>
				<div className={cx('text-[11px] tabular-nums', rateTone)}>
					{formatPercent(lot.realizedReturnRate)}
				</div>
			</div>
		</div>
	);
}

function MonthlyGroups({ groups, ledger }) {
	if (!groups.length) {
		return (
			<div className="rounded-2xl border border-dashed border-slate-200 bg-white px-3 py-8 text-center text-sm text-slate-400">
				当前镜头无清仓记录。
			</div>
		);
	}
	return (
		<div className="flex flex-col gap-3">
			{groups.map((g) => (
				<section key={g.month} className="rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
					<header className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 sm:px-4">
						<div className="text-sm font-semibold text-slate-700 tabular-nums">{g.month}</div>
						<div className="flex items-baseline gap-2">
							<span className={cx('text-sm font-semibold tabular-nums', toneOf(g.totalProfit))}>
								{formatSignedCurrency(g.totalProfit)}
							</span>
							<span className="text-[11px] text-slate-400 tabular-nums">{g.lotCount} 次</span>
						</div>
					</header>
					<div className="px-2 sm:px-3">
						{g.lots.map((lot) => (<LotRow key={lot.id || `${lot.code}-${lot.sellDate}`} lot={lot} ledger={ledger} />))}
					</div>
				</section>
			))}
		</div>
	);
}

function ProfitRanking({ lots, ledger }) {
	if (!lots.length) {
		return (
			<div className="rounded-2xl border border-dashed border-slate-200 bg-white px-3 py-8 text-center text-sm text-slate-400">
				当前镜头无清仓记录。
			</div>
		);
	}
	const ranked = rankClearedLotsByProfit(lots, 'desc');
	const winners = ranked.filter((l) => Number(l.realizedProfit) > 0);
	const losers = ranked.filter((l) => Number(l.realizedProfit) < 0).reverse();
	return (
		<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
			<section className="rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
				<header className="border-b border-slate-100 px-3 py-2 text-sm font-semibold text-rose-600 sm:px-4">盈利榜 · Top {Math.min(winners.length, 10)}</header>
				<div className="px-2 sm:px-3">
					{winners.length === 0 ? (
						<div className="px-1 py-4 text-center text-xs text-slate-400">暂无盈利清仓</div>
					) : winners.slice(0, 10).map((lot) => (<LotRow key={lot.id || `${lot.code}-${lot.sellDate}`} lot={lot} ledger={ledger} />))}
				</div>
			</section>
			<section className="rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
				<header className="border-b border-slate-100 px-3 py-2 text-sm font-semibold text-emerald-600 sm:px-4">亏损榜 · Top {Math.min(losers.length, 10)}</header>
				<div className="px-2 sm:px-3">
					{losers.length === 0 ? (
						<div className="px-1 py-4 text-center text-xs text-slate-400">暂无亏损清仓</div>
					) : losers.slice(0, 10).map((lot) => (<LotRow key={lot.id || `${lot.code}-${lot.sellDate}`} lot={lot} ledger={ledger} />))}
				</div>
			</section>
		</div>
	);
}

export function IncomeLiquidationPage({ ledger, onBack }) {
	const [lens, setLens] = useState('all');
	const [tab, setTab] = useState('detail'); // 'detail' | 'ranking'

	const allLots = useMemo(() => buildSoldLots(ledger?.transactions || []), [ledger]);
	const lots = useMemo(() => filterLotsByLens(allLots, lens), [allLots, lens]);
	const kpi = useMemo(() => computeClearedKpi(lots, { ledger }), [lots, ledger]);
	const groups = useMemo(() => groupClearedByMonth(lots), [lots]);

	return (
		<SubPageShell title="清仓分析" onBack={onBack}>
			{/* ① 镜头 chips */}
			<nav aria-label="清仓分析镜头" className="flex flex-wrap gap-1.5">
				{CLEARED_LENS_KEYS.map((k) => {
					const active = lens === k;
					return (
						<button
							key={k}
							type="button"
							onClick={() => setLens(k)}
							className={cx(
								'inline-flex items-center rounded-full px-3 py-1 text-xs font-medium transition-colors sm:text-sm',
								active
									? 'bg-slate-900 text-white shadow-[0_1px_2px_rgba(15,23,42,0.08)]'
									: 'border border-slate-200/70 bg-white text-slate-600 hover:bg-slate-50'
							)}
						>
							{CLEARED_LENS_LABELS[k]}
						</button>
					);
				})}
			</nav>

			{/* ② KPI */}
			<div className="grid grid-cols-2 gap-2 sm:grid-cols-5 sm:gap-3">
				<Kpi label="清仓总收益" value={formatSignedCurrency(kpi.totalProfit)} valueTone={toneOf(kpi.totalProfit)} />
				<Kpi label="清仓盈利率" value={formatPercent(kpi.profitRate)} valueTone={toneOf(kpi.profitRate)} sub={`总卖出本金 ${formatCurrency(kpi.totalSellCostBasis)}`} />
				<Kpi label="清仓产品数" value={`${kpi.codeCount} 只`} />
				<Kpi label="平均持有天数" value={Number.isInteger(kpi.avgHoldDays) ? `${kpi.avgHoldDays} 天` : '—'} />
				<Kpi label="清仓次数" value={`${kpi.lotCount} 次`} />
			</div>

			{/* ③ Tabs */}
			<div role="tablist" aria-label="清仓视图" className="flex items-center gap-1 border-b border-slate-200 text-sm font-semibold">
				{[{ key: 'detail', label: '清仓明细' }, { key: 'ranking', label: '盈亏排行' }].map((t) => {
					const active = tab === t.key;
					return (
						<button
							key={t.key}
							type="button"
							role="tab"
							aria-selected={active}
							onClick={() => setTab(t.key)}
							className={cx(
								'relative -mb-px inline-flex items-center border-b-2 px-3 py-2 transition-colors',
								active ? 'border-indigo-500 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'
							)}
						>
							{t.label}
						</button>
					);
				})}
			</div>

			{/* ④/⑤ */}
			{tab === 'detail' ? <MonthlyGroups groups={groups} ledger={ledger} /> : <ProfitRanking lots={lots} ledger={ledger} />}

			<div className={cx('px-1 text-[11px]', TONE_DIM)}>
				清仓盈利率 = 清仓总收益 ÷ 总卖出本金（avgCost × sellShares 之和）。平均持有天数按首次买入到卖出当天估算。
			</div>
		</SubPageShell>
	);
}

export default IncomeLiquidationPage;
