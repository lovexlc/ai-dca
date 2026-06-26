// IncomeBreakdownPage.jsx — #/breakdown 持仓分析
//
// 第四刀实页：
//   ① 概览 KPI（品种数 / 总市值 / 累计盈亏）
//   ② 品种分布饼图（按 marketValue 占比，前 8 + 其他）
//   ③ 资产类型饼图（场内 ETF / 境内场外 / 场外 QDII）+ 类别明细
//   ④ 贡献度榜（盈利 Top 5 + 亏损 Top 5，按 unrealizedProfit 排序）
//   ⑤ 仓位监控 / 再平衡（合并自原「仓位」子 tab）——个股单仓 cap（20 / 30 / 50%）告警 +
//      减仓金额建议。在 US ticker 上线前，临时把 kind === 'exchange'（场内 ETF）当「宽基
//      指数」不限仓（中国纳指 ETF 作 QQQ 替代）；otc / qdii 受 cap 约束。
//
// 数据来源：aggregateByCode(ledger.transactions, ledger.snapshotsByCode)
// kind 字段取值：'exchange'（场内 ETF）/ 'otc'（境内场外）/ 'qdii'（场外 QDII）
// 颜色：涨红跌绿（PNL>0 = rose-600；PNL<0 = emerald-600）

import { useEffect, useMemo, useState } from 'react';
import {
	PieChart, Pie, Cell, Tooltip as RTooltip, ResponsiveContainer,
	BarChart, Bar, XAxis, YAxis, CartesianGrid, ReferenceLine,
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

// 仓位 cap 默认值（对齐原 PositionManager 的 STOCK_MAX_WEIGHT_PCT）。
// 用户可在面板调整，与 SellPlan / notifySync 共享 localStorage 键 aiDcaPositionSnapshot。
const DEFAULT_CAP_PCT = 50;
const POSITION_CONFIG_KEY = 'aiDcaPositionSnapshot';
const BAR_COLOR_INDEX = '#16a34a'; // 宽基 — 绿
const BAR_COLOR_STOCK = '#2563eb'; // 个股 — 蓝
const BAR_COLOR_OVER  = '#e11d48'; // 超仓 — 红
const CHART_INITIAL_DIMENSION = { width: 1, height: 1 };

function readPositionConfig() {
	if (typeof window === 'undefined') return {};
	try {
		return JSON.parse(window.localStorage.getItem(POSITION_CONFIG_KEY) || '{}') || {};
	} catch (_e) { return {}; }
}
function writePositionConfig(patch) {
	if (typeof window === 'undefined') return;
	try {
		const prev = readPositionConfig();
		const next = { ...prev, ...patch, updatedAt: new Date().toISOString() };
		window.localStorage.setItem(POSITION_CONFIG_KEY, JSON.stringify(next));
	} catch (_e) { /* ignore */ }
}

// 计算 cap 告警 + 减仓建议。
// 临时规则：kind === 'exchange'（场内 ETF）作「宽基指数」不限仓，其他受 cap 约束。
// 待 US ticker 上线后，会补上 getAssetType 判定。
function computeCapAnalysis(positions, { capPct, totalAssets }) {
	const totalMarketValue = positions.reduce((s, p) => s + p.marketValue, 0);
	const safeTotal = Math.max(Number(totalAssets) || 0, 0);
	const denom = safeTotal > totalMarketValue ? safeTotal : totalMarketValue;
	const cashValue = Math.max(denom - totalMarketValue, 0);
	const rows = positions.map((p) => {
		const isIndex = p.kind === 'exchange';
		const weightPct = denom > 0 ? (p.marketValue / denom) * 100 : 0;
		const exceedsCap = !isIndex && weightPct > capPct;
		const trimAmount = exceedsCap ? p.marketValue - (capPct / 100) * denom : 0;
		return {
			code: p.code,
			name: p.name,
			kind: p.kind,
			isIndex,
			marketValue: Math.round(p.marketValue * 100) / 100,
			weightPct: Math.round(weightPct * 100) / 100,
			exceedsCap,
			trimAmount: Math.max(0, Math.round(trimAmount * 100) / 100),
		};
	}).sort((a, b) => b.weightPct - a.weightPct);
	const warnings = rows.filter((r) => r.exceedsCap);
	const maxWeight = rows.length ? rows[0].weightPct : 0;
	return {
		rows,
		totalMarketValue: Math.round(totalMarketValue * 100) / 100,
		totalAssets: Math.round(denom * 100) / 100,
		cashValue: Math.round(cashValue * 100) / 100,
		cashWeightPct: denom > 0 ? Math.round((cashValue / denom) * 10000) / 100 : 0,
		warnings,
		maxWeight,
	};
}

const CAP_BAR_MARGIN = Object.freeze({ top: 12, right: 24, bottom: 8, left: 0 });
const CAP_BAR_TICK_X = Object.freeze({ fontSize: 11, fill: '#64748b' });
const CAP_BAR_TICK_Y = Object.freeze({ fontSize: 11, fill: '#94a3b8' });

function PositionBarTooltip({ active, payload, capPct }) {
	if (!active || !payload || !payload[0]) return null;
	const d = payload[0].payload;
	return (
		<div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-md">
			<div className="font-medium text-slate-800">{d.code} · {d.name || '未命名'}</div>
			<div className="mt-1 text-slate-600">市值 {formatCurrency(d.marketValue)}</div>
			<div className="text-slate-600">权重 {d.weightPct.toFixed(2)}% <span className="text-slate-400">/ 上限 {d.isIndex ? '—' : `${capPct}%`}</span></div>
			{d.exceedsCap ? <div className={TONE_UP}>超仓 {(d.weightPct - capPct).toFixed(2)} pp</div> : null}
		</div>
	);
}

function PositionCapPanel({ positions }) {
	const initial = useMemo(() => readPositionConfig(), []);
	const [capPct, setCapPct] = useState(() => {
		const n = Number(initial.capPct);
		return Number.isFinite(n) && n > 0 && n <= 100 ? n : DEFAULT_CAP_PCT;
	});
	const [totalAssetsInput, setTotalAssetsInput] = useState(() => {
		const n = Number(initial.totalAssets);
		return Number.isFinite(n) && n > 0 ? String(n) : '';
	});

	useEffect(() => {
		writePositionConfig({
			capPct: Number(capPct) || DEFAULT_CAP_PCT,
			totalAssets: Number(totalAssetsInput) || 0,
		});
	}, [capPct, totalAssetsInput]);

	const analysis = useMemo(
		() => computeCapAnalysis(positions, { capPct, totalAssets: Number(totalAssetsInput) || 0 }),
		[positions, capPct, totalAssetsInput],
	);

	const chartData = analysis.rows.map((r) => ({ ...r, capPct }));
	const hasOverCap = analysis.warnings.length > 0;

	return (
		<div className="space-y-3">
			{/* 配置行 */}
			<div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
				<label className="flex flex-col gap-0.5 rounded-lg border border-slate-200 px-3 py-2">
					<span className="text-xs text-slate-500">个股仓位上限</span>
					<span className="flex items-baseline gap-1">
						<input
							type="text"
							inputMode="decimal"
							value={capPct}
							onChange={(e) => setCapPct(e.target.value)}
							min="1"
							max="100"
							step="1"
							className="w-16 border-0 bg-transparent p-0 text-base font-medium tabular-nums text-slate-800 outline-none"
						/>
						<span className="text-sm text-slate-400">%</span>
					</span>
				</label>
				<label className="flex flex-col gap-0.5 rounded-lg border border-slate-200 px-3 py-2">
					<span className="text-xs text-slate-500">总资产（含现金）</span>
					<span className="flex items-baseline gap-1">
						<span className="text-sm text-slate-400">¥</span>
						<input
							type="text"
							inputMode="decimal"
							value={totalAssetsInput}
							onChange={(e) => setTotalAssetsInput(e.target.value)}
							min="0"
							step="100"
							placeholder="留空 = 仅按持仓市值"
							className="w-full border-0 bg-transparent p-0 text-base font-medium tabular-nums text-slate-800 outline-none"
						/>
					</span>
				</label>
				<div className="rounded-lg border border-slate-200 px-3 py-2">
					<div className="text-xs text-slate-500">现金仓位</div>
					<div className="text-base font-medium tabular-nums text-slate-800">{analysis.cashWeightPct.toFixed(2)}%</div>
					<div className="text-xs text-slate-400 tabular-nums">{formatCurrency(analysis.cashValue)}</div>
				</div>
				<div className="rounded-lg border border-slate-200 px-3 py-2">
					<div className="text-xs text-slate-500">超仓警告</div>
					<div className={`text-base font-medium tabular-nums ${hasOverCap ? TONE_UP : 'text-slate-800'}`}>{analysis.warnings.length}<span className="text-sm text-slate-400"> 只</span></div>
					<div className="text-xs text-slate-400">最大单仓 {analysis.maxWeight.toFixed(2)}%</div>
				</div>
			</div>

			{/* 柱状图 */}
			{chartData.length === 0 ? (
				<div className="py-6 text-center text-sm text-slate-400">暂无持仓数据</div>
			) : (
				<div className="h-56 min-w-0 w-full">
					<ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={CHART_INITIAL_DIMENSION}>
						<BarChart data={chartData} margin={CAP_BAR_MARGIN}>
							<CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
							<XAxis dataKey="code" tick={CAP_BAR_TICK_X} interval={0} angle={chartData.length > 8 ? -30 : 0} textAnchor={chartData.length > 8 ? 'end' : 'middle'} height={chartData.length > 8 ? 48 : 30} />
							<YAxis tick={CAP_BAR_TICK_Y} unit="%" domain={[0, Math.max(capPct + 10, ...chartData.map((d) => d.weightPct + 5), 60)]} />
							<RTooltip content={<PositionBarTooltip capPct={capPct} />} />
							<ReferenceLine y={capPct} stroke="#f97316" strokeDasharray="4 4" label={{ value: `上限 ${capPct}%`, position: 'right', fill: '#f97316', fontSize: 11 }} />
							<Bar dataKey="weightPct" radius={[6, 6, 0, 0]}>
								{chartData.map((d) => (
									<Cell key={d.code} fill={d.exceedsCap ? BAR_COLOR_OVER : d.isIndex ? BAR_COLOR_INDEX : BAR_COLOR_STOCK} />
								))}
							</Bar>
						</BarChart>
					</ResponsiveContainer>
				</div>
			)}

			{/* 再平衡建议 */}
			<div className="space-y-1.5">
				{analysis.warnings.length === 0 ? (
					<div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
						✓ 所有个股持仓都在 {capPct}% 上限内。场内 ETF 作「宽基指数」不限仓。
					</div>
				) : (
					analysis.warnings.map((w) => (
						<div key={w.code} className="flex items-start justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
							<div className="min-w-0">
								<span className="font-medium">{w.code} · {w.name || '未命名'}</span>
								<span className="ml-2 text-rose-500">仓位 {w.weightPct.toFixed(2)}% / 上限 {capPct}%</span>
							</div>
							<div className="shrink-0 text-right">
								<div>建议减仓</div>
								<div className="font-medium tabular-nums">{formatCurrency(w.trimAmount)}</div>
							</div>
						</div>
					))
				)}
			</div>

			<p className="px-1 text-xs text-slate-400">
				* 临时规则：场内 ETF（含中国纳指 ETF，作 QQQ 替代）作「宽基指数」不限仓；场外 / QDII 受 cap 约束。
				US ticker 上线后会接 getAssetType 判定。总资产 · cap 存于 `aiDcaPositionSnapshot`，与 SellPlan · worker 推送共享。
			</p>
		</div>
	);
}

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
		if (!byKind.has(k)) byKind.set(k, { kind: k, marketValue: 0, totalCost: 0, unrealizedProfit: 0, count: 0 });
		const bucket = byKind.get(k);
		bucket.marketValue += p.marketValue;
		bucket.totalCost += p.totalCost;
		bucket.unrealizedProfit += p.unrealizedProfit;
		bucket.count += 1;
	}
	return ['exchange', 'otc', 'qdii']
		.map((k) => byKind.get(k))
		.filter(Boolean)
		.map((b) => {
			const meta = KIND_META[b.kind] || { label: b.kind, color: '#64748b', dim: '' };
			const returnRate = b.totalCost > 0 ? (b.unrealizedProfit / b.totalCost) * 100 : 0;
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

function swatchStyle(color) {
	return { backgroundColor: color };
}

function KindTooltip({ active, payload, total }) {
	if (!active || !payload || !payload[0]) return null;
	const d = payload[0].payload;
	const pct = total > 0 ? (d.marketValue / total) * 100 : 0;
	return (
		<div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-md">
			<div className="font-medium text-slate-800">{d.label}</div>
			<div className="mt-1 text-slate-600">市值 {formatCurrency(d.marketValue)}（{pct.toFixed(2)}%）</div>
			<div className={pnlTone(d.unrealizedProfit)}>{pnlSign(d.unrealizedProfit)}{formatCurrency(d.unrealizedProfit)} · {formatPercent(d.returnRate)}</div>
			<div className="text-slate-400">{d.count} 只 · {d.dim}</div>
		</div>
	);
}

function SectionCard({ title, hint, children }) {
	return (
		<section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4">
			<header className="mb-3 flex min-w-0 items-baseline justify-between gap-3">
				<h3 className="min-w-0 truncate text-sm font-medium text-slate-800">{title}</h3>
				{hint ? <span className="shrink-0 text-xs text-slate-400">{hint}</span> : null}
			</header>
			{children}
		</section>
	);
}

function OverviewCard({ count, marketValue, unrealizedProfit, returnRate }) {
	return (
		<section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4">
			<div className="grid min-w-0 grid-cols-[0.68fr_minmax(0,1fr)_minmax(0,1fr)] gap-3 sm:grid-cols-3">
				<div className="min-w-0">
					<div className="text-xs text-slate-500">持仓品种</div>
					<div className="mt-1 truncate whitespace-nowrap text-lg font-medium tabular-nums text-slate-800 sm:text-xl">{count} <span className="text-sm text-slate-400">只</span></div>
				</div>
				<div className="min-w-0">
					<div className="text-xs text-slate-500">总市值</div>
					<div className="mt-1 truncate whitespace-nowrap text-lg font-medium tabular-nums text-slate-800 sm:text-xl">{formatCurrency(marketValue)}</div>
				</div>
				<div className="min-w-0">
					<div className="text-xs text-slate-500">累计盈亏</div>
					<div className={`mt-1 truncate whitespace-nowrap text-lg font-medium tabular-nums sm:text-xl ${pnlTone(unrealizedProfit)}`}>
						{pnlSign(unrealizedProfit)}{formatCurrency(unrealizedProfit)}
					</div>
					<div className={`truncate whitespace-nowrap text-xs tabular-nums ${pnlTone(unrealizedProfit)}`}>{pnlSign(returnRate)}{formatPercent(returnRate)}</div>
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
		<div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-[260px_minmax(0,1fr)] sm:items-center">
			<div className="h-[220px] min-w-0">
				<ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={CHART_INITIAL_DIMENSION}>
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
			<ul className="flex min-w-0 flex-col gap-1.5 text-xs">
				{slices.map((s) => {
					const pct = total > 0 ? (s.value / total) * 100 : 0;
					return (
						<li key={s.key} className="flex min-w-0 items-center gap-2">
							<span className="size-2.5 shrink-0 rounded-sm" style={swatchStyle(s.color)} />
							<span className="min-w-0 flex-1 truncate text-slate-700">{s.label}</span>
							<span className="shrink-0 whitespace-nowrap tabular-nums text-slate-500">{pct.toFixed(1)}%</span>
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
		<div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-[220px_minmax(0,1fr)] sm:items-center">
			<div className="h-[200px] min-w-0">
				<ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={CHART_INITIAL_DIMENSION}>
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
			<ul className="flex min-w-0 flex-col gap-2 text-xs">
				{slices.map((s) => {
					const pct = total > 0 ? (s.marketValue / total) * 100 : 0;
					return (
						<li key={s.kind} className="flex min-w-0 items-start gap-2">
							<span className="mt-1 size-2.5 shrink-0 rounded-sm" style={swatchStyle(s.color)} />
							<div className="min-w-0 flex-1">
								<div className="flex min-w-0 items-baseline justify-between gap-2">
									<span className="min-w-0 truncate text-slate-800">{s.label} <span className="text-slate-400">· {s.count} 只</span></span>
									<span className="shrink-0 whitespace-nowrap tabular-nums text-slate-500">{pct.toFixed(1)}%</span>
								</div>
								<div className="mt-0.5 flex min-w-0 items-baseline justify-between gap-2">
									<span className="min-w-0 truncate whitespace-nowrap tabular-nums text-slate-600">{formatCurrency(s.marketValue)}</span>
									<span className={`shrink-0 truncate whitespace-nowrap tabular-nums ${pnlTone(s.unrealizedProfit)}`}>
										{pnlSign(s.unrealizedProfit)}{formatCurrency(s.unrealizedProfit)} · {pnlSign(s.returnRate)}{formatPercent(s.returnRate)}
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
		<li className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-slate-100 bg-slate-50/40 px-2.5 py-2 sm:grid-cols-[auto_minmax(0,1.5fr)_minmax(0,1fr)_auto]">
			<span className="size-6 shrink-0 rounded-full bg-white text-center text-xs leading-6 text-slate-500 ring-1 ring-slate-200">{rank}</span>
			<div className="min-w-0">
				<div className="truncate text-sm text-slate-800">{p.name || '未命名'}</div>
				<div className="flex min-w-0 items-center gap-1.5 text-xs text-slate-400">
					<span className="shrink-0 tabular-nums">{p.code}</span>
					<span className="size-1 rounded-full bg-slate-300" />
					<span className="min-w-0 truncate">{(KIND_META[p.kind] || { label: p.kind }).label}</span>
				</div>
			</div>
			<div className="hidden min-w-0 text-right text-xs text-slate-500 sm:block">
				<div className="truncate whitespace-nowrap tabular-nums">{formatCurrency(p.marketValue)}</div>
				<div className={`truncate whitespace-nowrap tabular-nums ${TONE_DIM}`}>成本 {formatCurrency(p.totalCost)}</div>
			</div>
			<div className="min-w-0 text-right">
				<div className={`truncate whitespace-nowrap text-sm tabular-nums ${pnlTone(p.unrealizedProfit)}`}>
					{pnlSign(p.unrealizedProfit)}{formatCurrency(p.unrealizedProfit)}
				</div>
				<div className={`truncate whitespace-nowrap text-xs tabular-nums ${pnlTone(p.unrealizedProfit)}`}>
					{pnlSign(p.unrealizedReturnRate)}{formatPercent(p.unrealizedReturnRate)}
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

export function IncomeBreakdownPage({ ledger, onBack, navigate, currentRoute }) {
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
		const unrealizedProfit = positions.reduce((s, p) => s + p.unrealizedProfit, 0);
		const returnRate = totalCost > 0 ? (unrealizedProfit / totalCost) * 100 : 0;
		return { count: positions.length, marketValue, totalCost, unrealizedProfit, returnRate };
	}, [positions]);

	const varietySlices = useMemo(() => buildVarietySlices(positions), [positions]);
	const kindSlices = useMemo(() => buildKindSlices(positions), [positions]);

	const { winners, losers } = useMemo(() => {
		const sorted = [...positions].sort((a, b) => b.unrealizedProfit - a.unrealizedProfit);
		const win = sorted.filter((p) => p.unrealizedProfit > 0).slice(0, 5);
		const lose = sorted.filter((p) => p.unrealizedProfit < 0).slice(-5).reverse();
		return { winners: win, losers: lose };
	}, [positions]);

	if (positions.length === 0) {
		return (
			<SubPageShell title="持仓分析" onBack={onBack} navigate={navigate} currentRoute={currentRoute}>
				<div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 p-8 text-center text-sm text-slate-500">
					还没有持仓数据。
					<div className="mt-1 text-xs text-slate-400">添加交易后再回来查看品种与类型分布。</div>
				</div>
			</SubPageShell>
		);
	}

	return (
		<SubPageShell title="持仓分析" onBack={onBack} navigate={navigate} currentRoute={currentRoute}>
			<OverviewCard
				count={overview.count}
				marketValue={overview.marketValue}
				unrealizedProfit={overview.unrealizedProfit}
				returnRate={overview.returnRate}
			/>

			<SectionCard title="品种分布" hint={`前 ${Math.min(8, positions.length)} + 其他`}>
				<VarietyChart slices={varietySlices} total={overview.marketValue} />
			</SectionCard>

			<SectionCard title="资产类型" hint="按 NAV 出价节奏分类">
				<KindChart slices={kindSlices} total={overview.marketValue} />
			</SectionCard>

			<SectionCard title="仓位监控 / 再平衡" hint="场内 ETF 作「宽基指数」不限仓">
				<PositionCapPanel positions={positions} />
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
