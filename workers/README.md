# WebDAV CORS Proxy (Cloudflare Worker)

这个 Worker 专门给 ai-dca 的「数据同步 / 备份」tab 配套使用。浏览器直连坚果云 / Nextcloud 等 WebDAV 会被 CORS 拦下，所以用一个薄薄的 Worker 当中间人。

## 一、本仓库的线上部署

- 脚本：`webdav-cors-proxy`（Cloudflare Workers）
- 路由：`tools.freebacktrack.tech/api/webdav/*`
- 公网 URL：
  ```
  https://tools.freebacktrack.tech/api/webdav
  ```
- 前端在「数据同步 / 备份」tab 的「CORS 代理地址」字段直接填这个地址即可。

这个路径前缀跟现有的 `tools.freebacktrack.tech/api/holdings/nav` / `tools.freebacktrack.tech/api/notify*` 保持一致，所有对外 API 都收敛在一个域名下。

## 二、五分钟重新部署

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
echo '{"main_module":"worker.js","compatibility_date":"2024-12-01"}' > /tmp/metadata.json
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

> Cloudflare Workers 免费版：每日 100,000 次请求，对个人备份来说绰绰有余。

## 三、安全配置（必读）

Worker 脚本开头的 `ALLOWED_ORIGINS` 白名单：

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

## 四、它做什么 / 不做什么

**做：**
- 浏览器 → Worker 这一段由 Worker 返回 `Access-Control-Allow-*`。
- Worker → WebDAV 这一段是普通服务器请求，不受 CORS 约束。
- 透传所有 HTTP 动词（包括 `PROPFIND` / `MKCOL` / `LOCK` 等 WebDAV 动词）和 `Authorization` 头。

**不做：**
- 不缓存、不修改 body、不保存任何凭据。
- 不把请求转到 `ALLOWED_ORIGINS` 之外的来源。

## 五、调用格式

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
