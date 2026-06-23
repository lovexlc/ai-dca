import { Clock, TrendingUp } from 'lucide-react';
import { getLastTransaction, getRegularInvestmentSuggestions } from './holdingsQuickTransaction.js';

export function QuickTransactionButtons({ onFillDraft }) {
  const lastTx = getLastTransaction();
  const suggestions = getRegularInvestmentSuggestions();

  if (!lastTx && suggestions.length === 0) return null;

  return (
    <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="text-xs font-semibold text-slate-600">快速操作</div>
      <div className="flex flex-wrap gap-2">
        {lastTx && (
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200 transition-colors hover:bg-slate-50 hover:text-slate-900"
            onClick={() => onFillDraft({
              code: lastTx.code,
              name: lastTx.name,
              type: lastTx.type,
              kind: lastTx.kind || 'otc',
              amount: lastTx.amount > 0 ? String(lastTx.amount) : '',
              shares: '',
              price: '',
            })}
          >
            <Clock size={14} />
            重复上次：{lastTx.name || lastTx.code} {lastTx.type === 'BUY' ? '买入' : '卖出'}
          </button>
        )}
        {suggestions.map((sug, idx) => (
          <button
            key={idx}
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-indigo-700 ring-1 ring-indigo-200 transition-colors hover:bg-indigo-50"
            onClick={() => onFillDraft({
              code: sug.code,
              name: sug.name,
              type: 'BUY',
              kind: sug.kind || 'otc',
              amount: String(sug.suggestedAmount),
              shares: '',
              price: '',
            })}
          >
            <TrendingUp size={14} />
            {sug.name || sug.code} 定投 ¥{sug.suggestedAmount.toFixed(0)}
          </button>
        ))}
      </div>
    </div>
  );
}
