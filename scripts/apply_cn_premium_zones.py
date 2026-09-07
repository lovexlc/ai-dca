from pathlib import Path

jsx = Path('src/pages/CnHomeExperience.jsx')
text = jsx.read_text(encoding='utf-8')
start = text.index('function MiniChart({ series, mode }) {')
end = text.index('\nfunction Limits(', start)
replacement = r'''function MiniChart({ series, mode }) {
  const [cursor, setCursor] = useState(null); const ref = useRef(null);
  const W = 720, H = 280, P = 18, plotRight = 520;
  const model = useMemo(() => {
    const rows = series.map((line, index) => ({ ...line, color: COLORS[index % COLORS.length], points: (line.points || []).map((p) => ({ ...p, value: number(p.value ?? (mode === 'premium' ? p.premiumPercent : p.price)) })).filter((p) => p.value != null) })).filter((x) => x.points.length);
    const values = rows.flatMap((x) => x.points.map((p) => p.value));
    if (!values.length) return { rows, min: 0, max: 1, length: 0, zones: [], gaps: [] };
    const min = Math.min(...values), max = Math.max(...values), pad = Math.max((max - min) * .12, .1);
    const latest = rows.map((line) => ({ line, value: line.points[line.points.length - 1].value })).sort((a, b) => b.value - a.value);
    const zones = [];
    if (mode === 'premium' && latest.length >= 3) {
      const first = Math.ceil(latest.length / 3), second = Math.ceil(latest.length * 2 / 3);
      [['high', '高溢价区', latest.slice(0, first)], ['medium', '中溢价区', latest.slice(first, second)], ['low', '低溢价区', latest.slice(second)]].forEach(([key, label, items]) => {
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
  if (!model.rows.length) return <div className="cn-home-empty">暂无今日走势</div>;
  return <div className="cn-home-chart-wrap" ref={ref} onMouseMove={move} onMouseLeave={() => setCursor(null)} onTouchStart={move} onTouchMove={move}><svg className="cn-home-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"><line x1={P} y1={H / 2} x2={plotRight} y2={H / 2} className="grid" />{model.rows.map((line, i) => <path key={line.key || line.code || i} d={path(line.points)} style={{ stroke: line.color }} />)}{endLabels.map(({ line, index, pointY, y }) => <g key={`end-${line.key || line.code || index}`} className="cn-home-end-label"><line x1={plotRight} y1={pointY} x2={plotRight + 9} y2={y} style={{ stroke: line.color }} /><circle cx={plotRight} cy={pointY} r="2.6" style={{ fill: line.color }} /><text x={plotRight + 12} y={y + 4} style={{ fill: line.color }}>{line.name || line.label || line.code}</text></g>)}{cursor != null ? <line x1={P + cursor / Math.max(model.length - 1, 1) * (plotRight - P)} y1={P} x2={P + cursor / Math.max(model.length - 1, 1) * (plotRight - P)} y2={H - P} className="cross" /> : null}</svg>{cursor != null ? <div className="cn-home-tooltip">{model.rows.map((line, i) => { const p = line.points[Math.min(cursor, line.points.length - 1)]; return <div key={line.key || i}><span style={{ background: line.color }} />{line.label || line.name || line.code}<b>{mode === 'premium' ? pct(p?.value) : p?.value?.toFixed(2)}</b></div>; })}</div> : null}{model.zones.length ? <div className="cn-home-zone-summary"><div className="cn-home-zone-values">{model.zones.map((zone) => <span key={zone.key} className={`is-${zone.key}`}><small>{zone.label} · {zone.count}只</small><b>{pct(zone.value)}</b></span>)}</div><div className="cn-home-zone-gaps">{model.gaps.map((gap) => <span key={gap.label}>{gap.label}<b>{gap.value >= 0 ? '+' : ''}{gap.value.toFixed(2)} 个百分点</b></span>)}</div></div> : null}</div>;
}'''
text = text[:start] + replacement + text[end:]
jsx.write_text(text, encoding='utf-8')

css = Path('src/pages/cn-home.css')
styles = css.read_text(encoding='utf-8')
addon = '.cn-home-end-label line{stroke-width:1;opacity:.7}.cn-home-end-label text{font-size:10px;font-weight:650}.cn-home-zone-summary{margin:4px 6px 10px;padding:10px;border:1px solid #edf0f4;border-radius:10px;background:#fafbfc}.cn-home-zone-values{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.cn-home-zone-values span{padding:7px 9px;border-radius:8px}.cn-home-zone-values span.is-high{background:#fff0f0;color:#d63d43}.cn-home-zone-values span.is-medium{background:#fff7e8;color:#b66a00}.cn-home-zone-values span.is-low{background:#eaf9f3;color:#087f5b}.cn-home-zone-values small,.cn-home-zone-values b{display:block}.cn-home-zone-values small{font-size:9px;opacity:.78}.cn-home-zone-values b{margin-top:3px;font-size:13px}.cn-home-zone-gaps{display:flex;flex-wrap:wrap;gap:5px 14px;padding-top:8px;color:#758095;font-size:9px}.cn-home-zone-gaps span{display:flex;gap:5px}.cn-home-zone-gaps b{color:#3d4758}.cn-home-tooltip{max-height:238px;overflow:auto}@media(max-width:640px){.cn-home-end-label text{font-size:9px}.cn-home-zone-values{gap:5px}.cn-home-zone-values span{padding:6px}.cn-home-zone-values b{font-size:11px}.cn-home-zone-gaps{gap:4px 10px}}'
if addon not in styles:
    styles += addon
css.write_text(styles, encoding='utf-8')
