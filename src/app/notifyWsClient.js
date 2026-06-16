// PC 浏览器实时通知通道（WebSocket 长连接）
//
// 替代原有的 30s 轮询方案，通过 WsHub Durable Object 实现服务端推送。
// 连接建立后，服务端在触发通知时直接通过 WS 下发，无需客户端轮询。
// 断线时自动重连（指数退避），WS 连续失败后降级为轮询。

import { loadNotifyEvents } from './notifySync.js';
import { showLocalWebNotification, readWebNotifyConfig, persistWebNotifyConfig, getWebNotifyState } from './webNotifyClient.js';
import { isInTradingSession } from './tradingSession.js';
import { apiUrl, wsApiUrl } from './apiBase.js';

const WS_CONNECT_URL = '/api/notify/ws/register';
const WS_UNREGISTER_URL = '/api/notify/ws/unregister';
const PING_INTERVAL_MS = 30_000;
const INITIAL_RECONNECT_MS = 1_000;
const MAX_RECONNECT_MS = 30_000;
const WS_FAIL_THRESHOLD = 3; // WS 连续失败 N 次后降级为轮询
const POLL_INTERVAL_MS = 30_000;
const FIRST_RUN_REPLAY_WINDOW_MS = 15 * 60 * 1000;

// 全局单例状态
let currentInstance = null;

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

function buildWsUrl(deviceInstallationId, token) {
  return wsApiUrl(`/api/notify/ws/${encodeURIComponent(deviceInstallationId)}`);
}

/**
 * 启动 PC 浏览器实时通知。
 *
 * 流程：
 * 1. 调用 POST /api/notify/ws/register 获取 deviceInstallationId + token
 * 2. 建立 WebSocket 连接（携带 token 在 Sec-WebSocket-Protocol 中）
 * 3. 处理服务端帧：hello / ping / notify
 * 4. 断线自动重连，连续失败 WS_FAIL_THRESHOLD 次后降级为轮询
 *
 * @param {object} opts
 * @param {string} opts.clientId - web:<uuid> 格式的客户端 ID
 * @param {string} opts.clientSecret - 客户端密钥
 * @param {function} [opts.onStatusChange] - 连接状态回调：'connecting' | 'connected' | 'reconnecting' | 'fallback' | 'stopped'
 * @param {boolean} [opts.debug] - 是否输出调试日志
 * @returns {{ disconnect: function, getStatus: function }}
 */
