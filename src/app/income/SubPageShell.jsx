// SubPageShell.jsx
//
// 统一的子页外壳：顶部返回按钮 + 标题 + body。
// 被 5 个子页 (IncomeDetailPage / IncomeChartPage / IncomeCalendarPage /
// IncomeBreakdownPage / IncomeTransactionsPage) 共用。

import { ChevronLeft } from 'lucide-react';

export function SubPageShell({ title, onBack, children, right = null }) {
	return (
		<section className="flex flex-col gap-3">
			<header className="flex items-center justify-between gap-2">
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
			<div className="flex flex-col gap-3">{children}</div>
		</section>
	);
}

export default SubPageShell;
