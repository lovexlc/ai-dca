// IncomeTransactionsPage.jsx — #/transactions 独立子页 (v6)
//
// 第五刀 v6：把成交流水从主页内 tab 升级为独立子页，参考图 1 设计。
// 结构（自上而下）：
//   ① 全部交易汇总 card：买入/卖出/定投·发车/分红/预约 5 组指标 + 右上角时间筛选下拉
//   ② 清仓分析入口 card → navigate('liquidation')
//   ③ 跑赢大盘 banner（session 内可关闭）：从已清仓 lots 取 realizedReturnRate 最高一支
//   ④ 明细筛选：基金下拉 + 类型下拉（全部/买入/卖出）
//   ⑤ 明细列表：按月分组卡片，点击行 → onEditTransaction(txId) 调主页 sidePanel 编辑
//
// 数据：当前 ledger 仅 BUY/SELL；定投/分红/预约展示为 0。
// 待办：跑赢 banner 当前用清仓盈利率作为占位指标；下个迭代接入 HS300 历史做正式跑赢对比。

import { useMemo, useState } from 'react';
import { X, ChevronRight } from 'lucide-react';
import { formatCurrency } from '../accumulation.js';
import { cx } from '../../components/experience-ui.jsx';
import SubPageShell from './SubPageShell.jsx';
import { ROUTES } from '../incomeRoute.js';
import { buildSoldLots } from '../holdingsLedgerCore.js';

const TONE_BUY = 'bg-rose-50 text-rose-700';
const TONE_SELL = 'bg-emerald-50 text-emerald-700';

const LENS_OPTIONS = [
	{ key: '1m', label: '近一月', days: 31 },
	{ key: '3m', label: '近三月', days: 92 },
	{ key: '6m', label: '近半年', days: 184 },
	{ key: '1y', label: '近一年', days: 366 },
	{ key: 'all', label: '全部', days: null },
];

function toIsoDay(d) {
	if (!d) return '';
	const s = String(d);
	return s.length >= 10 ? s.slice(0, 10) : s;
}

function monthKeyOf(iso) {
	return iso && iso.length >= 7 ? iso.slice(0, 7) : '未知月';
}

function computeAmount(tx) {
	if (Number.isFinite(tx?.amount)) return tx.amount;
	const shares = Number(tx?.shares);
	const price = Number(tx?.price);
	if (Number.isFinite(shares) && Number.isFinite(price)) return shares * price;
	return null;
}

function todayIso() {
	return new Date().toISOString().slice(0, 10);
}

