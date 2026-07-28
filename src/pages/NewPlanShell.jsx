import { ArrowRight, Save } from 'lucide-react';
import { PageHero, Pill, cx, primaryButtonClass, secondaryButtonClass } from '../components/experience-ui.jsx';

export function NewPlanStepNav({ planSteps, planStep, maxUnlockedStep, goToPlanStep }) {
  return (
    <nav aria-label="新建策略步骤" className="grid gap-2 rounded-[var(--radius-lg)] border border-[var(--a-200)] bg-white p-2 sm:grid-cols-4">
      {planSteps.map((step) => (
        <button
          key={step.id}
          type="button"
          onClick={() => goToPlanStep(step.id)}
          aria-current={planStep === step.id ? 'step' : undefined}
          aria-disabled={step.id > maxUnlockedStep + 1}
          className={cx(
            'rounded-md px-3 py-2 text-left text-sm font-semibold transition-colors',
            planStep === step.id
              ? 'bg-[var(--fg-1000)] text-white'
              : step.id > maxUnlockedStep + 1
                ? 'cursor-not-allowed text-slate-300'
                : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
          )}
        >
          <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/20 text-xs">{step.id}</span>
          {step.title}
        </button>
      ))}
    </nav>
  );
}

export function NewPlanFooter({
  links,
  planStep,
  isSaving,
  activeStrategy,
  computed,
  goToPlanStep,
  handleCreatePlan,
  onBack,
  isEditing = false,
  formatCurrency
}) {
  return (
    <div className="fixed bottom-[calc(52px+env(safe-area-inset-bottom))] left-0 right-0 z-40 border-t border-[var(--a-200)] bg-white/85 px-4 pb-4 pt-4 backdrop-blur-md sm:bottom-0 sm:pb-[calc(1rem+env(safe-area-inset-bottom))]">
      <div className="mx-auto flex max-w-[1320px] flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-6 text-sm text-slate-500">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">策略模板</div>
            <div className="mt-1 text-sm font-extrabold text-slate-900">{activeStrategy.label}</div>
          </div>
          <div className="hidden h-8 w-px bg-slate-200 sm:block" />
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">可投入资金</div>
            <div className="mt-1 text-sm font-extrabold text-slate-900">{formatCurrency(computed.investableCapital, '¥ ')}</div>
          </div>
        </div>
        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
          {typeof onBack === 'function' ? (
            <button className={cx(secondaryButtonClass, 'w-full sm:w-auto')} type="button" onClick={onBack}>取消</button>
          ) : (
            <a className={cx(secondaryButtonClass, 'w-full sm:w-auto')} href={links.home}>取消</a>
          )}
          {planStep > 1 ? <button className={cx(secondaryButtonClass, 'w-full sm:w-auto')} type="button" onClick={() => goToPlanStep(planStep - 1)}>上一步</button> : null}
          {planStep < 4 ? (
            <button className={cx(primaryButtonClass, 'w-full sm:w-auto')} type="button" onClick={() => goToPlanStep(planStep + 1)}>
              下一步
              <ArrowRight className="h-4 w-4" />
            </button>
          ) : (
            <button className={cx(primaryButtonClass, 'w-full sm:w-auto')} disabled={isSaving} type="button" onClick={handleCreatePlan}>
              <Save className="h-4 w-4" />
              {isSaving ? '正在保存计划' : '保存计划并同步提醒'}
              <ArrowRight className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function NewPlanHero({ links, onBack, isEditing = false, selectedFundCode, benchmarkCodeLabel, activeStrategyLabel, formatMarketCode }) {
  return (
    <PageHero
      backHref={onBack ? undefined : links.home}
      onBack={onBack || undefined}
      backLabel={onBack ? '返回交易计划' : '返回加仓计划'}
      eyebrow={isEditing ? '策略编辑' : '策略新建'}
      title={isEditing ? '编辑建仓计划' : '新建建仓计划'}
      badges={[
        <Pill key="symbol" tone="indigo">{formatMarketCode(selectedFundCode) || '未选择标的'}</Pill>,
        <Pill key="benchmark" tone="slate">{benchmarkCodeLabel}</Pill>,
        <Pill key="strategy" tone="slate">{activeStrategyLabel}</Pill>
      ]}
    />
  );
}
