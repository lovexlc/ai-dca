import { Suspense, lazy, useEffect, useState } from 'react';
import { ArrowRight, BarChart3, History, Settings2 } from 'lucide-react';
import { cx } from '../components/experience-ui.jsx';
import { trackFeatureEvent } from '../app/analytics.js';
import { normalizeCnFundCode } from './markets/marketDisplayUtils.js';
import { getActiveSwitchRule } from '../app/switchStrategySync.js';
import { readSwitchPrefs } from './switchStrategyHelpers.js';

function useFundSwitchInitialSymbol() {
  const [symbol, setSymbol] = useState('');
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('symbol') || '';
    setSymbol(normalizeCnFundCode(raw) || raw.trim().toUpperCase());
  }, []);
  return symbol;
}

// PC：机会 + 复盘 同屏两列；App：子 tab 切换。
const SwitchStrategyExperienceLazy = lazy(() =>
  import('./SwitchStrategyExperience.jsx').then((m) => ({ default: m.SwitchStrategyExperience }))
);
const FundSwitchAnalysisExperienceLazy = lazy(() =>
  import('./FundSwitchAnalysisExperience.jsx').then((m) => ({ default: m.FundSwitchAnalysisExperience }))
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

function pickBacktestSymbol(initialSymbol = '') {
  const prefs = readSwitchPrefs();
  const rule = getActiveSwitchRule(prefs);
  return normalizeCnFundCode(initialSymbol)
    || (Array.isArray(rule?.benchmarkCodes) ? normalizeCnFundCode(rule.benchmarkCodes[0]) : '')
    || (Array.isArray(rule?.enabledCodes) ? normalizeCnFundCode(rule.enabledCodes[0]) : '')
    || normalizeCnFundCode(Object.keys(rule?.premiumClass || {})[0])
    || '513100';
}

export function FundSwitchExperience({ links, inPagesDir = false, embedded = false } = {}) {
  const [mobileTab, setMobileTab] = useState('config');
  const [isDesktopLayout, setIsDesktopLayout] = useState(() => (
    typeof window !== 'undefined' ? window.matchMedia('(min-width: 1024px)').matches : true
  ));
  const initialSymbol = useFundSwitchInitialSymbol();

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const query = window.matchMedia('(min-width: 1024px)');
    const update = () => setIsDesktopLayout(query.matches);
    update();
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', update);
      return () => query.removeEventListener('change', update);
    }
    query.addListener(update);
    return () => query.removeListener(update);
  }, []);

  function openBacktestIntro(event) {
    if (event && (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0)) return;
    if (event) event.preventDefault();
    if (typeof window === 'undefined') return;
    const target = links?.markets || './index.html?tab=markets';
    const nextUrl = new URL(target, window.location.href);
    nextUrl.searchParams.set('tab', 'markets');
    nextUrl.searchParams.set('backtest', '1');
    nextUrl.searchParams.set('source', 'fundSwitchBanner');
    const symbol = pickBacktestSymbol(initialSymbol);
    nextUrl.searchParams.set('symbol', symbol);
    const search = nextUrl.search.replace(/^\?/, '');
    window.dispatchEvent(new CustomEvent('workspace:navigate', {
      detail: { tab: 'markets', search }
    }));
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('markets:select-symbol', {
        detail: { symbol, source: 'fundSwitchBanner' }
      }));
      window.dispatchEvent(new CustomEvent('markets:open-backtest', {
        detail: { symbol, source: 'fundSwitchBanner' }
      }));
    }, 0);
  }

  useEffect(() => {
    trackFeatureEvent('fund_switch', 'view_open', {
      view: 'fundSwitch',
      embedded,
      inPagesDir
    });
  }, [embedded, inPagesDir]);

  return (
    <div className={cx('mx-auto max-w-7xl space-y-4', embedded ? 'px-4 sm:px-6' : 'px-6')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">基金切换</div>
          <div className="mt-1 text-sm text-slate-500">配置规则、查看信号、复盘历史表现。</div>
        </div>
      </div>

      <a
        href={`${links?.markets || './index.html?tab=markets'}&symbol=${encodeURIComponent(pickBacktestSymbol(initialSymbol))}&backtest=1`}
        onClick={openBacktestIntro}
        className="flex flex-col gap-3 rounded-xl border border-indigo-100 bg-indigo-50/70 px-4 py-3 text-sm text-indigo-900 transition-colors hover:border-indigo-200 hover:bg-indigo-50 sm:flex-row sm:items-center sm:justify-between"
      >
        <span className="inline-flex min-w-0 items-center gap-2 font-semibold">
          <BarChart3 className="h-4 w-4 shrink-0" />
          <span>新功能：现在可以回测你的切换策略了</span>
        </span>
        <span className="inline-flex items-center gap-1 text-xs font-bold text-indigo-700">
          试试
          <ArrowRight className="h-4 w-4" />
        </span>
      </a>

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
            <SwitchStrategyExperienceLazy links={links} inPagesDir={inPagesDir} embedded hideViewTabs initialView={mobileTab === 'config' ? 'config' : 'opportunity'} initialSymbol={initialSymbol} />
          </Suspense>
        </div>
        {/* 右：复盘（PC 端 sticky 占满视口内可见区） */}
        <div
          className={cx(
            'min-w-0 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto',
            mobileTab === 'analysis' ? '' : 'hidden lg:block'
          )}
        >
          {isDesktopLayout || mobileTab === 'analysis' ? (
            <Suspense fallback={<SubViewLoadingFallback />}>
              <FundSwitchAnalysisExperienceLazy />
            </Suspense>
          ) : null}
        </div>
      </div>
    </div>
  );
}
