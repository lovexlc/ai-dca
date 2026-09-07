from pathlib import Path

p = Path('src/pages/CnHomeExperience.jsx')
s = p.read_text()
marker = "const COLORS = ['#1468f3', '#e5484d', '#0aa870', '#f08c2e', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#dc6b19', '#4f46e5', '#0f766e', '#be123c', '#9333ea', '#0284c7', '#ca8a04', '#16a34a'];\n"
state_code = '''const MARKET_STATES = {
  open: { label: '交易中', tone: 'open' }, trading: { label: '交易中', tone: 'open' },
  pre_open: { label: '待开市', tone: 'rest' }, lunch_break: { label: '午间休市', tone: 'rest' },
  break: { label: '午间休市', tone: 'rest' }, closed: { label: '已收市', tone: 'closed' },
  holiday: { label: '休市', tone: 'closed' }, unknown: { label: '状态待确认', tone: 'unknown' },
};
function marketMeta(data) {
  const key = String(data?.marketState || data?.sessionState || data?.marketStatus || 'unknown').toLowerCase();
  return { key, ...(MARKET_STATES[key] || { label: data?.marketStateLabel || '状态待确认', tone: 'unknown' }) };
}
'''
if 'const MARKET_STATES =' not in s:
    s = s.replace(marker, marker + state_code)
start = s.index('function Overview({ data, limits }) {')
end = s.index('\nfunction pickSeries(', start)
overview = '''function Overview({ data, limits }) {
  const b = data?.breadth || {};
  const totals = limits?.currencyTotals || [];
  const cny = totals.find((x) => String(x.currency).toUpperCase() === 'CNY');
  const usd = totals.find((x) => String(x.currency).toUpperCase() === 'USD');
  const rise = count(b, 'riseCount', 'rise'), fall = count(b, 'fallCount', 'fall');
  const median = b.premiumMedianPercent ?? b.premiumMedian;
  const market = marketMeta(data);
  return <><div className="cn-home-session"><span className={`cn-home-dot is-${market.tone}`} />{market.label}<span>{timeText(data?.priceAsOf || data?.generatedAt)}</span></div><div className="cn-home-stats"><div><small>上涨 / 下跌</small><strong><i className="up">{rise}</i> / <i className="down">{fall}</i></strong><em>场内全池</em></div><div><small>溢价中位数</small><strong className={number(median) >= 0 ? 'up' : 'down'}>{pct(median)}</strong><em>{b.previousPremiumMedianPercent == null ? '实时口径' : `昨日 ${pct(b.previousPremiumMedianPercent)}`}</em></div><div><small>场外额度</small><strong>{compact(cny?.amount, 'CNY')}</strong><em>{usd ? `美元 ${compact(usd.amount, 'USD')}` : `${cny?.limitedCount ?? 0} 只限购`}</em></div></div>{(data?.anomalies || []).length ? <div className="cn-home-warning">{data.anomalies[0]?.message || data.anomalies[0]}</div> : null}</>;
}
'''
s = s[:start] + overview + s[end:]
start = s.index('function Limits({ data, onFund, onOpenDetail }) {')
end = s.index('\nfunction readLimitCurrency()', start)
limits = '''function trendAmount(row, currency) {
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
    {summaries.length ? <div className="cn-home-quota-change">{summaries.map((row) => <div key={row.currency}><span>{row.label}</span><b className={row.delta > 0 ? 'relax-text' : row.delta < 0 ? 'tighten-text' : ''}>{row.delta == null ? '暂无趋势' : row.delta === 0 ? '较 7 日前持平' : `较 7 日前 ${row.delta > 0 ? '增加' : '减少'} ${compact(Math.abs(row.delta), row.currency)}`}</b></div>)}</div> : null}
    {groups.length ? <div className="cn-home-quota-board"><h3>{latestDay ? `${latestDay.slice(5, 7)}月${latestDay.slice(8, 10)}日 限额变动` : '限额变动'}</h3>{groups.map((group) => <section key={group.key} className={`is-${group.tone}`}><header><span />{group.label}</header>{group.events.map((event) => <button key={event.id || `${event.code}-${event.type}`} onClick={() => onFund?.(event.code)}><div><b>{event.name || event.code}</b><small>{event.code}</small></div><strong>{changeText(event)}</strong><ChevronRight /></button>)}</section>)}</div> : null}
    <p className="cn-home-limit-disclaimer">额度是公开渠道的产品申购上限汇总，不代表任何用户账户的实际剩余额度。</p>
    <footer className="cn-home-foot">更新于 {timeText(data?.limitAsOf || data?.generatedAt)}</footer>
  </>;
}
'''
s = s[:start] + limits + s[end:]
p.write_text(s)

p = Path('src/pages/CnFundLimitDetail.jsx')
s = p.read_text()
s = s.replace('const amount = numeric(row.amount ?? row.limitAmount ?? row.currentAmount);', 'const amount = numeric(row.amount ?? row.limitAmount ?? row.maxPurchasePerDay ?? row.currentAmount);')
s = s.replace("const status = String(row.status || row.purchaseStatus || '').toLowerCase();", "const status = String(row.status || row.purchaseStatus || row.buyStatus || '').toLowerCase();")
p.write_text(s)

p = Path('src/pages/cn-home.css')
s = p.read_text()
s += '''
.cn-home-dot.is-rest{background:#d99220;box-shadow:0 0 0 4px #d9922018}.cn-home-dot.is-closed,.cn-home-dot.is-unknown{background:#98a1af}.cn-home-quota-change{margin:0 15px 14px;padding:11px 14px;border:1px solid #edf0f4;border-radius:10px;background:#fafbfc}.cn-home-quota-change>div{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:11px}.cn-home-quota-change>div+div{margin-top:9px;padding-top:9px;border-top:1px solid #edf0f4}.cn-home-quota-change span{color:#687386}.cn-home-quota-change b{font-size:11px;color:#475569}.cn-home-quota-change .tighten-text{color:#d63d43}.cn-home-quota-change .relax-text{color:#087f5b}.cn-home-quota-board{margin:0 15px 14px}.cn-home-quota-board>h3{margin:0 0 9px;font-size:12px;color:#475569}.cn-home-quota-board>section{overflow:hidden;border:1px solid #edf0f4;border-radius:10px;background:#fff}.cn-home-quota-board>section+section{margin-top:9px}.cn-home-quota-board section>header{display:flex;align-items:center;gap:7px;padding:9px 11px;font-size:11px;font-weight:700;background:#fafbfc}.cn-home-quota-board section>header span{width:7px;height:7px;border-radius:50%;background:#d99220}.cn-home-quota-board section.is-positive>header span{background:#0aa870}.cn-home-quota-board section>button{width:100%;display:grid;grid-template-columns:1fr auto 15px;align-items:center;gap:8px;padding:10px 11px;border:0;border-top:1px solid #f1f3f5;background:#fff;text-align:left}.cn-home-quota-board button div b,.cn-home-quota-board button div small{display:block}.cn-home-quota-board button div b{font-size:11px}.cn-home-quota-board button div small{margin-top:2px;color:#98a1af;font-size:9px}.cn-home-quota-board button>strong{font-size:10px;color:#d63d43}.cn-home-quota-board .is-positive button>strong{color:#087f5b}.cn-home-quota-board svg{width:14px;color:#b0b7c2}.cn-home-limit-disclaimer{margin:0 15px 4px;color:#98a1af;font-size:9px}.cn-home-limit-total>button em{display:none}
'''
p.write_text(s)
