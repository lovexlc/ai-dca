import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Calendar, Clock3, Save, Target, TrendingUp, Wallet } from 'lucide-react';
import { formatCurrency, formatPercent } from '../app/accumulation.js';
import { buildDcaProjection, frequencyOptions, persistDcaState, readDcaState } from '../app/dca.js';
import { getPrimaryTabs } from '../app/screens.js';
import { Card, Field, NumberInput, PageHero, PageShell, PageTabs, Pill, SectionHeading, StatCard, TextInput, cx, primaryButtonClass, secondaryButtonClass } from '../components/experience-ui.jsx';

const DAY_OPTIONS = [1, 8, 15, 28];

export function DcaExperience({ links }) {
  const [state, setState] = useState(() => readDcaState());
  const projection = useMemo(() => buildDcaProjection(state), [state]);
  const primaryTabs = getPrimaryTabs(links);

  useEffect(() => {
    persistDcaState(state, projection);
  }, [state, projection]);

  return (
    <PageShell>
      <PageHero
        backHref={links.home}
        backLabel="返回策略总览"
        eyebrow="Dollar Cost Averaging"
        title="定投计划"
        description="围绕初始投入、定投金额和执行频率建立更克制的长期买入节奏，让固定现金流可以直接映射到可执行的买入日程。"
        badges={[
          <Pill key="cadence" tone="indigo">{projection.cadenceLabel}</Pill>,
          <Pill key="count" tone="slate">{projection.executionCount} 次执行</Pill>
        ]}
      >
        <PageTabs activeKey="dca" tabs={primaryTabs} />
      </PageHero>

      <div className="mx-auto max-w-6xl space-y-6 px-6 pt-8">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard accent="indigo" eyebrow="Total Investment" value={formatCurrency(projection.totalInvestment, '¥ ')} note="初始投入加上所有周期定投之和" />
          <StatCard eyebrow="Expected Return" value={formatCurrency(projection.totalInvestment * state.targetReturn / 100, '¥ ')} note={`按目标收益 ${formatPercent(state.targetReturn, 0)} 估算`} />
          <StatCard eyebrow="Monthly Equivalent" value={formatCurrency(projection.monthlyEquivalent, '¥ ')} note="折算后的月度平均投入强度" />
          <StatCard accent="emerald" eyebrow="Execution Rhythm" value={`${state.frequency} / ${state.executionDay}`} note="频率与执行日期共同决定节奏" />
        </div>

        <div className="grid gap-6 lg:grid-cols-5">
          <Card className="lg:col-span-3">
            <SectionHeading
              eyebrow="Plan Inputs"
              title="策略参数设置"
              description="把标的、买入频率和执行日整理成一个完整模板，后续只需要微调金额即可复用。"
            />

            <div className="mt-6 space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="初始投资额">
                  <NumberInput step="0.01" value={state.initialInvestment} onChange={(event) => setState((current) => ({ ...current, initialInvestment: Number(event.target.value) || 0 }))} />
                </Field>
                <Field label="定期投资额">
                  <NumberInput step="0.01" value={state.recurringInvestment} onChange={(event) => setState((current) => ({ ...current, recurringInvestment: Number(event.target.value) || 0 }))} />
                </Field>
              </div>

              <Field label="标的代码" helper="建议使用交易代码，便于与首页和历史页保持一致。">
                <TextInput value={state.symbol} onChange={(event) => setState((current) => ({ ...current, symbol: event.target.value || 'QQQ' }))} placeholder="例如 QQQ" />
              </Field>

              <Field label="买入频率" helper="选择更长期的频率会显著减少执行次数。">
                <div className="grid gap-2 md:grid-cols-4">
                  {frequencyOptions.map((option) => (
                    <button
                      key={option}
                      className={cx('rounded-xl border px-4 py-3 text-sm font-semibold transition-all', state.frequency === option ? 'border-indigo-200 bg-indigo-50 text-indigo-700 shadow-sm' : 'border-slate-200 bg-slate-50 text-slate-500 hover:bg-white')}
                      type="button"
                      onClick={() => setState((current) => ({ ...current, frequency: option }))}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </Field>

              <Field label="执行日期" helper="每日模式会把该值解释为交易日序号。">
                <div className="grid gap-2 md:grid-cols-4">
                  {DAY_OPTIONS.map((day) => (
                    <button
                      key={day}
                      className={cx('rounded-xl border px-4 py-3 text-sm font-semibold transition-all', state.executionDay === day ? 'border-indigo-200 bg-white text-indigo-700 shadow-sm' : 'border-slate-200 bg-slate-50 text-slate-500 hover:bg-white')}
                      type="button"
                      onClick={() => setState((current) => ({ ...current, executionDay: day }))}
                    >
                      每月 {day} 号
                    </button>
                  ))}
                </div>
              </Field>

              <div className="grid gap-4 md:grid-cols-2">
                <Field label="投资周期 (月)">
                  <NumberInput step="1" value={state.termMonths} onChange={(event) => setState((current) => ({ ...current, termMonths: Number(event.target.value) || 1 }))} />
                </Field>
                <Field label="目标收益">
                  <NumberInput step="1" value={state.targetReturn} onChange={(event) => setState((current) => ({ ...current, targetReturn: Number(event.target.value) || 0 }))} />
                </Field>
              </div>
            </div>
          </Card>

          <div className="space-y-6 lg:col-span-2">
            <Card className="border-indigo-100 bg-gradient-to-br from-indigo-50 via-white to-white">
              <SectionHeading eyebrow="Capital Summary" title="策略资金概览" />
              <div className="mt-6 rounded-[24px] border border-indigo-100 bg-white/90 p-5 shadow-sm">
                <div className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-500">总投入</div>
                <div className="mt-2 text-3xl font-extrabold tracking-tight text-indigo-700">{formatCurrency(projection.totalInvestment, '¥ ')}</div>
                <p className="mt-3 text-sm leading-6 text-slate-500">总投资额 = 初始投资额 + 定期投资额 × 执行次数</p>
              </div>
              <div className="mt-4 grid gap-3">
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <TrendingUp className="h-4 w-4 text-slate-400" />
                    预计收益
                  </div>
                  <div className="mt-2 text-xl font-bold text-emerald-600">{formatCurrency(projection.totalInvestment * state.targetReturn / 100, '¥ ')}</div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <Wallet className="h-4 w-4 text-slate-400" />
                    月均投入
                  </div>
                  <div className="mt-2 text-xl font-bold text-slate-900">{formatCurrency(projection.monthlyEquivalent, '¥ ')}</div>
                </div>
              </div>
            </Card>

            <Card>
              <SectionHeading eyebrow="Execution Sequence" title="前六次定投预览" />
              <div className="mt-5 space-y-3">
                {projection.schedule.map((row) => (
                  <div key={row.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <div className="font-semibold text-slate-900">{row.label}</div>
                        <div className="mt-1 text-sm text-slate-500">{row.note}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-semibold text-slate-900">{formatCurrency(row.cumulative, '¥ ')}</div>
                        <div className="mt-1 text-xs text-slate-400">单次投入 {formatCurrency(row.contribution, '¥ ')}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <Card>
              <SectionHeading eyebrow="Execution Notes" title="策略提醒" />
              <div className="mt-5 space-y-4">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <Calendar className="h-4 w-4 text-slate-400" />
                    节奏说明
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-500">{projection.cadenceLabel}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <Clock3 className="h-4 w-4 text-slate-400" />
                    风险偏好
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-500">目标收益越高，意味着你需要接受更高波动与更长持有周期。</p>
                </div>
                <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
                    <Target className="h-4 w-4" />
                    当前目标
                  </div>
                  <p className="mt-2 text-sm leading-6 text-emerald-700">计划在 {state.termMonths} 个月内，用 {state.frequency} 节奏累积 {state.symbol} 持仓。</p>
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
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">总投资额</div>
              <div className="mt-1 text-sm font-extrabold text-slate-900">{formatCurrency(projection.totalInvestment, '¥ ')}</div>
            </div>
            <div className="hidden h-8 w-px bg-slate-200 sm:block" />
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">执行次数</div>
              <div className="mt-1 text-sm font-extrabold text-slate-900">{projection.executionCount}</div>
            </div>
          </div>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <a className={cx(secondaryButtonClass, 'w-full sm:w-auto')} href={links.home}>取消</a>
            <a className={cx(primaryButtonClass, 'w-full sm:w-auto')} href={links.home}>
              <Save className="h-4 w-4" />
              保存并开始策略
              <ArrowRight className="h-4 w-4" />
            </a>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
