import { Bell, Calendar, CheckCircle2, Send, TrendingUp, Wallet, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { cx, primaryButtonClass, secondaryButtonClass } from '../components/experience-ui.jsx';

const ALERT_TYPE_LABELS = {
  gain: '涨幅超过',
  loss: '跌幅超过',
  premium: '溢价率超过',
  'premium-below': '溢价率低于'
};

export function NotifyTestDialog({
  open,
  onClose,
  marketAlerts = [],
  holdingAlerts = [],
  tradePlans = [],
  dcaPlans = [],
  holdingsRule,
  onSendTest
}) {
  const [selectedType, setSelectedType] = useState('price-alert');
  const [selectedId, setSelectedId] = useState('');
  const [sending, setSending] = useState(false);

  const ruleOptions = useMemo(() => ({
    'price-alert': {
      label: '价格预警',
      description: '行情与持仓阈值',
      icon: Bell,
      rules: [
        ...marketAlerts.map((alert) => ({
          id: alert.id,
          label: alert.name || alert.symbol,
          detail: `${ALERT_TYPE_LABELS[alert.alertType] || alert.alertType} ${alert.threshold}%`,
          type: 'market'
        })),
        ...holdingAlerts.map((alert) => ({
          id: alert.id,
          label: alert.name || alert.symbol,
          detail: `${ALERT_TYPE_LABELS[alert.alertType] || alert.alertType} ${alert.threshold}%`,
          type: 'holding'
        }))
      ]
    },
    'trade-plan': {
      label: '交易计划',
      description: '买入与止盈提醒',
      icon: TrendingUp,
      rules: tradePlans
        .filter((plan) => plan.notify?.enabled)
        .map((plan) => ({ id: plan.id, label: plan.name || plan.symbol, detail: plan.symbol || '交易计划', type: 'plan' }))
    },
    dca: {
      label: '定投提醒',
      description: '周期执行提醒',
      icon: Calendar,
      rules: dcaPlans
        .filter((plan) => plan.notify?.enabled)
        .map((plan) => ({ id: plan.id, label: plan.name || plan.symbol, detail: plan.schedule || plan.symbol || '定投计划', type: 'dca' }))
    },
    holdings: {
      label: '持仓收益',
      description: '每日组合收益',
      icon: Wallet,
      rules: holdingsRule?.enabled
        ? [{ id: 'holdings-daily', label: '持仓当日收益', detail: '全仓加权收益率', type: 'holdings' }]
        : []
    }
  }), [marketAlerts, holdingAlerts, tradePlans, dcaPlans, holdingsRule?.enabled]);

  const availableTypes = useMemo(
    () => Object.entries(ruleOptions).filter(([, option]) => option.rules.length > 0),
    [ruleOptions]
  );
  const currentRules = useMemo(
    () => ruleOptions[selectedType]?.rules || [],
    [ruleOptions, selectedType]
  );

  useEffect(() => {
    if (!open) return;
    const selectedTypeAvailable = availableTypes.some(([key]) => key === selectedType);
    if (!selectedTypeAvailable) {
      setSelectedType(availableTypes[0]?.[0] || 'price-alert');
      setSelectedId('');
      return;
    }
    if (!currentRules.some((rule) => rule.id === selectedId)) {
      setSelectedId(currentRules[0]?.id || '');
    }
  }, [open, selectedType, selectedId, availableTypes, currentRules]);

  useEffect(() => {
    if (!open) return undefined;
    function handleKeyDown(event) {
      if (event.key === 'Escape' && !sending) onClose?.();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, sending, onClose]);

  async function handleSend() {
    if (!selectedId || sending) return;
    setSending(true);
    try {
      await onSendTest?.(selectedType, selectedId);
      onClose?.();
    } finally {
      setSending(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="notify-test-dialog-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !sending) onClose?.();
      }}
    >
      <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-white/20 bg-white shadow-2xl shadow-slate-950/20">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-5 sm:px-6">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-violet-50 text-violet-600">
              <Send className="h-5 w-5" />
            </span>
            <div>
              <h2 id="notify-test-dialog-title" className="text-lg font-bold text-slate-900">发送测试通知</h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">选择一条已启用规则，验证当前账号下的接收渠道。</p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={sending} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50" aria-label="关闭测试通知弹窗">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-5 py-5 sm:px-6">
          {availableTypes.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-9 text-center">
              <Bell className="mx-auto h-8 w-8 text-slate-300" />
              <p className="mt-2 text-sm font-semibold text-slate-700">暂无可测试规则</p>
              <p className="mt-1 text-xs text-slate-500">先启用一条通知规则，再回来执行送达测试。</p>
            </div>
          ) : (
            <div className="space-y-5">
              <div>
                <div className="mb-2 text-xs font-semibold text-slate-500">1. 选择规则类型</div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="tablist" aria-label="测试规则类型">
                  {availableTypes.map(([key, option]) => {
                    const Icon = option.icon;
                    const selected = selectedType === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        role="tab"
                        aria-selected={selected}
                        className={cx(
                          'flex flex-col items-start rounded-xl border px-3 py-3 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300',
                          selected ? 'border-indigo-300 bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100' : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-200'
                        )}
                        onClick={() => {
                          setSelectedType(key);
                          setSelectedId(option.rules[0]?.id || '');
                        }}
                      >
                        <Icon className="h-4 w-4" />
                        <span className="mt-2 text-xs font-semibold">{option.label}</span>
                        <span className="mt-0.5 text-[10px] text-slate-400">{option.rules.length} 条</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="mb-2 text-xs font-semibold text-slate-500">2. 选择具体规则</div>
                <div className="space-y-2" role="radiogroup" aria-label="测试规则">
                  {currentRules.map((rule) => {
                    const selected = selectedId === rule.id;
                    return (
                      <button
                        key={rule.id}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        className={cx(
                          'flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300',
                          selected ? 'border-indigo-300 bg-indigo-50/70 ring-1 ring-indigo-100' : 'border-slate-200 bg-white hover:border-indigo-200 hover:bg-slate-50'
                        )}
                        onClick={() => setSelectedId(rule.id)}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-slate-900">{rule.label}</span>
                          <span className="mt-0.5 block truncate text-xs text-slate-500">{rule.detail}</span>
                        </span>
                        <span className={cx('flex h-5 w-5 shrink-0 items-center justify-center rounded-full border', selected ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-300 bg-white')}>
                          {selected ? <CheckCircle2 className="h-3.5 w-3.5" /> : null}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-xl border border-indigo-100 bg-indigo-50/70 px-4 py-3 text-xs leading-5 text-indigo-800">
                测试会发送到当前账号下所有已启用渠道，包括 Bark、Server酱³、Email 和可用的 PC 浏览器通知。
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-slate-100 bg-slate-50/70 px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
          <button type="button" onClick={onClose} className={secondaryButtonClass} disabled={sending}>取消</button>
          <button type="button" onClick={handleSend} className={cx(primaryButtonClass, (!selectedId || sending) && 'cursor-not-allowed opacity-60')} disabled={!selectedId || sending}>
            <Send className="h-4 w-4" />
            {sending ? '发送中…' : '发送测试'}
          </button>
        </div>
      </div>
    </div>
  );
}
