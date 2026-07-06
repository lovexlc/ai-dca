import React from 'react';
import { createRoot } from 'react-dom/client';
import { ScreenPage } from './pages/ScreenPage.jsx';
import { AppEntryAdGate } from './components/monetization.jsx';
import { initPostHog } from './app/posthog.js';
import { registerAssetCacheWhenIdle } from './app/assetCacheRegistration.js';
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

const inPagesDir = /\/pages(?:-v2)?\//.test(window.location.pathname);

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppEntryAdGate>
      <ScreenPage inPagesDir={inPagesDir} />
    </AppEntryAdGate>
  </React.StrictMode>
);

startPostHogWhenIdle();
startNotifyRealtimeWhenIdle();
loadAdsScriptWhenIdle();
registerAssetCacheWhenIdle(runWhenIdle);
