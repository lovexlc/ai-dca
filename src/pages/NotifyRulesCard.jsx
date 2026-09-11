import {
  ArrowLeft,
  Bell,
  Calendar,
  ChevronDown,
  ChevronUp,
  Edit2,
  Shuffle,
  Trash2,
  TrendingUp,
  Wallet
} from 'lucide-react';
import { useEffect } from 'react';
import { Pill, cx } from '../components/experience-ui.jsx';

const ALERT_TYPE_LABELS = {
  gain: '涨幅超过',
  loss: '跌幅超过',
  premium: '溢价率超过',
  'premium-below': '溢价率低于'
};

const PRICE_BASE_LABELS = {
  daily: '日线',
  'alert-day': '固定'
};

function RuleMetric({ icon: Icon, label, value, note, tone = 'indigo' }) {
  const toneClasses = {
    indigo: 'bg-indigo-50 text-indigo-600',
    amber: 'bg-amber-50 text-amber-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    cyan: 'bg-cyan-50 text-cyan-600'
  };
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3.5 py-3">
      <div className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', toneClasses[tone] || toneClasses.indigo)}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <div className="text-[11px] font-semibold text-slate-400">{label}</div>
        <div className="mt-0.5 flex items-baseline gap-1.5">
          <span className="text-base font-bold tabular-nums text-slate-900">{value}</span>
          {note ? <span className="truncate text-[11px] text-slate-500">{note}</span> : null}
        </div>
      </div>
    </div>
  );
}

function SectionHeader({ icon: Icon, title, count, action, tone = 'indigo' }) {
  const iconClasses = {
    indigo: 'bg-indigo-50 text-indigo-600',
    amber: 'bg-amber-50 text-amber-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    cyan: 'bg-cyan-50 text-cyan-600'
  };
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2.5">
        <span className={cx('flex h-8 w-8 items-center justify-center rounded-xl', iconClasses[tone] || iconClasses.indigo)}>
          <Icon className="h-4 w-4" />
        </span>
        <div>
          <h4 className="text-sm font-semibold text-slate-900">{title}</h4>
          {typeof count === 'number' ? <p className="text-[11px] text-slate-500">{count} 条规则</p> : null}
        </div>
      </div>
      {action}
    </div>
  );
}

