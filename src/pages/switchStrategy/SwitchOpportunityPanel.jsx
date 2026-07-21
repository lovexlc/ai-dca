import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Check, ChevronDown, Loader2, RefreshCw, TrendingUp, X } from 'lucide-react';
import { normalizeFeeConfig } from '../../app/switchRuleModel.js';
import { SwitchButton, SwitchPanel } from '../../components/fund-switch/ui.jsx';

const STATUS_LABELS = {
  triggered: '已触发',
  very_near: '非常接近',
  near: '接近提醒',
  watching: '观察中',
  no_data: '数据不足'
};

const STATUS_CLASSES = {
  triggered: 'bg-emerald-100 text-emerald-700',
  very_near: 'bg-amber-100 text-amber-700',
  near: 'bg-blue-100 text-blue-700',
  watching: 'bg-slate-100 text-slate-600',
  no_data: 'bg-slate-100 text-slate-500'
};

function percent(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toFixed(2)}%` : '—';
}

function CreateOpportunityDialog({ opportunity, initialFee, creating, onClose, onConfirm }) {
  const marketWatch = opportunity?.mode === 'market';
  const [estimatedFee, setEstimatedFee] = useState(() => String(normalizeFeeConfig(initialFee).estimatedTotalFee));
  useEffect(() => {
    setEstimatedFee(String(normalizeFeeConfig(initialFee).estimatedTotalFee));
  }, [initialFee, opportunity?.id]);
  if (!opportunity) return null;
  const addCandidate = opportunity.existingRule && !opportunity.existingRule.containsTarget;
  const needsUpgrade = opportunity.mode === 'holding' && opportunity.existingRule?.ruleType === 'market_watch';
  return (
    <div className="fixed inset-0 z-[150] flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-6" role="presentation">
      <div className="w-full max-w-lg rounded-t-lg bg-white p-5 shadow-2xl sm:rounded-lg" role="dialog" aria-modal="true" aria-labelledby="switch-opportunity-dialog-title">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 id="switch-opportunity-dialog-title" className="text-base font-bold text-slate-900">
              {needsUpgrade ? '升级为持仓提醒' : addCandidate ? '加入现有提醒' : marketWatch ? '创建市场提醒' : '创建切换提醒'}
            </h3>
            <p className="mt-1 text-sm text-slate-500">创建时会使用最新行情重新校验目标和提醒条件。</p>
          </div>
          <button type="button" aria-label="关闭" className="p-1 text-slate-400 hover:text-slate-700" onClick={onClose} disabled={creating}>
            <X className="h-5 w-5" />
          </button>
        </div>
        <dl className="mt-5 grid grid-cols-[6rem_1fr] gap-x-3 gap-y-3 text-sm">
          <dt className="text-slate-500">当前基金</dt>
          <dd className="font-semibold text-slate-900">{opportunity.sourceFund.code} {opportunity.sourceFund.name}</dd>
          <dt className="text-slate-500">优先关注</dt>
          <dd className="font-semibold text-slate-900">{opportunity.targetFund.code} {opportunity.targetFund.name}</dd>
          <dt className="text-slate-500">提醒条件</dt>
          <dd className="text-slate-700">
            {opportunity.internalDirection === 'low_to_high'
              ? `同类基金价差收窄到 ${percent(opportunity.thresholdPct)} 以内`
              : `当前基金比同类候选贵 ${percent(opportunity.thresholdPct)}`}
          </dd>
        </dl>
        {!marketWatch ? (
          <label className="mt-5 block text-sm font-medium text-slate-700">
            预计切换总费用（元）
            <input
              type="number"
              min="0"
              step="0.01"
              value={estimatedFee}
              onChange={(event) => setEstimatedFee(event.target.value)}
              className="mt-2 h-10 w-full rounded-md border border-slate-300 px-3 outline-none focus:border-slate-600"
            />
          </label>
        ) : null}
        <div className="mt-6 flex justify-end gap-3">
          <SwitchButton variant="secondary" onClick={onClose} disabled={creating}>取消</SwitchButton>
          <SwitchButton
            onClick={() => onConfirm(marketWatch ? null : {
              mode: 'estimated_total', estimatedTotalFee: Math.max(0, Number(estimatedFee) || 0)
            })}
            disabled={creating}
          >
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {needsUpgrade ? '确认升级' : addCandidate ? '确认加入' : '确认创建'}
          </SwitchButton>
        </div>
      </div>
    </div>
  );
}

function OpportunityCard({ opportunity, creating, onCreate, onOpenRule, initialFee }) {
  const [expanded, setExpanded] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const isExisting = opportunity.existingRule?.containsTarget;
  const needsUpgrade = opportunity.mode === 'holding' && opportunity.existingRule?.ruleType === 'market_watch';
  const actionLabel = needsUpgrade
    ? '升级为持仓提醒'
    : isExisting
    ? '查看规则'
    : opportunity.existingRule
      ? '加入现有提醒'
      : opportunity.mode === 'market'
        ? '创建市场提醒'
        : '创建切换提醒';
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2 py-1 text-xs font-semibold ${STATUS_CLASSES[opportunity.status] || STATUS_CLASSES.watching}`}>
              {STATUS_LABELS[opportunity.status] || '观察中'}
            </span>
            {opportunity.mode === 'market' ? <span className="text-xs text-slate-500">全市场观察</span> : null}
          </div>
          <div className="mt-3 flex min-w-0 items-center gap-2 font-bold text-slate-900">
            <span className="truncate">{opportunity.sourceFund.code} {opportunity.sourceFund.name}</span>
            <ArrowRight className="h-4 w-4 shrink-0 text-slate-400" />
            <span className="truncate">{opportunity.targetFund.code} {opportunity.targetFund.name}</span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-slate-900">{Math.round(opportunity.progressPct || 0)}%</div>
          <div className="text-xs text-slate-500">切换进度</div>
        </div>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full bg-emerald-500 transition-[width]" style={{ width: `${Math.max(0, Math.min(100, opportunity.progressPct || 0))}%` }} />
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
        <div><dt className="text-xs text-slate-500">当前{opportunity.mode === 'market' ? '价差' : '优势'}</dt><dd className="mt-1 font-semibold">{percent(opportunity.currentAdvantagePct)}</dd></div>
        <div><dt className="text-xs text-slate-500">提醒条件</dt><dd className="mt-1 font-semibold">{percent(opportunity.thresholdPct)}</dd></div>
        <div><dt className="text-xs text-slate-500">还差</dt><dd className="mt-1 font-semibold">{opportunity.distancePct !== null && opportunity.distancePct <= 0 ? '已达到' : percent(opportunity.distancePct)}</dd></div>
      </dl>
      {expanded ? (
        <div className="mt-4 border-t border-slate-100 pt-4 text-sm text-slate-600">
          <p>当前基金溢价 {percent(opportunity.sourceFund.premiumPct)}，推荐目标溢价 {percent(opportunity.targetFund.premiumPct)}。</p>
          {opportunity.alternatives?.length ? (
            <p className="mt-2">其他同指数候选：{opportunity.alternatives.map((item) => `${item.targetFund.code} ${item.targetFund.name}`).join('、')}</p>
          ) : null}
        </div>
      ) : null}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <button type="button" className="inline-flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-900" onClick={() => setExpanded((value) => !value)}>
          查看详情 <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>
        <SwitchButton onClick={() => isExisting && !needsUpgrade ? onOpenRule(opportunity.existingRule.ruleId) : setDialogOpen(true)} disabled={creating || opportunity.status === 'no_data'}>
          {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{actionLabel}
        </SwitchButton>
      </div>
      <CreateOpportunityDialog
        opportunity={dialogOpen ? opportunity : null}
        initialFee={initialFee}
        creating={creating}
        onClose={() => setDialogOpen(false)}
        onConfirm={async (feeConfig) => {
          const completed = await onCreate(opportunity, feeConfig, { upgradeMarketRule: needsUpgrade });
          if (completed) setDialogOpen(false);
        }}
      />
    </article>
  );
}

