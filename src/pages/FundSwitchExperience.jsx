import { Suspense, lazy, useEffect, useState } from 'react';
import { Radar, Shuffle } from 'lucide-react';
import { cx } from '../components/experience-ui.jsx';
import { FundSwitchAnalysisExperience } from './FundSwitchAnalysisExperience.jsx';

// 「策略监测」二级视图：场内/场外纳指 100 套利策略实时建议器，
// 首次进入才拉取实时价格快照，所以仍 lazy 加载。
const SwitchStrategyExperienceLazy = lazy(() =>
  import('./SwitchStrategyExperience.jsx').then((m) => ({ default: m.SwitchStrategyExperience }))
);

// 二级视图与 URL hash 对应关系：
//   ''  / '#review'  → 切换复盘（基于 ledger 自动推切换链路 + 收益分析），默认
//   '#monitor'       → 策略监测（实时套利机会建议）
const SUB_VIEW_HASH = {
  review: '',
  monitor: '#monitor'
};

function parseSubViewFromHash(hash = '') {
  return hash === '#monitor' ? 'monitor' : 'review';
}

function getInitialSubView() {
  if (typeof window === 'undefined') return 'review';
  return parseSubViewFromHash(window.location.hash || '');
}

function SubViewLoadingFallback() {
  return (
    <div className="flex h-full min-h-[40vh] items-center justify-center text-sm text-slate-500">
      加载中…
    </div>
  );
}

const SUB_TABS = [
  { key: 'review', label: '复盘', icon: Shuffle },
  { key: 'monitor', label: '机会', icon: Radar }
];

export function FundSwitchExperience({ links, inPagesDir = false, embedded = false } = {}) {
  const [subView, setSubView] = useState(getInitialSubView);

  function gotoSubView(nextView) {
    if (typeof window === 'undefined') {
      setSubView(nextView);
      return;
    }
    const targetHash = SUB_VIEW_HASH[nextView] ?? '';
    const currentHash = window.location.hash || '';
    if (currentHash !== targetHash) {
      const baseUrl = `${window.location.pathname}${window.location.search}${targetHash}`;
      window.history.replaceState({ fundSwitchView: nextView }, '', baseUrl);
    }
    setSubView(nextView);
  }

  function handleSelectSubTab(nextView) {
    if (nextView === subView) return;
    gotoSubView(nextView);
  }

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    function syncSubViewFromHash() {
      setSubView(parseSubViewFromHash(window.location.hash || ''));
    }
    window.addEventListener('hashchange', syncSubViewFromHash);
    window.addEventListener('popstate', syncSubViewFromHash);
    return () => {
      window.removeEventListener('hashchange', syncSubViewFromHash);
      window.removeEventListener('popstate', syncSubViewFromHash);
    };
  }, []);

  return (
    <div className={cx('mx-auto max-w-7xl space-y-6', embedded ? 'px-4 pt-6 sm:px-6 sm:pt-8' : 'px-6 pt-8')}>
      <div className="inline-flex flex-wrap gap-1 rounded-2xl border border-slate-200 bg-slate-100/70 p-1">
        {SUB_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = subView === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => handleSelectSubTab(tab.key)}
              className={cx(
                'inline-flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-sm font-semibold transition-colors',
                isActive
                  ? 'bg-white text-indigo-700 shadow-sm'
                  : 'text-slate-500 hover:bg-white/60 hover:text-slate-700'
              )}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {subView === 'monitor' ? (
        <Suspense fallback={<SubViewLoadingFallback />}>
          <SwitchStrategyExperienceLazy links={links} inPagesDir={inPagesDir} embedded />
        </Suspense>
      ) : (
        <FundSwitchAnalysisExperience />
      )}
    </div>
  );
}
