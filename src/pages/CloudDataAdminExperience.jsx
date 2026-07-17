import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  Database,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  UploadCloud
} from 'lucide-react';
import {
  fetchCloudDataCheck,
  fetchSyncDevices,
  fetchUserDataManifest,
  registerSyncDevice,
  saveCloudDataCheck
} from '../app/authClient.js';
import { isAccountDataScopeReady, markAccountDataScopeReady } from '../app/accountDataScope.js';
import { isAnalyticsAdmin } from '../app/analytics.js';
import { loadCloudSession } from '../app/authSession.js';
import { getClientEnd, getClientId } from '../app/syncClient.js';
import { userDataStore } from '../app/userDataStore.js';
import {
  CLOUD_DATA_RESOURCE_REGISTRY,
  applyCloudDataChoices,
  inspectCloudData,
  summarizeCloudDataResources
} from '../app/cloudDataConflict.js';
import { SYNC_REGISTRY } from '../app/syncRegistry.js';
import { cx } from '../components/experience-ui.jsx';

const labelsByKey = new Map(SYNC_REGISTRY.map((item) => [item.key, item.label]));

function formatDate(value) {
  const text = String(value || '').trim();
  if (!text) return '—';
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? text : date.toLocaleString('zh-CN', { hour12: false });
}

function formatValue(value) {
  if (value == null) return '—';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > 360 ? `${text.slice(0, 360)}…` : text;
}

function resourceLabel(resource) {
  return labelsByKey.get(resource?.key) || resource?.descriptor?.label || resource?.key || '未知资源';
}

function deviceTypeLabel(value) {
  const type = String(value || '').trim();
  if (type === 'PC Web') return '电脑浏览器';
  if (type === 'APP Web') return '移动端浏览器';
  if (type === 'APP') return 'App';
  if (type === '小程序') return '小程序';
  return type || '未知设备';
}

function deviceStatusLabel(device) {
  const status = String(device?.dataCheckStatus || '').trim();
  if (status === 'completed') return '已完成';
  if (status === 'matched') return '已一致';
  if (status === 'conflict') return '有冲突';
  if (status === 'checking') return '检查中';
  if (status === 'abandoned') return '已放弃';
  return '未检查';
}

function deviceStatusClass(device) {
  const status = String(device?.dataCheckStatus || '').trim();
  if (status === 'completed' || status === 'matched') return 'bg-emerald-50 text-emerald-700';
  if (status === 'conflict') return 'bg-orange-50 text-orange-700';
  if (status === 'checking') return 'bg-blue-50 text-blue-700';
  return 'bg-slate-100 text-slate-500';
}

function resourceStatusLabel(status) {
  if (status === 'matched') return '一致';
  if (status === 'conflict') return '有冲突';
  if (status === 'local-only') return '仅本机';
  if (status === 'cloud-only') return '仅云端';
  if (status === 'unavailable') return '暂不可读';
  return status || '待检查';
}

function resourceStatusClass(status) {
  if (status === 'matched') return 'bg-emerald-50 text-emerald-700';
  if (status === 'unavailable') return 'bg-slate-100 text-slate-500';
  return 'bg-orange-50 text-orange-700';
}

function choiceValue(choices, resourceKey, rowKey) {
  const value = choices?.[resourceKey]?.decisions?.[rowKey];
  return typeof value === 'string' ? { choice: value, fields: {} } : value || null;
}

function rowExplicitlyChosen(row, decision) {
  if (!decision) return false;
  if (row.kind !== 'changed' || !row.fields?.length) return Boolean(decision.choice);
  if (decision.choice === 'local' || decision.choice === 'cloud') return true;
  return row.fields.every((field) => ['local', 'cloud'].includes(decision.fields?.[field.name]));
}

