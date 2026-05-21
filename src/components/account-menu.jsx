import { useEffect, useState } from 'react';
import { Loader2, LogOut, UserRound } from 'lucide-react';
import { clearCloudSession, CLOUD_SYNC_SESSION_EVENT, loadCloudSession, loginCloudAccount, registerCloudAccount } from '../app/authClient.js';
import { showToast } from '../app/toast.js';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover.jsx';
import { cx, inputClass, primaryButtonClass, secondaryButtonClass, subtleButtonClass } from './experience-ui.jsx';

export function AccountMenu() {
  const [session, setSession] = useState(() => loadCloudSession());
  const [form, setForm] = useState({ username: '', password: '' });
  const [busy, setBusy] = useState('');

  useEffect(() => {
    function syncSession(event) {
      setSession(event?.detail?.session || loadCloudSession());
    }
    function syncStorage(event) {
      if (event.key === 'aiDcaCloudSyncSession') setSession(loadCloudSession());
    }
    window.addEventListener(CLOUD_SYNC_SESSION_EVENT, syncSession);
    window.addEventListener('storage', syncStorage);
    return () => {
      window.removeEventListener(CLOUD_SYNC_SESSION_EVENT, syncSession);
      window.removeEventListener('storage', syncStorage);
    };
  }, []);

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
      showToast({ title: action === 'register' ? '账户已注册' : '已登录', description: nextSession?.username || '', tone: 'emerald' });
    } catch (err) {
      showToast({ title: action === 'register' ? '注册失败' : '登录失败', description: err?.message || String(err), tone: 'red' });
    } finally {
      setBusy('');
    }
  }

  function handleLogout() {
    clearCloudSession();
    setSession(null);
    showToast({ title: '已退出账户', tone: 'slate' });
  }

  const authDisabledReason = busy
    ? '处理中'
    : !form.username
    ? '填写用户名'
    : !form.password
    ? '填写登录密码'
    : '';
  const loggedIn = Boolean(session?.accessToken);
  const initial = loggedIn ? String(session.username || '?').slice(0, 1).toUpperCase() : '';

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
                <div className="text-xs text-slate-500">账户同步已启用</div>
              </div>
            </div>
            <button type="button" className={cx(subtleButtonClass, 'w-full justify-center')} onClick={handleLogout}>
              <LogOut className="h-4 w-4" />
              退出登录
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <div className="text-sm font-bold text-slate-900">账户登录</div>
              <div className="mt-1 text-xs text-slate-500">登录后自动保存加密备份</div>
            </div>
            <label className="block space-y-1.5 text-xs font-semibold text-slate-600">
              用户名
              <input className={inputClass} value={form.username} onChange={(event) => updateField('username', event.target.value)} autoComplete="username" spellCheck="false" />
            </label>
            <label className="block space-y-1.5 text-xs font-semibold text-slate-600">
              登录密码
              <input className={inputClass} type="password" value={form.password} onChange={(event) => updateField('password', event.target.value)} autoComplete="current-password" />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className={cx(primaryButtonClass, 'justify-center')} onClick={() => handleAuth('login')} disabled={Boolean(authDisabledReason)} title={authDisabledReason || undefined}>
                {busy === 'login' ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserRound className="h-4 w-4" />}
                登录
              </button>
              <button type="button" className={cx(secondaryButtonClass, 'justify-center')} onClick={() => handleAuth('register')} disabled={Boolean(authDisabledReason)} title={authDisabledReason || undefined}>
                {busy === 'register' ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserRound className="h-4 w-4" />}
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
