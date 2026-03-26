import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, Plus, Save, Trash2 } from 'lucide-react';
import { formatCurrency, formatPercent } from '../app/accumulation.js';
import { buildPlan, persistPlanState, readPlanState } from '../app/plan.js';
import { Card, Field, NumberInput, PageHero, PageShell, Pill, SectionHeading, SelectField, TextInput, cx, primaryButtonClass, secondaryButtonClass } from '../components/experience-ui.jsx';

const frequencyOptions = ['每日', '每周', '每月', '每季'];

export function NewPlanExperience({ links }) {
  const [state, setState] = useState(() => readPlanState());
  const computed = useMemo(() => buildPlan(state), [state]);

  useEffect(() => {
    persistPlanState(state, computed);
  }, [state, computed]);

  function updateLayerValue(key, index, value) {
    setState((current) => {
      const next = [...current[key]];
      next[index] = Math.max(Number(value) || 0, 0);
      return { ...current, [key]: next };
    });
  }

  function addLayer() {
    setState((current) => {
      const lastTrigger = current.triggerDrops[current.triggerDrops.length - 1] ?? 0;
      return {
        ...current,
        layerWeights: [...current.layerWeights, 10],
        triggerDrops: [...current.triggerDrops, lastTrigger + 4]
      };
    });
  }

  function removeLayer(index) {
    setState((current) => {
      if (current.layerWeights.length <= 2) {
        return current;
      }

      return {
        ...current,
        layerWeights: current.layerWeights.filter((_, layerIndex) => layerIndex !== index),
        triggerDrops: current.triggerDrops.filter((_, layerIndex) => layerIndex !== index)
      };
    });
  }

  return (
    <PageShell>
      <PageHero
        backHref={links.home}
        backLabel="返回策略总览"
        eyebrow="New Strategy Plan"
        title="新建建仓计划"
        description="把预算、现金留存和每一层的触发跌幅一次配置清楚，后续所有加仓编辑与历史追踪都会沿用这份计划。"
        badges={[
          <Pill key="investable" tone="indigo">可投入 {formatCurrency(computed.investableCapital, '¥ ')}</Pill>,
          <Pill key="reserve" tone="slate">预留 {formatCurrency(computed.reserveCapital, '¥ ')}</Pill>
        ]}
      />

      <div className="mx-auto max-w-6xl space-y-6 px-6 pt-8">
        <div className="grid gap-6 lg:grid-cols-5">
          <div className="space-y-6 lg:col-span-3">
            <Card>
              <SectionHeading eyebrow="Step 01" title="基础设置" description="先确定标的、预算规模和首笔价格，再决定留多少现金缓冲。" />

              <div className="mt-6 space-y-5">
                <Field label="资产标的" helper="推荐直接使用代码，便于后续联动到总览和历史页。">
                  <TextInput value={state.symbol} onChange={(event) => setState((current) => ({ ...current, symbol: event.target.value || 'QQQ' }))} placeholder="例如 QQQ" />
                </Field>

                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="总投资额">
                    <NumberInput step="0.01" value={state.totalBudget} onChange={(event) => setState((current) => ({ ...current, totalBudget: Number(event.target.value) || 0 }))} />
                  </Field>
                  <Field label="首笔价格">
                    <NumberInput step="0.01" value={state.basePrice} onChange={(event) => setState((current) => ({ ...current, basePrice: Number(event.target.value) || 0 }))} />
                  </Field>
                </div>

                <Field
                  label="现金留存比例"
                  rightLabel={formatPercent(state.cashReservePct, 0)}
                  helper="默认留一部分现金给后续加仓，不把预算一次性全部打满。"
                >
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
                    <input className="h-2 w-full accent-indigo-600" max="90" min="0" step="1" type="range" value={state.cashReservePct} onChange={(event) => setState((current) => ({ ...current, cashReservePct: Number(event.target.value) || 0 }))} />
                    <div className="mt-3 flex items-center justify-between text-xs font-semibold text-slate-400">
                      <span>0%</span>
                      <span>保守</span>
                      <span>90%</span>
                    </div>
                  </div>
                </Field>

                <Field label="执行频率">
                  <SelectField options={frequencyOptions} value={state.frequency} onChange={(event) => setState((current) => ({ ...current, frequency: event.target.value }))} />
                </Field>
              </div>

              <div className="mt-6 rounded-[24px] border border-indigo-100 bg-gradient-to-br from-indigo-50 via-white to-white p-5">
                <div className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-500">计划建仓总预算</div>
                <div className="mt-2 text-3xl font-extrabold tracking-tight text-indigo-700">{formatCurrency(computed.investableCapital, '¥ ')}</div>
                <p className="mt-3 text-sm leading-6 text-slate-500">扣除预留现金后的可执行预算，这部分会按下方每层权重自动拆分。</p>
              </div>
            </Card>

            <Card>
              <SectionHeading
                eyebrow="Step 02"
                title="分批建仓设置"
                description="每一层都有自己的资金占比和触发跌幅，金额与入场价格会实时联动更新。"
                action={
                  <button className={secondaryButtonClass} type="button" onClick={addLayer}>
                    <Plus className="h-4 w-4" />
                    增加一层
                  </button>
                }
              />

              <div className="mt-6 space-y-4">
                {computed.layers.map((layer, index) => (
                  <div key={layer.id} className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-4">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex items-start gap-4">
                        <div className={cx('flex h-11 w-11 items-center justify-center rounded-2xl text-sm font-bold text-white', index === 0 ? 'bg-slate-900' : 'bg-indigo-600')}>
                          {index + 1}
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-slate-900">{index === 0 ? '首笔买入' : `第 ${index + 1} 批买入`}</div>
                          <div className="mt-1 text-sm text-slate-500">计划投入 {formatCurrency(layer.amount, '¥ ')}，预估份额 {formatCurrency(layer.shares, '', 2)} 股</div>
                        </div>
                      </div>
                      {computed.layers.length > 2 ? (
                        <button className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500" type="button" onClick={() => removeLayer(index)}>
                          <Trash2 className="h-4 w-4" />
                        </button>
                      ) : null}
                    </div>

                    <div className="mt-5 grid gap-4 md:grid-cols-2">
                      <Field label="分配比例">
                        <NumberInput step="1" value={state.layerWeights[index] ?? 0} onChange={(event) => updateLayerValue('layerWeights', index, event.target.value)} />
                      </Field>
                      <Field label="触发跌幅">
                        <NumberInput step="0.5" value={state.triggerDrops[index] ?? 0} onChange={(event) => updateLayerValue('triggerDrops', index, event.target.value)} />
                      </Field>
                    </div>

                    <div className="mt-4 flex flex-col gap-2 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
                      <span>入场价格 {formatCurrency(layer.price)}</span>
                      <span className="font-semibold text-slate-900">权重 {formatPercent(layer.weight, 0)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <div className="space-y-6 lg:col-span-2">
            <Card className="border-indigo-100 bg-gradient-to-br from-indigo-50 via-white to-white">
              <SectionHeading eyebrow="Plan Preview" title="策略成本预览" />
              <div className="mt-6 rounded-[24px] border border-white/80 bg-white/90 p-5 shadow-sm">
                <div className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-500">预估平均成本</div>
                <div className="mt-2 text-3xl font-extrabold tracking-tight text-indigo-700">{formatCurrency(computed.averageCost, '¥ ')}</div>
                <div className="mt-4 grid gap-3">
                  <div className="flex items-center justify-between text-sm text-slate-500">
                    <span>可投入资金</span>
                    <strong className="text-slate-900">{formatCurrency(computed.investableCapital, '¥ ')}</strong>
                  </div>
                  <div className="flex items-center justify-between text-sm text-slate-500">
                    <span>预留现金</span>
                    <strong className="text-slate-900">{formatCurrency(computed.reserveCapital, '¥ ')}</strong>
                  </div>
                </div>
              </div>

              <div className="mt-5 flex min-h-[180px] items-end justify-center gap-3 rounded-[24px] border border-slate-200 bg-white/80 p-5">
                {computed.layers.map((layer) => (
                  <div key={layer.id} className="flex w-14 flex-col items-center gap-3">
                    <div className="flex w-full items-end justify-center rounded-t-2xl bg-indigo-600 px-2 py-3 text-xs font-bold text-white" style={{ height: `${Math.max(layer.weight * 1.6, 44)}px` }}>
                      {formatPercent(layer.weight, 0)}
                    </div>
                    <span className="text-[11px] font-semibold text-slate-400">{layer.label}</span>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="border-emerald-100 bg-emerald-50">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-600" />
                <div>
                  <div className="font-semibold text-emerald-900">执行建议</div>
                  <p className="mt-2 text-sm leading-6 text-emerald-800">
                    当前计划分为 {computed.layers.length} 批执行，留存现金 {formatPercent(state.cashReservePct, 0)}。加仓页会直接沿用这些分配比例。
                  </p>
                </div>
              </div>
            </Card>

            <Card className="border-amber-200 bg-amber-50">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-600" />
                <div>
                  <div className="font-semibold text-amber-900">估计备注</div>
                  <p className="mt-2 text-sm leading-6 text-amber-800">
                    平均成本和批次金额会随分配比例、触发跌幅和首笔价格自动联动更新。建仓前建议再检查一次最深层的价格是否合理。
                  </p>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200 bg-white/85 p-4 shadow-[0_-4px_24px_rgba(15,23,42,0.04)] backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-6 text-sm text-slate-500">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">建仓层数</div>
              <div className="mt-1 text-sm font-extrabold text-slate-900">{computed.layers.length}</div>
            </div>
            <div className="hidden h-8 w-px bg-slate-200 sm:block" />
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">可投入资金</div>
              <div className="mt-1 text-sm font-extrabold text-slate-900">{formatCurrency(computed.investableCapital, '¥ ')}</div>
            </div>
          </div>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <a className={cx(secondaryButtonClass, 'w-full sm:w-auto')} href={links.home}>取消</a>
            <a className={cx(primaryButtonClass, 'w-full sm:w-auto')} href={links.home}>
              <Save className="h-4 w-4" />
              确认创建
              <ArrowRight className="h-4 w-4" />
            </a>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
