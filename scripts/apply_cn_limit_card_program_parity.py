from pathlib import Path

p = Path('src/pages/CnHomeExperience.jsx')
s = p.read_text()
s = s.replace("row.delta == null ? '暂无趋势' : row.delta === 0 ? '较 7 日前持平' : `较 7 日前 ${row.delta > 0 ? '增加' : '减少'} ${compact(Math.abs(row.delta), row.currency)}`", "row.delta == null ? '趋势样本不足' : row.delta === 0 ? '持平' : `${row.delta > 0 ? '增加' : '减少'} ${compact(Math.abs(row.delta), row.currency)} ${row.delta > 0 ? '↑' : '↓'}`")
s = s.replace("<header><span />{group.label}</header>", "<header><span />{group.label}{latestDay ? `（${Number(latestDay.slice(5, 7))}月${Number(latestDay.slice(8, 10))}日起生效）` : ''}</header>")
s = s.replace("    <footer className=\"cn-home-foot\">更新于 {timeText(data?.limitAsOf || data?.generatedAt)}</footer>\n", "")
old = '<Section title="场外额度" loading={state.limits.loading} error={state.limits.error} onRetry={() => refresh(true)}><Limits data={state.limits.data} onFund={openFund} onOpenDetail={openLimitDetail} /></Section>'
new = '<Section title="场外额度" loading={state.limits.loading} error={state.limits.error} onRetry={() => refresh(true)} side={<span className="cn-home-limit-asof">更新于 {timeText(state.limits.data?.limitAsOf || state.limits.data?.generatedAt)}</span>}><Limits data={state.limits.data} onFund={openFund} onOpenDetail={openLimitDetail} /></Section>'
if old not in s:
    raise SystemExit('limit Section marker not found')
s = s.replace(old, new, 1)
p.write_text(s)

p = Path('src/pages/cn-home.css')
s = p.read_text()
s += '''
.cn-home-limit-asof{color:#98a1af;font-size:11px;font-weight:500}.cn-home-limit-total{gap:14px;background:transparent}.cn-home-limit-total>button{border:1px solid #a9c9ff;border-radius:10px;background:#f7faff}.cn-home-limit-total>button+button{border-left:1px solid #b7dfd0;border-color:#b7dfd0;background:#f7fcfa}.cn-home-limit-total>button small{font-size:13px;font-weight:700;color:#172033}.cn-home-limit-total>button strong{font-size:22px}.cn-home-limit-total>button i{font-size:12px;font-weight:700;color:#172033}.cn-home-quota-change{padding:0;background:#fff;border:0;border-top:1px solid #e8ebf0;border-bottom:1px solid #e8ebf0;border-radius:0}.cn-home-quota-change>div{padding:10px 14px}.cn-home-quota-change>div+div{margin:0;padding-top:10px;border-top:0;border-left:1px solid #e8ebf0}.cn-home-quota-change{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}.cn-home-quota-board>h3{font-size:15px;color:#172033}.cn-home-quota-board>section.is-positive{border-color:#c7ead6;background:#f4fcf7}.cn-home-quota-board>section.is-positive>header,.cn-home-quota-board>section.is-positive>button{background:#f4fcf7}.cn-home-quota-board section>header{font-size:12px}.cn-home-limit-disclaimer{padding:0 0 15px;font-size:10px;font-weight:600}
@media(max-width:640px){.cn-home-limit-asof{font-size:10px}.cn-home-limit-total{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.cn-home-limit-total>button{padding:11px}.cn-home-limit-total>button small{font-size:11px}.cn-home-limit-total>button strong{font-size:19px}.cn-home-limit-total>button i{font-size:10px}.cn-home-quota-change{grid-template-columns:repeat(2,minmax(0,1fr))}.cn-home-quota-change>div{display:block}.cn-home-quota-change b{display:block;margin-top:4px}}
'''
p.write_text(s)
