import { recordDeliveryAck } from './ack.js';

// WsHub —— 实时长连接通道的 Durable Object 骨架（per device installation id）。
//
// v2 阶段承载「在线即推、离线入队、上线补拉」的实时通道。
// 客户端规模约定：一个 deviceInstallationId 通常 1-2 个并发长连接
// （手机 + 偶尔的桌面调试），在线 fan-out；离线消息写入 NOTIFY_STATE KV。
//
// 接入路径在后续一次单独的 PR 中接通：
//   1. wrangler.toml 增加 [[durable_objects.bindings]] WS_HUB + migrations
//      tag/new_sqlite_classes = ["WsHub"]；
//   2. index.js 增加路由：
//        GET  /api/notify/ws/:deviceInstallationId  (Upgrade)
//        POST /api/notify/ws/:deviceInstallationId/publish  (内部 Worker 调用)
//      并在 fan-out 流水线里调用 publish 做并发双发。
//
// 当前文件仅是 class 定义。class 没有被 wrangler.toml 引用前不会被 Cloudflare
// 当作 DO，也不会触发任何部署副作用。

const PING_INTERVAL_MS = 30_000
const MAX_IDLE_MS = 75_000
const QUEUE_KEY_PREFIX = "notify:queue:device:"
const QUEUE_TTL_SECONDS = 3 * 24 * 60 * 60
const MAX_QUEUED_MESSAGES = 100

/**
 * 服务端 → 客户端的控制帧约定（与业务推送区分）。
 * 业务推送沿用 Bark payload 形状（无 type 字段或 type="notify"），
 * 控制帧明确带 type 字段。
 */
const FRAME = Object.freeze({
  HELLO: "hello",
  PING: "ping",
  PONG: "pong",
  NOTIFY: "notify",
  ACK: "ack",
})


function queueKey(deviceInstallationId) {
  return `${QUEUE_KEY_PREFIX}${String(deviceInstallationId || '').trim()}`
}

function normalizeQueuePayload(value) {
  if (!value || typeof value !== 'object') return { messages: [] }
  const messages = Array.isArray(value.messages) ? value.messages.filter(Boolean) : []
  return { ...value, messages }
}

function resolveMessageId(payload = {}) {
  const data = payload && typeof payload.data === 'object' && payload.data ? payload.data : {}
  return String(
    payload.messageId
    || payload.id
    || data.messageId
    || data.eventId
    || data.id
    || ''
  ).trim()
}

function buildQueuedMessage(payload = {}, reason = 'offline') {
  const queuedAt = new Date().toISOString()
  const messageId = resolveMessageId(payload) || `queued:${queuedAt}:${crypto.randomUUID()}`
  return {
    id: messageId,
    messageId,
    queuedAt,
    reason,
    payload: payload || {},
  }
}

async function readQueue(env, deviceInstallationId) {
  if (!env || !env.NOTIFY_STATE || !deviceInstallationId) return { messages: [] }
  const raw = await env.NOTIFY_STATE.get(queueKey(deviceInstallationId))
  if (!raw) return { messages: [] }
  try {
    return normalizeQueuePayload(JSON.parse(raw))
  } catch {
    return { messages: [] }
  }
}

async function writeQueue(env, deviceInstallationId, queue) {
  if (!env || !env.NOTIFY_STATE || !deviceInstallationId) return
  const normalized = normalizeQueuePayload(queue)
  if (!normalized.messages.length) {
    await env.NOTIFY_STATE.delete(queueKey(deviceInstallationId))
    return
  }
  await env.NOTIFY_STATE.put(
    queueKey(deviceInstallationId),
    JSON.stringify({
      ...normalized,
      updatedAt: new Date().toISOString(),
    }),
    { expirationTtl: QUEUE_TTL_SECONDS },
  )
}

export async function enqueueWsMessage(env, deviceInstallationId, payload, reason = 'offline') {
  if (!env || !env.NOTIFY_STATE || !deviceInstallationId) return { queued: false, skipped: true }
  const queued = buildQueuedMessage(payload || {}, reason)
  const queue = await readQueue(env, deviceInstallationId)
  const existingIndex = queue.messages.findIndex((item) => item && item.messageId === queued.messageId)
  if (existingIndex >= 0) {
    queue.messages[existingIndex] = { ...queue.messages[existingIndex], payload: queued.payload, reason, queuedAt: queued.queuedAt }
  } else {
    queue.messages.push(queued)
  }
  queue.messages = queue.messages.slice(-MAX_QUEUED_MESSAGES)
  await writeQueue(env, deviceInstallationId, queue)
  return { queued: true, queueSize: queue.messages.length, messageId: queued.messageId }
}

