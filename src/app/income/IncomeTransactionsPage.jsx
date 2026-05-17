// IncomeTransactionsPage.jsx — #/transactions
//
// 第一刀 占位：独立的交易记录页。第三刀从 HoldingsExperience 里嵌入式表抽走。

import SubPageShell from './SubPageShell.jsx';

export function IncomeTransactionsPage({ onBack }) {
	return (
		<SubPageShell title="交易记录" onBack={onBack}>
			<div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 p-6 text-center text-sm text-slate-500">
				第三刀把 HoldingsExperience 里现有的交易表抽走。
			</div>
		</SubPageShell>
	);
}

export default IncomeTransactionsPage;
