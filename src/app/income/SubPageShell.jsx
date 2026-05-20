// SubPageShell.jsx
//
// 统一的子页外壳：顶部返回按钮 + 标题 + body。
// 被 5 个子页 (IncomeDetailPage / IncomeChartPage / IncomeCalendarPage /
// IncomeBreakdownPage / IncomeTransactionsPage) 共用。

import { ArrowLeftRight, BarChart3, ChevronLeft, PieChart, Receipt } from 'lucide-react';
import { ROUTES } from '../incomeRoute.js';

const SUB_NAV = [
	{ route: ROUTES.INCOME, label: '收益明细', labelShort: '收益', Icon: BarChart3 },
	{ route: ROUTES.LIQUIDATION, label: '清仓分析', labelShort: '清仓', Icon: Receipt },
	{ route: ROUTES.BREAKDOWN, label: '持仓分析', labelShort: '持仓', Icon: PieChart },
	{ route: ROUTES.TRANSACTIONS, label: '交易记录', labelShort: '记录', Icon: ArrowLeftRight },
];

export function SubPageShell({ title, onBack, children, right = null, navigate = null, currentRoute = '' }) {
	return (
		<section className="flex flex-col gap-3">
			<header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div className="flex items-center gap-2">
					<button
						type="button"
						onClick={onBack}
						className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-slate-600 hover:bg-slate-100 active:bg-slate-200"
						aria-label="返回持仓总览"
					>
						<ChevronLeft className="size-4" />
						<span>返回</span>
					</button>
					<h2 className="text-base font-semibold text-slate-800 sm:text-lg">{title}</h2>
				</div>
				{right ? <div className="flex items-center gap-2">{right}</div> : null}
			</header>
			{typeof navigate === 'function' ? (
				<nav aria-label="持仓收益子页" className="flex flex-wrap gap-1 rounded-2xl border border-slate-200 bg-slate-100/70 p-1">
					{SUB_NAV.map(({ route, label, labelShort, Icon }) => {
						const active = currentRoute === route;
						return (
							<button
								key={route}
								type="button"
								onClick={() => navigate(route)}
								aria-current={active ? 'page' : undefined}
								className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors ${active ? 'bg-white text-rose-700 shadow-sm' : 'text-slate-500 hover:bg-white/70 hover:text-slate-800'}`}
							>
								<Icon className="size-3.5" aria-hidden="true" />
								<span className="sm:hidden">{labelShort || label}</span>
								<span className="hidden sm:inline">{label}</span>
							</button>
						);
					})}
				</nav>
			) : null}
			<div className="flex flex-col gap-3">{children}</div>
		</section>
	);
}

export default SubPageShell;
