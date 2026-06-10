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
import { useCumulativeSparkline } from './useCumulativeSparkline.js';

const IncomeDetailPage = lazy(() => import('./IncomeDetailPage.jsx'));
const IncomeLiquidationPage = lazy(() => import('./IncomeLiquidationPage.jsx'));
const IncomeBreakdownPage = lazy(() => import('./IncomeBreakdownPage.jsx'));
const IncomeTransactionsPage = lazy(() => import('./IncomeTransactionsPage.jsx'));

const PAGE_BY_ROUTE = {
	[ROUTES.INCOME]: IncomeDetailPage,
	// 4.1: 旧子路由 alias 到收益明细（曲线 + 日历已内嵌）
	[ROUTES.CHART]: IncomeDetailPage,
	[ROUTES.CALENDAR]: IncomeDetailPage,
	[ROUTES.LIQUIDATION]: IncomeLiquidationPage,
	[ROUTES.BREAKDOWN]: IncomeBreakdownPage,
	// 第五刀 v6: TRANSACTIONS 路由重新绑定到独立子页 IncomeTransactionsPage。
	// 子页内：全部交易汇总 card + 清仓分析入口 card + 跑赢 banner + 明细列表（点击行走 onEditTransaction 回调 → 主页 sidePanel 编辑）。
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

export function IncomeSection({ ledger, portfolio, inceptionDate, aggregates, onEditTransaction, navRefresh, quickActions, accountAllocation }) {
	const { route, navigate, goBack } = useIncomeRoute();
	const SubPage = PAGE_BY_ROUTE[route];

	if (SubPage) {
		return (
			<Suspense fallback={<Fallback />}>
				<SubPage
					ledger={ledger}
					portfolio={portfolio}
					inceptionDate={inceptionDate}
					aggregates={aggregates}
					onBack={goBack}
					navigate={navigate}
					currentRoute={route}
					onEditTransaction={onEditTransaction}
				/>
			</Suspense>
		);
	}

	// OVERVIEW：v3 超瘦身 → IncomeSummary（总市值 + 当日 + 累计 + 5 tile）
	// v6.8: 套一层 OverviewSummary，在其内部调用 useCumulativeSparkline hook。
	return (
		<OverviewSummary
			ledger={ledger}
			portfolio={portfolio}
			inceptionDate={inceptionDate}
			navigate={navigate}
			navRefresh={navRefresh}
			quickActions={quickActions}
			accountAllocation={accountAllocation}
		/>
	);
}

function OverviewSummary({ ledger, portfolio, inceptionDate, navigate, navRefresh, quickActions, accountAllocation }) {
	const sparkline = useCumulativeSparkline({
		transactions: ledger?.transactions,
		inceptionDate,
	});
	return (
		<IncomeSummary
			ledger={ledger}
			portfolio={portfolio}
			inceptionDate={inceptionDate}
			navigate={navigate}
			navRefresh={navRefresh}
			cumulativeSeries={sparkline}
			cumulativeLastIso={sparkline?.lastIso}
			quickActions={quickActions}
			accountAllocation={accountAllocation}
		/>
	);
}

export default IncomeSection;