export function SwitchOpportunityPanel({ result, loading, error, creatingId, initialFee, onReload, onCreate, onOpenRule }) {
  const opportunities = Array.isArray(result?.opportunities) ? result.opportunities : [];
  const title = result?.mode === 'holding' ? '与你相关的机会' : '全市场观察机会';
  const description = result?.mode === 'holding'
    ? '根据你的场内基金持仓，展示当前最值得关注的同指数切换目标。'
    : '根据当前价差和市场数据，展示最接近切换条件的基金组合。你可以创建市场观察提醒。';
  const hasData = useMemo(() => opportunities.some((item) => item.status !== 'no_data'), [opportunities]);
  return (
    <SwitchPanel data-switch-motion-item>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><TrendingUp className="h-5 w-5 text-emerald-600" /><h2 className="text-lg font-bold text-slate-900">{title}</h2></div>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">{description}</p>
        </div>
        <button type="button" aria-label="刷新推荐机会" title="刷新推荐机会" className="p-2 text-slate-500 hover:text-slate-900 disabled:opacity-40" onClick={onReload} disabled={loading}>
          <RefreshCw className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      {result?.partial ? <div className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">部分基金行情暂时不可用，结果已按现有数据生成。</div> : null}
      {error ? <div className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
      {loading && !result ? <div className="flex min-h-44 items-center justify-center gap-2 text-sm text-slate-500"><Loader2 className="h-5 w-5 animate-spin" />正在分析最新行情…</div> : null}
      {!loading && !opportunities.length ? <div className="mt-6 rounded-lg bg-slate-50 p-8 text-center text-sm text-slate-500">{result?.mode === 'holding' ? '当前持仓暂时没有可用的同指数切换机会。' : '市场暂时没有有效的观察机会。'}</div> : null}
      {!loading && opportunities.length && !hasData ? <div className="mt-4 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">行情数据不足，暂时无法计算切换进度。</div> : null}
      {opportunities.length ? <div className="mt-5 space-y-4">{opportunities.map((item) => <OpportunityCard key={item.id} opportunity={item} creating={creatingId === item.id} initialFee={initialFee} onCreate={onCreate} onOpenRule={onOpenRule} />)}</div> : null}
    </SwitchPanel>
  );
}
