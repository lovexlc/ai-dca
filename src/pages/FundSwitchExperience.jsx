import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { BarChart3, BellRing, History, LayoutGrid, Settings2, Sparkles } from 'lucide-react';
import { cx } from '../components/experience-ui.jsx';
import { trackFeatureEvent } from '../app/analytics.js';
import { triggerConversionPrompt } from '../app/conversionPrompts.js';
import { SwitchTestFeedbackModal } from '../components/fund-switch/SwitchTestFeedbackModal.jsx';

const SwitchStrategyBoardExperienceLazy = lazy(() => import('./switch/SwitchStrategyBoardExperience.jsx').then((m) => ({ default: m.SwitchStrategyBoardExperience })));
const SwitchStrategySetupExperienceLazy = lazy(() => import('./SwitchStrategySetupExperience.jsx').then((m) => ({ default: m.SwitchStrategySetupExperience })));
const SwitchStrategyBetaExperienceLazy = lazy(() => import('./SwitchStrategyBetaExperience.jsx').then((m) => ({ default: m.SwitchStrategyBetaExperience })));
const SwitchStrategyChannelsViewLazy = lazy(() => import('./switch/SwitchStrategyChannelsView.jsx').then((m) => ({ default: m.SwitchStrategyChannelsView })));
const FundSwitchAnalysisExperienceLazy = lazy(() => import('./FundSwitchAnalysisExperience.jsx').then((m) => ({ default: m.FundSwitchAnalysisExperience })));
const BacktestExperienceLazy = lazy(() => import('./BacktestExperience.jsx').then((m) => ({ default: m.BacktestExperience })));

const STRATEGY_VARIANT_KEY = 'aiDcaSwitchStrategyUiVariant';
const STRATEGY_VARIANTS = ['board', 'classic'];

const SUB_TABS = [
  { id: 'config', label: '方案配置', shortLabel: '方案', icon: Settings2 },
  { id: 'analysis', label: '策略复盘', shortLabel: '复盘', icon: History },
  { id: 'backtest', label: '策略回测', shortLabel: '回测', icon: BarChart3 },
  { id: 'channels', label: '通知渠道', shortLabel: '渠道', icon: BellRing }
];

function readInitialView() {
  if (typeof window === 'undefined') return 'config';
  const value = new URLSearchParams(window.location.search).get('view') || '';
  return SUB_TABS.some((item) => item.id === value) ? value : 'config';
}

function readStrategyVariant() {
  if (typeof window === 'undefined') return 'board';
  const stored = window.localStorage.getItem(STRATEGY_VARIANT_KEY) || '';
  return STRATEGY_VARIANTS.includes(stored) ? stored : 'board';
}

function SubViewLoadingFallback() {
  return <div role="status" className="flex min-h-[40vh] items-center justify-center text-sm text-slate-400">加载中…</div>;
}

export function FundSwitchExperience({ inPagesDir = false, embedded = false } = {}) {
  const [activeView, setActiveView] = useState(readInitialView);
  const [strategyVariant, setStrategyVariant] = useState(readStrategyVariant);

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

  function selectStrategyVariant(nextVariant) {
    setStrategyVariant(nextVariant);
    if (typeof window !== 'undefined') window.localStorage.setItem(STRATEGY_VARIANT_KEY, nextVariant);
  }

  return (
    <div className={cx('mx-auto max-w-7xl space-y-3 sm:space-y-4', embedded ? 'px-3 sm:px-6' : 'px-3 sm:px-6 lg:px-8 py-3 sm:py-5')}>
      {/* 顶部选项卡：1:1 严格对齐 etf_strategy_prototype.html (行84-110) */}
      <div className="bg-white rounded-xl border border-slate-200 p-1.5 flex items-center justify-between gap-2 shadow-xs">
        <div className="flex items-center space-x-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden py-0.5 w-full sm:w-auto">
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
                  'tab-btn shrink-0 flex items-center space-x-1.5 px-3 py-1.5 rounded-lg font-medium text-xs sm:text-sm transition-colors cursor-pointer',
                  active
                    ? 'bg-indigo-50 text-indigo-600 border border-indigo-100 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                )}
              >
                <Icon className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
                <span>{tab.label}</span>
                {tab.id === 'channels' ? <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> : null}
              </button>
            );
          })}
        </div>

        {/* 版本切换胶囊 */}
        <div className="hidden sm:flex items-center bg-slate-100 p-1 rounded-lg text-xs font-medium shrink-0">
          <button
            type="button"
            onClick={() => selectStrategyVariant('classic')}
            className={cx(
              'px-2.5 py-1 rounded-md transition-all cursor-pointer',
              strategyVariant === 'classic' ? 'bg-white text-slate-900 shadow-xs font-semibold' : 'text-slate-600 hover:text-slate-900'
            )}
          >
            标准版
          </button>
          <button
            type="button"
            onClick={() => selectStrategyVariant('board')}
            className={cx(
              'px-2.5 py-1 rounded-md transition-all cursor-pointer',
              strategyVariant === 'board' ? 'bg-white text-indigo-600 shadow-xs font-semibold' : 'text-slate-600 hover:text-slate-900'
            )}
          >
            ✨ 新版 Beta
          </button>
        </div>
      </div>

      <div role="tabpanel" className="min-w-0">
        <Suspense fallback={<SubViewLoadingFallback />}>
          {activeView === 'config' && strategyVariant === 'board' ? <SwitchStrategyBoardExperienceLazy /> : null}
          {activeView === 'config' && strategyVariant === 'classic' ? <SwitchStrategySetupExperienceLazy /> : null}
          {activeView === 'analysis' ? <FundSwitchAnalysisExperienceLazy /> : null}
          {activeView === 'backtest' ? <BacktestExperienceLazy embedded /> : null}
          {activeView === 'channels' ? <SwitchStrategyChannelsViewLazy inPagesDir={inPagesDir} /> : null}
        </Suspense>
      </div>
      <SwitchTestFeedbackModal />
    </div>
  );
}
