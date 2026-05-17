// IncomeCalendarPage.jsx — #/calendar
//
// 第一刀 占位：ReturnCalendar 月度热力图，第三刀接入。

import SubPageShell from './SubPageShell.jsx';

export function IncomeCalendarPage({ onBack }) {
	return (
		<SubPageShell title="收益日历" onBack={onBack}>
			<div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 p-6 text-center text-sm text-slate-500">
				第三刀会把 ReturnCalendar 搬到这里，加上月度切换控件。
			</div>
		</SubPageShell>
	);
}

export default IncomeCalendarPage;
