import { useState } from 'react';
import { cx } from './experience-ui.jsx';
import { BarChart3, LineChart, TrendingUp } from 'lucide-react';

/**
 * InteractiveChartContainer - 交互式图表容器
 * 提供视图切换和图表控制
 */
export function InteractiveChartContainer({
  children,
  views = [],
  activeView,
  onViewChange,
  className
}) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  const viewIcons = {
    equity: LineChart,
    kline: BarChart3,
    premium: TrendingUp
  };

  return (
    <div className={cx(
      'rounded-2xl border-2 border-slate-200 bg-white shadow-sm overflow-hidden',
      isFullscreen && 'fixed inset-4 z-50',
      className
    )}>
      {/* 图表控制栏 */}
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
        <div className="flex items-center gap-2">
          {views.map(view => {
            const Icon = viewIcons[view.id] || BarChart3;
            const isActive = activeView === view.id;
            return (
              <button
                key={view.id}
                type="button"
                onClick={() => onViewChange(view.id)}
                className={cx(
                  'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all',
                  isActive
                    ? 'bg-indigo-100 text-indigo-700 shadow-sm'
                    : 'text-slate-600 hover:bg-slate-100'
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {view.label}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => setIsFullscreen(!isFullscreen)}
          className="text-xs font-semibold text-slate-600 hover:text-slate-900"
        >
          {isFullscreen ? '退出全屏' : '全屏'}
        </button>
      </div>

      {/* 图表内容区 */}
      <div className="p-6">
        {children}
      </div>
    </div>
  );
}
