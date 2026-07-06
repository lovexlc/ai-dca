import React from 'react';
import { createRoot } from 'react-dom/client';
import { ScreenPage } from './pages/ScreenPage.jsx';
import { AppEntryAdGate } from './components/monetization.jsx';
import { initPostHog } from './app/posthog.js';
import './styles/app.css';

function runWhenIdle(callback, { timeout = 2500 } = {}) {
  if (typeof window === 'undefined') return;
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(callback, { timeout });
    return;
  }
  window.setTimeout(callback, Math.min(timeout, 1200));
}

const MARKET_WS_CLIENT_KEY = 'aiDca:marketWsClient:v1';

function randomId(prefix = '') {
  const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}${id}`;
}

function readOrCreateMarketWsClient() {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { clientId: randomId('market:'), clientSecret: randomId('secret:') };
  }
  try {
    const existing = JSON.parse(window.localStorage.getItem(MARKET_WS_CLIENT_KEY) || 'null');
    if (existing?.clientId && existing?.clientSecret) return existing;
    const next = {
      clientId: randomId('market:'),
      clientSecret: randomId('secret:'),
      clientLabel: 'Market realtime',
      createdAt: new Date().toISOString()
    };
    window.localStorage.setItem(MARKET_WS_CLIENT_KEY, JSON.stringify(next));
    return next;
  } catch {
    return { clientId: randomId('market:'), clientSecret: randomId('secret:') };
  }
}

function installMarketDataSubscribeBridge() {
  if (typeof window === 'undefined') return;
  if (!Array.isArray(window.__aiDcaMarketSubscribeQueue)) window.__aiDcaMarketSubscribeQueue = [];
  if (typeof window.__aiDcaSubscribeMarketData === 'function') return;
  window.__aiDcaSubscribeMarketData = (symbols, options) => {
    window.__aiDcaMarketSubscribeQueue.push({ symbols, options });
  };
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
  }, { timeout: 4500 });
}

function startPostHogWhenIdle() {
  runWhenIdle(() => {
    initPostHog();
  }, { timeout: 3500 });
}

function startNotifyRealtimeWhenIdle() {
  runWhenIdle(async () => {
    try {
      const [{ readNotifyAccountUsername, readNotifyClientConfig }, { startNotifyRealtime }] = await Promise.all([
        import('./app/notifySync.js'),
        import('./app/notifyWsClient.js')
      ]);
      const notifyConfig = readNotifyClientConfig();

      // dev HMR / 多次脚本执行时避免重复实例
      if (typeof window !== 'undefined' && typeof window.__aiDcaDisconnectNotifyWs === 'function') {
        try { window.__aiDcaDisconnectNotifyWs(); } catch { /* ignore */ }
      }
      const marketConfig = readOrCreateMarketWsClient();
      const realtimeOptions = {
        clientId: notifyConfig?.notifyClientId || marketConfig.clientId,
        clientSecret: notifyConfig?.notifyClientSecret || marketConfig.clientSecret,
        clientLabel: notifyConfig?.notifyClientLabel || marketConfig.clientLabel,
        accountUsername: readNotifyAccountUsername(),
        debug: false,
        onStatusChange: (status) => {
          if (typeof window !== 'undefined') {
            window.__aiDcaNotifyWsStatus = status;
            window.dispatchEvent(new CustomEvent('ai-dca-notify-ws-status', { detail: { status } }));
          }
        }
      };
      let realtimeClient = notifyConfig?.notifyClientId && notifyConfig?.notifyClientSecret
        ? startNotifyRealtime(realtimeOptions)
        : null;
      let marketDataStarted = false;
      const ensureMarketDataRealtime = () => {
        if (!marketDataStarted) {
          try { realtimeClient?.disconnect?.(); } catch { /* ignore */ }
          const hasNotifyClient = Boolean(notifyConfig?.notifyClientId && notifyConfig?.notifyClientSecret);
          realtimeClient = startNotifyRealtime(hasNotifyClient
            ? { ...realtimeOptions, enableMarketData: true }
            : {
              ...realtimeOptions,
              clientId: marketConfig.clientId,
              clientSecret: marketConfig.clientSecret,
              clientLabel: marketConfig.clientLabel,
              enableMarketData: true
            });
          marketDataStarted = true;
          if (typeof window !== 'undefined') {
            window.__aiDcaDisconnectNotifyWs = realtimeClient.disconnect;
          }
        }
        return realtimeClient;
      };
      if (typeof window !== 'undefined') {
        if (realtimeClient?.disconnect) window.__aiDcaDisconnectNotifyWs = realtimeClient.disconnect;
        window.__aiDcaSubscribeMarketData = (symbols, options) => ensureMarketDataRealtime().subscribeMarketData(symbols, options);
        const queued = Array.isArray(window.__aiDcaMarketSubscribeQueue) ? window.__aiDcaMarketSubscribeQueue.splice(0) : [];
        queued.forEach((item) => window.__aiDcaSubscribeMarketData(item.symbols, item.options));
      }
    } catch {
      // 通知是辅助功能，启动失败不影响主页面
    }
  }, { timeout: 2500 });
}

const inPagesDir = /\/pages(?:-v2)?\//.test(window.location.pathname);

installMarketDataSubscribeBridge();

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
