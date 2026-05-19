import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Save, TrendingDown } from 'lucide-react';
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
import { getAssetType, getAssetTypeLabel, canSell } from '../app/assetType.js';
import { EXTRA_SYMBOL_GROUPS } from '../app/extraSymbols.js';
import { readPlanList } from '../app/plan.js';
import { readTradeLedger } from '../app/tradeLedger.js';
import { groupCostBasisBySymbol } from '../app/costTracker.js';
import { calculatePositions } from '../app/positionManager.js';
import { showToast } from '../app/toast.js';
import {
  Card,
  Field,
  NumberInput,
  Pill,
  SectionHeading,
  SelectField,
  StatCard,
  TextInput,
  cx,
  primaryButtonClass,
  secondaryButtonClass
} from '../components/experience-ui.jsx';

// 卖出计划页：PR 1。
// 锁定参数 D7：默认 3 档、盈利 15/25/35%、卖出比 33/33/34%。
// UI 允许 3-5 档调整。宽基指数（QQQ/VOO 等）会被禁止保存。

function normalizeArrayLength(values, length, fallback) {
  const arr = Array.isArray(values) ? [...values] : [];
  while (arr.length < length) arr.push(fallback[arr.length] ?? 0);
  return arr.slice(0, length);
}

export function SellPlanExperience({ links, embedded = false, onAfterSave }) {
  const [state, setState] = useState(() => readSellPlanDraft());
  const [planList] = useState(() => readPlanList());
  const [isSaving, setIsSaving] = useState(false);

  // PR 2.5b part 2：读 DCA 计算器反向预填（sessionStorage aiDcaSellApply），并侍后清除。
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let payload = null;
    try {
      const raw = window.sessionStorage.getItem('aiDcaSellApply');
      if (raw) payload = JSON.parse(raw);
    } catch (_e) { payload = null; }
    if (!payload || !payload.symbol) return;
    setState((current) => ({
      ...current,
      symbol: String(payload.symbol).toUpperCase(),
      holdingCost: Number(payload.avgCost) > 0 ? Number(payload.avgCost) : current.holdingCost
    }));
    try { window.sessionStorage.removeItem('aiDcaSellApply'); } catch (_e) { /* ignore */ }
    showToast({
      tone: 'emerald',
      title: '已从 DCA 回测预填',
      description: `${String(payload.symbol).toUpperCase()} · 平均成本 ${Number(payload.avgCost).toFixed(2)}`
    });
  }, []);

  const projection = useMemo(() => buildSellPlan(state), [state]);
  const assetTypeLabel = getAssetTypeLabel(state.symbol);
  const assetType = getAssetType(state.symbol);
  const sellable = canSell(state.symbol);

  // PR 4.5：仓位检查 — 读 positionSnapshot + tradeLedger，给出当前 symbol 的仓位 %。
  // 宽基不限仓，个股 50% 上限。超阈给红色签，服近给黄色签。
  const weightInfo = useMemo(() => {
    const symbol = String(state.symbol || '').trim().toUpperCase();
    if (!symbol) return null;
    let snapshot = null;
    try {
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem('aiDcaPositionSnapshot') : null;
      snapshot = raw ? JSON.parse(raw) : null;
    } catch (_e) { snapshot = null; }
    if (!snapshot || !(Number(snapshot.totalAssets) > 0)) return null;
    const trades = readTradeLedger();
    const grouped = groupCostBasisBySymbol(trades);
    const shares = {};
    for (const [sym, payload] of Object.entries(grouped)) {
      if (payload.summary.remainingShares > 0) shares[sym] = payload.summary.remainingShares;
    }
    const positions = calculatePositions({
      totalAssets: Number(snapshot.totalAssets) || 0,
      prices: snapshot.prices || {},
      shares
    });
    const row = (positions.rows || []).find((r) => String(r.symbol).toUpperCase() === symbol);
    if (!row) return null;
    return {
      weightPct: Number(row.weightPct) || 0,
      exceedsCap: Boolean(row.exceedsCap),
      capPct: row.type === 'index' ? null : 50,
      type: row.type
    };
  }, [state.symbol]);

  const linkedPlanOptions = useMemo(
    () => [
      { label: '不关联加仓策略', value: '' },
      ...planList.map((plan) => ({
        label: plan.name || `${plan.symbol} 加仓策略`,
        value: plan.id
      }))
    ],
    [planList]
  );

  useEffect(() => {
    persistSellPlanDraft(state);
  }, [state]);

  function handleLinkedPlanChange(nextPlanId = '') {
    const target = planList.find((p) => p.id === nextPlanId) || null;
    setState((current) => ({
      ...current,
      linkedPlanId: nextPlanId,
      symbol: target?.symbol || current.symbol
    }));
  }

  function handleTierCountChange(nextCount) {
    const safeCount = Math.max(MIN_SELL_TIERS, Math.min(MAX_SELL_TIERS, Number(nextCount) || MIN_SELL_TIERS));
    setState((current) => {
      const gains = normalizeArrayLength(current.gainTriggers, safeCount, DEFAULT_GAIN_TRIGGERS);
      const ratios = normalizeArrayLength(current.sellRatios, safeCount, DEFAULT_SELL_RATIOS);
      // 重新平均分配剩余比例，保证总和 ≈ 1
      const sum = ratios.reduce((s, r) => s + (Number(r) || 0), 0) || 1;
      const normRatios = ratios.map((r) => (Number(r) || 0) / sum);
      return { ...current, gainTriggers: gains, sellRatios: normRatios };
    });
  }

  function updateGainAt(index, value) {
    setState((current) => {
      const next = [...current.gainTriggers];
      next[index] = Number(value) || 0;
      return { ...current, gainTriggers: next };
    });
  }

  function updateRatioAt(index, value) {
    setState((current) => {
      const next = [...current.sellRatios];
      next[index] = Math.max(Number(value) || 0, 0) / 100; // UI 起用百分制
      return { ...current, sellRatios: next };
    });
  }

  async function handleSave() {
    if (isSaving) return;
    if (!String(state.symbol || '').trim()) {
      showToast({ title: '请先选择标的', tone: 'amber' });
      return;
    }
    if (!sellable) {
      showToast({
        title: '宽基指数不可设置卖出计划',
        description: `${state.symbol} 是宽基指数，按策略只买不减仓。`,
        tone: 'amber'
      });
      return;
    }
    setIsSaving(true);
    try {
      const saved = saveSellPlan(state);
      showToast({
        title: '卖出计划已保存',
        description: `${saved.symbol} · ${saved.gainTriggers.length} 档，预计总收入 ${formatCurrency(projection.totalProceeds, '$ ')}`,
        tone: 'emerald',
        persist: true
      });
      if (typeof onAfterSave === 'function') onAfterSave();
    } finally {
      setIsSaving(false);
    }
  }

  const tierCount = state.gainTriggers.length || MIN_SELL_TIERS;
  const ratioSum = state.sellRatios.reduce((s, r) => s + (Number(r) || 0), 0);
  const ratioPercentTotal = Math.round(ratioSum * 100);

  return (
    <>
      <div className={cx('space-y-6', embedded ? '' : 'mx-auto max-w-6xl px-6 pt-8')}>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard
            accent="indigo"
            eyebrow="总档数"
            value={`${projection.layers.length} 档`}
            note={sellable ? '盈利越高卖出越多' : '当前标的不允许卖出'}
          />
          <StatCard
            eyebrow="预计总收入"
            value={formatCurrency(projection.totalProceeds, '$ ')}
            note="按起始成本×(1+涨幅)估算"
          />
          <StatCard
            eyebrow="预计总利润"
            value={formatCurrency(projection.totalProfit, '$ ')}
            note={projection.holdingCost > 0 && projection.holdingShares > 0 ? '起于持仓成本与股数' : '请填入持仓成本与股数'}
          />
          <StatCard
            accent="emerald"
            eyebrow="卖出比总和"
            value={`${ratioPercentTotal}%`}
            note={ratioPercentTotal === 100 ? '完全卖出' : ratioPercentTotal < 100 ? `保留 ${100 - ratioPercentTotal}% 底仓` : '已超 100%，保存时会自动归一'}
          />
        </div>

        <div className="grid items-start gap-6 lg:grid-cols-5">
          <Card className="lg:col-span-2 lg:col-start-4 lg:row-start-1 lg:sticky lg:top-4">
            <SectionHeading eyebrow="计划参数" title="卖出参数设置" />

            <div className="mt-6 space-y-5">
              <Field label="计划名称" helper="例如：NVDA 三档减仓">
                <TextInput
                  placeholder="未填则自动设为 「标的 · 三档卖出」"
                  value={state.name}
                  onChange={(event) => setState((current) => ({ ...current, name: event.target.value }))}
                />
              </Field>

              <Field label="关联加仓策略" helper={planList.length ? '选中后会自动同步标的。' : '当前还没有已创建的加仓策略。'}>
                <SelectField
                  options={linkedPlanOptions}
                  value={state.linkedPlanId || ''}
                  onChange={(event) => handleLinkedPlanChange(event.target.value)}
                />
              </Field>

              <Field label="标的代码" helper="宽基指数 (QQQ/VOO/SPY 等) 不能设置卖出计划">
                <div className="mb-2 space-y-2">
                  {EXTRA_SYMBOL_GROUPS.filter((g) => g.key !== 'index').map((group) => (
                    <div key={group.key} className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold text-slate-500">{group.label}</span>
                      {group.symbols.map((s) => (
                        <button
                          key={s.code}
                          type="button"
                          onClick={() => setState((current) => ({ ...current, symbol: s.code }))}
                          className={cx(
                            'rounded-full border px-3 py-1 text-xs font-semibold transition-all',
                            state.symbol === s.code
                              ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                              : 'border-slate-200 bg-white text-slate-500 hover:border-indigo-200 hover:text-indigo-600'
                          )}
                          title={s.name}
                        >
                          {s.code}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
                <TextInput
                  value={state.symbol}
                  onChange={(event) => setState((current) => ({ ...current, symbol: event.target.value }))}
                  placeholder="例如：AAPL、NVDA、TSM"
                />
                <div className="mt-1 flex items-center gap-2 text-xs">
                  <Pill tone={assetType === 'stock' ? 'emerald' : assetType === 'index' ? 'amber' : 'slate'}>
                    {assetTypeLabel}
                  </Pill>
                  {!sellable && state.symbol ? (
                    <span className="text-amber-700">宽基指数：只买不减仓</span>
                  ) : null}
                </div>
              </Field>

              <div className="grid gap-4 md:grid-cols-2">
                <Field label="持仓成本" helper="平均买入价格">
                  <NumberInput
                    step="0.01"
                    value={state.holdingCost}
                    onChange={(event) => setState((current) => ({ ...current, holdingCost: Number(event.target.value) || 0 }))}
                  />
                </Field>
                <Field label="持仓股数">
                  <NumberInput
                    step="0.01"
                    value={state.holdingShares}
                    onChange={(event) => setState((current) => ({ ...current, holdingShares: Number(event.target.value) || 0 }))}
                  />
                </Field>
              </div>

              {weightInfo ? (
                <div
                  className={cx(
                    'rounded-2xl border px-4 py-3 text-sm',
                    weightInfo.exceedsCap
                      ? 'border-rose-200 bg-rose-50 text-rose-700'
                      : weightInfo.capPct && weightInfo.weightPct >= weightInfo.capPct - 5
                        ? 'border-amber-200 bg-amber-50 text-amber-800'
                        : 'border-slate-200 bg-slate-50 text-slate-600'
                  )}
                >
                  <div className="flex items-center gap-2 font-semibold">
                    <AlertTriangle className="h-4 w-4" /> 仓位检查
                  </div>
                  <div className="mt-1">
                    {state.symbol} 当前仓位 <strong>{weightInfo.weightPct.toFixed(2)}%</strong>
                    {weightInfo.capPct
                      ? <> · 个股上限 {weightInfo.capPct}%{weightInfo.exceedsCap ? '（已超上限，建议逐步减仓）' : ''}</>
                      : <> · 宽基指数不限仓</>}
                  </div>
                </div>
              ) : null}

              <Field label="卖出档位数" helper={`默认 ${MIN_SELL_TIERS} 档，可调 ${MIN_SELL_TIERS}-${MAX_SELL_TIERS} 档。`}>
                <div className="grid grid-cols-3 gap-2">
                  {[3, 4, 5].map((count) => (
                    <button
                      key={count}
                      type="button"
                      onClick={() => handleTierCountChange(count)}
                      className={cx(
                        'rounded-xl border px-4 py-3 text-sm font-semibold transition-all',
                        tierCount === count
                          ? 'border-indigo-200 bg-indigo-50 text-indigo-700 shadow-sm'
                          : 'border-slate-200 bg-slate-50 text-slate-500 hover:bg-white'
                      )}
                    >
                      {count} 档
                    </button>
                  ))}
                </div>
              </Field>

              <Field label="移动止损 %" helper="从阶段高点回落该 % 时触发全部清仓（0 = 关闭）">
                <NumberInput
                  step="0.5"
                  min="0"
                  max="50"
                  value={state.trailingStopPct}
                  onChange={(event) => setState((current) => ({ ...current, trailingStopPct: Math.max(Number(event.target.value) || 0, 0) }))}
                />
              </Field>
            </div>
          </Card>

          <div className="lg:col-span-3 space-y-4">
            <Card className="min-w-0 overflow-hidden">
              <SectionHeading
                eyebrow="档位预览"
                title="按盈利阶梯分批唶卖"
                description={projection.holdingCost > 0 ? `起始成本 ${formatCurrency(projection.holdingCost, '$ ')}、持仓 ${projection.holdingShares} 股` : '填入成本和股数后预览会实时计算。'}
              />

              {!sellable && state.symbol ? (
                <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800">
                  <div className="flex items-center gap-2 font-semibold">
                    <AlertTriangle className="h-4 w-4" /> 宽基指数不可挂卖出计划
                  </div>
                  <div className="mt-1">
                    {state.symbol} 属于宽基指数白名单，策略锁定为「只买不减仓」。如需唶卖请选 Mag7 / TSM 等个股。
                  </div>
                </div>
              ) : null}

              <div className="mt-5 space-y-3">
                {projection.layers.length ? (
                  projection.layers.map((layer, index) => (
                    <div key={layer.id} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Pill tone="indigo">{layer.label}</Pill>
                          <span className="text-sm font-semibold text-slate-900">
                            +{layer.gainPct}% · 卖 {Math.round(layer.ratio * 100)}%
                          </span>
                        </div>
                        <div className="text-right text-xs text-slate-500">
                          触发价 <span className="font-semibold text-slate-900">{formatCurrency(layer.triggerPrice, '$ ')}</span>
                        </div>
                      </div>
                      <div className="mt-3 grid gap-3 md:grid-cols-3">
                        <Field label="盈利 %">
                          <NumberInput
                            step="0.5"
                            value={state.gainTriggers[index] ?? 0}
                            onChange={(event) => updateGainAt(index, event.target.value)}
                          />
                        </Field>
                        <Field label="卖出比 %">
                          <NumberInput
                            step="1"
                            value={Math.round((state.sellRatios[index] ?? 0) * 100)}
                            onChange={(event) => updateRatioAt(index, event.target.value)}
                          />
                        </Field>
                        <Field label="该档预计收入">
                          <TextInput
                            readOnly
                            className="bg-white text-slate-600"
                            value={formatCurrency(layer.proceeds, '$ ')}
                          />
                        </Field>
                      </div>
                      <div className="mt-2 text-xs text-slate-500">
                        股数 ≈ {layer.shares}，利润 ≈ {formatCurrency(layer.profit, '$ ')}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                    填入标的、成本、股数后会在这里预览各档。
                  </div>
                )}
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className={cx(primaryButtonClass, 'inline-flex items-center gap-1.5')}
                  onClick={handleSave}
                  disabled={isSaving || !sellable || !state.symbol}
                >
                  <Save className="h-4 w-4" />
                  {isSaving ? '保存中…' : '保存卖出计划'}
                </button>
                <button
                  type="button"
                  className={secondaryButtonClass}
                  onClick={() => setState({ ...defaultSellPlanState, gainTriggers: [...DEFAULT_GAIN_TRIGGERS], sellRatios: [...DEFAULT_SELL_RATIOS] })}
                >
                  重置为默认
                </button>
                <div className="ml-auto inline-flex items-center gap-1.5 text-xs text-slate-500">
                  <TrendingDown className="h-4 w-4" />
                  减仓不代表清仓，后续仓位管理 PR 会接入动态调整
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}
