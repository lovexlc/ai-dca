import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ChevronDown, Search, Shuffle } from 'lucide-react';
import {
  readLedgerState,
  persistLedgerState,
  mergeSnapshotsFromNavResult,
  buildNavMetaFromResult
} from '../app/holdingsLedger.js';
import { getNavSnapshots } from '../app/navService.js';
import {
  computeSwitchChainMetrics
} from '../app/holdingsLedgerCore.js';
import {
  KIND_LABELS,
  KIND_PILL_TONES,
  formatNav,
  formatShares,
  formatSignedCurrency,
  formatSignedPercent
} from '../app/holdingsHelpers.js';
import { formatCurrency } from '../app/accumulation.js';
import { Pill, cx } from '../components/experience-ui.jsx';
import { trackActionResult, trackFeatureEvent } from '../app/analytics.js';
import { FundSwitchQuickTip } from '../components/FundSwitchGuide.jsx';
import { buildAutoSwitchChains, isSwitchChainHolding } from './fundSwitchRecordUtils.js';

const LEDGER_STORAGE_KEY = 'aiDcaFundHoldingsLedger';

export function FundSwitchAnalysisExperience() {
  const [ledger, setLedger] = useState(() => readLedgerState());
  const [expanded, setExpanded] = useState(() => new Set());
  const [recordFilter, setRecordFilter] = useState('all');
  const [recordSearch, setRecordSearch] = useState('');
  const [recordDetailTab, setRecordDetailTab] = useState('analysis');
  const navRefreshTriggeredRef = useRef(false);

  // 监听 storage 事件，跨标签页/兄弟组件更新 ledger 时同步。
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    function refreshLedger() {
      setLedger(readLedgerState());
    }
    function onStorage(e) {
      if (e && e.key && e.key !== LEDGER_STORAGE_KEY) return;
      refreshLedger();
    }
    window.addEventListener('storage', onStorage);
    window.addEventListener('holdings:ledger-updated', refreshLedger);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('holdings:ledger-updated', refreshLedger);
    };
  }, []);

  const transactions = ledger.transactions || [];
  const snapshotsByCode = ledger.snapshotsByCode || {};

  const chains = useMemo(() => buildAutoSwitchChains(transactions), [transactions]);

  // 进入本 tab 时主动拉一次 NAV，覆盖「链路中出现过的全部代码」——
  // 包括已被切换卖出、不再出现在当前持仓的 code（它们不会被 HoldingsExperience 刷新到），
  // 避免「未切换基准」baseline 价冻结在切换那天的口子。
  useEffect(() => {
    if (navRefreshTriggeredRef.current) return undefined;
    const codeSet = new Set();
    for (const chain of chains) {
      for (const leg of chain.legs || []) {
        const buy = leg.buyTxId ? transactions.find((tx) => tx.id === leg.buyTxId) : null;
        const sell = leg.sellTxId ? transactions.find((tx) => tx.id === leg.sellTxId) : null;
        if (buy && buy.code) codeSet.add(buy.code);
        if (sell && sell.code) codeSet.add(sell.code);
      }
    }
    const codes = [...codeSet].sort();
    if (!codes.length) return undefined;
    navRefreshTriggeredRef.current = true;
    let cancelled = false;
    const startedAt = Date.now();
    trackFeatureEvent('fund_switch_analysis', 'nav_refresh_start', {
      chainCount: chains.length,
      codeCount: codes.length
    });
    (async () => {
      try {
        const navResult = await getNavSnapshots(codes);
        if (cancelled) return;
        setLedger((prev) => {
          const merged = mergeSnapshotsFromNavResult(prev.snapshotsByCode, navResult);
          const nextMeta = buildNavMetaFromResult(navResult, merged.errors);
          const nextState = {
            ...prev,
            snapshotsByCode: merged.snapshotsByCode,
            lastNavMeta: nextMeta
          };
          persistLedgerState(nextState);
          return nextState;
        });
        trackActionResult('fund_switch_analysis', 'nav_refresh', 'success', {
          chainCount: chains.length,
          codeCount: codes.length,
          durationMs: Date.now() - startedAt
        });
      } catch (_err) {
        // 静默失败：下次 mount 重试。
        navRefreshTriggeredRef.current = false;
        trackActionResult('fund_switch_analysis', 'nav_refresh', 'error', {
          chainCount: chains.length,
          codeCount: codes.length,
          durationMs: Date.now() - startedAt,
          errorMessage: _err?.message || ''
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chains, transactions]);

  const chainsWithMetrics = useMemo(
    () => chains.map((chain) => ({
      chain,
      metrics: computeSwitchChainMetrics(chain, transactions, snapshotsByCode)
    })),
    [chains, transactions, snapshotsByCode]
  );
  const visibleChainsWithMetrics = useMemo(() => {
    const query = recordSearch.trim().toLowerCase();
    return chainsWithMetrics.filter(({ chain, metrics }) => {
      const path = String(chain.name || "").toLowerCase();
      const matchesSearch = !query || path.includes(query);
      if (!matchesSearch) return false;
      const holding = isSwitchChainHolding(metrics);
      if (recordFilter === "holding") return holding;
      if (recordFilter === "completed") return !holding;
      if (recordFilter === "unswitched") return (metrics.segments || []).length <= 1;
      return true;
    });
  }, [chainsWithMetrics, recordFilter, recordSearch]);

  const txById = useMemo(() => {
    const m = new Map();
    for (const tx of transactions) if (tx && tx.id) m.set(tx.id, tx);
    return m;
  }, [transactions]);

  function toggleExpanded(id) {
    const wasExpanded = expanded.has(id);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    trackFeatureEvent('fund_switch_analysis', 'chain_toggle', {
      chainIdLength: String(id || '').length,
      nextExpanded: !wasExpanded,
      chainCount: chains.length
    });
  }

  return (
    <div className="fund-switch-mobile-records flex flex-col gap-4">
      <div className="fund-switch-mobile-records__header lg:hidden">
        <div className="fund-switch-mobile-records__title-row"><div><div className="fund-switch-mobile-records__title">切换记录</div><div className="fund-switch-mobile-records__subtitle">共 {visibleChainsWithMetrics.length} 条记录</div></div><div className="fund-switch-mobile-records__header-actions"><label className="fund-switch-mobile-records__search"><Search size={15} /><input value={recordSearch} onChange={(event) => setRecordSearch(event.target.value)} placeholder="搜索基金路径" aria-label="搜索基金路径" /></label></div></div>
        <div className="fund-switch-mobile-records__filters" role="tablist" aria-label="切换记录状态">{[["all", "全部"], ["holding", "持仓中"], ["completed", "已完成"], ["unswitched", "未切换"]].map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={recordFilter === id} className={recordFilter === id ? "is-active" : ""} onClick={() => setRecordFilter(id)}>{label}</button>)}</div>
      </div>
      <div className="fund-switch-mobile-records__content">
      <div className="rounded-2xl border border-slate-200/70 bg-white px-5 py-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <Shuffle className="h-4 w-4 text-indigo-500" />
          基金切换收益分析
        </div>
        <div className="mt-1 text-xs leading-relaxed text-slate-500">
          自动从「成交流水」中已标注 <span className="font-semibold text-slate-600">基金切换</span>（SELL ↔ BUY 配对）的记录推导链路，按日期顺序串联。
          链路收益率 = 每段价格/净值乘积 − 1；未切换持仓 = 一直持有首段基金到链路终点。场内基金以场内交易价计算，场外基金以净值计算。
        </div>
      </div>

      {visibleChainsWithMetrics.length === 0 ? (
        <>
          <FundSwitchQuickTip />
          <div className="flex min-h-[180px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-200 bg-white text-center text-sm text-slate-500">
            <Shuffle className="h-7 w-7 text-slate-300" />
            <div>暂无基金切换记录。</div>
            <div className="text-xs text-slate-400">可在切换中心使用“快速记录”，或在「持仓 → 新增交易」中配对卖出与买入交易。</div>
          </div>
        </>
      ) : (
        <div className="space-y-3">
          {visibleChainsWithMetrics.map(({ chain, metrics }) => {
            const valid = metrics.valid;
            const advantageTone = !valid
              ? 'text-slate-400'
              : metrics.advantage > 0 ? 'text-red-600' : metrics.advantage < 0 ? 'text-emerald-600' : 'text-slate-700';
            const chainTone = !valid
              ? 'text-slate-400'
              : metrics.chainReturn > 0 ? 'text-red-600' : metrics.chainReturn < 0 ? 'text-emerald-600' : 'text-slate-700';
            const baselineTone = !valid
              ? 'text-slate-400'
              : metrics.baselineReturn > 0 ? 'text-red-600' : metrics.baselineReturn < 0 ? 'text-emerald-600' : 'text-slate-700';
            const isExpanded = expanded.has(chain.id);
            const legCount = (chain.legs || []).length;
            const pathSummary = chain.name || '尚未配置任何段';
            const isHoldingRecord = isSwitchChainHolding(metrics);
            const firstSegForBaseline = (metrics.segments || [])[0] || null;
            const baselineKind = firstSegForBaseline ? (firstSegForBaseline.kind || 'otc') : 'otc';
            const baselineLatestLabel = baselineKind === 'exchange' ? '最新价格' : '最新净值';

            return (
              <div
                key={chain.id}
                className="rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
              >
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleExpanded(chain.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExpanded(chain.id); } }}
                  className={cx(
                    'flex flex-wrap items-center gap-3 px-4 py-3 cursor-pointer transition-colors hover:bg-slate-50/60',
                    isExpanded ? 'border-b border-slate-100' : ''
                  )}
                >
                  <ChevronDown className={cx('h-4 w-4 flex-none text-slate-400 transition-transform', !isExpanded && '-rotate-90')} />
                  <div className="min-w-[180px] flex-1">
                    <div className="flex min-w-0 items-center gap-2"><div className="truncate text-sm font-semibold text-slate-800">{pathSummary}</div><span className="fund-switch-mobile-record-status">{isHoldingRecord ? "持仓中" : "已完成"}</span></div>
                    <div className="mt-0.5 truncate text-[11px] text-slate-500">
                      段数 {legCount} · 起 {(metrics.segments[0] || {}).buyDate || '—'} · 至 {(metrics.segments[legCount - 1] || {}).sellDate || '持有至今'}
                    </div>
                  </div>
                  <div className="flex items-center gap-5 text-xs">
                    <div className="text-right">
                      <div className="text-[10px] uppercase tracking-[0.12em] text-slate-400">链路收益率</div>
                      <div className={cx('font-semibold tabular-nums', chainTone)}>
                        {metrics.valid ? formatSignedPercent(metrics.chainReturn * 100) : '—'}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] uppercase tracking-[0.12em] text-slate-400">切换优势</div>
                      <div className={cx('font-semibold tabular-nums', advantageTone)}>
                        {metrics.valid ? formatSignedPercent(metrics.advantage * 100) : '—'}
                      </div>
                    </div>
                  </div>
                </div>

                {isExpanded ? (
                  <>
                    <div className="fund-switch-mobile-detail-tabs" role="tablist" aria-label="切换记录详情">{[["analysis", "收益分析"], ["segments", "阶段明细"], ["chart", "图表走势"], ["note", "备注"]].map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={recordDetailTab === id} className={recordDetailTab === id ? "is-active" : ""} onClick={(event) => { event.stopPropagation(); setRecordDetailTab(id); }}>{label}</button>)}</div>
                    {recordDetailTab !== "analysis" ? <div className="fund-switch-mobile-detail-placeholder">{recordDetailTab === "chart" ? "图表走势将在下一步接入链路净值序列。" : recordDetailTab === "note" ? "该切换链路暂无独立备注。" : "阶段明细如下。"}</div> : null}
                    <div className="px-4 py-3 space-y-2">
                      {(metrics.segments || []).map((seg, i) => {
                        const segTone = !seg.valid
                          ? 'text-slate-400'
                          : seg.segReturn > 0 ? 'text-red-600' : seg.segReturn < 0 ? 'text-emerald-600' : 'text-slate-700';
                        const buyTx = txById.get(seg.buyTxId);
                        const kind = seg.kind || (buyTx && buyTx.kind) || 'otc';
                        const isExchange = kind === 'exchange';
                        const latestLabel = isExchange ? '最新价格' : '最新净值';
                        const isOpenSeg = seg.segEndSource === 'latestNav';
                        return (
                          <div key={i} className="rounded-xl border border-slate-100 bg-slate-50/40 px-3 py-2.5">
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              <span className="inline-flex h-6 min-w-[44px] items-center justify-center rounded-full bg-slate-200 px-2 text-[11px] font-semibold text-slate-700">段 {i + 1}</span>
                              <span className="font-mono font-semibold text-slate-800">{seg.code}</span>
                              {seg.name ? <span className="truncate text-slate-500">{seg.name}</span> : null}
                              <Pill tone={KIND_PILL_TONES[kind] || 'slate'}>{KIND_LABELS[kind] || '未知'}</Pill>
                              <span className="ml-auto tabular-nums text-slate-500">份额 {formatShares(seg.buyShares)}</span>
                            </div>
                            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 pl-1 text-[11px] text-slate-500">
                              <span>买：{seg.buyDate || '—'} @ {formatNav(seg.buyPrice)}</span>
                              {isOpenSeg ? (
                                <span>
                                  {latestLabel} @ {formatNav(seg.sellPrice)}
                                  <span className="ml-1 rounded bg-amber-50 px-1 text-[10px] text-amber-600">持有中</span>
                                </span>
                              ) : (
                                <span>卖：{seg.sellDate || '—'} @ {formatNav(seg.sellPrice)}</span>
                              )}
                              <span className={cx('font-semibold tabular-nums', segTone)}>变化 {seg.valid ? formatSignedPercent(seg.segReturn * 100) : '—'}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="border-t border-slate-100 bg-slate-50/40 px-4 py-3">
                      {!metrics.valid && metrics.validationError ? (
                        <div className="mb-2 flex items-start gap-1.5 text-xs text-amber-600">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" />
                          <span>{metrics.validationError}</span>
                        </div>
                      ) : null}
                      {!metrics.valid && !metrics.validationError && metrics.missingPriceCodes.length ? (
                        <div className="mb-2 flex items-start gap-1.5 text-xs text-amber-600">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" />
                          <span>缺少净值：{metrics.missingPriceCodes.join('、')}（请先在「基金汇总」刷新最新净值）。</span>
                        </div>
                      ) : null}
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">链路收益率</div>
                          <div className={cx('mt-1 text-base font-semibold tabular-nums', chainTone)}>
                            {metrics.valid ? formatSignedPercent(metrics.chainReturn * 100) : '—'}
                          </div>
                          <div className="mt-0.5 text-[11px] tabular-nums text-slate-400">乘积 {metrics.valid ? metrics.chainMultiple.toFixed(4) : '—'}</div>
                        </div>
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                            未切换持仓
                            {metrics.baselineCode ? <span className="ml-1 font-mono text-slate-500">({metrics.baselineCode})</span> : null}
                          </div>
                          <div className={cx('mt-1 text-base font-semibold tabular-nums', baselineTone)}>
                            {metrics.valid ? formatSignedPercent(metrics.baselineReturn * 100) : '—'}
                          </div>
                          <div className="mt-0.5 text-[11px] tabular-nums text-slate-400">
                            {metrics.valid ? `${formatNav(metrics.baselineStartPrice)} → ${formatNav(metrics.baselineEndPrice)}` : '—'}
                            {metrics.baselineEndSource === 'latestNav' ? <span className="ml-1 rounded bg-amber-50 px-1 text-[10px] text-amber-600">{baselineLatestLabel}</span> : null}
                            {metrics.baselineAlignedToChainEnd ? <span className="ml-1 rounded bg-emerald-50 px-1 text-[10px] text-emerald-600">完美对齐</span> : null}
                          </div>
                        </div>
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">切换优势</div>
                          <div className={cx('mt-1 text-base font-semibold tabular-nums', advantageTone)}>
                            {metrics.valid ? formatSignedPercent(metrics.advantage * 100) : '—'}
                          </div>
                          <div className="mt-0.5 text-[11px] tabular-nums text-slate-400">链路 − 未切换</div>
                        </div>
                      </div>
                      {metrics.cashFlowValid ? (
                        <div className="mt-3 grid grid-cols-1 gap-3 border-t border-dashed border-slate-200 pt-3 sm:grid-cols-3">
                          <div>
                            <div className="text-[11px] text-slate-500">链路实际盈亏</div>
                            <div className={cx('mt-0.5 text-sm font-semibold tabular-nums', metrics.chainProfit > 0 ? 'text-red-600' : metrics.chainProfit < 0 ? 'text-emerald-600' : 'text-slate-700')}>
                              {formatSignedCurrency(metrics.chainProfit)}
                            </div>
                            <div className="mt-0.5 text-[11px] tabular-nums text-slate-400">
                              末值 {formatCurrency(metrics.chainFinalValue, '¥', 2)} · {formatSignedPercent(metrics.chainProfitRate * 100)}
                            </div>
                          </div>
                          <div>
                            <div className="text-[11px] text-slate-500">未切换盈亏</div>
                            <div className={cx('mt-0.5 text-sm font-semibold tabular-nums', metrics.baselineProfit > 0 ? 'text-red-600' : metrics.baselineProfit < 0 ? 'text-emerald-600' : 'text-slate-700')}>
                              {formatSignedCurrency(metrics.baselineProfit)}
                            </div>
                            <div className="mt-0.5 text-[11px] tabular-nums text-slate-400">
                              末值 {formatCurrency(metrics.baselineFinalValue, '¥', 2)} · 初投入 {formatCurrency(metrics.initialCapital, '¥', 2)}
                            </div>
                          </div>
                          <div>
                            <div className="text-[11px] text-slate-500">切换优势（元）</div>
                            <div className={cx('mt-0.5 text-sm font-semibold tabular-nums', metrics.advantageProfit > 0 ? 'text-red-600' : metrics.advantageProfit < 0 ? 'text-emerald-600' : 'text-slate-700')}>
                              {formatSignedCurrency(metrics.advantageProfit)}
                            </div>
                            <div className="mt-0.5 text-[11px] tabular-nums text-slate-400">链路盈亏 − 未切换盈亏</div>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
      </div>
  );
}

export default FundSwitchAnalysisExperience;
