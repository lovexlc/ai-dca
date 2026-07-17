import { useCallback, useEffect, useMemo, useState } from 'react';
import { Cloud, Database, RefreshCw, ShieldCheck } from 'lucide-react';
import { discardSyncDeviceMigration, fetchSyncDevices, fetchUserDataManifest } from '../app/authClient.js';
import { isAnalyticsAdmin } from '../app/analytics.js';
import { loadCloudSession } from '../app/authSession.js';
import { getTabResourceDescriptor } from '../app/syncRegistry.js';
import { getClientId } from '../app/syncClient.js';
import { USER_DATA_HYDRATION_EVENT, userDataStore } from '../app/userDataStore.js';
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

function deviceTypeLabel(value) {
  const type = String(value || '').trim();
  if (type === 'PC Web') return '电脑浏览器';
  if (type === 'APP Web') return '移动端浏览器';
  if (type === 'APP') return 'App';
  if (type === '小程序') return '小程序';
  return type || '未知设备';
}

function deviceMigrationLabel(device) {
  if (String(device?.migrationStatus || '') === 'discarded' || String(device?.dataMigrationStatus || '') === 'cancelled') return '已放弃';
  if (device?.needsRepair) return '需修复';
  if (String(device?.migrationStatus || '') === 'collecting' || String(device?.dataMigrationStatus || '') === 'collecting') return '迁移中';
  if (device?.needsMigration) return '待迁移';
  return '已完成';
}

function deviceMigrationClass(device) {
  const label = deviceMigrationLabel(device);
  if (label === '已完成') return 'bg-emerald-50 text-emerald-700';
  if (label === '已放弃') return 'bg-slate-100 text-slate-500';
  if (label === '迁移中') return 'bg-blue-50 text-blue-700';
  if (label === '需修复') return 'bg-amber-50 text-amber-700';
  return 'bg-orange-50 text-orange-700';
}