export function startNotifyRealtime({ clientId, clientSecret, onStatusChange, debug = false } = {}) {
  // 停止前一个实例
  if (currentInstance) {
    currentInstance.disconnect();
  }

  if (typeof window === 'undefined' || !clientId || !clientSecret) {
    return { disconnect: () => {}, getStatus: () => 'stopped' };
  }

  if (!readWebNotifyConfig().pcEnabled) {
    return { disconnect: () => {}, getStatus: () => 'stopped' };
  }

  let stopped = false;
  let ws = null;
  let reconnectTimer = null;
  let pingTimer = null;
  let reconnectMs = INITIAL_RECONNECT_MS;
  let wsFailCount = 0;
  let status = 'idle';
  let deviceInstallationId = null;
  let wsToken = null;
  let pollerStop = null;

  function setStatus(newStatus) {
    if (status === newStatus) return;
    status = newStatus;
    if (debug) console.info('[notifyWs] status ->', newStatus);
    try { onStatusChange?.(newStatus); } catch { /* ignore */ }
  }

  function cleanupTimers() {
    if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  }

  function cleanupWs() {
    if (ws) {
      try { ws.close(1000, 'client disconnect'); } catch { /* ignore */ }
      ws = null;
    }
  }

  function stopPoller() {
    if (pollerStop) { try { pollerStop(); } catch { /* ignore */ } pollerStop = null; }
  }

  // ── 降级为轮询 ────────────────────────────────────────────────
  function fallbackToPoll() {
    stopPoller();
    cleanupWs();
    cleanupTimers();
    setStatus('fallback');

    pollerStop = startFallbackPoller({ clientId, debug });
  }

  // ── WS 帧处理 ─────────────────────────────────────────────────
  function handleFrame(data) {
    let frame;
    try { frame = JSON.parse(data); } catch { return; }

    if (!frame || typeof frame !== 'object') return;

    switch (frame.type) {
      case 'hello':
        if (debug) console.info('[notifyWs] hello', frame.connectionId);
        wsFailCount = 0;
        reconnectMs = INITIAL_RECONNECT_MS;
        setStatus('connected');
        startPing();
        flushPendingSubscribe();
        break;

      case 'ping':
        // 服务端心跳，回 pong
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
        }
        break;

      case 'notify':
        handleNotifyFrame(frame);
        break;

      case 'price_push':
        handlePricePushFrame(frame);
        break;

      case 'market_snapshot':
        handleMarketSnapshotFrame(frame);
        break;

      default:
        if (debug) console.info('[notifyWs] unknown frame type:', frame.type);
    }
  }

  function handlePricePushFrame(frame) {
    const items = Array.isArray(frame.items) ? frame.items : [];
    if (!items.length) return;
    if (debug) console.info('[notifyWs] price_push received:', items.length, 'items');
    // 通过自定义事件广播给页面组件
    try {
      window.dispatchEvent(new CustomEvent('ai-dca-price-push', { detail: { items, ts: frame.ts } }));
    } catch { /* ignore */ }
  }

  function handleMarketSnapshotFrame(frame) {
    const items = Array.isArray(frame.items) ? frame.items : [];
    if (!items.length) return;
    if (debug) console.info('[notifyWs] market_snapshot received:', items.length, 'items');
    try {
      window.dispatchEvent(new CustomEvent('ai-dca-price-push', {
        detail: {
          items,
          ts: frame.ts,
          source: frame.source || '',
          session: frame.session || '',
          topics: Array.isArray(frame.topics) ? frame.topics : []
        }
      }));
      window.dispatchEvent(new CustomEvent('ai-dca-market-snapshot', {
        detail: {
          items,
          ts: frame.ts,
          source: frame.source || '',
          session: frame.session || '',
          topics: Array.isArray(frame.topics) ? frame.topics : []
        }
      }));
    } catch { /* ignore */ }
  }

  // 待发送的订阅列表（连接建立前缓存）
  let pendingSymbols = null;

  function buildSubscribePayload(symbols, options = {}) {
    const safeSymbols = Array.from(new Set((Array.isArray(symbols) ? symbols : [])
      .map((s) => String(s || '').trim())
      .filter(Boolean)));
    const topics = Array.isArray(options?.topics) && options.topics.length
      ? options.topics
      : ['market.price', 'market.premium'];
    return { type: 'subscribe', symbols: safeSymbols, topics };
  }

  function sendSubscribeFrame(symbols, options = {}) {
    const payload = buildSubscribePayload(symbols, options);
    if (!payload.symbols.length) return;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    } else {
      pendingSymbols = payload;
    }
  }

  // 连接成功后自动发送待订阅
  function flushPendingSubscribe() {
    if (pendingSymbols && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(pendingSymbols));
      pendingSymbols = null;
    }
  }

  function handleNotifyFrame(frame) {
    const data = frame.data || {};
    const title = String(data.title || data.summary || '交易提醒');
    const body = String(data.body || data.message || '');

    if (debug) console.info('[notifyWs] notify received:', title);

    // 更新 lastSeenEventId
    const eventId = frame.eventId || frame.messageId || data.eventId || data.messageId || '';
    if (eventId) {
      persistWebNotifyConfig({ lastSeenEventId: String(eventId) });
    }

    // 弹出桌面通知
    const config = readWebNotifyConfig();
    const state = getWebNotifyState();
    if (config.pcEnabled && state.supported && state.permission === 'granted') {
      showLocalWebNotification({ title, body, tag: eventId || undefined });
    }

    // 发送 ACK
    if (ws && ws.readyState === WebSocket.OPEN && (frame.messageId || frame.eventId)) {
      ws.send(JSON.stringify({
        type: 'ack',
        messageId: frame.messageId || '',
        eventId: frame.eventId || '',
        stage: 'delivered',
        source: 'web-pc'
      }));
    }
  }

  // ── 心跳 ──────────────────────────────────────────────────────
  function startPing() {
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping', ts: Date.now() }));
      }
    }, PING_INTERVAL_MS);
  }

  // ── 建立 WS 连接 ──────────────────────────────────────────────
  function connectWs() {
    if (stopped) return;
    cleanupWs();
    cleanupTimers();
    setStatus('connecting');

    const url = buildWsUrl(deviceInstallationId, wsToken);

    try {
      ws = new WebSocket(url, [`jijin-token-${wsToken}`]);
    } catch (e) {
      if (debug) console.warn('[notifyWs] WebSocket constructor failed:', e);
      onWsFail();
      return;
    }

    ws.onopen = () => {
      if (debug) console.info('[notifyWs] socket opened');
      // 等 hello 帧来确认 connected
    };

    ws.onmessage = (event) => {
      handleFrame(event.data);
    };

    ws.onclose = (event) => {
      if (debug) console.info('[notifyWs] socket closed:', event.code, event.reason);
      cleanupTimers();
      if (!stopped) {
        onWsFail();
      }
    };

    ws.onerror = (event) => {
      if (debug) console.warn('[notifyWs] socket error');
      // onclose 会跟随触发，重连逻辑在 onclose 中处理
    };
  }

  function onWsFail() {
    wsFailCount++;
    if (wsFailCount >= WS_FAIL_THRESHOLD) {
      if (debug) console.warn(`[notifyWs] ${wsFailCount} consecutive failures, falling back to poll`);
      fallbackToPoll();
    } else {
      scheduleReconnect();
    }
  }

  function scheduleReconnect() {
    if (stopped) return;
    setStatus('reconnecting');
    const jitter = Math.random() * 1000;
    const delay = Math.min(reconnectMs + jitter, MAX_RECONNECT_MS);
    if (debug) console.info('[notifyWs] reconnecting in', Math.round(delay), 'ms');
    reconnectTimer = setTimeout(() => {
      reconnectMs = Math.min(reconnectMs * 2, MAX_RECONNECT_MS);
      connectWs();
    }, delay);
  }

  // ── 注册 + 启动 ───────────────────────────────────────────────
  async function registerAndConnect() {
    setStatus('connecting');

    try {
      const res = await fetch(apiUrl(WS_CONNECT_URL), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientId, clientSecret })
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        if (debug) console.warn('[notifyWs] register failed:', res.status, text);
        fallbackToPoll();
        return;
      }

      const data = await res.json();
      if (!data?.ok || !data?.deviceInstallationId || !data?.token) {
        if (debug) console.warn('[notifyWs] register invalid response:', data);
        fallbackToPoll();
        return;
      }

      deviceInstallationId = data.deviceInstallationId;
      wsToken = data.token;

      if (debug) console.info('[notifyWs] registered, connecting...');
      connectWs();
    } catch (e) {
      if (debug) console.warn('[notifyWs] register error:', e);
      fallbackToPoll();
    }
  }

  // ── 断开 ──────────────────────────────────────────────────────
  function disconnect() {
    stopped = true;
    stopPoller();
    cleanupWs();
    cleanupTimers();
    setStatus('stopped');
    // 尝试注销（fire-and-forget）
    if (deviceInstallationId && clientId && clientSecret) {
      fetch(apiUrl(WS_UNREGISTER_URL), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientId, clientSecret })
      }).catch(() => {});
    }
    currentInstance = null;
  }

  function getStatus() {
    return status;
  }

  currentInstance = { disconnect, getStatus, subscribeMarketData: sendSubscribeFrame };
  registerAndConnect();

  return currentInstance;
}


