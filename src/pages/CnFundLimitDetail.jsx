import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import './cn-fund-limit-detail.css';

const CATEGORIES = [
  { key: 'NASDAQ100', label: '纳斯达克100', match: /纳斯达克\s*100|纳指\s*100/ },
  { key: 'SP500', label: '标普500', match: /标普\s*500|标准普尔\s*500/ },
];

function numeric(value) { const n = Number(value); return Number.isFinite(n) ? n : null; }
function money(value, currency) {
  const n = numeric(value); if (n == null) return '—';
  const sign = currency === 'USD' ? '$' : '¥';
  if (Math.abs(n) >= 100000000) return `${sign}${(n / 100000000).toFixed(1)}亿`;
  if (Math.abs(n) >= 10000) return `${sign}${(n / 10000).toFixed(1)}万`;
  return `${sign}${n.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`;
}
function normalizedRecords(data) {
  const source = Array.isArray(data?.records) ? data.records : Array.isArray(data?.items) ? data.items : [];
  return source.map((row, index) => {
    const currency = String(row.currency || 'CNY').toUpperCase();
    const amount = numeric(row.amount ?? row.limitAmount ?? row.currentAmount);
    const status = String(row.status || row.purchaseStatus || '').toLowerCase();
    const isSuspended = Boolean(row.isSuspended) || /suspend|暂停/.test(status);
    return { ...row, key: row.key || `${currency}-${row.code || index}`, currency, amount, isSuspended, name: row.name || row.fundName || row.code || '未知基金', code: row.code || row.symbol || '', amountText: row.amountText || (isSuspended ? '暂停申购' : money(amount, currency)), appLabel: row.appLabel || row.channel || row.platform || '' };
  });
}

export function CnFundLimitDetail({ data, currency = 'CNY', loading, error, onRetry, onBack, onSwitchCurrency }) {
  const [category, setCategory] = useState('ALL');
  useEffect(() => setCategory('ALL'), [currency]);
  const model = useMemo(() => {
    const all = normalizedRecords(data);
    const totals = Array.isArray(data?.currencyTotals) ? data.currencyTotals : [];
    const available = Array.from(new Set([...totals.map((row) => String(row.currency || '').toUpperCase()), ...all.map((row) => row.currency)].filter(Boolean)));
    const currencyRecords = all.filter((row) => row.currency === currency);
    const categories = [{ key: 'ALL', label: '全部' }, ...CATEGORIES.filter((meta) => currencyRecords.some((row) => meta.match.test(String(row.name))))];
    const selected = categories.some((item) => item.key === category) ? category : 'ALL';
    const filtered = selected === 'ALL' ? currencyRecords : currencyRecords.filter((row) => CATEGORIES.find((item) => item.key === selected)?.match.test(String(row.name)));
    filtered.sort((a, b) => Number(a.isSuspended) - Number(b.isSuspended) || (b.amount || 0) - (a.amount || 0) || String(a.name).localeCompare(String(b.name), 'zh-CN'));
    const total = totals.find((row) => String(row.currency).toUpperCase() === currency);
    return { available, categories, selected, records: filtered, allCount: currencyRecords.length, openCount: currencyRecords.filter((row) => !row.isSuspended).length, total: total?.amount };
  }, [data, currency, category]);

  return <main className="cn-limit-detail">
    <header className="cn-limit-detail-head"><button type="button" onClick={onBack} aria-label="返回市场首页"><ArrowLeft /></button><div><h1>场外额度详情</h1><p>基金申购限额列表</p></div><button type="button" className="refresh" onClick={onRetry} disabled={loading}><RefreshCw className={loading ? 'spin' : ''} /></button></header>
    {model.available.includes('CNY') && model.available.includes('USD') ? <div className="cn-limit-segment"><button className={currency === 'CNY' ? 'active' : ''} onClick={() => onSwitchCurrency('CNY')}>人民币</button><button className={currency === 'USD' ? 'active' : ''} onClick={() => onSwitchCurrency('USD')}>美元</button></div> : null}
    {loading && !model.records.length ? <div className="cn-limit-state">加载中…</div> : error && !model.records.length ? <div className="cn-limit-state"><span>额度明细暂不可用，请稍后再试</span><button onClick={onRetry}>重试</button></div> : <>
      <section className="cn-limit-summary"><strong>{money(model.total, currency)}</strong><span>{model.allCount ? `${model.allCount} 只 · 可申购 ${model.openCount} 只` : '暂无额度数据'}</span><small>更新于 {data?.generatedAt ? new Date(data.generatedAt).toLocaleString('zh-CN') : '—'}</small></section>
      {model.categories.length > 1 ? <div className="cn-limit-filters">{model.categories.map((item) => <button key={item.key} className={model.selected === item.key ? 'active' : ''} onClick={() => setCategory(item.key)}>{item.label}</button>)}</div> : null}
      {model.records.length ? <section className="cn-limit-list">{model.records.map((row) => <article key={row.key}><div><b>{row.name}</b><small>{row.code}</small></div><div className="side"><strong className={row.isSuspended ? 'suspended' : ''}>{row.amountText}</strong>{row.isSuspended || row.appLabel ? <em className={row.isSuspended ? 'suspended' : ''}>{row.isSuspended ? '暂停申购' : row.appLabel}</em> : null}</div></article>)}</section> : <div className="cn-limit-state"><b>暂无额度数据</b><span>每日自动更新，稍后再来看看。</span></div>}
      <p className="cn-limit-disclaimer">额度依据基金公司公开公告整理，仅供参考，实际以各销售渠道为准。</p>
    </>}
  </main>;
}
