import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ScreenPage } from './pages/ScreenPage.jsx';
import { AppEntryAdGate } from './components/monetization.jsx';
import { initPostHog } from './app/posthog.js';
import { registerAssetCacheWhenIdle } from './app/assetCacheRegistration.js';
import { USER_DATA_HYDRATION_EVENT, USER_DATA_MODE_EVENT, userDataStore } from './app/userDataStore.js';
import { clearCloudSession, loadCloudSession } from './app/authSession.js';
import { AlertTriangle, CloudOff, RefreshCw } from 'lucide-react';
import { clampHydrationProgress, CloudRestoreLoadingCard, RestoreCard, RestoreIcon } from './components/cloud-restore-ui.jsx';
import './styles/app.css';

function runWhenIdle(callback, { timeout = 2500, delayMs = 0 } = {}) {
  if (typeof window === 'undefined') return;
  const scheduleIdle = () => {
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(callback, { timeout });
      return;
    }
    window.setTimeout(callback, Math.min(timeout, 1200));
  };
  if (delayMs > 0) {
    window.setTimeout(scheduleIdle, delayMs);
  } else {
    scheduleIdle();
  }
}

function loadAdsScriptWhenIdle() {
  runWhenIdle(() => {
    if (document.querySelector('script[data-ai-dca-ads="adsense"]')) return;
    const script = document.createElement('script');
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.dataset.aiDcaAds = 'adsense';
    script.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1376743188081698';
    document.head.appendChild(script);
  }, { timeout: 4500, delayMs: 45000 });
}

function startPostHogWhenIdle() {
  runWhenIdle(() => {
    initPostHog();
  }, { timeout: 3500, delayMs: 30000 });
}

function startNotifyRealtimeWhenIdle({ delayMs = 30000 } = {}) {
  runWhenIdle(async () => {
    const cloudSession = loadCloudSession();
    if (cloudSession?.accessToken && !userDataStore.isAuthenticated()) {
      const retry = (event) => {
        if (event.detail?.mode !== 'remote') return;
        if (event.detail?.offline) return;
        window.removeEventListener(USER_DATA_MODE_EVENT, retry);
        startNotifyRealtimeWhenIdle({ delayMs: 0 });
      };
      window.addEventListener(USER_DATA_MODE_EVENT, retry);
      return;
    }
    try {
      const [{ readNotifyAccountUsername, readNotifyClientConfig }, { startNotifyRealtime }] = await Promise.all([
        import('./app/notifySync.js'),
        import('./app/notifyWsClient.js')
      ]);
      const notifyConfig = readNotifyClientConfig();
      if (!notifyConfig?.notifyClientId || !notifyConfig?.notifyClientSecret) return;

      // dev HMR / 多次脚本执行时避免重复实例
      if (typeof window !== 'undefined' && typeof window.__aiDcaDisconnectNotifyWs === 'function') {
        try { window.__aiDcaDisconnectNotifyWs(); } catch { /* ignore */ }
      }
      const realtimeOptions = {
        clientId: notifyConfig.notifyClientId,
        clientSecret: notifyConfig.notifyClientSecret,
        clientLabel: notifyConfig.notifyClientLabel,
        accountUsername: readNotifyAccountUsername(),
        debug: false,
        logLifecycle: true,
        onStatusChange: (status) => {
          if (typeof window !== 'undefined') {
            window.__aiDcaNotifyWsStatus = status;
            window.dispatchEvent(new CustomEvent('ai-dca-notify-ws-status', { detail: { status } }));
          }
        }
      };
      let realtimeClient = startNotifyRealtime(realtimeOptions);
      let marketDataStarted = false;
      const ensureMarketDataRealtime = () => {
        if (!marketDataStarted) {
          try { realtimeClient?.disconnect?.(); } catch { /* ignore */ }
          realtimeClient = startNotifyRealtime({ ...realtimeOptions, enableMarketData: true });
          marketDataStarted = true;
          if (typeof window !== 'undefined') {
            window.__aiDcaDisconnectNotifyWs = realtimeClient.disconnect;
          }
        }
        return realtimeClient;
      };
      if (typeof window !== 'undefined') {
        window.__aiDcaDisconnectNotifyWs = realtimeClient.disconnect;
        window.__aiDcaSubscribeMarketData = (symbols, options) => ensureMarketDataRealtime().subscribeMarketData(symbols, options);
      }
    } catch {
      // 通知是辅助功能，启动失败不影响主页面
    }
  }, { timeout: 2500, delayMs });
}

