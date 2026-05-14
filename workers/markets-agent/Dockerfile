# Multi-stage build for the markets-agent container.
#
# M1: Node.js HTTP 小服务，返回 /health 和 echo 式 /ask，同时暴露
#     LLM/Tavily key 是否已注入（便于验证 secret 打通）。
# M2: 将 server.js 替换为 OpenClaw runtime 指针，在 entrypoint 脚本里额
#     外 spawn `npx -y tavily-mcp` 作为 MCP 子进程。
FROM node:22-slim AS builder
WORKDIR /app
COPY container/package.json container/package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi
COPY container/ ./

FROM node:22-slim
WORKDIR /app
COPY --from=builder /app /app
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
