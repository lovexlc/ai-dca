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
const IncomeLiquidationPage = lazy(() => import('./IncomeLiquidationPage.jsx'));
const IncomeBreakdownPage = lazy(() => import('./IncomeBreakdownPage.jsx'));

const PAGE_BY_ROUTE = {
	[ROUTES.INCOME]: IncomeDetailPage,
	// 4.1: 旧子路由 alias 到收益明细（曲线 + 日历已内嵌）
	[ROUTES.CHART]: IncomeDetailPage,
	[ROUTES.CALENDAR]: IncomeDetailPage,
	[ROUTES.LIQUIDATION]: IncomeLiquidationPage,
	[ROUTES.BREAKDOWN]: IncomeBreakdownPage,
	// 第五刀 5.3: TRANSACTIONS 路由不再渲染独立子页 — HoldingsExperience 在 #/transactions
	// 路由下直接渲染 ledger 编辑表（成交流水移到这里并支持修改）。chip rail 仍由 IncomeSummary 提供。
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
