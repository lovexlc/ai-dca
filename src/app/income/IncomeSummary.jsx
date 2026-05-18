// IncomeSummary.jsx · v6.9 单卡支付宝风格
//
// 单卡 hero + 3 列 KPI + 4 入口：
//   - 顶部：总市值（金额大字）+ 右侧刷新按钮
//   - PC：sparkline仅 PC。移动端隐藏 sparkline、保持纯文字。
//   - 中部：3 列 KPI（今日 / 持有 / 累计） - 今日 rose-50 背景轻微强调
//   - 入口区：4 个 lucide 单色线性 icon tile
//
// 入参：
//   - portfolio：HoldingsExperience L221 useMemo 的集计对象
//   - navigate：跳转子页
//   - navRefresh：{ onClick, loading, hasFailures, title }，顶部右侧刷新按钮
//   - cumulativeSeries：可选 number[]，sparkline 数据源（仅 PC 渲染）

import { ROUTES } from '../incomeRoute.js';
import { cx } from '../../components/experience-ui.jsx';
import { formatCurrency, formatPercent } from '../accumulation.js';
import { RefreshCw, BarChart3, Receipt, PieChart, ArrowLeftRight } from 'lucide-react';

const TONE_UP = 'text-rose-600';
const TONE_DOWN = 'text-emerald-600';
const TONE_NEUTRAL = 'text-slate-500';

const TILES = [
	{ route: ROUTES.INCOME, Icon: BarChart3, label: '收益明细' },
	{ route: ROUTES.LIQUIDATION, Icon: Receipt, label: '清仓分析' },
	{ route: ROUTES.BREAKDOWN, Icon: PieChart, label: '持仓分析' },
	{ route: ROUTES.TRANSACTIONS, Icon: ArrowLeftRight, label: '交易记录' },
];

function signTone(value) {
	if (!Number.isFinite(value) || value === 0) return TONE_NEUTRAL;
	return value > 0 ? TONE_UP : TONE_DOWN;
}

function trimFixed(value, digits = 2) {
	return Number(value).toFixed(digits).replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
}

function formatCompactCurrency(value, { compactFrom = 10000 } = {}) {
	if (!Number.isFinite(value)) return '—';
	const abs = Math.abs(value);
	if (abs >= 100000000) return `¥ ${trimFixed(value / 100000000)}亿`;
	if (abs >= compactFrom) return `¥ ${trimFixed(value / 10000)}万`;
	return formatCurrency(value, '¥', 2);
}

function renderSignedCurrency(value, options) {
	if (!Number.isFinite(value)) return '—';
	const abs = formatCompactCurrency(Math.abs(value), options);
	if (value > 0) return `+${abs}`;
	if (value < 0) return `-${abs}`;
	return abs;
}

function renderSignedPercent(value) {
	if (!Number.isFinite(value)) return '—';
	const sign = value > 0 ? '+' : value < 0 ? '-' : '';
	return `${sign}${formatPercent(Math.abs(value))}`;
}

// SVG sparkline。给定 number[]，自动归一化绘制。tone 决定描边色 + 浅填充。
function Sparkline({ series, tone }) {
	if (!Array.isArray(series) || series.length < 2) return null;
	const w = 200;
	const h = 36;
	const min = Math.min(...series);
	const max = Math.max(...series);
	const range = max - min || 1;
	const points = series.map((v, i) => {
		const x = (i / (series.length - 1)) * w;
		const y = h - ((v - min) / range) * h;
		return [x, y];
	});
	const linePath = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
	const stroke = tone === TONE_UP ? '#e11d48' : tone === TONE_DOWN ? '#059669' : '#64748b';
	const fill = tone === TONE_UP
		? 'rgba(225,29,72,0.08)'
		: tone === TONE_DOWN
			? 'rgba(5,150,105,0.08)'
			: 'rgba(100,116,139,0.08)';
	const areaPath = `${linePath} L${w},${h} L0,${h} Z`;
	return (
		<svg viewBox={`0 0 ${w} ${h}`} className="h-9 w-full" preserveAspectRatio="none" aria-hidden="true">
			<path d={areaPath} fill={fill} />
			<path d={linePath} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);
}

