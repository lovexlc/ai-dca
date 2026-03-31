import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Calendar, Clock3, Layers3, Save, Target, TrendingUp, Wallet } from 'lucide-react';
import { formatCurrency, formatPercent } from '../app/accumulation.js';
import { buildDcaProjection, frequencyOptions, persistDcaState, readDcaState } from '../app/dca.js';
import { syncTradePlanRules } from '../app/notifySync.js';
import { readPlanList } from '../app/plan.js';
import { getPrimaryTabs } from '../app/screens.js';
import { Card, Field, NumberInput, PageHero, PageShell, PageTabs, Pill, SectionHeading, SelectField, StatCard, TextInput, cx, primaryButtonClass, secondaryButtonClass } from '../components/experience-ui.jsx';

const DAY_OPTIONS = [1, 8, 15, 28];

export function DcaExperience({ links, embedded = false }) {
  const [state, setState] = useState(() => readDcaState());
  const [planList] = useState(() => readPlanList());
  const [isSaving, setIsSaving] = useState(false);
  const projection = useMemo(() => buildDcaProjection(state, { planList }), [planList, state]);
  const primaryTabs = getPrimaryTabs(links);
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
    persistDcaState(state, projection);
  }, [state, projection]);

  async function handleSave() {
    if (isSaving) {
      return;
    }

    setIsSaving(true);
    persistDcaState(state, projection);

    try {
      await syncTradePlanRules();
    } catch (_error) {
      // Keep the local plan saved even if notification sync is unavailable.
    } finally {
      window.location.href = links.home;
    }
  }

  function handleLinkedPlanChange(nextPlanId = '') {
    const targetPlan = planList.find((plan) => plan.id === nextPlanId) || null;
    setState((current) => ({
      ...current,
      linkedPlanId: nextPlanId,
      symbol: targetPlan?.symbol || current.symbol
    }));
  }

  const content = (
    <>
      <div className={cx('mx-auto max-w-6xl space-y-6', embedded ? 'px-4 pt-6 sm:px-6 sm:pt-8' : 'px-6 pt-8')}>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard accent="indigo" eyebrow="总投入" value={formatCurrency(projection.totalInvestment, '¥ ')} note={projection.isLinkedPlan ? `每个执行周期都投入 ${formatCurrency(projection.recurringInvestment, '¥ ')}，并按「${projection.linkedPlanName}」在周期内分批执行。` : '初始投入加上所有周期定投之和'} />
          <StatCard eyebrow="预估收益" value={formatCurrency(projection.totalInvestment * state.targetReturn / 100, '¥ ')} note={`按目标收益 ${formatPercent(state.targetReturn, 0)} 估算`} />
          <StatCard eyebrow="月均投入" value={formatCurrency(projection.monthlyEquivalent, '¥ ')} note="折算后的月度平均投入强度" />
          <StatCard accent="emerald" eyebrow="执行节奏" value={`${state.frequency} / ${state.executionDay}`} note="频率与执行日期共同决定节奏" />
        </div>

        <div className="grid gap-6 lg:grid-cols-5">
          <Card className="lg:col-span-3">
            <SectionHeading
              eyebrow="计划参数"
              title="策略参数设置"
              description="把标的、买入频率和执行日整理成一个完整模板；如果关联加仓策略，每个执行周期的总预算会按该策略拆成多笔。"
            />

            <div className="mt-6 space-y-5">
              {projection.isLinkedPlan ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="单周期投入总额" helper={`这个预算会按「${projection.linkedPlanName}」的层级权重拆成多笔，周期总额保持不变。`}>
                    <NumberInput step="0.01" value={state.recurringInvestment} onChange={(event) => setState((current) => ({ ...current, recurringInvestment: event.target.value }))} />
                  </Field>
                  <Field label="预计首批金额" helper="按当前关联策略折算后的第一笔预算。">
                    <NumberInput className="bg-white text-slate-600" readOnly step="0.01" value={projection.linkedPlanFirstInvestment} />
                  </Field>
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="初始投资额" helper="策略启动时可额外安排一笔首投。">
                    <NumberInput step="0.01" value={state.initialInvestment} onChange={(event) => setState((current) => ({ ...current, initialInvestment: event.target.value }))} />
                  </Field>
                  <Field label="定期投资额">
                    <NumberInput step="0.01" value={state.recurringInvestment} onChange={(event) => setState((current) => ({ ...current, recurringInvestment: event.target.value }))} />
                  </Field>
                </div>
              )}

              <Field label="关联加仓策略" helper={planList.length ? '选中后，单周期预算会按该策略的批次和触发条件在周期内分笔投入。' : '当前还没有已创建的加仓策略，可先到“加仓计划”页新建。'}>
                <SelectField options={linkedPlanOptions} value={state.linkedPlanId || ''} onChange={(event) => handleLinkedPlanChange(event.target.value)} />
              </Field>

              <Field label="标的代码" helper={projection.isLinkedPlan ? '已跟随所选加仓策略标的；如需修改，请先取消关联。' : '建议使用交易代码，便于与首页和历史页保持一致。'}>
                <TextInput className={projection.isLinkedPlan ? 'bg-white text-slate-600' : ''} readOnly={projection.isLinkedPlan} value={projection.effectiveSymbol} onChange={(event) => setState((current) => ({ ...current, symbol: event.target.value }))} placeholder="例如：纳指基金代码" />
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
                  <NumberInput step="1" value={state.termMonths} onChange={(event) => setState((current) => ({ ...current, termMonths: event.target.value }))} />
                </Field>
                <Field label="目标收益">
                  <NumberInput step="1" value={state.targetReturn} onChange={(event) => setState((current) => ({ ...current, targetReturn: event.target.value }))} />
                </Field>
              </div>
            </div>
          </Card>

          <div className="space-y-6 lg:col-span-2">
            <Card className="border-indigo-100 bg-gradient-to-br from-indigo-50 via-white to-white">
              <SectionHeading eyebrow="资金概览" title="策略资金概览" />
              <div className="mt-6 rounded-[24px] border border-indigo-100 bg-white/90 p-5 shadow-sm">
                <div className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-500">总投入</div>
                <div className="mt-2 text-3xl font-extrabold tracking-tight text-indigo-700">{formatCurrency(projection.totalInvestment, '¥ ')}</div>
                <p className="mt-3 text-sm leading-6 text-slate-500">{projection.isLinkedPlan ? '总投资额 = 单周期投入总额 × 执行周期数；每个周期内再按关联策略拆成多笔。' : '总投资额 = 初始投资额 + 定期投资额 × 执行次数'}</p>
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

            {projection.isLinkedPlan ? (
              <Card className="border-emerald-100 bg-emerald-50">
                <SectionHeading eyebrow="加仓联动" title="已关联分批策略" />
                <div className="mt-5 rounded-2xl border border-emerald-100 bg-white/80 p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
                    <Layers3 className="h-4 w-4" />
                    {projection.linkedPlanName}
                  </div>
                  <div className="mt-2 text-xl font-bold text-slate-900">{formatCurrency(projection.recurringInvestment, '¥ ')}</div>
                  <p className="mt-2 text-sm leading-6 text-slate-600">每个执行周期总投入保持不变，并按该策略的批次权重和触发条件在周期内分批执行。</p>
                  <div className="mt-4 space-y-2">
                    {projection.linkedPlanSplit.map((item) => (
                      <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl border border-emerald-100 bg-emerald-50/60 px-3 py-2 text-sm">
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-800">{item.label}</div>
                          <div className="text-xs text-slate-500">{item.drawdown > 0 ? `参考回撤 ${formatPercent(item.drawdown, 1)}` : '首批参考区间'}</div>
                        </div>
                        <div className="shrink-0 font-semibold text-slate-900">{formatCurrency(item.amount, '¥ ')}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </Card>
            ) : null}

            <Card>
              <SectionHeading eyebrow="执行预览" title={projection.isLinkedPlan ? '前六个周期预览' : '前六次执行预览'} />
              <div className="mt-5 space-y-3">
                {projection.schedule.map((row) => (
                  <div key={row.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="font-semibold text-slate-900">{row.label}</div>
                          {row.isLinkedCycle ? <Pill tone="emerald">策略分批</Pill> : null}
                        </div>
                        <div className="mt-1 text-sm text-slate-500">{row.note}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-semibold text-slate-900">{formatCurrency(row.cumulative, '¥ ')}</div>
                        <div className="mt-1 text-xs text-slate-400">{projection.isLinkedPlan ? '本期总投入' : '单次投入'} {formatCurrency(row.contribution, '¥ ')}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <Card>
              <SectionHeading eyebrow="策略提醒" title="策略提醒" />
              <div className="mt-5 space-y-4">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <Calendar className="h-4 w-4 text-slate-400" />
                    节奏说明
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-500">{projection.isLinkedPlan ? `${projection.cadenceLabel}，到达执行日后请前往网页查看该周期的分批投入策略。` : projection.cadenceLabel}</p>
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
                  <p className="mt-2 text-sm leading-6 text-emerald-700">计划在 {state.termMonths} 个月内，用 {state.frequency} 节奏累积 {projection.effectiveSymbol} 持仓。</p>
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
            <button className={cx(primaryButtonClass, 'w-full sm:w-auto')} disabled={isSaving} type="button" onClick={handleSave}>
              <Save className="h-4 w-4" />
              {isSaving ? '正在保存定投' : '保存并开始策略'}
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </>
  );

  if (embedded) {
    return content;
  }

  return (
    <PageShell>
      <PageHero
        backHref={links.home}
        backLabel="返回加仓计划"
        eyebrow="定投计划"
        title="定投计划"
        description="围绕首次买入、定投金额和执行频率建立长期买入节奏；也可以直接关联一条加仓策略，让首个定投日自动套用它的首笔买入额。"
        badges={[
          <Pill key="cadence" tone="indigo">{projection.cadenceLabel}</Pill>,
          <Pill key="count" tone="slate">{projection.executionCount} 次执行</Pill>
        ]}
      >
        <PageTabs activeKey="dca" tabs={primaryTabs} />
      </PageHero>

      {content}
    </PageShell>
  );
}
