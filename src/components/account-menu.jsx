import { useEffect, useState } from 'react';
import { Home, KeyRound, Loader2, LogOut, UserRound } from 'lucide-react';
import { clearCloudSession, CLOUD_SYNC_SESSION_EVENT, loadCloudSession, loginCloudAccount, registerCloudAccount } from '../app/authClient.js';
import { loadCloudSyncMeta, refreshRemoteCloudMeta, restoreEncryptedCloudBackup, uploadEncryptedCloudBackup } from '../app/cloudSync.js';
import { clearRememberedKey, generateSecurityPassword } from '../app/secureVault.js';
import { showToast } from '../app/toast.js';
import { collectBackupPayload, formatBytes } from '../app/webdavBackup.js';
import { persistWorkspacePrefs, readWorkspacePrefs } from '../app/workspacePrefs.js';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover.jsx';
import { cx, inputClass, primaryButtonClass, secondaryButtonClass, SelectField, subtleButtonClass } from './experience-ui.jsx';

const HOME_OPTIONS = [
  { value: 'strategy', label: '策略指南' },
  { value: 'holdings', label: '持仓总览' },
  { value: 'tradePlans', label: '交易计划' },
  { value: 'notify', label: '通知设置' },
  { value: 'markets', label: '行情中心' },
  { value: 'fundSwitch', label: '基金切换' },
  { value: 'backup', label: '数据同步' }
];

export function AccountMenu() {
  const [session, setSession] = useState(() => loadCloudSession());
  const [meta, setMeta] = useState(() => loadCloudSyncMeta());
  const [preview, setPreview] = useState(() => collectBackupPayload());
  const [syncState, setSyncState] = useState('idle');
  const [lastError, setLastError] = useState('');
  const [form, setForm] = useState({ username: '', password: '', securityPassword: '', rememberDevice: true });
  const [busy, setBusy] = useState('');
  const [homePref, setHomePref] = useState(() => readWorkspacePrefs().homepageTab);
  const [homeSaved, setHomeSaved] = useState(false);

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
      setLastError('');
      refreshLocalState(event);
    }
    function handleSyncError(event) {
      setSyncState('error');
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

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function runInitialSync(nextSession, action) {
    const remoteMeta = nextSession?.latestBackupMeta || await refreshRemoteCloudMeta();
    const hasRemoteBackup = Boolean(remoteMeta?.version);
    if (hasRemoteBackup) {
      await restoreEncryptedCloudBackup({ securityPassword: form.securityPassword });
      window.dispatchEvent(new CustomEvent('cloud-sync:auto-restored'));
    }
    try {
      await uploadEncryptedCloudBackup({
        securityPassword: form.securityPassword,
        rememberDevice: form.rememberDevice,
        force: action === 'register' || !hasRemoteBackup
      });
      window.dispatchEvent(new CustomEvent('cloud-sync:auto-uploaded'));
    } catch (err) {
      if (!String(err?.message || err).includes('当前没有可同步的数据')) throw err;
    }
    return hasRemoteBackup;
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
      const restored = await runInitialSync(nextSession, action);
      setMeta(loadCloudSyncMeta());
      setPreview(collectBackupPayload());
      setSyncState('synced');
      showToast({
        title: action === 'register' ? '账户已注册' : '已登录',
        description: restored ? '已自动恢复并开启备份' : '已开启自动备份',
        tone: 'emerald'
      });
    } catch (err) {
      showToast({ title: action === 'register' ? '注册/同步失败' : '登录/同步失败', description: err?.message || String(err), tone: 'red' });
    } finally {
      setBusy('');
    }
  }

  function handleLogout() {
    clearCloudSession();
    clearRememberedKey();
    setSession(null);
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
  const initial = loggedIn ? String(session.username || '?').slice(0, 1).toUpperCase() : '';
  const previewBytes = preview.keys.reduce((sum, key) => sum + (preview.entries[key]?.length || 0), 0);
  const statusLabel = !loggedIn
    ? '未登录'
    : syncState === 'syncing'
    ? '同步中'
    : syncState === 'error'
    ? '同步失败'
    : meta?.version
    ? `已同步 v${meta.version}`
    : '等待同步';

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cx(
            'ml-auto inline-flex h-8 items-center gap-2 rounded-full border px-2.5 text-xs font-bold shadow-sm transition-colors',
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
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-80 rounded-2xl border-slate-200 bg-white p-4 text-slate-900 shadow-xl">
        {loggedIn ? (
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
            <div className="space-y-2 rounded-xl border border-slate-100 bg-slate-50 p-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                <Home className="h-3.5 w-3.5 text-indigo-500" aria-hidden="true" />默认首页
              </div>
              <SelectField options={HOME_OPTIONS} value={homePref} onChange={(event) => { setHomePref(event.target.value); setHomeSaved(false); }} />
              <button type="button" className={cx(secondaryButtonClass, "w-full justify-center text-xs")} onClick={handleSaveHomePref}>{homeSaved ? '已保存' : '保存默认首页'}</button>
            </div>
            {lastError ? <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">{lastError}</div> : null}
            <button type="button" className={cx(subtleButtonClass, 'w-full justify-center')} onClick={handleLogout}>
              <LogOut className="h-4 w-4" />
              退出登录
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <div className="text-sm font-bold text-slate-900">账户登录</div>
              <div className="mt-1 text-xs text-slate-500">登录后自动恢复并备份</div>
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
              <input className={inputClass} type="password" value={form.password} onChange={(event) => updateField('password', event.target.value)} autoComplete="current-password" />
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
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className={cx(primaryButtonClass, 'justify-center')} onClick={() => handleAuth('login')} disabled={Boolean(authDisabledReason)} title={authDisabledReason || undefined}>
                {busy === 'login' ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserRound className="h-4 w-4" />}
                登录
              </button>
              <button type="button" className={cx(secondaryButtonClass, 'justify-center')} onClick={() => handleAuth('register')} disabled={Boolean(authDisabledReason)} title={authDisabledReason || undefined}>
                {busy === 'register' ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                注册
              </button>
            </div>
            {authDisabledReason ? <div className="text-xs text-slate-400">{authDisabledReason}</div> : null}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
