// IncomeBreakdownPage.jsx — #/breakdown 持仓分析
//
// 第四刀实页：
//   ① 概览 KPI（品种数 / 总市值 / 累计盈亏）
//   ② 品种分布饼图（按 marketValue 占比，前 8 + 其他）
//   ③ 资产类型饼图（场内 ETF / 境内场外 / 场外 QDII）+ 类别明细
//   ④ 贡献度榜（盈利 Top 5 + 亏损 Top 5，按 totalProfit 排序）
//
// 数据来源：aggregateByCode(ledger.transactions, ledger.snapshotsByCode)
// kind 字段取值：'exchange'（场内 ETF）/ 'otc'（境内场外）/ 'qdii'（场外 QDII）
// 颜色：涨红跌绿（PNL>0 = rose-600；PNL<0 = emerald-600）

import { useMemo } from 'react';
import {
	PieChart, Pie, Cell, Tooltip as RTooltip, ResponsiveContainer,
} from 'recharts';
import SubPageShell from './SubPageShell.jsx';
import { aggregateByCode } from '../holdingsLedgerCore.js';

// 涨红跌绿
const TONE_UP = 'text-rose-600';
const TONE_DOWN = 'text-emerald-600';
const TONE_NEUTRAL = 'text-slate-700';
const TONE_DIM = 'text-slate-400';

// 品种饼图色板：8 段 + 其他色（slate）
const PIE_PALETTE = [
	'#e11d48', '#f97316', '#eab308', '#16a34a',
	'#0891b2', '#2563eb', '#7c3aed', '#db2777',
];
const OTHER_COLOR = '#94a3b8'; // slate-400

// 资产类型色（区分但保持克制）
const KIND_META = {
	exchange: { label: '场内 ETF', color: '#2563eb', dim: '盘中实时' },
	otc:      { label: '境内场外', color: '#16a34a', dim: 'T 日 21:00 出价' },
	qdii:     { label: '场外 QDII', color: '#f97316', dim: 'T+1 出价' },
};

