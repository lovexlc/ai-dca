import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ScreenPage } from './pages/ScreenPage.jsx';
import { AppEntryAdGate } from './components/monetization.jsx';
import { initPostHog } from './app/posthog.js';
import { registerAssetCacheWhenIdle } from './app/assetCacheRegistration.js';
import { USER_DATA_HYDRATION_EVENT, userDataStore } from './app/userDataStore.js';
import { clearCloudSession, loadCloudSession } from './app/authSession.js';
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

function startNotifyRealtimeWhenIdle() {
  runWhenIdle(async () => {
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
  }, { timeout: 2500, delayMs: 30000 });
}

function UserDataHydrationGate({ children }) {
  const [state, setState] = useState(() => ({
    status: 'loading',
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
    window.addEventListener(USER_DATA_HYDRATION_EVENT, handleHydrationProgress);
    if (!session?.accessToken) {
      setState({ status: 'ready', error: null, summary: null, session: null });
      return () => {
        cancelled = true;
        window.removeEventListener(USER_DATA_HYDRATION_EVENT, handleHydrationProgress);
      };
    }
    userDataStore.startSession(session, { action: 'login', securityPassword: '', rememberDevice: true })
      .then(() => {
        if (!cancelled) setState({ status: 'ready', error: null, summary: null, session });
      })
      .catch((error) => {
        if (cancelled) return;
        if (error?.code === 'LOCAL_DATA_DECISION_REQUIRED') {
          setState((current) => ({ ...current, status: 'decision', error: null, summary: error.summary || {}, session }));
        } else {
          setState((current) => ({ ...current, status: 'error', error, summary: null, session }));
        }
      });
    return () => {
      cancelled = true;
      window.removeEventListener(USER_DATA_HYDRATION_EVENT, handleHydrationProgress);
    };
  }, []);

  async function resolveDecision(decision) {
    if (decision === 'cancel') {
      clearCloudSession();
      userDataStore.setAnonymous();
      setState({ status: 'ready', error: null, summary: null, session: null });
      return;
    }
    setState((current) => ({ ...current, status: 'loading', error: null }));
    try {
      await userDataStore.startSession(state.session, { action: 'login', securityPassword: '', rememberDevice: true, decision });
      setState((current) => ({ ...current, status: 'ready' }));
    } catch (error) {
      setState((current) => ({ ...current, status: 'decision', error }));
    }
  }

  async function retryWithSecurityPassword() {
    if (!state.session || !securityPassword) return;
    setState((current) => ({ ...current, status: 'loading', error: null }));
    try {
      await userDataStore.startSession(state.session, { action: 'login', securityPassword, rememberDevice: true });
      setState((current) => ({ ...current, status: 'ready', error: null }));
    } catch (error) {
      if (error?.code === 'LOCAL_DATA_DECISION_REQUIRED') setState((current) => ({ ...current, status: 'decision', error: null, summary: error.summary || {} }));
      else setState((current) => ({ ...current, status: 'error', error }));
    }
  }

  if (state.status === 'ready') return children;
  const summary = state.summary || {};
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 text-slate-900">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        {state.status === 'decision' ? (
          <>
            <h1 className="text-base font-bold">发现本机未归属数据</h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">本机有 {summary.localKeys?.length || 0} 项数据，云端有 {summary.remoteKeys?.length || 0} 项数据。完成选择后才会显示业务页面。</p>
            {state.error ? <p className="mt-2 text-xs text-rose-600">{state.error.message}</p> : null}
            <div className="mt-5 grid gap-2">
              {!summary.foreignOwner ? <button type="button" className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white" onClick={() => resolveDecision('merge')}>合并本机数据到账号</button> : <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">检测到本机数据属于其它账号，不能导入到当前账号。</div>}
              <button type="button" className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold" onClick={() => resolveDecision('cloud')}>仅使用云端并清除本机数据</button>
              <button type="button" className="rounded-xl px-4 py-2 text-sm text-slate-600" onClick={() => resolveDecision('cancel')}>取消登录并保留本机数据</button>
            </div>
          </>
        ) : (
          <>
            <h1 className="text-base font-bold">正在恢复账户数据</h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">正在确认身份、解锁并读取云端数据，完成前不会挂载持仓、计划和通知页面。</p>
            <div className="mt-5" aria-live="polite">
              <div className="mb-2 flex items-center justify-between gap-3 text-xs font-semibold text-slate-600">
                <span>{state.hydration?.message || '正在恢复云端数据…'}</span>
                <span className="shrink-0 tabular-nums text-indigo-700">{Math.round(Math.min(Math.max(Number(state.hydration?.progress) || 0, 0), 100))}%</span>
              </div>
              <div
                className="h-2 overflow-hidden rounded-full bg-slate-100"
                role="progressbar"
                aria-label="云端数据恢复进度"
                aria-valuemin="0"
                aria-valuemax="100"
                aria-valuenow={Math.round(Math.min(Math.max(Number(state.hydration?.progress) || 0, 0), 100))}
                aria-valuetext={state.hydration?.message || '正在恢复云端数据'}
              >
                <div
                  className="h-full rounded-full bg-indigo-500 transition-all duration-500 ease-out"
                  style={{ width: `${Math.min(Math.max(Number(state.hydration?.progress) || 0, 0), 100)}%` }}
                />
              </div>
              {state.hydration?.total > 0 ? (
                <p className="mt-2 text-xs text-slate-500">已处理 {state.hydration.current || 0}/{state.hydration.total} 项数据</p>
              ) : (
                <p className="mt-2 text-xs text-slate-500">正在准备数据，请保持页面打开…</p>
              )}
            </div>
            {state.error ? <p className="mt-3 text-xs text-rose-600">{state.error.message || '云端数据暂时不可用。'}</p> : null}
            {['WRONG_PASSWORD', 'NEED_DEVICE_KEY', 'SECURITY_PASSWORD_REQUIRED'].includes(state.error?.code) ? (
              <div className="mt-4 space-y-2">
                <input type="password" value={securityPassword} onChange={(event) => setSecurityPassword(event.target.value)} placeholder="安全密码" className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" autoComplete="off" />
                <button type="button" className="w-full rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white" onClick={retryWithSecurityPassword} disabled={!securityPassword}>使用安全密码重试</button>
              </div>
            ) : null}
            {state.status === 'error' ? <button type="button" className="mt-5 w-full rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold" onClick={() => { clearCloudSession(); userDataStore.setAnonymous(); setState({ status: 'ready', error: null, summary: null, session: null }); }}>退出账户并继续匿名使用</button> : null}
          </>
        )}
      </div>
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
