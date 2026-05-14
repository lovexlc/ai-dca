# ai-dca-markets-agent

行情深度问答 agent。部署为 Cloudflare Worker + Container，MoltWorker (OpenClaw) 风格。

## 当前阶段

**M1 骨架**：只含 Worker 入口 + DO + Container 骨架 + /health + /ask echo。能验证：

1. CF Container 部署打通。
2. INTERNAL_TOKEN 鉴权打通。
3. OPENAI_API_KEY / OPENAI_BASE_URL / TAVILY_API_KEY 注入 container 进程环境。

还没接入 OpenClaw 、还没接入 Tavily MCP、还没调 LLM。这些是 M2/M3。

## 架构

```
markets Worker  (现有、面向公网)
    │  service binding
    ▼
markets-agent Worker  (本项目、内部只走 /internal/*)
    │  Durable Object 包装
    ▼
Cloudflare Container (Sandbox)
    └─ Node.js HTTP server (M1)
       M2: OpenClaw runtime
       M2: Tavily MCP child process
       M2: markets-quote MCP child process
```

## 需要设的 secret

```bash
cd workers/markets-agent
# 与 markets Worker 共享的 bearer，调用者需携带。
npx wrangler secret put INTERNAL_TOKEN
# OpenAI 兼容中转。
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put OPENAI_BASE_URL
# Tavily 检索。
npx wrangler secret put TAVILY_API_KEY
```

`OPENAI_MODEL` 设在 `wrangler.toml` 的 `[vars]` 下，可随时改。

## 快速验证

在同账号任意另一个 Worker 里加 service binding：

```toml
[[services]]
binding = "AGENT"
service = "ai-dca-markets-agent"
```

然后：

```ts
const r = await env.AGENT.fetch('http://agent/internal/ping', {
  headers: { authorization: `Bearer ${env.INTERNAL_TOKEN}` },
});
console.log(await r.json());
// => { ok: true, service: 'markets-agent', env: { has_openai_key, ... } }
```

## 部署

CI: `.github/workflows/deploy-worker-markets-agent.yml`。推送到 main 且
`workers/markets-agent/**` 有变动时自动跑。首次部署需 Cloudflare
账户启用 Workers Paid + Containers entitlement（CF Container 是 Paid 独有）。

手动部署：

```bash
cd workers/markets-agent
npm install
npx wrangler deploy
```
