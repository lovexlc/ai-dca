import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, BarChart3, Plus, Save, Trash2 } from 'lucide-react';
import { buildStages, formatCurrency, formatPercent, persistAccumulationState, readAccumulationState, round } from '../app/accumulation.js';
import { showActionToast } from '../app/toast.js';
import { Card, Field, NumberInput, PageHero, PageShell, Pill, SectionHeading, SelectField, StatCard, cx, primaryButtonClass, secondaryButtonClass } from '../components/experience-ui.jsx';

const frequencyOptions = ['每日', '每周', '每月', '每季'];

const LEVEL_TONES = [
  { bg: 'bg-slate-900', bar: 'from-slate-700 to-slate-900' },
  { bg: 'bg-indigo-600', bar: 'from-indigo-400 to-indigo-600' },
  { bg: 'bg-blue-600', bar: 'from-blue-400 to-blue-600' },
  { bg: 'bg-sky-600', bar: 'from-sky-400 to-sky-600' },
  { bg: 'bg-teal-600', bar: 'from-teal-400 to-teal-600' },
  { bg: 'bg-emerald-600', bar: 'from-emerald-400 to-emerald-600' }
];

function toneFor(index, total) {
  if (index === 0) return LEVEL_TONES[0];
  if (index === total - 1) return LEVEL_TONES[LEVEL_TONES.length - 1];
  return LEVEL_TONES[Math.min(index, LEVEL_TONES.length - 2)];
}

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

  function handleSavePlan() {
    showActionToast('保存方案', 'success', {
      description: '当前加仓配置已保存，正在返回首页。',
      persist: true
    });
    window.location.href = links.home;
  }

  return (
    <PageShell>
      <PageHero
        backHref={links.home}
        backLabel="返回加仓计划"
        eyebrow="加仓配置"
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

      <div className="mx-auto max-w-5xl space-y-6 px-6 pt-8 pb-28">
        {/* ① 参数条：4 个输入 + 2 个 StatChip，紧凑横向 */}
        <Card className="overflow-hidden">
          <SectionHeading
            eyebrow="基础参数"
            title="基本参数设置"
            description="确认可投入预算、首笔价格和末层跌幅，系统据此反推每层的目标价与计划金额。"
          />
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="初始投资额 ($)">
              <NumberInput step="0.01" value={state.totalCapital} onChange={(event) => setState((current) => ({ ...current, totalCapital: Number(event.target.value) || 0 }))} />
            </Field>
            <Field label="首笔价格 ($)">
              <NumberInput step="0.01" value={state.basePrice} onChange={(event) => setState((current) => ({ ...current, basePrice: Number(event.target.value) || 0 }))} />
            </Field>
            <Field label="末层最大跌幅 (%)">
              <NumberInput step="0.01" value={state.maxDrawdown} onChange={(event) => setState((current) => ({ ...current, maxDrawdown: Number(event.target.value) || 0 }))} />
            </Field>
            <Field label="再平衡频率">
              <SelectField options={frequencyOptions} value={state.frequency} onChange={(event) => setState((current) => ({ ...current, frequency: event.target.value }))} />
            </Field>
          </div>

          {/* 内嵌 StatChips：实时联动结果，不再需要顶部额外 4 张 StatCard */}
          <div className="mt-5 grid gap-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatChip label="平均成本" value={formatCurrency(computed.averageCost)} tone="indigo" />
            <StatChip label="总份额" value={`${formatCurrency(computed.totalShares, '', 3)} 股`} />
            <StatChip label="总权重" value={formatPercent(computed.totalWeight, 0)} tone={computed.totalWeight === 100 ? 'emerald' : 'amber'} />
            <StatChip label="层数" value={`${computed.stages.length} 层`} />
          </div>
        </Card>

        {/* ② 层级矩阵：全宽表格 + 可编辑权重 + 横向比例条，主角。 */}
        <Card>
          <SectionHeading
            eyebrow="层级矩阵"
            title="目标跌幅加仓点"
            description="直接编辑各层权重，入场价、计划金额、预计份额会实时反推。首层为基准层不可删除。"
            action={
              <a className={secondaryButtonClass} href={links.addLevel}>
                <Plus className="h-4 w-4" />
                新增层级
              </a>
            }
          />

          {/* 表头 —— 仅在 md+ 显示，手机小屏自动用卡片布局 */}
          <div className="mt-6 hidden md:grid md:grid-cols-[64px_1fr_1fr_1fr_1fr_1fr_48px] gap-3 px-3 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">
            <div>层级</div>
            <div>目标跌幅</div>
            <div>权重 %</div>
            <div>入场价</div>
            <div>计划金额</div>
            <div>预计份额</div>
            <div></div>
          </div>

          <div className="mt-3 space-y-2">
            {computed.stages.map((stage, index) => {
              const tone = toneFor(index, computed.stages.length);
              const isBase = index === 0;
              const isLast = index === computed.stages.length - 1;
              const pct = Math.max(Math.min(stage.weightPercent, 100), 0);
              return (
                <div key={stage.id} className="rounded-2xl border border-slate-200 bg-white transition-colors hover:border-indigo-200">
                  {/* md+ 表格行 */}
                  <div className="hidden md:grid md:grid-cols-[64px_1fr_1fr_1fr_1fr_1fr_48px] gap-3 items-center p-3">
                    <div className="flex items-center gap-2">
                      <div className={cx('flex h-9 w-9 items-center justify-center rounded-xl text-xs font-bold text-white', tone.bg)}>
                        {String(index + 1).padStart(2, '0')}
                      </div>
                    </div>
                    <div className="text-sm">
                      <div className={cx('font-semibold', isLast ? 'text-emerald-600' : 'text-slate-900')}>
                        {isBase ? '基准层' : formatPercent(stage.drawdown, 2)}
                      </div>
                      <div className="mt-0.5 text-xs text-slate-400">{isBase ? '首笔价' : isLast ? '末层 · 吃满跌幅' : '自动反推'}</div>
                    </div>
                    <div>
                      <NumberInput className="h-9 text-sm" step="1" value={state.weights[index] ?? 0} onChange={(event) => updateWeight(index, event.target.value)} />
                    </div>
                    <div className="text-sm font-semibold text-slate-700">{formatCurrency(stage.price)}</div>
                    <div className="text-sm font-semibold text-slate-700">{formatCurrency(stage.amount)}</div>
                    <div className="text-sm text-slate-500">{formatCurrency(stage.shares, '', 3)} 股</div>
                    <div className="flex justify-end">
                      {!isBase ? (
                        <button className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-300 transition-colors hover:bg-red-50 hover:text-red-500" type="button" onClick={() => removeStage(index)}>
                          <Trash2 className="h-4 w-4" />
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {/* md+ 权重横条 */}
                  <div className="hidden md:block px-3 pb-3">
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div className={cx('h-full rounded-full bg-gradient-to-r', tone.bar)} style={{ width: `${pct}%` }} />
                    </div>
                  </div>

                  {/* 移动端卡片布局 */}
                  <div className="md:hidden p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={cx('flex h-10 w-10 items-center justify-center rounded-xl text-sm font-bold text-white', tone.bg)}>{String(index + 1).padStart(2, '0')}</div>
                        <div>
                          <div className={cx('text-sm font-semibold', isLast ? 'text-emerald-600' : 'text-slate-900')}>
                            {isBase ? '基准层' : `跌幅 ${formatPercent(stage.drawdown, 2)}`}
                          </div>
                          <div className="mt-0.5 text-xs text-slate-400">入场价 {formatCurrency(stage.price)}</div>
                        </div>
                      </div>
                      {!isBase ? (
                        <button className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-300 transition-colors hover:bg-red-50 hover:text-red-500" type="button" onClick={() => removeStage(index)}>
                          <Trash2 className="h-4 w-4" />
                        </button>
                      ) : null}
                    </div>
                    <div className="mt-3 grid gap-3 grid-cols-2">
                      <Field label="权重 (%)">
                        <NumberInput step="1" value={state.weights[index] ?? 0} onChange={(event) => updateWeight(index, event.target.value)} />
                      </Field>
                      <div className="space-y-1">
                        <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">计划金额</div>
                        <div className="text-sm font-semibold text-slate-900">{formatCurrency(stage.amount)}</div>
                        <div className="text-xs text-slate-500">{formatCurrency(stage.shares, '', 3)} 股</div>
                      </div>
                    </div>
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div className={cx('h-full rounded-full bg-gradient-to-r', tone.bar)} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* 总权重汇总条 */}
          <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">总权重分配</div>
              <div className="mt-1 flex items-baseline gap-2">
                <strong className={cx('text-2xl font-extrabold', computed.totalWeight === 100 ? 'text-emerald-600' : 'text-slate-900')}>{formatPercent(computed.totalWeight, 0)}</strong>
                {computed.totalWeight !== 100 ? (
                  <span className="text-xs text-amber-600">建议调至 100%</span>
                ) : null}
              </div>
            </div>
            <div className="min-w-[180px] flex-1 sm:max-w-xs">
              <div className="h-2 overflow-hidden rounded-full bg-white">
                <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-emerald-500" style={{ width: `${Math.max(Math.min(computed.totalWeight, 100), 0)}%` }} />
              </div>
            </div>
          </div>
        </Card>

        {/* ③ 回测图：全宽 + 更高，SVG 加网格线 */}
        <Card>
          <SectionHeading
            eyebrow="回测示意"
            title="价格与平均成本曲线"
            description="两条曲线分别代表预设情境下的市场价与加仓后的平均成本走势，仅作模拟参考。"
            action={
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                <BarChart3 className="h-3.5 w-3.5" />模拟
              </span>
            }
          />
          <div className="mt-5 rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 via-white to-indigo-50 p-5">
            <div className="relative h-80 overflow-hidden rounded-xl border border-slate-200 bg-white">
              {/* 网格 */}
              <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="none" viewBox="0 0 100 100">
                <g stroke="#e2e8f0" strokeWidth="0.3">
                  <line x1="0" y1="25" x2="100" y2="25" />
                  <line x1="0" y1="50" x2="100" y2="50" />
                  <line x1="0" y1="75" x2="100" y2="75" />
                  <line x1="25" y1="0" x2="25" y2="100" />
                  <line x1="50" y1="0" x2="50" y2="100" />
                  <line x1="75" y1="0" x2="75" y2="100" />
                </g>
                <polyline fill="none" points="0,88 10,84 20,79 30,70 40,62 50,48 60,42 70,28 82,20 100,8" stroke="#4f46e5" strokeWidth="1.8" />
                <polyline fill="none" points="0,90 12,88 22,84 34,80 46,70 58,58 70,45 82,30 92,18 100,10" stroke="#10b981" strokeDasharray="2 2" strokeWidth="1.6" />
              </svg>
              <div className="absolute bottom-4 left-4 rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white shadow">
                预期年化 +12.4%
              </div>
              <div className="absolute top-4 right-4 rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700 ring-1 ring-indigo-100">
                平均成本 {formatCurrency(computed.averageCost)}
              </div>
              <div className="absolute top-4 left-4 flex items-center gap-3 text-xs">
                <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 bg-indigo-600" />市价</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 border-b border-dashed border-emerald-500" />成本</span>
              </div>
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-500">
              这张图只是帮助你确认加仓梯度和价格节奏，真实执行仍以各层自动计算结果为准。
            </p>
          </div>
        </Card>

        {/* ④ 风险提示 */}
        <Card className="border-amber-200 bg-amber-50">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-600" />
            <div>
              <div className="font-semibold text-amber-900">风险提示</div>
              <p className="mt-2 text-sm leading-6 text-amber-800">
                权重变化会同步重算目标跌幅和入场价格。建议保留现金缓冲，并在极端波动下复核末层最大跌幅设置。
              </p>
            </div>
          </div>
        </Card>
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200 bg-white/85 p-4 shadow-[0_-4px_24px_rgba(15,23,42,0.04)] backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
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
            <button className={cx(primaryButtonClass, 'w-full sm:w-auto')} type="button" onClick={handleSavePlan}>
              <Save className="h-4 w-4" />
              保存方案
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </PageShell>
  );
}

function StatChip({ label, value, tone = 'slate' }) {
  const toneMap = {
    slate: 'text-slate-900',
    indigo: 'text-indigo-600',
    emerald: 'text-emerald-600',
    amber: 'text-amber-600'
  };
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">{label}</div>
      <div className={cx('mt-1 text-lg font-extrabold', toneMap[tone] || toneMap.slate)}>{value}</div>
    </div>
  );
}
