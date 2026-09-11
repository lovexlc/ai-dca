import { ArrowLeft, Bell, CalendarClock, Edit2, MoreVertical, Percent, Shuffle, TrendingDown, Wallet } from 'lucide-react';
import { useEffect } from 'react';
import { cx } from '../components/experience-ui.jsx';

const ALERT_TYPE_LABELS = { gain: '涨幅超过', loss: '跌幅超过', premium: '溢价率超过', 'premium-below': '溢价率低于' };

function Toggle({ checked, onChange, label }) {
  return (
    <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 text-xs text-slate-600">
      <span className="relative inline-flex items-center">
        <input type="checkbox" checked={checked} onChange={(event) => onChange?.(event.target.checked)} className="peer sr-only" aria-label={label} />
        <span className="h-5 w-9 rounded-full bg-slate-200 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow-sm after:transition-all after:content-[''] peer-checked:bg-indigo-600 peer-checked:after:translate-x-full peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-300" />
      </span>
      <span>{checked ? '已开启' : '已关闭'}</span>
    </label>
  );
}

function RuleIcon({ tone, children }) {
  const classes = { indigo: 'bg-indigo-50 text-indigo-600', purple: 'bg-purple-50 text-purple-600', amber: 'bg-amber-50 text-amber-600', rose: 'bg-rose-50 text-rose-600', cyan: 'bg-cyan-50 text-cyan-600' };
  return <span className={cx('flex h-8 w-8 shrink-0 items-center justify-center rounded-full', classes[tone] || classes.indigo)}>{children}</span>;
}

function Row({ icon, tone, name, condition, enabled, action, lastTriggered = '—' }) {
  return (
    <div className="grid min-w-[760px] grid-cols-[minmax(210px,1.2fr)_minmax(300px,2fr)_150px_170px_80px] items-center border-t border-slate-100 px-4 py-2.5 text-sm sm:px-5">
      <div className="flex min-w-0 items-center gap-3"><RuleIcon tone={tone}>{icon}</RuleIcon><span className="truncate font-semibold text-slate-900">{name}</span></div>
      <div className="truncate pr-4 text-xs text-slate-500">{condition}</div>
      <div>{typeof action === 'function' ? <Toggle checked={enabled} onChange={action} label={`${name}状态`} /> : <span className="inline-flex items-center gap-2 text-xs text-slate-600"><span className={cx('h-2 w-2 rounded-full', enabled ? 'bg-emerald-500' : 'bg-slate-300')} />{enabled ? '已开启' : '已关闭'}</span>}</div>
      <div className="text-xs tabular-nums text-slate-500">{lastTriggered}</div>
      <div className="flex items-center justify-end gap-1">{action && typeof action !== 'function' ? action : null}<button type="button" className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-50 hover:text-indigo-600" aria-label={`${name}更多操作`}><MoreVertical className="h-4 w-4" /></button></div>
    </div>
  );
}

