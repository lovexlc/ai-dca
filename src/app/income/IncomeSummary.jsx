// IncomeSummary.jsx · v7.3 hero 内嵌账户分配卡
//
// 单卡 hero + 3 列 KPI + 4 入口：
//   - 顶部：总市值（金额大字）+ 右侧刷新按钮
//   - PC：中部三张账户分配卡（进取型 / 稳健型 / 防守型，含 ¥ 金额 + 比例 Pill），替换 v7.1 sparkline / v7.2 纯色 pill。
//     移动端：在总市值与 KPI 之间同样渲染三张卡片（紧凑版，单行 3 列）。
//   - 中部：3 列 KPI（今日 / 持有 / 累计）
//   - 入口区：PC 端 inline pill chip（+ 右侧 复制表格 / +新增交易）；移动端保留 v7.0 grid tile
//
// 入参：
//   - portfolio：HoldingsExperience L221 useMemo 的集计对象
//   - navigate：跳转子页
//   - navRefresh：{ onClick, loading, hasFailures, title }，顶部右侧刷新按钮
//   - accountAllocation：[{ key, label, marketValue, ratio }] 三账户分配（来自 getAccountAllocation）
//   - cumulativeSeries / cumulativeLastIso：v7.2 起 PC 中部不再渲染 sparkline，props 暂保留以避免上游契约破坏，可在后续清理。
//   - quickActions：{ onNewTransaction, onCopyTable, copyTitle }，PC 端 hero 行右侧合并主表顶部 「复制表格 / + 新增交易」按钮。

import { ROUTES, useIncomeRoute } from '../incomeRoute.js';
import { Pill, cx } from '../../components/experience-ui.jsx';
import { formatCurrency, formatPercent } from '../accumulation.js';
import { RefreshCw, BarChart3, Receipt, PieChart, ArrowLeftRight, Plus, Copy, ClipboardPaste, ScanLine } from 'lucide-react';

const TONE_UP = 'text-rose-600';
const TONE_DOWN = 'text-emerald-600';
const TONE_NEUTRAL = 'text-slate-500';

const ACCOUNT_PILL_TONE = { aggressive: 'red', stable: 'indigo', defensive: 'emerald' };

