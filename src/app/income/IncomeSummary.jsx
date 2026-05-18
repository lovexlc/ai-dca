// IncomeSummary.jsx
//
// v3 第五刀 · 激进主页瘦身。参考支付宝主页：
//   - 总市值大字
//   - 一行 当日收益（金额 + %，色调涨红跌绿）
//   - 一行 累计盈亏（金额 + %，色调同上）
//   - 5 tile 网格
//
// 删除：11 镜头 TimeRangeSelector / benchmark / annualizedReturn /
//        A/B 布局切换 / localStorage incomeOverviewLayout /
//        内部 buildPortfolioSeries fetch 。这些都在 IncomeDetailPage 。
//
// 入参：
//   - portfolio：HoldingsExperience L221 useMemo 的集计对象
//   - ledger：预留供后续扩展（临时不用）
//   - navigate：跳转子页
//   - inceptionDate：可选，累计一行 sub

import { ROUTES } from '../incomeRoute.js';
import { cx } from '../../components/experience-ui.jsx';
import { formatCurrency, formatPercent } from '../accumulation.js';

const TONE_UP = 'text-rose-600';
const TONE_DOWN = 'text-emerald-600';
const TONE_NEUTRAL = 'text-slate-500';

const TILES = [
	{ route: ROUTES.INCOME, icon: '\ud83d\udcca', label: '收益明细' },
	{ route: ROUTES.LIQUIDATION, icon: '\ud83d\udcb0', label: '清仓分析' },
	{ route: ROUTES.BREAKDOWN, icon: '\ud83e\udd67', label: '持仓分析' },
	{ route: ROUTES.TRANSACTIONS, icon: '\ud83d\udcb1', label: '交易记录' },
];

function signTone(value) {
	if (!Number.isFinite(value) || value === 0) return TONE_NEUTRAL;
	return value > 0 ? TONE_UP : TONE_DOWN;
}

function renderSignedCurrency(value) {
	if (!Number.isFinite(value)) return '—';
	const abs = formatCurrency(Math.abs(value), '¥', 2);
	if (value > 0) return `+${abs}`;
	if (value < 0) return `-${abs}`;
	return abs;
}

function renderSignedPercent(value) {
	if (!Number.isFinite(value)) return '—';
	const sign = value > 0 ? '+' : value < 0 ? '-' : '';
	return `${sign}${formatPercent(Math.abs(value))}`;
}

export function IncomeSummary({ portfolio, navigate, inceptionDate }) {
	const marketValue = portfolio?.marketValue;
	const todayProfit = portfolio?.todayProfit;
	const todayReturnRate = portfolio?.todayReturnRate;
	const cumulativeProfit = portfolio?.cumulativeProfit;
	const cumulativeReturnRate = portfolio?.cumulativeReturnRate;

	const todayTone = signTone(todayProfit);
	const cumulativeTone = signTone(cumulativeProfit);

	return (
		<div className="flex flex-col gap-3">
			<section className="rounded-2xl border border-slate-200/70 bg-white px-5 py-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:px-6 sm:py-6">
				<div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">总市值</div>
				<div className="mt-1 text-3xl font-extrabold tracking-tight tabular-nums text-slate-900 sm:text-4xl">
					{Number.isFinite(marketValue) ? formatCurrency(marketValue, '¥', 2) : '—'}
				</div>

				<dl className="mt-4 flex flex-col gap-2.5 text-sm sm:flex-row sm:gap-8">
					<div className="flex items-baseline gap-2 sm:flex-1">
						<dt className="text-slate-500">当日</dt>
						<dd className={cx('font-semibold tabular-nums', todayTone)}>
							{renderSignedCurrency(todayProfit)}
						</dd>
						<dd className={cx('text-xs font-semibold tabular-nums', todayTone)}>
							{renderSignedPercent(todayReturnRate)}
						</dd>
					</div>
					<div className="flex items-baseline gap-2 sm:flex-1">
						<dt className="text-slate-500">累计</dt>
						<dd className={cx('font-semibold tabular-nums', cumulativeTone)}>
							{renderSignedCurrency(cumulativeProfit)}
						</dd>
						<dd className={cx('text-xs font-semibold tabular-nums', cumulativeTone)}>
							{renderSignedPercent(cumulativeReturnRate)}
						</dd>
						{inceptionDate ? (
							<dd className="text-[11px] text-slate-400 tabular-nums">起 {inceptionDate}</dd>
						) : null}
					</div>
				</dl>
			</section>

			{/* v6.3: 4 个 tile 改成 icon 上 / 文字下 的纵向 grid，一排 4 列，参考支付宝主页入口 */}
			<nav aria-label="收益看板子页入口" className="grid grid-cols-4 gap-2">
				{TILES.map(({ route: r, icon, label }) => (
					<button
						key={r}
						type="button"
						onClick={() => navigate?.(r)}
						className="flex flex-col items-center justify-center gap-1 rounded-2xl border border-slate-200/70 bg-white px-1 py-2.5 text-[11px] font-medium text-slate-700 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:bg-slate-50 active:bg-slate-100 sm:gap-1.5 sm:py-3 sm:text-xs"
					>
						<span aria-hidden="true" className="text-xl leading-none sm:text-2xl">{icon}</span>
						<span className="truncate">{label}</span>
					</button>
				))}
			</nav>
		</div>
	);
}

export default IncomeSummary;
