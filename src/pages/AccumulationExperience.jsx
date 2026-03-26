import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, BarChart3, Plus, Save, Trash2 } from 'lucide-react';
import { buildStages, formatCurrency, formatPercent, persistAccumulationState, readAccumulationState, round } from '../app/accumulation.js';
import { Card, Field, NumberInput, PageHero, PageShell, Pill, SectionHeading, SelectField, StatCard, cx, primaryButtonClass, secondaryButtonClass } from '../components/experience-ui.jsx';

const frequencyOptions = ['每日', '每周', '每月', '每季'];

export function AccumulationExperience({ links }) {
  const [state, setState] = useState(() => readAccumulationState());
  const computed = useMemo(() => buildStages(state), [state]);

  useEffect(() => {
    persistAccumulationState(state, computed);
  }, [state, computed]);

  function updateWeight(index, value) {
    setState((current) => {
      const nextWeights = [...current.weights];
      nextWeights[index] = Math.max(Number(value) || 0, 0);
      return { ...current, weights: nextWeights };
    });
  }

  function removeStage(index) {
    if (index === 0) {
      return;
    }

    setState((current) => {
      if (current.weights.length <= 1) {
        return current;
      }

      return {
        ...current,
        weights: current.weights.filter((_, weightIndex) => weightIndex !== index)
      };
    });
  }

  return (
    <PageShell>
      <PageHero
        backHref={links.home}
        backLabel="返回策略总览"
        eyebrow="Accumulation Config"
        title="加仓配置"
        description="将建仓总预算、基准价和末层跌幅统一收进一个轻量编辑面板里，实时联动各层权重、入场位和平均成本。"
        badges={[
          <Pill key="status" tone="indigo">正在运行</Pill>,
          <Pill key="frequency" tone="slate">{state.frequency} 检查</Pill>
        ]}
        actions={
          <a className={primaryButtonClass} href={links.addLevel}>
            <Plus className="h-4 w-4" />
            新增层级
          </a>
        }
      />

      <div className="mx-auto max-w-6xl space-y-6 px-6 pt-8">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard accent="indigo" eyebrow="Total Capital" value={formatCurrency(state.totalCapital)} note="总预算会自动按各层权重拆分" />
          <StatCard eyebrow="Average Cost" value={formatCurrency(computed.averageCost)} note="当前联动后的预估平均成本" />
          <StatCard eyebrow="Total Shares" value={`${formatCurrency(computed.totalShares, '', 3)} 股`} note="按每层金额与价格反推出的份额" />
          <StatCard accent="red" eyebrow="Max Drawdown" value={formatPercent(state.maxDrawdown, 2)} note="末层吃满的累计跌幅上限" />
        </div>

        <div className="grid gap-6 lg:grid-cols-5">
          <Card className="lg:col-span-2">
            <SectionHeading
              eyebrow="Base Inputs"
              title="基本参数设置"
              description="优先确认可投入预算、首笔价格和末层跌幅，系统会据此反推每层的目标价与计划金额。"
            />

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <Field label="初始投资额">
                <NumberInput step="0.01" value={state.totalCapital} onChange={(event) => setState((current) => ({ ...current, totalCapital: Number(event.target.value) || 0 }))} />
              </Field>
              <Field label="首笔价格">
                <NumberInput step="0.01" value={state.basePrice} onChange={(event) => setState((current) => ({ ...current, basePrice: Number(event.target.value) || 0 }))} />
              </Field>
              <Field label="再平衡频率" helper="系统将在预定时间检查价格并执行加仓动作。">
                <SelectField options={frequencyOptions} value={state.frequency} onChange={(event) => setState((current) => ({ ...current, frequency: event.target.value }))} />
              </Field>
              <Field label="末层最大跌幅" helper="最后一层会吃满最大跌幅。">
                <NumberInput step="0.01" value={state.maxDrawdown} onChange={(event) => setState((current) => ({ ...current, maxDrawdown: Number(event.target.value) || 0 }))} />
              </Field>
            </div>

            <div className="mt-6 rounded-[24px] border border-slate-200 bg-gradient-to-br from-slate-50 via-white to-indigo-50 p-5">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                <BarChart3 className="h-4 w-4 text-slate-400" />
                回测价格示意
              </div>
              <div className="relative mt-4 h-52 overflow-hidden rounded-[20px] border border-slate-200 bg-white">
                <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="none" viewBox="0 0 100 100">
                  <polyline fill="none" points="0,88 10,84 20,79 30,70 40,62 50,48 60,42 70,28 82,20 100,8" stroke="#4f46e5" strokeWidth="2.6" />
                  <polyline fill="none" points="0,90 12,88 22,84 34,80 46,70 58,58 70,45 82,30 92,18 100,10" stroke="#10b981" strokeDasharray="3 3" strokeWidth="2.2" />
                </svg>
                <div className="absolute bottom-4 left-4 rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white">
                  预期年化 +12.4%
                </div>
                <div className="absolute right-4 top-4 rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">
                  平均成本 {formatCurrency(computed.averageCost)}
                </div>
              </div>
              <p className="mt-4 text-sm leading-6 text-slate-500">
                这张图只是帮助你确认加仓梯度和价格节奏，真实执行仍以各层自动计算结果为准。
              </p>
            </div>
          </Card>

          <Card className="lg:col-span-3">
            <SectionHeading
              eyebrow="Layer Matrix"
              title="目标跌幅加仓点"
              description="每层权重改动都会立即影响目标跌幅、计划金额和预计份额。非首层可直接删除。"
              action={
                <a className={secondaryButtonClass} href={links.addLevel}>
                  <Plus className="h-4 w-4" />
                  新增层级
                </a>
              }
            />

            <div className="mt-6 space-y-4">
              {computed.stages.map((stage, index) => (
                <div key={stage.id} className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-4">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex items-start gap-4">
                      <div className={cx('flex h-11 w-11 items-center justify-center rounded-2xl text-sm font-bold text-white', index === 0 ? 'bg-slate-900' : index === computed.stages.length - 1 ? 'bg-emerald-500' : 'bg-indigo-600')}>
                        {String(index + 1).padStart(2, '0')}
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-slate-900">
                          {index === 0 ? '基准层级' : `目标跌幅 ${formatPercent(stage.drawdown, 2)}`}
                        </div>
                        <div className="mt-1 text-sm text-slate-500">
                          {index === 0 ? '首笔价格固定为基准价' : `自动反推跌幅 ${formatPercent(stage.drawdown, 2)}`}
                        </div>
                      </div>
                    </div>
                    {index > 0 ? (
                      <button className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500" type="button" onClick={() => removeStage(index)}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    ) : null}
                  </div>

                  <div className="mt-5 grid gap-4 xl:grid-cols-3">
                    <Field label="分配权重 (%)">
                      <NumberInput step="1" value={state.weights[index] ?? 0} onChange={(event) => updateWeight(index, event.target.value)} />
                    </Field>
                    <Field label="入场价格 ($)">
                      <NumberInput className="bg-white text-slate-600" readOnly step="0.01" value={round(stage.price, 2)} />
                    </Field>
                    <Field label="计划金额 ($)">
                      <NumberInput className="bg-white text-slate-600" readOnly step="0.01" value={round(stage.amount, 2)} />
                    </Field>
                  </div>

                  <div className="mt-4 flex flex-col gap-2 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
                    <span>权重占比 {formatPercent(stage.weightPercent, 1)}，预计份额 {formatCurrency(stage.shares, '', 3)} 股</span>
                    <span className={cx('font-semibold', index === computed.stages.length - 1 ? 'text-emerald-600' : 'text-slate-700')}>
                      目标价格 {formatCurrency(stage.price)}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between gap-4 text-sm text-slate-500">
                <span>总权重分配</span>
                <strong className="text-slate-900">{formatPercent(computed.totalWeight, 0)}</strong>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-emerald-500" style={{ width: `${Math.max(Math.min(computed.totalWeight, 100), 0)}%` }} />
              </div>
            </div>
          </Card>
        </div>

        <Card className="border-amber-200 bg-amber-50">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-600" />
            <div>
              <div className="font-semibold text-amber-900">风险提示</div>
              <p className="mt-2 text-sm leading-6 text-amber-800">
                当前权重变化会同步重算目标跌幅和入场价格。建议保留现金缓冲，并在极端波动下复核最大跌幅设置。
              </p>
            </div>
          </div>
        </Card>
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200 bg-white/85 p-4 shadow-[0_-4px_24px_rgba(15,23,42,0.04)] backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-6 text-sm text-slate-500">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">平均成本</div>
              <div className="mt-1 text-sm font-extrabold text-slate-900">{formatCurrency(computed.averageCost)}</div>
            </div>
            <div className="hidden h-8 w-px bg-slate-200 sm:block" />
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">总权重</div>
              <div className="mt-1 text-sm font-extrabold text-slate-900">{formatPercent(computed.totalWeight, 0)}</div>
            </div>
          </div>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <a className={cx(secondaryButtonClass, 'w-full sm:w-auto')} href={links.home}>取消</a>
            <a className={cx(primaryButtonClass, 'w-full sm:w-auto')} href={links.home}>
              <Save className="h-4 w-4" />
              保存方案
              <ArrowRight className="h-4 w-4" />
            </a>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
