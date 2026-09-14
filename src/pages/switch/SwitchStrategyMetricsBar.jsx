import { LayoutGrid, List, Plus, Search } from 'lucide-react';
import { cx } from '../../components/experience-ui.jsx';

export function SwitchStrategyMetricsBar({
  total = 3,
  monitoring = 2,
  triggeredToday = 3,
  keyword = '',
  onKeywordChange,
  viewMode = 'grid',
  onViewModeChange,
  onCreate
}) {
  return (
    <section className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
      {/* 左侧：三大关键指标卡 */}
      <div className="flex items-center space-x-3">
        {/* 方案总数 */}
        <div className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 min-w-[72px] text-center sm:text-left">
          <div className="text-[10px] font-medium text-slate-400">方案总数</div>
          <div className="mt-0.5 font-mono text-lg font-bold text-slate-900">{total}</div>
        </div>

        {/* 监控中 */}
        <div className="rounded-xl border border-emerald-300/80 bg-emerald-50/40 px-3.5 py-2 min-w-[72px] text-center sm:text-left">
          <div className="text-[10px] font-semibold text-emerald-600">监控中</div>
          <div className="mt-0.5 font-mono text-lg font-bold text-emerald-700">{monitoring}</div>
        </div>

        {/* 今日触发 */}
        <div className="rounded-xl border border-amber-300/80 bg-amber-50/40 px-3.5 py-2 min-w-[72px] text-center sm:text-left">
          <div className="text-[10px] font-semibold text-amber-600">今日触发</div>
          <div className="mt-0.5 font-mono text-lg font-bold text-amber-700">{triggeredToday} 次</div>
        </div>
      </div>

      {/* 右侧：搜索标的 + 视图切换 + 新建方案按钮 */}
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative min-w-[200px] flex-1 sm:flex-initial">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={keyword}
            onChange={(event) => onKeywordChange?.(event.target.value)}
            placeholder="搜索标的..."
            className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-xs text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-all"
          />
        </div>

        {/* 视图切换 */}
        <div className="flex items-center rounded-xl border border-slate-200 bg-slate-50 p-0.5">
          <button
            type="button"
            onClick={() => onViewModeChange?.('grid')}
            className={cx(
              'h-7 w-7 rounded-lg flex items-center justify-center transition-colors cursor-pointer',
              viewMode === 'grid' ? 'bg-white shadow-xs text-indigo-600' : 'text-slate-400 hover:text-slate-600'
            )}
            title="网格看板"
          >
            <LayoutGrid className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onViewModeChange?.('table')}
            className={cx(
              'h-7 w-7 rounded-lg flex items-center justify-center transition-colors cursor-pointer',
              viewMode === 'table' ? 'bg-white shadow-xs text-indigo-600' : 'text-slate-400 hover:text-slate-600'
            )}
            title="列表视图"
          >
            <List className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* 新建方案主按钮 */}
        <button
          type="button"
          onClick={onCreate}
          className="inline-flex h-9 items-center justify-center gap-1 rounded-xl bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 px-4 text-xs font-bold text-white shadow-xs shadow-indigo-200 transition-colors cursor-pointer"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>新建方案</span>
        </button>
      </div>
    </section>
  );
}

export default SwitchStrategyMetricsBar;
