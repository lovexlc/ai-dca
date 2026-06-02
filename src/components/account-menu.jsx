import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CloudDownload, GitMerge, Home, KeyRound, Loader2, LogOut, RefreshCw, UserRound, X } from 'lucide-react';
import { clearCloudSession, CLOUD_SYNC_SESSION_EVENT, loadCloudSession, loginCloudAccount, registerCloudAccount } from '../app/authClient.js';
import { ensureLocalChangeBaseline, loadCloudSyncMeta, mergeLocalIntoCloudBackup, prepareCloudSyncConflict, refreshRemoteCloudMeta, restoreEncryptedCloudBackup, uploadEncryptedCloudBackup } from '../app/cloudSync.js';
import { clearRememberedKey, generateSecurityPassword, loadRememberedKey } from '../app/secureVault.js';
import { showToast } from '../app/toast.js';
import { collectBackupPayload, formatBytes } from '../app/webdavBackup.js';
import { persistWorkspacePrefs, readWorkspacePrefs } from '../app/workspacePrefs.js';
import { cx, inputClass, primaryButtonClass, secondaryButtonClass, SelectField, subtleButtonClass } from './experience-ui.jsx';

const HOME_OPTIONS = [
  { value: 'strategy', label: '策略指南' },
  { value: 'holdings', label: '持仓总览' },
  { value: 'tradePlans', label: '交易计划' },
  { value: 'notify', label: '通知设置' },
  { value: 'markets', label: '行情中心' },
  { value: 'fundSwitch', label: '基金切换' }
];

const SYNC_KEY_LABELS = {
  aiDcaAccountAssignments: '账户分配',
  aiDcaAccumulationState: '加仓模型',
  aiDcaDcaState: '定投计划',
  aiDcaFundHoldingsLedger: '持仓账本',
  aiDcaFundHoldingsState: '持仓状态',
  aiDcaHomeDashboardState: '首页仪表盘',
  aiDcaNotifyClientConfig: '通知配置',
  aiDcaPlanState: '建仓计划',
  aiDcaPlanStore: '计划列表',
  aiDcaPositionSnapshot: '持仓快照',
  aiDcaSellPlanStore: '卖出计划',
  aiDcaSwitchStrategyPrefs: '基金切换偏好',
  aiDcaTradeLedger: '交易流水',
  aiDcaWorkspacePrefs: '工作区偏好'
};

function formatSyncTime(value = '') {
  if (!value) return '-';
  try { return new Date(value).toLocaleString('zh-CN', { hour12: false }); } catch { return value; }
}

function formatKeyList(keys = [], limit = 4) {
  const list = (Array.isArray(keys) ? keys : []).slice(0, limit).map((key) => SYNC_KEY_LABELS[key] || key);
  if (!list.length) return '无';
  return `${list.join('、')}${keys.length > limit ? ` 等 ${keys.length} 项` : ''}`;
}

