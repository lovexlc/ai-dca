// IncomeChartPage.jsx — #/chart
//
// 第一刀 占位：ReturnChart + 沪深300 基准 + 范围选择器，第三刀接入。

import SubPageShell from './SubPageShell.jsx';

export function IncomeChartPage({ onBack }) {
	return (
		<SubPageShell title="收益曲线" onBack={onBack}>
			<div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 p-6 text-center text-sm text-slate-500">
				第三刀会把 ReturnChart + 沪深300 基准 + 范围选择器搬到这里。
			</div>
		</SubPageShell>
	);
}

export default IncomeChartPage;
