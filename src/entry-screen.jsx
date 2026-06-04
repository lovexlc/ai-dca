import React from 'react';
import { createRoot } from 'react-dom/client';
import { ScreenPage } from './pages/ScreenPage.jsx';
import { readNotifyClientConfig } from './app/notifySync.js';
import { startNotifyRealtime } from './app/notifyWsClient.js';
import { AppEntryAdGate } from './components/monetization.jsx';
import './styles/app.css';

const inPagesDir = /\/pages(?:-v2)?\//.test(window.location.pathname);

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppEntryAdGate>
      <ScreenPage inPagesDir={inPagesDir} />
    </AppEntryAdGate>
  </React.StrictMode>
);

// PC 浏览器实时通知：WebSocket 长连接入口。
// 开关由 NotifyExperience -> PC tab 控制，写到 localStorage.aiDcaWebNotifyConfig.pcEnabled。
// 连接函数内部检查权限+开关，未启用时 no-op。
// 失败时自动降级为轮询（复用原有 30s poll 逻辑）。
try {
  const notifyConfig = readNotifyClientConfig();
  if (notifyConfig?.notifyClientId && notifyConfig?.notifyClientSecret) {
    // dev HMR / 多次脚本执行时避免重复实例
    if (typeof window !== 'undefined' && typeof window.__aiDcaDisconnectNotifyWs === 'function') {
      try { window.__aiDcaDisconnectNotifyWs(); } catch (_e) { /* ignore */ }
    }
    const { disconnect, subscribeMarketData } = startNotifyRealtime({
      clientId: notifyConfig.notifyClientId,
      clientSecret: notifyConfig.notifyClientSecret,
      debug: true,
      onStatusChange: (status) => {
        if (typeof window !== 'undefined') {
          window.__aiDcaNotifyWsStatus = status;
          window.dispatchEvent(new CustomEvent('ai-dca-notify-ws-status', { detail: { status } }));
        }
      }
    });
    if (typeof window !== 'undefined') {
      window.__aiDcaDisconnectNotifyWs = disconnect;
      window.__aiDcaSubscribeMarketData = subscribeMarketData;
    }
  }
} catch (_error) {
  // 静默：通知是辅助功能，启动失败不影响主页面
}
