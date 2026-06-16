import { useState } from 'react';
import { cx } from './experience-ui.jsx';
import { BarChart3, LineChart, TrendingUp, Maximize2, Minimize2 } from 'lucide-react';

/**
 * InteractiveChartContainer - 交互式图表容器
 * 提供视图切换和图表控制，优化移动端
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
      'rounded-xl sm:rounded-2xl border-2 border-slate-200 bg-white shadow-sm overflow-hidden',
      isFullscreen && 'fixed inset-2 sm:inset-4 z-50',
      className
    )}>
      {/* 图表控制栏 */}
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 sm:px-4 py-2 sm:py-3">
        <div className="flex items-center gap-1 sm:gap-2 overflow-x-auto scrollbar-hide">
          {views.map(view => {
            const Icon = viewIcons[view.id] || BarChart3;
            const isActive = activeView === view.id;
            return (
              <button
                key={view.id}
                type="button"
                onClick={() => onViewChange(view.id)}
                className={cx(
                  'flex items-center gap-1 sm:gap-1.5 rounded-lg px-2 sm:px-3 py-1.5 text-xs font-semibold transition-all whitespace-nowrap flex-shrink-0',
                  isActive
                    ? 'bg-indigo-100 text-indigo-700 shadow-sm'
                    : 'text-slate-600 hover:bg-slate-100'
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{view.label}</span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => setIsFullscreen(!isFullscreen)}
          className="text-slate-600 hover:text-slate-900 flex-shrink-0 ml-2"
          aria-label={isFullscreen ? '退出全屏' : '全屏'}
        >
          {isFullscreen ? (
            <Minimize2 className="h-4 w-4" />
          ) : (
            <Maximize2 className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* 图表内容区 */}
      <div className="p-3 sm:p-6">
        {children}
      </div>
    </div>
  );
}
