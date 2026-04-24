# WebDAV CORS Proxy (Cloudflare Worker)

这个 Worker 专门给 ai-dca 的「数据同步 / 备份」tab 配套使用。因为浏览器会被 CORS 拦下直连坚果云 / Nextcloud 等 WebDAV 服务器的请求，用这个 5 行代码的 Worker 做中间人就能绕过。

## 一、五分钟部署（推荐：Dashboard 粘贴法）

1. 打开 [Cloudflare Dashboard](https://dash.cloudflare.com/) → 左边栏「Workers & Pages」→ Create → Create Worker。
2. 随便起个名字，例如 `webdav-proxy`，点 Deploy。
3. 部署后点 Edit code，删掉占位内容，把本目录下的 [`webdav-cors-proxy.js`](./webdav-cors-proxy.js) 全文粘进去→ Save and deploy。
4. 你会得到一个自己的 Worker 域名，像：
   ```
   https://webdav-proxy.<your-account>.workers.dev
   ```
5. 回到 ai-dca 的「数据同步 / 备份」tab，把这个 URL 填进「CORS 代理地址」字段，点「保存配置」→「测试连接」即可。

> Cloudflare Workers 免费版：每日 100,000 次请求，远远足够。

## 二、安全配置（必读）

Worker 脚本开头有一个 `ALLOWED_ORIGINS` 白名单，默认只放行：

```js
const ALLOWED_ORIGINS = [
  'https://lovexlc.github.io',
  'http://localhost:4173',
  'http://localhost:5173',
  'http://127.0.0.1:4173',
  'http://127.0.0.1:5173'
];
```

- 如果你 fork 了项目，把第一项换成你自己的 GitHub Pages 域名（精确到 origin，不加路径 / 不加尾斜杠）。
- 不在名单里的 origin 会得到 HTTP 403，避免被当公共代理乱用。

## 三、它做什么 / 不做什么

**做：**
- 浏览器 → Worker 那一段由 Worker 负责返回 `Access-Control-Allow-*`。
- Worker → WebDAV 那一段是普通服务器请求，不受 CORS 约束。
- 透传所有 HTTP 动词（包括 PROPFIND / MKCOL / LOCK）和 `Authorization` 头。

**不做：**
- 不缓存、不修改 body、不保存任何凭据。
- 不把请求转到 `ALLOWED_ORIGINS` 之外的来源。

## 四、调用格式

客户端把原始目标 URL 拼在 Worker URL 后面，中间用一个 `/` 分隔。例：

```
GET https://webdav-proxy.xxx.workers.dev/https://dav.jianguoyun.com/dav/ai-dca-backup/ai-dca-backup.json
PROPFIND https://webdav-proxy.xxx.workers.dev/https://dav.jianguoyun.com/dav/ai-dca-backup/
```

前端代码里的 `rewriteUrlViaProxy` 会自动做这件事，你只需要在 UI 里填写「CORS 代理地址」即可。

## 五、排查问题

- `403 Origin not allowed` → 把你的前端域名加到 `ALLOWED_ORIGINS`，重新 Deploy。
- `502 Upstream fetch failed` → 目标 URL 写错，或 WebDAV 服务器本身不可达。
- 浏览器控制台仍提示 CORS 报错 → 确保填的是 Worker URL，不是原始 WebDAV URL。
