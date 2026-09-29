// 全市场极差曲线：max 溢价 − min 溢价（仅展示用）。
import { useMemo } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { DARK_TOOLTIP, formatAxisTime, formatClock } from './quantFormat.js';

const SPREAD_KEY = '极差(%)';

export function QuantSpreadChart({ spread }) {
  const data = useMemo(
    () =>
      (spread || []).map((point) => ({
        t: point.t,
        [SPREAD_KEY]: Number(point.spread)
      })),
    [spread]
  );
  const domain = useMemo(() => {
    const vals = data.map((p) => p[SPREAD_KEY]).filter(Number.isFinite);
    if (!vals.length) return ['auto', 'auto'];
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const pad = Math.max((max - min) * 0.15, 0.2);
    return [Math.max(0, min - pad), max + pad];
  }, [data]);
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-center text-sm font-bold text-slate-700">全市场极差（最高−最低）</h2>
      <div className="mt-2 h-64">
        {data.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis
                dataKey="t"
                tickFormatter={formatAxisTime}
                tick={{ fontSize: 11, fill: '#94a3b8' }}
                minTickGap={48}
              />
              <YAxis
                tick={{ fontSize: 11, fill: '#94a3b8' }}
                tickFormatter={(v) => `${Number(v).toFixed(1)}%`}
                domain={domain}
                width={56}
              />
              <Tooltip
                contentStyle={DARK_TOOLTIP}
                labelFormatter={formatClock}
                formatter={(v) => [`${Number(v).toFixed(3)}%`, '']}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey={SPREAD_KEY} stroke="#111827" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-slate-400">
            暂无极差数据（盘中每秒记录）
          </div>
        )}
      </div>
    </div>
  );
}