// KPI 单列：小 label + signed currency + signed percent。支付宝风格：无卡框、纯文字横排。
function KpiCol({ label, value, rate, align = 'center' }) {
	const tone = signTone(value);
	const alignClass = align === 'left' ? 'items-start text-left' : align === 'right' ? 'items-end text-right' : 'items-center text-center';
	return (
		<div className={cx('flex min-w-0 flex-col gap-0.5', alignClass)}>
			<div className="text-[11px] font-medium text-slate-500">{label}</div>
			<div className={cx('max-w-full truncate whitespace-nowrap text-base font-bold tabular-nums min-[380px]:text-lg sm:text-xl', tone)}>
				{renderSignedCurrency(value, { compactFrom: 10000 })}
			</div>
			<div className={cx('max-w-full truncate whitespace-nowrap text-[11px] font-semibold tabular-nums sm:text-xs', tone)}>
				{renderSignedPercent(rate)}
			</div>
		</div>
	);
}

export function IncomeSummary({ portfolio, navigate, navRefresh, cumulativeSeries }) {
	const marketValue = portfolio?.marketValue;
	const todayProfit = portfolio?.todayProfit;
	const todayReturnRate = portfolio?.todayReturnRate;
	const totalProfit = portfolio?.totalProfit;
	const totalReturnRate = portfolio?.totalReturnRate;
	const cumulativeProfit = portfolio?.cumulativeProfit;
	const cumulativeReturnRate = portfolio?.cumulativeReturnRate;

	const cumulativeTone = signTone(cumulativeProfit);

	const refreshBtn = navRefresh ? (
		<button
			type="button"
			onClick={navRefresh.onClick}
			disabled={navRefresh.loading}
			aria-label={navRefresh.title || '同步净值'}
			title={navRefresh.title || '同步净值'}
			className="relative inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
		>
			<RefreshCw className={cx('h-3.5 w-3.5', navRefresh.loading && 'animate-spin')} />
			{navRefresh.hasFailures ? (
				<span aria-hidden className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-amber-500 ring-2 ring-white" />
			) : null}
		</button>
	) : null;

	return (
		<div className="flex flex-col gap-3">
			{/* v7.0 支付宝风格：去卡框 hero（总市值超大字 + 3 列纯文字 KPI），金额不再被卡片宽束缚 */}
			<section className="flex min-w-0 flex-col gap-4 px-1 pt-2 pb-1 sm:gap-5 sm:pt-3">
				{/* 顶部行：总市值 label + 金额 / 右侧：刷新按钮 */}
				<div className="flex items-start justify-between gap-3">
					<div className="min-w-0 flex-1">
						<div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">总市值</div>
						<div className="mt-1 truncate whitespace-nowrap text-4xl font-extrabold tracking-tight tabular-nums text-slate-900 min-[380px]:text-[44px] sm:text-5xl">
							{formatCompactCurrency(marketValue, { compactFrom: 100000000 })}
						</div>
					</div>
					{refreshBtn ? <div className="shrink-0">{refreshBtn}</div> : null}
				</div>

				{/* sparkline 仅 PC（sm 以上）渲染，移动端隐藏 */}
				{Array.isArray(cumulativeSeries) && cumulativeSeries.length >= 2 ? (
					<div className="hidden sm:block">
						<Sparkline series={cumulativeSeries} tone={cumulativeTone} />
					</div>
				) : null}

				{/* 3 列 KPI：今日 / 持有 / 累计 */}
				<div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,1fr)] gap-1 sm:gap-4">
					<KpiCol label="今日收益(元)" value={todayProfit} rate={todayReturnRate} align="left" />
					<KpiCol label="持有收益(元)" value={totalProfit} rate={totalReturnRate} />
					<KpiCol label="累计收益(元)" value={cumulativeProfit} rate={cumulativeReturnRate} align="right" />
				</div>
			</section>

			{/* 入口区：4 个 lucide 单色线性 icon */}
			<nav aria-label="收益看板子页入口" className="grid grid-cols-4 gap-2">
				{TILES.map(({ route: r, Icon, label }) => (
					<button
						key={r}
						type="button"
						onClick={() => navigate?.(r)}
						className="flex flex-col items-center justify-center gap-1.5 rounded-2xl border border-slate-200/70 bg-white px-1 py-2.5 text-[11px] font-medium text-slate-700 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:bg-slate-50 active:bg-slate-100 sm:py-3 sm:text-xs"
					>
						<Icon className="h-5 w-5 text-slate-600 sm:h-[22px] sm:w-[22px]" strokeWidth={1.75} aria-hidden="true" />
						<span className="truncate">{label}</span>
					</button>
				))}
			</nav>
		</div>
	);
}

export default IncomeSummary;
