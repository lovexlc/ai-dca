import { Suspense, lazy } from 'react';
import { cx } from '../components/experience-ui.jsx';
import { FundSwitchAnalysisExperience } from './FundSwitchAnalysisExperience.jsx';

// 「策略监测 / 机会」仍然 lazy；机会 + 复盘 现在同屏两列。
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
        {/* 左：机会（内容可能超长，跟随页面自然滚动） */}
        <div className="min-w-0">
          <Suspense fallback={<SubViewLoadingFallback />}>
            <SwitchStrategyExperienceLazy links={links} inPagesDir={inPagesDir} embedded />
          </Suspense>
        </div>
        {/* 右：复盘（右列内容较短时，使用 sticky 在视口内保持可见；较长时仅右列内部滚动） */}
        <div className="min-w-0 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto">
          <FundSwitchAnalysisExperience />
        </div>
      </div>
    </div>
  );
}
