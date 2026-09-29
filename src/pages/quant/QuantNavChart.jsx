// 净值曲线：4 个并行盘各一条线 + 本金参考线。
import { useMemo } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { DARK_TOOLTIP, formatAxisTime, formatClock, formatMoney, portfolioColor } from './quantFormat.js';

export function QuantNavChart({ nav, specs, initialCapital }) {
  const data = useMemo(
    () =>
      (nav || []).map((point) => {
        const row = { t: point.t, 本金: Number(initialCapital) || 1000000 };
        for (const spec of specs || []) {
          row[spec.label] = Number(point[spec.key]);
        }
        return row;
      }),
    [nav, specs, initialCapital]
  );
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-center text-sm font-bold text-slate-700">账户净值</h2>
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
                tickFormatter={(v) => `¥${(v / 10000).toFixed(2)}万`}
                domain={['auto', 'auto']}
                width={72}
              />
              <Tooltip
                contentStyle={DARK_TOOLTIP}
                labelFormatter={formatClock}
                formatter={(v) => [formatMoney(v), '']}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {(specs || []).map((spec, index) => (
                <Line
                  key={spec.key}
                  type="monotone"
                  dataKey={spec.label}
                  stroke={portfolioColor(index)}
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                />
              ))}
              <Line
                type="monotone"
                dataKey="本金"
                stroke="#9ca3af"
                strokeWidth={1.5}
                strokeDasharray="5 4"
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-slate-400">
            暂无净值数据（盘中每秒记录）
          </div>
        )}
      </div>
    </div>
  );
}