export function NotifyRulesCard({
  marketAlerts = [],
  holdingAlerts = [],
  tradePlans = [],
  dcaPlans = [],
  holdingsRule,
  switchConfig,
  onEditMarketAlert,
  onDeleteMarketAlert,
  onEditHoldingAlert,
  onDeleteHoldingAlert,
  onNavigateToTradePlans,
  onNavigateToDca,
  onNavigateToSwitch,
  onToggleHoldingsRule,
  expanded,
  onToggleExpand,
  showBackButton,
  onBack
}) {
  const priceAlerts = [...marketAlerts, ...holdingAlerts];
  const priceAlertCount = priceAlerts.length;
  const enabledPriceAlertCount = priceAlerts.filter((alert) => alert.enabled).length;
  const tradePlanRules = tradePlans.filter((plan) => plan?.notify && typeof plan.notify === 'object');
  const dcaRules = dcaPlans.filter((plan) => plan?.notify && typeof plan.notify === 'object');
  const tradePlanCount = tradePlanRules.length;
  const dcaCount = dcaRules.length;
  const enabledTradePlanCount = tradePlanRules.filter((plan) => plan.notify?.enabled).length;
  const enabledDcaCount = dcaRules.filter((plan) => plan.notify?.enabled).length;
  const holdingsEnabled = Boolean(holdingsRule?.enabled);
  const switchEnabled = Boolean(switchConfig?.enabled);
  const switchRules = (Array.isArray(switchConfig?.rules) ? switchConfig.rules : [])
    .filter((rule) => (
      (Array.isArray(rule?.benchmarkCodes) && rule.benchmarkCodes.length > 0)
      || (Array.isArray(rule?.enabledCodes) && rule.enabledCodes.length > 0)
    ));
  const switchRuleCount = switchRules.length;
  const enabledSwitchRuleCount = switchEnabled
    ? switchRules.filter((rule) => rule.enabled !== false).length
    : 0;
  // 「持仓当日收益」是固定策略入口，即使未开启也必须在管理页中可见。
  const holdingsRuleCount = 1;
  const totalRules = priceAlertCount + tradePlanCount + dcaCount + switchRuleCount + holdingsRuleCount;
  const enabledRules = enabledPriceAlertCount
    + enabledTradePlanCount
    + enabledDcaCount
    + enabledSwitchRuleCount
    + (holdingsEnabled ? 1 : 0);
  const enabledProgress = totalRules > 0 ? Math.round((enabledRules / totalRules) * 100) : 0;
  const hasUserRules = priceAlertCount + tradePlanCount + dcaCount + switchRuleCount > 0;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const section = new URLSearchParams(window.location.search).get('section');
    if (section === 'rules' && !expanded) onToggleExpand?.();
    // Deep-link handling only runs on mount; the parent owns disclosure state afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function renderAlertRow(alert, type) {
    const typeLabel = ALERT_TYPE_LABELS[alert.alertType] || alert.alertType;
    const priceBaseLabel = alert.priceBase ? ` (${PRICE_BASE_LABELS[alert.priceBase] || alert.priceBase})` : '';
    const onEdit = type === 'market' ? onEditMarketAlert : onEditHoldingAlert;
    const onDelete = type === 'market' ? onDeleteMarketAlert : onDeleteHoldingAlert;
    const holdingCost = Number(alert.holdingCost);
    const thresholdValue = Number(alert.threshold);
    const triggerPrice = type === 'holding' && Number.isFinite(holdingCost) && holdingCost > 0 && Number.isFinite(thresholdValue)
      ? holdingCost * (alert.alertType === 'loss' ? (1 - thresholdValue / 100) : (1 + thresholdValue / 100))
      : null;
    const cooldownLabel = alert.cooldownHours === 1
      ? '每小时'
      : alert.cooldownHours === 6
        ? '每 6 小时'
        : alert.cooldownHours === 24
          ? '每天'
          : alert.cooldownHours === 168
            ? '每周'
            : `${alert.cooldownHours} 小时`;

    return (
      <div
        key={alert.id}
        className={cx(
          'flex items-start justify-between gap-3 rounded-xl border px-3.5 py-3 transition-colors',
          alert.enabled ? 'border-slate-200 bg-white' : 'border-slate-100 bg-slate-50'
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cx('truncate text-sm font-semibold', alert.enabled ? 'text-slate-900' : 'text-slate-400')}>
              {alert.name || alert.symbol}
            </span>
            <Pill tone={alert.enabled ? 'emerald' : 'slate'} className="px-2 py-1 text-[10px]">
              {alert.enabled ? '已启用' : '已停用'}
            </Pill>
          </div>
          <div className="mt-1 text-xs leading-5 text-slate-500">
            {typeLabel} {alert.threshold}%{priceBaseLabel}
            {Number.isFinite(holdingCost) && holdingCost > 0 ? ` · 成本 ¥${holdingCost.toFixed(3)}` : ''}
            {Number.isFinite(triggerPrice) && triggerPrice > 0 ? ` · 触发价 ${alert.alertType === 'loss' ? '≤' : '≥'} ¥${triggerPrice.toFixed(3)}` : ''}
            {` · ${cooldownLabel}`}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" onClick={() => onEdit?.(alert)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600" aria-label={`编辑 ${alert.name || alert.symbol}`} title="编辑">
            <Edit2 className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={() => onDelete?.(alert.id)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600" aria-label={`删除 ${alert.name || alert.symbol}`} title="删除">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <section data-scroll-card="true" className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex items-stretch">
        {showBackButton ? (
          <div className="flex items-center border-r border-slate-100 pl-4">
            <button type="button" onClick={onBack} className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800" aria-label="返回来源页面" title="返回">
              <ArrowLeft className="h-4 w-4" />
            </button>
          </div>
        ) : null}
        <button
          type="button"
          onClick={onToggleExpand}
          className="flex min-w-0 flex-1 items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-slate-50 sm:px-6"
          aria-expanded={expanded}
        >
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
              <Bell className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-bold text-slate-900 sm:text-lg">提醒规则</h2>
                <Pill tone={enabledRules > 0 ? 'indigo' : 'slate'}>{enabledRules} 条运行中</Pill>
              </div>
              <p className="mt-1 text-xs leading-5 text-slate-500">统一查看价格、交易计划、定投、切换和持仓收益策略。</p>
              <div className="mt-2 flex items-center gap-2">
                <div className="h-1.5 w-32 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${enabledProgress}%` }} />
                </div>
                <span className="text-[11px] tabular-nums text-slate-400">{enabledRules} / {totalRules}</span>
              </div>
            </div>
          </div>
          {expanded ? <ChevronUp className="h-5 w-5 shrink-0 text-slate-400" /> : <ChevronDown className="h-5 w-5 shrink-0 text-slate-400" />}
        </button>
      </div>

      {expanded ? (
        <div className="space-y-4 border-t border-slate-100 bg-white px-4 py-4 sm:px-6 sm:py-5">
          <div className={cx(
            'rounded-2xl border p-4 sm:p-5',
            holdingsEnabled ? 'border-emerald-200 bg-emerald-50/60' : 'border-slate-200 bg-white'
          )}>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <span className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', holdingsEnabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500')}>
                  <Wallet className="h-4 w-4" />
                </span>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-slate-900">持仓每日收益</h3>
                    <Pill tone={holdingsEnabled ? 'emerald' : 'slate'} className="px-2 py-1 text-[10px]">{holdingsEnabled ? '已开启' : '未开启'}</Pill>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-slate-500">15:30 推送场内结果；20:30 / 21:30 推送全仓总览。</p>
                </div>
              </div>
              <label className="inline-flex cursor-pointer items-center justify-between gap-3 rounded-xl bg-white px-3 py-2 text-xs font-semibold text-slate-600 ring-1 ring-slate-200 sm:justify-start">
                <span>{holdingsEnabled ? '关闭提醒' : '开启提醒'}</span>
                <span className="relative inline-flex items-center">
                  <input
                    type="checkbox"
                    checked={holdingsEnabled}
                    onChange={(event) => onToggleHoldingsRule?.(event.target.checked)}
                    className="peer sr-only"
                    disabled={!onToggleHoldingsRule}
                  />
                  <span aria-hidden="true" className="h-5 w-9 rounded-full bg-slate-200 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow-sm after:transition-all after:content-[''] peer-checked:bg-emerald-600 peer-checked:after:translate-x-full peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-300" />
                </span>
              </label>
            </div>
          </div>

          {priceAlertCount > 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
              <SectionHeader icon={Bell} title="价格预警" count={priceAlertCount} tone="amber" />
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                {marketAlerts.length > 0 ? (
                  <div className="space-y-2">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">行情预警 · {marketAlerts.length}</div>
                    {marketAlerts.map((alert) => renderAlertRow(alert, 'market'))}
                  </div>
                ) : null}
                {holdingAlerts.length > 0 ? (
                  <div className="space-y-2">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">持仓预警 · {holdingAlerts.length}</div>
                    {holdingAlerts.map((alert) => renderAlertRow(alert, 'holding'))}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {tradePlanCount + dcaCount > 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
              <SectionHeader
                icon={TrendingUp}
                title="交易计划与定投"
                count={tradePlanCount + dcaCount}
                tone="indigo"
                action={(
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={onNavigateToTradePlans} className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-indigo-600 transition-colors hover:bg-indigo-50">管理计划</button>
                    <button type="button" onClick={onNavigateToDca} className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-indigo-600 transition-colors hover:bg-indigo-50">管理定投</button>
                  </div>
                )}
              />
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                {tradePlanCount > 0 ? (
                  <div className="space-y-2">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">交易计划 · {tradePlanCount}</div>
                    {tradePlanRules.map((plan) => (
                      <div key={plan.id} className={cx('rounded-xl border px-3.5 py-3', plan.notify?.enabled ? 'border-indigo-100 bg-indigo-50/40' : 'border-slate-100 bg-slate-50')}>
                        <div className="flex items-center justify-between gap-2">
                          <span className={cx('truncate text-sm font-semibold', plan.notify?.enabled ? 'text-slate-900' : 'text-slate-400')}>{plan.name || plan.symbol}</span>
                          <Pill tone={plan.notify?.enabled ? 'emerald' : 'slate'} className="px-2 py-1 text-[10px]">{plan.notify?.enabled ? '已启用' : '未启用'}</Pill>
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {plan.symbol}{plan.buyAt ? ` · 买入价 ¥${Number(plan.buyAt).toFixed(2)}` : ''}{plan.targetGain ? ` · 目标 ${plan.targetGain}%` : ''}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
                {dcaCount > 0 ? (
                  <div className="space-y-2">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">定投提醒 · {dcaCount}</div>
                    {dcaRules.map((dca) => (
                      <div key={dca.id} className={cx('rounded-xl border px-3.5 py-3', dca.notify?.enabled ? 'border-emerald-100 bg-emerald-50/40' : 'border-slate-100 bg-slate-50')}>
                        <div className="flex items-center justify-between gap-2">
                          <span className={cx('truncate text-sm font-semibold', dca.notify?.enabled ? 'text-slate-900' : 'text-slate-400')}>{dca.name || dca.symbol}</span>
                          <Pill tone={dca.notify?.enabled ? 'emerald' : 'slate'} className="px-2 py-1 text-[10px]">{dca.notify?.enabled ? '已启用' : '未启用'}</Pill>
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {dca.symbol}{dca.schedule ? ` · ${dca.schedule}` : ''}{dca.amount ? ` · 每次 ¥${dca.amount}` : ''}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {switchRuleCount > 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
              <SectionHeader
                icon={Shuffle}
                title="切换信号"
                count={switchRuleCount}
                tone="cyan"
                action={<button type="button" onClick={onNavigateToSwitch} className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-cyan-700 transition-colors hover:bg-cyan-50">前往管理 →</button>}
              />
              {!switchEnabled ? <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">切换信号总开关已关闭。</div> : null}
              <div className="mt-3 grid gap-2 lg:grid-cols-2">
                {switchRules.map((rule, index) => {
                  const benchmarkCount = Array.isArray(rule.benchmarkCodes) ? rule.benchmarkCodes.length : 0;
                  const candidateCount = Array.isArray(rule.enabledCodes) ? rule.enabledCodes.length : 0;
                  const rowEnabled = switchEnabled && rule.enabled !== false;
                  return (
                    <div key={rule.id || `switch-rule-${index}`} className={cx('rounded-xl border px-3.5 py-3', rowEnabled ? 'border-cyan-100 bg-cyan-50/40' : 'border-slate-100 bg-slate-50')}>
                      <div className="flex items-center justify-between gap-2">
                        <span className={cx('truncate text-sm font-semibold', rowEnabled ? 'text-slate-900' : 'text-slate-400')}>{rule.name || `切换规则 ${index + 1}`}</span>
                        <Pill tone={rowEnabled ? 'emerald' : 'slate'} className="px-2 py-1 text-[10px]">{rowEnabled ? '已启用' : '未启用'}</Pill>
                      </div>
                      <div className="mt-1 text-xs text-slate-500">持仓基准 {benchmarkCount} 只 · 候选 {candidateCount} 只</div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {!hasUserRules ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-7 text-center">
              <Bell className="mx-auto h-7 w-7 text-slate-300" />
              <p className="mt-2 text-sm font-semibold text-slate-700">还没有自定义提醒规则</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">可在行情中心、持仓、交易计划或基金切换页面创建；每日收益开关可直接在上方管理。</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
