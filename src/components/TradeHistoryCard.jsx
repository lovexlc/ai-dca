import { cx } from './experience-ui.jsx';
import { formatTradeDateTime } from '../app/tradeDisplay.js';

/**
 * TradeHistoryCard - 交易历史卡片组件
 * 用于移动端友好的交易记录展示
 */
export function TradeHistoryCard({ trade }) {
  const isBuy = trade.type === 'buy';
  const settlementValue = isBuy ? (trade.totalCost ?? trade.amount) : (trade.netProceeds ?? trade.amount);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-base font-bold text-slate-900">{trade.code}</span>
            <span className={cx(
              'inline-flex rounded-full px-2 py-0.5 text-xs font-bold',
              isBuy
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-rose-100 text-rose-700'
            )}>
              {isBuy ? '买入' : '卖出'}
            </span>
          </div>
          <div className="mt-1 text-xs text-slate-500">{formatTradeDateTime(trade)}</div>
        </div>
        <div className="text-right">
          <div className="text-base font-bold text-slate-900">
            {formatMoney(settlementValue)}
          </div>
          <div className="text-xs text-slate-500">结算金额</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm border-t border-slate-100 pt-3">
        <div>
          <span className="text-slate-600">股数: </span>
          <span className="font-semibold text-slate-900">{formatNumber(trade.shares, 0)}</span>
        </div>
        <div>
          <span className="text-slate-600">价格: </span>
          <span className="font-semibold text-slate-900">{formatPrice(trade.price)}</span>
        </div>
        <div>
          <span className="text-slate-600">金额: </span>
          <span className="font-semibold text-slate-900">{formatMoney(trade.amount)}</span>
        </div>
        <div>
          <span className="text-slate-600">手续费: </span>
          <span className="font-semibold text-slate-600">{formatMoney(trade.fee)}</span>
        </div>
      </div>
    </div>
  );
}

// 格式化辅助函数
function formatMoney(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '--';
  return `¥${num.toLocaleString('zh-CN', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}

function formatNumber(value, digits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '--';
  return num.toLocaleString('zh-CN', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function formatPrice(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return '--';
  return num.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}
