import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ChevronDown, Shuffle } from 'lucide-react';
import {
  readLedgerState,
  persistLedgerState,
  mergeSnapshotsFromNavResult,
  buildNavMetaFromResult
} from '../app/holdingsLedger.js';
import { getNavSnapshots } from '../app/navService.js';
import {
  computeSwitchChainMetrics,
  sanitizeTransactions
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

const LEDGER_STORAGE_KEY = 'aiDcaFundHoldingsLedger';

/**
 * 从 ledger transactions 自动推导切换链路：
 * 仅以 SELL.switchPairId 标注的切换为骨架，把相邻切换串成链路。
 *
 * 算法（按 SELL date asc 处理每条已标注切换）:
 *   for each (sellTx with switchPairId → buyTx, oldCode→newCode):
 *     if 已有以 oldCode 结尾的活跃 chain:
 *       chain 末段 sellTxId = sellTx.id
 *       chain 追加新段 { buyTxId: buyTx.id, sellTxId: '' }
 *       map: 删 oldCode，加 newCode → chain
 *     else:
 *       新建 chain，首段 buyTxId = oldCode 在 sellTx.date 前最近一笔 BUY tx，
 *                   首段 sellTxId = sellTx.id
 *       追加新段 { buyTxId: buyTx.id, sellTxId: '' }
 *       map: 加 newCode → chain
 */
function buildAutoSwitchChains(transactions) {
  const txList = sanitizeTransactions(transactions, { filterInvalid: false });
  const txById = new Map();
  for (const tx of txList) if (tx.id) txById.set(tx.id, tx);

  // 按 code 收集所有 BUY tx，便于回溯首段。
  const buysByCode = new Map();
  for (const tx of txList) {
    if (tx.type !== 'BUY' || !tx.code) continue;
    if (!buysByCode.has(tx.code)) buysByCode.set(tx.code, []);
    buysByCode.get(tx.code).push(tx);
  }
  for (const list of buysByCode.values()) {
    list.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  }

  function findLastBuyBefore(code, date) {
    const list = buysByCode.get(code) || [];
    let pick = null;
    for (const tx of list) {
      if (!date || (tx.date || '') <= date) pick = tx;
      else break;
    }
    return pick || (list.length ? list[list.length - 1] : null);
  }

  // 取所有已标注 switchPairId 的切换配对，兼容 SELL → BUY 和 BUY → SELL 两种记录方向。
  // 新版「选择对手方」只在当前交易上记录 switchPairId，买入方选择卖出方时会形成 BUY.switchPairId = SELL.id。
  const switchPairs = [];
  const seenPairKeys = new Set();
  for (const tx of txList) {
    if (!tx.code || !tx.switchPairId) continue;
    const pair = txById.get(tx.switchPairId);
    if (!pair || !pair.code || pair.code === tx.code) continue;
    let sellTx = null;
    let buyTx = null;
    if (tx.type === 'SELL' && pair.type === 'BUY') {
      sellTx = tx;
      buyTx = pair;
    } else if (tx.type === 'BUY' && pair.type === 'SELL') {
      sellTx = pair;
      buyTx = tx;
    }
    if (!sellTx || !buyTx) continue;
    const pairKey = `${sellTx.id || ''}|${buyTx.id || ''}`;
    if (seenPairKeys.has(pairKey)) continue;
    seenPairKeys.add(pairKey);
    switchPairs.push({ sellTx, buyTx });
  }
  switchPairs.sort((a, b) => (a.sellTx.date || '').localeCompare(b.sellTx.date || '') || (a.buyTx.date || '').localeCompare(b.buyTx.date || ''));

  const chains = [];
  const activeByTailCode = new Map();
  let chainSeq = 0;

  for (const { sellTx, buyTx } of switchPairs) {
    const oldCode = sellTx.code;
    const newCode = buyTx.code;
    let chain = activeByTailCode.get(oldCode);
    if (chain) {
      const lastLeg = chain.legs[chain.legs.length - 1];
      if (lastLeg && !lastLeg.sellTxId) lastLeg.sellTxId = sellTx.id;
      chain.legs.push({ buyTxId: buyTx.id, sellTxId: '' });
      activeByTailCode.delete(oldCode);
    } else {
      chainSeq += 1;
      const firstBuy = findLastBuyBefore(oldCode, sellTx.date);
      if (!firstBuy) continue; // 没有匹配 BUY，跳过这次切换
      chain = {
        id: `auto-chain-${chainSeq}`,
        name: '',
        legs: [
          { buyTxId: firstBuy.id, sellTxId: sellTx.id },
          { buyTxId: buyTx.id, sellTxId: '' }
        ]
      };
      chains.push(chain);
    }
    // 链尾换成 newCode
    activeByTailCode.set(newCode, chain);
  }

  // 链路命名：path = code1 → code2 → ...
  for (const chain of chains) {
    const codes = [];
    for (const leg of chain.legs) {
      const buy = txById.get(leg.buyTxId);
      if (buy && buy.code) codes.push(buy.code);
    }
    chain.name = codes.join(' → ');
  }

  return chains;
}

export function FundSwitchAnalysisExperience() {
  const [ledger, setLedger] = useState(() => readLedgerState());
  const [expanded, setExpanded] = useState(() => new Set());
  const navRefreshTriggeredRef = useRef(false);

  // 监听 storage 事件，跨标签页/兄弟组件更新 ledger 时同步。
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    function onStorage(e) {
      if (e && e.key && e.key !== LEDGER_STORAGE_KEY) return;
      setLedger(readLedgerState());
    }
    window.addEventListener('storage', onStorage);
    // 同窗口编辑后由 HoldingsExperience 写 localStorage 但不会触发 storage 事件。
    // 这里在每次 tab mount 时 setLedger 一次足够；如果用户来回切 tab 即可刷新。
    return () => window.removeEventListener('storage', onStorage);
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
      } catch (_err) {
        // 静默失败：下次 mount 重试。
        navRefreshTriggeredRef.current = false;
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
  const txById = useMemo(() => {
    const m = new Map();
    for (const tx of transactions) if (tx && tx.id) m.set(tx.id, tx);
    return m;
  }, [transactions]);

  function toggleExpanded(id) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl border border-slate-200/70 bg-white px-5 py-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <Shuffle className="h-4 w-4 text-indigo-500" />
          基金切换收益分析
        </div>
        <div className="mt-1 text-xs leading-relaxed text-slate-500">
          自动从「成交流水」中已标注 <span className="font-semibold text-slate-600">基金切换</span>（SELL ↔ BUY 配对）的记录推导链路，按日期顺序串联。
          链路收益率 = 每段价格/净值乘积 − 1；未切换基准 = 一直持有首段基金到链路终点。场内基金以场内交易价计算，场外基金以净值计算。
        </div>
      </div>

      {chainsWithMetrics.length === 0 ? (
        <div className="flex min-h-[180px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-200 bg-white text-center text-sm text-slate-500">
          <Shuffle className="h-7 w-7 text-slate-300" />
          <div>暂无基金切换记录。</div>
          <div className="text-xs text-slate-400">在「持仓 → 新增交易」中将卖出标记为「基金切换」并选择反向买入即可自动出现。</div>
        </div>
      ) : (
        <div className="space-y-3">
          {chainsWithMetrics.map(({ chain, metrics }) => {
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
                    <div className="truncate text-sm font-semibold text-slate-800">{pathSummary}</div>
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
                            未切换基准
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
  );
}

export default FundSwitchAnalysisExperience;
