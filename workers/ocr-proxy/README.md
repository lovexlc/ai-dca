# OCR Proxy Worker

这个 Worker 提供同源接口 `POST /api/ocr`，由前端上传截图，Worker 再使用 Workers Secret 中的上游 API key 调用 OpenAI 兼容视觉接口。

## 本地开发

1. 复制配置：

```bash
cp workers/ocr-proxy/.dev.vars.example workers/ocr-proxy/.dev.vars
```

2. 填入上游 API key：

```bash
OCR_UPSTREAM_API_KEY=your-upstream-api-key
```

3. 启动 Worker：

```bash
npm run worker:dev
```

4. 另开一个终端启动前端：

```bash
npm run dev
```

Vite 已经把 `/api/*` 代理到 `http://127.0.0.1:8787`。

## 部署到 Cloudflare Workers

1. 登录 Wrangler：

```bash
npx wrangler login
```

2. 写入 Secret：

```bash
npx wrangler secret put OCR_UPSTREAM_API_KEY --config workers/ocr-proxy/wrangler.toml
```

3. 部署：

```bash
npm run worker:deploy
```

## 生产路由

前端现在固定调用 `/api/ocr`，所以生产环境需要满足以下任一条件：

- 站点和 Worker 部署在同一个 Cloudflare 域名下，并把 `/api/*` 路由到这个 Worker
- 或者站点本身就部署在 Cloudflare Pages / Workers 上

如果站点仍然直接使用 `*.github.io` 域名，就不能原样使用相对路径 `/api/ocr`。

## 默认上游配置

`workers/ocr-proxy/wrangler.toml` 已内置以下默认值：

- `OCR_UPSTREAM_BASE_URL=http://xxx:2095/v1`
- `OCR_UPSTREAM_MODEL=gemini-3-flash-preview`

API key 不写入仓库，只通过 `OCR_UPSTREAM_API_KEY` Secret 或本地 `.dev.vars` 注入。
