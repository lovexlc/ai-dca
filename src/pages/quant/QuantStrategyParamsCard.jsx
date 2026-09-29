// 策略参数卡：标的宇宙、触发口径说明与撮合参数。
import { formatShares } from './quantFormat.js';

export function QuantStrategyParamsCard({ strategy, symbols, symbolNames }) {
  const feeRate = Number(strategy?.fee_rate);
  const lotShares = Number(strategy?.lot_shares);
  const minOrderShares = Number(strategy?.min_order_shares);
  const capital = Number(strategy?.initial_capital);
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-bold text-slate-700">策略参数</h2>
      <div className="mt-3 text-xs leading-6 text-slate-500">
        触发口径：
        <span className="font-semibold text-slate-700">
          （持仓溢价 − 全市场最低溢价）&gt; Q 则换到最低溢价者
        </span>
        ；空仓时买入全市场溢价最低者，每盘只持有一只并全仓切换。
      </div>
      <div className="mt-3">
        <div className="text-xs text-slate-400">标的宇宙（{symbols?.length || 0} 只）</div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {(symbols || []).map((code) => (
            <span key={code} className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-600">
              <span className="font-semibold text-slate-800">{symbolNames[code] || code}</span>
              <span className="ml-1 tabular-nums text-slate-400">{code}</span>
            </span>
          ))}
        </div>
      </div>
      <div className="mt-3 space-y-2 border-t border-slate-100 pt-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-slate-400">每盘初始资金</span>
          <span className="font-semibold tabular-nums text-slate-800">
            {Number.isFinite(capital) ? `¥${(capital / 10000).toFixed(0)}万` : '—'}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-slate-400">手续费（双边）</span>
          <span className="font-semibold tabular-nums text-slate-800">
            {Number.isFinite(feeRate) && feeRate > 0 ? `万${(feeRate * 10000).toFixed(1)}` : '—'}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-slate-400">下单粒度</span>
          <span className="font-semibold tabular-nums text-slate-800">
            {Number.isFinite(lotShares) ? `${formatShares(lotShares)} 份/笔` : '—'}
            {Number.isFinite(minOrderShares) && minOrderShares > 0 ? (
              <span className="ml-1 text-xs font-normal text-slate-400">最低 {formatShares(minOrderShares)} 份</span>
            ) : null}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-slate-400">买入冲击模型</span>
          <span className="font-semibold text-slate-800">平方根 · 上限 1%</span>
        </div>
      </div>
    </div>
  );
}