function formatCurrency(value) {
	const v = Number(value || 0);
	return `¥${v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function formatPercent(value, digits = 2) {
	if (!Number.isFinite(Number(value))) return '—';
	return `${Number(value).toFixed(digits)}%`;
}
function pnlTone(v) {
	if (!Number.isFinite(Number(v)) || Number(v) === 0) return TONE_NEUTRAL;
	return Number(v) > 0 ? TONE_UP : TONE_DOWN;
}
function pnlSign(v) {
	const n = Number(v) || 0;
	if (n > 0) return '+';
	return '';
}

// 把 aggregates → 品种饼图 slices（前 8 + 其他）
function buildVarietySlices(positions) {
	const sorted = [...positions].sort((a, b) => b.marketValue - a.marketValue);
	const top = sorted.slice(0, 8);
	const rest = sorted.slice(8);
	const slices = top.map((p, i) => ({
		key: p.code,
		label: `${p.code} · ${p.name || '未命名'}`,
		code: p.code,
		name: p.name,
		value: p.marketValue,
		color: PIE_PALETTE[i % PIE_PALETTE.length],
	}));
	if (rest.length > 0) {
		const restValue = rest.reduce((s, p) => s + p.marketValue, 0);
		if (restValue > 0) {
			slices.push({
				key: '__other__',
				label: `其他 (${rest.length} 只)`,
				code: '',
				name: `其他 (${rest.length} 只)`,
				value: restValue,
				color: OTHER_COLOR,
			});
		}
	}
	return slices;
}

function buildKindSlices(positions) {
	const byKind = new Map();
	for (const p of positions) {
		const k = p.kind || 'otc';
		if (!byKind.has(k)) byKind.set(k, { kind: k, marketValue: 0, totalCost: 0, totalProfit: 0, count: 0 });
		const bucket = byKind.get(k);
		bucket.marketValue += p.marketValue;
		bucket.totalCost += p.totalCost;
		bucket.totalProfit += p.totalProfit;
		bucket.count += 1;
	}
	return ['exchange', 'otc', 'qdii']
		.map((k) => byKind.get(k))
		.filter(Boolean)
		.map((b) => {
			const meta = KIND_META[b.kind] || { label: b.kind, color: '#64748b', dim: '' };
			const returnRate = b.totalCost > 0 ? (b.totalProfit / b.totalCost) * 100 : 0;
			return { ...b, ...meta, returnRate };
		});
}

// 自定义 Tooltip
function VarietyTooltip({ active, payload, total }) {
	if (!active || !payload || !payload[0]) return null;
	const d = payload[0].payload;
	const pct = total > 0 ? (d.value / total) * 100 : 0;
	return (
		<div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-md">
			<div className="font-medium text-slate-800">{d.label}</div>
			<div className="mt-1 text-slate-600">市值 {formatCurrency(d.value)}</div>
			<div className="text-slate-500">占比 {pct.toFixed(2)}%</div>
		</div>
	);
}

function KindTooltip({ active, payload, total }) {
	if (!active || !payload || !payload[0]) return null;
	const d = payload[0].payload;
	const pct = total > 0 ? (d.marketValue / total) * 100 : 0;
	return (
		<div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-md">
			<div className="font-medium text-slate-800">{d.label}</div>
			<div className="mt-1 text-slate-600">市值 {formatCurrency(d.marketValue)}（{pct.toFixed(2)}%）</div>
			<div className={pnlTone(d.totalProfit)}>{pnlSign(d.totalProfit)}{formatCurrency(d.totalProfit)} · {formatPercent(d.returnRate)}</div>
			<div className="text-slate-400">{d.count} 只 · {d.dim}</div>
		</div>
	);
}

function SectionCard({ title, hint, children }) {
	return (
		<section className="rounded-2xl border border-slate-200 bg-white p-4">
			<header className="mb-3 flex items-baseline justify-between gap-3">
				<h3 className="text-sm font-medium text-slate-800">{title}</h3>
				{hint ? <span className="text-xs text-slate-400">{hint}</span> : null}
			</header>
			{children}
		</section>
	);
}

function OverviewCard({ count, marketValue, totalProfit, returnRate }) {
	return (
		<section className="rounded-2xl border border-slate-200 bg-white p-4">
			<div className="grid grid-cols-3 gap-3">
				<div>
					<div className="text-xs text-slate-500">持仓品种</div>
					<div className="mt-1 text-xl font-medium text-slate-800">{count} <span className="text-sm text-slate-400">只</span></div>
				</div>
				<div>
					<div className="text-xs text-slate-500">总市值</div>
					<div className="mt-1 text-xl font-medium text-slate-800">{formatCurrency(marketValue)}</div>
				</div>
				<div>
					<div className="text-xs text-slate-500">累计盈亏</div>
					<div className={`mt-1 text-xl font-medium ${pnlTone(totalProfit)}`}>
						{pnlSign(totalProfit)}{formatCurrency(totalProfit)}
					</div>
					<div className={`text-xs ${pnlTone(totalProfit)}`}>{pnlSign(returnRate)}{formatPercent(returnRate)}</div>
				</div>
			</div>
		</section>
	);
}

function VarietyChart({ slices, total }) {
	if (!slices.length || total <= 0) {
		return <div className="py-8 text-center text-sm text-slate-400">暂无持仓数据</div>;
	}
	return (
		<div className="grid grid-cols-1 gap-3 sm:grid-cols-[260px_1fr] sm:items-center">
			<div className="h-[220px]">
				<ResponsiveContainer width="100%" height="100%">
					<PieChart>
						<Pie
							data={slices}
							dataKey="value"
							nameKey="label"
							cx="50%"
							cy="50%"
							innerRadius={45}
							outerRadius={85}
							paddingAngle={1.5}
							stroke="#fff"
							strokeWidth={2}
						>
							{slices.map((s) => <Cell key={s.key} fill={s.color} />)}
						</Pie>
						<RTooltip content={<VarietyTooltip total={total} />} />
					</PieChart>
				</ResponsiveContainer>
			</div>
			<ul className="flex flex-col gap-1.5 text-xs">
				{slices.map((s) => {
					const pct = total > 0 ? (s.value / total) * 100 : 0;
					return (
						<li key={s.key} className="flex items-center gap-2">
							<span className="size-2.5 shrink-0 rounded-sm" style={{ background: s.color }} />
							<span className="flex-1 truncate text-slate-700">{s.label}</span>
							<span className="tabular-nums text-slate-500">{pct.toFixed(1)}%</span>
						</li>
					);
				})}
			</ul>
		</div>
	);
}

function KindChart({ slices, total }) {
	if (!slices.length || total <= 0) {
		return <div className="py-8 text-center text-sm text-slate-400">暂无持仓数据</div>;
	}
	return (
		<div className="grid grid-cols-1 gap-3 sm:grid-cols-[220px_1fr] sm:items-center">
			<div className="h-[200px]">
				<ResponsiveContainer width="100%" height="100%">
					<PieChart>
						<Pie
							data={slices}
							dataKey="marketValue"
							nameKey="label"
							cx="50%"
							cy="50%"
							innerRadius={42}
							outerRadius={80}
							paddingAngle={2}
							stroke="#fff"
							strokeWidth={2}
						>
							{slices.map((s) => <Cell key={s.kind} fill={s.color} />)}
						</Pie>
						<RTooltip content={<KindTooltip total={total} />} />
					</PieChart>
				</ResponsiveContainer>
			</div>
			<ul className="flex flex-col gap-2 text-xs">
				{slices.map((s) => {
					const pct = total > 0 ? (s.marketValue / total) * 100 : 0;
					return (
						<li key={s.kind} className="flex items-start gap-2">
							<span className="mt-1 size-2.5 shrink-0 rounded-sm" style={{ background: s.color }} />
							<div className="flex-1">
								<div className="flex items-baseline justify-between gap-2">
									<span className="text-slate-800">{s.label} <span className="text-slate-400">· {s.count} 只</span></span>
									<span className="tabular-nums text-slate-500">{pct.toFixed(1)}%</span>
								</div>
								<div className="mt-0.5 flex items-baseline justify-between gap-2">
									<span className="text-slate-600">{formatCurrency(s.marketValue)}</span>
									<span className={`tabular-nums ${pnlTone(s.totalProfit)}`}>
										{pnlSign(s.totalProfit)}{formatCurrency(s.totalProfit)} · {pnlSign(s.returnRate)}{formatPercent(s.returnRate)}
									</span>
								</div>
							</div>
						</li>
					);
				})}
			</ul>
		</div>
	);
}

function ContributionRow({ p, rank }) {
	return (
		<li className="grid grid-cols-[auto_1fr_auto] items-center gap-2 rounded-lg border border-slate-100 bg-slate-50/40 px-2.5 py-2 sm:grid-cols-[auto_1.5fr_1fr_auto]">
			<span className="size-6 shrink-0 rounded-full bg-white text-center text-xs leading-6 text-slate-500 ring-1 ring-slate-200">{rank}</span>
			<div className="min-w-0">
				<div className="truncate text-sm text-slate-800">{p.name || '未命名'}</div>
				<div className="flex items-center gap-1.5 text-xs text-slate-400">
					<span className="tabular-nums">{p.code}</span>
					<span className="size-1 rounded-full bg-slate-300" />
					<span>{(KIND_META[p.kind] || { label: p.kind }).label}</span>
				</div>
			</div>
			<div className="hidden text-right text-xs text-slate-500 sm:block">
				<div className="tabular-nums">{formatCurrency(p.marketValue)}</div>
				<div className={TONE_DIM}>成本 {formatCurrency(p.totalCost)}</div>
			</div>
			<div className="text-right">
				<div className={`text-sm tabular-nums ${pnlTone(p.totalProfit)}`}>
					{pnlSign(p.totalProfit)}{formatCurrency(p.totalProfit)}
				</div>
				<div className={`text-xs tabular-nums ${pnlTone(p.totalProfit)}`}>
					{pnlSign(p.totalReturnRate)}{formatPercent(p.totalReturnRate)}
				</div>
			</div>
		</li>
	);
}

function ContributionPanel({ winners, losers }) {
	if (!winners.length && !losers.length) {
		return <div className="py-8 text-center text-sm text-slate-400">暂无可分析的盈亏数据</div>;
	}
	return (
		<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
			<div>
				<div className="mb-2 flex items-baseline justify-between">
					<h4 className="text-xs font-medium text-slate-600">盈利 Top {winners.length}</h4>
					<span className={`text-xs ${TONE_UP}`}>涨</span>
				</div>
				{winners.length === 0 ? (
					<div className="rounded-lg border border-dashed border-slate-200 py-4 text-center text-xs text-slate-400">暂无盈利标的</div>
				) : (
					<ul className="flex flex-col gap-1.5">
						{winners.map((p, i) => <ContributionRow key={p.code} p={p} rank={i + 1} />)}
					</ul>
				)}
			</div>
			<div>
				<div className="mb-2 flex items-baseline justify-between">
					<h4 className="text-xs font-medium text-slate-600">亏损 Top {losers.length}</h4>
					<span className={`text-xs ${TONE_DOWN}`}>跌</span>
				</div>
				{losers.length === 0 ? (
					<div className="rounded-lg border border-dashed border-slate-200 py-4 text-center text-xs text-slate-400">暂无亏损标的</div>
				) : (
					<ul className="flex flex-col gap-1.5">
						{losers.map((p, i) => <ContributionRow key={p.code} p={p} rank={i + 1} />)}
					</ul>
				)}
			</div>
		</div>
	);
}

export function IncomeBreakdownPage({ ledger, onBack }) {
	const aggregates = useMemo(
		() => aggregateByCode(ledger?.transactions || [], ledger?.snapshotsByCode || {}),
		[ledger],
	);

	const positions = useMemo(
		() => aggregates.filter((a) => a.hasPosition && a.marketValue > 0),
		[aggregates],
	);

	const overview = useMemo(() => {
		const marketValue = positions.reduce((s, p) => s + p.marketValue, 0);
		const totalCost = positions.reduce((s, p) => s + p.totalCost, 0);
		const totalProfit = positions.reduce((s, p) => s + p.totalProfit, 0);
		const returnRate = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0;
		return { count: positions.length, marketValue, totalCost, totalProfit, returnRate };
	}, [positions]);

	const varietySlices = useMemo(() => buildVarietySlices(positions), [positions]);
	const kindSlices = useMemo(() => buildKindSlices(positions), [positions]);

	const { winners, losers } = useMemo(() => {
		const sorted = [...positions].sort((a, b) => b.totalProfit - a.totalProfit);
		const win = sorted.filter((p) => p.totalProfit > 0).slice(0, 5);
		const lose = sorted.filter((p) => p.totalProfit < 0).slice(-5).reverse();
		return { winners: win, losers: lose };
	}, [positions]);

	if (positions.length === 0) {
		return (
			<SubPageShell title="持仓分析" onBack={onBack}>
				<div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 p-8 text-center text-sm text-slate-500">
					还没有持仓数据。
					<div className="mt-1 text-xs text-slate-400">添加交易后再回来查看品种与类型分布。</div>
				</div>
			</SubPageShell>
		);
	}

	return (
		<SubPageShell title="持仓分析" onBack={onBack}>
			<OverviewCard
				count={overview.count}
				marketValue={overview.marketValue}
				totalProfit={overview.totalProfit}
				returnRate={overview.returnRate}
			/>

			<SectionCard title="品种分布" hint={`前 ${Math.min(8, positions.length)} + 其他`}>
				<VarietyChart slices={varietySlices} total={overview.marketValue} />
			</SectionCard>

			<SectionCard title="资产类型" hint="按 NAV 出价节奏分类">
				<KindChart slices={kindSlices} total={overview.marketValue} />
			</SectionCard>

			<SectionCard title="贡献度榜" hint="按累计盈亏排序">
				<ContributionPanel winners={winners} losers={losers} />
			</SectionCard>

			<div className="px-1 pb-2 text-xs text-slate-400">
				* 数据口径：移动摊薄成本法（与支付宝 / 天天基金一致）；颜色规则：涨红跌绿。
			</div>
		</SubPageShell>
	);
}

export default IncomeBreakdownPage;