// 账户分配指示器：彩色圆点 + 标签
function AccountAllocationIndicator({ accountAllocation }) {
	if (!Array.isArray(accountAllocation) || !accountAllocation.length) return null;
	
	const segments = [
		{ key: 'aggressive', bgColor: 'bg-red-500', label: '进取型' },
		{ key: 'stable', bgColor: 'bg-indigo-500', label: '稳健型' },
		{ key: 'defensive', bgColor: 'bg-emerald-500', label: '防守型' },
	];
	
	return (
		<div className="flex items-center gap-3 text-sm">
			{accountAllocation.map((item) => (
				item.ratio >= 0 ? (
					<div key={item.key} className="flex items-center gap-1.5">
						<div className={cx(
							segments.find(s => s.key === item.key)?.bgColor,
							'w-2.5 h-2.5 rounded-full shrink-0'
						)} />
						<span className="text-slate-600 whitespace-nowrap">{item.label}</span>
						<span className="text-slate-500 font-medium tabular-nums">{formatPercent(item.ratio, 0)}</span>
					</div>
				) : null
			))}
		</div>
	);
}
// 移动端账户分配指示器：3 列 grid，列宽与下方 KPI 行一致，便于横向对齐。
function AccountAllocationRowMobile({ accountAllocation }) {
	if (!Array.isArray(accountAllocation) || !accountAllocation.length) return null;
	const SEG_BY_KEY = {
		aggressive: { bgColor: 'bg-red-500', label: '进取型' },
		stable: { bgColor: 'bg-indigo-500', label: '稳健型' },
		defensive: { bgColor: 'bg-emerald-500', label: '防守型' },
	};
	return (
		<div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,1fr)] gap-1 text-sm">
			{accountAllocation.map((item) => {
				const seg = SEG_BY_KEY[item.key];
				if (!seg || !(item.ratio > 0)) {
					return <div key={item.key} aria-hidden="true" />;
				}
				return (
					<div key={item.key} className="flex min-w-0 items-center justify-center gap-1.5">
						<div className={cx(seg.bgColor, 'w-2.5 h-2.5 rounded-full shrink-0')} />
						<span className="text-slate-600 whitespace-nowrap">{seg.label}</span>
						<span className="text-slate-500 font-medium tabular-nums">{formatPercent(item.ratio, 0)}</span>
					</div>
				);
			})}
		</div>
	);
}
function AccountCardsGrid({ accountAllocation, className = '' }) {
	if (!Array.isArray(accountAllocation) || !accountAllocation.length) return null;
	return (
		<div className={cx('grid grid-cols-3 gap-2', className)}>
			{accountAllocation.map((item) => (
				<div key={item.key} className="min-w-0 rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-center">
					<div className="truncate text-[11px] font-semibold text-slate-900 sm:text-xs">{item.label}</div>
					<div className="mt-0.5 truncate text-xs font-bold tabular-nums text-slate-900 sm:text-sm">{formatCurrency(item.marketValue, '¥', 2)}</div>
					<div className="mt-0.5 flex justify-center">
						<Pill tone={ACCOUNT_PILL_TONE[item.key] || 'slate'} className="px-1.5 py-0 text-[10px] sm:text-xs">
							{formatPercent(item.ratio, 1)}
						</Pill>
					</div>
				</div>
			))}
		</div>
	);
}
// PC 端账户分配指示器：竖向堆叠（进取 / 稳健 / 防守 三行）。
function AccountAllocationStackPc({ accountAllocation }) {
	if (!Array.isArray(accountAllocation) || !accountAllocation.length) return null;
	const SEG_BY_KEY = {
		aggressive: { bgColor: 'bg-red-500', label: '进取型' },
		stable: { bgColor: 'bg-indigo-500', label: '稳健型' },
		defensive: { bgColor: 'bg-emerald-500', label: '防守型' },
	};
	return (
		<div className="flex flex-col gap-1 text-sm">
			{accountAllocation.map((item) => {
				const seg = SEG_BY_KEY[item.key];
				if (!seg || !(item.ratio > 0)) return null;
				return (
					<div key={item.key} className="flex items-center gap-1.5">
						<div className={cx(seg.bgColor, 'w-2.5 h-2.5 rounded-full shrink-0')} />
						<span className="text-slate-600 whitespace-nowrap">{seg.label}</span>
						<span className="text-slate-500 font-medium tabular-nums">{formatPercent(item.ratio, 0)}</span>
					</div>
				);
			})}
		</div>
	);
}

