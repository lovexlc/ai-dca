import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
  ComposedChart,
  Area,
  LabelList
} from 'recharts';

/**
 * 智能格式化时间轴标签
 * 根据日期格式自动判断是日线还是分钟线
 */
function formatTimeLabel(value) {
  if (!value) return '';

  // 判断是否包含时间信息（分钟线格式：YYYY-MM-DD HH:mm）
  if (value.includes(':')) {
    // 分钟线：显示 MM-DD HH:mm
    const parts = value.split(' ');
    if (parts.length === 2) {
      const date = parts[0].slice(5, 10); // MM-DD
      const time = parts[1].slice(0, 5);  // HH:mm
      return `${date} ${time}`;
    }
  }

  // 日线：只显示 MM-DD
  return value.slice(5, 10);
}

/**
 * 从时间戳或日期字符串生成带时间的日期标签
 */
function formatDateTime(row) {
  if (row.datetime) return String(row.datetime).slice(0, 16).replace('T', ' ');

  // 优先使用 ts 时间戳
  if (row.ts) {
    // 判断是秒还是毫秒时间戳
    // 如果小于 10000000000，则是秒级时间戳，需要转换为毫秒
    const timestamp = row.ts < 10000000000 ? row.ts * 1000 : row.ts;

    // 验证时间戳是否在合理范围内（2020-2030年之间）
    // 2020-01-01: 1577836800000, 2030-12-31: 1924905600000
    if (timestamp < 1577836800000 || timestamp > 1924905600000) {
      // 时间戳超出合理范围，回退到 date 字段
      return row.date || '';
    }

    const date = new Date(timestamp);

    // 验证日期是否有效
    if (isNaN(date.getTime())) {
      return row.date || '';
    }

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}`;
  }

  // 否则使用 date 字段
  return row.date;
}

/**
 * EquityChart - 权益曲线图表
 */
export function EquityChart({ data }) {
  if (!data || data.length === 0) {
    return <EmptyChart message="暂无权益数据" />;
  }

  const chartData = data.map(row => ({
    date: formatDateTime(row),
    equity: row.equity,
    cash: row.cash
  }));

  const maxEquity = Math.max(...chartData.map(d => d.equity));
  const minEquity = Math.min(...chartData.map(d => d.equity));
  const padding = Math.max((maxEquity - minEquity) * 0.1, Math.abs(maxEquity) * 0.001, 1);

  return (
    <ResponsiveContainer width="100%" height={400}>
      <ComposedChart data={chartData}>
        <defs>
          <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.3}/>
            <stop offset="95%" stopColor="#4f46e5" stopOpacity={0}/>
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11, fill: '#64748b' }}
          tickFormatter={formatTimeLabel}
          angle={-45}
          textAnchor="end"
          height={80}
        />
        <YAxis
          tick={{ fontSize: 12, fill: '#64748b' }}
          domain={[minEquity - padding, maxEquity + padding]}
          tickFormatter={(value) => `¥${(value / 1000).toFixed(0)}k`}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            fontSize: '12px'
          }}
          formatter={(value) => `¥${Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`}
          labelFormatter={(label) => `时间: ${label}`}
        />
        <Legend
          wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }}
        />
        <Area
          type="monotone"
          dataKey="equity"
          fill="url(#equityGradient)"
          stroke="#4f46e5"
          strokeWidth={2}
          name="权益"
        />
        <Line
          type="monotone"
          dataKey="cash"
          stroke="#10b981"
          strokeWidth={2}
          dot={false}
          name="现金"
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/**
 * KlineChart - K线+信号标记图表
 */
export function KlineChart({ candles, signals }) {
  if (!candles || candles.length === 0) {
    return <EmptyChart message="暂无K线数据" />;
  }

  const signalByTs = new Map(
    (Array.isArray(signals) ? signals : [])
      .map((signal) => [Number(signal.ts), signal])
      .filter(([ts]) => Number.isFinite(ts))
  );

  const chartData = candles.map((candle) => {
    const ts = Number(candle.t);
    const signal = signalByTs.get(ts);

    // 从时间戳生成带时间的日期
    let dateLabel = candle.date;
    if (candle.t) {
      // 判断是秒还是毫秒时间戳
      const timestamp = candle.t < 10000000000 ? candle.t * 1000 : candle.t;

      // 验证时间戳是否在合理范围内（2020-2030年之间）
      if (timestamp >= 1577836800000 && timestamp <= 1924905600000) {
        const date = new Date(timestamp);

        // 验证日期是否有效
        if (!isNaN(date.getTime())) {
          const year = date.getFullYear();
          const month = String(date.getMonth() + 1).padStart(2, '0');
          const day = String(date.getDate()).padStart(2, '0');
          const hours = String(date.getHours()).padStart(2, '0');
          const minutes = String(date.getMinutes()).padStart(2, '0');
          dateLabel = `${year}-${month}-${day} ${hours}:${minutes}`;
        }
      }
    }

    return {
      ts,
      date: dateLabel,
      close: candle.close,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      signal: signal ? `${signal.rule}: ${signal.fromCode}→${signal.toCode}` : null
    };
  });

  return (
    <ResponsiveContainer width="100%" height={400}>
      <ComposedChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11, fill: '#64748b' }}
          tickFormatter={formatTimeLabel}
          angle={-45}
          textAnchor="end"
          height={80}
        />
        <YAxis
          tick={{ fontSize: 12, fill: '#64748b' }}
          tickFormatter={(value) => value.toFixed(3)}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            fontSize: '12px'
          }}
          labelFormatter={(label) => `时间: ${label}`}
        />
        <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
        <Line
          type="monotone"
          dataKey="close"
          stroke="#6366f1"
          strokeWidth={2}
          dot={false}
          name="收盘价"
        />
        {signals?.map((signal, idx) => {
          const point = chartData.find(d => d.ts === Number(signal.ts));
          if (!point) return null;
          return (
            <ReferenceLine
              key={idx}
              x={point.date}
              stroke={signal.rule === 'A' ? '#10b981' : '#6366f1'}
              strokeDasharray="3 3"
              label={{
                value: signal.rule,
                position: 'top',
                fill: signal.rule === 'A' ? '#10b981' : '#6366f1',
                fontSize: 12,
                fontWeight: 'bold'
              }}
            />
          );
        })}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/**
 * PremiumChart - 溢价差图表
 */
export function PremiumChart({ data, signals = [], trades = [] }) {
  if (!data || data.length === 0) {
    return <EmptyChart message="暂无溢价差数据" />;
  }

  const signalByTs = new Map(
    (Array.isArray(signals) ? signals : [])
      .map((signal) => [Number(signal.ts), signal])
      .filter(([ts]) => Number.isFinite(ts))
  );
  const tradesByTs = new Map();
  for (const trade of Array.isArray(trades) ? trades : []) {
    const ts = Number(trade?.ts ?? trade?.date);
    if (!Number.isFinite(ts)) continue;
    const list = tradesByTs.get(ts) || [];
    list.push(trade);
    tradesByTs.set(ts, list);
  }
  const gapValues = data.map((row) => Number(row.gapPct)).filter((value) => Number.isFinite(value));
  const gapRange = gapValues.length ? Math.max(...gapValues) - Math.min(...gapValues) : 0;
  const markerOffset = Math.max(gapRange * 0.035, 0.08);

  const chartData = data.map(row => ({
    ts: Number(row.ts),
    date: formatDateTime(row),
    highPremium: row.highPremiumPct,
    lowPremium: row.lowPremiumPct,
    gap: row.gapPct,
    switchGap: signalByTs.has(Number(row.ts)) ? row.gapPct : null
  })).filter(d => d.highPremium !== undefined).map((item) => {
    const itemTrades = tradesByTs.get(item.ts) || [];
    const buyTrade = itemTrades.find((trade) => trade?.type === 'buy');
    const sellTrade = itemTrades.find((trade) => trade?.type === 'sell');
    const gap = Number(item.gap);
    return {
      ...item,
      buyGap: buyTrade && Number.isFinite(gap) ? gap - markerOffset : null,
      sellGap: sellTrade && Number.isFinite(gap) ? gap + markerOffset : null,
      buyLabel: buyTrade ? `买 ${buyTrade.code}` : '',
      sellLabel: sellTrade ? `卖 ${sellTrade.code}` : '',
      buyTrade,
      sellTrade
    };
  });

  return (
    <ResponsiveContainer width="100%" height={400}>
      <LineChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11, fill: '#64748b' }}
          tickFormatter={formatTimeLabel}
          angle={-45}
          textAnchor="end"
          height={80}
        />
        <YAxis
          tick={{ fontSize: 12, fill: '#64748b' }}
          tickFormatter={(value) => `${value.toFixed(1)}%`}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            fontSize: '12px'
          }}
          formatter={(value, name) => {
            if (name === '买入点' || name === '卖出点') return '';
            return `${Number(value).toFixed(2)}%`;
          }}
          labelFormatter={(label) => `时间: ${label}`}
        />
        <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
        <Line
          type="monotone"
          dataKey="highPremium"
          stroke="#ef4444"
          strokeWidth={2}
          dot={false}
          name="高溢价 (%)"
        />
        <Line
          type="monotone"
          dataKey="lowPremium"
          stroke="#10b981"
          strokeWidth={2}
          dot={false}
          name="低溢价 (%)"
        />
        <Line
          type="monotone"
          dataKey="gap"
          stroke="#6366f1"
          strokeWidth={3}
          dot={false}
          name="溢价差 (%)"
        />
        <Line
          type="monotone"
          dataKey="switchGap"
          stroke="transparent"
          dot={{ r: 5, fill: '#f97316', stroke: '#ffffff', strokeWidth: 2 }}
          activeDot={{ r: 7, fill: '#f97316', stroke: '#ffffff', strokeWidth: 2 }}
          connectNulls={false}
          name="切换点"
        />
        <Line
          type="monotone"
          dataKey="sellGap"
          stroke="transparent"
          dot={{ r: 6, fill: '#ef4444', stroke: '#ffffff', strokeWidth: 2 }}
          activeDot={{ r: 8, fill: '#ef4444', stroke: '#ffffff', strokeWidth: 2 }}
          connectNulls={false}
          name="卖出点"
          isAnimationActive={false}
        >
          <LabelList dataKey="sellLabel" position="top" fontSize={11} fill="#b91c1c" fontWeight={700} />
        </Line>
        <Line
          type="monotone"
          dataKey="buyGap"
          stroke="transparent"
          dot={{ r: 6, fill: '#10b981', stroke: '#ffffff', strokeWidth: 2 }}
          activeDot={{ r: 8, fill: '#10b981', stroke: '#ffffff', strokeWidth: 2 }}
          connectNulls={false}
          name="买入点"
          isAnimationActive={false}
        >
          <LabelList dataKey="buyLabel" position="bottom" fontSize={11} fill="#047857" fontWeight={700} />
        </Line>
        {signals?.map((signal, idx) => {
          const point = chartData.find(d => d.ts === Number(signal.ts));
          if (!point) return null;
          return (
            <ReferenceLine
              key={idx}
              x={point.date}
              stroke={signal.rule === 'A' ? '#10b981' : '#6366f1'}
              strokeDasharray="3 3"
              label={{
                value: `${signal.rule}切换`,
                position: 'top',
                fill: signal.rule === 'A' ? '#10b981' : '#6366f1',
                fontSize: 12,
                fontWeight: 'bold'
              }}
            />
          );
        })}
        <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="3 3" />
      </LineChart>
    </ResponsiveContainer>
  );
}

function EmptyChart({ message }) {
  return (
    <div className="flex h-96 items-center justify-center text-slate-400">
      <div className="text-center">
        <p className="text-sm">{message}</p>
      </div>
    </div>
  );
}
