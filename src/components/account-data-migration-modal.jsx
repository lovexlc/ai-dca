import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Database,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Trash2,
  X
} from 'lucide-react';
import { CLOUD_SYNC_SESSION_EVENT, loadCloudSession } from '../app/authSession.js';
import {
  ACCOUNT_MIGRATION_EVENT,
  inspectLegacyMigration,
  runLegacyMigration
} from '../app/legacyMigration.js';
import {
  discardRemoteAndLocalAccountData,
  hasSeenAccountDataNotice,
  markAccountDataNoticeSeen
} from '../app/accountDataMigrationActions.js';
import { startCloudAutoSync } from '../app/cloudSync.js';
import { cx, inputClass } from './experience-ui.jsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle
} from '@/components/ui/dialog';

const SETTLED_STATUSES = new Set(['imported', 'skipped', 'no-legacy']);
const DELETE_CONFIRMATION_TEXT = '删除全部数据';

export function isCnMigrationNoticeHost(location = globalThis.location) {
  const hostname = String(location?.hostname || '').trim().toLowerCase();
  return hostname === 'cn.freebacktrack.tech'
    || hostname === 'localhost'
    || hostname === '127.0.0.1'
    || Boolean(globalThis.window?.__AI_DCA_FORCE_MIGRATION_NOTICE__);
}

function formatDate(value = '') {
  if (!value) return '时间未知';
  try {
    return new Date(value).toLocaleString('zh-CN', { hour12: false });
  } catch {
    return value;
  }
}

function isSettled(status = '') {
  return SETTLED_STATUSES.has(String(status || '').trim().toLowerCase());
}

function ChoiceCard({ active, danger = false, icon: Icon, title, description, onClick }) {
  return (
    <button
      type="button"
      className={cx(
        'relative flex w-full items-start gap-3 rounded-2xl border p-4 text-left transition-all focus:outline-none focus:ring-2 focus:ring-offset-2',
        active && !danger && 'border-indigo-500 bg-indigo-50/70 shadow-sm focus:ring-indigo-500',
        active && danger && 'border-red-400 bg-red-50/80 shadow-sm focus:ring-red-500',
        !active && 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 focus:ring-slate-400'
      )}
      onClick={onClick}
      aria-pressed={active}
    >
      <span className={cx(
        'flex h-10 w-10 flex-none items-center justify-center rounded-xl',
        danger ? 'bg-red-100 text-red-600' : 'bg-indigo-100 text-indigo-700'
      )}>
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-sm font-bold text-slate-950">
          {title}
          {active ? (
            <span className={cx(
              'inline-flex h-5 w-5 items-center justify-center rounded-full text-white',
              danger ? 'bg-red-500' : 'bg-indigo-600'
            )}>
              <Check className="h-3 w-3" aria-hidden="true" />
            </span>
          ) : null}
        </span>
        <span className="mt-1 block text-xs leading-5 text-slate-500">{description}</span>
      </span>
    </button>
  );
}

