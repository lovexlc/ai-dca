import { TrendingUp, Trash2, Calendar, ChevronDown, ChevronUp } from 'lucide-react';
import { cx } from '../components/experience-ui.jsx';

export function NotifyTradePlanRulesCard({
  tradePlans,
  dcaPlans,
  onNavigateToTradePlans,
  onNavigateToDca,
  expanded,
  onToggleExpand
}) {
  const totalRules = tradePlans.length + dcaPlans.length;
  const enabledPlans = tradePlans.filter(plan => plan.notify?.enabled).length;
  const enabledDca = dcaPlans.filter(dca => dca.notify?.enabled).length;

  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <button
        onClick={onToggleExpand}
        className="flex w-full items-center justify-between px-6 py-4 text-left transition-colors hover:bg-slate-50"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-50">
            <TrendingUp size={18} className="text-indigo-600" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-slate-900">交易计划与定投规则</h3>
            <p className="text-sm text-slate-500">
              {totalRules === 0 ? '暂无规则' : `${enabledPlans + enabledDca} / ${totalRules} 规则已启用通知`}
            </p>
          </div>
        </div>
        {expanded ? <ChevronUp size={20} className="text-slate-400" /> : <ChevronDown size={20} className="text-slate-400" />}
      </button>

      {expanded && (
        <div className="space-y-4 border-t border-slate-100 px-6 py-4">
          {totalRules === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center">
              <TrendingUp size={32} className="mx-auto mb-2 text-slate-300" />
              <p className="text-sm font-medium text-slate-600">暂无交易计划或定投规则</p>
              <p className="mt-1 text-xs text-slate-500">
                在交易计划或定投页面创建计划，并启用通知功能
              </p>
            </div>
          ) : (
            <>
              {tradePlans.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      交易计划 ({tradePlans.length})
                    </h4>
                    <button
                      onClick={onNavigateToTradePlans}
                      className="text-xs text-indigo-600 hover:text-indigo-700"
                    >
                      前往管理 →
                    </button>
                  </div>
                  <div className="space-y-2">
                    {tradePlans.map(plan => (
                      <div
                        key={plan.id}
                        className={cx(
                          'flex items-center justify-between rounded-lg border p-3 transition-colors',
                          plan.notify?.enabled ? 'border-slate-200 bg-white' : 'border-slate-100 bg-slate-50'
                        )}
                      >
                        <div className="flex-1 space-y-1">
                          <div className="flex items-center gap-2">
                            <span className={cx('text-sm font-medium', plan.notify?.enabled ? 'text-slate-900' : 'text-slate-400')}>
                              {plan.name || plan.symbol}
                            </span>
                            {!plan.notify?.enabled && (
                              <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-600">通知未启用</span>
                            )}
                          </div>
                          <div className="text-xs text-slate-600">
                            {plan.symbol}
                            {plan.buyAt && ` · 买入价 ¥${plan.buyAt.toFixed(2)}`}
                            {plan.targetGain && ` · 目标涨幅 ${plan.targetGain}%`}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {dcaPlans.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      定投计划 ({dcaPlans.length})
                    </h4>
                    <button
                      onClick={onNavigateToDca}
                      className="text-xs text-indigo-600 hover:text-indigo-700"
                    >
                      前往管理 →
                    </button>
                  </div>
                  <div className="space-y-2">
                    {dcaPlans.map(dca => (
                      <div
                        key={dca.id}
                        className={cx(
                          'flex items-center justify-between rounded-lg border p-3 transition-colors',
                          dca.notify?.enabled ? 'border-slate-200 bg-white' : 'border-slate-100 bg-slate-50'
                        )}
                      >
                        <div className="flex-1 space-y-1">
                          <div className="flex items-center gap-2">
                            <Calendar size={14} className="text-slate-400" />
                            <span className={cx('text-sm font-medium', dca.notify?.enabled ? 'text-slate-900' : 'text-slate-400')}>
                              {dca.name || dca.symbol}
                            </span>
                            {!dca.notify?.enabled && (
                              <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-600">通知未启用</span>
                            )}
                          </div>
                          <div className="text-xs text-slate-600">
                            {dca.symbol}
                            {dca.schedule && ` · ${dca.schedule}`}
                            {dca.amount && ` · 每次 ¥${dca.amount}`}
                          </div>
                        </div>
                      </div>
                    ))}
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
