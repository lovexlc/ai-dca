import { LayoutGrid, List, Plus, RefreshCw, Search } from 'lucide-react';
import { cx, inputClass } from '../../components/experience-ui.jsx';

function MetricPill({ label, value, tone = 'slate' }) {
  const toneClass =
    tone === 'emerald' ? 'text-emerald-600' : tone === 'amber' ? 'text-amber-600' : 'text-slate-900';
  return (
    <div className="min-w-0 rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-center sm:text-left">
      <div className="truncate text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</div>
      <div className={cx('mt-1 truncate font-mono text-base font-black tabular-nums leading-none', toneClass)}>{value}</div>
    </div>
  );
}

// 指标工具条：3 列指标胶囊 + 搜索 + 视图切换 + 新建 CTA。
// App 端指标固定 3 列对齐，搜索独占一行，避免顶栏折行挤压。
export function SwitchStrategyMetricsBar({
  total = 0,
  monitoring = 0,
  triggeredToday = 0,
  keyword = '',
  onKeywordChange,
  viewMode = 'grid',
  onViewModeChange,
  onCreate,
  onRefresh,
  refreshing = false
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
      <div className="grid grid-cols-3 gap-2">
        <MetricPill label="方案总数" value={total} />
        <MetricPill label="监控中" value={monitoring} tone="emerald" />
        <MetricPill label="今日触发" value={`${triggeredToday} 次`} tone="amber" />
      </div>

      <div className="mt-2.5 flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={keyword}
            onChange={(event) => onKeywordChange?.(event.target.value)}
            placeholder="搜索方案名称或基金代码"
            aria-label="搜索切换方案"
            className={cx(inputClass, 'pl-9')}
          />
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden items-center rounded-xl border border-slate-200 bg-white p-1 lg:inline-flex" role="group" aria-label="视图切换">
            {[
              { id: 'grid', icon: LayoutGrid, label: '看板视图' },
              { id: 'table', icon: List, label: '列表视图' }
            ].map(({ id, icon: Icon, label }) => (
              <button
                key={id}
                type="button"
                title={label}
                aria-label={label}
                aria-pressed={viewMode === id}
                onClick={() => onViewModeChange?.(id)}
                className={cx(
                  'inline-flex h-9 w-9 items-center justify-center rounded-lg transition-colors',
                  viewMode === id ? 'bg-slate-100 text-slate-900' : 'text-slate-400 hover:text-slate-700'
                )}
              >
                <Icon className="h-4 w-4" />
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            title="刷新行情"
            aria-label="刷新行情"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw className={cx('h-4 w-4', refreshing ? 'animate-spin' : '')} />
          </button>

          <button
            type="button"
            onClick={onCreate}
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl bg-indigo-600 px-3.5 text-sm font-bold text-white shadow-sm shadow-indigo-200/70 transition-colors hover:bg-indigo-700 lg:flex-initial"
          >
            <Plus className="h-4 w-4" />
            新建方案
          </button>
        </div>
      </div>
    </section>
  );
}

export default SwitchStrategyMetricsBar;
