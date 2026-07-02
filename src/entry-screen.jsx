import React from 'react';
import { createRoot } from 'react-dom/client';
import { ScreenPage } from './pages/ScreenPage.jsx';
import { readNotifyAccountUsername, readNotifyClientConfig } from './app/notifySync.js';
import { startNotifyRealtime } from './app/notifyWsClient.js';
import { AppEntryAdGate } from './components/monetization.jsx';
import { initPostHog } from './app/posthog.js';
import './styles/app.css';

// 初始化 PostHog
initPostHog();

const inPagesDir = /\/pages(?:-v2)?\//.test(window.location.pathname);

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppEntryAdGate>
      <ScreenPage inPagesDir={inPagesDir} />
    </AppEntryAdGate>
  </React.StrictMode>
);

// PC 浏览器实时通知 / 行情订阅：WebSocket 长连接入口。
// 开关由 NotifyExperience -> PC tab 控制，写到 localStorage.aiDcaWebNotifyConfig.pcEnabled。
// 通知能力会检查权限+开关，未启用时 no-op；行情能力在页面首次订阅时懒启动。
// 通知 WS 失败时自动降级为轮询（复用原有 30s poll 逻辑）。
try {
  const notifyConfig = readNotifyClientConfig();
  if (notifyConfig?.notifyClientId && notifyConfig?.notifyClientSecret) {
    // dev HMR / 多次脚本执行时避免重复实例
    if (typeof window !== 'undefined' && typeof window.__aiDcaDisconnectNotifyWs === 'function') {
      try { window.__aiDcaDisconnectNotifyWs(); } catch { /* ignore */ }
    }
    const realtimeOptions = {
      clientId: notifyConfig.notifyClientId,
      clientSecret: notifyConfig.notifyClientSecret,
      clientLabel: notifyConfig.notifyClientLabel,
      accountUsername: readNotifyAccountUsername(),
      debug: true,
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
  }
} catch {
  // 静默：通知是辅助功能，启动失败不影响主页面
}
