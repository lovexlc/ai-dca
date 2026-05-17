// IncomeSection.jsx
//
// 第一刀 路由转发器：根据 #/<route> 切换主页 或 5 个子页 (lazy)。
//
// - 主页 (OVERVIEW) 暂时直接渲染原 <IncomeDetail/>，加一排临时的 5 tile
//   链接以便在第二刀之前就能点入子页骨架。
// - 第二刀会把 OVERVIEW 那一支换成 <IncomeSummary/> (主页瘦身)。

import { lazy, Suspense } from 'react';
import { LoaderCircle } from 'lucide-react';
import { IncomeDetail } from '../IncomeDetail.jsx';
import { ROUTES, useIncomeRoute } from '../incomeRoute.js';

const IncomeDetailPage = lazy(() => import('./IncomeDetailPage.jsx'));
const IncomeChartPage = lazy(() => import('./IncomeChartPage.jsx'));
const IncomeCalendarPage = lazy(() => import('./IncomeCalendarPage.jsx'));
const IncomeBreakdownPage = lazy(() => import('./IncomeBreakdownPage.jsx'));
const IncomeTransactionsPage = lazy(() => import('./IncomeTransactionsPage.jsx'));

const PAGE_BY_ROUTE = {
	[ROUTES.INCOME]: IncomeDetailPage,
	[ROUTES.CHART]: IncomeChartPage,
	[ROUTES.CALENDAR]: IncomeCalendarPage,
	[ROUTES.BREAKDOWN]: IncomeBreakdownPage,
	[ROUTES.TRANSACTIONS]: IncomeTransactionsPage,
};

const TILES = [
	{ route: ROUTES.INCOME, icon: '📊', label: '收益明细' },
	{ route: ROUTES.CHART, icon: '📈', label: '收益曲线' },
	{ route: ROUTES.CALENDAR, icon: '📅', label: '收益日历' },
	{ route: ROUTES.BREAKDOWN, icon: '🥧', label: '持仓分析' },
	{ route: ROUTES.TRANSACTIONS, icon: '💱', label: '交易记录' },
];

function Fallback() {
	return (
		<div className="flex items-center gap-2 px-1 py-4 text-sm text-slate-500">
			<LoaderCircle className="size-3 animate-spin" />
			<span>加载中</span>
		</div>
	);
}

export function IncomeSection({ ledger }) {
	const { route, navigate, goBack } = useIncomeRoute();
	const SubPage = PAGE_BY_ROUTE[route];

	if (SubPage) {
		return (
			<Suspense fallback={<Fallback />}>
				<SubPage ledger={ledger} onBack={goBack} navigate={navigate} />
			</Suspense>
		);
	}

	// OVERVIEW: 第一刀暂时保留原 IncomeDetail，第二刀换成 IncomeSummary。
	return (
		<div className="flex flex-col gap-3">
			<IncomeDetail ledger={ledger} />
			<nav
				aria-label="收益看板子页入口"
				className="grid grid-cols-3 gap-2 sm:grid-cols-5"
			>
				{TILES.map(({ route: r, icon, label }) => (
					<button
						key={r}
						type="button"
						onClick={() => navigate(r)}
						className="flex flex-col items-center gap-1 rounded-2xl border border-slate-200/70 bg-white px-3 py-3 text-xs font-medium text-slate-700 shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:bg-slate-50 active:bg-slate-100 sm:text-sm"
					>
						<span aria-hidden="true" className="text-lg leading-none">{icon}</span>
						<span>{label}</span>
					</button>
				))}
			</nav>
		</div>
	);
}

export default IncomeSection;
