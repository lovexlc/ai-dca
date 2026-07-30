import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Layers, Pencil, Plus, Save, X } from 'lucide-react';
import { fetchRemoteFundData, updateRemoteFundData } from '../app/analytics.js';
import { loadCloudSession } from '../app/authClient.js';
import { formatShanghaiDateTime } from '../app/timeZone.js';
import { cx } from '../components/experience-ui.jsx';

const PAGE_SIZE = 20;
const RATE_FIELDS = [
  ['annualFeeRate', '年度总费率'],
  ['managementFeeRate', '管理费率'],
  ['custodyFeeRate', '托管费率'],
  ['salesServiceFeeRate', '销售服务费率'],
  ['redeemFeeRate', '卖出/赎回费率']
];

function displayRate(value) {
  return value == null || value === '' || !Number.isFinite(Number(value)) ? '—' : `${Number(value)}%`;
}

function editorFromItem(item = {}) {
  return {
    code: String(item.code || ''),
    name: String(item.name || ''),
    fundType: String(item.fundType || 'unknown'),
    ...Object.fromEntries(RATE_FIELDS.map(([key]) => [key, item[key] == null ? '' : String(item[key])])),
    notice: String(item.notice || ''),
    purchaseRules: item.purchaseRules ? JSON.stringify(item.purchaseRules, null, 2) : '',
    redeemRules: item.redeemRules ? JSON.stringify(item.redeemRules, null, 2) : '',
    operationFees: item.operationFees ? JSON.stringify(item.operationFees, null, 2) : ''
  };
}

function toPatch(editor) {
  const patch = {
    name: editor.name,
    fundType: editor.fundType,
    notice: editor.notice,
  };
  RATE_FIELDS.forEach(([key]) => { patch[key] = editor[key] === '' ? null : Number(editor[key]); });
  ['purchaseRules', 'redeemRules', 'operationFees'].forEach((key) => {
    patch[key] = editor[key].trim() ? editor[key] : null;
  });
  return patch;
}

function StatPill({ label, value, tone = 'slate' }) {
  return <div className={cx('rounded-xl border px-3 py-2', tone === 'rose' ? 'border-rose-100 bg-rose-50' : 'border-slate-200 bg-slate-50')}><div className="text-[11px] text-slate-500">{label}</div><div className={cx('mt-0.5 text-lg font-bold tabular-nums', tone === 'rose' ? 'text-rose-700' : 'text-slate-800')}>{Number(value) || 0}</div></div>;
}

