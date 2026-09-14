import { Suspense, lazy, useState } from 'react';
import { BarChart3, History, Settings2 } from 'lucide-react';
import { cx } from '../components/experience-ui.jsx';
import { SwitchTestFeedbackModal } from '../components/fund-switch/SwitchTestFeedbackModal.jsx';

const SwitchStrategyBoardExperienceLazy = lazy(() => import('./switch/SwitchStrategyBoardExperience.jsx').then((m) => ({ default: m.SwitchStrategyBoardExperience })));
const FundSwitchAnalysisExperienceLazy = lazy(() => import('./FundSwitchAnalysisExperience.jsx').then((m) => ({ default: m.FundSwitchAnalysisExperience })));
const BacktestExperienceLazy = lazy(() => import('./BacktestExperience.jsx').then((m) => ({ default: m.BacktestExperience })));

const SUB_TABS = [
  { id: 'config', label: '方案配置', shortLabel: '方案', icon: Settings2 },
  { id: 'analysis', label: '策略复盘', shortLabel: '复盘', icon: History },
  { id: 'backtest', label: '策略回测', shortLabel: '回测', icon: BarChart3 }
];

function readInitialView() {
  if (typeof window === 'undefined') return 'config';
  const value = new URLSearchParams(window.location.search).get('view') || '';
  return SUB_TABS.some((item) => item.id === value) ? value : 'config';
}

function SubViewLoadingFallback() {
  return <div role="status" className="flex min-h-[40vh] items-center justify-center text-sm text-slate-400">加载中…</div>;
}

export function FundSwitchExperience({ embedded = false } = {}) {
  const [activeView, setActiveView] = useState(readInitialView);

  function selectView(nextView) {
    if (nextView === activeView) return;
    setActiveView(nextView);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', 'fundSwitch');
      if (nextView === 'config') url.searchParams.delete('view');
      else url.searchParams.set('view', nextView);
      window.history.replaceState({ tab: 'fundSwitch', view: nextView }, '', url);
    }
  }

  return (
    <div className={cx('mx-auto max-w-7xl space-y-3 sm:space-y-4', embedded ? 'px-3 sm:px-6' : 'px-3 sm:px-6 lg:px-8 py-3 sm:py-5')}>
      {/* 顶部子选项卡 */}
      <div className="bg-white rounded-xl border border-slate-200 p-1.5 shadow-xs">
        <div className="grid w-full grid-cols-3 gap-1 py-0.5 sm:flex sm:w-auto sm:flex-1 sm:items-center">
          {SUB_TABS.map((tab) => {
            const Icon = tab.icon;
            const active = activeView === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => selectView(tab.id)}
                className={cx(
                  'tab-btn min-w-0 flex items-center justify-center space-x-1.5 rounded-lg px-2 py-1.5 font-medium text-xs transition-colors cursor-pointer sm:shrink-0 sm:px-3 sm:text-sm',
                  active
                    ? 'bg-indigo-50 text-indigo-600 border border-indigo-100 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                )}
              >
                <Icon className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
                <span className="truncate">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div role="tabpanel" className="min-w-0">
        <Suspense fallback={<SubViewLoadingFallback />}>
          {activeView === 'config' ? <SwitchStrategyBoardExperienceLazy /> : null}
          {activeView === 'analysis' ? <FundSwitchAnalysisExperienceLazy /> : null}
          {activeView === 'backtest' ? <BacktestExperienceLazy embedded /> : null}
        </Suspense>
      </div>
      <SwitchTestFeedbackModal />
    </div>
  );
}
