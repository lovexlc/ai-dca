// IncomeChartPage.jsx — #/chart
//
// 第三刀 3.2：把 ReturnChart 包装到子页。
// ReturnChart 本身自带 useRangeUrlSync + TimeRangeSelector + 加载/错误态，所以这里只是 SubPageShell 薄壳。

import { lazy, Suspense } from 'react';
import { LoaderCircle } from 'lucide-react';
import SubPageShell from './SubPageShell.jsx';

const ReturnChart = lazy(() => import('../ReturnChart.jsx'));

function Fallback() {
  return (
    <div className="flex items-center gap-2 text-[11px] text-slate-400 sm:text-xs">
      <LoaderCircle className="size-3 animate-spin" />
      <span>加载收益曲线…</span>
    </div>
  );
}

export function IncomeChartPage({ ledger, onBack }) {
  return (
    <SubPageShell title="收益曲线" onBack={onBack}>
      <div className="rounded-2xl border border-slate-200/70 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-4">
        <Suspense fallback={<Fallback />}>
          <ReturnChart ledger={ledger} />
        </Suspense>
      </div>
    </SubPageShell>
  );
}

export default IncomeChartPage;