async function drainWsQueue(env, deviceInstallationId) {
  if (!env || !env.NOTIFY_STATE || !deviceInstallationId) return []
  const queue = await readQueue(env, deviceInstallationId)
  if (!queue.messages.length) return []
  await env.NOTIFY_STATE.delete(queueKey(deviceInstallationId))
  return queue.messages
}

export class WsHub {
  /**
   * @param {DurableObjectState} state
   * @param {Record<string, unknown>} env
   */
  constructor(state, env) {
    this.state = state
    this.env = env
    /** @type {Map<WebSocket, { id: string; lastSeenMs: number }>} */
    this.sockets = new Map()
    this.heartbeatTimer = null
  }

  /**
   * DO HTTP 路由：
   *   GET  /connect       —— 升级到 WebSocket。
   *   POST /publish       —— 接收一个 Bark 风格 payload，广播给所有在线 socket。
   *                          预期只由本 Worker 内部 fetch 调用，不暴露公网。
   *   GET  /stats         —— 返回当前连接数（运维用）。
   *
   * @param {Request} request
   */
  async fetch(request) {
    const url = new URL(request.url)
    switch (url.pathname) {
      case "/connect":
        return this.#handleConnect(request)
      case "/publish":
        return this.#handlePublish(request)
      case "/stats":
        return new Response(
          JSON.stringify({ connections: this.sockets.size }),
          { headers: { "content-type": "application/json" } },
        )
      default:
        return new Response("not found", { status: 404 })
    }
  }

  /**
   * 升级 WebSocket。鉴权由上游 Worker 在调用 DO 之前完成（device 绑定校验），
   * 这里只负责接受连接、注册到 socket 集合、绑定事件。
   *
   * @param {Request} request
   */
  async #handleConnect(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket upgrade", { status: 426 })
    }
    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]

    server.accept()
    const deviceInstallationId = String(request.headers.get("x-device-installation-id") || "").trim()
    const id = crypto.randomUUID()
    this.sockets.set(server, { id, lastSeenMs: Date.now() })

    server.addEventListener("message", (event) => {
      const meta = this.sockets.get(server)
      if (meta) meta.lastSeenMs = Date.now()
      // 收到客户端 pong / 业务上行（v1 暂不消费业务上行）
      try {
        const frame = JSON.parse(typeof event.data === "string" ? event.data : "")
        if (frame && frame.type === FRAME.PING) {
          server.send(JSON.stringify({ type: FRAME.PONG, ts: Date.now() }))
          return
        }
        if (frame && frame.type === FRAME.ACK) {
          recordDeliveryAck(this.env, frame, {
            deviceInstallationId,
            source: frame.source || 'ws',
            connectionId: id,
          }).catch((error) => {
            console.log("[notify][ws] ack record failed", JSON.stringify({
              deviceInstallationId,
              messageId: frame.messageId || frame.eventId || '',
              message: error instanceof Error ? error.message : String(error),
            }))
          })
        }
      } catch {
        // 忽略非 JSON 帧
      }
    })

    const cleanup = () => {
      this.sockets.delete(server)
      if (this.sockets.size === 0 && this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer)
        this.heartbeatTimer = null
      }
    }
    server.addEventListener("close", cleanup)
    server.addEventListener("error", cleanup)

    server.send(
      JSON.stringify({
        type: FRAME.HELLO,
        connectionId: id,
        pingIntervalMs: PING_INTERVAL_MS,
        ts: Date.now(),
      }),
    )

    if (deviceInstallationId) {
      this.#drainQueuedMessages(server, deviceInstallationId).catch((error) => {
        console.log("[notify][ws] drain queue failed", JSON.stringify({
          deviceInstallationId,
          message: error instanceof Error ? error.message : String(error),
        }))
      })
    }

    this.#ensureHeartbeat()

    // 客户端如果携带了 Sec-WebSocket-Protocol（我们用它传 token），服务端
    // 必须选中其中一个 echo 回去，OkHttp/浏览器的 WebSocket 才会接受升级。
    const requestedProtocols = (request.headers.get("Sec-WebSocket-Protocol") || "")
      .split(",").map((s) => s.trim()).filter(Boolean)
    const responseHeaders = new Headers()
    if (requestedProtocols.length > 0) {
      responseHeaders.set("Sec-WebSocket-Protocol", requestedProtocols[0])
    }
    return new Response(null, { status: 101, webSocket: client, headers: responseHeaders })
  }

  /**
   * 把 payload 广播给所有当前连接。返回投递统计供上游决定是否记 metric。
   *
   * @param {Request} request
   */
  async #handlePublish(request) {
    if (request.method !== "POST") {
      return new Response("method not allowed", { status: 405 })
    }
    let payload
    try {
      payload = await request.json()
    } catch {
      return new Response("invalid json", { status: 400 })
    }
    const messageId = resolveMessageId(payload)
    const frame = JSON.stringify({
      type: FRAME.NOTIFY,
      ts: Date.now(),
      messageId,
      eventId: messageId,
      data: payload,
    })
    let delivered = 0
    let failed = 0
    for (const [socket] of this.sockets) {
      try {
        socket.send(frame)
        delivered++
      } catch {
        failed++
        try { socket.close(1011, "send failed") } catch {}
        this.sockets.delete(socket)
      }
    }
    return new Response(
      JSON.stringify({ delivered, failed, total: delivered + failed }),
      { headers: { "content-type": "application/json" } },
    )
  }

  /**
   * 连接建立后补发该设备的离线队列。成功取出后即清空 KV；如果单条发送失败，
   * 剩余消息会重新入队，避免上线瞬间 socket 异常导致消息丢失。
   *
   * @param {WebSocket} socket
   * @param {string} deviceInstallationId
   */
  async #drainQueuedMessages(socket, deviceInstallationId) {
    const messages = await drainWsQueue(this.env, deviceInstallationId)
    if (!messages.length) return
    const failed = []
    for (const item of messages) {
      try {
        socket.send(JSON.stringify({
          type: FRAME.NOTIFY,
          ts: Date.now(),
          queued: true,
          queuedAt: item.queuedAt || '',
          messageId: item.messageId || item.id || '',
          data: item.payload || {},
        }))
      } catch (_error) {
        failed.push(item)
      }
    }
    if (failed.length) {
      const existing = await readQueue(this.env, deviceInstallationId)
      await writeQueue(this.env, deviceInstallationId, {
        messages: [...failed, ...existing.messages].slice(-MAX_QUEUED_MESSAGES),
      })
    }
    console.log("[notify][ws] drained queued messages", JSON.stringify({
      deviceInstallationId,
      delivered: messages.length - failed.length,
      requeued: failed.length,
    }))
  }

  /**
   * 30s 周期下发 server ping，并清理 75s 内没有任何收发动作的死连接。
   * 仅在有连接时启动 timer，最后一个连接断开时停止。
   */
  #ensureHeartbeat() {
    if (this.heartbeatTimer) return
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now()
      const ping = JSON.stringify({ type: FRAME.PING, ts: now })
      for (const [socket, meta] of this.sockets) {
        if (now - meta.lastSeenMs > MAX_IDLE_MS) {
          try { socket.close(1001, "idle timeout") } catch {}
          this.sockets.delete(socket)
          continue
        }
        try {
          socket.send(ping)
        } catch {
          try { socket.close(1011, "ping failed") } catch {}
          this.sockets.delete(socket)
        }
      }
      if (this.sockets.size === 0) {
        clearInterval(this.heartbeatTimer)
        this.heartbeatTimer = null
      }
    }, PING_INTERVAL_MS)
  }
}

