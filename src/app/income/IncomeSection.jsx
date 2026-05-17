// IncomeSection.jsx
//
// 路由转发器：根据 #/<route> 切换主页 (IncomeSummary) 或子页 (lazy)。
//
// - OVERVIEW (route='') 渲染 <IncomeSummary/>。
// - 其他路由都是 lazy 子页。
// - 第四刀 4.1：ReturnChart + ReturnCalendar 合并进 IncomeDetailPage；
//   ROUTES.CHART / ROUTES.CALENDAR alias 到 IncomeDetailPage（保留旧 hash 兼容）。

import { lazy, Suspense } from 'react';
import { LoaderCircle } from 'lucide-react';
import { IncomeSummary } from './IncomeSummary.jsx';
import { ROUTES, useIncomeRoute } from '../incomeRoute.js';

const IncomeDetailPage = lazy(() => import('./IncomeDetailPage.jsx'));
const IncomeBreakdownPage = lazy(() => import('./IncomeBreakdownPage.jsx'));
const IncomeTransactionsPage = lazy(() => import('./IncomeTransactionsPage.jsx'));

const PAGE_BY_ROUTE = {
	[ROUTES.INCOME]: IncomeDetailPage,
	// 4.1: 旧子路由 alias 到收益明细（曲线 + 日历已内嵌）
	[ROUTES.CHART]: IncomeDetailPage,
	[ROUTES.CALENDAR]: IncomeDetailPage,
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
