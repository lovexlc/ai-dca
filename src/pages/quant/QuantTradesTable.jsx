// 成交明细：账户筛选（4 新盘 + 归档选项），标的显示名称+代码，保留交易原因。
import { useMemo, useState } from 'react';
import { cx } from '../../components/experience-ui.jsx';
import { formatClock, formatMoney, formatShares, portfolioColor } from './quantFormat.js';

const ALL_FILTER = 'all';
const ARCHIVED_FILTER = 'archived';

function buildFilterOptions(specs) {
  return [
    { value: ALL_FILTER, label: '全部账户' },
    ...(specs || []).filter((spec) => !spec.archived).map((spec) => ({ value: spec.key, label: spec.label })),
    { value: ARCHIVED_FILTER, label: '归档盘' }
  ];
}

export function QuantTradesTable({ trades, specs, symbolNames }) {
  const [filter, setFilter] = useState(ALL_FILTER);
  const specByKey = useMemo(
    () => new Map((specs || []).map((spec, index) => [spec.key, { spec, index }])),
    [specs]
  );
  const options = useMemo(() => buildFilterOptions(specs), [specs]);
  const visible = useMemo(() => {
    if (filter === ALL_FILTER) return trades;
    if (filter === ARCHIVED_FILTER) {
      return trades.filter((t) => specByKey.get(t.portfolio)?.spec.archived);
    }
    return trades.filter((t) => t.portfolio === filter);
  }, [trades, filter, specByKey]);
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-bold text-slate-700">成交明细</h2>
        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
          {visible.length} 笔（最近）
        </span>
        <label className="ml-auto flex items-center gap-2 text-xs text-slate-400">
          账户
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-200"
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="max-h-96 overflow-auto rounded-2xl border border-slate-100">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">账户</th>
              <th className="px-3 py-2 text-left">时间</th>
              <th className="px-3 py-2 text-left">标的</th>
              <th className="px-3 py-2 text-left">方向</th>
              <th className="px-3 py-2 text-left">交易原因</th>
              <th className="px-3 py-2 text-right">成交份数</th>
              <th className="px-3 py-2 text-right">成交均价</th>
              <th className="px-3 py-2 text-right">对手一档价</th>
              <th className="px-3 py-2 text-right">冲击成本</th>
              <th className="px-3 py-2 text-right">吃档</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visible.length ? (
              visible.map((t, idx) => {
                const entry = specByKey.get(t.portfolio);
                const color = entry ? portfolioColor(entry.index, entry.spec.archived) : '#94a3b8';
                return (
                  <tr key={`${t.timestamp}-${t.portfolio}-${idx}`}>
                    <td className="whitespace-nowrap px-3 py-2">
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className="inline-block h-2 w-2 rounded-full"
                          style={{ backgroundColor: color }}
                        />
                        <span className="text-xs font-semibold text-slate-600">
                          {entry?.spec.label || t.portfolio}
                        </span>
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs tabular-nums text-slate-500">
                      {formatClock(t.timestamp)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <span className="text-xs font-semibold text-slate-700">
                        {symbolNames[t.symbol] || ''}
                      </span>
                      <span className="ml-1 text-xs tabular-nums text-slate-400">{t.symbol}</span>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={cx('font-bold', t.side === 'buy' ? 'text-rose-600' : 'text-emerald-600')}
                      >
                        {t.side === 'buy' ? '买入' : '卖出'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500">{t.reason || '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                      {formatShares(t.shares)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                      {Number.isFinite(Number(t.avg_price)) ? Number(t.avg_price).toFixed(3) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                      {Number.isFinite(Number(t.counter_price)) ? Number(t.counter_price).toFixed(3) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                      {formatMoney(t.impact_cost)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                      {Number(t.levels_consumed) || '—'}
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={10} className="px-3 py-8 text-center text-slate-400">
                  暂无成交记录
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