function shortDeviceId(value) {
  const id = String(value || '').trim();
  if (id.length <= 16) return id || '—';
  return `${id.slice(0, 8)}…${id.slice(-6)}`;
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
  const [devices, setDevices] = useState([]);
  const [deviceActionId, setDeviceActionId] = useState('');
  const [readAt, setReadAt] = useState('');
  const [securityPassword, setSecurityPassword] = useState('');
  const [migrationProgress, setMigrationProgress] = useState({ progress: 5, current: 0, total: 0, message: '正在确认账号并连接云端…' });

  const refresh = useCallback(async () => {
    if (!isAdmin) return;
    setStatus('loading');
    setError('');
    try {
      const currentSession = loadCloudSession();
      const [next, deviceSnapshot] = await Promise.all([
        fetchUserDataManifest(currentSession, getClientId()),
        fetchSyncDevices(currentSession)
      ]);
      setManifest(next);
      setDevices(Array.isArray(deviceSnapshot?.devices) ? deviceSnapshot.devices : []);
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

  useEffect(() => {
    if (status !== 'migrating') return undefined;
    function handleMigrationProgress(event) {
      const detail = event?.detail || {};
      setMigrationProgress((current) => ({
        ...current,
        ...(detail.stage ? { stage: detail.stage } : {}),
        ...(typeof detail.progress === 'number' ? { progress: detail.progress } : {}),
        ...(typeof detail.current === 'number' ? { current: detail.current } : {}),
        ...(typeof detail.total === 'number' ? { total: detail.total } : {}),
        ...(detail.message ? { message: detail.message } : {})
      }));
    }
    window.addEventListener(USER_DATA_HYDRATION_EVENT, handleMigrationProgress);
    return () => window.removeEventListener(USER_DATA_HYDRATION_EVENT, handleMigrationProgress);
  }, [status]);

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
  const currentMigrationStatus = String(manifest?.migration?.status || manifest?.accountStatus || '').trim();
  const migrationComplete = currentMigrationStatus === 'completed';
  const migrationMode = String(manifest?.migration?.migrationMode || '').trim();
  const migrationRepairAvailable = Boolean(manifest?.legacySnapshot) && migrationComplete && migrationMode !== 'tab-scoped-v2';
  const migrationAvailable = Boolean(manifest?.legacySnapshot) && (!migrationComplete || migrationRepairAvailable);
  const migrationIsRepair = migrationComplete && migrationRepairAvailable;
  const currentDeviceId = getClientId();
  const currentDevice = devices.find((device) => String(device?.deviceId || '') === currentDeviceId);
  const otherPendingDevices = devices.filter((device) => String(device?.deviceId || '') !== currentDeviceId && device?.needsMigration);
  const pendingDeviceCount = devices.filter((device) => device?.needsMigration).length;
  const accountHasPendingDevices = devices.length > 0 && pendingDeviceCount > 0;

  async function handleMigration() {
    if (!migrationAvailable || status === 'migrating') return;
    setMigrationProgress({ progress: 5, current: 0, total: 0, message: '正在确认账号并连接云端…' });
    setStatus('migrating');
    setError('');
    try {
      const currentSession = loadCloudSession();
      await userDataStore.startSession(currentSession, {
        action: 'login',
        securityPassword,
        rememberDevice: true,
        decision: 'cloud',
        repairLegacyTabResources: migrationIsRepair
      });
      // 旧版归集会暂时切换到兼容模式；迁移完成后重新挂载 Tab-scoped 会话，
      // 避免后续普通配置又回到旧的全量接口。
      await userDataStore.startRemoteSession(currentSession, { action: 'restore' });
      setSecurityPassword('');
      await refresh();
    } catch (err) {
      setStatus('error');
      setError(err?.message || '云端数据迁移失败');
    }
  }

  async function handleDiscardDevice(device) {
    const deviceId = String(device?.deviceId || '').trim();
    if (!deviceId || deviceId === currentDeviceId || deviceActionId) return;
    const confirmed = typeof window === 'undefined' || window.confirm(`确定放弃设备 ${shortDeviceId(deviceId)} 的迁移吗？该设备上的本地数据不会再归集到账号。`);
    if (!confirmed) return;
    setDeviceActionId(deviceId);
    setError('');
    try {
      await discardSyncDeviceMigration({ deviceId }, loadCloudSession());
      await refresh();
    } catch (err) {
      setError(err?.message || '放弃设备迁移失败');
    } finally {
      setDeviceActionId('');
    }
  }

  return (
    <div className={cx('mx-auto max-w-7xl space-y-4', embedded ? 'px-4 sm:px-6' : 'px-6')}>
      <header className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700"><Cloud className="h-3.5 w-3.5" />管理员专属</div>
            <h1 className="mt-3 text-2xl font-bold text-slate-900">云端数据</h1>
            <p className="mt-1 text-sm text-slate-500">查看逐 Tab 资源和旧版全量备份状态，不展示交易密文内容。</p>
            {otherPendingDevices.length ? <div className="mt-3 max-w-xl rounded-2xl border border-orange-200 bg-orange-50 px-3 py-2.5 text-xs leading-5 text-orange-800">当前设备之外还有 {otherPendingDevices.length} 台设备待处理。请到对应设备完成迁移，或在下方确认放弃该设备；账号迁移不会因当前设备完成而提前结束。</div> : null}
            {status === 'migrating' ? (
              <div className="mt-3 max-w-xl rounded-2xl border border-amber-200 bg-amber-50/70 px-3 py-2.5" role="status" aria-label="迁移进度">
                <div className="flex items-center justify-between gap-3 text-xs font-semibold text-amber-800"><span>{migrationProgress.message || '正在迁移云端数据…'}</span><span className="tabular-nums">{Math.round(migrationProgress.progress)}%</span></div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-amber-100"><div className="h-full rounded-full bg-amber-500 transition-[width] duration-300" style={{ width: `${Math.min(100, Math.max(0, migrationProgress.progress))}%` }} /></div>
                {migrationProgress.total ? <div className="mt-1 text-[11px] text-amber-700">已处理 {migrationProgress.current}/{migrationProgress.total} 项</div> : null}
              </div>
            ) : <div className="mt-2 text-xs text-slate-400">{status === 'ready' ? `最后读取：${formatDate(readAt)}` : status === 'loading' ? '正在读取云端清单…' : error || '尚未读取'}</div>}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {migrationAvailable ? (
              <>
                <input type="password" value={securityPassword} onChange={(event) => setSecurityPassword(event.target.value)} placeholder="旧安全密码（已记住可留空）" aria-label="旧安全密码" className="h-9 min-w-56 rounded-full border border-amber-200 bg-amber-50/50 px-3 text-sm text-slate-700 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100" />
                <button type="button" onClick={() => void handleMigration()} disabled={status === 'migrating' || status === 'loading'} className="inline-flex items-center justify-center gap-1.5 rounded-full bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-700 disabled:cursor-wait disabled:opacity-60"><Cloud className={cx('h-3.5 w-3.5', status === 'migrating' && 'animate-pulse')} />{status === 'migrating' ? '迁移中…' : migrationIsRepair ? '修复迁移数据' : '迁移当前账号'}</button>
              </>
            ) : null}
            {migrationComplete && manifest?.legacySnapshot && !migrationRepairAvailable && !accountHasPendingDevices ? <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">迁移已完成，按钮已隐藏</span> : null}
            <button type="button" onClick={() => void refresh()} disabled={status === 'loading' || status === 'migrating'} className="inline-flex items-center justify-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"><RefreshCw className={cx('h-3.5 w-3.5', (status === 'loading' || status === 'migrating') && 'animate-spin')} />刷新</button>
          </div>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="逐 Tab 资源" value={activeResources.length} hint={`共 ${resources.length} 项记录`} />
        <StatCard label="旧版全量备份" value={manifest?.legacySnapshot ? '存在' : '无'} hint={legacyMeta ? `${legacyMeta.keyCount || 0} 个 key · ${formatDate(legacyMeta.updatedAt)}` : '兼容旧版云端同步'} />
        <StatCard label="迁移状态" value={accountHasPendingDevices ? '部分完成' : migrationLabel(manifest)} hint={currentDevice ? `当前设备：${deviceMigrationLabel(currentDevice)}` : '当前设备'} />
        <StatCard label="资源更新时间" value={formatDate(resources[0]?.updatedAt)} hint="以资源清单为准" />
      </section>

      {devices.length ? <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900">账号设备迁移</h2>
            <p className="mt-1 text-xs text-slate-400">当前设备完成不代表其它设备完成；放弃只改变该设备的迁移状态，不删除旧版云端备份。</p>
          </div>
          <span className="text-xs font-semibold text-slate-500">共 {devices.length} 台 · 待处理 {pendingDeviceCount} 台</span>
        </div>
        <div className="overflow-x-auto rounded-2xl border border-slate-100">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-3 py-2 text-left">设备</th><th className="px-3 py-2 text-left">类型</th><th className="px-3 py-2 text-left">迁移状态</th><th className="px-3 py-2 text-left">最近活动</th><th className="px-3 py-2 text-right">操作</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {devices.map((device) => {
                const deviceId = String(device?.deviceId || '');
                const isCurrent = deviceId === currentDeviceId;
                const label = deviceMigrationLabel(device);
                const canDiscard = !isCurrent && device?.needsMigration && label !== '已放弃';
                return <tr key={deviceId}>
                  <td className="px-3 py-2 font-medium text-slate-700"><span title={deviceId}>{isCurrent ? '当前设备' : shortDeviceId(deviceId)}</span></td>
                  <td className="px-3 py-2 text-slate-500">{deviceTypeLabel(device.deviceType)}</td>
                  <td className="px-3 py-2"><span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${deviceMigrationClass(device)}`}>{label}</span>{device?.needsRepair ? <span className="ml-2 text-xs text-amber-600">旧版归集</span> : null}</td>
                  <td className="px-3 py-2 text-slate-500">{formatDate(device.lastSeenAt)}</td>
                  <td className="px-3 py-2 text-right">{canDiscard ? <button type="button" onClick={() => void handleDiscardDevice(device)} disabled={Boolean(deviceActionId)} className="rounded-full border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60">{deviceActionId === deviceId ? '处理中…' : '放弃迁移'}</button> : isCurrent ? <span className="text-xs text-slate-400">请在本设备处理</span> : <span className="text-xs text-slate-400">—</span>}</td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>
      </section> : null}

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