export function NotifyRulesCard({
  marketAlerts = [], holdingAlerts = [], tradePlans = [], dcaPlans = [], holdingsRule,
  switchConfig, onEditMarketAlert, onDeleteMarketAlert, onEditHoldingAlert,
  onDeleteHoldingAlert, onNavigateToTradePlans, onNavigateToDca, onNavigateToSwitch,
  onToggleHoldingsRule, expanded, onToggleExpand, showBackButton, onBack
}) {
  const priceAlerts = [...marketAlerts.map((item) => ({ ...item, source: 'market' })), ...holdingAlerts.map((item) => ({ ...item, source: 'holding' }))];
  const tradeRules = tradePlans.filter((plan) => plan?.notify && typeof plan.notify === 'object');
  const dcaRules = dcaPlans.filter((plan) => plan?.notify && typeof plan.notify === 'object');
  const switchRules = (Array.isArray(switchConfig?.rules) ? switchConfig.rules : []).filter((rule) => (rule?.benchmarkCodes?.length || rule?.enabledCodes?.length));

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (new URLSearchParams(window.location.search).get('section') === 'rules' && !expanded) onToggleExpand?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const editAction = (handler, item) => <button type="button" onClick={() => handler?.(item)} className="flex h-9 w-9 items-center justify-center rounded-lg text-indigo-600 hover:bg-indigo-50" aria-label={`编辑 ${item.name || item.symbol}`}><Edit2 className="h-4 w-4" /></button>;

  return (
    <section data-scroll-card="true" className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">{showBackButton ? <button type="button" onClick={onBack} className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100" aria-label="返回"><ArrowLeft className="h-4 w-4" /></button> : null}<div><h2 className="text-lg font-bold text-slate-950">提醒规则</h2><p className="mt-1 text-sm text-slate-500">根据你的需求设置提醒规则，支持多种事件类型和自定义条件。</p></div></div>
        <div className="flex items-center gap-2"><button type="button" onClick={onNavigateToTradePlans} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700"><span className="text-lg leading-none">＋</span>新建规则</button><button type="button" onClick={onToggleExpand} className="min-h-10 rounded-lg px-3 text-xs font-semibold text-slate-500 hover:bg-slate-50">{expanded ? '收起' : '展开'}</button></div>
      </div>

      {expanded ? <div className="overflow-x-auto border-t border-slate-100">
        <div className="grid min-w-[760px] grid-cols-[minmax(210px,1.2fr)_minmax(300px,2fr)_150px_170px_80px] bg-slate-50/80 px-4 py-2.5 text-xs font-semibold text-slate-500 sm:px-5"><span>规则名称</span><span>触发条件</span><span>状态</span><span>上次触发时间</span><span className="text-right">操作</span></div>
        <Row icon={<Wallet className="h-4 w-4" />} tone="indigo" name="持仓收益提醒" condition="交易日 15:30 / 20:30 / 21:30 推送持仓总览" enabled={Boolean(holdingsRule?.enabled)} action={onToggleHoldingsRule} />
        {priceAlerts.map((alert) => {
          const typeLabel = ALERT_TYPE_LABELS[alert.alertType] || alert.alertType || '价格条件';
          const handler = alert.source === 'market' ? onEditMarketAlert : onEditHoldingAlert;
          return <Row key={alert.id} icon={alert.alertType === 'loss' ? <TrendingDown className="h-4 w-4" /> : <Bell className="h-4 w-4" />} tone={alert.alertType === 'loss' ? 'rose' : 'indigo'} name={alert.name || alert.symbol || '价格提醒'} condition={`${alert.symbol || ''} ${typeLabel} ${alert.threshold ?? '—'}%`} enabled={Boolean(alert.enabled)} action={editAction(handler, alert)} />;
        })}
        {tradeRules.map((plan) => <Row key={plan.id} icon={<Bell className="h-4 w-4" />} tone="purple" name={plan.name || plan.symbol || '交易计划提醒'} condition={`${plan.symbol || ''}${plan.buyAt ? ` 价格达到 ¥${Number(plan.buyAt).toFixed(2)}` : ' 按交易计划触发'}`} enabled={Boolean(plan.notify?.enabled)} action={<button type="button" onClick={onNavigateToTradePlans} className="px-2 py-1 text-xs font-semibold text-indigo-600">编辑</button>} />)}
        {dcaRules.map((plan) => <Row key={plan.id} icon={<CalendarClock className="h-4 w-4" />} tone="amber" name={plan.name || plan.symbol || '定投提醒'} condition={`${plan.schedule || '按计划'} 提醒执行定投${plan.amount ? ` · ¥${plan.amount}` : ''}`} enabled={Boolean(plan.notify?.enabled)} action={<button type="button" onClick={onNavigateToDca} className="px-2 py-1 text-xs font-semibold text-indigo-600">编辑</button>} />)}
        {switchRules.map((rule, index) => <Row key={rule.id || index} icon={<Shuffle className="h-4 w-4" />} tone="cyan" name={rule.name || `切换规则 ${index + 1}`} condition={`持仓基准 ${rule.benchmarkCodes?.length || 0} 只 · 候选 ${rule.enabledCodes?.length || 0} 只`} enabled={Boolean(switchConfig?.enabled && rule.enabled !== false)} action={<button type="button" onClick={onNavigateToSwitch} className="px-2 py-1 text-xs font-semibold text-indigo-600">编辑</button>} />)}
        {!priceAlerts.length && !tradeRules.length && !dcaRules.length && !switchRules.length ? <div className="border-t border-slate-100 px-5 py-5 text-center text-sm text-slate-500">当前仅有持仓收益提醒。点击“新建规则”添加更多提醒。</div> : null}
      </div> : null}
    </section>
  );
}
