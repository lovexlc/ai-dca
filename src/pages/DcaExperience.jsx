import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, Calendar, CheckCircle2, Clock3, Save, Target, Wallet } from 'lucide-react';
import { formatCurrency, formatPercent } from '../app/accumulation.js';
import { buildDcaProjection, defaultDcaState, frequencyOptions, persistDcaState } from '../app/dca.js';
import { syncTradePlanRules } from '../app/notifySync.js';
import { readPlanList } from '../app/plan.js';
import { showToast } from '../app/toast.js';
import { Card, Field, NumberInput, Pill, SectionHeading, SelectField, StatCard, TextInput, cx, primaryButtonClass, secondaryButtonClass } from '../components/experience-ui.jsx';
import { EXTRA_SYMBOL_GROUPS } from '../app/extraSymbols.js';
import { trackActionResult, trackFeatureEvent } from '../app/analytics.js';

const DCA_STEPS = [
  { id: 1, title: '基础信息' },
  { id: 2, title: '投入与联动' },
  { id: 3, title: '预览确认' }
];
const DEFAULT_DAY_OPTIONS = [1, 8, 15, 28];
const CALC_APPLY_KEY = 'aiDcaCalcApply';
const CALC_FREQ_TO_DCA = { weekly: '每周', biweekly: '每周', monthly: '每月' };

function buildInitialDcaState(initialDca = null) {
  if (initialDca?.id) {
    return {
      ...defaultDcaState,
      ...initialDca,
      isConfigured: Boolean(initialDca.isConfigured)
    };
  }

  return {
    ...defaultDcaState,
    ...(initialDca && typeof initialDca === 'object' ? initialDca : {}),
    id: '',
    name: String(initialDca?.name || ''),
    isConfigured: false,
    createdAt: '',
    updatedAt: ''
  };
}

function getExecutionDayOptions(frequency = '每月') {
  if (frequency === '每日') return [1];
  if (frequency === '每周') return [1, 2, 3, 4, 5];
  return DEFAULT_DAY_OPTIONS;
}

function formatExecutionDayOption(frequency = '每月', day = 1) {
  if (frequency === '每日') return '每个交易日';
  if (frequency === '每周') return `周内第 ${day} 个交易日`;
  if (frequency === '每季') return `季度第 ${day} 日`;
  return `每月 ${day} 号`;
}

function buildValidation(state = {}, projection = {}) {
  const blocking = [];
  const warnings = [];
  const symbol = String(projection.effectiveSymbol || state.symbol || '').trim();
  const recurringInvestment = Number(state.recurringInvestment);
  const initialInvestment = Number(state.initialInvestment);
  const termMonths = Number(state.termMonths);
  const executionDay = Number(state.executionDay);
  const targetReturn = Number(state.targetReturn);

  if (!symbol) {
    blocking.push({ step: 1, message: '请填写标的代码。' });
  }
  if (!state.frequency) {
    blocking.push({ step: 1, message: '请选择买入频率。' });
  }
  if (!Number.isFinite(executionDay) || executionDay < 1) {
    blocking.push({ step: 1, message: '请选择有效的执行日期。' });
  }
  if (!Number.isFinite(termMonths) || termMonths < 1) {
    blocking.push({ step: 1, message: '投资周期至少为 1 个月。' });
  }
  if (!Number.isFinite(recurringInvestment) || recurringInvestment <= 0) {
    blocking.push({ step: 2, message: projection.isLinkedPlan ? '请填写单周期投入总额。' : '请填写定期投资额。' });
  }
  if (!projection.isLinkedPlan && (!Number.isFinite(initialInvestment) || initialInvestment < 0)) {
    blocking.push({ step: 2, message: '初始投资额不能为负数。' });
  }

  if (projection.isLinkedPlan && !(Number(state.currentPrice) > 0)) {
    warnings.push('当前价格为空，Smart DCA 会按固定周期金额预览。');
  }
  if (projection.isLinkedPlan && !(Number(state.rollingHigh) > 0)) {
    warnings.push('滚动高点为空时，资金池判断会缺少参考高点。');
  }
  if (Number.isFinite(targetReturn) && targetReturn > 80) {
    warnings.push('目标收益较高，请确认能接受更高波动和更长持有周期。');
  }

  return { blocking, warnings };
}

