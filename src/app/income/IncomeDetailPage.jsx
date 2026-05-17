// IncomeDetailPage.jsx — #/income
//
// 第一刀 占位：4 KPI + 11 镜头切换器，第二/三刀从 IncomeDetail.jsx 搬过来。

import SubPageShell from './SubPageShell.jsx';

export function IncomeDetailPage({ onBack }) {
	return (
		<SubPageShell title="收益明细" onBack={onBack}>
			<div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 p-6 text-center text-sm text-slate-500">
				第二刀会把 4 KPI + 11 镜头切换器搬到这里。
			</div>
		</SubPageShell>
	);
}

export default IncomeDetailPage;