export function AccountDataMigrationModal() {
  const [session, setSession] = useState(() => loadCloudSession());
  const [migration, setMigration] = useState(null);
  const [phase, setPhase] = useState('idle');
  const [mode, setMode] = useState('migrate');
  const [securityPassword, setSecurityPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [outcome, setOutcome] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  const refresh = useCallback(async (nextSession = loadCloudSession()) => {
    if (!isCnMigrationNoticeHost() || !nextSession?.accessToken) {
      setMigration(null);
      setPhase('idle');
      return;
    }
    setPhase('loading');
    setErrorMessage('');
    try {
      const status = await inspectLegacyMigration(nextSession);
      setMigration(status);
      setMode(status?.needsMigration ? 'migrate' : 'keep');
      setPhase('ready');
    } catch (error) {
      setErrorMessage(error?.message || '暂时无法读取旧数据状态，请检查网络后重试。');
      setPhase('error');
    }
  }, []);

  useEffect(() => {
    function handleSessionChange(event) {
      const nextSession = event?.detail?.session || loadCloudSession();
      setSession(nextSession);
      setDismissed(false);
      setOutcome(null);
      void refresh(nextSession);
    }
    window.addEventListener(CLOUD_SYNC_SESSION_EVENT, handleSessionChange);
    return () => window.removeEventListener(CLOUD_SYNC_SESSION_EVENT, handleSessionChange);
  }, [refresh]);

  useEffect(() => {
    void refresh(session);
  }, [refresh, session?.accessToken, session?.userId, session?.username]);

  useEffect(() => {
    function handleMigrationChange() {
      if (!outcome) void refresh(loadCloudSession());
    }
    window.addEventListener(ACCOUNT_MIGRATION_EVENT, handleMigrationChange);
    return () => window.removeEventListener(ACCOUNT_MIGRATION_EVENT, handleMigrationChange);
  }, [outcome, refresh]);

  const statusName = String(migration?.status || '').trim().toLowerCase();
  const migrationPending = Boolean(migration?.needsMigration);
  const importedAlready = statusName === 'imported';
  const noLegacy = statusName === 'no-legacy';
  const noticeSeen = useMemo(() => hasSeenAccountDataNotice(session), [session, migration, dismissed]);
  const showSettledNotice = isSettled(statusName) && statusName !== 'skipped' && !noticeSeen;
  const open = Boolean(
    isCnMigrationNoticeHost()
    && session?.accessToken
    && !dismissed
    && (phase === 'error' || migrationPending || showSettledNotice || outcome)
  );
  const needsPassword = migrationPending && Boolean(migration?.needsSecurityPassword);
  const needsOriginalDevice = migrationPending && Boolean(migration?.needsOriginalDevice);
  const canMigrate = migrationPending && Boolean(migration?.canMigrateHere);
  const deleteConfirmed = deleteConfirmation.trim() === DELETE_CONFIRMATION_TEXT;
  const busy = phase === 'migrating' || phase === 'deleting';

  const remoteSummary = migration?.legacy?.exists
    ? `${Number(migration.legacy.keyCount || 0)} 项旧数据 · ${formatDate(migration.legacy.updatedAt)}`
    : '未检测到需要解密的旧云端数据';

  function closeNotice() {
    if (migrationPending || busy) return;
    markAccountDataNoticeSeen(session);
    setDismissed(true);
  }

  async function handleMigrate() {
    if (!migrationPending) {
      closeNotice();
      return;
    }
    if (!canMigrate) return;
    if (needsPassword && securityPassword.length < 8) {
      setErrorMessage('请输入至少 8 位的旧版数据安全密码。');
      return;
    }
    setPhase('migrating');
    setErrorMessage('');
    try {
      const result = await runLegacyMigration({
        securityPassword,
        useRemembered: true,
        overwrite: false
      });
      if (!['imported', 'no-legacy'].includes(String(result?.status || ''))) {
        throw new Error('旧数据中没有可迁移内容。如需继续，请选择清空数据。');
      }
      markAccountDataNoticeSeen(session);
      startCloudAutoSync();
      setOutcome({
        type: 'migrated',
        title: '数据迁移完成',
        description: `已迁移 ${Number(result?.imported?.length || result?.localState?.importedCount || 0)} 个功能数据集。重新加载后即可继续使用。`
      });
      setPhase('success');
    } catch (error) {
      setErrorMessage(error?.message || '数据迁移失败，请核对安全密码后重试。');
      setPhase('ready');
    }
  }

  async function handleDelete() {
    if (!deleteConfirmed) {
      setErrorMessage(`请输入“${DELETE_CONFIRMATION_TEXT}”以确认不可恢复的删除。`);
      return;
    }
    setPhase('deleting');
    setErrorMessage('');
    try {
      await discardRemoteAndLocalAccountData(session);
      startCloudAutoSync();
      setOutcome({
        type: 'deleted',
        title: '账号数据已清空',
        description: '旧云端密文、新同步数据与本机业务数据均已删除。你的登录账户仍然保留。'
      });
      setPhase('success');
    } catch (error) {
      setErrorMessage(error?.message || '删除未完成，请重试；在成功前不会清除本机数据。');
      setPhase('ready');
    }
  }

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) closeNotice(); }}>
      <DialogContent
        className="max-h-[92vh] w-[calc(100%-1.5rem)] max-w-2xl overflow-hidden border-0 bg-white p-0 shadow-2xl sm:max-h-[88vh] sm:rounded-3xl"
        showCloseButton={false}
        onPointerDownOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => {
          if (migrationPending || busy) event.preventDefault();
          else closeNotice();
        }}
      >
        {outcome ? (
          <div className="px-6 py-8 text-center sm:px-10 sm:py-10">
            <span className={cx(
              'mx-auto flex h-16 w-16 items-center justify-center rounded-2xl',
              outcome.type === 'deleted' ? 'bg-slate-100 text-slate-700' : 'bg-emerald-100 text-emerald-700'
            )}>
              {outcome.type === 'deleted'
                ? <Trash2 className="h-8 w-8" aria-hidden="true" />
                : <CheckCircle2 className="h-8 w-8" aria-hidden="true" />}
            </span>
            <DialogTitle className="mt-5 text-2xl font-bold text-slate-950">{outcome.title}</DialogTitle>
            <DialogDescription className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
              {outcome.description}
            </DialogDescription>
            <button
              type="button"
              className="mt-7 inline-flex h-11 items-center justify-center rounded-xl bg-slate-950 px-5 text-sm font-bold text-white transition-colors hover:bg-slate-800"
              onClick={() => window.location.reload()}
            >
              重新加载并继续
            </button>
          </div>
        ) : (
          <>
            <div className="relative overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 px-5 pb-6 pt-5 text-white sm:px-7 sm:pb-7 sm:pt-6">
              <div className="absolute -right-12 -top-16 h-48 w-48 rounded-full bg-indigo-500/20 blur-3xl" />
              {!migrationPending && !busy ? (
                <button
                  type="button"
                  className="absolute right-4 top-4 z-10 inline-flex h-9 w-9 items-center justify-center rounded-full text-white/60 transition hover:bg-white/10 hover:text-white"
                  onClick={closeNotice}
                  aria-label="关闭数据安全更新提醒"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              ) : null}
              <div className="relative flex items-start gap-4 pr-10">
                <span className="flex h-11 w-11 flex-none items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/15">
                  <ShieldCheck className="h-6 w-6 text-indigo-200" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <div className="text-xs font-bold tracking-[0.18em] text-indigo-200">数据安全更新</div>
                  <DialogTitle className="mt-2 text-xl font-bold leading-tight text-white sm:text-2xl">
                    {migrationPending ? '请先处理旧版加密数据' : '账号同步方式已升级'}
                  </DialogTitle>
                  <DialogDescription className="mt-2 text-sm leading-6 text-slate-300">
                    为减少整包加密同步带来的冲突与数据异常，cn 站已改为按功能拆分同步。
                  </DialogDescription>
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7 sm:py-6">
              {phase === 'loading' ? (
                <div className="flex min-h-52 flex-col items-center justify-center text-center">
                  <Loader2 className="h-7 w-7 animate-spin text-indigo-600" aria-hidden="true" />
                  <div className="mt-3 text-sm font-semibold text-slate-700">正在检查账号数据…</div>
                </div>
              ) : phase === 'error' && !migration ? (
                <div className="flex min-h-52 flex-col items-center justify-center text-center">
                  <AlertTriangle className="h-8 w-8 text-amber-500" aria-hidden="true" />
                  <div className="mt-3 text-sm font-bold text-slate-900">暂时无法读取迁移状态</div>
                  <div className="mt-1 max-w-sm text-xs leading-5 text-slate-500">{errorMessage}</div>
                  <button
                    type="button"
                    className="mt-5 inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    onClick={() => void refresh(session)}
                  >
                    <RefreshCw className="h-4 w-4" aria-hidden="true" />
                    重新检查
                  </button>
                </div>
              ) : (
                <div className="space-y-5">
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3.5">
                    <div className="flex items-start gap-3">
                      <LockKeyhole className="mt-0.5 h-5 w-5 flex-none text-amber-700" aria-hidden="true" />
                      <div>
                        <div className="text-sm font-bold text-amber-950">这项变化意味着什么？</div>
                        <p className="mt-1 text-xs leading-5 text-amber-900/80">
                          迁移后的账号数据不再由安全密码进行端到端强加密，服务端会按功能保存可读取的数据。传输仍使用 HTTPS，访问仍受账户登录保护。
                        </p>
                        <p className="mt-2 text-xs font-semibold leading-5 text-amber-950">
                          请勿保存证件号、银行卡号、账户密码等高度敏感信息；如果旧数据包含此类内容，请选择清空。
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <Database className="h-5 w-5 flex-none text-slate-500" aria-hidden="true" />
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-slate-800">旧版云端数据</div>
                      <div className="mt-0.5 text-xs leading-5 text-slate-500">{remoteSummary}</div>
                    </div>
                  </div>

                  {migrationPending || importedAlready ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <ChoiceCard
                        active={mode !== 'delete'}
                        icon={migrationPending ? KeyRound : CheckCircle2}
                        title={migrationPending ? '迁移并继续使用' : '保留现有数据'}
                        description={migrationPending
                          ? '在当前浏览器解密旧数据，再写入新的按功能同步系统。'
                          : '数据已进入新的同步系统，确认了解安全方式变化后继续使用。'}
                        onClick={() => { setMode(migrationPending ? 'migrate' : 'keep'); setErrorMessage(''); }}
                      />
                      <ChoiceCard
                        active={mode === 'delete'}
                        danger
                        icon={Trash2}
                        title="不迁移，清空数据"
                        description="永久删除旧云端密文、新同步数据及本机业务数据，不保留副本。"
                        onClick={() => { setMode('delete'); setErrorMessage(''); }}
                      />
                    </div>
                  ) : null}

                  {mode === 'migrate' && migrationPending ? (
                    <div className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4">
                      {needsOriginalDevice ? (
                        <div className="flex items-start gap-3 text-xs leading-5 text-indigo-900">
                          <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />
                          <span>这份备份由原设备密钥加密，当前设备无法用密码解密。请在原设备完成迁移，或选择清空数据。</span>
                        </div>
                      ) : (
                        <>
                          <div className="text-sm font-bold text-slate-900">
                            {needsPassword ? '输入旧版数据安全密码' : '使用本设备保存的密钥迁移'}
                          </div>
                          <p className="mt-1 text-xs leading-5 text-slate-500">
                            解密只在当前浏览器内完成，安全密码不会上传服务器。
                          </p>
                          {needsPassword ? (
                            <label className="mt-3 block text-xs font-semibold text-slate-700">
                              数据安全密码
                              <div className="relative mt-1.5">
                                <input
                                  className={cx(inputClass, 'h-11 pr-11')}
                                  type={showPassword ? 'text' : 'password'}
                                  value={securityPassword}
                                  onChange={(event) => setSecurityPassword(event.target.value)}
                                  autoComplete="off"
                                  placeholder="输入原安全密码（至少 8 位）"
                                  autoFocus
                                />
                                <button
                                  type="button"
                                  className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 hover:bg-white hover:text-slate-700"
                                  onClick={() => setShowPassword((current) => !current)}
                                  aria-label={showPassword ? '隐藏安全密码' : '显示安全密码'}
                                >
                                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                </button>
                              </div>
                            </label>
                          ) : null}
                        </>
                      )}
                    </div>
                  ) : null}

                  {mode === 'delete' ? (
                    <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
                      <div className="flex items-start gap-3">
                        <AlertTriangle className="mt-0.5 h-5 w-5 flex-none text-red-600" aria-hidden="true" />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-bold text-red-950">此操作不可恢复</div>
                          <p className="mt-1 text-xs leading-5 text-red-800">
                            将清除该账号的旧云端密文、已迁移资源、历史版本，以及当前浏览器中的业务数据。登录账户本身不会删除。
                          </p>
                          <label className="mt-3 block text-xs font-semibold text-red-900">
                            输入“{DELETE_CONFIRMATION_TEXT}”确认
                            <input
                              className={cx(inputClass, 'mt-1.5 h-11 border-red-200 bg-white focus:border-red-400 focus:ring-red-200')}
                              value={deleteConfirmation}
                              onChange={(event) => setDeleteConfirmation(event.target.value)}
                              autoComplete="off"
                              placeholder={DELETE_CONFIRMATION_TEXT}
                            />
                          </label>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {noLegacy ? (
                    <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs leading-5 text-emerald-900">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />
                      <span>当前账号没有需要迁移的旧版加密数据，只需确认已了解新的同步方式。</span>
                    </div>
                  ) : null}

                  {errorMessage ? (
                    <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs leading-5 text-red-700" role="alert">
                      {errorMessage}
                    </div>
                  ) : null}
                </div>
              )}
            </div>

            {phase !== 'loading' && !(phase === 'error' && !migration) ? (
              <div className="flex flex-col-reverse gap-2 border-t border-slate-200 bg-slate-50/80 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
                <div className="text-[11px] leading-5 text-slate-400">
                  {migrationPending ? '完成迁移或清空后才能继续账号同步。' : '此提醒仅在当前账号首次显示。'}
                </div>
                {mode === 'delete' ? (
                  <button
                    type="button"
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-red-600 px-5 text-sm font-bold text-white transition-colors hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => void handleDelete()}
                    disabled={!deleteConfirmed || busy}
                  >
                    {phase === 'deleting' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    {phase === 'deleting' ? '正在清空…' : '永久删除全部数据'}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 text-sm font-bold text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => void handleMigrate()}
                    disabled={busy || (migrationPending && (!canMigrate || (needsPassword && securityPassword.length < 8)))}
                  >
                    {phase === 'migrating'
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : migrationPending ? <KeyRound className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                    {phase === 'migrating' ? '正在迁移…' : migrationPending ? '开始安全迁移' : '我已了解，继续使用'}
                  </button>
                )}
              </div>
            ) : null}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