function DcaStepNav({ currentStep, maxUnlockedStep, onStepChange }) {
  return (
    <nav aria-label="定投计划步骤" className="grid gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:grid-cols-3">
      {DCA_STEPS.map((step) => {
        const locked = step.id > maxUnlockedStep + 1;
        return (
          <button
            key={step.id}
            type="button"
            onClick={() => onStepChange(step.id)}
            aria-current={currentStep === step.id ? 'step' : undefined}
            aria-disabled={locked}
            className={cx(
              'rounded-xl px-3 py-2 text-left text-sm font-semibold transition-colors',
              currentStep === step.id
                ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-200'
                : locked
                  ? 'cursor-not-allowed text-slate-300'
                  : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
            )}
          >
            <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/20 text-xs">{step.id}</span>
            {step.title}
          </button>
        );
      })}
    </nav>
  );
}

function SummaryTile({ label, value, note }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">{label}</div>
      <div className="mt-1 text-sm font-extrabold text-slate-900">{value}</div>
      {note ? <div className="mt-1 text-xs leading-5 text-slate-500">{note}</div> : null}
    </div>
  );
}

// onAfterSave: 当该页被嵌入交易计划二级 tab 时，保存后由父控件接管跳转（避免整页 reload）。
// 未传时保留原行为：保存后跳转到 links.tradePlans。
export function DcaExperience({ links, embedded = false, onAfterSave, onCancel = null, initialDca = null, mode = 'create' }) {
  const isEditing = mode === 'replace' && Boolean(initialDca?.id);
  const [state, setState] = useState(() => buildInitialDcaState(initialDca));
  const [planList] = useState(() => readPlanList());
  const [isSaving, setIsSaving] = useState(false);
  const [dcaStep, setDcaStep] = useState(() => (isEditing ? 2 : 1));
  const [maxUnlockedStep, setMaxUnlockedStep] = useState(() => (isEditing ? 3 : 1));
  const projection = useMemo(() => buildDcaProjection(state, { planList }), [planList, state]);
  const validation = useMemo(() => buildValidation(state, projection), [state, projection]);
  const dayOptions = getExecutionDayOptions(state.frequency);
  const dcaMeta = () => ({
    embedded,
    isEditing,
    step: dcaStep,
    maxUnlockedStep,
    symbolLength: String(state.symbol || '').length,
    frequency: state.frequency,
    executionDay: state.executionDay,
    hasLinkedPlan: Boolean(state.linkedPlanId),
    planCount: planList.length,
    isLinkedPlan: Boolean(projection.isLinkedPlan),
    smartDcaMode: projection.smartDcaMode || '',
    termMonths: Number(state.termMonths) || 0
  });
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
    if (typeof window === 'undefined') return;
    let raw;
    try { raw = window.sessionStorage.getItem(CALC_APPLY_KEY); } catch { return; }
    if (!raw) return;
    try {
      const payload = JSON.parse(raw);
      const mappedFreq = CALC_FREQ_TO_DCA[payload.frequency] || '每周';
      setState((current) => ({
        ...current,
        symbol: payload.symbol || current.symbol,
        frequency: mappedFreq,
        recurringInvestment: String(payload.amount || current.recurringInvestment)
      }));
      setDcaStep(2);
      setMaxUnlockedStep((current) => Math.max(current, 2));
      showToast({
        title: '已从回测计算器填充表单',
        description: `${payload.symbol} · 频率 ${mappedFreq} · 单期 $${payload.amount}。可修改后保存。`,
        tone: 'emerald'
      });
      trackFeatureEvent('dca', 'prefill_from_calculator', {
        symbolLength: String(payload.symbol || '').length,
        mappedFrequency: mappedFreq,
        amountBucket: Number(payload.amount) > 5000 ? 'gt_5000' : Number(payload.amount) > 1000 ? '1000_5000' : 'lte_1000'
      });
    } catch { /* ignore */ }
    try { window.sessionStorage.removeItem(CALC_APPLY_KEY); } catch { /* ignore */ }
  }, []);

  function firstBlockingThrough(step) {
    return validation.blocking.find((item) => item.step <= step) || null;
  }

  function goToDcaStep(nextStep) {
    const target = Math.max(1, Math.min(3, Number(nextStep) || 1));
    if (target > maxUnlockedStep + 1) {
      showToast({ title: '先完成当前步骤', description: '请按顺序确认定投参数。', tone: 'amber' });
      return;
    }
    if (target > dcaStep) {
      const blocking = firstBlockingThrough(dcaStep);
      if (blocking) {
        showToast({ title: '先完善当前步骤', description: blocking.message, tone: 'amber' });
        return;
      }
    }
    setDcaStep(target);
    setMaxUnlockedStep((current) => Math.max(current, target));
    trackFeatureEvent('dca', 'step_select', {
      ...dcaMeta(),
      targetStep: target
    });
  }

  async function handleSave() {
    if (isSaving) {
      return;
    }

    const blocking = validation.blocking[0];
    if (blocking) {
      setDcaStep(blocking.step);
      setMaxUnlockedStep((current) => Math.max(current, blocking.step));
      showToast({ title: '先完善定投计划', description: blocking.message, tone: 'amber' });
      trackActionResult('dca', isEditing ? 'edit_save' : 'save', 'validation_error', {
        ...dcaMeta(),
        reason: blocking.message
      });
      return;
    }

    setIsSaving(true);
    const persisted = persistDcaState(
      { ...state, isConfigured: true },
      projection,
      { mode: isEditing ? 'replace' : 'create', activate: true }
    );
    const startedAt = Date.now();
    trackFeatureEvent('dca', isEditing ? 'edit_save_start' : 'save_start', dcaMeta());

    let syncFailed = false;
    try {
      await syncTradePlanRules();
    } catch {
      syncFailed = true;
    } finally {
      showToast({
        title: isEditing ? '定投计划已更新' : '定投计划已保存',
        description: syncFailed ? '计划已保存，本次提醒规则未同步。' : '计划已保存，提醒规则已同步。',
        tone: syncFailed ? 'amber' : 'emerald',
        persist: true
      });
      trackActionResult('dca', isEditing ? 'edit_save' : 'save', syncFailed ? 'partial' : 'success', {
        ...dcaMeta(),
        syncFailed,
        durationMs: Date.now() - startedAt
      });
      if (typeof onAfterSave === 'function') {
        onAfterSave(persisted);
      } else {
        window.location.href = links.tradePlans;
      }
    }
  }

  function handleLinkedPlanChange(nextPlanId = '') {
    const targetPlan = planList.find((plan) => plan.id === nextPlanId) || null;
    setState((current) => ({
      ...current,
      linkedPlanId: nextPlanId,
      symbol: targetPlan?.symbol || current.symbol,
      rollingHigh: targetPlan ? Number(targetPlan.basePrice) || current.rollingHigh : current.rollingHigh
    }));
    trackFeatureEvent('dca', 'linked_plan_change', {
      linked: Boolean(nextPlanId),
      targetSymbolLength: String(targetPlan?.symbol || '').length,
      planCount: planList.length
    });
  }

  function handleFrequencyChange(nextFrequency) {
    const options = getExecutionDayOptions(nextFrequency);
    setState((current) => ({
      ...current,
      frequency: nextFrequency,
      executionDay: options.includes(Number(current.executionDay)) ? current.executionDay : options[0]
    }));
  }

  function renderCancelControl() {
    if (typeof onCancel === 'function') {
      return <button className={cx(secondaryButtonClass, 'w-full sm:w-auto')} type="button" onClick={onCancel}>取消</button>;
    }
    return <a className={cx(secondaryButtonClass, 'w-full sm:w-auto')} href={links.tradePlans}>取消</a>;
  }

  function renderBasicStep() {
    return (
      <Card>
        <SectionHeading eyebrow="第一步" title="基础信息与执行节奏" />
        <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
          <div className="space-y-5">
            <Field label="计划名称" helper="用于交易计划列表和提醒记录。留空会按标的与频率自动命名。">
              <TextInput value={state.name || ''} onChange={(event) => setState((current) => ({ ...current, name: event.target.value }))} placeholder="例如：QQQ 每周定投" />
            </Field>

            <Field label="标的代码" helper={projection.isLinkedPlan ? '已跟随所选加仓策略标的；如需修改，请在下一步取消关联。' : '建议使用交易代码，便于与首页和历史页保持一致。'}>
              {!projection.isLinkedPlan ? (
                <div className="mb-2 space-y-2">
                  {EXTRA_SYMBOL_GROUPS.map((group) => (
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
                              ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                              : 'border-slate-200 bg-white text-slate-500 hover:border-emerald-200 hover:text-emerald-600'
                          )}
                          title={s.name}
                        >
                          {s.code}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              ) : null}
              <TextInput className={projection.isLinkedPlan ? 'bg-white text-slate-600' : ''} readOnly={projection.isLinkedPlan} value={projection.effectiveSymbol} onChange={(event) => setState((current) => ({ ...current, symbol: event.target.value }))} placeholder="例如：QQQ / SPY / 513100" />
            </Field>

            <Field label="买入频率" helper="选择更长期的频率会显著减少执行次数。">
              <div className="grid gap-2 md:grid-cols-4">
                {frequencyOptions.map((option) => (
                  <button
                    key={option}
                    className={cx('rounded-xl border px-4 py-3 text-sm font-semibold transition-all', state.frequency === option ? 'border-emerald-200 bg-emerald-50 text-emerald-700 shadow-sm' : 'border-slate-200 bg-slate-50 text-slate-500 hover:bg-white')}
                    type="button"
                    onClick={() => handleFrequencyChange(option)}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="执行日期" helper={state.frequency === '每日' ? '每日模式按交易日提醒，不再选择具体日期。' : '不同频率下，该值会按周/月/季度解释。'}>
              <div className="grid gap-2 md:grid-cols-4">
                {dayOptions.map((day) => (
                  <button
                    key={day}
                    className={cx('rounded-xl border px-4 py-3 text-sm font-semibold transition-all', Number(state.executionDay) === day ? 'border-emerald-200 bg-white text-emerald-700 shadow-sm' : 'border-slate-200 bg-slate-50 text-slate-500 hover:bg-white')}
                    type="button"
                    onClick={() => setState((current) => ({ ...current, executionDay: day }))}
                  >
                    {formatExecutionDayOption(state.frequency, day)}
                  </button>
                ))}
              </div>
            </Field>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="投资周期 (月)">
                <NumberInput step="1" value={state.termMonths} onChange={(event) => setState((current) => ({ ...current, termMonths: event.target.value }))} />
              </Field>
              <Field label="目标收益" helper="只用于计划预估和风险提醒，不代表收益承诺。">
                <NumberInput step="1" value={state.targetReturn} onChange={(event) => setState((current) => ({ ...current, targetReturn: event.target.value }))} />
              </Field>
            </div>
          </div>

          <div className="space-y-3">
            <SummaryTile label="当前标的" value={projection.effectiveSymbol || '--'} note={projection.isLinkedPlan ? '来自关联加仓策略' : '由当前输入决定'} />
            <SummaryTile label="执行节奏" value={projection.cadenceLabel} note={`预计执行 ${projection.executionCount} 次`} />
            <SummaryTile label="月均投入" value={formatCurrency(projection.monthlyEquivalent, '¥ ')} note="会随周期和金额实时变化" />
          </div>
        </div>
      </Card>
    );
  }

  function renderInvestmentStep() {
    return (
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.85fr)]">
        <Card>
          <SectionHeading eyebrow="第二步" title="投入金额与加仓联动" />
          <div className="mt-6 space-y-5">
            <Field label="关联加仓策略" helper={planList.length ? '选中后，单周期预算会按该策略的批次和触发条件在周期内分笔投入。' : '当前还没有已创建的加仓策略，可先到“加仓计划”页新建。'}>
              <SelectField options={linkedPlanOptions} value={state.linkedPlanId || ''} onChange={(event) => handleLinkedPlanChange(event.target.value)} />
            </Field>

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

            {projection.isLinkedPlan ? (
              <div className="grid gap-4 md:grid-cols-3">
                <Field label="当前价格" helper="用于判断距高点跌幅。">
                  <NumberInput step="0.001" value={state.currentPrice} onChange={(event) => setState((current) => ({ ...current, currentPrice: event.target.value }))} />
                </Field>
                <Field label="滚动高点" helper="用于判断是否进入金字塔资金池。">
                  <NumberInput step="0.001" value={state.rollingHigh} onChange={(event) => setState((current) => ({ ...current, rollingHigh: event.target.value }))} />
                </Field>
                <Field label="资金池余额">
                  <NumberInput step="0.01" value={projection.poolBalance.toFixed(2)} readOnly className="bg-white text-slate-600" />
                </Field>
              </div>
            ) : null}
          </div>
        </Card>

        <div className="space-y-6">
          <Card className="border-indigo-100 bg-gradient-to-br from-indigo-50 via-white to-white">
            <SectionHeading eyebrow="资金概览" title="投入结构" />
            <div className="mt-5 grid gap-3">
              <SummaryTile label="总投入" value={formatCurrency(projection.totalInvestment, '¥ ')} note={projection.isLinkedPlan ? '单周期投入总额 × 执行周期数' : '初始投资额 + 定期投资额 × 执行次数'} />
              <SummaryTile label="月均投入" value={formatCurrency(projection.monthlyEquivalent, '¥ ')} />
              <SummaryTile label="预计收益" value={formatCurrency(projection.totalInvestment * state.targetReturn / 100, '¥ ')} note="按目标收益估算，仅作计划参考" />
            </div>
          </Card>

          {projection.isLinkedPlan ? (
            <Card className="border-emerald-100 bg-emerald-50">
              <SectionHeading eyebrow="加仓联动" title={projection.linkedPlanName || '已关联策略'} />
              <div className="mt-4 space-y-2">
                {projection.linkedPlanSplit.map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl border border-emerald-100 bg-white/80 px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-800">{item.label}</div>
                      <div className="text-xs text-slate-500">{item.drawdown > 0 ? `参考回撤 ${formatPercent(item.drawdown, 1)}` : '首批参考区间'}</div>
                    </div>
                    <div className="shrink-0 font-semibold text-slate-900">{formatCurrency(item.amount, '¥ ')}</div>
                  </div>
                ))}
              </div>
            </Card>
          ) : (
            <Card>
              <div className="flex items-start gap-3">
                <Wallet className="mt-0.5 h-5 w-5 text-emerald-600" />
                <div>
                  <div className="font-semibold text-slate-900">固定定投</div>
                  <p className="mt-2 text-sm leading-6 text-slate-500">每个执行日按固定金额提醒，不联动加仓策略分批条件。</p>
                </div>
              </div>
            </Card>
          )}

          {projection.isLinkedPlan ? (
            <Card className={projection.smartDcaMode === 'high-level' ? 'border-amber-100 bg-amber-50' : 'border-emerald-100 bg-emerald-50'}>
              <SectionHeading eyebrow="Smart DCA" title={projection.smartDcaMode === 'high-level' ? '高位少买' : '金字塔资金池'} />
              <div className="mt-4 grid gap-3 text-sm text-slate-700 md:grid-cols-3">
                <div className="rounded-2xl bg-white/80 p-4"><div className="text-xs font-semibold text-slate-400">距高点跌幅</div><div className="mt-1 font-bold text-slate-900">{formatPercent(projection.dropPct, 1)}</div></div>
                <div className="rounded-2xl bg-white/80 p-4"><div className="text-xs font-semibold text-slate-400">本期买入</div><div className="mt-1 font-bold text-slate-900">{formatCurrency(projection.nextExecutionAmount, '¥ ')}</div></div>
                <div className="rounded-2xl bg-white/80 p-4"><div className="text-xs font-semibold text-slate-400">入池金额</div><div className="mt-1 font-bold text-slate-900">{formatCurrency(projection.smartPoolAmount, '¥ ')}</div></div>
              </div>
            </Card>
          ) : null}
        </div>
      </div>
    );
  }

  function renderPreviewStep() {
    return (
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.85fr)]">
        <div className="space-y-6">
          <Card>
            <SectionHeading eyebrow="第三步" title="预览确认" />
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <SummaryTile label="计划名称" value={state.name || `${projection.effectiveSymbol} ${state.frequency}定投`} />
              <SummaryTile label="投资标的" value={projection.effectiveSymbol || '--'} note={projection.isLinkedPlan ? `联动 ${projection.linkedPlanName}` : '固定定投'} />
              <SummaryTile label="执行节奏" value={projection.cadenceLabel} note={`预计执行 ${projection.executionCount} 次`} />
              <SummaryTile label="总投入" value={formatCurrency(projection.totalInvestment, '¥ ')} note={`月均 ${formatCurrency(projection.monthlyEquivalent, '¥ ')}`} />
            </div>
          </Card>

          <Card>
            <SectionHeading eyebrow="执行预览" title={projection.isLinkedPlan ? '前六个周期预览' : '前六次执行预览'} />
            <div className="mt-5 space-y-3">
              {projection.schedule.map((row) => (
                <div key={row.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="font-semibold text-slate-900">{row.label}</div>
                        {row.isLinkedCycle ? <Pill tone="emerald">策略分批</Pill> : null}
                      </div>
                      <div className="mt-1 text-sm text-slate-500">{row.note}</div>
                    </div>
                    <div className="text-left sm:text-right">
                      <div className="font-semibold text-slate-900">{formatCurrency(row.cumulative, '¥ ')}</div>
                      <div className="mt-1 text-xs text-slate-400">{projection.isLinkedPlan ? '本期总投入' : '单次投入'} {formatCurrency(row.contribution, '¥ ')}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <SectionHeading eyebrow="保存前检查" title="提醒与风险" />
            <div className="mt-5 space-y-3">
              {validation.blocking.length ? (
                validation.blocking.map((item) => (
                  <div key={item.message} className="flex items-start gap-3 rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    <AlertTriangle className="mt-0.5 h-4 w-4" />
                    <span>{item.message}</span>
                  </div>
                ))
              ) : (
                <div className="flex items-start gap-3 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                  <CheckCircle2 className="mt-0.5 h-4 w-4" />
                  <span>核心参数已完整，可以保存计划并同步提醒规则。</span>
                </div>
              )}
              {validation.warnings.map((message) => (
                <div key={message} className="flex items-start gap-3 rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  <AlertTriangle className="mt-0.5 h-4 w-4" />
                  <span>{message}</span>
                </div>
              ))}
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
            </div>
          </Card>

          <Card className="border-emerald-100 bg-emerald-50">
            <div className="flex items-start gap-3">
              <Target className="mt-0.5 h-5 w-5 text-emerald-600" />
              <div>
                <div className="font-semibold text-emerald-900">当前目标</div>
                <p className="mt-2 text-sm leading-6 text-emerald-800">计划在 {state.termMonths} 个月内，用 {state.frequency} 节奏累积 {projection.effectiveSymbol} 持仓。</p>
              </div>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  const content = (
    <>
      <div className={cx('space-y-6 pb-36', embedded ? '' : 'mx-auto max-w-6xl px-6 pt-8')}>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard accent="indigo" eyebrow="总投入" value={formatCurrency(projection.totalInvestment, '¥ ')} note={projection.isLinkedPlan ? `本期实际投入 ${formatCurrency(projection.nextExecutionAmount, '¥ ')}。` : '初始投入加上所有周期定投之和'} />
          <StatCard eyebrow="月均投入" value={formatCurrency(projection.monthlyEquivalent, '¥ ')} note="折算后的月度平均投入强度" />
          <StatCard accent="emerald" eyebrow="执行节奏" value={`${state.frequency} / ${formatExecutionDayOption(state.frequency, state.executionDay)}`} note="频率与执行日期共同决定节奏" />
          <StatCard eyebrow="提醒规则" value={validation.blocking.length ? '待完善' : '可同步'} note={validation.blocking[0]?.message || '保存后同步到通知服务'} />
        </div>

        <DcaStepNav currentStep={dcaStep} maxUnlockedStep={maxUnlockedStep} onStepChange={goToDcaStep} />

        {dcaStep === 1 ? renderBasicStep() : null}
        {dcaStep === 2 ? renderInvestmentStep() : null}
        {dcaStep === 3 ? renderPreviewStep() : null}
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200 bg-white/85 p-4 shadow-[0_-4px_24px_rgba(15,23,42,0.04)] backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-6 text-sm text-slate-500">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">当前步骤</div>
              <div className="mt-1 text-sm font-extrabold text-slate-900">{DCA_STEPS.find((step) => step.id === dcaStep)?.title}</div>
            </div>
            <div className="hidden h-8 w-px bg-slate-200 sm:block" />
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
            {renderCancelControl()}
            {dcaStep > 1 ? <button className={cx(secondaryButtonClass, 'w-full sm:w-auto')} type="button" onClick={() => goToDcaStep(dcaStep - 1)}>上一步</button> : null}
            {dcaStep < 3 ? (
              <button className={cx(primaryButtonClass, 'w-full sm:w-auto')} type="button" onClick={() => goToDcaStep(dcaStep + 1)}>
                下一步
                <ArrowRight className="h-4 w-4" />
              </button>
            ) : (
              <button className={cx(primaryButtonClass, 'w-full sm:w-auto')} disabled={isSaving} type="button" onClick={handleSave}>
                <Save className="h-4 w-4" />
                {isSaving ? '正在保存定投' : '保存计划并同步提醒'}
                <ArrowRight className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );

  return content;
}
