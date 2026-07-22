import { useEffect, useMemo, useState } from 'react';
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  Customized,
} from 'recharts';
import { fetchKline } from '../../app/marketsApi.js';
import { formatShanghaiDate, formatShanghaiTime } from '../../app/timeZone.js';

const UP = '#dc2626';
const DOWN = '#16a34a';

const BOX_STYLE = {
  margin: '8px 0',
  border: '1px solid #e2e8f0',
  borderRadius: 8,
  background: '#fff',
  padding: '8px 10px 6px',
};
const TITLE_STYLE = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  fontSize: 12,
  color: '#5f6368',
  marginBottom: 4,
};
const CHART_BOX = { width: '100%', height: 220 };
const TICK = { fontSize: 11, fill: '#5f6368' };
const CHART_MARGIN = { top: 4, right: 8, left: 0, bottom: 4 };
const TOOLTIP_BOX = {
  background: '#fff',
  border: '1px solid #e2e8f0',
  borderRadius: 6,
  fontSize: 12,
  padding: '6px 10px',
  lineHeight: 1.5,
};
const TT_TITLE = { color: '#1f1f1f', fontWeight: 600 };
const TT_MUTE = { color: '#5f6368' };
const LOAD_BOX = {
  width: '100%',
  height: 220,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#9aa0a6',
  fontSize: 12,
};
const ERROR_BODY = { fontSize: 12, color: '#9aa0a6' };
const TITLE_STRONG = { color: '#1f1f1f', fontWeight: 600 };
const DOWN_TEXT = { color: DOWN };

function fmtTime(ts, interval) {
  try {
    if (interval && /min|m$|h$/i.test(interval)) {
      return formatShanghaiTime(Number(ts) * 1000);
    }
    return formatShanghaiDate(Number(ts) * 1000).slice(5).replace('-', '/');
  } catch {
    return '';
  }
}

function CandlesLayer(props) {
  const { xAxisMap, yAxisMap, data } = props;
  if (!xAxisMap || !yAxisMap || !data) return null;
  const xAxis = Object.values(xAxisMap)[0];
  const yAxis = Object.values(yAxisMap)[0];
  if (!xAxis || !yAxis || typeof yAxis.scale !== 'function') return null;
  const xScale = xAxis.scale;
  const yScale = yAxis.scale;
  const bw = typeof xScale.bandwidth === 'function'
    ? xScale.bandwidth()
    : Math.max(2, (xAxis.width || 0) / Math.max(1, data.length));
  const w = Math.max(2, bw * 0.7);
  return (
    <g>
      {data.map((d, i) => {
        const cxRaw = xScale(d.label);
        if (typeof cxRaw !== 'number' || Number.isNaN(cxRaw)) return null;
        const cx = cxRaw + (typeof xScale.bandwidth === 'function' ? bw / 2 : 0);
        const color = d.c >= d.o ? UP : DOWN;
        const yH = yScale(d.h);
        const yL = yScale(d.l);
        const yTop = yScale(Math.max(d.o, d.c));
        const yBot = yScale(Math.min(d.o, d.c));
        const bodyH = Math.max(1, yBot - yTop);
        return (
          <g key={i}>
            <line x1={cx} x2={cx} y1={yH} y2={yL} stroke={color} strokeWidth={1} />
            <rect x={cx - w / 2} y={yTop} width={w} height={bodyH} fill={color} />
          </g>
        );
      })}
    </g>
  );
}

function CandleTooltip(props) {
  const active = props.active;
  const payload = props.payload;
  if (!active || !payload || !payload.length) return null;
  const d = payload[0].payload;
  if (!d) return null;
  const up = d.c >= d.o;
  const chg = d.o ? ((d.c - d.o) / d.o) * 100 : 0;
  const sign = { color: up ? UP : DOWN, fontWeight: 600 };
  return (
    <div style={TOOLTIP_BOX}>
      <div style={TT_TITLE}>{d.label}</div>
      <div style={TT_MUTE}>开 {d.o} · 收 {d.c}</div>
      <div style={TT_MUTE}>高 {d.h} · 低 {d.l}</div>
      <div style={sign}>{up ? '+' : ''}{chg.toFixed(2)}%</div>
    </div>
  );
}

