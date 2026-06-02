import { ClipboardList, ChevronDown, Info } from 'lucide-react';
import { Card, Pill, SectionHeading, cx, secondaryButtonClass } from '../components/experience-ui.jsx';

export function SwitchStrategyOpportunityPanels({
  prefs,
  setPrefValue,
  intraSignals,
  openQuickRecordFromIntra,
  otcSignal,
  openQuickRecordFromOtc,
  otcGroups,
  showAllOtc,
  setShowAllOtc,
  shouldShowAppTag,
  formatLimitAmount,
  limitLabelFor,
  limitToneFor
}) {
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
                type="number"
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
                type="number"
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
              <button
                type="button"
                onClick={() => openQuickRecordFromIntra(sig)}
                className={cx(secondaryButtonClass, 'h-8 w-full px-3 text-xs sm:w-auto')}
                title="记录此次切换到持仓 ledger"
              >
                <ClipboardList className="h-4 w-4" />
                记录此次切换
              </button>
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
                type="number"
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
                type="number"
                step="0.5"
                id="otc-strong-threshold"
                aria-label="场外强信号阈值，默认 1%"
                value={prefs.otcMinIntraPremiumLow}
                onChange={(e) => setPrefValue('otcMinIntraPremiumLow', e.target.value)}
                className="mx-1 w-16 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold focus:border-indigo-300 focus:outline-none"
              /><span className="sr-only">场外强信号阈值</span>%（强） / &lt;
              <input
                type="number"
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
                <button
                  type="button"
                  onClick={openQuickRecordFromOtc}
                  className={cx(secondaryButtonClass, 'h-8 w-full px-3 text-xs sm:w-auto')}
                  title="记录此次场内→场外切换到持仓 ledger"
                >
                  <ClipboardList className="h-4 w-4" />
                  记录此次切换
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <Info className="h-4 w-4 text-slate-400" />
                {otcSignal.message}
              </div>
            )}
          </div>
        )}
        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">纳指（场外）基金</div>
          </div>
          {otcGroups.length === 0 ? null : (
            <>
              <ul className="mt-2 space-y-1 text-sm text-slate-700">
                {(showAllOtc ? otcGroups : otcGroups.slice(0, 5)).map(({ groupId, fund: f, limit }) => (
                  <li key={groupId} className="flex flex-col gap-1 rounded-xl px-1 py-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Pill tone="indigo">{(f.share_class || 'A') + (f.currency === 'USD' ? ' / 美元' : '')}</Pill>
                      {shouldShowAppTag(f, limit) ? <Pill tone="slate">App</Pill> : null}
                      <span className="font-semibold text-slate-700">{f.code}</span>
                      <span className="text-slate-500">{f.name || ''}</span>
                    </div>
                    {limit ? (
                      <div className="flex flex-wrap items-center gap-2 pl-1 text-xs text-slate-500">
                        <Pill tone={limitToneFor(limit.buyStatus)} className="px-2 py-1 text-[11px]">{limitLabelFor(limit.buyStatus)}</Pill>
                        {Number(limit.maxPurchasePerDay) > 0 && (
                          <span className="inline-flex flex-wrap items-center gap-1">
                            单户日上限 <span className="font-semibold text-slate-700 tabular-nums">{formatLimitAmount(limit.maxPurchasePerDay)}</span>
                          </span>
                        )}
                        {Number(limit.minPurchase) > 0 && (
                          <span>起购 <span className="tabular-nums">{formatLimitAmount(limit.minPurchase)}</span></span>
                        )}
                        {limit.fixedInvest === false ? (
                          <span className="text-slate-400">定投暂停</span>
                        ) : Number(limit.fixedInvestMin) > 0 ? (
                          <span>定投起额 <span className="tabular-nums">{formatLimitAmount(limit.fixedInvestMin)}</span></span>
                        ) : null}
                        {limit.effectiveDate && (
                          <span className="text-slate-400">生效 {limit.effectiveDate}</span>
                        )}
                        {limit.sourceUrl && (
                          <a
                            href={limit.sourceUrl}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="ml-auto text-indigo-500 hover:text-indigo-600 hover:underline"
                            title={limit.sourceTitle || '基金公司限额公告'}
                          >
                            公告 ↗
                          </a>
                        )}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
              {otcGroups.length > 5 && (
                <button
                  type="button"
                  onClick={() => setShowAllOtc((v) => !v)}
                  className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-indigo-500 hover:text-indigo-600"
                >
                  {showAllOtc ? '收起' : '展示更多'}
                  <ChevronDown className={`h-4 w-4 transition-transform ${showAllOtc ? 'rotate-180' : ''}`} />
                </button>
              )}
            </>
          )}
        </div>
      </Card>
    </>
  );
}
