// IncomeSummary.jsx · holdings overview hero
//
// 顶部总览 + 投资/现金账户比例 + 3 列 KPI + 子页入口。

import { useState } from 'react';
import { ROUTES, useIncomeRoute } from '../incomeRoute.js';
import { cx } from '../../components/experience-ui.jsx';
import { PageHeader } from '../../components/page-header.jsx';
import { FilterPills } from '../../components/filter-pills.jsx';
import { formatCurrency, formatPercent } from '../accumulation.js';
import { RefreshCw, Plus, Copy, ScanLine, Trash2, Settings2, WalletCards } from 'lucide-react';

const TONE_UP = 'text-[var(--market-rise)]';
const TONE_DOWN = 'text-[var(--market-fall)]';
const TONE_NEUTRAL = 'text-[var(--fg-700)]';

function clampPct(value) {
	if (!Number.isFinite(value)) return 0;
	return Math.max(0, Math.min(100, value));
}

function AccountAllocationPanel({ accountAllocation, onSettingsChange }) {
	const [settingsOpen, setSettingsOpen] = useState(false);
	if (!accountAllocation || !Array.isArray(accountAllocation.items)) return null;
	const settings = accountAllocation.settings || {};
	const investmentPct = clampPct(accountAllocation.investmentPct);
	const cashPct = clampPct(accountAllocation.cashPct);
	const statusClass = accountAllocation.rebalanceNeeded
		? accountAllocation.direction === 'investment_high'
			? 'border-rose-200 bg-rose-50 text-rose-700'
			: 'border-amber-200 bg-amber-50 text-amber-700'
		: 'border-emerald-200 bg-emerald-50 text-emerald-700';
	const statusDot = accountAllocation.rebalanceNeeded
		? accountAllocation.direction === 'investment_high' ? 'bg-rose-500' : 'bg-amber-500'
		: 'bg-emerald-500';
	const allocationStyle = {
		background: 'conic-gradient(#e11d48 0 ' + investmentPct + '%, #10b981 ' + investmentPct + '% 100%)',
	};

	return (
		<section className="min-w-0 rounded-[var(--radius-lg)] border border-[var(--a-200)] bg-white p-3.5 sm:p-4">
			<div className="flex items-start justify-between gap-3">
				<div className="flex min-w-0 items-center gap-2">
					<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
						<WalletCards className="h-4 w-4" aria-hidden="true" />
					</div>
					<div className="min-w-0">
						<div className="truncate text-sm font-bold text-slate-900">账户比例</div>
						<div className="truncate text-[11px] text-slate-500">投资与现金配置</div>
					</div>
				</div>
				<div className="flex shrink-0 items-center gap-1.5">
					<span className={cx('inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-semibold', statusClass)}>
						<span className={cx('h-1.5 w-1.5 rounded-full', statusDot)} />
						{accountAllocation.statusLabel}
					</span>
					<button
						type="button"
						onClick={() => setSettingsOpen((value) => !value)}
						aria-label={settingsOpen ? '收起账户比例设置' : '打开账户比例设置'}
						title={settingsOpen ? '收起设置' : '账户比例设置'}
						className={cx('inline-flex h-8 w-8 items-center justify-center rounded-lg border text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-800', settingsOpen ? 'border-slate-300 bg-slate-50' : 'border-slate-200 bg-white')}
					>
						<Settings2 className="h-4 w-4" aria-hidden="true" />
					</button>
				</div>
			</div>

			<div className="mt-4 grid grid-cols-[92px_minmax(0,1fr)] items-center gap-4">
				<div className="relative h-[92px] w-[92px] shrink-0 rounded-full" style={allocationStyle}>
					<div className="absolute inset-[11px] flex flex-col items-center justify-center rounded-full bg-white">
						<span className="text-[10px] font-semibold text-slate-400">投资</span>
						<span className="text-xl font-extrabold leading-none tabular-nums text-slate-900">{formatPercent(investmentPct, 0)}</span>
					</div>
				</div>
				<div className="min-w-0 space-y-2">
					<div className="flex items-center justify-between gap-3">
						<div className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-slate-600"><span className="h-2 w-2 shrink-0 rounded-full bg-rose-500" />投资 <span className="tabular-nums text-slate-400">{formatPercent(investmentPct, 0)}</span></div>
						<div className="truncate text-right text-base font-extrabold tabular-nums text-slate-900">{formatCompactCurrency(accountAllocation.investmentValue)}</div>
					</div>
					<div className="flex items-center justify-between gap-3">
						<div className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-slate-600"><span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />现金 <span className="tabular-nums text-slate-400">{formatPercent(cashPct, 0)}</span></div>
						<div className="truncate text-right text-base font-extrabold tabular-nums text-slate-900">{formatCompactCurrency(accountAllocation.cashValue)}</div>
					</div>
					<div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-2 text-[11px] tabular-nums text-slate-500">
						<span>现金收益 {Number(accountAllocation.cashYieldRate || 0).toFixed(2)}%</span>
						<span>年收益 ¥{Number(accountAllocation.cashAnnualIncome || 0).toFixed(2)}</span>
					</div>
				</div>
			</div>


			{settingsOpen ? (
				<div className="mt-3 border-t border-slate-200 pt-3">
					<div className="grid min-w-0 gap-2 min-[520px]:grid-cols-2">
						<label className="min-w-0">
							<span className="font-semibold text-slate-500">现金收益来源</span>
							<select value={settings.cashYieldMode || 'none'} onChange={(event) => onSettingsChange?.({ cashYieldMode: event.target.value, ...(event.target.value === 'code' ? { cashYieldResolvedRate: null, cashYieldResolvedAt: '', cashYieldName: '' } : {}) })} className="mt-1 h-9 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-900 outline-none focus:border-rose-300">
								<option value="none">现金/活期（0%）</option>
								<option value="code">输入代码自动获取</option>
								<option value="manual">手动输入年化收益率</option>
							</select>
						</label>
						{settings.cashYieldMode === 'code' ? (
							<label className="min-w-0">
								<span className="font-semibold text-slate-500">现金资产代码</span>
								<input type="text" inputMode="numeric" maxLength="6" placeholder="例如 511010" value={settings.cashYieldCode || ''} onChange={(event) => onSettingsChange?.({ cashYieldCode: event.target.value, cashYieldResolvedRate: null, cashYieldResolvedAt: '', cashYieldName: '' })} className="mt-1 h-9 w-full min-w-0 rounded-lg border border-slate-200 px-2 text-xs font-semibold tabular-nums text-slate-900 outline-none focus:border-rose-300" />
								<span className="mt-1 block truncate text-[11px] text-slate-400">{settings.cashYieldName || (settings.cashYieldLookupStatus === 'loading' ? '正在获取收益率...' : settings.cashYieldLookupStatus === 'ready' ? '近一年收益率已获取' : settings.cashYieldLookupStatus === 'unavailable' ? '暂无近一年收益率数据' : '输入 6 位代码后自动获取')}</span>
							</label>
						) : null}
						{settings.cashYieldMode === 'manual' ? (
							<label className="min-w-0">
								<span className="font-semibold text-slate-500">年化收益率%</span>
								<input type="number" min="-100" max="100" step="0.01" value={settings.cashYieldRate ?? 0} onChange={(event) => onSettingsChange?.({ cashYieldRate: event.target.value })} className="mt-1 h-9 w-full min-w-0 rounded-lg border border-slate-200 px-2 text-right text-xs font-semibold tabular-nums text-slate-900 outline-none focus:border-rose-300" />
							</label>
						) : null}
						<label className="min-w-0">
							<span className="font-semibold text-slate-500">现金金额</span>
							<input type="number" min="0" step="0.01" value={settings.cashAmount ?? 0} onChange={(event) => onSettingsChange?.({ cashAmount: event.target.value })} className="mt-1 h-9 w-full min-w-0 rounded-lg border border-slate-200 px-2 text-right text-xs font-semibold tabular-nums text-slate-900 outline-none focus:border-rose-300" />
						</label>
						<label className="min-w-0">
							<span className="font-semibold text-slate-500">投资目标%</span>
							<input type="number" min="0" max="100" step="1" value={settings.targetInvestmentPct ?? 70} onChange={(event) => onSettingsChange?.({ targetInvestmentPct: event.target.value })} className="mt-1 h-9 w-full min-w-0 rounded-lg border border-slate-200 px-2 text-right text-xs font-semibold tabular-nums text-slate-900 outline-none focus:border-rose-300" />
						</label>
						<label className="min-w-0">
							<span className="font-semibold text-slate-500">偏离阈值%</span>
							<input type="number" min="0" max="100" step="1" value={settings.rebalanceThresholdPct ?? 5} onChange={(event) => onSettingsChange?.({ rebalanceThresholdPct: event.target.value })} className="mt-1 h-9 w-full min-w-0 rounded-lg border border-slate-200 px-2 text-right text-xs font-semibold tabular-nums text-slate-900 outline-none focus:border-rose-300" />
						</label>
						<label className="flex min-w-0 items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-2 font-semibold text-slate-600 min-[520px]:col-span-2">
							<input type="checkbox" checked={settings.notifyEnabled !== false} onChange={(event) => onSettingsChange?.({ notifyEnabled: event.target.checked })} className="h-4 w-4 rounded border-slate-300 text-rose-500" />
							<span className="whitespace-nowrap">再平衡通知</span>
						</label>
					</div>
				</div>
			) : null}
		</section>
	);
}

