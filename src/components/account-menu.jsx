import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CloudDownload, CloudUpload, Eye, EyeOff, GitMerge, KeyRound, Loader2, LogOut, RefreshCw, UserRound, X } from 'lucide-react';
import { clearCloudSession, CLOUD_SYNC_SESSION_EVENT, loadCloudSession, loginCloudAccount, registerCloudAccount } from '../app/authClient.js';
import { detachNotifyClientFromAccount } from '../app/notifySync.js';
import { ACCOUNT_AUTH_OPEN_EVENT, consumeAccountAuthIntent } from '../app/accountAuthEvents.js';
import { dismissConversionPrompt } from '../app/conversionPrompts.js';
import { generateSecurityPassword, SECURE_VAULT_ERROR_CODES } from '../app/secureVault.js';
import {
  clearV2SyncSession,
  collectV2BackupPayload,
  getV2SyncSessionStatus,
  loadV2SyncMeta,
  prepareCloudSyncConflict,
  refreshRemoteCloudMeta,
  syncV2Now,
  SYNC_V2_SECURITY_PASSWORD_REQUIRED
} from '../app/syncV2/syncEngine.js';
import { showToast } from '../app/toast.js';
import { cx, inputClass, primaryButtonClass, secondaryButtonClass, subtleButtonClass } from './experience-ui.jsx';
import { PrivacyNotice } from './PrivacyNotice.jsx';
import { formatShanghaiDateTime } from '../app/timeZone.js';

const SYNC_KEY_LABELS = {
  aiDcaAccountAllocationSettings: '账户比例设置',
  aiDcaAccumulationState: '加仓模型',
  aiDcaDcaState: '定投计划',
  aiDcaDcaStore: '定投计划列表',
  aiDcaFundHoldingsLedger: '持仓账本',
  aiDcaFundHoldingsState: '持仓状态',
  aiDcaHoldingAlerts: '持仓提醒规则',
  aiDcaHomeDashboardState: '首页看板偏好',
  aiDcaMarketAlerts: '行情提醒规则',
  aiDcaNotifySettings: '通知渠道配置',
  aiDcaWebNotifyConfig: 'PC 通知开关',
  aiDcaHoldingsNotifyRule: '持仓收益提醒',
  aiDcaSwitchStrategyWorkerConfig: '换基通知规则',
  aiDcaPlanState: '建仓计划',
  aiDcaPlanStore: '计划列表',
  aiDcaPositionSnapshot: '持仓快照',
  aiDcaSellPlanStore: '卖出计划',
  aiDcaSwitchStrategyPrefs: '基金切换偏好',
  aiDcaTradeLedger: '交易流水',
  aiDcaWorkspacePrefs: '工作区偏好'
};

function loadLocalSyncMeta() {
  return loadV2SyncMeta();
}

