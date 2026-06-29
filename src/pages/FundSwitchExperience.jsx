import { Suspense, lazy, useEffect, useState } from 'react';
import { ArrowRight, CheckCircle2, History, HelpCircle, ListPlus, Settings2, Target } from 'lucide-react';
import { cx } from '../components/experience-ui.jsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog.jsx';
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

function HowToFigure({ step, title, icon: Icon, children }) {
  return (
    <figure className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-white text-slate-700 ring-1 ring-slate-200">{step}</span>
        {title}
      </div>
      <div className="mt-3 flex min-h-[116px] items-center justify-center rounded-lg bg-white p-3 ring-1 ring-slate-200">
        <div className="grid w-full grid-cols-[1fr_auto_1fr] items-center gap-2 text-center text-xs text-slate-600">
          <div className="rounded-lg bg-indigo-50 px-2 py-3 font-semibold text-indigo-700">
            <Icon className="mx-auto mb-1 h-5 w-5" />
            {children[0]}
          </div>
          <ArrowRight className="h-4 w-4 text-slate-300" />
          <div className="rounded-lg bg-emerald-50 px-2 py-3 font-semibold text-emerald-700">
            <CheckCircle2 className="mx-auto mb-1 h-5 w-5" />
            {children[1]}
          </div>
        </div>
      </div>
    </figure>
  );
}

function FundSwitchHowToDialog({ open, onOpenChange }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>基金切换怎么用</DialogTitle>
          <DialogDescription>
            按三步配置，最后只看信号是否触发。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5 text-sm leading-6 text-slate-600">
          <div className="grid gap-3 md:grid-cols-3">
            <HowToFigure step="1" title="选基准" icon={Target}>{['持有基金', '设为基准']}</HowToFigure>
            <HowToFigure step="2" title="加候选" icon={ListPlus}>{['候选基金', '进入池子']}</HowToFigure>
            <HowToFigure step="3" title="看信号" icon={HelpCircle}>{['worker 扫描', '决定换不换']}</HowToFigure>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <section className="rounded-xl border border-slate-200 bg-white p-4">
              <h3 className="text-sm font-bold text-slate-900">第一步：选基准</h3>
              <p className="mt-2">
                基准就是你当前最关心、最可能拿来比较的那只基金，通常先选已经持有的 ETF。把它设为基准后，系统会用它的实时价格、净值和溢价作为参照，后面的候选基金都围绕它计算差价。
              </p>
            </section>
            <section className="rounded-xl border border-slate-200 bg-white p-4">
              <h3 className="text-sm font-bold text-slate-900">第二步：加候选基金</h3>
              <p className="mt-2">
                候选基金是可以被切过去的对象。你可以把同指数、同方向、流动性相近的基金加入候选池，并给它们标记高溢价或低溢价分组。这里不需要每天手动算，只要维护好池子。
              </p>
            </section>
            <section className="rounded-xl border border-slate-200 bg-white p-4">
              <h3 className="text-sm font-bold text-slate-900">第三步：看信号</h3>
              <p className="mt-2">
                worker 会按已保存规则扫描。出现信号时，页面会显示卖哪只、买哪只，以及差价是否达到阈值。信号不是自动交易，只是把“今天该不该动”提前摆出来，最终仍由你确认是否换仓。
              </p>
            </section>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function FundSwitchExperience({ links, inPagesDir = false, embedded = false } = {}) {
  const [mobileTab, setMobileTab] = useState('config');
  const [showGuide, setShowGuide] = useState(false);
  const [howToOpen, setHowToOpen] = useState(false);

  useEffect(() => {
    trackFeatureEvent('fund_switch', 'view_open', {
      view: 'fundSwitch',
      embedded,
      inPagesDir
    });
    setShowGuide(shouldShowFundSwitchGuide());
  }, [embedded, inPagesDir]);

  return (
    <div className={cx('mx-auto max-w-7xl space-y-4', embedded ? 'px-4 sm:px-6' : 'px-6')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">基金切换</div>
          <div className="mt-1 text-sm text-slate-500">配置规则、查看信号、复盘历史表现。</div>
        </div>
        <button
          type="button"
          onClick={() => {
            setHowToOpen(true);
            trackFeatureEvent('fund_switch', 'how_to_open', {});
          }}
          className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700"
        >
          <HelpCircle className="h-4 w-4" />
          怎么用
        </button>
      </div>
      <FundSwitchHowToDialog open={howToOpen} onOpenChange={setHowToOpen} />

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
