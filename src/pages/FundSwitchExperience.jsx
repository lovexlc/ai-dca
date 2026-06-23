import { Suspense, lazy, useEffect, useState } from 'react';
import { History, Settings2 } from 'lucide-react';
import { Card, cx } from '../components/experience-ui.jsx';
import { FundSwitchAnalysisExperience } from './FundSwitchAnalysisExperience.jsx';
import { trackFeatureEvent } from '../app/analytics.js';
import { FundSwitchGuide, shouldShowFundSwitchGuide } from '../components/FundSwitchGuide.jsx';

// PC：机会 + 复盘 同屏两列；App：子 tab 切换。
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

const MOBILE_TABS = [
  { id: 'config', label: '规则', icon: Settings2 },
  { id: 'analysis', label: '复盘', icon: History }
];

export function FundSwitchExperience({ links, inPagesDir = false, embedded = false } = {}) {
  const [mobileTab, setMobileTab] = useState('config');
  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    trackFeatureEvent('fund_switch', 'view_open', {
      view: 'fundSwitch',
      embedded,
      inPagesDir
    });
    setShowGuide(shouldShowFundSwitchGuide());
  }, []);

  return (
    <div className={cx('mx-auto max-w-7xl space-y-4', embedded ? 'px-4 sm:px-6' : 'px-6')}>
      {/* 首次使用引导教程 */}
      {showGuide && (
        <FundSwitchGuide
          onDismiss={() => {
            setShowGuide(false);
            trackFeatureEvent('fund_switch', 'guide_dismissed', {});
          }}
        />
      )}

      {/* 移动端子 tab；lg+ 隐藏，PC 直接两列 */}
      <div className="mb-3 inline-flex gap-1 rounded-full bg-slate-100 p-1 lg:hidden">
        {MOBILE_TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setMobileTab(t.id);
                trackFeatureEvent('fund_switch', 'mobile_subtab_select', {
                  view: t.id,
                  previousView: mobileTab
                });
              }}
              aria-pressed={mobileTab === t.id}
              className={cx(
                'inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition-colors',
                mobileTab === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
              )}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2 lg:gap-6">
        {/* 左：机会 / 规则 */}
        <div className={cx('min-w-0', mobileTab === 'analysis' ? 'hidden lg:block' : '')}>
          <Suspense fallback={<SubViewLoadingFallback />}>
            <SwitchStrategyExperienceLazy links={links} inPagesDir={inPagesDir} embedded hideViewTabs initialView={mobileTab === 'config' ? 'config' : 'opportunity'} />
          </Suspense>
        </div>
        {/* 右：复盘（PC 端 sticky 占满视口内可见区） */}
        <div
          className={cx(
            'min-w-0 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto',
            mobileTab === 'analysis' ? '' : 'hidden lg:block'
          )}
        >
          <FundSwitchAnalysisExperience />
        </div>
      </div>
    </div>
  );
}