/**
 * 从外部 Worker 代码并发发布一条 payload 到指定设备的 WsHub。
 * 在线时直接送达；如果当前没有在线 socket 或发送失败，则写入离线队列。
 *
 * @param {Record<string, unknown>} env
 * @param {string} deviceInstallationId
 * @param {Record<string, unknown>} payload
 */
export async function tryPublishWs(env, deviceInstallationId, payload) {
  if (!env || !env.WS_HUB || !deviceInstallationId) return { skipped: true }
  try {
    const id = env.WS_HUB.idFromName(String(deviceInstallationId))
    const stub = env.WS_HUB.get(id)
    const res = await stub.fetch("https://ws-hub/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload || {}),
    })
    if (!res.ok) {
      try {
        const text = await res.text()
        console.log("[notify][ws] publish non-ok", JSON.stringify({ status: res.status, body: text.slice(0, 200) }))
      } catch (_) {}
      const queued = await enqueueWsMessage(env, deviceInstallationId, payload, `publish-status-${res.status}`)
      return { ok: false, status: res.status, ...queued }
    }
    let parsed = null
    try { parsed = await res.json() } catch (_) { parsed = null }
    if (!parsed || Number(parsed.delivered || 0) <= 0) {
      const queued = await enqueueWsMessage(env, deviceInstallationId, payload, 'offline')
      return { ok: true, ...(parsed || {}), ...queued }
    }
    return { ok: true, queued: false, ...parsed }
  } catch (error) {
    console.log("[notify][ws] publish error", JSON.stringify({
      deviceInstallationId,
      message: error instanceof Error ? error.message : String(error),
    }))
    const queued = await enqueueWsMessage(env, deviceInstallationId, payload, 'publish-error')
    return { ok: false, error: error instanceof Error ? error.message : String(error), ...queued }
  }
}
