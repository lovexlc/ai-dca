import { cx } from '../../components/experience-ui.jsx';

export const MARKETS_SUB_TABS = [
  { id: 'classic', label: '标准行情' },
  { id: 'beta', label: '新版 Beta', badge: 'HOT' },
];

export function MarketsViewTabs({ activeView = 'classic', onSelectView, sticky = false, className = '' }) {
  return (
    <div className={cx(
      'flex items-center justify-between px-3 sm:px-6 pt-2 shrink-0 z-30',
      sticky && 'sticky top-0 backdrop-blur-md bg-white/85 dark:bg-slate-900/85 pb-2 border-b border-slate-200/80 dark:border-slate-800',
      className
    )}>
      <div className="inline-flex items-center gap-1.5 p-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs">
        {MARKETS_SUB_TABS.map((tab) => {
          const active = activeView === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onSelectView?.(tab.id)}
              className={cx(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition-all cursor-pointer',
                active
                  ? 'bg-indigo-600 text-white shadow-xs font-bold'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/60'
              )}
            >
              <span>{tab.label}</span>
              {tab.badge ? (
                <span className={cx(
                  'text-[10px] font-mono px-1.5 py-0.2 rounded-full font-black shadow-2xs',
                  active ? 'bg-white text-indigo-700' : 'bg-rose-500 text-white animate-pulse'
                )}>
                  {tab.badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
