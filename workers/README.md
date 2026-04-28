# ai-dca 的 Cloudflare Workers

这个目录下一共三个 worker，都走 `tools.freebacktrack.tech` 同一个域的 `/api/*` 路由。
当前账号已升级到 **Cloudflare Workers Paid** 套餐（0.5 USD / mo 起步价），本仓库
的 wrangler 配置都金则化开启了 Paid 套餐内置、不另收费的能力：Smart Placement、
拓宽 CPU 上限、Workers Logs / Traces、`nodejs_compat`。不使用会额外计费的服务
（Queues / DO / D1 / R2 / Workers AI / AI Gateway / Logpush / Tail Worker 等）。

| Worker | 路由 | 作用 |
| --- | --- | --- |
| `ai-dca-notify` | `tools.freebacktrack.tech/api/notify*` | 交易计划推送、持仓当日收益、场内切换信号。带 cron + KV (`NOTIFY_STATE`)。 |
| `ai-dca-ocr-proxy` | `tools.freebacktrack.tech/api/*` | OCR 代理到外网 OpenAI 兼容服务。本身走 `cloudflare:sockets` + `caches.default`。 |
| `webdav-cors-proxy` | `tools.freebacktrack.tech/api/webdav/*` | 为「数据同步 / 备份」tab 提供 WebDAV 的 CORS 代理。 |

## 一、部署方式

所有 worker 都可用 wrangler 来部署，凭证从 `/home/lovexl/ai-dca-stragety/.env.local` 读取
（`CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`）。

```bash
# notify
npm run worker:notify:deploy

# ocr-proxy
npm run worker:deploy

# webdav-cors-proxy
npm run worker:webdav:deploy
```

本地调试可用对应的 `:dev` 脚本（默认端口各不相同，不会冲突）。

webdav-cors-proxy 原本是 Dashboard 手工贴贴部署的，现在也已收敛到 wrangler：配置文件
在 `workers/webdav-cors-proxy.toml`，源码在 `workers/webdav-cors-proxy.js`。

## 二、仅限 webdav 代理的 Dashboard / curl 部署备份路径

留底。如果本地 wrangler 不可用，或者只改了一个文件不想装 toolchain：

### 方式 A —— Dashboard 粘贴法

1. 打开 [Cloudflare Dashboard](https://dash.cloudflare.com/) → Workers & Pages → `webdav-cors-proxy` → Edit code。
2. 把本目录下的 [`webdav-cors-proxy.js`](./webdav-cors-proxy.js) 全文覆盖进去 → Save and deploy。
3. 确保 Triggers 里包含路由：
   ```
   tools.freebacktrack.tech/api/webdav/*
   ```

### 方式 B —— API 脚本（无需本地装 wrangler）

```bash
export CF_API_TOKEN=...          # 需要 "Workers Scripts:Edit" + "Workers Routes:Edit"
export CF_ACCOUNT_ID=...
export CF_ZONE_ID=...             # freebacktrack.tech 的 zone id

# 上传脚本
echo '{"main_module":"worker.js","compatibility_date":"2026-03-30","compatibility_flags":["nodejs_compat"]}' > /tmp/metadata.json
curl -sS -X PUT \
  "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/workers/scripts/webdav-cors-proxy" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -F 'metadata=@/tmp/metadata.json;type=application/json' \
  -F 'worker.js=@./webdav-cors-proxy.js;type=application/javascript+module'

# 绑定路由（只需首次）
curl -sS -X POST \
  "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/workers/routes" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"pattern":"tools.freebacktrack.tech/api/webdav/*","script":"webdav-cors-proxy"}'
```

> 如果你走 wrangler 部署（推荐），Smart Placement / Workers Logs / `[limits].cpu_ms`
> 会从 `workers/webdav-cors-proxy.toml` 同步运维过去；Dashboard 手工部署的话
> 请另外手动勾选。

## 三、webdav-cors-proxy 的安全配置（必读）

`webdav-cors-proxy.js` 头部的 `ALLOWED_ORIGINS` 白名单：

```js
const ALLOWED_ORIGINS = [
  'https://tools.freebacktrack.tech',
  'http://localhost:4173',
  'http://localhost:5173',
  'http://127.0.0.1:4173',
  'http://127.0.0.1:5173'
];
```

- 不在名单里的 origin 会得到 HTTP 403，防止被当公共代理。
- 如果你 fork 了项目并换了前端域名，把第一项改掉再重新部署。

## 四、webdav-cors-proxy 做什么 / 不做什么

**做：**
- 浏览器 → Worker 这一段由 Worker 返回 `Access-Control-Allow-*`。
- Worker → WebDAV 这一段是普通服务器请求，不受 CORS 约束。
- 透传所有 HTTP 动词（包括 `PROPFIND` / `MKCOL` / `LOCK` 等 WebDAV 动词）和 `Authorization` 头。

**不做：**
- 不缓存、不修改 body、不保存任何凭证。
- 不把请求转到 `ALLOWED_ORIGINS` 之外的来源。

## 五、webdav-cors-proxy 调用格式

把原始 WebDAV URL 直接拼在 `/api/webdav/` 后面：

```
PROPFIND https://tools.freebacktrack.tech/api/webdav/https://dav.jianguoyun.com/dav/ai-dca-backup/
GET      https://tools.freebacktrack.tech/api/webdav/https://dav.jianguoyun.com/dav/ai-dca-backup/ai-dca-backup.json
PUT      https://tools.freebacktrack.tech/api/webdav/https://dav.jianguoyun.com/dav/ai-dca-backup/ai-dca-backup.json
```

前端 `src/app/webdavBackup.js` 里的 `wrapWithProxy` 会自动拼接，你只需要在 UI 里填写「CORS 代理地址」即可。

> Worker 也兼容 `workers.dev` 直调格式（`<worker>.workers.dev/<target-url>`），本仓库目前没启用该子域，只保留路由模式。

## 六、排查问题

- `403 Origin not allowed` → 前端域名不在 `ALLOWED_ORIGINS`，改脚本重新部署。
- `502 Upstream fetch failed` → 目标 URL 写错，或 WebDAV 服务器本身不可达。
- `400 Bad target URL` → 拼接的目标 URL 不是 `http(s)://` 开头。
- 浏览器仍提示 CORS 报错 → 检查 UI 里填的是 `https://tools.freebacktrack.tech/api/webdav`（注意不要加尾斜杠）。
- 查看最近一次调用记录 → Cloudflare Dashboard → Workers & Pages → 选中对应 worker → Logs（现已全部开启、默认保留 7 天）。
