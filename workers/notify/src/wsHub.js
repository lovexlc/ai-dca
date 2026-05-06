// WsHub —— 实时长连接通道的 Durable Object 骨架（per device installation id）。
//
// v1 阶段只承载「在线即推、离线丢弃」的弱实时通道，与 FCM 形成双发。
// 客户端规模约定：一个 deviceInstallationId 通常 1-2 个并发长连接
// （手机 + 偶尔的桌面调试），不做 fan-out 广播，不做离线 catch-up。
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
})

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

    this.#ensureHeartbeat()

    return new Response(null, { status: 101, webSocket: client })
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
    const frame = JSON.stringify({
      type: FRAME.NOTIFY,
      ts: Date.now(),
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
