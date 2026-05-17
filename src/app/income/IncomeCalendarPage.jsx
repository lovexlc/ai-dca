// IncomeCalendarPage.jsx — #/calendar
//
// 第三刀 3.3：把 ReturnCalendar 包装到子页。
// ReturnCalendar 本身自带月份切换 + 加载/错误态 + Popover 日详情。

import { lazy, Suspense } from 'react';
import { LoaderCircle } from 'lucide-react';
import SubPageShell from './SubPageShell.jsx';

const ReturnCalendar = lazy(() => import('../ReturnCalendar.jsx'));

function Fallback() {
  return (
    <div className="flex items-center gap-2 text-[11px] text-slate-400 sm:text-xs">
      <LoaderCircle className="size-3 animate-spin" />
      <span>加载收益日历…</span>
    </div>
  );
}

export function IncomeCalendarPage({ ledger, onBack }) {
  return (
    <SubPageShell title="收益日历" onBack={onBack}>
      <div className="rounded-2xl border border-slate-200/70 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-4">
        <Suspense fallback={<Fallback />}>
          <ReturnCalendar ledger={ledger} />
        </Suspense>
      </div>
    </SubPageShell>
  );
}

export default IncomeCalendarPage;
