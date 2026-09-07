from pathlib import Path

jsx = Path('src/pages/CnHomeExperience.jsx')
text = jsx.read_text(encoding='utf-8')

def replace(old: str, new: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'expected one match, got {count}: {old[:100]}')
    text = text.replace(old, new, 1)

replace(
    'function MiniChart({ series, mode }) {',
    "function isLofLine(line) { const code = String(line?.code || line?.key || ''); const name = String(line?.name || line?.label || ''); return /^16/.test(code) || /LOF|联接/i.test(name); }\nfunction MiniChart({ series, mode }) {",
)
replace(
    '    const latest = rows.map((line) => ({ line, value: line.points[line.points.length - 1].value })).sort((a, b) => b.value - a.value);\n    const zones = [];\n    if (mode === \'premium\' && latest.length >= 3) {\n      const first = Math.ceil(latest.length / 3), second = Math.ceil(latest.length * 2 / 3);\n      [[\'high\', \'高溢价区\', latest.slice(0, first)], [\'medium\', \'中溢价区\', latest.slice(first, second)], [\'low\', \'低溢价区\', latest.slice(second)]].forEach(([key, label, items]) => {',
    '    const latest = rows.map((line) => ({ line, value: line.points[line.points.length - 1].value })).sort((a, b) => b.value - a.value);\n    const zoneLatest = latest.filter(({ line }) => !isLofLine(line));\n    const zones = [];\n    if (mode === \'premium\' && zoneLatest.length >= 3) {\n      const first = Math.ceil(zoneLatest.length / 3), second = Math.ceil(zoneLatest.length * 2 / 3);\n      [[\'high\', \'高溢价区\', zoneLatest.slice(0, first)], [\'medium\', \'中溢价区\', zoneLatest.slice(first, second)], [\'low\', \'低溢价区\', zoneLatest.slice(second)]].forEach(([key, label, items]) => {',
)
replace(
    '  if (!model.rows.length) return <div className="cn-home-empty">暂无今日走势</div>;',
    "  function tooltipRows() { return model.rows.map((line) => ({ line, p: line.points[Math.min(cursor ?? 0, line.points.length - 1)] })).sort((a, b) => mode === 'premium' ? (b.p?.value ?? -Infinity) - (a.p?.value ?? -Infinity) : 0); }\n  if (!model.rows.length) return <div className=\"cn-home-empty\">暂无今日走势</div>;",
)
replace(
    '<circle cx={plotRight} cy={pointY} r="2.6" style={{ fill: line.color }} /><text x={plotRight + 12} y={y + 4} style={{ fill: line.color }}>{line.name || line.label || line.code}</text></g>)',
    '<circle cx={plotRight} cy={pointY} r="2.6" style={{ fill: line.color }} /></g>)',
)
replace(
    'return <div className="cn-home-chart-wrap" ref={ref} onMouseMove={move} onMouseLeave={() => setCursor(null)} onTouchStart={move} onTouchMove={move}><svg className="cn-home-chart"',
    'return <div className="cn-home-chart-wrap" ref={ref} onMouseMove={move} onMouseLeave={() => setCursor(null)} onTouchStart={move} onTouchMove={move}><div className="cn-home-chart-stage"><svg className="cn-home-chart"',
)
replace(
    '</svg>{cursor != null ? <div className="cn-home-tooltip">{model.rows.map((line, i) => { const p = line.points[Math.min(cursor, line.points.length - 1)]; return <div key={line.key || i}><span style={{ background: line.color }} />{line.label || line.name || line.code}<b>{mode === \'premium\' ? pct(p?.value) : p?.value?.toFixed(2)}</b></div>; })}</div> : null}',
    '</svg><div className="cn-home-end-labels">{endLabels.map(({ line, index, y }) => <span key={`html-end-${line.key || line.code || index}`} style={{ top: `${(y / H) * 100}%`, color: line.color }}>{line.name || line.label || line.code}</span>)}</div></div>{cursor != null ? <div className="cn-home-tooltip">{tooltipRows().map(({ line, p }, i) => <div key={line.key || i}><span style={{ background: line.color }} />{line.label || line.name || line.code}<b>{mode === \'premium\' ? pct(p?.value) : p?.value?.toFixed(2)}</b></div>)}</div> : null}',
)
replace(
    '<div className="cn-home-zone-gaps">{model.gaps.map((gap) =>',
    '<small className="cn-home-zone-note">分区统计不含 LOF</small><div className="cn-home-zone-gaps">{model.gaps.map((gap) =>',
)
jsx.write_text(text, encoding='utf-8')

css = Path('src/pages/cn-home.css')
styles = css.read_text(encoding='utf-8')
styles = styles.replace(
    '.cn-home-end-label line{stroke-width:1;opacity:.7}.cn-home-end-label text{font-size:10px;font-weight:650}.cn-home-zone-summary',
    '.cn-home-chart-stage{position:relative}.cn-home-end-label line{stroke-width:1;opacity:.7}.cn-home-end-labels{position:absolute;inset:0;pointer-events:none}.cn-home-end-labels span{position:absolute;left:74%;max-width:25%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;transform:translateY(-50%);font-family:Arial,"Microsoft YaHei",sans-serif;font-size:11px;font-weight:600;line-height:1.2;letter-spacing:0;text-shadow:0 0 3px #fff,0 0 3px #fff}.cn-home-zone-summary',
    1,
)
styles = styles.replace(
    '.cn-home-zone-gaps{display:flex;',
    '.cn-home-zone-note{display:block;padding-top:7px;color:#98a1af;font-size:9px}.cn-home-zone-gaps{display:flex;',
    1,
)
styles = styles.replace(
    '@media(max-width:640px){.cn-home-end-label text{font-size:9px}',
    '@media(max-width:640px){.cn-home-end-labels span{font-size:10px}',
    1,
)
css.write_text(styles, encoding='utf-8')
