import { Bell, Calendar, TrendingUp, Wallet, ChevronDown, ChevronUp, Edit2, Trash2, ArrowLeft } from 'lucide-react';
import { cx } from '../components/experience-ui.jsx';

export function NotifyRulesCard({
  marketAlerts,
  holdingAlerts,
  tradePlans,
  dcaPlans,
  holdingsRule,
  onEditMarketAlert,
  onDeleteMarketAlert,
  onEditHoldingAlert,
  onDeleteHoldingAlert,
  onNavigateToTradePlans,
  onNavigateToDca,
  onToggleHoldingsRule,
  expanded,
  onToggleExpand,
  showBackButton,
  onBack
}) {
  const priceAlertCount = marketAlerts.length + holdingAlerts.length;
  const tradePlanCount = tradePlans.filter(p => p.notify?.enabled).length;
  const dcaCount = dcaPlans.filter(d => d.notify?.enabled).length;
  const holdingsEnabled = Boolean(holdingsRule?.enabled);

  const totalRules = priceAlertCount + tradePlanCount + dcaCount + (holdingsEnabled ? 1 : 0);
  const enabledRules = marketAlerts.filter(a => a.enabled).length +
                      holdingAlerts.filter(a => a.enabled).length +
                      tradePlanCount + dcaCount + (holdingsEnabled ? 1 : 0);

  const alertTypeLabels = {
    gain: '涨幅超过',
    loss: '跌幅超过',
    premium: '溢价率超过',
    'premium-below': '溢价率低于'
  };

  const priceBaseLabels = {
    daily: '日线',
    'alert-day': '固定'
  };

  function renderAlertRow(alert, type) {
    const typeLabel = alertTypeLabels[alert.alertType] || alert.alertType;
    const priceBaseLabel = alert.priceBase ? ` (${priceBaseLabels[alert.priceBase] || alert.priceBase})` : '';
    const onEdit = type === 'market' ? onEditMarketAlert : onEditHoldingAlert;
    const onDelete = type === 'market' ? onDeleteMarketAlert : onDeleteHoldingAlert;

    return (
      <div
        key={alert.id}
        className={cx(
          'flex items-center justify-between rounded-lg border p-3 transition-colors',
          alert.enabled ? 'border-slate-200 bg-white' : 'border-slate-100 bg-slate-50'
        )}
      >
        <div className="flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <span className={cx('text-sm font-medium', alert.enabled ? 'text-slate-900' : 'text-slate-400')}>
              {alert.name || alert.symbol}
            </span>
            {!alert.enabled && (
              <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-600">已禁用</span>
            )}
          </div>
          <div className="text-xs text-slate-600">
            {typeLabel} {alert.threshold}%{priceBaseLabel}
            {alert.holdingCost && ` · 成本 ¥${alert.holdingCost.toFixed(3)}`}
            {' · '}
            {alert.cooldownHours === 1 ? '每小时' :
             alert.cooldownHours === 6 ? '每6小时' :
             alert.cooldownHours === 24 ? '每天' :
             alert.cooldownHours === 168 ? '每周' :
             `${alert.cooldownHours}小时`}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onEdit(alert)}
            className="rounded p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            title="编辑"
          >
            <Edit2 size={14} />
          </button>
          <button
            onClick={() => onDelete(alert.id)}
            className="rounded p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
            title="删除"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <button
        onClick={onToggleExpand}
        className="flex w-full items-center justify-between px-6 py-4 text-left transition-colors hover:bg-slate-50"
      >
        <div className="flex items-center gap-3">
          {showBackButton && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onBack();
              }}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white transition-colors hover:bg-slate-50"
              title="返回"
            >
              <ArrowLeft size={16} className="text-slate-600" />
            </button>
          )}
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-50">
            <Bell size={18} className="text-indigo-600" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-slate-900">通知规则管理</h3>
            <p className="text-sm text-slate-500">
              {totalRules === 0 ? '暂无规则' : `${enabledRules} / ${totalRules} 规则已启用`}
            </p>
          </div>
        </div>
        {expanded ? <ChevronUp size={20} className="text-slate-400" /> : <ChevronDown size={20} className="text-slate-400" />}
      </button>

      {expanded && (
        <div className="space-y-6 border-t border-slate-100 px-6 py-4">
          {totalRules === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center">
              <Bell size={32} className="mx-auto mb-2 text-slate-300" />
              <p className="text-sm font-medium text-slate-600">暂无通知规则</p>
              <p className="mt-1 text-xs text-slate-500">
                在行情中心、持仓、交易计划页面创建通知规则
              </p>
            </div>
          ) : (
            <>
              {/* 价格预警 */}
              {priceAlertCount > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Bell size={16} className="text-amber-600" />
                    <h4 className="text-sm font-semibold text-slate-900">价格预警 ({priceAlertCount})</h4>
                  </div>
                  {marketAlerts.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">市场预警 ({marketAlerts.length})</p>
                      {marketAlerts.map(alert => renderAlertRow(alert, 'market'))}
                    </div>
                  )}
                  {holdingAlerts.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">持仓预警 ({holdingAlerts.length})</p>
                      {holdingAlerts.map(alert => renderAlertRow(alert, 'holding'))}
                    </div>
                  )}
                </div>
              )}

              {/* 交易计划监控 */}
              {tradePlanCount > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <TrendingUp size={16} className="text-indigo-600" />
                      <h4 className="text-sm font-semibold text-slate-900">交易计划监控 ({tradePlanCount})</h4>
                    </div>
                    <button
                      onClick={onNavigateToTradePlans}
                      className="text-xs text-indigo-600 hover:text-indigo-700"
                    >
                      前往管理 →
                    </button>
                  </div>
                  <div className="space-y-2">
                    {tradePlans.filter(p => p.notify?.enabled).map(plan => (
                      <div key={plan.id} className="rounded-lg border border-slate-200 bg-white p-3">
                        <div className="text-sm font-medium text-slate-900">{plan.name || plan.symbol}</div>
                        <div className="text-xs text-slate-600">
                          {plan.symbol}
                          {plan.buyAt && ` · 买入价 ¥${plan.buyAt.toFixed(2)}`}
                          {plan.targetGain && ` · 目标涨幅 ${plan.targetGain}%`}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 定投提醒 */}
              {dcaCount > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Calendar size={16} className="text-emerald-600" />
                      <h4 className="text-sm font-semibold text-slate-900">定投提醒 ({dcaCount})</h4>
                    </div>
                    <button
                      onClick={onNavigateToDca}
                      className="text-xs text-emerald-600 hover:text-emerald-700"
                    >
                      前往管理 →
                    </button>
                  </div>
                  <div className="space-y-2">
                    {dcaPlans.filter(d => d.notify?.enabled).map(dca => (
                      <div key={dca.id} className="rounded-lg border border-slate-200 bg-white p-3">
                        <div className="text-sm font-medium text-slate-900">{dca.name || dca.symbol}</div>
                        <div className="text-xs text-slate-600">
                          {dca.symbol}
                          {dca.schedule && ` · ${dca.schedule}`}
                          {dca.amount && ` · 每次 ¥${dca.amount}`}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 持仓收益提醒 */}
              {holdingsEnabled && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Wallet size={16} className="text-emerald-600" />
                    <h4 className="text-sm font-semibold text-slate-900">持仓收益提醒</h4>
                  </div>
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-medium text-emerald-900">持仓当日收益</div>
                        <div className="text-xs text-emerald-700">北京时间 15:30 推场内；20:30 / 21:30 推全仓</div>
                      </div>
                      <label className="relative inline-flex cursor-pointer items-center">
                        <input
                          type="checkbox"
                          checked={holdingsEnabled}
                          onChange={(e) => onToggleHoldingsRule(e.target.checked)}
                          className="peer sr-only"
                        />
                        <div className="peer h-5 w-9 rounded-full bg-slate-200 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:bg-emerald-600 peer-checked:after:translate-x-full peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-emerald-500"></div>
                      </label>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
