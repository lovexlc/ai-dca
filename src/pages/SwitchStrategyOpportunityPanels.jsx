import { Info, TrendingUp } from 'lucide-react';
import { Card, Pill, SectionHeading, cx, secondaryButtonClass } from '../components/experience-ui.jsx';

export function SwitchStrategyOpportunityPanels({
  prefs,
  setPrefValue,
  intraSignals,
  otcSignal,
  links
}) {
  function openMarkets(event) {
    if (event && (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0)) return;
    if (event) event.preventDefault();
    if (typeof window === 'undefined') return;
    const target = links?.markets || './index.html?tab=markets';
    const nextUrl = new URL(target, window.location.href);
    if (window.location.href === nextUrl.href) return;
    window.history.pushState({ tab: 'markets' }, '', nextUrl);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }

  return (
    <>
      <Card>
        <SectionHeading
          eyebrow="机会概览"
          title="在持有的场内 ETF 之间倒换"
        />
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm">
            <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500" htmlFor="intra-sell-lower">规则 A · 低溢价持仓换高溢价</label>
            <div className="mt-1 text-slate-700">
              H溢价 − L溢价 {'<'}
              <input
                type="text"
                inputMode="decimal"
                step="0.5"
                id="intra-sell-lower"
                aria-label="规则 A 阈值，默认 1%"
                value={prefs.intraSellLowerPct}
                onChange={(e) => setPrefValue('intraSellLowerPct', e.target.value)}
                className="mx-1 w-16 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold focus:border-indigo-300 focus:outline-none"
              />
              %（差价收窄，低→高）→ 卖 L 买 H
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm">
            <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500" htmlFor="intra-buy-other">规则 B · 高溢价持仓换低溢价</label>
            <div className="mt-1 text-slate-700">
              H溢价 − L溢价 {'>'}
              <input
                type="text"
                inputMode="decimal"
                step="0.5"
                id="intra-buy-other"
                aria-label="规则 B 阈值，默认 3%"
                value={prefs.intraBuyOtherPct}
                onChange={(e) => setPrefValue('intraBuyOtherPct', e.target.value)}
                className="mx-1 w-16 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold focus:border-indigo-300 focus:outline-none"
              />
              %（差价扩大，高→低）→ 卖 H 买 L
            </div>
          </div>
        </div>
        <div className="mt-4 space-y-2">
          {intraSignals.map((sig, idx) => (
            <div
              key={`${sig.kind}-${sig.from}-${sig.to}-${idx}`}
              className="flex flex-col gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 sm:flex-row sm:items-start sm:gap-3"
            >
              <div className="flex min-w-0 flex-1 items-start gap-2 sm:gap-3">
                <Pill tone={sig.kind === 'A' ? 'indigo' : 'emerald'}>规则 {sig.kind}</Pill>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-slate-700">卖 {sig.from} → 买 {sig.to}</div>
                  <div className="text-xs text-slate-500">{sig.fromName || ''} → {sig.toName || ''}。{sig.description}。</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <SectionHeading
          eyebrow="机会概览"
          title="纳指（场外）基金"
        />
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm">
            <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500" htmlFor="otc-premium-threshold">基准溢价阈值 · 默认 8%</label>
            <div className="mt-1 text-slate-700">
              &gt;
              <input
                type="text"
                inputMode="decimal"
                step="0.5"
                id="otc-premium-threshold"
                aria-label="场外基准溢价阈值，默认 8%"
                value={prefs.otcPremiumThresholdPct}
                onChange={(e) => setPrefValue('otcPremiumThresholdPct', e.target.value)}
                className="mx-1 w-16 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold focus:border-indigo-300 focus:outline-none"
              />%
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">场内最低溢价阈值</div>
            <div className="mt-1 text-slate-700">
              &lt;
              <input
                type="text"
                inputMode="decimal"
                step="0.5"
                id="otc-strong-threshold"
                aria-label="场外强信号阈值，默认 1%"
                value={prefs.otcMinIntraPremiumLow}
                onChange={(e) => setPrefValue('otcMinIntraPremiumLow', e.target.value)}
                className="mx-1 w-16 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold focus:border-indigo-300 focus:outline-none"
              /><span className="sr-only">场外强信号阈值</span>%（强） / &lt;
              <input
                type="text"
                inputMode="decimal"
                step="0.5"
                id="otc-weak-threshold"
                aria-label="场外弱信号阈值，默认 2%"
                value={prefs.otcMinIntraPremiumHigh}
                onChange={(e) => setPrefValue('otcMinIntraPremiumHigh', e.target.value)}
                className="mx-1 w-16 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold focus:border-indigo-300 focus:outline-none"
              /><span className="sr-only">场外弱信号阈值</span>%（弱）
            </div>
          </div>
        </div>
        {(otcSignal.ready ? otcSignal.triggered : true) && (
          <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
            {otcSignal.ready ? (
              <div className="flex flex-col gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 sm:flex-row sm:items-start sm:gap-3">
                <div className="flex min-w-0 flex-1 items-start gap-2 sm:gap-3">
                  <Pill tone={otcSignal.intraLowHard ? 'emerald' : 'amber'}>{otcSignal.level}</Pill>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-slate-700">
                      卖 {otcSignal.benchCode} → 申购场外 QDII 联接基金
                    </div>
                    <div className="text-xs text-slate-500">「{otcSignal.benchCode} {otcSignal.benchName}」溢价偏高且「{otcSignal.lowestCode} {otcSignal.lowestName}」溢价偏低，出现反向套利机会。</div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <Info className="h-4 w-4 text-slate-400" />
                {otcSignal.message}
              </div>
            )}
          </div>
        )}
        <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">申购限额</div>
            <div className="mt-1 text-sm text-slate-600">场外基金限额、App 标签和净值更新统一在行情中心查看。</div>
          </div>
          <a
            href={links?.markets || './index.html?tab=markets'}
            onClick={openMarkets}
            className={cx(secondaryButtonClass, 'h-9 w-full px-3 text-sm sm:w-auto')}
          >
            <TrendingUp className="h-4 w-4" />
            前往行情中心
          </a>
        </div>
      </Card>
    </>
  );
}
