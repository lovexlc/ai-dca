import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { BarChart3, History, Settings2 } from 'lucide-react';
import { cx } from '../components/experience-ui.jsx';
import { trackFeatureEvent } from '../app/analytics.js';
import { triggerConversionPrompt } from '../app/conversionPrompts.js';
import { normalizeCnFundCode } from './markets/marketDisplayUtils.js';
import { getActiveSwitchRule } from '../app/switchStrategySync.js';
import { readSwitchPrefs } from './switchStrategyHelpers.js';

function useFundSwitchInitialSymbol() {
  const [symbol, setSymbol] = useState('');
  useEffect(() => { if (typeof window === 'undefined') return; const params = new URLSearchParams(window.location.search); const raw = params.get('symbol') || ''; setSymbol(normalizeCnFundCode(raw) || raw.trim().toUpperCase()); }, []);
  return symbol;
}
function readFundSwitchEntryAttribution() {
  if (typeof window === 'undefined') return {};
  const params = new URLSearchParams(window.location.search || '');
  const source = String(params.get('source') || '').trim().slice(0, 60);
  return { entrySource: source, notificationCode: normalizeCnFundCode(params.get('code') || '') || '', notificationTargetCode: normalizeCnFundCode(params.get('targetCode') || '') || '', notificationTrigger: String(params.get('trigger') || '').slice(0, 60), notificationRule: String(params.get('rule') || '').slice(0, 40), fromNotification: source === 'notification' };
}
const SwitchStrategySetupExperienceLazy = lazy(() => import('./SwitchStrategySetupExperience.jsx').then((m) => ({ default: m.SwitchStrategySetupExperience })));
const FundSwitchAnalysisExperienceLazy = lazy(() => import('./FundSwitchAnalysisExperience.jsx').then((m) => ({ default: m.FundSwitchAnalysisExperience })));
function SubViewLoadingFallback() { return <div className="flex min-h-[40vh] items-center justify-center text-sm text-slate-400">加载中…</div>; }
const MOBILE_TABS = [{ id: 'config', label: '方案', icon: Settings2 }, { id: 'analysis', label: '复盘', icon: History }];
function pickBacktestSymbol(initialSymbol = '') { const rule = getActiveSwitchRule(readSwitchPrefs()); return normalizeCnFundCode(initialSymbol) || normalizeCnFundCode(rule?.benchmarkCodes?.[0]) || normalizeCnFundCode(rule?.enabledCodes?.[0]) || normalizeCnFundCode(Object.keys(rule?.premiumClass || {})[0]) || '513100'; }
export function FundSwitchExperience({ links, inPagesDir = false, embedded = false } = {}) {
  const [mobileTab, setMobileTab] = useState('config');
  const [isDesktopLayout, setIsDesktopLayout] = useState(() => typeof window !== 'undefined' ? window.matchMedia('(min-width: 1024px)').matches : true);
  const initialSymbol = useFundSwitchInitialSymbol(); const entryAttribution = useMemo(() => readFundSwitchEntryAttribution(), []);
  useEffect(() => { if (typeof window === 'undefined') return undefined; const query = window.matchMedia('(min-width: 1024px)'); const update = () => setIsDesktopLayout(query.matches); update(); if (query.addEventListener) { query.addEventListener('change', update); return () => query.removeEventListener('change', update); } query.addListener(update); return () => query.removeListener(update); }, []);
  function openBacktestIntro(event) {
    if (event && (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0)) return; if (event) event.preventDefault(); if (typeof window === 'undefined') return;
    const nextUrl = new URL(links?.markets || './index.html?tab=markets', window.location.href); const symbol = pickBacktestSymbol(initialSymbol); nextUrl.searchParams.set('tab', 'markets'); nextUrl.searchParams.set('backtest', '1'); nextUrl.searchParams.set('source', 'fundSwitchBanner'); nextUrl.searchParams.set('symbol', symbol);
    window.dispatchEvent(new CustomEvent('workspace:navigate', { detail: { tab: 'markets', search: nextUrl.search.replace(/^\?/, '') } }));
    window.setTimeout(() => { window.dispatchEvent(new CustomEvent('markets:select-symbol', { detail: { symbol, source: 'fundSwitchBanner' } })); window.dispatchEvent(new CustomEvent('markets:open-backtest', { detail: { symbol, source: 'fundSwitchBanner' } })); }, 0);
  }
  useEffect(() => { trackFeatureEvent('fund_switch', 'view_open', { view: 'fundSwitch', embedded, inPagesDir, ...entryAttribution }); if (entryAttribution.fromNotification) trackFeatureEvent('fund_switch', 'notification_open', { view: 'fundSwitch', embedded, inPagesDir, ...entryAttribution }); const timer = window.setTimeout(() => triggerConversionPrompt('fund_switch_view_open', { view: 'fundSwitch', initialSymbol: initialSymbol || '' }), 15000); return () => window.clearTimeout(timer); }, [embedded, entryAttribution, inPagesDir, initialSymbol]);
  return (
    <div className={cx('mx-auto max-w-7xl space-y-4', embedded ? 'px-3 sm:px-6' : 'px-4 sm:px-6')}>
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white p-1.5 shadow-sm lg:justify-end">
        <div className="grid flex-1 grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 lg:hidden">
          {MOBILE_TABS.map((tab) => { const Icon = tab.icon; const active = mobileTab === tab.id; return <button key={tab.id} type="button" onClick={() => { setMobileTab(tab.id); trackFeatureEvent('fund_switch', 'mobile_subtab_select', { view: tab.id, previousView: mobileTab, ...entryAttribution }); }} aria-pressed={active} className={cx('inline-flex min-h-10 items-center justify-center gap-2 rounded-lg text-sm font-bold transition-all', active ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500')}><Icon className="h-4 w-4" />{tab.label}</button>; })}
        </div>
        <a href={`${links?.markets || './index.html?tab=markets'}&symbol=${encodeURIComponent(pickBacktestSymbol(initialSymbol))}&backtest=1`} onClick={openBacktestIntro} className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl bg-indigo-600 px-3.5 text-sm font-bold text-white shadow-sm transition hover:bg-indigo-500"><BarChart3 className="h-4 w-4" /><span className="hidden sm:inline">策略回测</span><span className="sm:hidden">回测</span></a>
      </div>
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2 lg:gap-6">
        <div className={cx('min-w-0', mobileTab === 'analysis' ? 'hidden lg:block' : '')}><Suspense fallback={<SubViewLoadingFallback />}><SwitchStrategySetupExperienceLazy /></Suspense></div>
        <div className={cx('min-w-0 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto', mobileTab === 'analysis' ? '' : 'hidden lg:block')}>{isDesktopLayout || mobileTab === 'analysis' ? <Suspense fallback={<SubViewLoadingFallback />}><FundSwitchAnalysisExperienceLazy /></Suspense> : null}</div>
      </div>
    </div>
  );
}
