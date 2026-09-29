// 各盘收益对比小表：收益率 / 轮动次数 / 最大回撤排行（回撤按净值序列计算）。
import { useMemo } from 'react';
import { cx } from '../../components/experience-ui.jsx';
import { formatPct, portfolioColor, premiumClass } from './quantFormat.js';

function maxDrawdownPct(series) {
  let peak = -Infinity;
  let drawdown = 0;
  for (const value of series) {
    if (!Number.isFinite(value)) continue;
    if (value > peak) peak = value;
    if (peak > 0) drawdown = Math.max(drawdown, ((peak - value) / peak) * 100);
  }
  return peak === -Infinity ? null : drawdown;
}

export function QuantComparisonCard({ specs, portfolios, nav, initialCapital }) {
  const rows = useMemo(() => {
    const list = (specs || []).map((spec, index) => {
      const data = (portfolios || {})[spec.key] || {};
      const series = (nav || []).map((point) => Number(point[spec.key]));
      const pnlPct = Number(data.pnl_pct);
      return {
        key: spec.key,
        label: spec.label,
        color: portfolioColor(index, spec.archived),
        pnlPct: Number.isFinite(pnlPct) ? pnlPct : null,
        rotations: Number(data.rotation_count) || 0,
        drawdown: maxDrawdownPct(series)
      };
    });
    list.sort((a, b) => (b.pnlPct ?? -Infinity) - (a.pnlPct ?? -Infinity));
    return list;
  }, [specs, portfolios, nav]);
  const capital = Number(initialCapital) || 1000000;
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold text-slate-700">各盘收益对比</h2>
        <span className="text-xs text-slate-400">本金 ¥{(capital / 10000).toFixed(0)}万 / 盘</span>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-slate-100">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">#</th>
              <th className="px-3 py-2 text-left">盘名</th>
              <th className="px-3 py-2 text-right">收益率</th>
              <th className="px-3 py-2 text-right">轮动次数</th>
              <th className="px-3 py-2 text-right">最大回撤</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length ? (
              rows.map((row, idx) => (
                <tr key={row.key}>
                  <td className="px-3 py-2 tabular-nums text-slate-400">{idx + 1}</td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ backgroundColor: row.color }}
                      />
                      <span className="font-semibold text-slate-800">{row.label}</span>
                    </span>
                  </td>
                  <td className={cx('px-3 py-2 text-right font-bold tabular-nums', premiumClass(row.pnlPct))}>
                    {formatPct(row.pnlPct, 4)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-700">{row.rotations}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-rose-600">
                    {row.drawdown == null ? '—' : `−${row.drawdown.toFixed(2)}%`}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-slate-400">
                  暂无数据
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
