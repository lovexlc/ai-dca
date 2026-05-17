// IncomeSection.jsx
//
// 路由转发器：根据 #/<route> 切换主页 (IncomeSummary) 或 5 个子页 (lazy)。
//
// - OVERVIEW (route='') 渲染 <IncomeSummary/>，顶部轻量 KPI + A/B 布局 + 5 tile。
// - 其他路由都是 lazy 子页（第三刀装入原处件）。
// - IncomeDetail.jsx 仍有效且被原 HoldingsExperience 其他入口还可复用；
//   第三刀会拆拆那块。

import { lazy, Suspense } from 'react';
import { LoaderCircle } from 'lucide-react';
import { IncomeSummary } from './IncomeSummary.jsx';
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

function Fallback() {
	return (
		<div className="flex items-center gap-2 px-1 py-4 text-sm text-slate-500">
			<LoaderCircle className="size-3 animate-spin" />
			<span>加载中</span>
		</div>
	);
}

export function IncomeSection({ ledger, portfolio, inceptionDate }) {
	const { route, navigate, goBack } = useIncomeRoute();
	const SubPage = PAGE_BY_ROUTE[route];

	if (SubPage) {
		return (
			<Suspense fallback={<Fallback />}>
				<SubPage ledger={ledger} onBack={goBack} navigate={navigate} />
			</Suspense>
		);
	}

	// OVERVIEW：v3 超瘦身 → IncomeSummary（总市值 + 当日 + 累计 + 5 tile）
	return (
		<IncomeSummary
			ledger={ledger}
			portfolio={portfolio}
			inceptionDate={inceptionDate}
			navigate={navigate}
		/>
	);
}

export default IncomeSection;
