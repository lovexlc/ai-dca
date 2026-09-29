// 4 个并行模拟盘的账户小卡片：紧凑网格展示净值/收益率/持仓/成本。
import { cx } from '../../components/experience-ui.jsx';
import { formatMoney, formatPct, formatShares, portfolioColor, premiumClass } from './quantFormat.js';

function AccountMiniCard({ spec, index, data, symbolNames }) {
  const d = data || {};
  const holdings = Object.entries(d.holdings || {}).filter(([, shares]) => Number(shares) > 0);
  const color = portfolioColor(index);
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
          <span className="text-sm font-bold text-slate-800">{spec.label}</span>
        </div>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-slate-500">
          Q {Number(spec.q_threshold).toFixed(1)}
        </span>
      </div>
      <div className="mt-2 text-2xl font-bold tabular-nums text-slate-900">{formatMoney(d.market_value)}</div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-400">收益率</span>
        <span className={cx('font-bold tabular-nums', premiumClass(d.pnl_pct))}>
          {formatPct(d.pnl_pct, 4)}
        </span>
      </div>
      <div className="mt-2 space-y-1.5 border-t border-slate-100 pt-2 text-xs">
        <div className="flex items-center justify-between">
          <span className="text-slate-400">持仓</span>
          <span className="font-semibold tabular-nums text-slate-700">
            {holdings.length
              ? holdings
                  .map(([code, shares]) => `${symbolNames[code] || code} ${formatShares(shares)}份`)
                  .join(' · ')
              : '空仓'}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-slate-400">轮动次数</span>
          <span className="font-semibold tabular-nums text-slate-700">{Number(d.rotation_count) || 0}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-slate-400">累计手续费</span>
          <span className="font-semibold tabular-nums text-slate-700">{formatMoney(d.total_fees)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-slate-400">累计冲击成本</span>
          <span className="font-semibold tabular-nums text-slate-700">
            {formatMoney(d.total_impact_cost)}
          </span>
        </div>
      </div>
    </div>
  );
}

export function QuantAccountCards({ specs, portfolios, symbolNames }) {
  return (
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {(specs || []).map((spec, index) => (
        <AccountMiniCard
          key={spec.key}
          spec={spec}
          index={index}
          data={(portfolios || {})[spec.key]}
          symbolNames={symbolNames}
        />
      ))}
    </section>
  );
}
