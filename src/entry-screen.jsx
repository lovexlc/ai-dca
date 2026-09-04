import React from 'react';
import { createRoot } from 'react-dom/client';
import { ScreenPage } from './pages/ScreenPage.jsx';
import { BetaSwitchBanner } from './components/beta-switch-banner.jsx';
import { detectBetaState } from './app/betaEnvironment.js';
import { initPostHog } from './app/posthog.js';
import { registerAssetCacheWhenIdle } from './app/assetCacheRegistration.js';
import { installPreloadErrorRecovery } from './app/preloadErrorRecovery.js';
import './styles/app.css';

installPreloadErrorRecovery();

function markRuntimeEnvironment() {
  const hostname = String(window.location.hostname || '').toLowerCase();
  document.documentElement.dataset.environment = hostname === 'test.freebacktrack.tech' || hostname.startsWith('test.')
    ? 'test'
    : 'production';
}

markRuntimeEnvironment();

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
        window.dispatchEvent(new CustomEvent('ai-dca-notify-ws-ready'));
      }
    } catch {
      // 通知是辅助功能，启动失败不影响主页面
    }
  }, { timeout: 2500, delayMs: 30000 });
}

const inPagesDir = /\/pages(?:-v2)?\//.test(window.location.pathname);
const betaState = detectBetaState();

// beta 走独立外壳，按需加载；关闭时正式版渲染路径与之前完全一致。
const BetaApp = React.lazy(() => import('./beta/BetaApp.jsx'));

function AppRoot() {
  if (betaState.enabled) {
    return (
      <React.Suspense fallback={<div className="px-4 py-6 text-sm text-slate-500">正在载入 beta 版…</div>}>
        <BetaApp />
      </React.Suspense>
    );
  }
  return (
    <>
      {betaState.canSwitch ? <BetaSwitchBanner /> : null}
      <ScreenPage inPagesDir={inPagesDir} />
    </>
  );
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppRoot />
  </React.StrictMode>
);

startPostHogWhenIdle();
startNotifyRealtimeWhenIdle();
registerAssetCacheWhenIdle(runWhenIdle);
