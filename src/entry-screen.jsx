import React from 'react';
import { createRoot } from 'react-dom/client';
import { ScreenPage } from './pages/ScreenPage.jsx';
import { readNotifyClientConfig } from './app/notifySync.js';
import { startWebNotifyPoller } from './app/webNotifyClient.js';
import './styles/app.css';

const inPagesDir = /\/pages(?:-v2)?\//.test(window.location.pathname);

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ScreenPage inPagesDir={inPagesDir} />
  </React.StrictMode>
);

// PC 浏览器前台通知（方案 A）：全局轮询入口。
// 开关由 NotifyExperience -> PC tab 控制，写到 localStorage.aiDcaWebNotifyConfig.pcEnabled。
// 轮询函数每 tick 自己检查权限+开关，未启用时 no-op，所以这里只需要保持一个 poller 实例存活。
try {
  const notifyConfig = readNotifyClientConfig();
  if (notifyConfig?.notifyClientId) {
    // dev HMR / 多次脚本执行时避免重复 poller
    if (typeof window !== 'undefined' && typeof window.__aiDcaStopWebNotifyPoller === 'function') {
      try { window.__aiDcaStopWebNotifyPoller(); } catch (_e) { /* ignore */ }
    }
    const stop = startWebNotifyPoller({ clientId: notifyConfig.notifyClientId });
    if (typeof window !== 'undefined') {
      window.__aiDcaStopWebNotifyPoller = stop;
    }
  }
} catch (_error) {
  // 静默：通知是辅助功能，启动失败不影响主页面
}
