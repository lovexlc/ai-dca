import { cx } from './experience-ui.jsx';

/**
 * TabNavigation - Tab 导航组件
 * 用于在不同视图之间切换
 */
export function TabNavigation({ tabs, activeTab, onChange, className }) {
  return (
    <div className={cx('border-b border-slate-200 bg-white', className)}>
      <div className="flex gap-1 px-6">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChange(tab.id)}
              className={cx(
                'relative flex items-center gap-2 px-4 py-3 text-sm font-semibold transition-colors',
                isActive
                  ? 'text-indigo-600'
                  : 'text-slate-600 hover:text-slate-900'
              )}
            >
              {tab.icon && <tab.icon className="h-4 w-4" />}
              {tab.label}
              {tab.badge && (
                <span className={cx(
                  'rounded-full px-2 py-0.5 text-xs font-bold',
                  isActive
                    ? 'bg-indigo-100 text-indigo-700'
                    : 'bg-slate-100 text-slate-600'
                )}>
                  {tab.badge}
                </span>
              )}
              {isActive && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
