import { useCallback, useEffect, useMemo, useState } from 'react';
import { Cloud, Database, RefreshCw, ShieldCheck } from 'lucide-react';
import { fetchUserDataManifest } from '../app/authClient.js';
import { isAnalyticsAdmin } from '../app/analytics.js';
import { loadCloudSession } from '../app/authSession.js';
import { getTabResourceDescriptor } from '../app/syncRegistry.js';
import { cx } from '../components/experience-ui.jsx';

function formatDate(value) {
  const text = String(value || '').trim();
  if (!text) return '—';
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? text : date.toLocaleString('zh-CN', { hour12: false });
}

function migrationLabel(manifest) {
  const status = String(manifest?.migration?.status || manifest?.accountStatus || '').trim();
  if (status === 'completed') return '已完成';
  if (status === 'collecting') return '归集中';
  if (status === 'pending' || status === 'migration_pending') return '待归集';
  return status || '未开始';
}

function StatCard({ label, value, hint }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-semibold text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-bold tabular-nums text-slate-900">{value}</div>
      {hint ? <div className="mt-1 text-xs text-slate-400">{hint}</div> : null}
    </div>
  );
}

export function CloudDataAdminExperience({ embedded = false } = {}) {
  const session = loadCloudSession();
  const isAdmin = isAnalyticsAdmin(session);
  const sessionId = String(session?.userId || session?.username || '');
  const accessToken = String(session?.accessToken || '');
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [manifest, setManifest] = useState(null);
  const [readAt, setReadAt] = useState('');

  const refresh = useCallback(async () => {
    if (!isAdmin) return;
    setStatus('loading');
    setError('');
    try {
      const next = await fetchUserDataManifest(loadCloudSession());
      setManifest(next);
      setReadAt(new Date().toISOString());
      setStatus('ready');
    } catch (err) {
      setStatus('error');
      setError(err?.message || '读取云端数据清单失败');
    }
  }, [accessToken, isAdmin, sessionId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const resources = useMemo(() => (
    Array.isArray(manifest?.resources)
      ? [...manifest.resources].sort((left, right) => String(left.resourceId).localeCompare(String(right.resourceId)))
      : []
  ), [manifest]);

  if (!isAdmin) {
    return (
      <div className={cx('mx-auto max-w-4xl', embedded ? 'px-4 sm:px-6' : 'px-6')}>
        <div className="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-amber-900">
          <div className="flex items-center gap-2 text-lg font-bold"><ShieldCheck className="h-5 w-5" />管理员权限 required</div>
          <p className="mt-2 text-sm leading-6">当前账号没有云端数据查看权限。</p>
        </div>
      </div>
    );
  }

  const legacyMeta = manifest?.legacySnapshotMeta;
  const activeResources = resources.filter((item) => !item.deleted);

  return (
    <div className={cx('mx-auto max-w-7xl space-y-4', embedded ? 'px-4 sm:px-6' : 'px-6')}>
      <header className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700"><Cloud className="h-3.5 w-3.5" />管理员专属</div>
            <h1 className="mt-3 text-2xl font-bold text-slate-900">云端数据</h1>
            <p className="mt-1 text-sm text-slate-500">查看逐 Tab 资源和旧版全量备份状态，不展示交易密文内容。</p>
            <div className="mt-2 text-xs text-slate-400">{status === 'ready' ? `最后读取：${formatDate(readAt)}` : status === 'loading' ? '正在读取云端清单…' : error || '尚未读取'}</div>
          </div>
          <button type="button" onClick={() => void refresh()} disabled={status === 'loading'} className="inline-flex items-center justify-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"><RefreshCw className={cx('h-3.5 w-3.5', status === 'loading' && 'animate-spin')} />刷新</button>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="逐 Tab 资源" value={activeResources.length} hint={`共 ${resources.length} 项记录`} />
        <StatCard label="旧版全量备份" value={manifest?.legacySnapshot ? '存在' : '无'} hint={legacyMeta ? `${legacyMeta.keyCount || 0} 个 key · ${formatDate(legacyMeta.updatedAt)}` : '兼容旧版云端同步'} />
        <StatCard label="迁移状态" value={migrationLabel(manifest)} hint={manifest?.migration?.deviceStatus ? `设备：${manifest.migration.deviceStatus}` : '当前账号'} />
        <StatCard label="资源更新时间" value={formatDate(resources[0]?.updatedAt)} hint="以资源清单为准" />
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900">逐 Tab 云端资源</h2>
            <p className="mt-1 text-xs text-slate-400">普通配置使用独立 REST 资源，持仓交易记录仍保持加密。</p>
          </div>
          <Database className="h-5 w-5 text-slate-400" />
        </div>
        <div className="overflow-x-auto rounded-2xl border border-slate-100">
          <table className="w-full min-w-[680px] text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-3 py-2 text-left">资源</th><th className="px-3 py-2 text-left">类型</th><th className="px-3 py-2 text-right">版本</th><th className="px-3 py-2 text-left">状态</th><th className="px-3 py-2 text-left">更新时间</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {resources.length ? resources.map((row) => {
                const descriptor = getTabResourceDescriptor(row.resourceId);
                return <tr key={row.resourceId}><td className="px-3 py-2 font-medium text-slate-700">{row.resourceId}</td><td className="px-3 py-2 text-slate-500">{descriptor?.security === 'encrypted' ? '加密' : descriptor ? '明文 REST' : '兼容资源'}</td><td className="px-3 py-2 text-right tabular-nums text-slate-600">{Number(row.revision) || 0}</td><td className="px-3 py-2 text-slate-500">{row.deleted ? '已删除' : '可用'}</td><td className="px-3 py-2 text-slate-500">{formatDate(row.updatedAt)}</td></tr>;
              }) : <tr><td colSpan={5} className="px-3 py-10 text-center text-slate-400">暂无逐 Tab 资源；请检查旧版全量备份状态。</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