function shiftDays(isoDate, deltaDays) {
	const d = new Date(`${isoDate}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + deltaDays);
	return d.toISOString().slice(0, 10);
}

export function IncomeTransactionsPage({ ledger, onBack, navigate, onEditTransaction }) {
	const transactions = useMemo(
		() => (Array.isArray(ledger?.transactions) ? ledger.transactions : []),
		[ledger]
	);

	const [lensKey, setLensKey] = useState('1y');
	const [fundFilter, setFundFilter] = useState('');
	const [typeFilter, setTypeFilter] = useState('');
	const [bannerDismissed, setBannerDismissed] = useState(false);

	const lens = LENS_OPTIONS.find((opt) => opt.key === lensKey) || LENS_OPTIONS[3];

	const txsInLens = useMemo(() => {
		if (lens.days === null) return transactions;
		const from = shiftDays(todayIso(), -lens.days);
		return transactions.filter((tx) => toIsoDay(tx?.date) >= from);
	}, [transactions, lens]);

	const summary = useMemo(() => {
		let buyCount = 0, sellCount = 0, buyAmount = 0, sellAmount = 0;
		for (const tx of txsInLens) {
			const amt = computeAmount(tx);
			if (tx?.type === 'BUY') {
				buyCount += 1;
				if (Number.isFinite(amt)) buyAmount += amt;
			} else if (tx?.type === 'SELL') {
				sellCount += 1;
				if (Number.isFinite(amt)) sellAmount += amt;
			}
		}
		return { buyCount, sellCount, buyAmount, sellAmount };
	}, [txsInLens]);

	const fundOptions = useMemo(() => {
		const map = new Map();
		for (const tx of transactions) {
			if (!tx?.code) continue;
			if (!map.has(tx.code)) map.set(tx.code, { code: tx.code, name: tx.name || tx.code });
		}
		return Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code));
	}, [transactions]);

	const filtered = useMemo(() => {
		return txsInLens.filter((tx) => {
			if (fundFilter && tx?.code !== fundFilter) return false;
			if (typeFilter && tx?.type !== typeFilter) return false;
			return true;
		});
	}, [txsInLens, fundFilter, typeFilter]);

	const sortedDesc = useMemo(() => {
		return [...filtered].sort((a, b) => {
			const da = toIsoDay(a?.date);
			const db = toIsoDay(b?.date);
			if (da === db) return 0;
			return da < db ? 1 : -1;
		});
	}, [filtered]);

	const groups = useMemo(() => {
		const map = new Map();
		for (const tx of sortedDesc) {
			const k = monthKeyOf(toIsoDay(tx?.date));
			if (!map.has(k)) map.set(k, []);
			map.get(k).push(tx);
		}
		return Array.from(map.entries());
	}, [sortedDesc]);

	const winnerLot = useMemo(() => {
		const lots = buildSoldLots(transactions);
		const positive = (Array.isArray(lots) ? lots : []).filter(
			(l) => Number.isFinite(l?.realizedReturnRate) && l.realizedReturnRate > 0
		);
		if (positive.length === 0) return null;
		positive.sort((a, b) => (b.realizedReturnRate || 0) - (a.realizedReturnRate || 0));
		return positive[0];
	}, [transactions]);

	const showBanner = !bannerDismissed && winnerLot !== null;

	return (
		<SubPageShell title="交易记录" onBack={onBack}>
			{/* ① 全部交易汇总 */}
			<div className="rounded-2xl border border-slate-200/70 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-4">
				<div className="flex items-center justify-between gap-2 pb-3">
					<div className="text-sm font-semibold text-slate-800">全部交易汇总</div>
					<select
						value={lensKey}
						onChange={(e) => setLensKey(e.target.value)}
						className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
					>
						{LENS_OPTIONS.map((opt) => (
							<option key={opt.key} value={opt.key}>{opt.label}</option>
						))}
					</select>
				</div>
				<div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
					<SummaryStat count={summary.buyCount} label="买入" amount={summary.buyAmount} tone="buy" />
					<SummaryStat count={summary.sellCount} label="卖出" amount={summary.sellAmount} tone="sell" />
					<SummaryStat count={0} label="定投/发车" amount={0} dim />
					<SummaryStat count={0} label="分红" amount={null} dim subLabel="现金分红 ¥0.00" />
					<SummaryStat count={0} label="预约" amount={0} dim />
				</div>
			</div>

			{/* ② 清仓分析入口 */}
			<button
				type="button"
				onClick={() => navigate && navigate(ROUTES.LIQUIDATION)}
				className="flex w-full items-center justify-between rounded-2xl border border-slate-200/70 bg-white px-4 py-3 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:bg-slate-50"
			>
				<div className="text-sm font-semibold text-slate-800">清仓分析</div>
				<div className="flex items-center gap-1 text-xs text-slate-500">
					<span>分析复盘历史持仓</span>
					<ChevronRight className="size-4" />
				</div>
			</button>

			{/* ③ 跑赢 banner */}
			{showBanner ? (
				<div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-blue-50 to-sky-100 p-4 ring-1 ring-blue-200/60">
					<button
						type="button"
						onClick={() => setBannerDismissed(true)}
						aria-label="关闭提示"
						className="absolute right-2 top-2 inline-flex size-6 items-center justify-center rounded-full text-slate-400 hover:bg-white/60 hover:text-slate-600"
					>
						<X className="size-4" />
					</button>
					<div className="pr-8">
						<div className="text-sm font-semibold text-slate-800">你清仓的基金跑赢大盘指数</div>
						<div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-slate-600 sm:text-[13px]">
							<span className="min-w-0 truncate font-medium text-slate-700">{winnerLot.name || winnerLot.code}</span>
							<span className="inline-flex items-center rounded bg-blue-200/60 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">曾持有</span>
						</div>
						<div className="mt-2 flex items-center justify-between gap-3">
							<div className="text-[12px] text-slate-600 sm:text-[13px]">
								清仓盈利率 <span className="font-semibold text-rose-600">超 {Number(winnerLot.realizedReturnRate).toFixed(2)}%</span>
							</div>
							<button
								type="button"
								onClick={() => navigate && navigate(ROUTES.LIQUIDATION)}
								className="inline-flex h-7 items-center justify-center whitespace-nowrap rounded-full bg-blue-500 px-3 text-xs font-semibold text-white shadow-sm hover:bg-blue-600"
							>
								去看看
							</button>
						</div>
					</div>
				</div>
			) : null}

			{/* ④ 明细筛选 */}
			<div className="flex items-center justify-between gap-2 px-1">
				<div className="text-sm font-semibold text-slate-800">明细</div>
				<div className="flex items-center gap-1.5">
					<select
						value={fundFilter}
						onChange={(e) => setFundFilter(e.target.value)}
						className="max-w-[140px] truncate rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
					>
						<option value="">基金 ▽</option>
						{fundOptions.map((f) => (
							<option key={f.code} value={f.code}>{f.name}</option>
						))}
					</select>
					<select
						value={typeFilter}
						onChange={(e) => setTypeFilter(e.target.value)}
						className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
					>
						<option value="">全部</option>
						<option value="BUY">买入</option>
						<option value="SELL">卖出</option>
					</select>
				</div>
			</div>

			{/* ⑤ 明细列表 */}
			{groups.length === 0 ? (
				<div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 p-6 text-center text-sm text-slate-500">
					当前条件下无交易记录。
				</div>
			) : (
				<div className="flex flex-col gap-3">
					{groups.map(([month, list]) => (
						<section key={month} className="flex flex-col gap-1">
							<div className="flex items-baseline justify-between px-1 text-[11px] font-medium text-slate-500 sm:text-xs">
								<span className="tabular-nums">{month}</span>
								<span className="tabular-nums text-slate-400">{list.length} 笔</span>
							</div>
							<div className="flex flex-col gap-1">
								{list.map((tx) => (
									<Row
										key={tx.id || `${tx.code}-${tx.date}-${tx.shares}`}
										tx={tx}
										onClick={() => onEditTransaction && tx.id && onEditTransaction(tx.id)}
									/>
								))}
							</div>
						</section>
					))}
				</div>
			)}

			<div className="text-[10.5px] leading-relaxed text-slate-400 sm:text-[11px]">
				提示：点击明细行可弹出编辑面板修改。
			</div>
		</SubPageShell>
	);
}

function SummaryStat({ count, label, amount, dim, subLabel, tone }) {
	const countColor = tone === 'buy' ? 'text-rose-600' : tone === 'sell' ? 'text-emerald-600' : dim ? 'text-slate-400' : 'text-slate-900';
	return (
		<div className={cx('flex flex-col gap-0.5', dim ? 'opacity-70' : '')}>
			<div className="flex items-baseline gap-1.5">
				<span className={cx('min-w-0 truncate whitespace-nowrap text-xl font-bold tabular-nums sm:text-2xl', countColor)}>{count}</span>
				<span className="text-xs text-slate-500">次</span>
				<span className={cx('text-xs font-medium', dim ? 'text-slate-400' : 'text-slate-600')}>{label}</span>
			</div>
			{amount === null
				? (subLabel ? <div className="text-[11px] text-slate-500">{subLabel}</div> : null)
				: <div className="min-w-0 truncate whitespace-nowrap text-[11px] tabular-nums text-slate-500">共{formatCurrency(amount, '¥', 2)}</div>}
		</div>
	);
}

function Row({ tx, onClick }) {
	const amount = computeAmount(tx);
	const isBuy = tx?.type === 'BUY';
	const tone = isBuy ? TONE_BUY : TONE_SELL;
	const label = isBuy ? '买入' : '卖出';
	return (
		<button
			type="button"
			onClick={onClick}
			className="grid min-w-0 w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 rounded-xl border border-slate-100 bg-white px-3 py-2.5 text-left transition-colors hover:bg-slate-50 active:bg-slate-100"
		>
			<span className={cx('inline-flex w-12 shrink-0 items-center justify-center rounded px-1.5 py-0.5 text-[11px] font-semibold', tone)}>
				{label}
			</span>
			<span className="min-w-0">
				<div className="truncate text-[13px] font-medium text-slate-800">基金 | {tx.name || tx.code || '—'}</div>
				<div className="mt-0.5 text-[11px] text-slate-400 tabular-nums">{toIsoDay(tx.date)}</div>
			</span>
			<span className="min-w-0 max-w-[42%] shrink-0 truncate whitespace-nowrap text-right text-[13px] font-semibold tabular-nums text-slate-800">{amount === null ? '—' : formatCurrency(amount, '¥', 2)}</span>
		</button>
	);
}

export default IncomeTransactionsPage;
