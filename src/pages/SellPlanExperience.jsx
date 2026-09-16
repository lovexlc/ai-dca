import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, TrendingDown } from 'lucide-react';
import { formatCurrency } from '../app/accumulation.js';
import {
  DEFAULT_GAIN_TRIGGERS,
  DEFAULT_SELL_RATIOS,
  MAX_SELL_TIERS,
  MIN_SELL_TIERS,
  buildSellPlan,
  defaultSellPlanState
} from '../app/sellStrategy.js';
import {
  persistSellPlanDraft,
  readSellPlanDraft,
  saveSellPlan
} from '../app/sellPlans.js';
import { canSell, getAssetTypeLabel } from '../app/assetType.js';
import { showToast } from '../app/toast.js';
import { cx } from '../components/experience-ui.jsx';
import { trackActionResult, trackFeatureEvent } from '../app/analytics.js';

function normalizeArrayLength(values, length, fallback) {
  const arr = Array.isArray(values) ? [...values] : [];
  while (arr.length < length) arr.push(fallback[arr.length] ?? 0);
  return arr.slice(0, length);
}

export function SellPlanExperience({
  links,
  embedded = false,
  initialSell = null,
  onBack = null,
  onCancel = null,
  onAfterSave = null
}) {
  const handleBack = onBack || onCancel || (() => {
    if (typeof window !== 'undefined') {
      if (window.location.hash.includes('sell')) {
        window.history.back();
      } else {
        window.location.hash = '#sell';
      }
    }
  });

  const [state, setState] = useState(() => ({
    ...readSellPlanDraft(),
    holdingCost: 1.25,
    holdingShares: 10000,
    currentPrice: 1.34,
    ...(initialSell && typeof initialSell === 'object' ? initialSell : {})
  }));

  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    persistSellPlanDraft(state);
  }, [state]);

  const projection = useMemo(() => buildSellPlan(state), [state]);
  const sellable = canSell(state.symbol);

  const holdingCost = Number(state.holdingCost) || 0;
  const holdingShares = Number(state.holdingShares) || 0;
  const currentPrice = Number(state.currentPrice || holdingCost);
  const totalCost = holdingCost * holdingShares;
  const currentMarketValue = currentPrice * holdingShares;
  const floatingProfit = currentMarketValue - totalCost;
  const floatingProfitPct = totalCost > 0 ? ((floatingProfit / totalCost) * 100).toFixed(1) : '0.0';

  const tierCount = state.gainTriggers?.length || 3;

  function handleTierCountChange(nextCount) {
    const safeCount = Math.max(MIN_SELL_TIERS, Math.min(MAX_SELL_TIERS, Number(nextCount) || MIN_SELL_TIERS));
    setState((current) => {
      const gains = normalizeArrayLength(current.gainTriggers, safeCount, DEFAULT_GAIN_TRIGGERS);
      const ratios = normalizeArrayLength(current.sellRatios, safeCount, DEFAULT_SELL_RATIOS);
      const sum = ratios.reduce((s, r) => s + (Number(r) || 0), 0) || 1;
      const normRatios = ratios.map((r) => (Number(r) || 0) / sum);
      return { ...current, gainTriggers: gains, sellRatios: normRatios };
    });
  }

  function updateGainAt(index, value) {
    setState((current) => {
      const next = [...(current.gainTriggers || DEFAULT_GAIN_TRIGGERS)];
      next[index] = Number(value) || 0;
      return { ...current, gainTriggers: next };
    });
  }

  function updateRatioAt(index, value) {
    setState((current) => {
      const next = [...(current.sellRatios || DEFAULT_SELL_RATIOS)];
      next[index] = Math.max(Number(value) || 0, 0) / 100;
      return { ...current, sellRatios: next };
    });
  }

  async function handleSave() {
    if (isSaving) return;
    const sym = String(state.symbol || '').trim().toUpperCase();
    if (!sym) {
      showToast({ title: '请先填写标的代码', tone: 'amber' });
      return;
    }
    if (!sellable) {
      showToast({
        title: '宽基指数不可设置卖出计划',
        description: `${sym} 是宽基指数，按策略只买不减仓。`,
        tone: 'amber'
      });
      return;
    }

    setIsSaving(true);
    const startedAt = Date.now();
    trackFeatureEvent('sell_plan', 'save_start', { symbol: sym });

    try {
      const saved = saveSellPlan({
        ...state,
        symbol: sym,
        isConfigured: true
      });
      trackActionResult('sell_plan', 'save', 'success', {
        symbol: sym,
        durationMs: Date.now() - startedAt
      });
      showToast({
        title: '止盈策略已保存',
        description: `${saved.symbol} · ${saved.gainTriggers.length} 档分档止盈已加入监控。`,
        tone: 'emerald',
        persist: true
      });
      if (typeof onAfterSave === 'function') {
        onAfterSave();
      } else if (typeof onBack === 'function') {
        onBack();
      } else if (links?.tradePlans) {
        window.location.href = links.tradePlans;
      }
    } finally {
      setIsSaving(false);
    }
  }

  const tiers = (state.gainTriggers || DEFAULT_GAIN_TRIGGERS).map((gain, i) => {
    const ratio = (state.sellRatios || DEFAULT_SELL_RATIOS)[i] ?? 0.33;
    const ratioPct = Math.round(ratio * 100);
    const triggerPrice = (holdingCost * (1 + gain / 100)).toFixed(2);
    const sellShares = Math.round(holdingShares * (ratioPct / 100));
    const proceeds = Math.round(sellShares * Number(triggerPrice));

    return {
      order: i + 1,
      gainPct: gain,
      ratioPct,
      triggerPrice,
      sellShares,
      proceeds
    };
  });

  const totalProceeds = tiers.reduce((acc, t) => acc + t.proceeds, 0);

  return (
    <div className="bg-slate-50 text-slate-900 rounded-3xl p-5 sm:p-7 border border-slate-200 shadow-xl">
      {/* Header Banner (1:1 原型顶栏) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-600">
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
            TIERED PROFIT-TAKING WIZARD
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-950 mt-1">分档止盈卖出策略设计器</h2>
          <p className="text-xs text-slate-500 mt-1">锁定持仓成本，设定 3~5 档止盈目标与减仓比例，自动计算触发价与回收现金流</p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={handleBack}
            className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold transition-all flex items-center gap-1.5 shadow-xs"
          >
            <ArrowLeft className="w-4 h-4" />
            返回看板
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold shadow-lg shadow-amber-500/25 transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
          >
            <Check className="w-4 h-4" />
            {isSaving ? '保存中...' : '保存止盈策略并加入监控'}
          </button>
        </div>
      </div>

      {/* Main 2-Column Grid (1:1 原型布局) */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.3fr)_minmax(360px,1fr)] gap-7 mt-6 items-start">
        {/* Left Side: Sell Parameters */}
        <div className="space-y-5">
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4 text-xs">
            <div className="text-xs font-bold uppercase text-slate-400">第一步</div>
            <div className="text-base font-bold text-slate-950">持仓成本与分档止盈设定</div>

            {/* Symbol & Name */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-slate-700 mb-1">标的代码</label>
                <input
                  type="text"
                  value={state.symbol || ''}
                  onChange={(e) => setState((cur) => ({ ...cur, symbol: e.target.value.toUpperCase() }))}
                  placeholder="如 NVDA、TSLA、159632..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white font-mono font-bold text-slate-900 focus:ring-2 focus:ring-amber-500 outline-none"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">标的名称</label>
                <input
                  type="text"
                  value={state.name || ''}
                  onChange={(e) => setState((cur) => ({ ...cur, name: e.target.value }))}
                  placeholder="如 英伟达、特斯拉..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white font-bold text-slate-900 focus:ring-2 focus:ring-amber-500 outline-none"
                />
              </div>
            </div>

            {/* Holding Cost & Shares */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-slate-700 mb-1">持仓平均成本</label>
                <input
                  type="number"
                  step="0.01"
                  value={state.holdingCost || ''}
                  onChange={(e) => setState((cur) => ({ ...cur, holdingCost: Number(e.target.value) || 0 }))}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white font-mono font-bold text-slate-900 focus:ring-2 focus:ring-amber-500 outline-none"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">当前持有股数</label>
                <input
                  type="number"
                  value={state.holdingShares || ''}
                  onChange={(e) => setState((cur) => ({ ...cur, holdingShares: Number(e.target.value) || 0 }))}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white font-mono font-bold text-slate-900 focus:ring-2 focus:ring-amber-500 outline-none"
                />
              </div>
            </div>

            {/* Tiers Configuration */}
            <div className="pt-2 border-t border-slate-100">
              <div className="flex items-center justify-between mb-2.5">
                <span className="font-bold text-slate-800">阶梯止盈分档 (目标收益率 & 卖出比例)</span>
                <div className="flex items-center gap-1">
                  {[3, 4, 5].map((cnt) => (
                    <button
                      key={cnt}
                      type="button"
                      onClick={() => handleTierCountChange(cnt)}
                      className={cx(
                        'px-2.5 py-1 rounded-lg text-xs font-bold border transition-all',
                        tierCount === cnt
                          ? 'bg-amber-50 border-amber-500 text-amber-800'
                          : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                      )}
                    >
                      {cnt} 档
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2.5">
                {tiers.map((t, i) => (
                  <div key={t.order} className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-2">
                    <span className="font-bold text-slate-900 w-16">第 {t.order} 档</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-slate-500">盈利达</span>
                      <input
                        type="number"
                        value={t.gainPct}
                        onChange={(e) => updateGainAt(i, e.target.value)}
                        className="w-16 px-2 py-1 rounded-lg border border-slate-300 font-mono font-bold text-center text-slate-900 bg-white"
                      />
                      <span className="text-slate-500">%</span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <span className="text-slate-500">卖出</span>
                      <input
                        type="number"
                        value={t.ratioPct}
                        onChange={(e) => updateRatioAt(i, e.target.value)}
                        className="w-16 px-2 py-1 rounded-lg border border-slate-300 font-mono font-bold text-center text-slate-900 bg-white"
                      />
                      <span className="text-slate-500">%仓位</span>
                    </div>

                    <div className="text-right text-[11px] text-slate-500 w-full sm:w-auto pt-1 sm:pt-0">
                      触发价 <strong className="font-mono text-amber-700">¥ {t.triggerPrice}</strong> · 预计回收 <strong className="font-mono text-slate-900">¥ {t.proceeds.toLocaleString()}</strong>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Right Side: Sell Strategy Preview */}
        <div className="space-y-5 lg:sticky lg:top-4">
          <div className="bg-white rounded-2xl border border-amber-100 p-5 shadow-md bg-gradient-to-br from-amber-50/40 via-white to-white">
            <div className="text-[10px] font-bold text-amber-600">止盈测算看板</div>
            <h3 className="text-base font-bold text-slate-950 mt-0.5">持仓盈亏与阶梯离场预估</h3>

            <div className="mt-4 p-4 rounded-xl bg-white border border-slate-200 text-xs space-y-2.5">
              <div className="flex justify-between text-slate-500">
                <span>持仓总成本：</span>
                <strong className="font-mono text-slate-900 font-bold">¥ {totalCost.toLocaleString()}</strong>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>当前浮动盈亏：</span>
                <strong className={cx('font-mono font-bold', floatingProfit >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
                  {floatingProfit >= 0 ? '+' : ''}¥ {floatingProfit.toFixed(2)} ({floatingProfitPct}%)
                </strong>
              </div>
              <div className="flex justify-between text-slate-500 border-t border-slate-100 pt-2.5">
                <span>全部止盈后回收现金：</span>
                <strong className="font-mono text-amber-700 font-bold text-sm">
                  ¥ {totalProceeds.toLocaleString()}
                </strong>
              </div>
            </div>

            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="w-full mt-5 py-3 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold shadow-md shadow-amber-500/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <Check className="w-4 h-4" />
              将此止盈策略加入监控中心
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
