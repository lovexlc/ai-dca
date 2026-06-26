import { createPortal } from 'react-dom';
import { AlertTriangle, ChevronDown, ChevronRight, Copy, Info, PlayCircle, Plus, Radio, Trash2, X } from 'lucide-react';
import { Card, Pill, SectionHeading, cx, primaryButtonClass, secondaryButtonClass } from '../components/experience-ui.jsx';

export function SwitchStrategyWorkerPanel({
  prefs,
  switchSummary,
  workerConfig,
  workerStatus,
  workerConfigExpanded,
  workerSnapshot,
  workerRunDisabledReason,
  rules = [],
  activeRuleId = '',
  handleWorkerToggle,
  handleWorkerRunOnce,
  onRuleSelect,
  onRuleAdd,
  onRuleDuplicate,
  onRuleRemove,
  onRuleNameChange,
  onRuleEnabledChange,
  setWorkerConfigExpanded,
  setSnapshotCandModal,
  onQuickRecordOpen,
  formatDate,
  formatPrice,
  formatPercent
}) {
  const ruleList = Array.isArray(rules) ? rules : [];
  const activeRule = ruleList.find((rule) => rule.id === activeRuleId) || ruleList[0] || null;
  const activeRuleIndex = Math.max(0, ruleList.findIndex((rule) => rule.id === activeRule?.id));
  const activeBenchCount = Array.isArray(activeRule?.benchmarkCodes) ? activeRule.benchmarkCodes.length : 0;
  const activeCandidateCount = Array.isArray(activeRule?.enabledCodes) ? activeRule.enabledCodes.length : 0;
  return (
    <Card>
      <SectionHeading
        eyebrow="自动监控"
        title="worker 每分钟扫描场内切换信号"
      />
      <div className="mt-5 space-y-4">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5">
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={Boolean(workerConfig.enabled)}
              disabled={workerStatus.loading || workerStatus.saving}
              onChange={(e) => handleWorkerToggle(e.target.checked)}
            />
            <span className="font-semibold text-slate-700">启用 worker 自动监控</span>
          </label>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 text-xs text-slate-600">
            <Radio className="h-3.5 w-3.5" />
            cron: 周一至周五 09:30-11:30 / 13:00-15:00
          </span>
        </div>
        {workerStatus.error ? (
          <div className="flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{workerStatus.error}</span>
          </div>
        ) : null}
        {workerStatus.notice && !workerStatus.error ? (
          <div className="flex items-start gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{workerStatus.notice}</span>
          </div>
        ) : null}
        <div className="rounded-2xl border border-slate-200 bg-white p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">监控规则</div>
              <div className="mt-0.5 text-[11px] text-slate-500">{ruleList.length || 0} 条规则</div>
            </div>
            <button
              type="button"
              onClick={onRuleAdd}
              className={cx(secondaryButtonClass, 'h-8 px-3 text-xs')}
              title="新增规则"
            >
              <Plus className="h-4 w-4" />
              新增规则
            </button>
          </div>
          <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
            <div className="min-w-0">
              <label className="sr-only" htmlFor="switch-rule-selector">选择监控规则</label>
              <div className="relative">
                <select
                  id="switch-rule-selector"
                  value={activeRule?.id || ''}
                  onChange={(event) => onRuleSelect?.(event.target.value)}
                  className="h-10 w-full appearance-none rounded-xl border border-slate-200 bg-slate-50 px-3 pr-9 text-sm font-semibold text-slate-800 focus:border-indigo-300 focus:bg-white focus:outline-none"
                >
                  {ruleList.map((rule, index) => {
                    const benchCount = Array.isArray(rule.benchmarkCodes) ? rule.benchmarkCodes.length : 0;
                    const candidateCount = Array.isArray(rule.enabledCodes) ? rule.enabledCodes.length : 0;
                    return (
                      <option key={rule.id || `rule-${index}`} value={rule.id}>
                        {rule.enabled ? '启用' : '停用'} · {rule.name || `规则 ${index + 1}`} · {benchCount} 基准 / {candidateCount} 候选
                      </option>
                    );
                  })}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              </div>
            </div>
            <div className="flex min-w-0 items-center gap-2 lg:justify-end">
              <Pill tone={activeRule?.enabled ? 'emerald' : 'slate'}>{activeRule?.enabled ? '启用' : '停用'}</Pill>
              <div className="truncate text-xs text-slate-500">
                当前第 {activeRule ? activeRuleIndex + 1 : 0} 条 · {activeBenchCount} 基准 · {activeCandidateCount} 候选
              </div>
            </div>
          </div>
          {activeRule ? (
            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={activeRule.name || ''}
                  onChange={(event) => onRuleNameChange?.(activeRule.id, event.target.value)}
                  aria-label="当前规则名称"
                  className="h-9 min-w-[180px] flex-1 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 focus:border-indigo-300 focus:outline-none"
                />
                <label className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={Boolean(activeRule.enabled)}
                    onChange={(event) => onRuleEnabledChange?.(activeRule.id, event.target.checked)}
                  />
                  启用
                </label>
                <button
                  type="button"
                  onClick={() => onRuleDuplicate?.(activeRule.id)}
                  className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-600 hover:border-indigo-200 hover:text-indigo-700"
                  title="复制规则"
                  aria-label="复制当前规则"
                >
                  <Copy className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => onRuleRemove?.(activeRule.id)}
                  disabled={ruleList.length <= 1}
                  className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-600 hover:border-rose-200 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-40"
                  title={ruleList.length <= 1 ? '至少保留一条规则' : '删除规则'}
                  aria-label="删除当前规则"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ) : null}
          <div className="mt-3 grid gap-2 md:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">H/L 分组</div>
              <div className="mt-1 text-xs text-slate-600">
                当前规则读取下方分类：<span className="font-semibold text-slate-800">{activeBenchCount}</span> 基准 / <span className="font-semibold text-slate-800">{activeCandidateCount}</span> 候选
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">机会阈值</div>
              <div className="mt-1 text-xs text-slate-600">
                规则 A ≤ <span className="font-semibold text-slate-800">{Number.isFinite(Number(prefs?.intraSellLowerPct)) ? `${prefs.intraSellLowerPct}%` : '—'}</span> / 规则 B ≥ <span className="font-semibold text-slate-800">{Number.isFinite(Number(prefs?.intraBuyOtherPct)) ? `${prefs.intraBuyOtherPct}%` : '—'}</span>
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">worker 输出</div>
              <div className="mt-1 text-xs text-slate-600">
                {workerSnapshot ? (
                  <>快照 <span className="font-semibold text-slate-800">{Array.isArray(workerSnapshot.byBenchmark) ? workerSnapshot.byBenchmark.length : (workerSnapshot.benchmarkCode ? 1 : 0)}</span> 基准 / 触发 <span className="font-semibold text-slate-800">{Array.isArray(workerSnapshot.triggers) ? workerSnapshot.triggers.length : 0}</span></>
                ) : '暂无快照，等待扫描或手动运行'}
              </div>
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-3 text-xs text-slate-600">
          <button
            type="button"
            onClick={() => setWorkerConfigExpanded((prev) => !prev)}
            className="w-full rounded-lg p-2 text-left transition-colors hover:bg-slate-50"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                {(() => {
                  const sellLower = Number.isFinite(Number(prefs?.intraSellLowerPct)) ? prefs.intraSellLowerPct : null;
                  const buyOther = Number.isFinite(Number(prefs?.intraBuyOtherPct)) ? prefs.intraBuyOtherPct : null;
                  const fmtCls = (c) => `${c}${switchSummary.cls[c] === 'H' ? 'H' : (switchSummary.cls[c] === 'L' ? 'L' : '')}`;
                  const fmtList = (arr) => (arr || []).map(fmtCls).join(', ');
                  if (!switchSummary.benches.length) {
                    return <span className="text-slate-500">未配置基准（在上方 H/L 表把已分类 ETF 设为基准）</span>;
                  }
                  const Lline = switchSummary.Lrow ? (
                    <span key="L" className="text-slate-500">
                      <span className="font-semibold text-slate-700">L 基准 {switchSummary.Lrow.benches.length} 只</span>
                      <span className="text-[11px] text-slate-400">{' '}({fmtList(switchSummary.Lrow.benches)})</span>
                      {' · 候选 '}<span className="font-semibold text-slate-700">{switchSummary.Lrow.cands.length}</span> 对{' '}
                      <span className="text-[11px] text-slate-400">({fmtList(switchSummary.Lrow.cands) || '无'})</span>
                      {' · 规则 A：H-L ≤'}<span className="font-semibold text-slate-700">{sellLower !== null ? `${sellLower}%` : '—'}</span>
                    </span>
                  ) : null;
                  const Hline = switchSummary.Hrow ? (
                    <span key="H" className="text-slate-500">
                      <span className="font-semibold text-slate-700">H 基准 {switchSummary.Hrow.benches.length} 只</span>
                      <span className="text-[11px] text-slate-400">{' '}({fmtList(switchSummary.Hrow.benches)})</span>
                      {' · 候选 '}<span className="font-semibold text-slate-700">{switchSummary.Hrow.cands.length}</span> 对{' '}
                      <span className="text-[11px] text-slate-400">({fmtList(switchSummary.Hrow.cands) || '无'})</span>
                      {' · 规则 B：H-L ≥'}<span className="font-semibold text-slate-700">{buyOther !== null ? `${buyOther}%` : '—'}</span>
                    </span>
                  ) : null;
                  return (
                    <div className="flex flex-col gap-1">
                      {Lline}
                      {Hline}
                    </div>
                  );
                })()}
              </div>
              <ChevronDown className={cx('h-4 w-4 shrink-0 transition-transform', workerConfigExpanded ? 'rotate-180' : '')} />
            </div>
          </button>

          {workerConfigExpanded ? (
            <div className="mt-3 space-y-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                {workerConfig.updatedAt ? (
                  <span className="ml-auto text-[11px] text-slate-400">上次同步 {formatDate(workerConfig.updatedAt) || workerConfig.updatedAt}</span>
                ) : null}
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">worker 最近一次计算</div>
                    {workerSnapshot?.computedAt ? (
                      <div className="mt-1 text-xs text-slate-500">算于 {formatDate(workerSnapshot.computedAt) || workerSnapshot.computedAt}</div>
                    ) : <div className="mt-1 text-xs text-slate-400">尚无快照</div>}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className={cx(secondaryButtonClass, 'h-9 px-3 text-xs')}
                        onClick={handleWorkerRunOnce}
                        disabled={Boolean(workerRunDisabledReason)}
                        title={workerRunDisabledReason || (workerConfig.enabled ? '手动跑一次：拉价 + 算 diff + 命中规则 A/B 则推送' : '手动跑一次：拉价 + 算 diff，未启用监控不推送')}
                      >
                        <PlayCircle className="h-4 w-4" />
                        {workerStatus.running ? '运行中…' : '手动跑一次'}
                      </button>
                      {onQuickRecordOpen ? (
                        <button
                          type="button"
                          className={cx(primaryButtonClass, 'h-9 px-3 text-xs')}
                          onClick={onQuickRecordOpen}
                          title="快速记录一次场内/场外切换交易"
                        >
                          <Plus className="h-4 w-4" />
                          快速记录
                        </button>
                      ) : null}
                    </div>
                    {workerRunDisabledReason ? <span className="text-[11px] text-slate-400">{workerRunDisabledReason}</span> : null}
                  </div>
                </div>
                {workerSnapshot ? (
                  <div className="mt-3 space-y-2 text-sm">
                    {(() => {
                      const benchSnapshots = Array.isArray(workerSnapshot.byBenchmark) && workerSnapshot.byBenchmark.length
                        ? workerSnapshot.byBenchmark
                        : (workerSnapshot.benchmarkCode ? [{
                            benchmarkCode: workerSnapshot.benchmarkCode,
                            benchmarkName: workerSnapshot.benchmarkName,
                            benchmarkPrice: workerSnapshot.benchmarkPrice,
                            benchmarkNav: workerSnapshot.benchmarkNav,
                            benchmarkNavDate: workerSnapshot.benchmarkNavDate,
                            benchmarkPremiumPct: workerSnapshot.benchmarkPremiumPct,
                            candidates: workerSnapshot.candidates || []
                          }] : []);
                      if (!benchSnapshots.length) {
                        return (
                          <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-400">
                            快照中暂无基准数据。
                          </div>
                        );
                      }
                      const sellLower = Number(workerSnapshot.intraSellLowerPct);
                      const buyOther = Number(workerSnapshot.intraBuyOtherPct);
                      const cls = prefs.premiumClass || {};
                      return benchSnapshots.map((bench) => (
                        <div key={`bench-${bench.benchmarkCode}`} className="rounded-xl border border-slate-200 bg-white p-3">
                          <div className="text-xs uppercase tracking-[0.18em] text-slate-400">基准 {bench.benchmarkCode}{bench.benchmarkName ? ` · ${bench.benchmarkName}` : ''}</div>
                          <div className="mt-1 grid grid-cols-1 gap-x-2 gap-y-1 text-xs text-slate-600 sm:grid-cols-3">
                            <div className="min-w-0">现价 <span className="font-semibold text-slate-800">{formatPrice(bench.benchmarkPrice)}</span></div>
                            <div className="min-w-0">净值 <span className="font-semibold text-slate-800">{formatPrice(bench.benchmarkNav)}</span>{bench.benchmarkNavDate ? <span className="ml-1 whitespace-nowrap text-slate-400">@{bench.benchmarkNavDate}</span> : null}</div>
                            <div className="min-w-0">溢价 <span className="font-semibold text-slate-800">{formatPercent(bench.benchmarkPremiumPct, 2, true)}</span></div>
                          </div>
                          {bench.candidates && bench.candidates.length > 0 ? (
                            <button
                              type="button"
                              onClick={() => setSnapshotCandModal({ bench, sellLower, buyOther, cls })}
                              className="mt-3 flex w-full items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 transition-colors hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"
                            >
                              <span className="font-medium">查看 {bench.candidates.length} 个候选详情</span>
                              <ChevronRight className="h-4 w-4" aria-hidden="true" />
                            </button>
                          ) : (
                            <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-center text-xs text-slate-400">快照中暂无候选数据。</div>
                          )}
                        </div>
                      ));
                    })()}
                    {(workerSnapshot.triggers || []).length > 0 ? (
                      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                        <div className="font-semibold">本轮触发 {workerSnapshot.triggers.length} 个信号</div>
                        <ul className="mt-1 list-disc pl-4">
                          {workerSnapshot.triggers.map((t, idx) => (
                            <li key={`trig-${idx}`}>规则 {t.rule || (Number(t.diffPct ?? t.spreadPct) >= 0 ? 'B' : 'A')} · 卖 {t.fromCode} → 买 {t.toCode}：diff {formatPercent(t.diffPct ?? t.spreadPct, 2, true)}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-400">
                    暂无最近一次计算结果，先手动跑一次或等待 worker 扫描。
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </Card>
    );
}

export function SwitchStrategyQuickRecordModal({ quickRecord, setQuickRecord, quickRecordValid, saveQuickRecord }) {
  if (!quickRecord) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-slate-900/40 p-3 sm:items-center sm:p-4">
      <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-4 shadow-2xl sm:rounded-3xl sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">快捷记录</div>
            <div className="mt-1 text-lg font-semibold text-slate-800">登记一次场内 / 场外切换</div>
            <div className="mt-1 text-xs text-slate-500">写入持仓 ledger 的一对 SELL/BUY 交易，并自动配对 switchPairId，复盘与持仓总览均会读取。</div>
          </div>
          <button type="button" onClick={() => setQuickRecord(null)} className="text-xs text-slate-400 hover:text-slate-600">关闭</button>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs text-slate-500 sm:col-span-2">
            日期
            <input
              type="date"
              value={quickRecord.date || ''}
              onChange={(e) => setQuickRecord((prev) => (prev ? { ...prev, date: e.target.value } : prev))}
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm text-slate-800 focus:border-indigo-300 focus:outline-none"
            />
          </label>
          <div className="rounded-2xl border border-rose-100 bg-rose-50/60 p-3">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-500">卖出</div>
            <label className="mt-2 flex flex-col gap-1 text-xs text-slate-500">代码
              <input value={quickRecord.sellCode || ''} onChange={(e) => setQuickRecord((prev) => (prev ? { ...prev, sellCode: e.target.value.trim() } : prev))} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm text-slate-800 focus:border-indigo-300 focus:outline-none" />
            </label>
            <label className="mt-2 flex flex-col gap-1 text-xs text-slate-500">名称
              <input value={quickRecord.sellName || ''} onChange={(e) => setQuickRecord((prev) => (prev ? { ...prev, sellName: e.target.value } : prev))} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm text-slate-800 focus:border-indigo-300 focus:outline-none" />
            </label>
            <label className="mt-2 flex flex-col gap-1 text-xs text-slate-500">成交价
              <input type="text" inputMode="decimal" step="0.0001" value={quickRecord.sellPrice} onChange={(e) => setQuickRecord((prev) => (prev ? { ...prev, sellPrice: e.target.value } : prev))} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm tabular-nums text-slate-800 focus:border-indigo-300 focus:outline-none" />
            </label>
            <label className="mt-2 flex flex-col gap-1 text-xs text-slate-500">份额
              <input type="text" inputMode="decimal" step="1" value={quickRecord.sellShares} onChange={(e) => setQuickRecord((prev) => (prev ? { ...prev, sellShares: e.target.value } : prev))} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm tabular-nums text-slate-800 focus:border-indigo-300 focus:outline-none" />
            </label>
          </div>
          <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-3">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-600">买入</div>
            <label className="mt-2 flex flex-col gap-1 text-xs text-slate-500">代码
              <input value={quickRecord.buyCode || ''} onChange={(e) => setQuickRecord((prev) => (prev ? { ...prev, buyCode: e.target.value.trim() } : prev))} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm text-slate-800 focus:border-indigo-300 focus:outline-none" />
            </label>
            <label className="mt-2 flex flex-col gap-1 text-xs text-slate-500">名称
              <input value={quickRecord.buyName || ''} onChange={(e) => setQuickRecord((prev) => (prev ? { ...prev, buyName: e.target.value } : prev))} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm text-slate-800 focus:border-indigo-300 focus:outline-none" />
            </label>
            <label className="mt-2 flex flex-col gap-1 text-xs text-slate-500">成交价
              <input type="text" inputMode="decimal" step="0.0001" value={quickRecord.buyPrice} onChange={(e) => setQuickRecord((prev) => (prev ? { ...prev, buyPrice: e.target.value } : prev))} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm tabular-nums text-slate-800 focus:border-indigo-300 focus:outline-none" />
            </label>
            <label className="mt-2 flex flex-col gap-1 text-xs text-slate-500">份额
              <input type="text" inputMode="decimal" step="1" value={quickRecord.buyShares} onChange={(e) => setQuickRecord((prev) => (prev ? { ...prev, buyShares: e.target.value } : prev))} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm tabular-nums text-slate-800 focus:border-indigo-300 focus:outline-none" />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-xs text-slate-500 sm:col-span-2">备注
            <textarea
              rows={2}
              value={quickRecord.note || ''}
              onChange={(e) => setQuickRecord((prev) => (prev ? { ...prev, note: e.target.value } : prev))}
              className="resize-y rounded-md border border-slate-200 bg-white px-2 py-1 text-sm leading-5 text-slate-800 focus:border-indigo-300 focus:outline-none"
            />
          </label>
        </div>
        {!quickRecordValid && (
          <div className="mt-3 text-xs text-rose-500">需要填写卖出 / 买入的代码、成交价和份额（均为正数）。</div>
        )}
        <div className="mt-5 flex items-center justify-end gap-2">
          <button type="button" onClick={() => setQuickRecord(null)} className={cx(secondaryButtonClass, 'h-9 px-4 text-xs')}>取消</button>
          <button type="button" onClick={saveQuickRecord} disabled={!quickRecordValid} className={cx(primaryButtonClass, 'h-9 px-4 text-xs', !quickRecordValid && 'cursor-not-allowed opacity-50')}>保存到持仓 ledger</button>
        </div>
      </div>
    </div>
  );
}

export function SwitchStrategySnapshotModal({ snapshotCandModal, setSnapshotCandModal, formatPrice, formatPercent }) {
  if (!snapshotCandModal || typeof document === 'undefined') return null;
  return createPortal((
    <div
      className="fixed inset-0 z-[120] flex items-end justify-center bg-slate-900/60 p-0 sm:items-center sm:p-4"
      onClick={() => setSnapshotCandModal(null)}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-[0.18em] text-slate-400">快照候选详情</div>
            <div className="mt-0.5 text-sm font-semibold text-slate-900">基准 {snapshotCandModal.bench.benchmarkCode}{snapshotCandModal.bench.benchmarkName ? <span className="ml-1 font-normal text-slate-500">· {snapshotCandModal.bench.benchmarkName}</span> : null}</div>
          </div>
          <button
            type="button"
            onClick={() => setSnapshotCandModal(null)}
            className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-y-auto px-2 py-3 sm:px-4 sm:py-4">
          <div className="overflow-x-auto">
            <table className="min-w-[520px] w-full overflow-hidden rounded-lg border border-slate-200 text-xs">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">候选</th>
                  <th className="px-3 py-2 text-right">现价</th>
                  <th className="px-3 py-2 text-right">净值</th>
                  <th className="px-3 py-2 text-right">溢价</th>
                  <th className="px-3 py-2 text-right">与基准差</th>
                </tr>
              </thead>
              <tbody>
                {(snapshotCandModal.bench.candidates || []).map((c) => {
                  const diff = Number(c.spreadVsBenchmarkPct);
                  const benchClass = snapshotCandModal.cls[snapshotCandModal.bench.benchmarkCode];
                  const candClass = snapshotCandModal.cls[c.code];
                  const eligible = (benchClass === 'H' || benchClass === 'L') && (candClass === 'H' || candClass === 'L') && benchClass !== candClass;
                  let inA = false;
                  let inB = false;
                  if (eligible && Number.isFinite(diff)) {
                    const gap = benchClass === 'H' ? diff : -diff;
                    if (benchClass === 'L' && Number.isFinite(snapshotCandModal.sellLower) && gap < snapshotCandModal.sellLower) inA = true;
                    if (benchClass === 'H' && Number.isFinite(snapshotCandModal.buyOther) && gap > snapshotCandModal.buyOther) inB = true;
                  }
                  const colorCls = inA ? 'text-emerald-700 font-semibold' : inB ? 'text-rose-700 font-semibold' : 'text-slate-600';
                  return (
                    <tr key={`modal-${snapshotCandModal.bench.benchmarkCode}-${c.code}`} className="border-t border-slate-100">
                      <td className="px-3 py-2"><span className="font-semibold">{c.code}</span>{c.name ? <span className="ml-1 text-slate-400">{c.name}</span> : null}</td>
                      <td className="px-3 py-2 text-right">{formatPrice(c.price)}</td>
                      <td className="px-3 py-2 text-right">{formatPrice(c.nav)}{c.navDate ? <span className="ml-1 text-slate-400">@{c.navDate}</span> : null}</td>
                      <td className="px-3 py-2 text-right">{formatPercent(c.premiumPct, 2, true)}</td>
                      <td className={cx('px-3 py-2 text-right', colorCls)}>{formatPercent(c.spreadVsBenchmarkPct, 2, true)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-3 px-1 text-[11px] leading-5 text-slate-400">
            <div><span className="font-semibold text-emerald-700">绿色</span>：命中规则 A（差价收窄，低→高）。</div>
            <div><span className="font-semibold text-rose-700">红色</span>：命中规则 B（差价扩大，高→低）。</div>
          </div>
        </div>
      </div>
    </div>
  ), document.body);
}
