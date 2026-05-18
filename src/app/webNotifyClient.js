// PC 浏览器前台通知（方案 A）
//
// 设计思路：
// - 不引入 Service Worker / VAPID / Web Push。只在页面打开、且用户授予 Notification 权限后，
//   定期拉 `/api/notify/events`，diff 出新事件后用 `new Notification(...)` 本地弹窗。
// - 与现有 iOS Bark / Android FCM 平行：不改 worker，三个渠道独立订阅。
// - 同一个 tab 只保持一个 poller 实例（通过 stop() handle 避免 HMR 重复启动）。

import { loadNotifyEvents } from './notifySync.js';
import { isInTradingSession } from './tradingSession.js';

const WEB_NOTIFY_CONFIG_KEY = 'aiDcaWebNotifyConfig';
const DEFAULT_POLL_INTERVAL_MS = 30_000;
// 首次启用时补推近 15 分钟内未看事件，避免“刚启用 PC 通知刚好挫过刚触发的事件”。
const FIRST_RUN_REPLAY_WINDOW_MS = 15 * 60 * 1000;

function buildDefaultWebNotifyConfig() {
  return {
    // 用户是否在本浏览器启用了 PC 通知轮询
    pcEnabled: false,
    // 上次成功推送过的事件 id，用于 diff。首次启动会被设为当时最新一条事件 id。
    lastSeenEventId: ''
  };
}

export function readWebNotifyConfig() {
  if (typeof window === 'undefined') {
    return buildDefaultWebNotifyConfig();
  }

  try {
    const saved = JSON.parse(window.localStorage.getItem(WEB_NOTIFY_CONFIG_KEY) || 'null');
    return {
      ...buildDefaultWebNotifyConfig(),
      pcEnabled: Boolean(saved?.pcEnabled),
      lastSeenEventId: String(saved?.lastSeenEventId || '')
    };
  } catch (_error) {
    return buildDefaultWebNotifyConfig();
  }
}

export function persistWebNotifyConfig(nextConfig = {}) {
  if (typeof window === 'undefined') return;

  const current = readWebNotifyConfig();
  const payload = {
    ...current,
    ...nextConfig,
    pcEnabled: Boolean(nextConfig.pcEnabled ?? current.pcEnabled),
    lastSeenEventId: String(nextConfig.lastSeenEventId ?? current.lastSeenEventId ?? '')
  };

  window.localStorage.setItem(WEB_NOTIFY_CONFIG_KEY, JSON.stringify(payload));
}

/**
 * 检测当前环境是否支持 Notification API，以及当前权限。
 * - Chromium 系（Chrome / Edge / Brave / Arc / Opera）：全面支持
 * - Firefox 也支持
 * - Safari 桌面版支持（iOS Safari 仅 16.4+ 企联 PWA 才支持，这里不担保）
 */
export function getWebNotifyState() {
  if (typeof window === 'undefined' || typeof window.Notification === 'undefined') {
    return { supported: false, permission: 'default' };
  }
  return {
    supported: true,
    permission: window.Notification.permission || 'default'
  };
}

export async function requestWebNotifyPermission() {
  const state = getWebNotifyState();
  if (!state.supported) return 'denied';
  if (state.permission === 'granted' || state.permission === 'denied') {
    return state.permission;
  }
  try {
    const result = await window.Notification.requestPermission();
    return result || 'default';
  } catch (_error) {
    return 'denied';
  }
}

/** 本地弹出一条 PC 桌面通知。调用前请确保 permission==='granted'。 */
export function showLocalWebNotification({ title, body, tag, icon } = {}) {
  const state = getWebNotifyState();
  if (!state.supported || state.permission !== 'granted') return null;
  try {
    return new window.Notification(String(title || ''), {
      body: String(body || ''),
      tag: tag ? String(tag) : undefined,
      icon: icon || undefined,
      silent: false
    });
  } catch (_error) {
    return null;
  }
}

function pickEventId(event = {}) {
  return String(event?.id || event?.eventId || event?.createdAt || '');
}

function sortEventsAsc(events = []) {
  const list = Array.isArray(events) ? events.slice() : [];
  list.sort((a, b) => {
    const ta = Date.parse(String(a?.createdAt || '')) || 0;
    const tb = Date.parse(String(b?.createdAt || '')) || 0;
    return ta - tb;
  });
  return list;
}

