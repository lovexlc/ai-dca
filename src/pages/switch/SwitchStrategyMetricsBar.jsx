import { useState } from 'react';
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
    <div className="bg-white rounded-xl border border-slate-200 p-3 sm:p-4 space-y-2.5 sm:space-y-0 sm:flex sm:items-center sm:justify-between shadow-xs">
      {/* 3 紧凑指标卡 (移动端一行3列，间距紧凑自然) */}
      <div className="grid grid-cols-3 sm:flex sm:flex-wrap sm:items-center gap-1.5 sm:gap-3 text-center sm:text-left">
        <div className="px-2.5 py-1.5 bg-slate-50 rounded-lg border border-slate-100 min-w-[75px]">
          <div className="text-[10px] text-slate-400 font-medium">方案总数</div>
          <div className="font-bold text-slate-800 text-xs sm:text-sm">{total}</div>
        </div>
        <div className="px-2.5 py-1.5 bg-emerald-50/70 rounded-lg border border-emerald-100 min-w-[75px]">
          <div className="text-[10px] text-emerald-600 font-medium">监控中</div>
          <div className="font-bold text-emerald-700 text-xs sm:text-sm">{monitoring}</div>
        </div>
        <div className="px-2.5 py-1.5 bg-amber-50/70 rounded-lg border border-amber-100 min-w-[75px]">
          <div className="text-[10px] text-amber-600 font-medium">今日触发</div>
          <div className="font-bold text-amber-700 text-xs sm:text-sm">{triggeredToday} 次</div>
        </div>
      </div>

      {/* 搜索框与新建方案按钮 */}
      <div className="flex items-center space-x-2 pt-1 sm:pt-0">
        <div className="relative flex-1 sm:w-44">
          <input
            type="text"
            placeholder="搜索标的..."
            value={keyword}
            onChange={(e) => onKeywordChange?.(e.target.value)}
            className="w-full pl-7 pr-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-500 focus:bg-white transition-all"
          />
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2 top-2 pointer-events-none" />
        </div>

        {/* 视图切换 */}
        <div className="hidden sm:flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200">
          <button
            type="button"
            onClick={() => onViewModeChange?.('grid')}
            className={cx('p-1.5 rounded-md transition-colors cursor-pointer', viewMode === 'grid' ? 'bg-white text-indigo-600 shadow-xs' : 'text-slate-500 hover:text-slate-800')}
            title="卡片视图"
          >
            <LayoutGrid className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onViewModeChange?.('table')}
            className={cx('p-1.5 rounded-md transition-colors cursor-pointer', viewMode === 'table' ? 'bg-white text-indigo-600 shadow-xs' : 'text-slate-500 hover:text-slate-800')}
            title="列表视图"
          >
            <List className="w-3.5 h-3.5" />
          </button>
        </div>

        <button
          type="button"
          onClick={onCreate}
          className="shrink-0 flex items-center space-x-1 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-lg text-xs font-medium shadow-xs shadow-indigo-200 transition-all cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>新建方案</span>
        </button>
      </div>
    </div>
  );
}
