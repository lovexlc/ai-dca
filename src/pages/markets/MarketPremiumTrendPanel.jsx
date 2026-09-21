import React, { useEffect, useMemo, useRef, useState } from 'react';

const BASE = String(import.meta.env?.VITE_MARKETS_API_BASE || '/api/market-collector').replace(/\/$/, '');
const COLORS = ['#1468f3', '#e5484d', '#0aa870', '#f08c2e', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#dc6b19', '#4f46e5', '#0f766e', '#be123c', '#9333ea', '#0284c7'];
const FALLBACK_GROUPS = [
  { key: 'all', label: '全部' },
  { key: 'nasdaq-100', label: '纳指 100' },
  { key: 'nasdaq-tech', label: '美国科技' },
];

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function codeOf(value) {
  return String(value || '').replace(/\D/g, '');
}

function isLof(item) {
  const code = codeOf(item?.code || item?.key);
  const name = String(item?.name || item?.label || '');
  return /^16/.test(code) || /LOF|联接/i.test(name);
}

function formatPercent(value) {
  const parsed = number(value);
  if (parsed == null) return '—';
  return `${parsed >= 0 ? '+' : ''}${parsed.toFixed(2)}%`;
}

function formatTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function median(items = []) {
  const values = items.map((item) => number(item)).filter((item) => item != null).sort((a, b) => a - b);
  if (!values.length) return null;
  const middle = Math.floor(values.length / 2);
  return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
}

function boundaryGap(highItems = [], lowItems = []) {
  const high = highItems.map((item) => number(item?.premium)).filter((item) => item != null);
  const low = lowItems.map((item) => number(item?.premium)).filter((item) => item != null);
  if (!high.length || !low.length) return null;
  return Math.min(...high) - Math.max(...low);
}

async function fetchHomeMarketSeries(signal) {
  const response = await fetch(`${BASE}/aggregates/home-market-series`, {
    headers: { accept: 'application/json' },
    cache: 'no-store',
    signal,
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  return payload?.payload || payload;
}

function fallbackSeries(rows = []) {
  const time = new Date().toISOString();
  return rows.filter((row) => number(row?.currentPrice) != null || number(row?.premium) != null).map((row) => ({
    key: codeOf(row.code),
    code: row.code,
    name: row.shortName || row.name || row.code,
    groupKey: 'all',
    points: [{ time, price: row.currentPrice, premiumPercent: row.premium }],
  }));
}

function TrendChart({ series = [], mode = 'premium' }) {
  const [cursor, setCursor] = useState(null);
  const chartRef = useRef(null);
  const W = 720;
  const H = 280;
  const P = 18;
  const plotRight = 520;

  const model = useMemo(() => {
    const rows = series.map((line, index) => ({
      ...line,
      color: COLORS[index % COLORS.length],
      points: (line.points || []).map((point) => ({
        ...point,
        value: number(point.value ?? (mode === 'premium' ? point.premiumPercent : point.price)),
      })).filter((point) => point.value != null),
    })).filter((line) => line.points.length);
    const values = rows.flatMap((line) => line.points.map((point) => point.value));
    if (!values.length) return { rows, min: 0, max: 1, length: 0, labels: [] };
    const min = Math.min(...values);
    const max = Math.max(...values);
    const pad = Math.max((max - min) * 0.12, mode === 'premium' ? 0.1 : 0.01);
    const yFor = (value) => H - P - ((value - (min - pad)) / Math.max((max + pad) - (min - pad), 0.0001)) * (H - P * 2);
    const top = P + 5;
    const bottom = H - P - 5;
    const minGap = Math.min(17, (bottom - top) / Math.max(rows.length - 1, 1));
    const labels = rows.map((line, index) => {
      const point = line.points[line.points.length - 1];
      return { line, index, point, pointY: yFor(point.value), y: yFor(point.value) };
    }).sort((a, b) => a.y - b.y);
    labels.forEach((item, index) => {
      if (index) item.y = Math.max(item.y, labels[index - 1].y + minGap);
    });
    if (labels.length && labels[labels.length - 1].y > bottom) {
      const shift = labels[labels.length - 1].y - bottom;
      labels.forEach((item) => { item.y -= shift; });
    }
    for (let index = labels.length - 2; index >= 0; index -= 1) {
      labels[index].y = Math.min(labels[index].y, labels[index + 1].y - minGap);
    }
    if (labels.length && labels[0].y < top) {
      const shift = top - labels[0].y;
      labels.forEach((item) => { item.y += shift; });
    }
    return { rows, min: min - pad, max: max + pad, length: Math.max(...rows.map((line) => line.points.length)), labels };
  }, [mode, series]);

  function yFor(value) {
    return H - P - ((value - model.min) / Math.max(model.max - model.min, 0.0001)) * (H - P * 2);
  }

  function path(points) {
    return points.map((point, index) => `${index ? 'L' : 'M'}${P + (index / Math.max(points.length - 1, 1)) * (plotRight - P)},${yFor(point.value)}`).join(' ');
  }

  function move(event) {
    const rect = chartRef.current?.getBoundingClientRect();
    if (!rect || !model.length) return;
    const clientX = event.touches?.[0]?.clientX ?? event.clientX;
    const chartX = Math.min(plotRight / W, Math.max(0, (clientX - rect.left) / rect.width));
    setCursor(Math.max(0, Math.min(model.length - 1, Math.round((chartX * W / plotRight) * (model.length - 1)))));
  }

  const tooltipRows = cursor == null ? [] : model.rows.map((line) => ({
    line,
    point: line.points[Math.min(cursor, line.points.length - 1)],
  })).sort((a, b) => (b.point?.value ?? -Infinity) - (a.point?.value ?? -Infinity));

  if (!model.rows.length) return <div className="flex h-56 items-center justify-center text-sm text-slate-400">暂无走势数据</div>;

  return (
    <div ref={chartRef} className="relative" onMouseMove={move} onMouseLeave={() => setCursor(null)} onTouchStart={move} onTouchMove={move}>
      <div className="relative h-[250px] sm:h-[280px] overflow-hidden">
        <svg className="h-full w-full" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-label={mode === 'premium' ? '实时溢价走势图' : '实时价格走势图'}>
          <line x1={P} y1={H / 2} x2={plotRight} y2={H / 2} stroke="currentColor" className="text-slate-200 dark:text-slate-700" strokeWidth="1" />
          <line x1={P} y1={H * 0.25} x2={plotRight} y2={H * 0.25} stroke="currentColor" className="text-slate-100 dark:text-slate-800" strokeWidth="1" />
          <line x1={P} y1={H * 0.75} x2={plotRight} y2={H * 0.75} stroke="currentColor" className="text-slate-100 dark:text-slate-800" strokeWidth="1" />
          {model.rows.map((line, index) => <path key={line.key || line.code || index} d={path(line.points)} fill="none" stroke={line.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />)}
          {model.labels.map(({ line, index, pointY, y }) => <g key={`end-${line.key || line.code || index}`}>
            <line x1={plotRight} y1={pointY} x2={plotRight + 9} y2={y} stroke={line.color} strokeWidth="1" opacity="0.75" />
            <circle cx={plotRight} cy={pointY} r="2.8" fill={line.color} />
          </g>)}
          {cursor != null ? <line x1={P + cursor / Math.max(model.length - 1, 1) * (plotRight - P)} y1={P} x2={P + cursor / Math.max(model.length - 1, 1) * (plotRight - P)} y2={H - P} stroke="currentColor" className="text-slate-400" strokeDasharray="3 3" /> : null}
        </svg>
        <div className="pointer-events-none absolute inset-0">
          {model.labels.map(({ line, index, y }) => <span key={`label-${line.key || line.code || index}`} className="absolute left-[73%] max-w-[27%] truncate text-[11px] font-medium" style={{ top: `${(y / H) * 100}%`, color: line.color }}>{line.shortName || line.name || line.label || line.code}</span>)}
        </div>
      </div>
      {cursor != null ? <div className="absolute left-2 top-2 z-10 max-h-44 max-w-[70%] overflow-auto rounded-lg border border-slate-200 bg-white/95 px-2.5 py-2 text-[10px] shadow-lg dark:border-slate-700 dark:bg-slate-900/95">
        {tooltipRows.map(({ line, point }, index) => <div key={line.key || line.code || index} className="flex items-center gap-1.5 whitespace-nowrap">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: line.color }} />
          <span className="max-w-36 truncate text-slate-600 dark:text-slate-300">{line.shortName || line.name || line.code}</span>
          <b className="ml-auto font-mono text-slate-900 dark:text-white">{mode === 'premium' ? formatPercent(point?.value) : number(point?.value)?.toFixed(3)}</b>
        </div>)}
      </div> : null}
    </div>
  );
}

export function MarketPremiumTrendPanel({ rows = [], grouping }) {
  const [mode, setMode] = useState('premium');
  const [group, setGroup] = useState('all');
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const load = async () => {
      try {
        const next = await fetchHomeMarketSeries(controller.signal);
        if (active) setPayload(next);
      } catch (_error) {
        if (active) setPayload(null);
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    const interval = window.setInterval(load, 60 * 1000);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(interval);
    };
  }, []);

  const currentCodes = useMemo(() => new Set(rows.map((row) => codeOf(row.code)).filter(Boolean)), [rows]);
  const sourceSeries = useMemo(() => payload?.modes?.[mode]?.series || [], [mode, payload]);
  const groupOptions = useMemo(() => {
    const groups = Array.isArray(payload?.groups) && payload.groups.length ? payload.groups : FALLBACK_GROUPS;
    const available = groups.filter((item) => item.key === 'all' || sourceSeries.some((line) => currentCodes.has(codeOf(line.code)) && line.groupKey === item.key));
    return available.length ? available : [{ key: 'all', label: '全部' }];
  }, [currentCodes, payload, sourceSeries]);

  useEffect(() => {
    if (!groupOptions.some((item) => item.key === group)) setGroup('all');
  }, [group, groupOptions]);

  const chartSeries = useMemo(() => {
    const selected = sourceSeries.filter((line) => currentCodes.has(codeOf(line.code)) && (group === 'all' || line.groupKey === group)).map((line) => {
      const current = rows.find((row) => codeOf(row.code) === codeOf(line.code));
      return { ...line, shortName: current?.shortName || current?.name || line.name };
    });
    if (selected.length) return selected;
    return fallbackSeries(rows.filter((row) => group === 'all' || group === 'nasdaq-100'));
  }, [currentCodes, group, rows, sourceSeries]);

  const zones = useMemo(() => [
    { key: 'H', label: '高溢价区', tone: 'rose', items: (grouping?.highItems || []).filter((item) => !isLof(item)) },
    { key: 'M', label: '中溢价区', tone: 'amber', items: (grouping?.mediumItems || []).filter((item) => !isLof(item)) },
    { key: 'L', label: '低溢价区', tone: 'emerald', items: (grouping?.lowItems || []).filter((item) => !isLof(item)) },
  ].map((zone) => ({ ...zone, value: median(zone.items.map((item) => item.premium)) })) , [grouping]);

  const gaps = useMemo(() => [
    { label: '高 − 中', value: number(grouping?.highMediumSpread) },
    { label: '中 − 低', value: number(grouping?.mediumLowSpread) },
    { label: '高 − 低', value: boundaryGap(grouping?.highItems, grouping?.lowItems) },
  ], [grouping]);

  return (
    <section className="rounded-xl border border-slate-200 bg-white/95 p-3 shadow-xs backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/95 sm:p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="h-5 w-1 rounded-full bg-emerald-500" />
          <h2 className="text-sm font-black text-slate-900 dark:text-white sm:text-base">场内走势</h2>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[10px] text-slate-400 sm:text-xs">{payload?.windowLabel || '今日 · 1 分钟'} · {formatTime(payload?.generatedAt)}</span>
          <div className="flex shrink-0 overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800">
            <button type="button" aria-pressed={mode === 'premium'} onClick={() => setMode('premium')} className={`px-2.5 py-1.5 text-[11px] font-bold transition ${mode === 'premium' ? 'bg-white text-blue-600 shadow-xs dark:bg-slate-700 dark:text-blue-300' : 'text-slate-500'}`}>溢价</button>
            <button type="button" aria-pressed={mode === 'price'} onClick={() => setMode('price')} className={`px-2.5 py-1.5 text-[11px] font-bold transition ${mode === 'price' ? 'bg-white text-blue-600 shadow-xs dark:bg-slate-700 dark:text-blue-300' : 'text-slate-500'}`}>价格</button>
          </div>
        </div>
      </header>
      <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
        {groupOptions.map((item) => <button type="button" key={item.key} aria-pressed={group === item.key} onClick={() => setGroup(item.key)} className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${group === item.key ? 'border-blue-500 bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300' : 'border-slate-200 text-slate-500 hover:border-blue-300 dark:border-slate-700 dark:text-slate-400'}`}>{item.label}</button>)}
      </div>
      <div className="mt-1 rounded-lg border border-slate-100 bg-slate-50/40 px-1 pt-1 dark:border-slate-800 dark:bg-slate-800/20">
        <TrendChart series={chartSeries} mode={mode} />
      </div>
      {mode === 'premium' ? <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {zones.map((zone) => <div key={zone.key} className={`rounded-lg px-3 py-2.5 ${zone.tone === 'rose' ? 'bg-rose-50 text-rose-600 dark:bg-rose-950/30 dark:text-rose-300' : zone.tone === 'amber' ? 'bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-300' : 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-300'}`}>
            <small className="block text-[11px]">{zone.label} · {zone.items.length}只</small>
            <b className="mt-1 block font-mono text-xl">{formatPercent(zone.value)}</b>
          </div>)}
        </div>
        <small className="mt-2 block text-[11px] text-slate-400">分区统计不含 LOF，区间值按中位数展示</small>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
          {gaps.map((gap) => <span key={gap.label}>{gap.label} <b className="font-mono text-slate-700 dark:text-slate-200">{gap.value == null ? '—' : `${gap.value >= 0 ? '+' : ''}${gap.value.toFixed(2)} 个百分点`}</b></span>)}
        </div>
      </div> : null}
      {loading && !payload ? <div className="mt-2 text-[10px] text-slate-400">历史走势加载中，当前行情已先行展示</div> : null}
    </section>
  );
}