export function AccountMenu() {
  const [session, setSession] = useState(() => loadCloudSession());
  const [meta, setMeta] = useState(() => loadCloudSyncMeta());
  const [preview, setPreview] = useState(() => collectBackupPayload());
  const [syncState, setSyncState] = useState('idle');
  const [lastError, setLastError] = useState('');
  const [form, setForm] = useState({ username: '', password: '', securityPassword: '', rememberDevice: true });
  const [busy, setBusy] = useState('');
  const [conflict, setConflict] = useState(null);
  const [conflictPassword, setConflictPassword] = useState('');
  const [manualSyncPassword, setManualSyncPassword] = useState('');
  const [homePref, setHomePref] = useState(() => readWorkspacePrefs().homepageTab);
  const [homeSaved, setHomeSaved] = useState(false);
  const [open, setOpen] = useState(false);
  const [authMode, setAuthMode] = useState('login');
  const dropdownRef = useRef(null);

  useEffect(() => {
    function refreshLocalState(event) {
      setSession(event?.detail?.session || loadCloudSession());
      setMeta(event?.detail?.meta || loadCloudSyncMeta());
      setPreview(collectBackupPayload());
    }
    function syncStorage(event) {
      if (!event.key || event.key.startsWith('aiDca')) refreshLocalState(event);
    }
    function handleSyncStarted() {
      setSyncState('syncing');
      setLastError('');
    }
    function handleSyncDone(event) {
      setSyncState('synced');
      setConflict(null);
      setLastError('');
      refreshLocalState(event);
    }
    function handleSyncError(event) {
      const nextConflict = event?.detail?.conflict || null;
      setConflict(nextConflict);
      setSyncState(nextConflict ? 'conflict' : 'error');
      setLastError(event?.detail?.message || '同步失败');
      refreshLocalState(event);
    }
    window.addEventListener(CLOUD_SYNC_SESSION_EVENT, refreshLocalState);
    window.addEventListener('cloud-sync:meta-changed', refreshLocalState);
    window.addEventListener('cloud-sync:auto-upload-started', handleSyncStarted);
    window.addEventListener('cloud-sync:auto-uploaded', handleSyncDone);
    window.addEventListener('cloud-sync:auto-restored', handleSyncDone);
    window.addEventListener('cloud-sync:auto-error', handleSyncError);
    window.addEventListener('storage', syncStorage);
    return () => {
      window.removeEventListener(CLOUD_SYNC_SESSION_EVENT, refreshLocalState);
      window.removeEventListener('cloud-sync:meta-changed', refreshLocalState);
      window.removeEventListener('cloud-sync:auto-upload-started', handleSyncStarted);
      window.removeEventListener('cloud-sync:auto-uploaded', handleSyncDone);
      window.removeEventListener('cloud-sync:auto-restored', handleSyncDone);
      window.removeEventListener('cloud-sync:auto-error', handleSyncError);
      window.removeEventListener('storage', syncStorage);
    };
  }, []);

  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined;
    const isDropdown = Boolean(session?.accessToken);
    const prev = document.body.style.overflow;
    if (!isDropdown) document.body.style.overflow = 'hidden';
    function onKey(event) { if (event.key === 'Escape') setOpen(false); }
    function onClickOutside(event) {
      if (!isDropdown) return;
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    if (isDropdown) document.addEventListener('mousedown', onClickOutside);
    return () => {
      if (!isDropdown) document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
      if (isDropdown) document.removeEventListener('mousedown', onClickOutside);
    };
  }, [open, session?.accessToken]);

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function runInitialSync(nextSession, action) {
    const remoteMeta = nextSession?.latestBackupMeta || await refreshRemoteCloudMeta();
    const hasRemoteBackup = Boolean(remoteMeta?.version);
    ensureLocalChangeBaseline();
    if (hasRemoteBackup) {
      const nextConflict = await prepareCloudSyncConflict({
        securityPassword: form.securityPassword,
        useRemembered: false
      });
      if (nextConflict?.hasConflict) {
        setConflict(nextConflict);
        return 'conflict';
      }
      if (nextConflict?.hasLocalChanges) {
        const merged = await mergeLocalIntoCloudBackup({
          securityPassword: form.securityPassword,
          rememberDevice: form.rememberDevice,
          useRemembered: false
        });
        window.dispatchEvent(new CustomEvent('cloud-sync:auto-uploaded', { detail: { result: merged } }));
        return 'merged';
      }
      const restored = await restoreEncryptedCloudBackup({
        securityPassword: form.securityPassword,
        rememberDevice: form.rememberDevice,
        onlyIfRemoteNewer: true
      });
      window.dispatchEvent(new CustomEvent('cloud-sync:auto-restored', { detail: { result: restored } }));
      return restored?.skipped ? 'skipped-restore' : 'restored';
    }
    if (action === 'register' || collectBackupPayload().keys.length > 0) {
      const uploaded = await uploadEncryptedCloudBackup({
        securityPassword: form.securityPassword,
        rememberDevice: form.rememberDevice,
        force: true
      });
      window.dispatchEvent(new CustomEvent('cloud-sync:auto-uploaded', { detail: { result: uploaded } }));
      return uploaded?.skipped ? 'skipped-upload' : 'uploaded';
    }
    return 'no-remote';
  }

  async function handleAuth(action) {
    setBusy(action);
    try {
      const nextSession = action === 'register'
        ? await registerCloudAccount(form)
        : await loginCloudAccount(form);
      setSession(nextSession);
      setSyncState('syncing');
      setLastError('');
      const syncResult = await runInitialSync(nextSession, action);
      setMeta(loadCloudSyncMeta());
      setPreview(collectBackupPayload());
      setSyncState(syncResult === 'conflict' ? 'conflict' : 'synced');
      showToast({
        title: action === 'register' ? '账户已注册' : '已登录',
        description: syncResult === 'conflict' ? '检测到云端与本机都有不同数据，请选择合并或拉取云端。' : syncResult === 'restored' ? '已恢复云端较新数据' : syncResult === 'merged' ? '已自动合并本机与云端数据' : syncResult === 'uploaded' ? '已创建云端备份' : '本地与云端无需更新',
        tone: syncResult === 'conflict' ? 'amber' : 'emerald'
      });
      if (syncResult !== 'conflict') setOpen(false);
    } catch (err) {
      if (err?.isCloudSyncConflict) {
        setConflict(err.conflict || null);
        setSyncState('conflict');
        setLastError(err.message || '云端数据已更新');
        setOpen(true);
        showToast({ title: '检测到同步冲突', description: err?.conflict?.summaryText || err.message, tone: 'amber' });
      } else {
        setSyncState('error');
        setLastError(err?.message || String(err));
        showToast({ title: action === 'register' ? '注册/同步失败' : '登录/同步失败', description: err?.message || String(err), tone: 'red' });
      }
    } finally {
      setBusy('');
    }
  }

  async function handleResolveConflict(mode) {
    const remembered = loadRememberedKey();
    const useRemembered = Boolean(remembered?.rawKey);
    const secret = useRemembered ? '' : (conflictPassword || form.securityPassword);
    if (!useRemembered && secret.length < 8) {
      showToast({ title: '需要安全密码', description: '请输入安全密码后再处理冲突。', tone: 'amber' });
      return;
    }
    const busyKey = mode === 'merge' ? 'merge-conflict' : 'pull-conflict';
    setBusy(busyKey);
    setLastError('');
    try {
      const result = mode === 'merge'
        ? await mergeLocalIntoCloudBackup({
          securityPassword: secret,
          rememberDevice: form.rememberDevice,
          useRemembered
        })
        : await restoreEncryptedCloudBackup({
          securityPassword: secret,
          useRemembered,
          rememberDevice: form.rememberDevice,
          onlyIfRemoteNewer: false
        });
      setConflict(null);
      setConflictPassword('');
      setMeta(loadCloudSyncMeta());
      setPreview(collectBackupPayload());
      setSyncState('synced');
      window.dispatchEvent(new CustomEvent(mode === 'merge' ? 'cloud-sync:auto-uploaded' : 'cloud-sync:auto-restored', { detail: { result } }));
      showToast({
        title: mode === 'merge' ? '已合并并同步' : '已拉取云端',
        description: mode === 'merge' ? '本机数据已合并到云端，远端独有数据也已保留到本机。' : '云端版本已覆盖本机数据。',
        tone: 'emerald'
      });
    } catch (err) {
      if (err?.isCloudSyncConflict) {
        setConflict(err.conflict || conflict);
        setSyncState('conflict');
      } else {
        setSyncState('error');
      }
      setLastError(err?.message || String(err));
      showToast({ title: '处理冲突失败', description: err?.message || String(err), tone: 'red' });
    } finally {
      setBusy('');
    }
  }

  async function handleManualSync() {
    const remembered = loadRememberedKey();
    const useRemembered = Boolean(remembered?.rawKey);
    const secret = useRemembered ? '' : (manualSyncPassword || form.securityPassword);
    if (!useRemembered && secret.length < 8) {
      showToast({ title: '需要安全密码', description: '请输入安全密码后再同步。', tone: 'amber' });
      return;
    }
    setBusy('manual-sync');
    setSyncState('syncing');
    setLastError('');
    try {
      const remoteMeta = await refreshRemoteCloudMeta();
      const hasRemoteBackup = Boolean(remoteMeta?.version);
      ensureLocalChangeBaseline();
      let syncResult = 'no-remote';
      let result = null;

      if (hasRemoteBackup) {
        const nextConflict = await prepareCloudSyncConflict({
          securityPassword: secret,
          useRemembered
        });
        if (nextConflict?.hasConflict) {
          setConflict(nextConflict);
          setSyncState('conflict');
          showToast({ title: '检测到同步冲突', description: nextConflict.summaryText, tone: 'amber' });
          return;
        }
        if (nextConflict?.hasLocalChanges) {
          result = await mergeLocalIntoCloudBackup({
            securityPassword: secret,
            rememberDevice: form.rememberDevice,
            useRemembered
          });
          syncResult = 'merged';
          window.dispatchEvent(new CustomEvent('cloud-sync:auto-uploaded', { detail: { result } }));
        } else {
          result = await restoreEncryptedCloudBackup({
            securityPassword: secret,
            useRemembered,
            rememberDevice: form.rememberDevice,
            onlyIfRemoteNewer: true
          });
          syncResult = result?.skipped ? 'skipped-restore' : 'restored';
          window.dispatchEvent(new CustomEvent('cloud-sync:auto-restored', { detail: { result } }));
        }
      } else if (collectBackupPayload().keys.length > 0) {
        result = await uploadEncryptedCloudBackup({
          securityPassword: secret,
          rememberDevice: form.rememberDevice,
          force: true,
          useRemembered
        });
        syncResult = result?.skipped ? 'skipped-upload' : 'uploaded';
        window.dispatchEvent(new CustomEvent('cloud-sync:auto-uploaded', { detail: { result } }));
      }

      setManualSyncPassword('');
      setConflict(null);
      setMeta(loadCloudSyncMeta());
      setPreview(collectBackupPayload());
      setSyncState('synced');
      showToast({
        title: '手动同步完成',
        description: syncResult === 'restored' ? '已恢复云端较新数据。' : syncResult === 'merged' ? '已合并本机与云端数据。' : syncResult === 'uploaded' ? '已创建云端备份。' : '本地与云端无需更新。',
        tone: 'emerald'
      });
    } catch (err) {
      if (err?.isCloudSyncConflict) {
        setConflict(err.conflict || null);
        setSyncState('conflict');
        showToast({ title: '检测到同步冲突', description: err?.conflict?.summaryText || err.message, tone: 'amber' });
      } else {
        setSyncState('error');
        showToast({ title: '手动同步失败', description: err?.message || String(err), tone: 'red' });
      }
      setLastError(err?.message || String(err));
    } finally {
      setBusy('');
    }
  }

  function handleLogout() {
    clearCloudSession();
    clearRememberedKey();
    setSession(null);
    setConflict(null);
    setConflictPassword('');
    showToast({ title: '已退出账户', tone: 'slate' });
  }

  function handleSaveHomePref() {
    const next = persistWorkspacePrefs({ homepageTab: homePref });
    setHomePref(next.homepageTab);
    setHomeSaved(true);
    const label = HOME_OPTIONS.find((item) => item.value === next.homepageTab)?.label || '策略指南';
    showToast({ title: '默认首页已保存', description: `下次打开会默认跳到「${label}」。`, tone: 'emerald' });
    window.setTimeout(() => setHomeSaved(false), 1800);
  }

  const authDisabledReason = busy
    ? '处理中'
    : !form.username
    ? '填写用户名'
    : !form.password
    ? '填写登录密码'
    : form.securityPassword.length < 8
    ? '填写安全密码'
    : '';
  const loggedIn = Boolean(session?.accessToken);
  const hasRememberedSyncKey = loggedIn && Boolean(loadRememberedKey()?.rawKey);
  const initial = loggedIn ? String(session.username || '?').slice(0, 1).toUpperCase() : '';
  const previewBytes = preview.keys.reduce((sum, key) => sum + (preview.entries[key]?.length || 0), 0);
  const statusLabel = !loggedIn
    ? '未登录'
    : syncState === 'syncing'
    ? '同步中'
    : syncState === 'error'
    ? '同步失败'
    : syncState === 'conflict'
    ? '待处理冲突'
    : meta?.version
    ? `已同步 v${meta.version}`
    : '等待同步';

  return (
    <div className="relative ml-auto" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={cx(
          'inline-flex h-8 items-center gap-2 rounded-full border px-2.5 text-xs font-bold shadow-sm transition-colors',
          loggedIn
            ? 'border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
            : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-200 hover:text-indigo-700'
        )}
        aria-label={loggedIn ? `账户：${session.username}` : '登录账户'}
      >
        <span className={cx(
          'inline-flex h-5 w-5 items-center justify-center rounded-full',
          loggedIn ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'
        )}>
          {loggedIn ? initial : <UserRound className="h-3.5 w-3.5" aria-hidden="true" />}
        </span>
        <span className="hidden max-w-[7rem] truncate sm:inline">{loggedIn ? session.username : '登录'}</span>
      </button>

      {open && loggedIn ? (
        <div
          role="dialog"
          aria-modal="false"
          className="absolute right-0 top-full z-50 mt-2 w-[min(20rem,calc(100vw-1.5rem))] rounded-2xl border border-slate-200 bg-white p-4 text-slate-900 shadow-xl"
          onClick={(event) => event.stopPropagation()}
        >
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-indigo-600 text-sm font-bold text-white">{initial}</span>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-bold text-slate-900">{session.username}</div>
                      <div className="text-xs text-slate-500">{statusLabel}</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-xl bg-slate-50 px-2 py-2">
                      <div className="text-[10px] font-semibold text-slate-400">状态</div>
                      <div className="mt-1 truncate text-xs font-bold text-slate-800">{statusLabel}</div>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-2 py-2">
                      <div className="text-[10px] font-semibold text-slate-400">云端</div>
                      <div className="mt-1 text-xs font-bold text-slate-800">{meta?.version ? `v${meta.version}` : '-'}</div>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-2 py-2">
                      <div className="text-[10px] font-semibold text-slate-400">本地</div>
                      <div className="mt-1 text-xs font-bold text-slate-800">{preview.keys.length} 项</div>
                    </div>
                  </div>
                  <div className="text-xs text-slate-500">范围 {preview.keys.length} 项 · {formatBytes(previewBytes)}</div>
                  <div className="space-y-2 rounded-xl border border-indigo-100 bg-indigo-50/70 p-3">
                    <div className="flex items-start gap-2 text-xs text-indigo-900">
                      <RefreshCw className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-600" aria-hidden="true" />
                      <div className="min-w-0">
                        <div className="font-bold">手动同步</div>
                        <div className="mt-0.5 leading-5 text-indigo-700">登录后仍停在等待同步时，可手动检查云端并上传或合并本机数据。</div>
                      </div>
                    </div>
                    {!hasRememberedSyncKey ? (
                      <input
                        className={cx(inputClass, 'h-9 border-indigo-200 bg-white text-xs')}
                        type="password"
                        value={manualSyncPassword}
                        onChange={(event) => setManualSyncPassword(event.target.value)}
                        placeholder="安全密码"
                        autoComplete="off"
                      />
                    ) : null}
                    <button
                      type="button"
                      className={cx(primaryButtonClass, 'min-h-9 w-full justify-center px-3 py-2 text-xs')}
                      onClick={handleManualSync}
                      disabled={Boolean(busy)}
                    >
                      {busy === 'manual-sync' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                      {busy === 'manual-sync' ? '正在同步' : '立即同步'}
                    </button>
                  </div>
                  {conflict ? (
                    <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
                        <div className="min-w-0">
                          <div className="font-bold text-amber-950">发现多端同步冲突</div>
                          <div className="mt-1 leading-5">{conflict.summaryText || '云端版本与本机数据不一致。'}</div>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="rounded-lg bg-white/70 px-2 py-2">
                          <div className="font-semibold text-amber-700">云端版本</div>
                          <div className="mt-0.5 text-amber-950">v{conflict.remoteVersion ?? '-'}</div>
                          <div className="mt-0.5 text-[11px] text-amber-700">{formatSyncTime(conflict.remoteUpdatedAt)}</div>
                        </div>
                        <div className="rounded-lg bg-white/70 px-2 py-2">
                          <div className="font-semibold text-amber-700">本机数据</div>
                          <div className="mt-0.5 text-amber-950">{conflict.localKeyCount ?? preview.keys.length} 项</div>
                          <div className="mt-0.5 text-[11px] text-amber-700">{formatSyncTime(conflict.localUpdatedAt)}</div>
                        </div>
                      </div>
                      <div className="space-y-1 text-[11px] leading-5 text-amber-800">
                        {conflict.changedKeys?.length ? <div>两端不同：{formatKeyList(conflict.changedKeys)}</div> : null}
                        {conflict.remoteOnlyKeys?.length ? <div>云端独有：{formatKeyList(conflict.remoteOnlyKeys)}</div> : null}
                        {conflict.localOnlyKeys?.length ? <div>本机独有：{formatKeyList(conflict.localOnlyKeys)}</div> : null}
                      </div>
                      {!loadRememberedKey()?.rawKey ? (
                        <label className="block space-y-1 text-[11px] font-semibold text-amber-800">
                          安全密码
                          <input
                            className={cx(inputClass, 'h-9 border-amber-200 bg-white text-xs')}
                            type="password"
                            value={conflictPassword}
                            onChange={(event) => setConflictPassword(event.target.value)}
                            autoComplete="off"
                          />
                        </label>
                      ) : null}
                      <div className="grid gap-2 sm:grid-cols-2">
                        <button
                          type="button"
                          className={cx(primaryButtonClass, 'justify-center text-xs')}
                          onClick={() => handleResolveConflict('merge')}
                          disabled={Boolean(busy)}
                        >
                          {busy === 'merge-conflict' ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitMerge className="h-4 w-4" />}
                          合并本机
                        </button>
                        <button
                          type="button"
                          className={cx(secondaryButtonClass, 'justify-center bg-white text-xs')}
                          onClick={() => handleResolveConflict('pull')}
                          disabled={Boolean(busy)}
                        >
                          {busy === 'pull-conflict' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudDownload className="h-4 w-4" />}
                          拉取云端
                        </button>
                      </div>
                    </div>
                  ) : null}
                  <div className="space-y-2 rounded-xl border border-slate-100 bg-slate-50 p-3">
                    <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                      <Home className="h-3.5 w-3.5 text-indigo-500" aria-hidden="true" />默认首页
                    </div>
                    <SelectField options={HOME_OPTIONS} value={homePref} onChange={(event) => { setHomePref(event.target.value); setHomeSaved(false); }} />
                    <button type="button" className={cx(secondaryButtonClass, "w-full justify-center text-xs")} onClick={handleSaveHomePref}>{homeSaved ? '已保存' : '保存默认首页'}</button>
                  </div>
                  {lastError ? <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">{lastError}</div> : null}
                  <button type="button" className={cx(subtleButtonClass, 'w-full justify-center')} onClick={() => { handleLogout(); setOpen(false); }}>
                    <LogOut className="h-4 w-4" />
                    退出登录
                  </button>
                </div>
        </div>
      ) : null}

      {open && !loggedIn && typeof document !== "undefined" ? createPortal((
        <div
          className="fixed inset-0 z-[120] flex items-end justify-center bg-slate-900/60 p-0 sm:items-center sm:p-4"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="relative flex max-h-[95vh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:max-h-[90vh] sm:rounded-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
              <div className="min-w-0">
                <div className="text-sm font-bold text-slate-900">{authMode === 'register' ? '注册账户' : '账户登录'}</div>
                <div className="mt-0.5 truncate text-xs text-slate-500">登录后按变更自动同步</div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="关闭"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="overflow-y-auto px-5 py-4 text-slate-900">
                <div className="space-y-3">
                  <div className="flex gap-1 rounded-xl bg-slate-100 p-1 text-xs font-semibold">
                    <button
                      type="button"
                      onClick={() => setAuthMode('login')}
                      className={cx(
                        'flex-1 rounded-lg py-2 transition-colors',
                        authMode === 'login' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                      )}
                    >登录</button>
                    <button
                      type="button"
                      onClick={() => setAuthMode('register')}
                      className={cx(
                        'flex-1 rounded-lg py-2 transition-colors',
                        authMode === 'register' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                      )}
                    >注册</button>
                  </div>
                  <div className="space-y-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[11px] leading-5 text-amber-800">
                    <p><span className="font-semibold">用户名 / 登录密码</span>会加密后存储到服务器，用于多设备同步。</p>
                    <p><span className="font-semibold">安全密码</span>仅用于本地加解密数据，<span className="font-semibold">不会上传服务器</span>。请务必自行保存，不要分享；丢失后云端备份将无法恢复。</p>
                  </div>
                  <label className="block space-y-1.5 text-xs font-semibold text-slate-600">
                    用户名
                    <input className={inputClass} value={form.username} onChange={(event) => updateField('username', event.target.value)} autoComplete="username" spellCheck="false" />
                  </label>
                  <label className="block space-y-1.5 text-xs font-semibold text-slate-600">
                    登录密码
                    <input className={inputClass} type="password" value={form.password} onChange={(event) => updateField('password', event.target.value)} autoComplete={authMode === 'register' ? 'new-password' : 'current-password'} />
                  </label>
                  <label className="block space-y-1.5 text-xs font-semibold text-slate-600">
                    安全密码
                    <div className="flex gap-2">
                      <input className={inputClass} type="password" value={form.securityPassword} onChange={(event) => updateField('securityPassword', event.target.value)} autoComplete="off" />
                      <button type="button" className={cx(subtleButtonClass, 'h-10 shrink-0 px-3')} onClick={() => updateField('securityPassword', generateSecurityPassword())}>生成</button>
                    </div>
                  </label>
                  <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600">
                    <input type="checkbox" checked={form.rememberDevice} onChange={(event) => updateField('rememberDevice', event.target.checked)} />
                    记住本设备
                  </label>
                  <button
                    type="button"
                    className={cx(primaryButtonClass, 'w-full justify-center')}
                    onClick={() => handleAuth(authMode)}
                    disabled={Boolean(authDisabledReason)}
                    title={authDisabledReason || undefined}
                  >
                    {busy === authMode ? <Loader2 className="h-4 w-4 animate-spin" /> : (authMode === 'register' ? <KeyRound className="h-4 w-4" /> : <UserRound className="h-4 w-4" />)}
                    {authMode === 'register' ? '注册并登录' : '登录'}
                  </button>
                  {authDisabledReason ? <div className="text-xs text-slate-400">{authDisabledReason}</div> : null}
                </div>
            </div>
          </div>
        </div>
      ), document.body) : null}
    </div>
  );
}
