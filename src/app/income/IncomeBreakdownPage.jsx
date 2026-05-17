// IncomeBreakdownPage.jsx — #/breakdown
//
// 第一刀 占位：持仓分析 (品种 / 资产类型饼图 + 贡献度排序)，第四刀新建。

import SubPageShell from './SubPageShell.jsx';

export function IncomeBreakdownPage({ onBack }) {
	return (
		<SubPageShell title="持仓分析" onBack={onBack}>
			<div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 p-6 text-center text-sm text-slate-500">
				第四刀新建：品种饼图 + 资产类型饼图 + 贡献度排序。
			</div>
		</SubPageShell>
	);
}

export default IncomeBreakdownPage;
