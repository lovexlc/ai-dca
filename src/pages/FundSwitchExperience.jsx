import { Suspense, lazy } from 'react';
import { cx } from '../components/experience-ui.jsx';
import { FundSwitchAnalysisExperience } from './FundSwitchAnalysisExperience.jsx';

// 「策略监测」仍然 lazy，首屏不拉实时价格快照；
// 复盘 / 机会 现在是两列同屏同时加载。
const SwitchStrategyExperienceLazy = lazy(() =>
  import('./SwitchStrategyExperience.jsx').then((m) => ({ default: m.SwitchStrategyExperience }))
);

function SubViewLoadingFallback() {
  return (
    <div className="flex h-full min-h-[40vh] items-center justify-center text-sm text-slate-500">
      加载中…
    </div>
  );
}

export function FundSwitchExperience({ links, inPagesDir = false, embedded = false } = {}) {
  return (
    <div className={cx('mx-auto max-w-7xl', embedded ? 'px-4 pt-6 sm:px-6 sm:pt-8' : 'px-6 pt-8')}>
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2 lg:gap-6">
        <div className="min-w-0">
          <FundSwitchAnalysisExperience />
        </div>
        <div className="min-w-0">
          <Suspense fallback={<SubViewLoadingFallback />}>
            <SwitchStrategyExperienceLazy links={links} inPagesDir={inPagesDir} embedded />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
