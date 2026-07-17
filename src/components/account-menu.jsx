import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CloudDownload, CloudUpload, Eye, EyeOff, GitMerge, KeyRound, Loader2, LogOut, RefreshCw, Trash2, UserRound, X } from 'lucide-react';
import { clearCloudSession, CLOUD_SYNC_SESSION_EVENT, loadCloudSession, loginCloudAccount, registerCloudAccount } from '../app/authClient.js';
import { clearAllLocalAndRemoteData } from '../app/accountDataDeletion.js';
import { ACCOUNT_AUTH_OPEN_EVENT, consumeAccountAuthIntent } from '../app/accountAuthEvents.js';
import { generateSecurityPassword, loadRememberedKey, SECURE_VAULT_ERROR_CODES } from '../app/secureVault.js';
import { buildTransactionConflictRows } from '../app/holdingsTransactionConflict.js';
import { showToast } from '../app/toast.js';
import { collectBackupPayload, formatBytes } from '../app/webdavBackup.js';
import { USER_DATA_CHANGED_EVENT, USER_DATA_HYDRATION_EVENT, USER_DATA_MODE_EVENT, userDataStore } from '../app/userDataStore.js';
import { cx, inputClass, primaryButtonClass, secondaryButtonClass, subtleButtonClass } from './experience-ui.jsx';
import { CloudRestoreLoadingCard } from './cloud-restore-ui.jsx';
import { PrivacyNotice } from './PrivacyNotice.jsx';

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
  aiDcaNotifyClientConfig: '通知配置',
  aiDcaPlanState: '建仓计划',
  aiDcaPlanStore: '计划列表',
  aiDcaPositionSnapshot: '持仓快照',
  aiDcaSellPlanStore: '卖出计划',
  aiDcaSwitchStrategyPrefs: '基金切换偏好',
  aiDcaWorkspacePrefs: '工作区偏好'
};

const CLOUD_SYNC_META_KEY = 'aiDcaCloudSyncMeta';