/**
 * 启动 PC 前台通知轮询。调用者必须提供 notifyClientId（从 readNotifyClientConfig() 中取）。
 *
 * 行为：
 * 1. 启动时拉一次 events，如果以前没记过 lastSeenEventId，则把当前最新事件 id 当起点，避免在初次启用时出现「全部历史事件都弹」
 * 2. 之后按 intervalMs 轮询，按创建时间升序弹未看过的事件
 * 3. 仅在 pcEnabled === true && Notification.permission==='granted' 时实际弹
 * 4. 任何拉取失败都静默跳过下一轮
 */
export function startWebNotifyPoller({ clientId, intervalMs = DEFAULT_POLL_INTERVAL_MS, debug = false } = {}) {
  if (typeof window === 'undefined') {
    return () => {};
  }
  if (!clientId) {
    if (debug) console.warn('[webNotifyClient] missing clientId, skip start');
    return () => {};
  }

  let stopped = false;
  let timer = null;

  async function tick({ silent = false } = {}) {
    if (stopped) return;
    const config = readWebNotifyConfig();
    const state = getWebNotifyState();
    if (!config.pcEnabled || !state.supported || state.permission !== 'granted') {
      if (debug) console.info('[webNotifyClient] tick skipped', {
        pcEnabled: config.pcEnabled,
        supported: state.supported,
        permission: state.permission
      });
      return;
    }
    // 交易时间外不请求。A 股 09:30-11:30 / 13:00-15:00 周一到周五 Asia/Shanghai。
    if (!isInTradingSession(new Date())) {
      if (debug) console.info('[webNotifyClient] tick skipped: outside trading session');
      return;
    }
    try {
      const payload = await loadNotifyEvents(clientId);
      if (stopped) return;
      const sorted = sortEventsAsc(payload?.events || []);
      if (debug) console.info('[webNotifyClient] tick fetched', {
        eventCount: sorted.length,
        lastSeenEventId: config.lastSeenEventId
      });
      if (!sorted.length) return;
      const latestId = pickEventId(sorted[sorted.length - 1]);

      if (!config.lastSeenEventId) {
        // 首次启用：补推近 FIRST_RUN_REPLAY_WINDOW_MS 内的事件，那个窗口以外的历史跳过。
        const cutoffMs = Date.now() - FIRST_RUN_REPLAY_WINDOW_MS;
        const recent = sorted.filter((event) => (Date.parse(String(event?.createdAt || '')) || 0) >= cutoffMs);
        if (!silent) {
          for (const event of recent) {
            showLocalWebNotification({
              title: String(event?.title || event?.summary || '交易提醒'),
              body: String(event?.body || event?.message || ''),
              tag: pickEventId(event) || undefined
            });
          }
        }
        persistWebNotifyConfig({ lastSeenEventId: latestId });
        if (debug) console.info('[webNotifyClient] first-run replay', {
          replayed: recent.length,
          latestId,
          silent
        });
        return;
      }

      // 找出未看过的事件：从老到新弹
      let started = false;
      for (const event of sorted) {
        const id = pickEventId(event);
        if (!started) {
          if (id === config.lastSeenEventId) started = true;
          continue;
        }
        if (!silent) {
          showLocalWebNotification({
            title: String(event?.title || event?.summary || '交易提醒'),
            body: String(event?.body || event?.message || ''),
            tag: id || undefined
          });
        }
      }

      // 如果 started 始终为 false（lastSeenEventId 在这一批 events 中未出现，可能是事件被清掉或丢失），
      // 为避免下次 burst弹退，直接重置为最新 id。
      if (!started) {
        persistWebNotifyConfig({ lastSeenEventId: latestId });
      } else if (latestId && latestId !== config.lastSeenEventId) {
        persistWebNotifyConfig({ lastSeenEventId: latestId });
      }
    } catch (_error) {
      // 静默失败：这是后台轮询，不要打扰用户
      if (debug) console.warn('[webNotifyClient] poll failed', _error);
    }
  }

  // 即刻启动一次（主要用于初次设 lastSeenEventId）后进入轮询
  tick({ silent: true }).finally(() => {
    if (stopped) return;
    timer = window.setInterval(() => {
      tick().catch(() => {});
    }, Math.max(5_000, intervalMs));
  });

  return function stop() {
    stopped = true;
    if (timer) {
      window.clearInterval(timer);
      timer = null;
    }
  };
}