const TILES = [
	{ route: ROUTES.INCOME, Icon: BarChart3, label: '收益明细', labelShort: '收益' },
	{ route: ROUTES.LIQUIDATION, Icon: Receipt, label: '清仓分析', labelShort: '清仓' },
	{ route: ROUTES.BREAKDOWN, Icon: PieChart, label: '持仓分析', labelShort: '持仓' },
	{ route: ROUTES.TRANSACTIONS, Icon: ArrowLeftRight, label: '交易记录', labelShort: '记录' },
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

// KPI 单列：小 label + signed currency + signed percent。支付宝风格：无卡框、纯文字横排。
function KpiCol({ label, value, rate, align = 'center', centerRate = false }) {
	const tone = signTone(value);
	const alignClass = align === 'left' ? 'items-start text-left' : align === 'right' ? 'items-end text-right' : 'items-center text-center';
	return (
		<div className={cx('flex min-w-0 flex-col gap-0.5', alignClass)}>
			<div className="text-[11px] font-medium text-slate-500">{label}</div>
			<div className={cx('max-w-full truncate whitespace-nowrap text-base font-bold tabular-nums min-[380px]:text-lg sm:text-xl', tone)}>
				{renderSignedCurrency(value, { compactFrom: 10000 })}
			</div>
			<div className={cx('max-w-full truncate whitespace-nowrap text-[11px] font-semibold tabular-nums sm:text-xs', centerRate && 'w-full text-center', tone)}>
				{renderSignedPercent(rate)}
			</div>
		</div>
	);
}

export function IncomeSummary({ portfolio, navigate, navRefresh, accountAllocation, cumulativeSeries, cumulativeLastIso, quickActions, inceptionDate }) {
	const { route: activeRoute } = useIncomeRoute();
	const marketValue = portfolio?.marketValue;
	const todayProfit = portfolio?.todayProfit;
	const todayReturnRate = portfolio?.todayReturnRate;
	const unrealizedProfit = portfolio?.unrealizedProfit;
	const unrealizedReturnRate = portfolio?.unrealizedReturnRate;
	const cumulativeProfit = Number.isFinite(cumulativeSeries?.profit)
		? cumulativeSeries.profit
		: portfolio?.cumulativeProfit;
	const cumulativeReturnRate = Number.isFinite(cumulativeSeries?.returnRatePct)
		? cumulativeSeries.returnRatePct
		: portfolio?.cumulativeReturnRate;

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
			{/* 移动端：v7.3 单卡（总市值 → 三账户卡 → 3 KPI 垂直堆叠） */}
			<section className="flex flex-col gap-4 px-1 pt-2 pb-1 sm:hidden">
				<div className="flex items-start justify-between gap-3">
					<div className="min-w-0 flex-1">
						<div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">总市值</div>
						<div className="mt-1 truncate whitespace-nowrap text-4xl font-extrabold tracking-tight tabular-nums text-slate-900 min-[380px]:text-[44px]">
							{formatCompactCurrency(marketValue, { compactFrom: 100000000 })}
						</div>
					</div>
					{refreshBtn ? <div className="shrink-0">{refreshBtn}</div> : null}
				</div>
			<AccountAllocationRowMobile accountAllocation={accountAllocation} />
				<div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,1fr)] gap-1">
				<KpiCol label="今日收益(元)" value={todayProfit} rate={todayReturnRate} align="center" centerRate />
				<KpiCol label="持有收益(元)" value={unrealizedProfit} rate={unrealizedReturnRate} align="center" centerRate />
				<KpiCol label="累计收益(元)" value={cumulativeProfit} rate={cumulativeReturnRate} align="center" centerRate />
				</div>
			</section>

		{/* PC 端：v7.4 横向 stat-bar（左金额+起算日 · 中 账户分配竖向堆叠 · 右 3 KPI · 最右刷新） */}
		<section className="hidden sm:flex sm:items-start sm:gap-6 sm:px-1 sm:pb-4 sm:border-b sm:border-slate-100">
				<div className="min-w-0 shrink-0">
					<div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">总市值</div>
					<div className="mt-1 whitespace-nowrap text-4xl font-extrabold tracking-tight tabular-nums text-slate-900">
						{formatCompactCurrency(marketValue, { compactFrom: 100000000 })}
					</div>
					{inceptionDate ? <div className="text-[11px] text-slate-400 mt-0.5">起 {inceptionDate}</div> : null}
				</div>
				{Array.isArray(accountAllocation) && accountAllocation.length ? (
					<div className="flex-1 min-w-0 self-center">
						<AccountAllocationStackPc accountAllocation={accountAllocation} />
					</div>
				) : (
					<div className="flex-1" aria-hidden="true" />
				)}
				<div className="flex gap-6 shrink-0 self-center">
				<KpiCol label="今日" value={todayProfit} rate={todayReturnRate} align="center" />
				<KpiCol label="持有" value={unrealizedProfit} rate={unrealizedReturnRate} align="center" />
				<KpiCol label="累计" value={cumulativeProfit} rate={cumulativeReturnRate} align="center" />
				</div>
				{refreshBtn ? <div className="shrink-0">{refreshBtn}</div> : null}
			</section>

			{/* 入口区：移动端 4 tile grid（v7.0） */}
			<nav aria-label="收益看板子页入口" className="grid grid-cols-4 gap-2 sm:hidden">
				{TILES.map(({ route: r, Icon, label, labelShort }) => {
					const isActive = activeRoute === r;
					return (
						<button
							key={r}
							type="button"
							aria-current={isActive ? 'page' : undefined}
							onClick={() => navigate?.(r)}
							className={cx('flex flex-col items-center justify-center gap-1.5 rounded-2xl border px-1 py-2.5 text-[11px] font-medium shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors active:bg-slate-100', isActive ? 'border-rose-300 bg-rose-50 text-rose-700' : 'border-slate-200/70 bg-white text-slate-700 hover:bg-slate-50')}
						>
							<Icon className={cx('h-5 w-5', isActive ? 'text-rose-600' : 'text-slate-600')} strokeWidth={1.75} aria-hidden="true" />
							<span className="truncate">{labelShort || label}</span>
						</button>
					);
				})}
			</nav>

			{/* PC 端：4 pill chip 入口 + 右侧 复制表格 / + 新增交易 */}
			<div className="hidden sm:flex sm:items-center sm:justify-between sm:gap-3">
				<nav aria-label="收益看板子页入口" className="flex flex-wrap gap-2">
					{TILES.map(({ route: r, Icon, label, labelShort }) => {
						const isActive = activeRoute === r;
						return (
							<button
								key={r}
								type="button"
								aria-current={isActive ? 'page' : undefined}
								onClick={() => navigate?.(r)}
								className={cx('inline-flex items-center gap-1.5 h-8 rounded-full border px-3 text-xs font-medium transition-colors', isActive ? 'border-rose-300 bg-rose-50 text-rose-700 shadow-sm' : 'border-slate-200 bg-white text-slate-700 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700')}
							>
								<Icon className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
								<span>{label}</span>
							</button>
						);
					})}
				</nav>
				{quickActions && (quickActions.onCopyTable || quickActions.onNewTransaction || quickActions.onPasteExcel || quickActions.onOcr) ? (
					<div className="flex shrink-0 items-center gap-2">
						{quickActions.onCopyTable ? (
							<button
								type="button"
								onClick={quickActions.onCopyTable}
								title={quickActions.copyTitle || '复制表格'}
								className="inline-flex items-center gap-1.5 h-8 rounded-full border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-800"
							>
								<Copy className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
								<span>复制表格</span>
							</button>
						) : null}
						{quickActions.onPasteExcel ? (
							<button
								type="button"
								onClick={quickActions.onPasteExcel}
								title="从外部表格粘贴多行交易"
								className="inline-flex items-center gap-1.5 h-8 rounded-full border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-800"
							>
								<ClipboardPaste className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
								<span>粘贴 Excel</span>
							</button>
						) : null}
						{quickActions.onOcr ? (
							<button
								type="button"
								onClick={quickActions.onOcr}
								title="从截图识别交易流水"
								className="inline-flex items-center gap-1.5 h-8 rounded-full border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-800"
							>
								<ScanLine className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
								<span>截图 OCR</span>
							</button>
						) : null}
						{quickActions.onNewTransaction ? (
							<button
								type="button"
								onClick={quickActions.onNewTransaction}
								title="新增单条交易"
								className="inline-flex items-center gap-1.5 h-8 rounded-full bg-rose-500 px-3 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-rose-600"
							>
								<Plus className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />
								<span>新增单笔</span>
							</button>
						) : null}
					</div>
				) : null}
			</div>
		</div>
	);
}

export default IncomeSummary;