export function AdminFundDataTab({ embedded = false } = {}) {
  const session = loadCloudSession();
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [missing, setMissing] = useState('any');
  const [kind, setKind] = useState('');
  const [page, setPage] = useState(1);
  const [payload, setPayload] = useState({ items: [], total: 0, stats: {} });
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [editor, setEditor] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const reload = (nextPage = page, signal) => {
    setStatus('loading');
    setError('');
    return fetchRemoteFundData({ page: nextPage, pageSize: PAGE_SIZE, q: appliedQuery, missing, kind, signal })
      .then((next) => { setPayload(next); setStatus('ready'); })
      .catch((err) => {
        if (err?.name === 'AbortError') return;
        setStatus('error');
        setError(err instanceof Error ? err.message : String(err));
      });
  };

  useEffect(() => {
    const controller = new AbortController();
    reload(page, controller.signal);
    return () => controller.abort();
  // Keep the request driven by the committed search value, not every keystroke.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, appliedQuery, missing, kind]);

  const totalPages = Math.max(1, Math.ceil((Number(payload.total) || 0) / PAGE_SIZE));
  const stats = payload.stats || {};
  const pageLabel = useMemo(() => `${payload.total || 0} 条 · 第 ${page}/${totalPages} 页`, [payload.total, page, totalPages]);

  const startNew = () => {
    setSaveError('');
    setEditor(editorFromItem({ fundType: 'unknown' }));
  };

  const save = async () => {
    if (!editor?.code) return;
    setSaving(true);
    setSaveError('');
    try {
      await updateRemoteFundData(editor.code, toPatch(editor), { session });
      setEditor(null);
      await reload(page);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={cx('space-y-4', embedded ? '' : 'px-6')}>
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700"><Layers className="h-3.5 w-3.5" />D1 基金数据补录</div>
            <h2 className="mt-3 text-xl font-bold text-slate-900">费率与基金元数据</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">外部费率同步会写入 KV 和 D1；这里的管理员修改会保存在 D1，并优先于后续自动抓取。列表展示当前已经进入 D1 的基金，未出现的代码可用“新增基金”补录。</p>
          </div>
          <button type="button" onClick={startNew} className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700"><Plus className="h-4 w-4" />新增基金</button>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          <StatPill label="D1 基金数" value={stats.total} />
          <StatPill label="年度总费率缺失" value={stats.annualFeeRate} tone="rose" />
          <StatPill label="卖出费率缺失" value={stats.redeemFeeRate} tone="rose" />
          <StatPill label="管理费缺失" value={stats.managementFeeRate} />
          <StatPill label="托管费缺失" value={stats.custodyFeeRate} />
          <StatPill label="销售服务费缺失" value={stats.salesServiceFeeRate} />
          <StatPill label="费率 JSON 缺失" value={stats.feeJson} />
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { setPage(1); setAppliedQuery(query.trim()); } }} placeholder="搜索基金代码或名称" className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[var(--brand-text)]" />
          <button type="button" onClick={() => { setPage(1); setAppliedQuery(query.trim()); }} className="rounded-xl bg-[var(--fg-1000)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--fg-900)]">搜索</button>
          <select value={missing} onChange={(event) => { setPage(1); setMissing(event.target.value); }} className="rounded-xl border border-slate-200 px-3 py-2 text-sm">
            <option value="any">任一核心费率缺失</option>
            <option value="">全部数据</option>
            <option value="annualFeeRate">年度总费率缺失</option>
            <option value="redeemFeeRate">卖出费率缺失</option>
            <option value="managementFeeRate">管理费缺失</option>
            <option value="custodyFeeRate">托管费缺失</option>
            <option value="salesServiceFeeRate">销售服务费缺失</option>
            <option value="feeJson">费率规则缺失</option>
          </select>
          <select value={kind} onChange={(event) => { setPage(1); setKind(event.target.value); }} className="rounded-xl border border-slate-200 px-3 py-2 text-sm">
            <option value="">全部类型</option><option value="otc">场外</option><option value="exchange">场内</option><option value="unknown">未分类</option>
          </select>
        </div>
        <div className="mt-3 flex items-center justify-between text-xs text-slate-400"><span>{status === 'loading' ? '正在读取 D1…' : error || pageLabel}</span><span>费率单位：%</span></div>
        {error ? <div className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
        <div className="mt-3 overflow-x-auto rounded-2xl border border-slate-100">
          <table className="min-w-[980px] w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-3 py-2 text-left">代码 / 名称</th><th className="px-3 py-2 text-right">年度总费率</th><th className="px-3 py-2 text-right">卖出费率</th><th className="px-3 py-2 text-right">管理费</th><th className="px-3 py-2 text-right">托管费</th><th className="px-3 py-2 text-right">销售服务费</th><th className="px-3 py-2 text-left">来源 / 更新时间</th><th className="px-3 py-2 text-right">操作</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {(payload.items || []).map((item) => <tr key={item.code} className="hover:bg-slate-50"><td className="px-3 py-2"><div className="font-mono font-semibold text-slate-800">{item.code}</div><div className="max-w-[260px] truncate text-xs text-slate-500" title={item.name}>{item.name}</div><div className="text-[11px] text-slate-400">{item.fundType === 'otc' ? '场外' : item.fundType === 'exchange' ? '场内' : '未分类'}</div></td><td className="px-3 py-2 text-right tabular-nums">{displayRate(item.annualFeeRate)}</td><td className="px-3 py-2 text-right tabular-nums">{displayRate(item.redeemFeeRate)}</td><td className="px-3 py-2 text-right tabular-nums">{displayRate(item.managementFeeRate)}</td><td className="px-3 py-2 text-right tabular-nums">{displayRate(item.custodyFeeRate)}</td><td className="px-3 py-2 text-right tabular-nums">{displayRate(item.salesServiceFeeRate)}</td><td className="px-3 py-2"><div className="text-xs text-slate-600">{item.source || '—'}</div><div className="text-[11px] text-slate-400">{item.syncedAt ? formatShanghaiDateTime(item.syncedAt) : '未同步'}</div></td><td className="px-3 py-2 text-right"><button type="button" onClick={() => { setSaveError(''); setEditor(editorFromItem(item)); }} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-white"><Pencil className="h-3.5 w-3.5" />编辑</button></td></tr>)}
              {!payload.items?.length && status !== 'loading' ? <tr><td colSpan={8} className="px-3 py-10 text-center text-slate-400">没有匹配的基金数据</td></tr> : null}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex items-center justify-end gap-2"><button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs disabled:opacity-40"><ChevronLeft className="h-3.5 w-3.5" />上一页</button><span className="text-xs text-slate-500">{page}/{totalPages}</span><button type="button" disabled={page >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs disabled:opacity-40">下一页<ChevronRight className="h-3.5 w-3.5" /></button></div>
      </section>

      {editor ? <section className="rounded-3xl border border-[var(--brand-text)] bg-[var(--brand-tint)] p-4 shadow-sm"><div className="flex items-center justify-between"><div><h3 className="text-base font-bold text-slate-900">{payload.items.some((item) => item.code === editor.code) ? '编辑基金数据' : '新增基金数据'}</h3><p className="mt-1 text-xs text-slate-500">费率数字按百分比填写，例如 0.5 表示 0.5%。</p></div><button type="button" onClick={() => setEditor(null)} className="rounded-lg p-1.5 text-slate-400 hover:bg-white"><X className="h-4 w-4" /></button></div><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[['code', '基金代码'], ['name', '基金名称'], ['fundType', '基金类型'], ...RATE_FIELDS].map(([key, label]) => <label key={key} className="text-xs font-semibold text-slate-600">{label}<input value={editor[key] || ''} disabled={key === 'code' && payload.items.some((item) => item.code === editor.code)} onChange={(event) => setEditor((prev) => ({ ...prev, [key]: event.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-normal outline-none focus:border-[var(--brand-text)]" /></label>)}</div><div className="mt-3 grid gap-3 lg:grid-cols-3">{[['purchaseRules', '申购费率规则 JSON'], ['redeemRules', '赎回费率规则 JSON'], ['operationFees', '运作费用规则 JSON']].map(([key, label]) => <label key={key} className="text-xs font-semibold text-slate-600">{label}<textarea rows={5} value={editor[key] || ''} onChange={(event) => setEditor((prev) => ({ ...prev, [key]: event.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-xs font-normal outline-none focus:border-[var(--brand-text)]" placeholder="可留空；填写 JSON 数组" /></label>)}</div><label className="mt-3 block text-xs font-semibold text-slate-600">备注<textarea rows={2} value={editor.notice || ''} onChange={(event) => setEditor((prev) => ({ ...prev, notice: event.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-normal outline-none focus:border-[var(--brand-text)]" /></label>{saveError ? <div className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{saveError}</div> : null}<div className="mt-4 flex justify-end gap-2"><button type="button" onClick={() => setEditor(null)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600">取消</button><button type="button" disabled={saving || !/^\d{6}$/.test(editor.code)} onClick={save} className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--fg-1000)] px-3 py-2 text-sm font-semibold text-white hover:bg-[var(--fg-900)] disabled:opacity-50"><Save className="h-4 w-4" />{saving ? '保存中…' : '保存到 D1'}</button></div></section> : null}
    </div>
  );
}
