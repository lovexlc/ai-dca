import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { BarChart3, History, Settings2 } from 'lucide-react';
import { cx } from '../components/experience-ui.jsx';
import { trackFeatureEvent } from '../app/analytics.js';
import { triggerConversionPrompt } from '../app/conversionPrompts.js';

const SwitchStrategySetupExperienceLazy = lazy(() => import('./SwitchStrategySetupExperience.jsx').then((m) => ({ default: m.SwitchStrategySetupExperience })));
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

export function FundSwitchExperience({ inPagesDir = false, embedded = false } = {}) {
  const [activeView, setActiveView] = useState(readInitialView);
  const entryAttribution = useMemo(() => {
    if (typeof window === 'undefined') return {};
    const params = new URLSearchParams(window.location.search || '');
    return { entrySource: String(params.get('source') || '').slice(0, 60), fromNotification: params.get('source') === 'notification' };
  }, []);

  useEffect(() => {
    trackFeatureEvent('fund_switch', 'view_open', { view: activeView, embedded, inPagesDir, ...entryAttribution });
    const timer = window.setTimeout(() => triggerConversionPrompt('fund_switch_view_open', { view: activeView }), 15000);
    return () => window.clearTimeout(timer);
  }, [activeView, embedded, entryAttribution, inPagesDir]);

  function selectView(nextView) {
    if (nextView === activeView) return;
    const previousView = activeView;
    setActiveView(nextView);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', 'fundSwitch');
      if (nextView === 'config') url.searchParams.delete('view');
      else url.searchParams.set('view', nextView);
      if (nextView !== 'backtest') url.searchParams.delete('symbol');
      window.history.replaceState({ tab: 'fundSwitch', view: nextView }, '', url);
    }
    trackFeatureEvent('fund_switch', 'subtab_select', { view: nextView, previousView, ...entryAttribution });
  }

  return <div className={cx('mx-auto max-w-7xl space-y-4', embedded ? 'px-3 sm:px-6' : 'px-4 sm:px-6')}>
    <div className="sticky top-0 z-20 rounded-2xl border border-slate-200/80 bg-white/95 p-1.5 shadow-sm backdrop-blur">
      <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1" role="tablist" aria-label="基金切换功能">
        {SUB_TABS.map((tab) => { const Icon = tab.icon; const active = activeView === tab.id; return <button key={tab.id} type="button" role="tab" aria-selected={active} onClick={() => selectView(tab.id)} className={cx('inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-2 text-sm font-bold transition-all', active ? 'bg-white text-slate-950 shadow-sm ring-1 ring-slate-200/70' : 'text-slate-500 hover:text-slate-800')}><Icon className={cx('h-4 w-4', active && tab.id === 'backtest' ? 'text-indigo-600' : '')} /><span className="hidden sm:inline">{tab.label}</span><span className="sm:hidden">{tab.shortLabel}</span></button>; })}
      </div>
    </div>
    <div role="tabpanel" aria-label={SUB_TABS.find((item) => item.id === activeView)?.label} className="min-w-0">
      <Suspense fallback={<SubViewLoadingFallback />}>
        {activeView === 'config' ? <SwitchStrategySetupExperienceLazy /> : null}
        {activeView === 'analysis' ? <FundSwitchAnalysisExperienceLazy /> : null}
        {activeView === 'backtest' ? <BacktestExperienceLazy embedded /> : null}
      </Suspense>
    </div>
  </div>;
}