function canEnterOfflineMode(error) {
  const code = String(error?.code || error?.data?.code || '');
  // 认证、密码和迁移决策错误必须继续明确提示，不能用空缓存掩盖。
  if (['AUTH_REQUIRED', 'WRONG_PASSWORD', 'NEED_DEVICE_KEY', 'SECURITY_PASSWORD_REQUIRED', 'LOCAL_DATA_DECISION_REQUIRED', 'FOREIGN_LOCAL_DATA', 'MIGRATION_VERIFY_FAILED'].includes(code)) return false;
  if (code === 'OFFLINE' || code === 'RESOURCE_NOT_PROPAGATED' || code === 'LEGACY_SNAPSHOT_UNAVAILABLE') return true;
  if (Number(error?.status) >= 500 || Number(error?.status) === 408 || Number(error?.status) === 429) return true;
  if (error?.retryable === true) return true;
  const message = String(error?.message || '').toLowerCase();
  return error instanceof TypeError || /failed to fetch|network|网络|连接|超时|timeout|服务暂时不可用/.test(message);
}

function UserDataHydrationGate({ children }) {
  const [state, setState] = useState(() => ({
    status: 'loading',
    offline: false,
    error: null,
    summary: null,
    session: null,
    hydration: {
      stage: 'connecting',
      progress: 5,
      current: 0,
      total: 0,
      message: '正在确认账号并连接云端…'
    }
  }));
  const [securityPassword, setSecurityPassword] = useState('');

  useEffect(() => {
    let cancelled = false;
    const session = loadCloudSession();
    function handleHydrationProgress(event) {
      if (cancelled) return;
      const detail = event?.detail || {};
      if (detail.userId && session?.userId && String(detail.userId) !== String(session.userId)) return;
      setState((current) => ({
        ...current,
        hydration: {
          ...current.hydration,
          ...(detail.stage ? { stage: detail.stage } : {}),
          ...(typeof detail.progress === 'number' ? { progress: detail.progress } : {}),
          ...(typeof detail.current === 'number' ? { current: detail.current } : {}),
          ...(typeof detail.total === 'number' ? { total: detail.total } : {}),
          ...(detail.message ? { message: detail.message } : {})
        }
      }));
    }
    function handleUserDataMode(event) {
      const detail = event?.detail || {};
      if (detail.mode !== 'remote' || (detail.userId && session?.userId && String(detail.userId) !== String(session.userId))) return;
      setState((current) => ({
        ...current,
        ...(detail.offline ? { status: 'ready', offline: true, error: null, session } : { offline: false })
      }));
    }
    window.addEventListener(USER_DATA_HYDRATION_EVENT, handleHydrationProgress);
    window.addEventListener(USER_DATA_MODE_EVENT, handleUserDataMode);
    if (!session?.accessToken) {
      setState({ status: 'ready', offline: false, error: null, summary: null, session: null });
      return () => {
        cancelled = true;
        window.removeEventListener(USER_DATA_HYDRATION_EVENT, handleHydrationProgress);
        window.removeEventListener(USER_DATA_MODE_EVENT, handleUserDataMode);
      };
    }
    const runRemoteHydration = async ({ background = false } = {}) => {
      try {
        await userDataStore.startSession(session, { action: 'login', securityPassword: '', rememberDevice: true, background });
        if (!cancelled) setState({ status: 'ready', offline: false, error: null, summary: null, session });
      } catch (error) {
        if (cancelled) return;
        if (background) {
          // 已经挂载缓存后，后台同步失败不能再次把用户踢回同步页。
          try { await userDataStore.startOfflineSession(session, { reason: error?.code || 'NETWORK_ERROR' }); } catch { /* keep cached shell */ }
          if (!cancelled) setState((current) => ({ ...current, status: 'ready', offline: true, error: null, summary: null, session }));
        } else if (error?.code === 'LOCAL_DATA_DECISION_REQUIRED') {
          setState((current) => ({ ...current, status: 'decision', error: null, summary: error.summary || {}, session }));
        } else if (canEnterOfflineMode(error)) {
          try { await userDataStore.startOfflineSession(session, { reason: error?.code || 'NETWORK_ERROR' }); } catch { /* empty offline shell is still usable */ }
          if (!cancelled) setState((current) => ({ ...current, status: 'ready', offline: true, error, summary: null, session }));
        } else {
          setState((current) => ({ ...current, status: 'error', error, summary: null, session }));
        }
      }
    };
    const local = userDataStore.captureAnonymousSnapshot();
    const bootFromCache = async () => {
      if (local.keys.length) return false;
      try {
        const cached = await userDataStore.startOfflineSession(session, { reason: 'CACHE_BOOT', offline: false });
        if (!cached.cached || !cached.usable || cancelled) return false;
        setState((current) => ({
          ...current,
          status: 'ready',
          offline: false,
          error: null,
          summary: null,
          session,
          hydration: { ...current.hydration, stage: 'background-sync', progress: 100, message: '已显示最近数据，正在后台同步…' }
        }));
        void runRemoteHydration({ background: true });
        return true;
      } catch {
        return false;
      }
    };
    void bootFromCache().then((started) => {
      if (!started && !cancelled) void runRemoteHydration();
    });
    return () => {
      cancelled = true;
      window.removeEventListener(USER_DATA_HYDRATION_EVENT, handleHydrationProgress);
      window.removeEventListener(USER_DATA_MODE_EVENT, handleUserDataMode);
    };
  }, []);

  async function resolveDecision(decision) {
    if (decision === 'cancel') {
      clearCloudSession();
      userDataStore.setAnonymous();
      setState({ status: 'ready', error: null, summary: null, session: null });
      return;
    }
    setState((current) => ({
      ...current,
      status: 'loading',
      error: null,
      hydration: {
        ...current.hydration,
        stage: 'migration',
        progress: 80,
        message: '正在保存并恢复本机配置…'
      }
    }));
    try {
      await userDataStore.startSession(state.session, { action: 'login', securityPassword: '', rememberDevice: true, decision });
      setState((current) => ({ ...current, status: 'ready', offline: false }));
    } catch (error) {
      setState((current) => ({ ...current, status: 'decision', error }));
    }
  }

  async function retryWithSecurityPassword() {
    if (!state.session || !securityPassword) return;
    setState((current) => ({
      ...current,
      status: 'loading',
      error: null,
      hydration: {
        ...current.hydration,
        stage: 'connecting',
        progress: 5,
        current: 0,
        total: 0,
        message: '正在确认账号并连接云端…'
      }
    }));
    try {
      await userDataStore.startSession(state.session, { action: 'login', securityPassword, rememberDevice: true });
      setState((current) => ({ ...current, status: 'ready', offline: false, error: null }));
    } catch (error) {
      if (error?.code === 'LOCAL_DATA_DECISION_REQUIRED') setState((current) => ({ ...current, status: 'decision', error: null, summary: error.summary || {} }));
      else if (canEnterOfflineMode(error)) {
        try { await userDataStore.startOfflineSession(state.session, { reason: error?.code || 'NETWORK_ERROR' }); } catch { /* keep the shell usable even without cached data */ }
        setState((current) => ({ ...current, status: 'ready', offline: true, error, summary: null }));
      }
      else setState((current) => ({ ...current, status: 'error', error }));
    }
  }

  async function retryHydration() {
    if (!state.session) {
      window.location.reload();
      return;
    }
    if (['WRONG_PASSWORD', 'NEED_DEVICE_KEY', 'SECURITY_PASSWORD_REQUIRED'].includes(state.error?.code)) {
      await retryWithSecurityPassword();
      return;
    }
    setState((current) => ({
      ...current,
      status: 'loading',
      error: null,
      hydration: {
        ...current.hydration,
        stage: 'connecting',
        progress: 5,
        current: 0,
        total: 0,
        message: '正在确认账号并连接云端…'
      }
    }));
    try {
      await userDataStore.startSession(state.session, { action: 'login', securityPassword, rememberDevice: true });
      setState((current) => ({ ...current, status: 'ready', offline: false, error: null }));
    } catch (error) {
      if (error?.code === 'LOCAL_DATA_DECISION_REQUIRED') {
        setState((current) => ({ ...current, status: 'decision', error: null, summary: error.summary || {} }));
      } else if (canEnterOfflineMode(error)) {
        try { await userDataStore.startOfflineSession(state.session, { reason: error?.code || 'NETWORK_ERROR' }); } catch { /* keep the shell usable even without cached data */ }
        setState((current) => ({ ...current, status: 'ready', offline: true, error, summary: null }));
      } else {
        setState((current) => ({ ...current, status: 'error', error }));
      }
    }
  }

  async function openOfflineMode() {
    if (!state.session) {
      setState((current) => ({ ...current, status: 'ready', offline: true, error: null, summary: null }));
      return;
    }
    setState((current) => ({ ...current, status: 'loading', error: null, summary: null }));
    try {
      await userDataStore.startOfflineSession(state.session, { reason: 'USER_REQUESTED_OFFLINE' });
    } catch {
      // 即使没有可解密的缓存，也允许打开空的离线工作区。
    }
    setState((current) => ({ ...current, status: 'ready', offline: true, error: null, summary: null }));
  }

  if (state.status === 'ready') {
    return (
      <>
        {state.offline ? (
          <div className="fixed inset-x-0 top-0 z-[100] border-b border-amber-200 bg-amber-50/95 px-4 py-2 text-center text-xs text-amber-900 shadow-sm backdrop-blur">
            <span className="inline-flex items-center gap-1.5"><CloudOff className="h-3.5 w-3.5" />网络不可用，当前处于离线模式{userDataStore.snapshot().keys.length ? '，已恢复最近缓存' : ''}。离线修改只保留在当前页面。</span>
            <button type="button" className="ml-3 font-semibold underline underline-offset-2 hover:text-amber-700" onClick={retryHydration}>联网后重试同步</button>
          </div>
        ) : null}
        {children}
      </>
    );
  }
  const summary = state.summary || {};
  const isSyncingLocalData = state.status === 'loading' && state.hydration?.stage === 'migration';
  const progress = clampHydrationProgress(state.hydration?.progress);
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#fafafa] px-4 text-slate-900">
        {state.status === 'decision' ? (
          <RestoreCard>
            <RestoreIcon><AlertTriangle className="h-12 w-12" strokeWidth={1.5} /></RestoreIcon>
            <h1 className="text-center text-sm font-bold text-slate-900">发现本机未归属数据</h1>
            <p className="mt-3 text-center text-xs leading-5 text-slate-500">检测到本机数据与云端数据冲突，请选择处理方式。</p>
            {summary.foreignOwner ? <p className="mt-3 text-center text-xs leading-5 text-amber-700">本机数据属于其它账号，不能合并。</p> : null}
            <div className="mt-6 grid gap-2.5">
              {!summary.foreignOwner ? <button type="button" className="rounded-xl bg-violet-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-violet-700" onClick={() => resolveDecision('merge')}>合并到当前账户</button> : null}
              <button type="button" className="rounded-xl border border-violet-300 px-4 py-2.5 text-xs font-semibold text-violet-700 transition hover:bg-violet-50" onClick={() => resolveDecision('cloud')}>仅使用云端数据</button>
              <button type="button" className="rounded-xl px-4 py-1.5 text-xs text-slate-500 transition hover:text-slate-700" onClick={() => resolveDecision('cancel')}>取消登录并保留本机数据</button>
            </div>
          </RestoreCard>
        ) : (
          state.status === 'error' ? (
            <RestoreCard>
              <RestoreIcon><CloudOff className="h-12 w-12" strokeWidth={1.5} /></RestoreIcon>
              <h1 className="text-center text-sm font-bold text-slate-900">同步失败</h1>
              <p className="mt-3 text-center text-xs leading-5 text-slate-500">网络异常或数据保存失败，请重试。</p>
              {['WRONG_PASSWORD', 'NEED_DEVICE_KEY', 'SECURITY_PASSWORD_REQUIRED'].includes(state.error?.code) ? (
                <input type="password" value={securityPassword} onChange={(event) => setSecurityPassword(event.target.value)} placeholder="安全密码" className="mt-5 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100" autoComplete="off" />
              ) : null}
              <div className="mt-6 grid gap-2.5">
                <button type="button" className="rounded-xl bg-violet-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50" onClick={retryHydration} disabled={['WRONG_PASSWORD', 'NEED_DEVICE_KEY', 'SECURITY_PASSWORD_REQUIRED'].includes(state.error?.code) && !securityPassword}>重新同步</button>
                {state.session ? <button type="button" className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-xs font-semibold text-amber-800 transition hover:bg-amber-100" onClick={openOfflineMode}><CloudOff className="h-3.5 w-3.5" />进入离线模式</button> : null}
                <button type="button" className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-violet-300 px-4 py-2.5 text-xs font-semibold text-violet-700 transition hover:bg-violet-50" onClick={() => window.location.reload()}><RefreshCw className="h-3.5 w-3.5" />刷新</button>
              </div>
            </RestoreCard>
          ) : (
            <CloudRestoreLoadingCard syncingLocalData={isSyncingLocalData} hydration={{ ...state.hydration, progress }} onRetry={isSyncingLocalData ? retryHydration : undefined} />
          )
        )}
    </div>
  );
}

const inPagesDir = /\/pages(?:-v2)?\//.test(window.location.pathname);

// 匿名态明确使用原生 LocalStorage；登录态由账户水合流程切换到内存仓库。
userDataStore.setAnonymous();

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <UserDataHydrationGate>
      <AppEntryAdGate>
        <ScreenPage inPagesDir={inPagesDir} />
      </AppEntryAdGate>
    </UserDataHydrationGate>
  </React.StrictMode>
);

startPostHogWhenIdle();
startNotifyRealtimeWhenIdle();
loadAdsScriptWhenIdle();
registerAssetCacheWhenIdle(runWhenIdle);