function collectSyncPreview() {
  return collectV2BackupPayload();
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function getSyncUnlockState(session = loadCloudSession()) {
  const status = getV2SyncSessionStatus(session);
  return { unlocked: status.unlocked, remembered: status.remembered };
}

function isSecurityUnlockErrorCode(code) {
  return code === SECURE_VAULT_ERROR_CODES.WRONG_PASSWORD
    || code === SECURE_VAULT_ERROR_CODES.NEED_DEVICE_KEY
    || code === SYNC_V2_SECURITY_PASSWORD_REQUIRED;
}

function securityUnlockPrompt(code = '') {
  if (code === SECURE_VAULT_ERROR_CODES.WRONG_PASSWORD) return '安全密码不正确，请重新输入。';
  if (code === SECURE_VAULT_ERROR_CODES.NEED_DEVICE_KEY) return '本设备保存的设备密钥无法解密当前云端备份，请输入安全密码继续。';
  return '当前会话没有可用的同步密钥，请输入安全密码继续。';
}

function formatSyncTime(value = '') {
  if (!value) return '-';
  return formatShanghaiDateTime(value) || value;
}

function formatKeyList(keys = [], limit = 4) {
  const list = (Array.isArray(keys) ? keys : []).slice(0, limit).map((key) => SYNC_KEY_LABELS[key] || key);
  if (!list.length) return '无';
  return `${list.join('、')}${keys.length > limit ? ` 等 ${keys.length} 项` : ''}`;
}

export function AccountMenu({ initialOpen = false }) {
  const [authIntent, setAuthIntent] = useState(() => consumeAccountAuthIntent());
  const [session, setSession] = useState(() => loadCloudSession());
  const [meta, setMeta] = useState(() => loadLocalSyncMeta());
  const [preview, setPreview] = useState(() => collectSyncPreview());
  const [syncState, setSyncState] = useState('idle');
  const [lastError, setLastError] = useState('');
  const [errorCode, setErrorCode] = useState('');
  const [form, setForm] = useState({ username: '', password: '', securityPassword: '', rememberDevice: true });
  const [busy, setBusy] = useState('');
  const [conflict, setConflict] = useState(null);
  const [securityUnlockOpen, setSecurityUnlockOpen] = useState(false);
  const [securityUnlockPassword, setSecurityUnlockPassword] = useState('');
  const [securityUnlockError, setSecurityUnlockError] = useState('');
  const [open, setOpen] = useState(initialOpen || Boolean(authIntent));
  const [authMode, setAuthMode] = useState(authIntent ? (authIntent.mode === 'login' ? 'login' : 'register') : 'login');
  const [showSecurityPassword, setShowSecurityPassword] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    function refreshLocalState(event) {
      setSession(event?.detail?.session || loadCloudSession());
      setMeta(event?.detail?.meta || loadLocalSyncMeta());
      setPreview(collectSyncPreview());
    }
    function syncStorage(event) {
      if (!event.key || event.key.startsWith('aiDca')) refreshLocalState(event);
    }
    function handleSyncStarted() {
      setSyncState('syncing');
      setLastError('');
      setErrorCode('');
    }
    function handleSyncDone(event) {
      setSyncState('synced');
      setConflict(null);
      setLastError('');
      setErrorCode('');
      refreshLocalState(event);
    }
    function handleSyncError(event) {
      const nextConflict = event?.detail?.conflict || null;
      const nextCode = nextConflict ? '' : (event?.detail?.code || '');
      setConflict(nextConflict);
      setSyncState(nextConflict ? 'conflict' : 'error');
      if (isSecurityUnlockErrorCode(nextCode)) {
        const message = securityUnlockPrompt(nextCode);
        setSecurityUnlockPassword('');
        setSecurityUnlockError(message);
        setSecurityUnlockOpen(true);
        setLastError(message);
        setErrorCode(nextCode);
      } else {
        setLastError(event?.detail?.message || '同步失败');
        setErrorCode(nextCode);
      }
      refreshLocalState(event);
    }
    window.addEventListener(CLOUD_SYNC_SESSION_EVENT, refreshLocalState);
    window.addEventListener('cloud-sync-v2:meta-changed', refreshLocalState);
    window.addEventListener('cloud-sync-v2:auto-upload-started', handleSyncStarted);
    window.addEventListener('cloud-sync-v2:auto-uploaded', handleSyncDone);
    window.addEventListener('cloud-sync-v2:auto-pulled', handleSyncDone);
    window.addEventListener('cloud-sync-v2:auto-error', handleSyncError);
    window.addEventListener('storage', syncStorage);
    return () => {
      window.removeEventListener(CLOUD_SYNC_SESSION_EVENT, refreshLocalState);
      window.removeEventListener('cloud-sync-v2:meta-changed', refreshLocalState);
      window.removeEventListener('cloud-sync-v2:auto-upload-started', handleSyncStarted);
      window.removeEventListener('cloud-sync-v2:auto-uploaded', handleSyncDone);
      window.removeEventListener('cloud-sync-v2:auto-pulled', handleSyncDone);
      window.removeEventListener('cloud-sync-v2:auto-error', handleSyncError);
      window.removeEventListener('storage', syncStorage);
    };
  }, []);

  useEffect(() => {
    function handleOpenAuth(event) {
      const detail = event?.detail || {};
      const mode = detail.mode === 'login' ? 'login' : 'register';
      setAuthIntent({
        mode,
        source: String(detail.source || ''),
        trigger: String(detail.trigger || ''),
        dismissTrigger: String(detail.dismissTrigger || '')
      });
      setAuthMode(mode);
      setOpen(true);
    }
    window.addEventListener(ACCOUNT_AUTH_OPEN_EVENT, handleOpenAuth);
    return () => window.removeEventListener(ACCOUNT_AUTH_OPEN_EVENT, handleOpenAuth);
  }, []);

  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined;
    const isDropdown = Boolean(session?.accessToken);
    const prev = document.body.style.overflow;
    if (!isDropdown) document.body.style.overflow = 'hidden';
    function onKey(event) {
      if (event.key === 'Escape') {
        if (!isDropdown && authIntent?.dismissTrigger) {
          dismissConversionPrompt({ trigger: authIntent.dismissTrigger });
        }
        setAuthIntent(null);
        setOpen(false);
      }
    }
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
  }, [open, session?.accessToken, authIntent?.dismissTrigger]);

  function closeAccountAuth({ dismiss = true } = {}) {
    if (dismiss && authIntent?.dismissTrigger) {
      dismissConversionPrompt({ trigger: authIntent.dismissTrigger });
    }
    setAuthIntent(null);
    setOpen(false);
  }

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function openSecurityUnlockDialog(message = securityUnlockPrompt(), code = SYNC_V2_SECURITY_PASSWORD_REQUIRED) {
    setSecurityUnlockPassword('');
    setSecurityUnlockError(message);
    setSecurityUnlockOpen(true);
    setLastError(message);
    setErrorCode(code);
  }

  function closeSecurityUnlockDialog() {
    if (busy === 'security-unlock') return;
    setSecurityUnlockOpen(false);
    setSecurityUnlockPassword('');
    setSecurityUnlockError('');
  }

  async function runInitialSync(nextSession) {
    const remoteMeta = await refreshRemoteCloudMeta(nextSession);
    const hasRemoteBackup = Array.isArray(remoteMeta?.items) && remoteMeta.items.length > 0;
    if (hasRemoteBackup) {
      const conflict = await prepareCloudSyncConflict({
        securityPassword: form.securityPassword,
        rememberDevice: form.rememberDevice,
        session: nextSession
      });
      if (conflict?.hasLocalChanges) {
        const error = new Error('登录后发现本机与云端数据不一致，请先选择同步方式。');
        error.isCloudSyncConflict = true;
        error.conflict = conflict;
        throw error;
      }
    }
    const result = await syncV2Now({
      session: nextSession,
      securityPassword: form.securityPassword,
      rememberDevice: form.rememberDevice,
      mode: 'merge'
    });
    window.dispatchEvent(new CustomEvent(result?.uploaded ? 'cloud-sync-v2:auto-uploaded' : 'cloud-sync-v2:auto-pulled', { detail: { result } }));
    if (result?.pulled) return 'pulled';
    if (result?.uploaded) return 'uploaded';
    return hasRemoteBackup ? 'no-change' : 'no-remote';
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
      setErrorCode('');
      const syncResult = await runInitialSync(nextSession);
      setMeta(loadLocalSyncMeta());
      setPreview(collectSyncPreview());
      setSyncState(syncResult === 'conflict' ? 'conflict' : 'synced');
      showToast({
        title: action === 'register' ? '账户已注册' : '已登录',
        description: syncResult === 'pulled' ? '已按云端版本刷新本机数据' : syncResult === 'pulled-merged' ? '已按云端版本刷新，并把本机独有数据回传云端' : syncResult === 'uploaded' ? '已创建云端备份' : '本地与云端无需更新',
        tone: syncResult === 'conflict' ? 'amber' : 'emerald'
      });
      if (syncResult !== 'conflict') closeAccountAuth({ dismiss: false });
    } catch (err) {
      setErrorCode('');
      if (err?.isCloudSyncConflict) {
        setConflict(err.conflict || null);
        setSyncState('conflict');
        setLastError(err.message || '云端数据已更新');
        setOpen(true);
        showToast({ title: '检测到同步冲突', description: err?.conflict?.summaryText || err.message, tone: 'amber' });
      } else if (isSecurityUnlockErrorCode(err?.code)) {
        setSyncState('error');
        openSecurityUnlockDialog(securityUnlockPrompt(err.code), err.code);
        closeAccountAuth({ dismiss: false });
        showToast({ title: '登录成功，需要解锁同步', description: '请输入安全密码后继续检查并同步云端数据。', tone: 'amber' });
      } else {
        setSyncState('error');
        setLastError(err?.message || String(err));
        setErrorCode(err?.code || '');
        showToast({ title: action === 'register' ? '注册/同步失败' : '登录/同步失败', description: err?.message || String(err), tone: 'red' });
      }
    } finally {
      setBusy('');
    }
  }

  async function handleResolveConflict(mode) {
    const unlock = getSyncUnlockState(session);
    const secret = unlock.unlocked ? '' : form.securityPassword;
    if (!unlock.unlocked && secret.length < 8) {
      openSecurityUnlockDialog('处理冲突前需要先用安全密码解锁同步。');
      return;
    }
    const busyKey = mode === 'merge' ? 'merge-conflict' : mode === 'local' ? 'local-conflict' : 'pull-conflict';
    setBusy(busyKey);
    setLastError('');
    setErrorCode('');
    try {
      const result = await syncV2Now({
        session,
        securityPassword: secret,
        rememberDevice: form.rememberDevice,
        mode: mode === 'pull' ? 'remote' : mode
      });
      setConflict(null);
      setMeta(loadLocalSyncMeta());
      setPreview(collectSyncPreview());
      setSyncState('synced');
      window.dispatchEvent(new CustomEvent(result?.uploaded ? 'cloud-sync-v2:auto-uploaded' : 'cloud-sync-v2:auto-pulled', { detail: { result } }));
      const toastByMode = {
        merge: { title: '已合并并同步', description: '本机数据已合并到云端，远端独有数据也已保留到本机。' },
        local: { title: '已采用本机', description: '已用本机数据强制覆盖云端版本。' },
        pull: { title: '已采用云端', description: '云端版本已覆盖本机全部同步数据。' }
      };
      showToast({ ...toastByMode[mode], tone: 'emerald' });
    } catch (err) {
      const code = err?.code || '';
      const needsUnlock = isSecurityUnlockErrorCode(code);
      if (err?.isCloudSyncConflict) {
        setConflict(err.conflict || conflict);
        setSyncState('conflict');
      } else {
        setSyncState('error');
      }
      setLastError(needsUnlock ? securityUnlockPrompt(code) : (err?.message || String(err)));
      setErrorCode(err?.isCloudSyncConflict ? '' : code);
      if (needsUnlock) {
        openSecurityUnlockDialog(securityUnlockPrompt(code), code);
      } else {
        showToast({ title: '处理冲突失败', description: err?.message || String(err), tone: 'red' });
      }
    } finally {
      setBusy('');
    }
  }

  async function handleManualSync() {
    const unlock = getSyncUnlockState(session);
    const secret = unlock.unlocked ? '' : form.securityPassword;
    if (!unlock.unlocked && secret.length < 8) {
      openSecurityUnlockDialog();
      return;
    }
    setBusy('manual-sync');
    setSyncState('syncing');
    setLastError('');
    setErrorCode('');
    try {
      const result = await syncV2Now({
        session,
        securityPassword: secret,
        rememberDevice: form.rememberDevice,
        mode: 'merge'
      });
      const syncResult = result?.pulled ? 'pulled' : result?.uploaded ? 'uploaded' : 'skipped-upload';
      window.dispatchEvent(new CustomEvent(result?.uploaded ? 'cloud-sync-v2:auto-uploaded' : 'cloud-sync-v2:auto-pulled', { detail: { result } }));

      setConflict(null);
      setMeta(loadLocalSyncMeta());
      setPreview(collectSyncPreview());
      setSyncState('synced');
      showToast({
        title: '手动同步完成',
        description: syncResult === 'pulled' ? '已按云端版本刷新本机数据。' : syncResult === 'pulled-merged' ? '已按云端版本刷新，并把本机独有数据回传云端。' : syncResult === 'uploaded' ? '已创建云端备份。' : '本地与云端无需更新。',
        tone: 'emerald'
      });
    } catch (err) {
      const code = err?.code || '';
      const needsUnlock = isSecurityUnlockErrorCode(code);
      if (err?.isCloudSyncConflict) {
        setConflict(err.conflict || null);
        setSyncState('conflict');
        showToast({ title: '检测到同步冲突', description: err?.conflict?.summaryText || err.message, tone: 'amber' });
      } else {
        setSyncState('error');
        if (!needsUnlock) showToast({ title: '手动同步失败', description: err?.message || String(err), tone: 'red' });
      }
      setLastError(needsUnlock ? securityUnlockPrompt(code) : (err?.message || String(err)));
      setErrorCode(err?.isCloudSyncConflict ? '' : code);
      if (needsUnlock) {
        openSecurityUnlockDialog(securityUnlockPrompt(code), code);
      }
    } finally {
      setBusy('');
    }
  }

  async function handleSecurityUnlockSubmit(event) {
    event.preventDefault();
    const secret = String(securityUnlockPassword || '');
    if (secret.length < 8) {
      setSecurityUnlockError('安全密码至少需要 8 位。');
      return;
    }

    setBusy('security-unlock');
    setSecurityUnlockError('');
    setLastError('');
    setErrorCode('');
    setSyncState('syncing');
    try {
      const prepared = await prepareCloudSyncConflict({
        securityPassword: secret,
        rememberDevice: form.rememberDevice,
        session
      });
      setForm((current) => ({ ...current, securityPassword: secret }));

      if (prepared?.hasConflict) {
        setConflict(prepared);
        setSecurityUnlockOpen(false);
        setSecurityUnlockPassword('');
        setSyncState('conflict');
        showToast({ title: '检测到同步冲突', description: prepared.summaryText || '请选择本机与云端数据的处理方式。', tone: 'amber' });
        return;
      }

      const result = await syncV2Now({
        session,
        securityPassword: secret,
        rememberDevice: form.rememberDevice,
        mode: 'merge'
      });
      setSecurityUnlockOpen(false);
      setSecurityUnlockPassword('');
      setSecurityUnlockError('');
      setConflict(null);
      setMeta(loadLocalSyncMeta());
      setPreview(collectSyncPreview());
      setSyncState('synced');
      window.dispatchEvent(new CustomEvent(result?.uploaded ? 'cloud-sync-v2:auto-uploaded' : 'cloud-sync-v2:auto-pulled', { detail: { result } }));
      showToast({
        title: '安全解锁并同步完成',
        description: result?.pulled ? '已按云端版本刷新本机数据。' : result?.uploaded ? '已把本机数据同步到云端。' : '本地与云端无需更新。',
        tone: 'emerald'
      });
    } catch (err) {
      const code = err?.code || '';
      const message = isSecurityUnlockErrorCode(code) ? securityUnlockPrompt(code) : (err?.message || String(err));
      if (err?.isCloudSyncConflict) {
        setConflict(err.conflict || null);
        setSecurityUnlockOpen(false);
        setSecurityUnlockPassword('');
        setSyncState('conflict');
        setLastError('');
        setErrorCode('');
      } else {
        setSecurityUnlockError(message);
        setLastError(message);
        setErrorCode(code);
        setSyncState('error');
        showToast({ title: isSecurityUnlockErrorCode(code) ? '安全密码无法解锁' : '解锁同步失败', description: message, tone: 'red' });
      }
    } finally {
      setBusy('');
    }
  }

  async function handleLogout() {
    setBusy('logout');
    try {
      await detachNotifyClientFromAccount();
    } catch {
      // 登出不能被通知 Worker 的网络故障阻塞；下一次未登录通知请求会再次使用 clientId 解绑。
    } finally {
      clearCloudSession();
      clearV2SyncSession();
      setSession(null);
      setConflict(null);
      setSecurityUnlockOpen(false);
      setSecurityUnlockPassword('');
      setSecurityUnlockError('');
      setForm((current) => ({ ...current, password: '', securityPassword: '' }));
      setBusy('');
      showToast({ title: '已退出账户', tone: 'slate' });
    }
  }

  function handleRetrySecurityPassword() {
    const code = isSecurityUnlockErrorCode(errorCode) ? errorCode : SYNC_V2_SECURITY_PASSWORD_REQUIRED;
    openSecurityUnlockDialog(securityUnlockPrompt(code), code);
  }

  function getSyncErrorAction() {
    if (busy) return null;
    switch (errorCode) {
      case SECURE_VAULT_ERROR_CODES.WRONG_PASSWORD:
        return { label: '重新输入密码', onClick: handleRetrySecurityPassword };
      case SECURE_VAULT_ERROR_CODES.NEED_DEVICE_KEY:
        return { label: '输入安全密码解锁', onClick: handleRetrySecurityPassword };
      case SYNC_V2_SECURITY_PASSWORD_REQUIRED:
        return { label: '输入安全密码解锁', onClick: handleRetrySecurityPassword };
      default:
        return null;
    }
  }

  function renderSyncError() {
    if (!lastError) return null;
    const action = getSyncErrorAction();
    return (
      <div className="space-y-2">
        <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">{lastError}</div>
        {action ? (
          <button type="button" className={cx(subtleButtonClass, 'w-full justify-center')} onClick={action.onClick}>{action.label}</button>
        ) : null}
      </div>
    );
  }

  const authDisabledReason = busy
    ? '处理中'
    : !form.username
    ? '填写用户名'
    : !form.password
    ? '填写登录密码'
    : authMode === 'register' && form.securityPassword.length < 8
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
    : syncState === 'conflict'
    ? '待处理冲突'
    : meta?.version
    ? `已同步 v${meta.version}`
    : '等待同步';
  const conflictModal = conflict && typeof document !== 'undefined' ? createPortal((
    <div className="fixed inset-0 z-[140] flex items-end justify-center bg-slate-900/60 p-0 sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cloud-sync-conflict-title"
        className="flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl bg-white text-slate-900 shadow-2xl sm:max-h-[88vh] sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-amber-100 bg-amber-50 px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
              <AlertTriangle className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <div id="cloud-sync-conflict-title" className="text-sm font-bold text-amber-950">发现多端同步冲突</div>
              <div className="mt-1 text-xs leading-5 text-amber-800">{conflict.summaryText || '云端版本与本机数据不一致。'}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setConflict(null)}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-amber-700 hover:bg-amber-100"
            aria-label="稍后处理同步冲突"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-amber-100 bg-amber-50/70 px-3 py-3 text-xs">
                <div className="font-semibold text-amber-700">云端版本</div>
                <div className="mt-1 text-sm font-bold text-amber-950">v{conflict.remoteVersion ?? '-'}</div>
                <div className="mt-1 text-[11px] leading-5 text-amber-700">{formatSyncTime(conflict.remoteUpdatedAt)}</div>
              </div>
              <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-3 text-xs">
                <div className="font-semibold text-slate-500">本机数据</div>
                <div className="mt-1 text-sm font-bold text-slate-900">{conflict.localKeyCount ?? preview.keys.length} 项</div>
                <div className="mt-1 text-[11px] leading-5 text-slate-500">{formatSyncTime(conflict.localUpdatedAt)}</div>
              </div>
            </div>

            <div className="space-y-2 rounded-xl border border-slate-100 bg-white px-3 py-3 text-xs leading-5 text-slate-600">
              {conflict.changedKeys?.length ? <div><span className="font-semibold text-slate-900">两端不同：</span>{formatKeyList(conflict.changedKeys, 12)}</div> : null}
              {conflict.remoteOnlyKeys?.length ? <div><span className="font-semibold text-slate-900">云端独有：</span>{formatKeyList(conflict.remoteOnlyKeys, 12)}</div> : null}
              {conflict.localOnlyKeys?.length ? <div><span className="font-semibold text-slate-900">本机独有：</span>{formatKeyList(conflict.localOnlyKeys, 12)}</div> : null}
            </div>

            {renderSyncError()}
          </div>
        </div>

        <div className="grid gap-2 border-t border-slate-100 bg-white px-5 py-4 sm:grid-cols-3">
          <button
            type="button"
            className={cx(primaryButtonClass, 'justify-center')}
            onClick={() => handleResolveConflict('merge')}
            disabled={Boolean(busy)}
          >
            {busy === 'merge-conflict' ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitMerge className="h-4 w-4" />}
            合并
          </button>
          <button
            type="button"
            className={cx(secondaryButtonClass, 'justify-center bg-white')}
            onClick={() => handleResolveConflict('pull')}
            disabled={Boolean(busy)}
          >
            {busy === 'pull-conflict' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudDownload className="h-4 w-4" />}
            采用云端
          </button>
          <button
            type="button"
            className={cx(secondaryButtonClass, 'justify-center bg-white')}
            onClick={() => handleResolveConflict('local')}
            disabled={Boolean(busy)}
          >
            {busy === 'local-conflict' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudUpload className="h-4 w-4" />}
            采用本地
          </button>
        </div>
      </div>
    </div>
  ), document.body) : null;
  const securityUnlockModal = securityUnlockOpen && typeof document !== 'undefined' ? createPortal( (
    <div
      className="fixed inset-0 z-[150] flex items-end justify-center bg-slate-900/60 p-0 sm:items-center sm:p-4"
      onClick={closeSecurityUnlockDialog}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cloud-sync-security-unlock-title"
        className="w-full max-w-md rounded-t-2xl bg-white text-slate-900 shadow-2xl sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <form onSubmit={handleSecurityUnlockSubmit}>
          <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
            <div className="flex min-w-0 items-start gap-3">
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--brand-tint)] text-[var(--brand-text)]">
                <KeyRound className="h-5 w-5" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <div id="cloud-sync-security-unlock-title" className="text-sm font-bold">需要安全密码解锁同步</div>
                <div className="mt-1 text-xs leading-5 text-slate-500">设备密钥无法解开当前云端备份。输入安全密码后会先解锁，再检查本机与云端是否存在同一 key 的冲突。</div>
              </div>
            </div>
            <button
              type="button"
              onClick={closeSecurityUnlockDialog}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              aria-label="稍后处理"
              disabled={busy === 'security-unlock'}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <div className="space-y-3 px-5 py-4">
            <label className="block space-y-1.5 text-xs font-semibold text-slate-600">
              安全密码
              <input
                className={cx(inputClass, 'border-[var(--brand-text)]')}
                type="password"
                value={securityUnlockPassword}
                onChange={(event) => {
                  setSecurityUnlockPassword(event.target.value);
                  if (securityUnlockError) setSecurityUnlockError('');
                }}
                autoComplete="off"
                autoFocus
              />
            </label>
            {securityUnlockError ? <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs leading-5 text-red-600">{securityUnlockError}</div> : null}
            <div className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-800">安全密码只在本次登录期间用于解锁，不会上传或保存到服务器。</div>
          </div>
          <div className="flex gap-2 border-t border-slate-100 px-5 py-4">
            <button type="button" className={cx(secondaryButtonClass, 'flex-1 justify-center bg-white')} onClick={closeSecurityUnlockDialog} disabled={busy === 'security-unlock'}>稍后处理</button>
            <button type="submit" className={cx(primaryButtonClass, 'flex-1 justify-center')} disabled={busy === 'security-unlock'}>
              {busy === 'security-unlock' ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
              {busy === 'security-unlock' ? '正在解锁' : '解锁并继续'}
            </button>
          </div>
        </form>
      </div>
    </div>
  ), document.body) : null;

  return (
    <div className="relative ml-auto" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={cx(
          'inline-flex h-8 items-center gap-2 rounded-full border px-2.5 text-xs font-bold shadow-sm transition-colors',
          loggedIn
            ? 'border-[var(--brand-text)] bg-[var(--brand-tint)] text-[var(--brand-text)] hover:bg-[var(--brand-tint)]'
            : 'border-slate-200 bg-white text-slate-600 hover:border-[var(--brand-text)] hover:text-[var(--brand-text)]'
        )}
        aria-label={loggedIn ? `账户：${session.username}` : '登录账户'}
      >
        <span className={cx(
          'inline-flex h-5 w-5 items-center justify-center rounded-full',
          loggedIn ? 'bg-[var(--fg-1000)] text-white' : 'bg-slate-100 text-slate-500'
        )}>
          {loggedIn ? initial : <UserRound className="h-3.5 w-3.5" aria-hidden="true" />}
        </span>
        <span className="hidden max-w-[7rem] truncate sm:inline">{loggedIn ? session.username : '登录'}</span>
      </button>

      {open && loggedIn ? (
        <div
          role="dialog"
          aria-modal="false"
          className="absolute right-0 top-full z-[130] mt-2 max-h-[calc(100dvh-4.5rem)] w-[min(20rem,calc(100vw-1.5rem))] overflow-y-auto overscroll-contain rounded-2xl border border-slate-200 bg-white p-4 text-slate-900 shadow-xl"
          onClick={(event) => event.stopPropagation()}
        >
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[var(--fg-1000)] text-sm font-bold text-white">{initial}</span>
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
                  <div className="space-y-2 rounded-xl border border-[var(--brand-text)] bg-[var(--brand-tint)] p-3">
                    <div className="flex items-start gap-2 text-xs text-[var(--brand-text)]">
                      <RefreshCw className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--brand-text)]" aria-hidden="true" />
                      <div className="min-w-0">
                        <div className="font-bold">手动同步</div>
                        <div className="mt-0.5 leading-5 text-[var(--brand-text)]">登录后仍停在等待同步时，可手动检查云端并上传或合并本机数据。</div>
                      </div>
                    </div>
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
                  <PrivacyNotice compact />
                  {renderSyncError()}
                  <button type="button" className={cx(subtleButtonClass, 'w-full justify-center')} disabled={busy === 'logout'} onClick={() => { void handleLogout().finally(() => closeAccountAuth({ dismiss: false })); }}>
                    <LogOut className="h-4 w-4" />
                    退出登录
                  </button>
                </div>
        </div>
      ) : null}
      {conflictModal}
      {securityUnlockModal}

      {open && !loggedIn && typeof document !== "undefined" ? createPortal((
        <div
          className="fixed inset-0 z-[120] flex items-end justify-center bg-slate-900/60 p-0 sm:items-center sm:p-4"
          onClick={() => closeAccountAuth()}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="account-auth-dialog-title"
            className="relative flex max-h-[95vh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:max-h-[90vh] sm:rounded-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
              <div className="min-w-0">
                <div id="account-auth-dialog-title" className="text-sm font-bold text-slate-900">{authMode === 'register' ? '注册账户' : '账户登录'}</div>
                <div className="mt-0.5 truncate text-xs text-slate-500">登录后按变更自动同步</div>
              </div>
              <button
                type="button"
                onClick={() => closeAccountAuth()}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="关闭"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 text-slate-900 [touch-action:pan-y]">
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
                  <PrivacyNotice compact />
                  <label className="block space-y-1.5 text-xs font-semibold text-slate-600">
                    用户名
                    <input className={inputClass} value={form.username} onChange={(event) => updateField('username', event.target.value)} autoComplete="username" spellCheck="false" />
                  </label>
                  <label className="block space-y-1.5 text-xs font-semibold text-slate-600">
                    登录密码
                    <input className={inputClass} type="password" value={form.password} onChange={(event) => updateField('password', event.target.value)} autoComplete={authMode === 'register' ? 'new-password' : 'current-password'} />
                  </label>
                  <label className="block space-y-1.5 text-xs font-semibold text-slate-600">
                    {authMode === 'register' ? '安全密码' : '安全密码（新设备或未解锁时填写）'}
                    <div className="flex gap-2">
                      <div className="relative min-w-0 flex-1">
                        <input
                          className={cx(inputClass, form.securityPassword ? 'pr-10' : '')}
                          type={showSecurityPassword ? 'text' : 'password'}
                          value={form.securityPassword}
                          onChange={(event) => updateField('securityPassword', event.target.value)}
                          autoComplete="off"
                        />
                        {form.securityPassword ? (
                          <button
                            type="button"
                            className="absolute right-2 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                            onClick={() => setShowSecurityPassword((visible) => !visible)}
                            aria-label={showSecurityPassword ? '隐藏安全密码' : '显示安全密码'}
                            title={showSecurityPassword ? '隐藏安全密码' : '显示安全密码'}
                          >
                            {showSecurityPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                          </button>
                        ) : null}
                      </div>
                      {authMode === 'register' ? (
                        <button type="button" className={cx(subtleButtonClass, 'h-10 shrink-0 px-3')} onClick={() => updateField('securityPassword', generateSecurityPassword())}>生成</button>
                      ) : null}
                    </div>
                  </label>
                  <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600">
                    <input type="checkbox" checked={form.rememberDevice} onChange={(event) => updateField('rememberDevice', event.target.checked)} />
                    记住本设备
                  </label>
                  {renderSyncError()}
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
