import { Activity, BarChart3, ChevronDown, Plus, RefreshCw, SlidersHorizontal } from 'lucide-react';
import { cx, primaryButtonClass } from '../experience-ui.jsx';

const MODULE_TABS = [
  { key: 'strategy', label: '策略', icon: SlidersHorizontal },
  { key: 'backtest', label: '回测', icon: BarChart3 },
  { key: 'live', label: '实盘', icon: Activity }
];

export function QuantStudioHeader({
  activeModule = 'strategy',
  counts = {},
  onModuleChange,
  onCreateNew,
  onRefresh,
  refreshing = false,
  templates = []
}) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white px-5 py-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:px-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.22em] text-slate-400">QUANT STUDIO</div>
          <div className="mt-1 flex items-center gap-1.5">
            <h1 className="text-2xl font-bold tracking-tight text-slate-950">量化研究</h1>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {counts.total || 0} 个策略 · Worker 溢价差模拟盘
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold leading-5 text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={onRefresh}
            disabled={refreshing}
          >
            <RefreshCw className={cx('h-4 w-4', refreshing ? 'animate-spin' : '')} />
            刷新
          </button>
          {templates.length > 0 ? (
            <div className="relative">
              <button
                type="button"
                className={primaryButtonClass}
                onClick={() => {
                  const menu = document.getElementById('quant-create-menu');
                  if (menu) menu.classList.toggle('hidden');
                }}
              >
                <Plus className="h-4 w-4" />
                新建策略
                <ChevronDown className="h-4 w-4" />
              </button>
              <div
                id="quant-create-menu"
                className="absolute right-0 top-12 z-10 hidden w-64 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg"
              >
                {templates.map((template) => {
                  const Icon = template.Icon;
                  return (
                    <button
                      key={template.key}
                      type="button"
                      onClick={() => {
                        onCreateNew?.(template.draft);
                        document.getElementById('quant-create-menu')?.classList.add('hidden');
                      }}
                      className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50"
                    >
                      <span className={cx(
                        'inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg',
                        template.accent === 'emerald' ? 'bg-emerald-50 text-emerald-600' : 'bg-indigo-50 text-indigo-600'
                      )}>
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="flex-1 pt-0.5">
                        <span className="block text-sm font-bold text-slate-900">{template.label}</span>
                        <span className="mt-0.5 block text-xs leading-5 text-slate-500">{template.description}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <button
              type="button"
              className={primaryButtonClass}
              onClick={() => onCreateNew?.()}
            >
              <Plus className="h-4 w-4" />
              新建策略
            </button>
          )}
        </div>
      </div>
      <div className="mt-5">
        <div className="overflow-x-auto border-b border-slate-200" role="tablist" aria-label="量化研究模块">
          <div className="flex min-w-max items-center gap-0">
            {MODULE_TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeModule === tab.key;
              const count = counts[tab.key];
              const label = typeof count === 'number' ? `${tab.label} · ${count}` : tab.label;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => onModuleChange?.(tab.key)}
                  role="tab"
                  aria-selected={isActive}
                  className={cx(
                    'inline-flex min-h-12 shrink-0 items-center gap-1.5 border-b-2 px-4 py-3 text-sm font-semibold transition-all duration-200',
                    isActive
                      ? 'border-indigo-500 text-indigo-700'
                      : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800'
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
