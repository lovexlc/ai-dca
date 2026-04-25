// 加仓计划 dashboard 中的两个纯展示组件。
// 从 HomeExperience.jsx 抽离。
import { cx } from '../../components/experience-ui.jsx';


export function KpiCell({ label, value, hint, accent }) {
  return (
    <div className="px-4 py-4 sm:px-5 sm:py-5">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={cx(
        'mt-2 text-2xl font-semibold tabular-nums sm:text-[26px]',
        accent === 'emerald' && 'text-emerald-700',
        accent === 'rose' && 'text-rose-700',
        !accent && 'text-slate-900'
      )}>
        {value}
      </div>
      {hint ? <div className="mt-1 text-xs text-slate-400">{hint}</div> : null}
    </div>
  );
}

export function StatusDot({ state }) {
  const color = state === 'completed'
    ? 'bg-emerald-500'
    : state === 'next'
      ? 'bg-indigo-500'
      : 'bg-slate-300';
  return <span className={cx('inline-block h-2 w-2 rounded-full', color)} />;
}