export function MarketsKlineChart(props) {
  const symbol = props.symbol;
  const timeframe = props.timeframe || '1d';
  const [state, setState] = useState({ loading: true, error: null, data: null });
  useEffect(() => {
    let alive = true;
    setState({ loading: true, error: null, data: null });
    fetchKline(symbol, { timeframe })
      .then((res) => {
        if (!alive) return;
        setState({ loading: false, error: null, data: res });
      })
      .catch((err) => {
        if (!alive) return;
        setState({ loading: false, error: String((err && err.message) || err), data: null });
      });
    return () => { alive = false; };
  }, [symbol, timeframe]);

  const rows = useMemo(() => {
    const candles = state.data && Array.isArray(state.data.candles) ? state.data.candles : [];
    return candles.map((c) => ({
      label: fmtTime(c.t, state.data && state.data.interval),
      t: c.t,
      o: c.o,
      h: c.h,
      l: c.l,
      c: c.c,
      v: c.v,
    }));
  }, [state.data]);

  const stats = useMemo(() => {
    if (!rows.length) return null;
    const first = rows[0];
    const last = rows[rows.length - 1];
    const chg = first.c ? ((last.c - first.c) / first.c) * 100 : 0;
    return { last, chg };
  }, [rows]);

  if (state.loading) {
    return (
      <div style={BOX_STYLE}>
        <div style={TITLE_STYLE}>
          <span>{symbol} · {timeframe}</span>
          <span>加载中…</span>
        </div>
        <div style={LOAD_BOX}>正在拉取 K 线数据</div>
      </div>
    );
  }
  if (state.error || !rows.length) {
    return (
      <div style={BOX_STYLE}>
        <div style={TITLE_STYLE}>
          <span>{symbol} · {timeframe}</span>
          <span style={DOWN_TEXT}>无法加载</span>
        </div>
        <div style={ERROR_BODY}>{state.error || '暂无数据'}</div>
      </div>
    );
  }

  const statColor = stats && stats.chg >= 0 ? { color: UP, fontWeight: 600 } : { color: DOWN, fontWeight: 600 };
  return (
    <div style={BOX_STYLE}>
      <div style={TITLE_STYLE}>
        <span style={TITLE_STRONG}>{symbol} · {timeframe}</span>
        {stats ? (
          <span style={statColor}>
            {stats.last.c} {stats.chg >= 0 ? '+' : ''}{stats.chg.toFixed(2)}%
          </span>
        ) : null}
      </div>
      <div style={CHART_BOX}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={CHART_MARGIN}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f3f4" />
            <XAxis dataKey="label" tick={TICK} minTickGap={28} />
            <YAxis tick={TICK} domain={['auto', 'auto']} width={48} />
            <Tooltip content={<CandleTooltip />} />
            <Line type="monotone" dataKey="c" stroke="transparent" dot={false} isAnimationActive={false} />
            <Customized component={<CandlesLayer data={rows} />} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

const LINE_COLORS = ['#1a73e8', '#ef5350', '#26a69a', '#a142f4', '#f59e0b'];
const TT_DEFAULT = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 12 };

export function MarketsLineChart(props) {
  const title = props.title;
  const series = Array.isArray(props.series) ? props.series : [];
  const data = useMemo(() => {
    if (!series.length) return [];
    const xs = [];
    const seen = new Set();
    series.forEach((s) => (s.points || []).forEach((p) => {
      if (!seen.has(p.x)) { seen.add(p.x); xs.push(p.x); }
    }));
    return xs.map((x) => {
      const row = { x };
      series.forEach((s) => {
        const found = (s.points || []).find((p) => p.x === x);
        row[s.name] = found ? found.y : null;
      });
      return row;
    });
  }, [series]);

  if (!data.length) {
    return (
      <div style={BOX_STYLE}>
        <div style={TITLE_STYLE}><span>{title || '图表'}</span><span>无数据</span></div>
      </div>
    );
  }
  return (
    <div style={BOX_STYLE}>
      {title ? (
        <div style={TITLE_STYLE}><span style={TITLE_STRONG}>{title}</span></div>
      ) : null}
      <div style={CHART_BOX}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={CHART_MARGIN}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f3f4" />
            <XAxis dataKey="x" tick={TICK} minTickGap={28} />
            <YAxis tick={TICK} domain={['auto', 'auto']} width={48} />
            <Tooltip contentStyle={TT_DEFAULT} />
            {series.map((s, i) => (
              <Line
                key={s.name}
                type="monotone"
                dataKey={s.name}
                stroke={LINE_COLORS[i % LINE_COLORS.length]}
                dot={false}
                strokeWidth={1.5}
                isAnimationActive={false}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function parseKlineSpec(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  let symbol = '';
  let timeframe = '1d';
  if (text.includes('\n') || text.includes(':')) {
    text.split(/\r?\n/).forEach((line) => {
      const m = line.match(/^\s*(\w+)\s*[:=]\s*(.+?)\s*$/);
      if (m) {
        const k = m[1].toLowerCase();
        const v = m[2].trim();
        if (k === 'symbol' || k === 'code' || k === 'ticker') symbol = v;
        else if (k === 'timeframe' || k === 'tf' || k === 'interval') timeframe = v;
      } else {
        const tok = line.trim();
        if (tok && !symbol) symbol = tok;
      }
    });
  } else {
    const parts = text.split(/\s+/);
    symbol = parts[0] || '';
    if (parts[1]) timeframe = parts[1].replace(/^tf=/i, '');
  }
  if (!symbol) return null;
  return { symbol: symbol.toUpperCase(), timeframe };
}

export function MarketsChartCodeBlock(props) {
  const language = String(props.lang || '').toLowerCase();
  const value = props.value || '';
  if (language === 'kline' || language === 'candle' || language === 'candlestick') {
    const spec = parseKlineSpec(value);
    if (!spec) return null;
    return <MarketsKlineChart symbol={spec.symbol} timeframe={spec.timeframe} />;
  }
  if (language === 'chart' || language === 'linechart') {
    let cfg = null;
    try { cfg = JSON.parse(value); } catch { cfg = null; }
    if (!cfg) return null;
    if (cfg.type === 'kline' && cfg.symbol) {
      return <MarketsKlineChart symbol={String(cfg.symbol).toUpperCase()} timeframe={cfg.timeframe || '1d'} />;
    }
    if (Array.isArray(cfg.series)) {
      return <MarketsLineChart title={cfg.title} series={cfg.series} />;
    }
  }
  return null;
}

export default MarketsChartCodeBlock;