const TILES = [
	{ key: ROUTES.INCOME, label: '收益明细' },
	{ key: ROUTES.LIQUIDATION, label: '已清仓' },
	{ key: ROUTES.BREAKDOWN, label: '持仓中' },
	{ key: ROUTES.TRANSACTIONS, label: '交易记录' },
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
function KpiCol({ label, value, rate, align = 'center', centerRate = false, statusLabel = '' }) {
	const tone = signTone(value);
	const alignClass = align === 'left' ? 'items-start text-left' : align === 'right' ? 'items-end text-right' : 'items-center text-center';
	return (
			<div className={cx('flex min-w-0 flex-col gap-0.5 rounded-[var(--radius-lg)] border border-[var(--a-200)] bg-white px-3 py-3', alignClass)}>
			{statusLabel ? (
				<div className="mb-0.5 inline-flex max-w-full items-center rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-emerald-700">
					<span className="truncate">{statusLabel}</span>
				</div>
			) : null}
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

export function IncomeSummary({ portfolio, navigate, navRefresh, accountAllocation, onAccountSettingsChange, cumulativeSeries, cumulativeLastIso, quickActions, inceptionDate, embedded = false }) {
	const { route: activeRoute } = useIncomeRoute();
	const totalAccountValue = Number(accountAllocation?.totalAccountValue);
	const marketValue = Number.isFinite(totalAccountValue) ? totalAccountValue : portfolio?.marketValue;
	const todayProfit = portfolio?.todayProfit;
	const todayReturnRate = portfolio?.todayReturnRate;
	const unrealizedProfit = portfolio?.unrealizedProfit;
	const unrealizedReturnRate = portfolio?.unrealizedReturnRate;
	const allTodayDataReady = portfolio?.navDateCoverage === 'full';
	const todayReadyLabel = allTodayDataReady ? '全部更新完成' : '';
	const cumulativeProfit = Number.isFinite(portfolio?.cumulativeProfit)
		? portfolio.cumulativeProfit
		: cumulativeSeries?.profit;
	const cumulativeReturnRate = Number.isFinite(portfolio?.cumulativeReturnRate)
		? portfolio.cumulativeReturnRate
		: cumulativeSeries?.returnRatePct;

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
			<PageHeader
				Icon={WalletCards}
				title="持仓总览"
				description="查看组合市值、收益变化与交易记录，数据来自本地账本。"
				hideIntro={embedded}
			/>
			{/* 移动端：总资产 → 投资/现金比例 → 3 KPI 垂直堆叠 */}
			<section className="flex flex-col gap-4 px-1 pt-2 pb-1 sm:hidden">
				<div className="flex items-start justify-between gap-3">
					<div className="min-w-0 flex-1">
						<div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">总资产</div>
						<div className="mt-1 truncate whitespace-nowrap text-4xl font-extrabold tracking-tight tabular-nums text-slate-900 min-[380px]:text-[44px]">
							{formatCompactCurrency(marketValue, { compactFrom: 100000000 })}
						</div>
					</div>
					{refreshBtn ? <div className="shrink-0">{refreshBtn}</div> : null}
				</div>
				<AccountAllocationPanel accountAllocation={accountAllocation} onSettingsChange={onAccountSettingsChange} />
				<div className="grid min-w-0 grid-cols-2 gap-2">
				<KpiCol label="今日收益(元)" value={todayProfit} rate={todayReturnRate} align="center" centerRate statusLabel={todayReadyLabel} />
				<KpiCol label="持有收益(元)" value={unrealizedProfit} rate={unrealizedReturnRate} align="center" centerRate />
				<KpiCol label="累计收益(元)" value={cumulativeProfit} rate={cumulativeReturnRate} align="center" centerRate />
				</div>
			</section>

		{/* PC 端：横向 stat-bar（左总资产+起算日 · 中 投资/现金比例 · 右 3 KPI · 最右刷新） */}
		<section className="hidden sm:flex sm:items-start sm:gap-6 sm:px-1 sm:pb-4 sm:border-b sm:border-slate-100">
				<div className="min-w-0 shrink-0">
					<div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">总资产</div>
					<div className="mt-1 whitespace-nowrap text-4xl font-extrabold tracking-tight tabular-nums text-slate-900">
						{formatCompactCurrency(marketValue, { compactFrom: 100000000 })}
					</div>
					{inceptionDate ? <div className="text-[11px] text-slate-400 mt-0.5">起 {inceptionDate}</div> : null}
				</div>
				<div className="flex-1" aria-hidden="true" />
				<div className="flex gap-6 shrink-0 self-center">
				<KpiCol label="今日" value={todayProfit} rate={todayReturnRate} align="center" statusLabel={todayReadyLabel} />
				<KpiCol label="持有" value={unrealizedProfit} rate={unrealizedReturnRate} align="center" />
				<KpiCol label="累计" value={cumulativeProfit} rate={cumulativeReturnRate} align="center" />
				</div>
				{refreshBtn ? <div className="shrink-0">{refreshBtn}</div> : null}
			</section>

			{/* 统一的持仓视图分段药丸，移动端不再额外占一排图标卡。 */}
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
				<FilterPills
					items={TILES}
					value={activeRoute || ROUTES.INCOME}
					onChange={(route) => navigate?.(route)}
					ariaLabel="持仓视图"
					className="w-full sm:w-auto"
				/>
				{quickActions && (quickActions.onCopyTable || quickActions.onNewTransaction || quickActions.onOcr || quickActions.onClearAllData) ? (
					<div className="flex shrink-0 items-center gap-2">
						{quickActions.onClearAllData ? (
							<button
								type="button"
								onClick={quickActions.onClearAllData}
								title="清除所有数据（不可恢复）"
								className="inline-flex items-center gap-1.5 h-8 rounded-full border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-700"
							>
								<Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
								<span>清除数据</span>
							</button>
						) : null}
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
									className="inline-flex items-center gap-1.5 h-8 rounded-md bg-[var(--green-fill)] px-3 text-xs font-semibold text-white transition-colors hover:bg-[var(--green-text)]"
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