function buildCheckPayload(resources) {
  return resources.map((resource) => ({
    resourceId: resource.key,
    status: resource.status,
    localHash: resource.localHash,
    cloudHash: resource.cloudHash,
    conflictCount: resource.rows?.length || 0,
    localOnlyCount: resource.status === 'local-only' ? 1 : 0,
    cloudOnlyCount: resource.status === 'cloud-only' ? 1 : 0
  }));
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

function ChoiceButton({ active, children, onClick, tone = 'cloud' }) {
  const color = tone === 'local'
    ? active ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
    : active ? 'border-sky-500 bg-sky-50 text-sky-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50';
  return <button type="button" onClick={onClick} className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${color}`}>{children}</button>;
}

function ConflictRow({ resource, row, decision, onChoice, onFieldChoice }) {
  const rowDecision = decision || {};
  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-700">
            <span>{row.kind === 'local-only' ? '本机独有' : row.kind === 'remote-only' ? '云端独有' : row.kind === 'field' ? '字段冲突' : '记录冲突'}</span>
            <code className="rounded bg-white px-1.5 py-0.5 text-[11px] text-slate-500">{row.id}</code>
          </div>
          <div className="mt-2 grid gap-2 text-xs text-slate-500 md:grid-cols-2">
            <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-white p-2">本机：{formatValue(row.local)}</pre>
            <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-white p-2">云端：{formatValue(row.remote)}</pre>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <ChoiceButton active={rowDecision.choice === 'cloud'} onClick={() => onChoice('cloud')}>采用云端</ChoiceButton>
          <ChoiceButton active={rowDecision.choice === 'local'} tone="local" onClick={() => onChoice('local')}>使用本机</ChoiceButton>
        </div>
      </div>
      {row.kind === 'changed' && row.fields?.length ? (
        <div className="mt-3 space-y-2 border-t border-slate-200 pt-2">
          <div className="text-[11px] font-semibold text-slate-400">字段级选择（整条记录选择会覆盖下面字段）</div>
          {row.fields.map((field) => {
            const fieldChoice = rowDecision.fields?.[field.name] || '';
            return <div key={field.name} className="flex flex-col gap-2 rounded-xl bg-white px-2.5 py-2 text-xs sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0"><code className="text-slate-600">{field.name}</code><span className="ml-2 text-slate-400">本机 {formatValue(field.local)} · 云端 {formatValue(field.remote)}</span></div>
              <div className="flex shrink-0 gap-1.5">
                <ChoiceButton active={fieldChoice === 'cloud'} onClick={() => onFieldChoice(field.name, 'cloud')}>云端</ChoiceButton>
                <ChoiceButton active={fieldChoice === 'local'} tone="local" onClick={() => onFieldChoice(field.name, 'local')}>本机</ChoiceButton>
              </div>
            </div>;
          })}
        </div>
      ) : null}
    </div>
  );
}

export function CloudDataAdminExperience({ embedded = false } = {}) {
  const session = loadCloudSession();
  const isAdmin = isAnalyticsAdmin(session);
  const sessionKey = String(session?.userId || session?.username || '');
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [manifest, setManifest] = useState(null);
  const [devices, setDevices] = useState([]);
  const [resources, setResources] = useState([]);
  const [choices, setChoices] = useState({});
  const [selectedKey, setSelectedKey] = useState('');
  const [securityPassword, setSecurityPassword] = useState('');
  const [readAt, setReadAt] = useState('');
  const [check, setCheck] = useState(null);

  const currentDeviceId = getClientId();
  const accountScopeReady = isAccountDataScopeReady(session, currentDeviceId);

  const refresh = useCallback(async () => {
    if (!isAdmin) return;
    setStatus('loading');
    setError('');
    try {
      const currentSession = loadCloudSession();
      const [nextManifest, deviceSnapshot, checkSnapshot] = await Promise.all([
        fetchUserDataManifest(currentSession, currentDeviceId),
        fetchSyncDevices(currentSession),
        fetchCloudDataCheck(currentSession, currentDeviceId).catch(() => null)
      ]);
      setManifest(nextManifest);
      setDevices(Array.isArray(deviceSnapshot?.devices) ? deviceSnapshot.devices : []);
      setCheck(checkSnapshot?.check || null);
      setReadAt(new Date().toISOString());
      setStatus('ready');
    } catch (err) {
      setStatus('error');
      setError(err?.message || '读取云端清单失败');
    }
  }, [currentDeviceId, isAdmin, sessionKey]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const issueResources = useMemo(() => resources.filter((resource) => ['conflict', 'local-only', 'cloud-only'].includes(resource.status)), [resources]);
  const selectedResource = issueResources.find((resource) => resource.key === selectedKey) || issueResources[0] || null;
  const summary = useMemo(() => summarizeCloudDataResources(resources), [resources]);
  const resourcesFromManifest = useMemo(() => (
    Array.isArray(manifest?.resources) ? [...manifest.resources].sort((left, right) => String(left.resourceId).localeCompare(String(right.resourceId))) : []
  ), [manifest]);

  function setRowChoice(resourceKey, row, choice) {
    setChoices((current) => {
      const previous = current[resourceKey] || { decisions: {} };
      const fields = row.fields?.length ? Object.fromEntries(row.fields.map((field) => [field.name, choice])) : {};
      return {
        ...current,
        [resourceKey]: {
          ...previous,
          decisions: { ...previous.decisions, [row.key]: { choice, fields } }
        }
      };
    });
  }

  function setFieldChoice(resourceKey, row, fieldName, choice) {
    setChoices((current) => {
      const previous = current[resourceKey] || { decisions: {} };
      const old = previous.decisions?.[row.key] || { choice: '', fields: {} };
      return {
        ...current,
        [resourceKey]: {
          ...previous,
          decisions: {
            ...previous.decisions,
            [row.key]: { ...old, choice: '', fields: { ...old.fields, [fieldName]: choice } }
          }
        }
      };
    });
  }

  function missingChoices() {
    return issueResources.filter((resource) => {
      if (resource.requiresPassword) return true;
      return resource.rows.some((row) => !rowExplicitlyChosen(row, choiceValue(choices, resource.key, row.key)));
    });
  }

  async function handleCheck() {
    if (status === 'checking' || status === 'applying') return;
    setStatus('checking');
    setError('');
    try {
      const currentSession = loadCloudSession();
      const snapshot = userDataStore.captureCurrentDeviceSnapshot();
      if (!accountScopeReady) {
        const end = getClientEnd();
        await registerSyncDevice({
          deviceId: end.id,
          deviceType: end.type,
          sessionId: end.sessionId,
          hasLocalData: snapshot.keys.length > 0,
          localSignature: snapshot.keys.join('|')
        }, currentSession);
      }
      const inspected = await inspectCloudData(currentSession, { securityPassword });
      const nextSummary = summarizeCloudDataResources(inspected);
      const hasIssues = inspected.some((resource) => ['conflict', 'local-only', 'cloud-only'].includes(resource.status));
      const nextStatus = hasIssues ? 'conflict' : 'matched';
      const checkResult = await saveCloudDataCheck({
        deviceId: currentDeviceId,
        status: nextStatus,
        resources: buildCheckPayload(inspected),
        summary: nextSummary
      }, currentSession);
      if (nextStatus === 'matched') {
        markAccountDataScopeReady(currentSession, currentDeviceId, {
          completedAt: checkResult?.check?.checkedAt,
          checkId: `${currentDeviceId}:${checkResult?.check?.checkedAt || Date.now()}`
        });
      }
      setResources(inspected);
      setChoices({});
      setSelectedKey(inspected.find((resource) => ['conflict', 'local-only', 'cloud-only'].includes(resource.status))?.key || '');
      setCheck({ status: nextStatus, checkedAt: new Date().toISOString(), ...nextSummary });
      setReadAt(new Date().toISOString());
      setStatus('ready');
      await refresh();
    } catch (err) {
      setStatus('error');
      setError(err?.message || '检查本机数据失败');
    }
  }

  async function handleApply() {
    const missing = missingChoices();
    if (missing.length) {
      setSelectedKey(missing[0].key);
      setError(missing[0].requiresPassword ? '交易记录需要安全密码后才能查看并选择冲突项' : '请为每一条冲突记录或字段明确选择云端或本机');
      return;
    }
    setStatus('applying');
    setError('');
    try {
      const currentSession = loadCloudSession();
      await applyCloudDataChoices(currentSession, resources, choices, { securityPassword });
      const nextSummary = summarizeCloudDataResources(resources);
      const result = await saveCloudDataCheck({
        deviceId: currentDeviceId,
        status: 'completed',
        resources: buildCheckPayload(resources),
        summary: nextSummary,
        completedAt: new Date().toISOString()
      }, currentSession);
      markAccountDataScopeReady(currentSession, currentDeviceId, {
        completedAt: result?.check?.completedAt,
        checkId: `${currentDeviceId}:${result?.check?.completedAt || Date.now()}`
      });
      setChoices({});
      setResources([]);
      setSecurityPassword('');
      await refresh();
    } catch (err) {
      setStatus('error');
      setError(err?.message || '应用同步选择失败；云端有新版本时请重新检查');
    }
  }

  if (!isAdmin) {
    return <div className={cx('mx-auto max-w-4xl', embedded ? 'px-4 sm:px-6' : 'px-6')}><div className="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-amber-900"><div className="flex items-center gap-2 text-lg font-bold"><ShieldCheck className="h-5 w-5" />管理员权限 required</div><p className="mt-2 text-sm leading-6">当前账号没有云端数据查看权限。</p></div></div>;
  }

  const currentDevice = devices.find((device) => String(device?.deviceId || '') === currentDeviceId);
  return (
    <div className={cx('mx-auto max-w-7xl space-y-4', embedded ? 'px-4 sm:px-6' : 'px-6')}>
      <header className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700"><Cloud className="h-3.5 w-3.5" />管理员灰度</div>
            <h1 className="mt-3 text-2xl font-bold text-slate-900">云端数据</h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">只检查当前设备的本地数据。普通配置使用各自 REST 接口，交易记录保持加密；持仓分析类数据由交易记录在本机派生。</p>
            <div className="mt-2 text-xs text-slate-400">{status === 'loading' ? '正在读取云端清单…' : status === 'checking' ? '正在比较当前设备与云端数据…' : status === 'applying' ? '正在应用你的选择…' : status === 'ready' ? `最后检查：${formatDate(readAt)}` : error || '尚未检查本机数据'}</div>
            {error ? <div className="mt-3 flex max-w-2xl items-start gap-2 rounded-2xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs leading-5 text-red-700"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div> : null}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button type="button" onClick={() => void handleCheck()} disabled={['loading', 'checking', 'applying'].includes(status)} className="inline-flex items-center gap-1.5 rounded-full bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-wait disabled:opacity-60"><RefreshCw className={cx('h-3.5 w-3.5', status === 'checking' && 'animate-spin')} />{resources.length ? '重新检查本机数据' : '检查本机数据'}</button>
            {issueResources.length ? <button type="button" onClick={() => void handleApply()} disabled={['loading', 'checking', 'applying'].includes(status)} className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-wait disabled:opacity-60"><UploadCloud className="h-3.5 w-3.5" />应用选择</button> : null}
            <button type="button" onClick={() => void refresh()} disabled={['loading', 'checking', 'applying'].includes(status)} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"><RefreshCw className="h-3.5 w-3.5" />刷新</button>
          </div>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="云端资源" value={resourcesFromManifest.filter((item) => !item.deleted).length} hint={`共 ${resourcesFromManifest.length} 项记录`} />
        <StatCard label="当前设备状态" value={deviceStatusLabel({ dataCheckStatus: check?.status || currentDevice?.dataCheckStatus })} hint={accountScopeReady ? '后续账户接口使用账号作用域' : '尚未完成当前设备确认'} />
        <StatCard label="冲突项" value={summary.conflicts + summary.localOnly + summary.cloudOnly} hint={resources.length ? `${summary.matched}/${summary.total} 项一致` : '点击“检查本机数据”开始'} />
        <StatCard label="旧版备份" value={manifest?.legacySnapshot ? '存在' : '无'} hint="不会在普通 Tab 自动恢复或覆盖数据" />
      </section>

      {devices.length ? <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-base font-bold text-slate-900">账号设备</h2><p className="mt-1 text-xs text-slate-400">只有设备自己能判断本机数据；其他设备未上报检查结果时显示“未检查”。</p></div><span className="text-xs font-semibold text-slate-500">共 {devices.length} 台</span></div>
        <div className="overflow-x-auto rounded-2xl border border-slate-100"><table className="w-full min-w-[680px] text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-3 py-2 text-left">设备</th><th className="px-3 py-2 text-left">类型</th><th className="px-3 py-2 text-left">数据状态</th><th className="px-3 py-2 text-left">最近检查</th></tr></thead><tbody className="divide-y divide-slate-100">{devices.map((device) => { const id = String(device?.deviceId || ''); const current = id === currentDeviceId; return <tr key={id}><td className="px-3 py-2 font-medium text-slate-700" title={id}>{current ? '当前设备' : `${id.slice(0, 8)}…`}</td><td className="px-3 py-2 text-slate-500">{deviceTypeLabel(device.deviceType)}</td><td className="px-3 py-2"><span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${deviceStatusClass(device)}`}>{deviceStatusLabel(device)}</span>{device.dataScope === 'account' ? <span className="ml-2 text-xs text-indigo-600">账号作用域</span> : null}</td><td className="px-3 py-2 text-slate-500">{formatDate(device.dataCheckAt || device.dataCheckCompletedAt)}</td></tr>; })}</tbody></table></div>
      </section> : null}

      {resources.length ? <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-3"><div><h2 className="text-base font-bold text-slate-900">冲突资源</h2><p className="mt-1 text-xs text-slate-400">默认采用云端，但必须逐条明确选择后才能完成当前设备同步。</p></div><Database className="h-5 w-5 text-slate-400" /></div>
        {issueResources.length ? <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]"><div className="space-y-2">{issueResources.map((resource) => <button type="button" key={resource.key} onClick={() => setSelectedKey(resource.key)} className={`w-full rounded-2xl border p-3 text-left ${selectedResource?.key === resource.key ? 'border-indigo-400 bg-indigo-50/60' : 'border-slate-100 bg-slate-50 hover:bg-slate-100'}`}><div className="flex items-center justify-between gap-2"><span className="truncate text-sm font-semibold text-slate-700">{resourceLabel(resource)}</span><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${resourceStatusClass(resource.status)}`}>{resourceStatusLabel(resource.status)}</span></div><div className="mt-1 text-[11px] text-slate-400">{resource.rows.length ? `${resource.rows.length} 条明细` : resource.requiresPassword ? '需要安全密码查看详情' : '等待选择'}</div></button>)}</div><div className="min-w-0 space-y-3">{selectedResource ? <div className="rounded-2xl border border-slate-100 p-3"><div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="font-bold text-slate-800">{resourceLabel(selectedResource)}</h3><div className="mt-1 text-xs text-slate-400">{selectedResource.descriptor.kind === 'domain' ? '领域 REST 数据' : selectedResource.descriptor.security === 'encrypted' ? '交易记录（加密）' : '明文 REST 数据'}</div></div>{selectedResource.requiresPassword ? <LockKeyhole className="h-5 w-5 text-amber-500" /> : <CheckCircle2 className="h-5 w-5 text-slate-300" />}</div>{selectedResource.requiresPassword ? <div className="mt-3 flex flex-col gap-2 sm:flex-row"><input type="password" value={securityPassword} onChange={(event) => setSecurityPassword(event.target.value)} placeholder="输入安全密码查看交易明细" aria-label="安全密码" className="h-9 flex-1 rounded-full border border-amber-200 bg-amber-50/50 px-3 text-sm outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100" /><button type="button" onClick={() => void handleCheck()} disabled={status === 'checking'} className="rounded-full bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-60">解锁交易详情</button></div> : null}{selectedResource.rows.some((row) => row.fields?.length) ? <div className="mt-3 text-[11px] font-semibold text-slate-400">字段级选择</div> : null}<div className="mt-3 space-y-2">{selectedResource.rows.length ? selectedResource.rows.map((row) => <ConflictRow key={row.key} resource={selectedResource} row={row} decision={choiceValue(choices, selectedResource.key, row.key)} onChoice={(choice) => setRowChoice(selectedResource.key, row, choice)} onFieldChoice={(field, choice) => setFieldChoice(selectedResource.key, row, field, choice)} />) : <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">{selectedResource.requiresPassword ? '输入安全密码后加载云端交易明细。' : '该资源没有可展示的冲突明细。'}</div>}</div></div> : <div className="rounded-2xl bg-slate-50 p-6 text-center text-sm text-slate-500">请选择一个冲突资源。</div>}</div></div> : <div className="rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-700">当前设备数据与云端一致，无需迁移。</div>}
      </section> : null}

      <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm"><div className="mb-3 flex items-center justify-between gap-3"><div><h2 className="text-base font-bold text-slate-900">逐 Tab 云端资源</h2><p className="mt-1 text-xs text-slate-400">仅展示云端元数据；交易记录是持仓相关数据的唯一来源。</p></div><Database className="h-5 w-5 text-slate-400" /></div><div className="overflow-x-auto rounded-2xl border border-slate-100"><table className="w-full min-w-[680px] text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-3 py-2 text-left">资源</th><th className="px-3 py-2 text-left">安全类型</th><th className="px-3 py-2 text-right">版本</th><th className="px-3 py-2 text-left">状态</th><th className="px-3 py-2 text-left">更新时间</th></tr></thead><tbody className="divide-y divide-slate-100">{resourcesFromManifest.length ? resourcesFromManifest.map((row) => { const descriptor = CLOUD_DATA_RESOURCE_REGISTRY.find((item) => item.key === row.resourceId); return <tr key={row.resourceId}><td className="px-3 py-2 font-medium text-slate-700">{labelsByKey.get(row.resourceId) || descriptor?.label || row.resourceId}</td><td className="px-3 py-2 text-slate-500">{descriptor?.security === 'encrypted' ? '交易加密' : '明文 REST'}</td><td className="px-3 py-2 text-right tabular-nums text-slate-600">{Number(row.revision) || 0}</td><td className="px-3 py-2 text-slate-500">{row.deleted ? '已删除' : '可用'}</td><td className="px-3 py-2 text-slate-500">{formatDate(row.updatedAt)}</td></tr>; }) : <tr><td colSpan={5} className="px-3 py-10 text-center text-slate-400">暂无云端资源；点击“检查本机数据”读取当前设备状态。</td></tr>}</tbody></table></div></section>
    </div>
  );
}
