import React from 'react';
import { createRoot } from 'react-dom/client';
import { ScreenPage } from './pages/ScreenPage.jsx';
import { AppEntryAdGate } from './components/monetization.jsx';
import { RegionSwitchBanner } from './components/region-switch-banner.jsx';
import { initPostHog } from './app/posthog.js';
import { registerAssetCacheWhenIdle } from './app/assetCacheRegistration.js';
import { bootstrapRemoteStorage } from './app/remoteStorage.js';
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

function renderRemoteDataUnavailable(error) {
  const message = error?.message || '远端数据服务暂时不可用';
  createRoot(document.getElementById('root')).render(
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6 text-slate-900">
      <section className="w-full max-w-md rounded-2xl border border-red-100 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-bold">远端数据加载失败</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">为了避免把失败误判为空账户，页面没有覆盖或清空本机数据。请检查网络后重试。</p>
        <p className="mt-3 break-words rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{message}</p>
        <button type="button" className="mt-5 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white" onClick={() => window.location.reload()}>重新加载</button>
      </section>
    </main>
  );
}

function renderApp() {
  const inPagesDir = /\/pages(?:-v2)?\//.test(window.location.pathname);
  createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <RegionSwitchBanner />
      <AppEntryAdGate>
        <ScreenPage inPagesDir={inPagesDir} />
      </AppEntryAdGate>
    </React.StrictMode>
  );

  startPostHogWhenIdle();
  startNotifyRealtimeWhenIdle();
  loadAdsScriptWhenIdle();
  registerAssetCacheWhenIdle(runWhenIdle);
}

async function boot() {
  try {
    await bootstrapRemoteStorage();
    renderApp();
  } catch (error) {
    renderRemoteDataUnavailable(error);
  }
}

void boot();
