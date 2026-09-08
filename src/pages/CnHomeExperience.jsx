import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ChevronRight, RefreshCw } from 'lucide-react';
import './cn-home.css';
import { CnFundLimitDetail } from './CnFundLimitDetail.jsx';

const BASE = String(import.meta.env?.VITE_MARKETS_API_BASE || '/api/market-collector').replace(/\/$/, '');
const ROUTES = {
  overview: '/aggregates/home-market-overview',
  series: '/aggregates/home-market-series',
  limits: '/aggregates/fund-limit-overview',
};
const DATASETS = {
  overview: '/datasets/home-market-overview/global',
  series: '/datasets/home-market-series/today%3A5m',
  limits: '/datasets/fund-limit-overview/global',
};
const COLORS = ['#1468f3', '#e5484d', '#0aa870', '#f08c2e', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#dc6b19', '#4f46e5', '#0f766e', '#be123c', '#9333ea', '#0284c7', '#ca8a04', '#16a34a'];
const MARKET_STATES = {
  open: { label: '交易中', tone: 'open' }, trading: { label: '交易中', tone: 'open' },
  pre_open: { label: '待开市', tone: 'rest' }, lunch_break: { label: '午间休市', tone: 'rest' },
  break: { label: '午间休市', tone: 'rest' }, closed: { label: '已收市', tone: 'closed' },
  holiday: { label: '休市', tone: 'closed' }, unknown: { label: '状态待确认', tone: 'unknown' },
};
function marketMeta(data) {
  const key = String(data?.marketState || data?.sessionState || data?.marketStatus || 'unknown').toLowerCase();
  return { key, ...(MARKET_STATES[key] || { label: data?.marketStateLabel || '状态待确认', tone: 'unknown' }) };
}

function cacheKey(section) { return `cn-home:${section}:v1`; }
function readCache(section) { try { return JSON.parse(localStorage.getItem(cacheKey(section)) || 'null'); } catch { return null; } }
function writeCache(section, value) { try { localStorage.setItem(cacheKey(section), JSON.stringify(value)); } catch {} }
async function request(path) {
  const response = await fetch(`${BASE}${path}`, { headers: { accept: 'application/json' }, cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const value = await response.json();
  return value?.payload || value;
}
async function loadSection(section, force) {
  try { return await request(ROUTES[section]); }
  catch (firstError) {
    try { return await request(DATASETS[section]); }
    catch {
      if (!force) throw firstError;
      const collected = await request('/aggregates/home-market-collect');
      return collected[section] || collected[section === 'limits' ? 'limits' : section];
    }
  }
}
function number(value) { const n = Number(value); return Number.isFinite(n) ? n : null; }
function pct(value) { const n = number(value); return n == null ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(2)}%`; }
function compact(value, currency = 'CNY') {
  const n = number(value); if (n == null) return '—';
  const sign = currency === 'USD' ? '$' : '¥';
  if (Math.abs(n) >= 100000000) return `${sign}${(n / 100000000).toFixed(1)}亿`;
  if (Math.abs(n) >= 10000) return `${sign}${(n / 10000).toFixed(1)}万`;
  return `${sign}${n.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`;
}
function timeText(value) { if (!value) return '—'; const d = new Date(value); return Number.isNaN(d.getTime()) ? String(value).slice(0, 16) : d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); }
function count(source, ...keys) { for (const key of keys) { const value = number(source?.[key]); if (value != null) return value; } return 0; }
function Section({ title, side, loading, error, onRetry, children }) {
  return <section className="cn-home-card" data-scroll-card="true"><header className="cn-home-title"><span>{title}</span>{side}</header>{loading && !children ? <div className="cn-home-empty"><RefreshCw className="cn-home-spin" />正在读取本地数据…</div> : error && !children ? <button className="cn-home-retry" onClick={onRetry}><AlertCircle />加载失败，点击重试</button> : children}</section>;
}
function Overview({ data, limits }) {
  const b = data?.breadth || {};
  const totals = limits?.currencyTotals || [];
  const cny = totals.find((x) => String(x.currency).toUpperCase() === 'CNY');
  const usd = totals.find((x) => String(x.currency).toUpperCase() === 'USD');
  const rise = count(b, 'riseCount', 'rise'), fall = count(b, 'fallCount', 'fall');
  const median = b.premiumMedianPercent ?? b.premiumMedian;
  const market = marketMeta(data);
  return <><div className="cn-home-session"><span className={`cn-home-dot is-${market.tone}`} />{market.label}<span>{timeText(data?.priceAsOf || data?.generatedAt)}</span></div><div className="cn-home-stats"><div><small>上涨 / 下跌</small><strong><i className="up">{rise}</i> / <i className="down">{fall}</i></strong><em>场内全池</em></div><div><small>溢价中位数</small><strong className={number(median) >= 0 ? 'up' : 'down'}>{pct(median)}</strong><em>{b.previousPremiumMedianPercent == null ? '实时口径' : `昨日 ${pct(b.previousPremiumMedianPercent)}`}</em></div><div><small>场外额度</small><strong>{compact(cny?.amount, 'CNY')}</strong><em>{usd ? `美元 ${compact(usd.amount, 'USD')}` : `${cny?.limitedCount ?? 0} 只限购`}</em></div></div>{(data?.anomalies || []).length ? <div className="cn-home-warning">{data.anomalies[0]?.message || data.anomalies[0]}</div> : null}</>;
}

function pickSeries(payload, mode, group) {
  const block = payload?.modes?.[mode] || {};
  if (group === 'all') {
    const rows = block?.aggregate?.series || block?.aggregate || [];
    return Array.isArray(rows) ? rows : [];
  }
  const funds = Array.isArray(block.series) ? block.series.filter((x) => x.groupKey === group) : [];
  if (funds.length) return funds;
  const aggregate = block?.aggregate?.series || [];
  return aggregate.filter((x) => x.groupKey === group);
}
function isLofLine(line) { const code = String(line?.code || line?.key || ''); const name = String(line?.name || line?.label || ''); return /^16/.test(code) || /LOF|联接/i.test(name); }
function MiniChart({ series, mode }) {
  const [cursor, setCursor] = useState(null); const ref = useRef(null);
  const W = 720, H = 280, P = 18, plotRight = 520;
  const model = useMemo(() => {
    const rows = series.map((line, index) => ({ ...line, color: COLORS[index % COLORS.length], points: (line.points || []).map((p) => ({ ...p, value: number(p.value ?? (mode === 'premium' ? p.premiumPercent : p.price)) })).filter((p) => p.value != null) })).filter((x) => x.points.length);
    const values = rows.flatMap((x) => x.points.map((p) => p.value));
    if (!values.length) return { rows, min: 0, max: 1, length: 0, zones: [], gaps: [] };
    const min = Math.min(...values), max = Math.max(...values), pad = Math.max((max - min) * .12, .1);
    const latest = rows.map((line) => ({ line, value: line.points[line.points.length - 1].value })).sort((a, b) => b.value - a.value);
    const zoneLatest = latest.filter(({ line }) => !isLofLine(line));
    const zones = [];
    if (mode === 'premium' && zoneLatest.length >= 3) {
      const first = Math.ceil(zoneLatest.length / 3), second = Math.ceil(zoneLatest.length * 2 / 3);
      [['high', '高溢价区', zoneLatest.slice(0, first)], ['medium', '中溢价区', zoneLatest.slice(first, second)], ['low', '低溢价区', zoneLatest.slice(second)]].forEach(([key, label, items]) => {
        const sorted = items.map((item) => item.value).sort((a, b) => a - b);
        const middle = Math.floor(sorted.length / 2);
        const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
        zones.push({ key, label, value: median, count: items.length, codes: items.map((item) => item.line.code).filter(Boolean) });
      });
    }
    const gaps = zones.length === 3 ? [
      { label: '高 − 中', value: zones[0].value - zones[1].value },
      { label: '中 − 低', value: zones[1].value - zones[2].value },
      { label: '高 − 低', value: zones[0].value - zones[2].value },
    ] : [];
    return { rows, min: min - pad, max: max + pad, length: Math.max(...rows.map((x) => x.points.length)), zones, gaps };
  }, [series, mode]);
  const endLabels = useMemo(() => {
    if (!model.rows.length) return [];
    const top = P + 5, bottom = H - P - 5;
    const minGap = Math.min(17, (bottom - top) / Math.max(model.rows.length - 1, 1));
    const yFor = (value) => H - P - ((value - model.min) / Math.max(model.max - model.min, .0001)) * (H - P * 2);
    const labels = model.rows.map((line, index) => {
      const point = line.points[line.points.length - 1];
      return { line, index, point, pointY: yFor(point.value), y: yFor(point.value) };
    }).sort((a, b) => a.y - b.y);
    labels.forEach((item, index) => { if (index) item.y = Math.max(item.y, labels[index - 1].y + minGap); });
    if (labels.length && labels[labels.length - 1].y > bottom) {
      const shift = labels[labels.length - 1].y - bottom;
      labels.forEach((item) => { item.y -= shift; });
    }
    for (let index = labels.length - 2; index >= 0; index -= 1) labels[index].y = Math.min(labels[index].y, labels[index + 1].y - minGap);
    if (labels.length && labels[0].y < top) {
      const shift = top - labels[0].y;
      labels.forEach((item) => { item.y += shift; });
    }
    return labels;
  }, [model]);
  function path(points) { return points.map((p, i) => `${i ? 'L' : 'M'}${P + (i / Math.max(points.length - 1, 1)) * (plotRight - P)},${H - P - ((p.value - model.min) / Math.max(model.max - model.min, .0001)) * (H - P * 2)}`).join(' '); }
  function move(event) { const rect = ref.current?.getBoundingClientRect(); if (!rect || !model.length) return; const x = event.touches?.[0]?.clientX ?? event.clientX; const chartX = Math.min(plotRight / W, Math.max(0, (x - rect.left) / rect.width)); setCursor(Math.max(0, Math.min(model.length - 1, Math.round((chartX * W / plotRight) * (model.length - 1))))); }
  function tooltipRows() { return model.rows.map((line) => ({ line, p: line.points[Math.min(cursor ?? 0, line.points.length - 1)] })).sort((a, b) => mode === 'premium' ? (b.p?.value ?? -Infinity) - (a.p?.value ?? -Infinity) : 0); }
  if (!model.rows.length) return <div className="cn-home-empty">暂无今日走势</div>;
  return <div className="cn-home-chart-wrap" ref={ref} onMouseMove={move} onMouseLeave={() => setCursor(null)} onTouchStart={move} onTouchMove={move}><div className="cn-home-chart-stage"><svg className="cn-home-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"><line x1={P} y1={H / 2} x2={plotRight} y2={H / 2} className="grid" />{model.rows.map((line, i) => <path key={line.key || line.code || i} d={path(line.points)} style={{ stroke: line.color }} />)}{endLabels.map(({ line, index, pointY, y }) => <g key={`end-${line.key || line.code || index}`} className="cn-home-end-label"><line x1={plotRight} y1={pointY} x2={plotRight + 9} y2={y} style={{ stroke: line.color }} /><circle cx={plotRight} cy={pointY} r="2.6" style={{ fill: line.color }} /></g>)}{cursor != null ? <line x1={P + cursor / Math.max(model.length - 1, 1) * (plotRight - P)} y1={P} x2={P + cursor / Math.max(model.length - 1, 1) * (plotRight - P)} y2={H - P} className="cross" /> : null}</svg><div className="cn-home-end-labels">{endLabels.map(({ line, index, y }) => <span key={`html-end-${line.key || line.code || index}`} style={{ top: `${(y / H) * 100}%`, color: line.color }}>{line.name || line.label || line.code}</span>)}</div></div>{cursor != null ? <div className="cn-home-tooltip">{tooltipRows().map(({ line, p }, i) => <div key={line.key || i}><span style={{ background: line.color }} />{line.label || line.name || line.code}<b>{mode === 'premium' ? pct(p?.value) : p?.value?.toFixed(2)}</b></div>)}</div> : null}{model.zones.length ? <div className="cn-home-zone-summary"><div className="cn-home-zone-values">{model.zones.map((zone) => <span key={zone.key} className={`is-${zone.key}`}><small>{zone.label} · {zone.count}只</small><b>{pct(zone.value)}</b></span>)}</div><small className="cn-home-zone-note">分区统计不含 LOF</small><div className="cn-home-zone-gaps">{model.gaps.map((gap) => <span key={gap.label}>{gap.label}<b>{gap.value >= 0 ? '+' : ''}{gap.value.toFixed(2)} 个百分点</b></span>)}</div></div> : null}</div>;
}
function trendAmount(row, currency) {
  if (!row) return null;
  const key = currency === 'USD' ? 'usd' : 'cny';
  return number(row[key] ?? row?.totalByCurrency?.[currency]);
}
function Limits({ data, onFund, onOpenDetail }) {
  const totals = Array.isArray(data?.currencyTotals) ? data.currencyTotals : [];
  const trend = (Array.isArray(data?.trend) ? data.trend : []).slice(-7);
  const summaries = ['CNY', 'USD'].map((currency) => {
    const values = trend.map((row) => trendAmount(row, currency)).filter((value) => value != null);
    const delta = values.length > 1 ? values[values.length - 1] - values[0] : null;
    return { currency, label: currency === 'USD' ? '美元额度' : '人民币额度', delta };
  }).filter((row) => totals.some((total) => String(total.currency).toUpperCase() === row.currency));
  const meaningful = (Array.isArray(data?.events) ? data.events : []).filter((event) => ['new_limit', 'tighten', 'relax', 'suspend', 'resume'].includes(event.type));
  const latestDay = meaningful.reduce((best, event) => String(event.effectiveAt || '') > best ? String(event.effectiveAt || '') : best, '');
  const latest = latestDay ? meaningful.filter((event) => String(event.effectiveAt || '') === latestDay) : [];
  const groups = [
    { key: 'tighten', label: '额度收紧', tone: 'warning', events: latest.filter((event) => ['tighten', 'suspend'].includes(event.type)) },
    { key: 'relax', label: '额度放宽', tone: 'positive', events: latest.filter((event) => ['new_limit', 'relax', 'resume'].includes(event.type)) },
  ].filter((group) => group.events.length);
  const changeText = (event) => {
    if (event.type === 'suspend') return `${compact(event.previousAmount, event.currency)} → 暂停`;
    if (event.type === 'resume') return `暂停 → ${compact(event.currentAmount, event.currency)}`;
    return `${compact(event.previousAmount, event.currency)} → ${compact(event.currentAmount, event.currency)}`;
  };
  return <>
    <div className="cn-home-limit-total">{totals.length ? totals.map((row) => { const currency = String(row.currency).toUpperCase(); return <button type="button" key={currency} onClick={() => onOpenDetail?.(currency)}><small>{currency === 'USD' ? '美元份额' : '人民币份额'}</small><strong>{compact(row.amount, currency)}</strong><i>查看完整额度详情 ›</i></button>; }) : <div><small>人民币份额</small><strong>—</strong><em>等待本地采集</em></div>}</div>
    {summaries.length ? <div className="cn-home-quota-change">{summaries.map((row) => <div key={row.currency}><span>{row.label}</span><b className={row.delta > 0 ? 'relax-text' : row.delta < 0 ? 'tighten-text' : ''}>{row.delta == null ? '趋势样本不足' : row.delta === 0 ? '持平' : `${row.delta > 0 ? '增加' : '减少'} ${compact(Math.abs(row.delta), row.currency)} ${row.delta > 0 ? '↑' : '↓'}`}</b></div>)}</div> : null}
    {groups.length ? <div className="cn-home-quota-board"><h3>{latestDay ? `${latestDay.slice(5, 7)}月${latestDay.slice(8, 10)}日 限额变动` : '限额变动'}</h3>{groups.map((group) => <section key={group.key} className={`is-${group.tone}`}><header><span />{group.label}{latestDay ? `（${Number(latestDay.slice(5, 7))}月${Number(latestDay.slice(8, 10))}日起生效）` : ''}</header>{group.events.map((event) => <button key={event.id || `${event.code}-${event.type}`} onClick={() => onFund?.(event.code)}><div><b>{event.name || event.code}</b><small>{event.code}</small></div><strong>{changeText(event)}</strong><ChevronRight /></button>)}</section>)}</div> : null}
    <p className="cn-home-limit-disclaimer">额度是公开渠道的产品申购上限汇总，不代表任何用户账户的实际剩余额度。</p>
  </>;
}

function readLimitCurrency() { if (typeof window === 'undefined') return ''; const params = new URLSearchParams(window.location.search); if (params.get('view') !== 'fund-limits') return ''; const value = String(params.get('currency') || 'CNY').toUpperCase(); return value === 'USD' ? 'USD' : 'CNY'; }
export function CnHomeExperience() {
  const [limitCurrency, setLimitCurrency] = useState(readLimitCurrency);
  const [state, setState] = useState(() => Object.fromEntries(['overview','series','limits'].map((key) => [key, { data: readCache(key), loading: true, error: null }])));
  const [mode, setMode] = useState('premium'); const [group, setGroup] = useState('all');
  const refresh = useCallback((force = false) => { ['overview','series','limits'].forEach((section) => { setState((s) => ({ ...s, [section]: { ...s[section], loading: true, error: null } })); loadSection(section, force).then((data) => { writeCache(section, data); setState((s) => ({ ...s, [section]: { data, loading: false, error: null } })); }).catch((error) => setState((s) => ({ ...s, [section]: { ...s[section], loading: false, error } }))); }); }, []);
  useEffect(() => { refresh(false); }, [refresh]);
  useEffect(() => { const sync = () => setLimitCurrency(readLimitCurrency()); window.addEventListener('popstate', sync); return () => window.removeEventListener('popstate', sync); }, []);
  const groups = state.series.data?.groups || state.overview.data?.groups || [{ key: 'all', label: '全部' }];
  const lines = pickSeries(state.series.data, mode, group);
  function openFund(code) { if (!code) return; window.dispatchEvent(new CustomEvent('workspace:navigate', { detail: { tab: 'markets', search: `symbol=${encodeURIComponent(code)}` } })); }
  function openLimitDetail(currency) { const value = String(currency || 'CNY').toUpperCase() === 'USD' ? 'USD' : 'CNY'; const url = new URL(window.location.href); url.searchParams.set('view', 'fund-limits'); url.searchParams.set('currency', value); window.history.pushState({ ...(window.history.state || {}), cnLimitDetail: true }, '', url); setLimitCurrency(value); window.scrollTo({ top: 0, behavior: 'auto' }); }
  function switchLimitCurrency(currency) { const value = currency === 'USD' ? 'USD' : 'CNY'; const url = new URL(window.location.href); url.searchParams.set('view', 'fund-limits'); url.searchParams.set('currency', value); window.history.replaceState({ ...(window.history.state || {}), cnLimitDetail: true }, '', url); setLimitCurrency(value); }
  function closeLimitDetail() { if (window.history.state?.cnLimitDetail) { window.history.back(); return; } const url = new URL(window.location.href); url.searchParams.delete('view'); url.searchParams.delete('currency'); window.history.replaceState(window.history.state, '', url); setLimitCurrency(''); }
  if (limitCurrency) return <CnFundLimitDetail data={state.limits.data} currency={limitCurrency} loading={state.limits.loading} error={state.limits.error} onRetry={() => refresh(true)} onBack={closeLimitDetail} onSwitchCurrency={switchLimitCurrency} />;
  return <main className="cn-home"><div className="cn-home-head"><div><h1>市场首页</h1><p>全球指数基金实时概览</p></div><button onClick={() => refresh(true)} disabled={Object.values(state).some((x) => x.loading)}><RefreshCw />刷新</button></div><Section title="全局市场总览" loading={state.overview.loading} error={state.overview.error} onRetry={() => refresh(true)}><Overview data={state.overview.data} limits={state.limits.data} /></Section><Section title="场内走势" loading={state.series.loading} error={state.series.error} onRetry={() => refresh(true)} side={<div className="cn-home-segment"><button className={mode === 'premium' ? 'active' : ''} onClick={() => setMode('premium')}>溢价</button><button className={mode === 'price' ? 'active' : ''} onClick={() => setMode('price')}>价格</button></div>}><div className="cn-home-chips">{groups.map((item) => <button key={item.key} className={group === item.key ? 'active' : ''} onClick={() => setGroup(item.key)}>{item.label}</button>)}</div><MiniChart series={lines} mode={mode} /><footer className="cn-home-foot">{state.series.data?.windowLabel || '今日 · 5 分钟'} · {timeText(state.series.data?.generatedAt)}</footer></Section><Section title="场外额度" loading={state.limits.loading} error={state.limits.error} onRetry={() => refresh(true)} side={<span className="cn-home-limit-asof">更新于 {timeText(state.limits.data?.limitAsOf || state.limits.data?.generatedAt)}</span>}><Limits data={state.limits.data} onFund={openFund} onOpenDetail={openLimitDetail} /></Section></main>;
}
