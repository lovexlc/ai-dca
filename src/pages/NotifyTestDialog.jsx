import { X, Send } from 'lucide-react';
import { cx, primaryButtonClass, secondaryButtonClass } from '../components/experience-ui.jsx';
import { useState } from 'react';

export function NotifyTestDialog({
  open,
  onClose,
  marketAlerts,
  holdingAlerts,
  tradePlans,
  dcaPlans,
  holdingsRule,
  onSendTest
}) {
  const [selectedType, setSelectedType] = useState('price-alert');
  const [selectedId, setSelectedId] = useState('');
  const [sending, setSending] = useState(false);

  const ruleOptions = {
    'price-alert': {
      label: '价格预警',
      rules: [
        ...marketAlerts.map(a => ({ id: a.id, label: `${a.name || a.symbol} - ${a.alertType}`, type: 'market' })),
        ...holdingAlerts.map(a => ({ id: a.id, label: `${a.name || a.symbol} - ${a.alertType}`, type: 'holding' }))
      ]
    },
    'trade-plan': {
      label: '交易计划',
      rules: tradePlans.filter(p => p.notify?.enabled).map(p => ({ id: p.id, label: p.name || p.symbol, type: 'plan' }))
    },
    'dca': {
      label: '定投提醒',
      rules: dcaPlans.filter(d => d.notify?.enabled).map(d => ({ id: d.id, label: d.name || d.symbol, type: 'dca' }))
    },
    'holdings': {
      label: '持仓收益',
      rules: holdingsRule?.enabled ? [{ id: 'holdings-daily', label: '持仓当日收益', type: 'holdings' }] : []
    }
  };

  const availableTypes = Object.entries(ruleOptions).filter(([_, opt]) => opt.rules.length > 0);

  async function handleSend() {
    if (!selectedId) return;
    setSending(true);
    try {
      await onSendTest(selectedType, selectedId);
      onClose();
    } finally {
      setSending(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-900">发送测试通知</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            <X size={20} />
          </button>
        </div>

        <div className="space-y-4 px-6 py-4">
          {availableTypes.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center">
              <p className="text-sm text-slate-600">暂无启用的通知规则</p>
              <p className="mt-1 text-xs text-slate-500">请先创建并启用通知规则</p>
            </div>
          ) : (
            <>
              <div>
                <label className="block text-sm font-medium text-slate-700">选择规则类型</label>
                <select
                  value={selectedType}
                  onChange={(e) => {
                    setSelectedType(e.target.value);
                    setSelectedId('');
                  }}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  {availableTypes.map(([key, opt]) => (
                    <option key={key} value={key}>{opt.label}</option>
                  ))}
                </select>
              </div>

              {ruleOptions[selectedType]?.rules.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-slate-700">选择具体规则</label>
                  <select
                    value={selectedId}
                    onChange={(e) => setSelectedId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    <option value="">请选择...</option>
                    {ruleOptions[selectedType].rules.map(rule => (
                      <option key={rule.id} value={rule.id}>{rule.label}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs text-slate-600">
                  💡 测试通知将发送到所有已配置的推送渠道（iOS Bark、Server酱³、PC 浏览器）
                </p>
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end gap-3 border-t border-slate-200 px-6 py-4">
          <button
            onClick={onClose}
            className={secondaryButtonClass}
            disabled={sending}
          >
            取消
          </button>
          <button
            onClick={handleSend}
            className={cx(primaryButtonClass, (!selectedId || sending) && 'cursor-not-allowed opacity-60')}
            disabled={!selectedId || sending}
          >
            <Send size={16} />
            {sending ? '发送中...' : '发送测试'}
          </button>
        </div>
      </div>
    </div>
  );
}