function AccountAuthPanel({
  mobilePage = false,
  authMode,
  setAuthMode,
  form,
  updateField,
  showSecurityPassword,
  setShowSecurityPassword,
  authDisabledReason,
  errorMessage,
  busy,
  onAuth,
  onClose
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="account-auth-dialog-title"
      className={mobilePage ? 'mobile-account-page__auth-panel' : 'relative flex max-h-[95vh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:max-h-[90vh] sm:rounded-2xl'}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
        <div className="min-w-0">
          <div id="account-auth-dialog-title" className="text-sm font-bold text-slate-900">{authMode === 'register' ? '注册账户' : '账户登录'}</div>
          <div className="mt-0.5 truncate text-xs text-slate-500">登录后按变更自动同步</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={Boolean(busy)}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          aria-label="关闭"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className={mobilePage ? 'mobile-account-page__auth-content' : 'overflow-y-auto px-5 py-4 text-slate-900'}>
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
            <p><span className="font-semibold">安全密码</span>只在持仓交易记录发生差异、需要查看并合并流水时使用，<span className="font-semibold">不会上传服务器</span>。普通 Tab 不需要安全密码。</p>
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
            安全密码（本机数据归集或持仓解密时使用）
            <div className="flex gap-2">
              <div className="relative min-w-0 flex-1">
                <input
                  className={cx(inputClass, form.securityPassword ? 'pr-10' : '')}
                  type={showSecurityPassword ? 'text' : 'password'}
                  value={form.securityPassword}
                  onChange={(event) => updateField('securityPassword', event.target.value)}
                  aria-label="安全密码"
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
            <input type="checkbox" checked readOnly disabled />
            自动保存本设备同步密钥
          </label>
          <button
            type="button"
            className={cx(primaryButtonClass, 'w-full justify-center')}
            onClick={() => onAuth(authMode)}
            disabled={Boolean(authDisabledReason)}
            title={authDisabledReason || undefined}
          >
            {busy === authMode ? <Loader2 className="h-4 w-4 animate-spin" /> : (authMode === 'register' ? <KeyRound className="h-4 w-4" /> : <UserRound className="h-4 w-4" />)}
            {authMode === 'register' ? '注册并登录' : '登录'}
          </button>
          {authDisabledReason ? <div className="text-xs text-slate-400">{authDisabledReason}</div> : null}
          {errorMessage ? <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700">{errorMessage}</div> : null}
        </div>
      </div>
    </div>
  );
}


function DeleteAllDataModal({ confirmation, setConfirmation, busy, error, onClose, onConfirm }) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[150] flex items-end justify-center bg-slate-950/60 p-0 sm:items-center sm:p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-all-data-title"
        className="w-full max-w-md rounded-t-2xl bg-white p-5 text-slate-900 shadow-2xl sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-700">
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <div id="delete-all-data-title" className="text-sm font-bold text-slate-950">清除本地与云端数据</div>
            <p className="mt-1 text-xs leading-5 text-slate-600">将删除本机全部应用数据、缓存、设备密钥、云端同步备份和通知配置；账号本身保留，操作不可恢复。</p>
          </div>
        </div>
        <label className="mt-4 block space-y-1.5 text-xs font-semibold text-slate-700">
          输入 <span className="type-code text-red-700">delete</span> 确认
          <input
            className={cx(inputClass, 'border-red-200 focus:border-red-400 focus:ring-red-100')}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            autoComplete="off"
            autoFocus
            spellCheck="false"
            placeholder="delete"
          />
        </label>
        {error ? <div className="mt-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700">{error}</div> : null}
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button type="button" className={cx(secondaryButtonClass, 'justify-center')} onClick={onClose} disabled={Boolean(busy)}>取消</button>
          <button type="button" className={cx(primaryButtonClass, 'justify-center bg-red-600 hover:bg-red-700')} onClick={onConfirm} disabled={Boolean(busy) || confirmation !== 'delete'}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            {busy ? '清理中' : '确认清除'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function loadLocalCloudSyncMeta() {
  if (typeof window === 'undefined') return null;
  try {
    return JSON.parse(window.localStorage?.getItem(CLOUD_SYNC_META_KEY) || 'null');
  } catch {
    return null;
  }
}

function loadCloudSyncOps() {
  return import('../app/cloudSync.js');
}

function formatSyncTime(value = '') {
  if (!value) return '-';
  try { return new Date(value).toLocaleString('zh-CN', { hour12: false }); } catch { return value; }
}

function formatKeyList(keys = [], limit = 4) {
  const list = (Array.isArray(keys) ? keys : []).slice(0, limit).map((key) => SYNC_KEY_LABELS[key] || key);
  if (!list.length) return '无';
  return `${list.join('、')}${keys.length > limit ? ` 等 ${keys.length} 项` : ''}`;
}

export function AccountMenu({ initialOpen = false, mobilePage = false }) {
  const [initialAuthIntent] = useState(() => consumeAccountAuthIntent());
  const [session, setSession] = useState(() => loadCloudSession());
  const [meta, setMeta] = useState(() => loadLocalCloudSyncMeta());
  const [preview, setPreview] = useState(() => userDataStore.isAuthenticated() ? userDataStore.snapshot() : collectBackupPayload());
  const [syncState, setSyncState] = useState(() => userDataStore.offline ? 'offline' : 'idle');
  const [lastError, setLastError] = useState(() => userDataStore.offline ? '网络不可用，当前处于离线模式；联网后可恢复同步。' : '');
  const [errorCode, setErrorCode] = useState(() => userDataStore.offline ? 'OFFLINE' : '');
  const [form, setForm] = useState({ username: '', password: '', securityPassword: '', rememberDevice: true });
  const [busy, setBusy] = useState('');
  const [conflict, setConflict] = useState(null);
  const [holdingsConflict, setHoldingsConflict] = useState(null);
  const [holdingsConflictPassword, setHoldingsConflictPassword] = useState('');
  const [holdingsDecisions, setHoldingsDecisions] = useState({});
  const [legacyTabResource, setLegacyTabResource] = useState(null);
  const [legacyTabPassword, setLegacyTabPassword] = useState('');
  const [writerRequired, setWriterRequired] = useState(null);
  const [conflictPassword, setConflictPassword] = useState('');
  const [manualSyncPassword, setManualSyncPassword] = useState('');
  const [open, setOpen] = useState(initialOpen || Boolean(initialAuthIntent));
  const [authMode, setAuthMode] = useState(initialAuthIntent ? (initialAuthIntent.mode === 'login' ? 'login' : 'register') : 'login');
  const [showSecurityPassword, setShowSecurityPassword] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [dataDecision, setDataDecision] = useState(null);
  const [hydration, setHydration] = useState({ stage: 'connecting', progress: 5, current: 0, total: 0, message: '正在确认账号并连接云端…' });
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const pendingAuthRef = useRef(null);
  const dropdownRef = useRef(null);

  useEffect(() => {
    function refreshLocalState(event) {
      setSession(event?.detail?.session || loadCloudSession());
      setMeta(event?.detail?.meta || loadLocalCloudSyncMeta());
      setPreview(userDataStore.isAuthenticated() ? userDataStore.snapshot() : collectBackupPayload());
    }
    function syncStorage(event) {
      if (!event.key || event.key.startsWith('aiDca')) refreshLocalState(event);
    }
    function handleUserDataChanged(event) {
      setPreview(userDataStore.isAuthenticated() ? userDataStore.snapshot() : collectBackupPayload());
      if (event?.detail?.saveFailed) {
        setSyncState('error');
        setLastError(event.detail.error?.message || '数据保存失败，内存修改已回滚');
      }
    }
    function handleHydrationProgress(event) {
      const detail = event?.detail || {};
      setHydration((current) => ({
        ...current,
        ...(detail.stage ? { stage: detail.stage } : {}),
        ...(typeof detail.progress === 'number' ? { progress: detail.progress } : {}),
        ...(typeof detail.current === 'number' ? { current: detail.current } : {}),
        ...(typeof detail.total === 'number' ? { total: detail.total } : {}),
        ...(detail.message ? { message: detail.message } : {})
      }));
    }
    function handleUserDataMode(event) {
      const detail = event?.detail || {};
      if (detail.mode !== 'remote') return;
      if (detail.syncing) {
        setSyncState('syncing');
        setLastError('正在后台同步账户数据，当前页面暂时只读。');
        setErrorCode('SYNCING');
        refreshLocalState(event);
        return;
      }
      if (detail.offline) {
        setSyncState('offline');
        setLastError('网络不可用，当前处于离线模式；联网后可恢复同步。');
        setErrorCode('OFFLINE');
        refreshLocalState(event);
        return;
      }
      if (userDataStore.isAuthenticated()) {
        setSyncState('synced');
        setLastError('');
        setErrorCode('');
        refreshLocalState(event);
      }
    }
    function handleSyncStarted() {
      setSyncState('syncing');
      setLastError('');
      setErrorCode('');
    }
    function handleSyncDone(event) {
      const nextState = event?.detail?.result?.state || event?.detail?.result || {};
      const isReadOnly = nextState?.readOnly === true;
      setSyncState(isReadOnly ? 'readonly' : 'synced');
      setWriterRequired(isReadOnly ? { message: '当前设备是只读端，接管编辑权后才能保存数据。' } : null);
      setConflict(null);
      setLastError('');
      setErrorCode('');
      refreshLocalState(event);
    }
    function handleSyncError(event) {
      const nextConflict = event?.detail?.conflict || null;
      setConflict(nextConflict);
      setSyncState(nextConflict ? 'conflict' : 'error');
      setLastError(event?.detail?.message || '同步失败');
      setErrorCode(nextConflict ? '' : (event?.detail?.code || ''));
      refreshLocalState(event);
    }
    function handleWriterRequired(event) {
      setWriterRequired(event?.detail || { message: '当前设备为只读端，接管编辑权后才能保存数据。' });
      setSyncState('readonly');
      setLastError(event?.detail?.message || '当前设备为只读端，接管编辑权后才能保存数据。');
      refreshLocalState(event);
    }
    function handleWriterAcquired() {
      setWriterRequired(null);
      setLastError('');
      setSyncState('syncing');
    }
    function handleNeedsSync(event) {
      const code = event?.detail?.code || '';
      setSyncState(code === 'OFFLINE' ? 'offline' : code === 'SECURITY_PASSWORD_REQUIRED' ? 'security' : 'waiting');
      setLastError(event?.detail?.message || '联网或登录后同步');
    }
    function handleHoldingsConflict(event) {
      const detail = event?.detail || null;
      if (!detail) return;
      setSyncState('conflict');
      setLastError('持仓交易记录与云端不一致，请逐条选择处理方式。');
      prepareHoldingsConflict(detail).catch(() => {});
    }
    function handleHoldingsResolved() {
      setHoldingsConflict(null);
      setHoldingsDecisions({});
      setSyncState('synced');
      setLastError('');
    }
    function handleLegacyTabMigration(event) {
      const detail = event?.detail || null;
      if (!detail?.key) return;
      setLegacyTabResource(detail);
      setOpen(true);
      setLastError('该 Tab 仍有旧版加密数据，请按需迁移；迁移完成后不再需要安全密码。');
    }
    window.addEventListener(CLOUD_SYNC_SESSION_EVENT, refreshLocalState);
    window.addEventListener('cloud-sync:meta-changed', refreshLocalState);
    window.addEventListener('cloud-sync:auto-upload-started', handleSyncStarted);
    window.addEventListener('cloud-sync:auto-uploaded', handleSyncDone);
    window.addEventListener('cloud-sync:auto-restored', handleSyncDone);
    window.addEventListener('cloud-sync:auto-pulled', handleSyncDone);
    window.addEventListener('cloud-sync:migration-completed', handleSyncDone);
    window.addEventListener('cloud-sync:auto-error', handleSyncError);
    window.addEventListener('cloud-sync:writer-required', handleWriterRequired);
    window.addEventListener('cloud-sync:writer-acquired', handleWriterAcquired);
    window.addEventListener('cloud-sync:writer-lost', handleWriterRequired);
    window.addEventListener('cloud-sync:needs-login', handleNeedsSync);
    window.addEventListener('cloud-sync:needs-network', handleNeedsSync);
    window.addEventListener('cloud-sync:needs-security-password', handleNeedsSync);
    window.addEventListener('holdings-sync:conflict-needed', handleHoldingsConflict);
    window.addEventListener('holdings-sync:resolved', handleHoldingsResolved);
    window.addEventListener('user-data:legacy-migration-needed', handleLegacyTabMigration);
    window.addEventListener('storage', syncStorage);
    window.addEventListener(USER_DATA_CHANGED_EVENT, handleUserDataChanged);
    window.addEventListener(USER_DATA_HYDRATION_EVENT, handleHydrationProgress);
    window.addEventListener(USER_DATA_MODE_EVENT, handleUserDataMode);
    return () => {
      window.removeEventListener(CLOUD_SYNC_SESSION_EVENT, refreshLocalState);
      window.removeEventListener('cloud-sync:meta-changed', refreshLocalState);
      window.removeEventListener('cloud-sync:auto-upload-started', handleSyncStarted);
      window.removeEventListener('cloud-sync:auto-uploaded', handleSyncDone);
      window.removeEventListener('cloud-sync:auto-restored', handleSyncDone);
      window.removeEventListener('cloud-sync:auto-pulled', handleSyncDone);
      window.removeEventListener('cloud-sync:migration-completed', handleSyncDone);
      window.removeEventListener('cloud-sync:auto-error', handleSyncError);
      window.removeEventListener('cloud-sync:writer-required', handleWriterRequired);
      window.removeEventListener('cloud-sync:writer-acquired', handleWriterAcquired);
      window.removeEventListener('cloud-sync:writer-lost', handleWriterRequired);
      window.removeEventListener('cloud-sync:needs-login', handleNeedsSync);
      window.removeEventListener('cloud-sync:needs-network', handleNeedsSync);
      window.removeEventListener('cloud-sync:needs-security-password', handleNeedsSync);
      window.removeEventListener('holdings-sync:conflict-needed', handleHoldingsConflict);
      window.removeEventListener('holdings-sync:resolved', handleHoldingsResolved);
      window.removeEventListener('user-data:legacy-migration-needed', handleLegacyTabMigration);
      window.removeEventListener('storage', syncStorage);
      window.removeEventListener(USER_DATA_CHANGED_EVENT, handleUserDataChanged);
      window.removeEventListener(USER_DATA_HYDRATION_EVENT, handleHydrationProgress);
      window.removeEventListener(USER_DATA_MODE_EVENT, handleUserDataMode);
    };
  }, []);

  useEffect(() => {
    function handleOpenAuth(event) {
      const mode = event?.detail?.mode === 'login' ? 'login' : 'register';
      setAuthMode(mode);
      setOpen(true);
    }
    window.addEventListener(ACCOUNT_AUTH_OPEN_EVENT, handleOpenAuth);
    return () => window.removeEventListener(ACCOUNT_AUTH_OPEN_EVENT, handleOpenAuth);
  }, []);

  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined;
    const authBusy = busy === 'register' || busy === 'login';
    const isDropdown = Boolean(session?.accessToken) && !authBusy;
    const prev = document.body.style.overflow;
    if (mobilePage || !isDropdown) document.body.style.overflow = 'hidden';
    function onKey(event) { if (event.key === 'Escape' && !authBusy) setOpen(false); }
    function onClickOutside(event) {
      if (!isDropdown) return;
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    if (isDropdown) document.addEventListener('mousedown', onClickOutside);
    return () => {
      if (mobilePage || !isDropdown) document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
      if (isDropdown) document.removeEventListener('mousedown', onClickOutside);
    };
  }, [busy, mobilePage, open, session?.accessToken]);

  async function prepareHoldingsConflict(detail, securityPassword = '') {
    if (!detail) return;
    let remoteRaw = null;
    let decrypted = !detail.remote?.encrypted;
    const encrypted = detail.remote?.encrypted;
    if (encrypted) {
      try {
        const envelope = await userDataStore.decryptResource(encrypted, securityPassword, userDataStore.crypto.rawKey);
        remoteRaw = envelope?.payload?.[detail.key] ?? null;
        decrypted = true;
      } catch {
        // 没有密码时只显示“需要查看密码”，输入后再展开具体流水。
      }
    }
    const rows = (encrypted && !decrypted)
      ? []
      : buildTransactionConflictRows(detail.localRaw, remoteRaw);
    setHoldingsConflict({ ...detail, remoteRaw, rows, detailReady: decrypted });
    setOpen(true);
  }

  async function handleHoldingsConflictPassword() {
    if (!holdingsConflict) return;
    await prepareHoldingsConflict(holdingsConflict, holdingsConflictPassword);
  }

  async function handleResolveHoldingsConflict(decision = 'merge') {
    if (!holdingsConflict) return;
    if (holdingsConflict.localOnly && !holdingsConflictPassword && !userDataStore.crypto.rawKey) {
      setLastError('首次保存持仓交易记录需要输入安全密码。');
      return;
    }
    if (holdingsConflict.remote?.encrypted && !holdingsConflict.detailReady) {
      if (!holdingsConflictPassword && !userDataStore.crypto.rawKey) {
        setLastError('请输入安全密码后查看持仓交易明细。');
        return;
      }
      await handleHoldingsConflictPassword();
      return;
    }
    setBusy(`holdings-${decision}`);
    setLastError('');
    try {
      const decisions = decision === 'abandon'
        ? Object.fromEntries((holdingsConflict.rows || []).map((row) => [row.id, 'abandon']))
        : holdingsDecisions;
      await userDataStore.resolveHoldingsConflict({
        securityPassword: holdingsConflictPassword,
        decision: decision === 'remote' ? 'remote' : 'merge',
        decisions
      });
      setHoldingsConflict(null);
      setHoldingsDecisions({});
      setHoldingsConflictPassword('');
      setSyncState('synced');
      setErrorCode('');
      showToast({ title: decision === 'abandon' ? '已放弃选中的本机流水' : '持仓交易已合并', description: '后续仅同步持仓交易记录，其它配置按 Tab 接口独立保存。', tone: 'emerald' });
    } catch (error) {
      setLastError(error?.message || '持仓交易冲突处理失败');
      setErrorCode(error?.code || '');
      showToast({ title: '持仓交易冲突处理失败', description: error?.message || String(error), tone: 'red' });
    } finally {
      setBusy('');
    }
  }

  async function handleMigrateLegacyTabResource() {
    if (!legacyTabResource) return;
    setBusy('legacy-tab-migration');
    setLastError('');
    try {
      await userDataStore.migrateLegacyTabResource(legacyTabResource.key, { securityPassword: legacyTabPassword });
      setLegacyTabResource(null);
      setLegacyTabPassword('');
      showToast({ title: '该 Tab 的旧数据已迁移', description: '以后此 Tab 使用独立 REST JSON 接口，不再需要安全密码。', tone: 'emerald' });
    } catch (error) {
      setLastError(error?.message || '旧数据迁移失败');
      setErrorCode(error?.code || '');
    } finally {
      setBusy('');
    }
  }

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
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
      let syncResult = 'no-remote';
      try {
        await userDataStore.startRemoteSession(nextSession, {
          action,
          securityPassword: form.securityPassword,
          rememberDevice: form.rememberDevice
        });
        syncResult = 'tab-scoped';
      } catch (error) {
        if (error?.code === 'LOCAL_DATA_DECISION_REQUIRED') {
          pendingAuthRef.current = { session: nextSession, action, securityPassword: form.securityPassword };
          setDataDecision(error.summary || { localKeys: [], remoteKeys: [] });
          setSyncState('waiting');
          setOpen(true);
          return;
        }
        throw error;
      }
      setMeta(loadLocalCloudSyncMeta());
      setPreview(userDataStore.isAuthenticated() ? userDataStore.snapshot() : collectBackupPayload());
      setSyncState(syncResult === 'conflict' ? 'conflict' : syncResult === 'readonly' ? 'readonly' : 'syncing');
      setWriterRequired(syncResult === 'readonly' ? { message: '当前设备是只读端，接管编辑权后才能保存数据。' } : null);
      showToast({
        title: action === 'register' ? '账户已注册' : '已登录',
        description: '已登录，打开各功能页后读取对应数据；持仓流水仅在发生差异时请求安全密码。',
        tone: syncResult === 'conflict' ? 'amber' : 'emerald'
      });
      if (syncResult !== 'conflict') setOpen(false);
    } catch (err) {
      setErrorCode('');
      // 新逐资源水合失败时不保留半登录态，避免旧的 v2 手动同步面板接管写入；
      // 本机业务数据仍保留，用户可重新输入安全密码后再登录。
      if (!err?.isCloudSyncConflict && err?.data?.code !== 'WRITER_BUSY' && err?.data?.code !== 'WRITER_REQUIRED') {
        clearCloudSession();
        userDataStore.setAnonymous();
        setSession(null);
        setOpen(true);
      }
      if (err?.isCloudSyncConflict) {
        setConflict(err.conflict || null);
        setSyncState('conflict');
        setLastError(err.message || '云端数据已更新');
        setOpen(true);
        showToast({ title: '检测到同步冲突', description: err?.conflict?.summaryText || err.message, tone: 'amber' });
      } else if (err?.data?.code === 'WRITER_BUSY' || err?.data?.code === 'WRITER_REQUIRED') {
        setSyncState('readonly');
        setWriterRequired({ ...(err?.data?.writer ? { writer: err.data.writer } : {}), message: err?.message || '当前设备为只读端，接管编辑权后才能保存。' });
        setLastError(err.message || '当前设备为只读端');
        setOpen(true);
        showToast({ title: '当前为只读端', description: err?.message || '接管编辑权后才能保存。', tone: 'amber' });
      } else {
        setSyncState('error');
        setLastError(err?.message || String(err));
        setErrorCode(err?.data?.code || err?.code || '');
        showToast({ title: action === 'register' ? '注册/同步失败' : '登录/同步失败', description: err?.message || String(err), tone: 'red' });
      }
    } finally {
      setBusy('');
    }
  }

  async function resolveDataDecision(decision) {
    const pending = pendingAuthRef.current;
    const targetSession = pending?.session || session;
    if (!targetSession) return;
    if (decision === 'cancel') {
      pendingAuthRef.current = null;
      setDataDecision(null);
      if (pending) {
        clearCloudSession();
        userDataStore.setAnonymous();
        setSession(null);
        setSyncState('idle');
      } else {
        setLastError('已取消本机数据归集，本机数据仍保留。');
        setSyncState('synced');
      }
      return;
    }
    setBusy(`data-${decision}`);
    setLastError('');
    try {
      await userDataStore.startSession(targetSession, {
        action: pending?.action || 'login',
        securityPassword: pending?.securityPassword || manualSyncPassword || form.securityPassword,
        rememberDevice: form.rememberDevice,
        decision
      });
      pendingAuthRef.current = null;
      setDataDecision(null);
      setSession(targetSession);
      setMeta(loadLocalCloudSyncMeta());
      setPreview(userDataStore.snapshot());
      setSyncState('synced');
      setManualSyncPassword('');
      showToast({ title: decision === 'merge' ? '已合并本机数据' : '已使用云端数据', tone: 'emerald' });
    } catch (error) {
      if (pending && (error?.code === SECURE_VAULT_ERROR_CODES.WRONG_PASSWORD || error?.code === SECURE_VAULT_ERROR_CODES.NEED_DEVICE_KEY || error?.code === 'OFFLINE')) {
        clearCloudSession();
        userDataStore.setAnonymous();
        setSession(null);
        setDataDecision(null);
        setOpen(true);
      }
      setLastError(error?.message || String(error));
      showToast({ title: '数据归集失败', description: error?.message || String(error), tone: 'red' });
    } finally {
      setBusy('');
    }
  }

  async function handleStartMigration() {
    const remembered = loadRememberedKey({ userId: session?.userId, username: session?.username });
    const useRemembered = Boolean(remembered?.rawKey);
    const secret = useRemembered ? '' : (manualSyncPassword || form.securityPassword);
    if (!useRemembered && secret.length < 8) {
      showToast({ title: '需要安全密码', description: '首次归集会读取本机数据并加密合并到云端，请先输入安全密码。', tone: 'amber' });
      return;
    }
    setBusy('migration');
    setSyncState('syncing');
    setLastError('');
    setErrorCode('');
    try {
      await userDataStore.startSession(session, {
        action: 'login',
        securityPassword: secret,
        rememberDevice: form.rememberDevice
      });
      setManualSyncPassword('');
      setMeta(loadLocalCloudSyncMeta());
      setPreview(userDataStore.snapshot());
      setSyncState('synced');
      showToast({
        title: '首次数据归集完成',
        description: '本机数据已按资源合并到云端，之后会自动同步。',
        tone: 'emerald'
      });
    } catch (err) {
      if (err?.code === 'LOCAL_DATA_DECISION_REQUIRED') {
        setDataDecision(err.summary || { localKeys: [], remoteKeys: [] });
        setSyncState('waiting');
        return;
      }
      setSyncState('error');
      setLastError(err?.message || String(err));
      setErrorCode(err?.data?.code || err?.code || '');
      showToast({ title: '首次数据归集失败', description: err?.message || String(err), tone: 'red' });
    } finally {
      setBusy('');
    }
  }

  async function handleResolveConflict(mode) {
    const remembered = loadRememberedKey({ userId: session?.userId, username: session?.username });
    const useRemembered = Boolean(remembered?.rawKey);
    const secret = useRemembered ? '' : (conflictPassword || form.securityPassword);
    if (!useRemembered && secret.length < 8) {
      showToast({ title: '需要安全密码', description: '请输入安全密码后再处理冲突。', tone: 'amber' });
      return;
    }
    const busyKey = mode === 'merge' ? 'merge-conflict' : mode === 'local' ? 'local-conflict' : 'pull-conflict';
    setBusy(busyKey);
    setLastError('');
    setErrorCode('');
    try {
      const {
        mergeLocalIntoCloudBackup,
        overwriteCloudWithLocal,
        pullRemoteAuthoritativeMerge
      } = await loadCloudSyncOps();
      let result;
      if (mode === 'merge') {
        result = await mergeLocalIntoCloudBackup({ securityPassword: secret, rememberDevice: form.rememberDevice, useRemembered });
      } else if (mode === 'local') {
        result = await overwriteCloudWithLocal({ securityPassword: secret, rememberDevice: form.rememberDevice, useRemembered });
      } else {
        result = await pullRemoteAuthoritativeMerge({ securityPassword: secret, useRemembered, rememberDevice: form.rememberDevice });
      }
      setConflict(null);
      setConflictPassword('');
      setMeta(loadLocalCloudSyncMeta());
      setPreview(userDataStore.isAuthenticated() ? userDataStore.snapshot() : collectBackupPayload());
      setSyncState('synced');
      window.dispatchEvent(new CustomEvent(mode === 'pull' ? 'cloud-sync:auto-restored' : 'cloud-sync:auto-uploaded', { detail: { result } }));
      const toastByMode = {
        merge: { title: '已合并并同步', description: '本机数据已合并到云端，远端独有数据也已保留到本机。' },
        local: { title: '已采用本机', description: '已用本机数据强制覆盖云端版本。' },
        pull: { title: '已采用云端', description: '云端版本已覆盖本机冲突数据，本机独有数据已保留。' }
      };
      showToast({ ...toastByMode[mode], tone: 'emerald' });
    } catch (err) {
      if (err?.isCloudSyncConflict) {
        setConflict(err.conflict || conflict);
        setSyncState('conflict');
      } else {
        setSyncState('error');
      }
      setLastError(err?.message || String(err));
      setErrorCode(err?.isCloudSyncConflict ? '' : (err?.data?.code || err?.code || ''));
      showToast({ title: '处理冲突失败', description: err?.message || String(err), tone: 'red' });
    } finally {
      setBusy('');
    }
  }

  async function handleManualSync() {
    const remembered = loadRememberedKey({ userId: session?.userId, username: session?.username });
    const useRemembered = Boolean(remembered?.rawKey);
    const secret = useRemembered ? '' : (manualSyncPassword || form.securityPassword);
    if (!useRemembered && secret.length < 8) {
      showToast({ title: '需要安全密码', description: '请输入安全密码后再同步。', tone: 'amber' });
      return;
    }
    setBusy('manual-sync');
    setSyncState('syncing');
    setLastError('');
    setErrorCode('');
    try {
      const { syncNow: runSync } = await loadCloudSyncOps();
      const result = await runSync({ securityPassword: secret, reason: 'manual' });
      const syncResult = result?.pulled ? 'pulled' : result?.uploaded ? 'uploaded' : result?.skipped ? 'skipped-upload' : 'no-remote';

      setManualSyncPassword('');
      setConflict(null);
      setWriterRequired(null);
      setMeta(loadLocalCloudSyncMeta());
      setPreview(userDataStore.isAuthenticated() ? userDataStore.snapshot() : collectBackupPayload());
      setSyncState('synced');
      showToast({
        title: '手动同步完成',
        description: syncResult === 'pulled' ? '已按云端版本刷新本机数据。' : syncResult === 'uploaded' ? '已创建云端备份。' : '本地与云端无需更新。',
        tone: 'emerald'
      });
    } catch (err) {
      if (err?.isCloudSyncConflict) {
        setConflict(err.conflict || null);
        setSyncState('conflict');
        showToast({ title: '检测到同步冲突', description: err?.conflict?.summaryText || err.message, tone: 'amber' });
      } else if (err?.data?.code === 'WRITER_BUSY' || err?.code === 'WRITER_REQUIRED') {
        setSyncState('readonly');
        setWriterRequired({ ...(err?.data?.writer ? { writer: err.data.writer } : {}), message: err?.message || '当前设备为只读端，接管编辑权后才能保存。' });
        showToast({ title: '当前为只读端', description: err?.message || '接管编辑权后才能保存。', tone: 'amber' });
      } else {
        setSyncState('error');
        showToast({ title: '手动同步失败', description: err?.message || String(err), tone: 'red' });
      }
      setLastError(err?.message || String(err));
      setErrorCode(err?.isCloudSyncConflict ? '' : (err?.code || ''));
    } finally {
      setBusy('');
    }
  }

  async function handleTakeoverEditing() {
    const remembered = loadRememberedKey({ userId: session?.userId, username: session?.username });
    const secret = remembered?.rawKey ? '' : (manualSyncPassword || form.securityPassword);
    if (!remembered?.rawKey && secret.length < 8) {
      showToast({ title: '需要安全密码', description: '请输入安全密码后再接管编辑权。', tone: 'amber' });
      return;
    }
    setBusy('takeover');
    setSyncState('syncing');
    setLastError('');
    try {
      const { takeOverEditing } = await loadCloudSyncOps();
      const result = await takeOverEditing({ securityPassword: secret });
      setWriterRequired(null);
      setManualSyncPassword('');
      setMeta(loadLocalCloudSyncMeta());
      setPreview(userDataStore.isAuthenticated() ? userDataStore.snapshot() : collectBackupPayload());
      setSyncState('synced');
      showToast({ title: '已接管编辑权', description: '当前设备现在可以保存，其他设备将自动转为只读。', tone: 'emerald' });
      window.dispatchEvent(new CustomEvent('cloud-sync:auto-uploaded', { detail: { result } }));
    } catch (err) {
      setSyncState('error');
      setLastError(err?.message || String(err));
      setErrorCode(err?.data?.code || err?.code || '');
      showToast({ title: '接管编辑权失败', description: err?.message || String(err), tone: 'red' });
    } finally {
      setBusy('');
    }
  }


  function openDeleteDialog() {
    if (busy) return;
    setDeleteConfirmation('');
    setDeleteError('');
    setDeleteDialogOpen(true);
  }

  function closeDeleteDialog() {
    if (busy === 'delete-all-data') return;
    setDeleteDialogOpen(false);
    setDeleteConfirmation('');
    setDeleteError('');
  }

  async function handleDeleteAllAccountData() {
    if (deleteConfirmation !== 'delete') return;
    setBusy('delete-all-data');
    setDeleteError('');
    try {
      const deletionResult = await clearAllLocalAndRemoteData({ confirmation: deleteConfirmation });
      setSession(null);
      setMeta(null);
      setPreview({ entries: {}, keys: [] });
      setConflict(null);
      setSyncState('idle');
      setDeleteDialogOpen(false);
      setDeleteConfirmation('');
      setOpen(false);
      if (mobilePage) window.dispatchEvent(new CustomEvent('console:close-mobile-account'));
      showToast({
        title: deletionResult.cloudSkipped ? '已清除本机数据' : '已清除本地与云端数据',
        description: deletionResult.cloudSkipped ? '当前未登录，已清除本机数据；云端数据未操作。' : '本机数据、缓存和云端同步数据已清除。',
        tone: 'emerald'
      });
      if (typeof window !== 'undefined') window.setTimeout(() => window.location.reload(), 250);
    } catch (err) {
      const message = err?.message || String(err);
      setDeleteError(message);
      showToast({ title: '清除失败', description: message, tone: 'red' });
    } finally {
      setBusy('');
    }
  }

  async function handleLogout() {
    if (!logoutConfirmOpen) {
      setLogoutConfirmOpen(true);
      return;
    }
    if (userDataStore.hasPendingLocalMigration()) {
      showToast({ title: '请先完成数据归集', description: '本机仍有尚未上传的数据；完成归集后才能安全退出登录。', tone: 'amber' });
      return;
    }
    setBusy('logout');
    try {
      const logoutResult = await userDataStore.logout({ flush: true });
      clearCloudSession();
      setSession(null);
      setMeta(null);
      setPreview({ entries: {}, keys: [] });
      setSyncState('idle');
      setConflict(null);
      setWriterRequired(null);
      setConflictPassword('');
      setLogoutConfirmOpen(false);
      setOpen(false);
      if (mobilePage) window.dispatchEvent(new CustomEvent('console:close-mobile-account'));
      const failedUploads = logoutResult?.flushErrors?.length > 0;
      const failedLocalCleanup = logoutResult?.localClearErrors?.length > 0;
      showToast({
        title: failedLocalCleanup ? '已退出，但本地清理不完整' : '已退出账户',
        description: failedLocalCleanup
          ? '会话已退出，但部分本地数据未能清除，请检查应用存储权限后重试。'
          : failedUploads
            ? '本机数据已清除，但部分最新修改未能上传；云端保留此前已保存的数据。'
            : '业务数据已从本机清除，重新登录即可从云端恢复。',
        tone: failedLocalCleanup ? 'amber' : failedUploads ? 'amber' : 'slate'
      });
    } catch (error) {
      setLastError(error?.message || '退出时本地清理遇到问题');
      showToast({ title: '退出已暂停', description: error?.message || '部分修改尚未保存到云端，请联网后重试。', tone: 'amber' });
    } finally {
      setBusy('');
    }
  }

  function handleRetrySecurityPassword() {
    setLastError('');
    setErrorCode('');
    setManualSyncPassword('');
    setConflictPassword('');
  }

  function handleForceReupload() {
    const secret = manualSyncPassword || conflictPassword || form.securityPassword;
    if (!secret || secret.length < 8) {
      showToast({ title: '需要安全密码', description: '请输入安全密码后再重传覆盖云端。', tone: 'amber' });
      return;
    }
    setBusy('force-reupload');
    setSyncState('syncing');
    setLastError('');
    setErrorCode('');
    loadCloudSyncOps()
      .then((ops) => ops.takeOverEditing({ securityPassword: secret }))
      .then((result) => {
        setManualSyncPassword('');
        setConflict(null);
        setMeta(loadLocalCloudSyncMeta());
        setPreview(userDataStore.isAuthenticated() ? userDataStore.snapshot() : collectBackupPayload());
        setSyncState('synced');
        window.dispatchEvent(new CustomEvent('cloud-sync:auto-uploaded', { detail: { result } }));
        showToast({ title: '已重传覆盖云端', description: '云端已替换为本机安全密码加密的备份。', tone: 'emerald' });
      })
      .catch((err) => {
        setSyncState('error');
        setLastError(err?.message || String(err));
        setErrorCode(err?.code || '');
        showToast({ title: '重传覆盖失败', description: err?.message || String(err), tone: 'red' });
      })
      .finally(() => setBusy(''));
  }

  function getSyncErrorAction() {
    if (busy) return null;
    switch (errorCode) {
      case SECURE_VAULT_ERROR_CODES.WRONG_PASSWORD:
        return { label: '重新输入密码', onClick: handleRetrySecurityPassword };
      case SECURE_VAULT_ERROR_CODES.NEED_DEVICE_KEY:
        return { label: '用安全密码重传覆盖', onClick: handleForceReupload };
      case SECURE_VAULT_ERROR_CODES.CORRUPTED:
        return { label: '重传覆盖云端', onClick: handleForceReupload };
      case 'MIGRATION_REQUIRED':
        return { label: '开始首次数据归集', onClick: handleStartMigration };
      default:
        return null;
    }
  }

  function renderSyncError() {
    if (!lastError) return null;
    if (migrationRequired) return null;
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
    : '';
  const loggedIn = Boolean(session?.accessToken);
  const newDataMode = loggedIn && userDataStore.isAuthenticated();
  const pendingLocalMigration = loggedIn && userDataStore.hasPendingLocalMigration();
  const authBusy = busy === 'register' || busy === 'login';
  const restoreBusy = ['register', 'login', 'migration', 'manual-sync', 'data-merge', 'data-cloud'].includes(busy);
  const rememberedSyncKey = loggedIn ? loadRememberedKey({ userId: session?.userId, username: session?.username }) : null;
  const hasRememberedSyncKey = Boolean(rememberedSyncKey?.rawKey && rememberedSyncKey?.crypto?.wrappedDek);
  const initial = loggedIn ? String(session.username || '?').slice(0, 1).toUpperCase() : '';
  const previewBytes = preview.keys.reduce((sum, key) => sum + (preview.entries[key]?.length || 0), 0);
  const statusLabel = !loggedIn
    ? '未登录'
    : typeof navigator !== 'undefined' && navigator.onLine === false
    ? '联网后同步'
    : pendingLocalMigration
    ? '待首次归集'
    : syncState === 'syncing'
    ? '同步中'
    : newDataMode
    ? '已同步'
    : syncState === 'offline'
    ? '联网后同步'
    : syncState === 'waiting'
    ? '登录后同步'
    : syncState === 'readonly' || writerRequired
    ? '只读端'
    : syncState === 'security'
    ? '需要安全密码'
    : errorCode === 'MIGRATION_REQUIRED' || lastError.includes('首次数据归集')
    ? '需要首次归集'
    : syncState === 'error'
    ? '同步失败'
    : syncState === 'conflict'
    ? '待处理冲突'
    : meta?.version
    ? `已同步 v${meta.version}`
    : '等待同步';
  const migrationRequired = loggedIn && (pendingLocalMigration || (!newDataMode && (errorCode === 'MIGRATION_REQUIRED' || lastError.includes('首次数据归集'))));
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

            {!loadRememberedKey({ userId: session?.userId, username: session?.username })?.rawKey ? (
              <label className="block space-y-1.5 text-xs font-semibold text-slate-600">
                安全密码
                <input
                  className={cx(inputClass, 'border-amber-200 bg-white')}
                  type="password"
                  value={conflictPassword}
                  onChange={(event) => setConflictPassword(event.target.value)}
                  autoComplete="off"
                />
              </label>
            ) : null}

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

  const holdingsConflictModal = holdingsConflict && typeof document !== 'undefined' ? createPortal((
    <div className="fixed inset-0 z-[145] flex items-end justify-center bg-slate-900/60 p-0 sm:items-center sm:p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="holdings-conflict-title" className="flex max-h-[94vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl bg-white text-slate-900 shadow-2xl sm:rounded-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-amber-100 bg-amber-50 px-5 py-4">
          <div>
            <div id="holdings-conflict-title" className="text-sm font-bold text-amber-950">持仓交易记录存在差异</div>
            <div className="mt-1 text-xs leading-5 text-amber-800">只处理交易流水；账户设置、计划和通知不会进入这个冲突流程。请逐条选择合并本机记录或放弃本机记录。</div>
          </div>
          <button type="button" onClick={() => setHoldingsConflict(null)} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-amber-700 hover:bg-amber-100" aria-label="稍后处理持仓冲突"><X className="h-4 w-4" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {!holdingsConflict.detailReady ? (
            <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/70 p-4 text-xs leading-5 text-amber-900">
              <div className="font-semibold">交易记录已加密，输入安全密码后查看具体冲突明细。</div>
              <div className="text-amber-800">普通 Tab 不需要安全密码；密码只在本次解密持仓交易记录时使用。</div>
              <input className={cx(inputClass, 'border-amber-200 bg-white')} type="password" value={holdingsConflictPassword} onChange={(event) => setHoldingsConflictPassword(event.target.value)} placeholder="安全密码" autoComplete="off" />
              <button type="button" className={cx(primaryButtonClass, 'w-full justify-center')} onClick={handleHoldingsConflictPassword} disabled={Boolean(busy)}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}查看冲突明细</button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
                <span>共 {holdingsConflict.rows?.length || 0} 条差异交易</span>
                <div className="flex gap-2">
                  <button type="button" className={cx(subtleButtonClass, 'px-3 py-1.5 text-xs')} onClick={() => setHoldingsDecisions(Object.fromEntries((holdingsConflict.rows || []).map((row) => [row.id, 'merge'])))}>合并全部</button>
                  <button type="button" className={cx(subtleButtonClass, 'px-3 py-1.5 text-xs')} onClick={() => setHoldingsDecisions(Object.fromEntries((holdingsConflict.rows || []).map((row) => [row.id, 'abandon'])))}>放弃全部</button>
                </div>
              </div>
              {(holdingsConflict.rows || []).length ? (holdingsConflict.rows || []).map((row) => {
                const decision = holdingsDecisions[row.id] || row.defaultDecision;
                const local = row.localSummary;
                const remote = row.remoteSummary;
                return (
                  <div key={row.id} className="rounded-xl border border-slate-200 p-3 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-semibold text-slate-900">{local?.name || remote?.name || local?.code || remote?.code || row.id}</div>
                      <div className="flex items-center gap-1.5">
                        <button type="button" className={cx(subtleButtonClass, 'px-2 py-1 text-[11px]', decision === 'merge' ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : '')} onClick={() => setHoldingsDecisions((current) => ({ ...current, [row.id]: 'merge' }))}>合并本机</button>
                        <button type="button" className={cx(subtleButtonClass, 'px-2 py-1 text-[11px]', decision === 'abandon' ? 'border-slate-400 bg-slate-100 text-slate-800' : '')} onClick={() => setHoldingsDecisions((current) => ({ ...current, [row.id]: 'abandon' }))}>放弃本机</button>
                      </div>
                    </div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <div className="rounded-lg bg-slate-50 px-2.5 py-2"><div className="mb-1 text-[10px] font-semibold text-slate-400">本机 · {row.kind === 'remote-only' ? '无记录' : '有记录'}</div><div className="leading-5 text-slate-700">{local ? `${local.date || '-'} · ${local.type || '-'} · 数量 ${local.shares || '-'} · 金额 ${local.amount || '-'}` : '—'}</div></div>
                      <div className="rounded-lg bg-amber-50/70 px-2.5 py-2"><div className="mb-1 text-[10px] font-semibold text-amber-600">云端 · {row.kind === 'local-only' ? '无记录' : '有记录'}</div><div className="leading-5 text-amber-900">{remote ? `${remote.date || '-'} · ${remote.type || '-'} · 数量 ${remote.shares || '-'} · 金额 ${remote.amount || '-'}` : '—'}</div></div>
                    </div>
                  </div>
                );
              }) : <div className="rounded-xl bg-emerald-50 px-3 py-4 text-center text-xs text-emerald-800">两端交易内容一致，无需处理。</div>}
            </div>
          )}
          {lastError ? <div className="mt-3 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">{lastError}</div> : null}
        </div>
        {holdingsConflict.detailReady ? (
          <div className="grid gap-2 border-t border-slate-100 bg-white px-5 py-4 sm:grid-cols-3">
            <button type="button" className={cx(primaryButtonClass, 'justify-center')} onClick={() => handleResolveHoldingsConflict('merge')} disabled={Boolean(busy) || !holdingsConflict.rows?.length}>{busy === 'holdings-merge' ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitMerge className="h-4 w-4" />}确认合并选择</button>
            <button type="button" className={cx(secondaryButtonClass, 'justify-center bg-white')} onClick={() => handleResolveHoldingsConflict('abandon')} disabled={Boolean(busy) || !holdingsConflict.rows?.length}>{busy === 'holdings-abandon' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudUpload className="h-4 w-4" />}确认放弃选择</button>
            <button type="button" className={cx(secondaryButtonClass, 'justify-center bg-white')} onClick={() => handleResolveHoldingsConflict('remote')} disabled={Boolean(busy)}>{busy === 'holdings-remote' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudDownload className="h-4 w-4" />}放弃本机并采用云端</button>
          </div>
        ) : null}
      </div>
    </div>
  ), document.body) : null;

  const deleteDataModal = deleteDialogOpen ? (
    <DeleteAllDataModal
      confirmation={deleteConfirmation}
      setConfirmation={setDeleteConfirmation}
      busy={busy === 'delete-all-data'}
      error={deleteError}
      onClose={closeDeleteDialog}
      onConfirm={handleDeleteAllAccountData}
    />
  ) : null;

  const dataDecisionModal = dataDecision && typeof document !== 'undefined' ? createPortal((
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-900/60 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="user-data-decision-title" className="w-full max-w-[300px]" onClick={(event) => event.stopPropagation()}>
        <div className="relative w-full rounded-[22px] border border-slate-100 bg-white px-5 py-8 shadow-[0_8px_28px_rgba(15,23,42,0.06)]">
          <div className="mb-5 flex justify-center text-violet-600"><AlertTriangle className="h-12 w-12" strokeWidth={1.5} /></div>
          <div id="user-data-decision-title" className="text-center text-sm font-bold text-slate-900">发现本机未归属数据</div>
          <p className="mt-3 text-center text-xs leading-5 text-slate-500">检测到本机数据与云端数据冲突，请选择处理方式。</p>
          {dataDecision.foreignOwner ? <p className="mt-3 text-center text-xs leading-5 text-amber-700">本机数据属于其它账号，不能合并。</p> : null}
          {!pendingAuthRef.current && !hasRememberedSyncKey ? <input className={cx(inputClass, 'mt-4 h-9 border-violet-200 bg-white text-xs')} type="password" value={manualSyncPassword} onChange={(event) => setManualSyncPassword(event.target.value)} placeholder="安全密码" autoComplete="off" /> : null}
          <div className="mt-6 grid gap-2.5">
            {!dataDecision.foreignOwner ? <button type="button" className="rounded-xl bg-violet-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-violet-700" disabled={Boolean(busy)} onClick={() => resolveDataDecision('merge')}>合并到当前账户</button> : null}
            <button type="button" className="rounded-xl border border-violet-300 px-4 py-2.5 text-xs font-semibold text-violet-700 transition hover:bg-violet-50" disabled={Boolean(busy)} onClick={() => resolveDataDecision('cloud')}>仅使用云端数据</button>
            <button type="button" className="rounded-xl px-4 py-1.5 text-xs text-slate-500 transition hover:text-slate-700" disabled={Boolean(busy)} onClick={() => resolveDataDecision('cancel')}>{pendingAuthRef.current ? '取消登录并保留本机数据' : '取消归集并保留本机数据'}</button>
          </div>
        </div>
      </div>
    </div>
  ), document.body) : null;

  const restoreOverlay = restoreBusy && typeof document !== 'undefined' ? createPortal(
    <div className="fixed inset-0 z-[160] flex items-center justify-center bg-[#fafafa] px-4 text-slate-900">
      <CloudRestoreLoadingCard syncingLocalData={!authBusy} hydration={hydration} />
    </div>,
    document.body
  ) : null;

  const logoutModal = logoutConfirmOpen && typeof document !== 'undefined' ? createPortal((
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-900/60 p-4">
      <div role="dialog" aria-modal="true" className="w-full max-w-md rounded-2xl bg-white p-5 text-slate-900 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="text-base font-bold">确认退出登录？</div>
        <p className="mt-2 text-xs leading-5 text-slate-600">{userDataStore.hasPendingLocalMigration() ? '本机仍有尚未上传的数据，请先在账户同步面板完成数据归集。' : '退出后，本设备不会保留持仓、计划、提醒等业务数据；已保存的数据仍在云端，再次登录即可恢复。'}</p>
        <div className="mt-4 flex gap-2">
          <button type="button" className={cx(subtleButtonClass, 'flex-1 justify-center')} disabled={Boolean(busy)} onClick={() => setLogoutConfirmOpen(false)}>取消</button>
          <button type="button" className={cx(primaryButtonClass, 'flex-1 justify-center')} disabled={Boolean(busy)} onClick={handleLogout}>{busy === 'logout' ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}确认退出</button>
        </div>
      </div>
    </div>
  ), document.body) : null;

  function closeAccountMenu() {
    if (authBusy) return;
    setOpen(false);
    if (mobilePage) window.dispatchEvent(new CustomEvent('console:close-mobile-account'));
  }

  if (mobilePage && !open) return null;

  return (
    <div className={mobilePage ? 'mobile-account-page' : 'relative ml-auto'} ref={dropdownRef}>
      {!mobilePage ? (
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
      ) : null}

      {open && loggedIn && !authBusy ? (
        <div
          role="dialog"
          aria-modal={mobilePage ? 'true' : 'false'}
          className={mobilePage ? 'mobile-account-page__content' : 'absolute right-0 top-full z-[130] mt-2 w-[min(20rem,calc(100vw-1.5rem))] rounded-2xl border border-slate-200 bg-white p-4 text-slate-900 shadow-xl'}
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
                  {migrationRequired ? (
                    <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-950">
                      <div className="flex items-start gap-2">
                        <CloudUpload className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
                        <div className="min-w-0">
                          <div className="font-bold">{pendingLocalMigration ? '该设备有本机数据待归集' : '该账号仍有旧版数据待迁移'}</div>
                          <div className="mt-1 leading-5 text-amber-800">{pendingLocalMigration ? '登录已完成。点击按钮后才会读取并合并本机数据；在此之前不会因打开其它 Tab 而静默上传或覆盖云端。' : '请保持联网并输入安全密码完成旧版数据迁移。'}</div>
                        </div>
                      </div>
                      {!hasRememberedSyncKey ? (
                        <input
                          className={cx(inputClass, 'h-9 border-amber-200 bg-white text-xs')}
                          type="password"
                          value={manualSyncPassword}
                          onChange={(event) => setManualSyncPassword(event.target.value)}
                          placeholder="安全密码"
                          autoComplete="off"
                        />
                      ) : null}
                      <button
                        type="button"
                        className={cx(primaryButtonClass, 'min-h-9 w-full justify-center bg-amber-600 px-3 py-2 text-xs hover:bg-amber-700')}
                        onClick={handleStartMigration}
                        disabled={Boolean(busy)}
                      >
                        {busy === 'migration' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudUpload className="h-4 w-4" />}
                        {busy === 'migration' ? '正在归集数据' : '开始首次数据归集'}
                      </button>
                    </div>
                  ) : null}
                  {legacyTabResource ? (
                    <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-950">
                      <div className="font-bold">发现 {SYNC_KEY_LABELS[legacyTabResource.key] || legacyTabResource.key} 的旧版加密数据</div>
                      <div className="leading-5 text-amber-800">这是一次按 Tab 的迁移，不会读取其它 Tab，也不会阻塞登录。输入旧安全密码后，该资源会转换为普通 REST JSON。</div>
                      <input className={cx(inputClass, 'h-9 border-amber-200 bg-white text-xs')} type="password" value={legacyTabPassword} onChange={(event) => setLegacyTabPassword(event.target.value)} placeholder="旧安全密码" autoComplete="off" />
                      <button type="button" className={cx(primaryButtonClass, 'min-h-9 w-full justify-center bg-amber-600 px-3 py-2 text-xs hover:bg-amber-700')} onClick={handleMigrateLegacyTabResource} disabled={Boolean(busy)}>{busy === 'legacy-tab-migration' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudUpload className="h-4 w-4" />}迁移此 Tab</button>
                    </div>
                  ) : null}
                  {!newDataMode ? <div className="space-y-2 rounded-xl border border-indigo-100 bg-indigo-50/70 p-3">
                    <div className="flex items-start gap-2 text-xs text-indigo-900">
                      <RefreshCw className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-600" aria-hidden="true" />
                      <div className="min-w-0">
                        <div className="font-bold">手动同步</div>
                        <div className="mt-0.5 leading-5 text-indigo-700">联网且登录后会自动拉取；当前设备有待保存数据时会按编辑权上传。</div>
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
                  </div> : null}
                  {!newDataMode && writerRequired ? (
                    <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-900">
                      <div className="font-bold">当前设备为只读端</div>
                      <div className="leading-5">{writerRequired.message || '其它设备正在编辑。接管后其它设备会自动转为只读。'}</div>
                      <button
                        type="button"
                        className={cx(primaryButtonClass, 'min-h-9 w-full justify-center bg-amber-600 px-3 py-2 text-xs hover:bg-amber-700')}
                        onClick={handleTakeoverEditing}
                        disabled={Boolean(busy)}
                      >
                        {busy === 'takeover' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudUpload className="h-4 w-4" />}
                        {busy === 'takeover' ? '正在接管' : '接管编辑权并保存本机'}
                      </button>
                    </div>
                  ) : null}
                  <PrivacyNotice compact />
                  {!newDataMode ? renderSyncError() : <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-800">业务数据保存在内存和云端，页面关闭或退出登录后本机业务数据会清除。</div>}

                  <button
                    type="button"
                    className={cx(subtleButtonClass, 'w-full justify-center border-red-200 text-red-700 hover:bg-red-50')}
                    onClick={openDeleteDialog}
                    disabled={Boolean(busy)}
                  >
                    <Trash2 className="h-4 w-4" />
                    清除本地与云端数据
                  </button>
                  <button type="button" className={cx(subtleButtonClass, 'w-full justify-center')} onClick={handleLogout} disabled={Boolean(busy)}>
                    <LogOut className="h-4 w-4" />
                    退出登录
                  </button>
                </div>
        </div>
      ) : null}
      {conflictModal}
      {holdingsConflictModal}
      {dataDecisionModal}
      {logoutModal}
      {deleteDataModal}
      {restoreOverlay}

      {open && (!loggedIn || authBusy) && typeof document !== "undefined" ? (
        mobilePage ? (
          <AccountAuthPanel
            mobilePage
            authMode={authMode}
            setAuthMode={setAuthMode}
            form={form}
            updateField={updateField}
            showSecurityPassword={showSecurityPassword}
            setShowSecurityPassword={setShowSecurityPassword}
            authDisabledReason={authDisabledReason}
            errorMessage={lastError}
            busy={busy}
            onAuth={handleAuth}
            onClose={closeAccountMenu}
          />
        ) : createPortal(
          <div
            className="fixed inset-0 z-[120] flex items-end justify-center bg-slate-900/60 p-0 sm:items-center sm:p-4"
            onClick={closeAccountMenu}
          >
            <AccountAuthPanel
              authMode={authMode}
              setAuthMode={setAuthMode}
              form={form}
              updateField={updateField}
              showSecurityPassword={showSecurityPassword}
              setShowSecurityPassword={setShowSecurityPassword}
              authDisabledReason={authDisabledReason}
              errorMessage={lastError}
              busy={busy}
              onAuth={handleAuth}
              onClose={closeAccountMenu}
            />
          </div>,
          document.body
        )
      ) : null}
    </div>
  );
}
