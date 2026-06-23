import { Bell, Trash2, Edit2, ChevronDown, ChevronUp } from 'lucide-react';
import { cx } from '../components/experience-ui.jsx';

export function NotifyAlertRulesCard({
  marketAlerts,
  holdingAlerts,
  onEditMarketAlert,
  onDeleteMarketAlert,
  onEditHoldingAlert,
  onDeleteHoldingAlert,
  expanded,
  onToggleExpand
}) {
  const totalAlerts = marketAlerts.length + holdingAlerts.length;
  const enabledAlerts = [...marketAlerts, ...holdingAlerts].filter(alert => alert.enabled).length;

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
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-50">
            <Bell size={18} className="text-amber-600" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-slate-900">价格预警规则</h3>
            <p className="text-sm text-slate-500">
              {totalAlerts === 0 ? '暂无规则' : `${enabledAlerts} / ${totalAlerts} 规则已启用`}
            </p>
          </div>
        </div>
        {expanded ? <ChevronUp size={20} className="text-slate-400" /> : <ChevronDown size={20} className="text-slate-400" />}
      </button>

      {expanded && (
        <div className="space-y-4 border-t border-slate-100 px-6 py-4">
          {totalAlerts === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center">
              <Bell size={32} className="mx-auto mb-2 text-slate-300" />
              <p className="text-sm font-medium text-slate-600">暂无价格预警规则</p>
              <p className="mt-1 text-xs text-slate-500">
                在行情中心或持仓页面设置价格预警，所有规则将在这里统一管理
              </p>
            </div>
          ) : (
            <>
              {marketAlerts.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">市场预警 ({marketAlerts.length})</h4>
                  <div className="space-y-2">
                    {marketAlerts.map(alert => renderAlertRow(alert, 'market'))}
                  </div>
                </div>
              )}

              {holdingAlerts.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">持仓预警 ({holdingAlerts.length})</h4>
                  <div className="space-y-2">
                    {holdingAlerts.map(alert => renderAlertRow(alert, 'holding'))}
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
