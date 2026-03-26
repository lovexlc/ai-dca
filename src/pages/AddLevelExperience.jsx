import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, Plus, Save } from 'lucide-react';
import { buildStages, formatCurrency, formatPercent, persistAccumulationState, readAccumulationState, round } from '../app/accumulation.js';
import { Card, Field, NumberInput, PageHero, PageShell, Pill, SectionHeading, cx, primaryButtonClass, secondaryButtonClass } from '../components/experience-ui.jsx';

export function AddLevelExperience({ links }) {
  const [baseState, setBaseState] = useState(() => readAccumulationState());
  const [newWeight, setNewWeight] = useState(5);
  const [newDrawdown, setNewDrawdown] = useState(round(baseState.maxDrawdown + 1.5, 2));
  const [saved, setSaved] = useState(false);

  const previewState = useMemo(() => ({
    ...baseState,
    weights: [...baseState.weights, Math.max(Number(newWeight) || 0, 0)],
    maxDrawdown: Math.max(Number(newDrawdown) || 0, 0)
  }), [baseState, newWeight, newDrawdown]);

  const preview = useMemo(() => buildStages(previewState), [previewState]);
  const addedStage = preview.stages[preview.stages.length - 1];

  function handleApply() {
    const nextState = {
      ...baseState,
      weights: [...baseState.weights, Math.max(Number(newWeight) || 0, 0)],
      maxDrawdown: Math.max(Number(newDrawdown) || 0, 0)
    };
    const computed = buildStages(nextState);
    persistAccumulationState(nextState, computed);
    setBaseState(nextState);
    setSaved(true);
    setNewWeight(5);
    setNewDrawdown(round(nextState.maxDrawdown + 1.5, 2));
  }

  return (
    <PageShell>
      <PageHero
        backHref={links.accumEdit}
        backLabel="返回加仓配置"
        eyebrow="Add One More Layer"
        title="新增加仓层级"
        description="在当前金字塔模型上追加一层新的价格区间，系统会实时计算新增预算、总跌幅和新的平均成本。"
        badges={[
          <Pill key="layer" tone="indigo">新增后共 {preview.stages.length} 层</Pill>,
          <Pill key="drawdown" tone="slate">累计跌幅 {formatPercent(previewState.maxDrawdown, 2)}</Pill>
        ]}
      />

      <div className="mx-auto max-w-6xl space-y-6 px-6 pt-8">
        <div className="grid gap-6 lg:grid-cols-5">
          <Card className="lg:col-span-3">
            <SectionHeading
              eyebrow="Layer Inputs"
              title="层级参数设置"
              description="新增层级通常放在最深一层，所以只需要确认新的权重和更深的累计跌幅。"
              action={saved ? (
                <Pill tone="emerald">
                  <CheckCircle2 className="h-4 w-4" />
                  已保存
                </Pill>
              ) : null}
            />

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <Field label="新增权重 (%)" helper="新增层级会参与总权重重新分配。">
                <NumberInput step="1" value={newWeight} onChange={(event) => setNewWeight(Number(event.target.value) || 0)} />
              </Field>
              <Field label="最大跌幅 (%)" helper="新增层级会成为新的最深层。">
                <NumberInput step="0.5" value={newDrawdown} onChange={(event) => setNewDrawdown(Number(event.target.value) || 0)} />
              </Field>
            </div>

            <div className="mt-6 rounded-[24px] border border-indigo-100 bg-gradient-to-br from-indigo-50 via-white to-white p-5">
              <div className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-500">预估追加资金</div>
              <div className="mt-2 text-3xl font-extrabold tracking-tight text-indigo-700">{formatCurrency(addedStage?.amount ?? 0, '¥ ')}</div>
              <p className="mt-3 text-sm leading-6 text-slate-500">系统会依据总预算和新增权重自动计算该层可分配的资金规模。</p>
            </div>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <button className={cx(primaryButtonClass, 'w-full sm:w-auto')} type="button" onClick={handleApply}>
                <Save className="h-4 w-4" />
                保存并增加层级
                <ArrowRight className="h-4 w-4" />
              </button>
              <a className={cx(secondaryButtonClass, 'w-full sm:w-auto')} href={links.accumEdit}>取消</a>
            </div>

            {saved ? (
              <div className="mt-5 rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-700">
                新层级已经写回本地状态，返回加仓配置页即可看到新增结果。
              </div>
            ) : null}
          </Card>

          <div className="space-y-6 lg:col-span-2">
            <Card>
              <SectionHeading eyebrow="Preview" title="新增层级预览" />
              <div className="mt-6 flex min-h-[180px] items-end justify-center gap-3 rounded-[24px] border border-slate-200 bg-slate-50 p-5">
                {preview.stages.map((stage, index) => (
                  <div key={stage.id} className="flex w-14 flex-col items-center gap-3">
                    <div className={cx('flex w-full items-end justify-center rounded-t-2xl px-2 py-3 text-xs font-bold text-white', index === preview.stages.length - 1 ? 'bg-emerald-500' : 'bg-indigo-600')} style={{ height: `${32 + index * 18}px` }}>
                      {index + 1}
                    </div>
                    <span className="text-[11px] font-semibold text-slate-400">阶段 {index + 1}</span>
                  </div>
                ))}
              </div>

              <div className="mt-5 space-y-3 text-sm">
                <div className="flex items-center justify-between text-slate-500">
                  <span>追加预算占比</span>
                  <strong className="text-slate-900">{formatPercent(addedStage?.weightPercent ?? 0, 1)}</strong>
                </div>
                <div className="flex items-center justify-between text-slate-500">
                  <span>大盘预计跌幅</span>
                  <strong className="text-slate-900">{formatPercent(previewState.maxDrawdown, 2)}</strong>
                </div>
                <div className="flex items-center justify-between text-slate-500">
                  <span>预估平均成本</span>
                  <strong className="text-slate-900">{formatCurrency(preview.averageCost, '¥ ')}</strong>
                </div>
              </div>
            </Card>

            <Card>
              <SectionHeading eyebrow="Cash Impact" title="预算与现金变化" />
              <div className="mt-5 space-y-3 text-sm">
                <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-slate-500">
                  <span>计划追加金额</span>
                  <strong className="text-slate-900">{formatCurrency(addedStage?.amount ?? 0, '¥ ')}</strong>
                </div>
                <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-slate-500">
                  <span>本次预留现金变化</span>
                  <strong className="text-slate-900">{formatCurrency(baseState.totalCapital - preview.investedCapital, '¥ ')}</strong>
                </div>
                <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-slate-500">
                  <span>剩余预留现金</span>
                  <strong className="text-slate-900">{formatCurrency(Math.max(baseState.totalCapital - preview.investedCapital, 0), '¥ ')}</strong>
                </div>
              </div>
            </Card>

            <Card className="border-amber-200 bg-amber-50">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-600" />
                <div>
                  <div className="font-semibold text-amber-900">风险提示</div>
                  <p className="mt-2 text-sm leading-6 text-amber-800">
                    新增层级会改变整体累计跌幅分布。若市场发生快速波动，请复核最大跌幅和剩余现金缓冲，避免过早耗尽预算。
                  </p>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