// ── 降级轮询器（复用 webNotifyClient 的逻辑） ────────────────────

function startFallbackPoller({ clientId, debug = false } = {}) {
  if (!clientId) return () => {};

  let stopped = false;
  let timer = null;

  async function tick({ silent = false } = {}) {
    if (stopped) return;
    const config = readWebNotifyConfig();
    const state = getWebNotifyState();
    if (!config.pcEnabled || !state.supported || state.permission !== 'granted') return;
    if (!isInTradingSession(new Date())) return;

    try {
      const payload = await loadNotifyEvents(clientId);
      if (stopped) return;
      const sorted = sortEventsAsc(payload?.events || []);
      if (!sorted.length) return;
      const latestId = pickEventId(sorted[sorted.length - 1]);

      if (!config.lastSeenEventId) {
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
        return;
      }

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

      if (!started) {
        persistWebNotifyConfig({ lastSeenEventId: latestId });
      } else if (latestId && latestId !== config.lastSeenEventId) {
        persistWebNotifyConfig({ lastSeenEventId: latestId });
      }
    } catch (_error) {
      if (debug) console.warn('[notifyWs:poll] poll failed', _error);
    }
  }

  tick({ silent: true }).finally(() => {
    if (stopped) return;
    timer = window.setInterval(() => {
      tick().catch(() => {});
    }, POLL_INTERVAL_MS);
  });

  return function stop() {
    stopped = true;
    if (timer) { clearInterval(timer); timer = null; }
  };
}
