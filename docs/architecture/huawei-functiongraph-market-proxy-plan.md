# 华为云 FunctionGraph 行情代理落地计划

## 背景

当前行情中心和持仓总览主要通过 Cloudflare Workers 访问行情数据：

- `src/app/marketsApi.js`：行情中心报价、指数、搜索、K 线、基金指标。
- `src/app/navService.js`：持仓总览通过 `fetchFundMetrics()` 获取净值/价格快照。
- `workers/markets`：聚合行情、基金指标、K 线、新闻等接口。

国内用户访问 Cloudflare Workers 和 Upstash Redis 存在跨境延迟。前端直连 Upstash Redis 已验证功能可用，但速度和免费额度都不理想。因此计划引入华为云 FunctionGraph 做国内只读行情聚合代理。

## 目标

第一阶段只优化首屏和高频只读数据：

- 行情中心默认列表加载更快。
- 持仓总览净值/价格快照加载更快。
- 不迁移通知、WebSocket、AI 问答、新闻、财务等复杂功能。
- 前端保留 Cloudflare Workers 作为 fallback。

## 推荐架构

```text
前端 freebacktrack.tech
  -> 华为云 FunctionGraph 国内 HTTP API
       -> DCS Redis / 内存短缓存 / 定时预热 snapshot
       -> 东方财富/新浪/现有 Cloudflare markets API 兜底

fallback:
前端
  -> Cloudflare Workers /api/markets/*
```

第一阶段建议新增 3 类接口：

```text
GET  /api/markets/snapshot/cn-default
GET  /api/markets/snapshot/cn-otc
POST /api/markets/fund-metrics
GET  /api/markets/quotes?symbols=...
```

其中 snapshot 接口优先用于行情中心首屏。`fund-metrics` 同时服务持仓总览和行情中心里的基金数据。

## 与 Cloudflare Workers 的区别

| 项 | Cloudflare Workers | 华为云 FunctionGraph |
|---|---|---|
| 国内访问 | 跨境链路不稳定 | 大陆地域访问更稳 |
| HTTP 入口 | Worker route 直接挂域名 | HTTP 函数或 APIG 触发器 |
| 定时任务 | Worker cron | TIMER 触发器，通常需独立事件函数 |
| Redis | 当前 Upstash REST | 更适合同 VPC DCS Redis |
| KV/R2 | 原生 `MARKETS_KV` / `MARKETS_R2` | 需替换为 DCS Redis / OBS / 数据库 |
| WebSocket | notify 使用 Durable Object | 不适合直接替代 DO 长连接 |
| 生态绑定 | AI、Service Binding、R2、KV | 华为云服务体系，迁移成本高 |

## 迁移难点

1. **不能直接搬 `workers/markets`**

   现有 Worker 依赖 Cloudflare 绑定：

   ```text
   MARKETS_KV
   NAV_HISTORY_KV
   MARKETS_R2
   AI
   AGENT service binding
   ```

   华为云没有这些绑定，需要重写存储层和部分运行时适配。

2. **K 线历史数据不适合首批迁移**

   K 线目前依赖 Worker + R2/KV 缓存。第一阶段保留 Cloudflare 回源，前端 IndexedDB 缓存继续发挥作用。

3. **定时预热要拆分**

   HTTP 函数负责对外请求；定时刷新 snapshot 更适合单独事件函数。不要把定时逻辑和 HTTP 入口强耦合。

4. **国内 Redis 要走 VPC**

   若使用华为 DCS Redis，FunctionGraph 应配置到同 VPC 访问，避免公网 Redis 暴露和额外延迟。

5. **前端跨域**

   华为云函数默认域名与 `freebacktrack.tech` 不同，浏览器请求会跨域，需要正确返回 CORS。

6. **公开 API 无法完全防盗调**

   前端能访问的接口，其他人也能抓包访问。只能通过固定接口、限流、缓存、Origin/Referer 校验降低滥用风险。

## CORS 方案

所有响应都带 CORS。`OPTIONS` 预检直接返回 204。

允许 origin 白名单：

```text
https://freebacktrack.tech
https://tools.freebacktrack.tech
http://localhost:5173
http://127.0.0.1:5173
```

响应头：

```http
Access-Control-Allow-Origin: <matched-origin>
Access-Control-Allow-Methods: GET,POST,OPTIONS
Access-Control-Allow-Headers: Content-Type,Authorization
Access-Control-Max-Age: 86400
Vary: Origin
```

行情接口不需要 cookie，不启用 credentials。

伪代码：

```js
const ALLOWED_ORIGINS = new Set([
  'https://freebacktrack.tech',
  'https://tools.freebacktrack.tech',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

function corsHeaders(origin = '') {
  const allowOrigin = ALLOWED_ORIGINS.has(origin) ? origin : 'https://freebacktrack.tech';
  return {
    'access-control-allow-origin': allowOrigin,
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}
```

## 防滥用方案

### 0. 数据暴露边界

公开给前端的行情接口只返回 UI 正在消费的白名单字段，不返回上游接口完整 raw payload。

规则：

```text
公开接口：quote / fund-metrics / snapshot 的规范化字段
详情接口：只返回详情页需要的精简 data 字段
raw/debug 接口：仅管理员 token 可访问
```

涉及雪球、东方财富等第三方源站时，FunctionGraph 与 Cloudflare Workers 保持同一边界：

```text
不把上游完整响应直接透传给浏览器
不公开资金流、盘口、财务等未被 UI 消费的冗余字段
不把登录态/Cookie 获取到的数据包装成公共 raw API
```

### 1. 固定 snapshot 接口

不要暴露任意 symbol 的自由查询作为首批国内接口。

允许：

```text
/api/markets/snapshot/cn-default
/api/markets/snapshot/cn-otc
/api/markets/snapshot/us-default
```

避免：

```text
/api/markets/quote?symbol=<任意>
/api/markets/search?q=<任意>
```

### 2. Origin / Referer 校验

函数内检查：

```text
Origin
Referer
```

不符合白名单返回 403。该方法可被脚本伪造，只作为辅助，不作为唯一安全边界。

### 3. API 网关限流

如果走 APIG，配置基础限流：

```text
同 IP：60 requests / minute
同 IP：2000 requests / day
```

如果 HTTP 函数默认域名不方便做网关限流，则在 DCS Redis 内做简单 IP 计数：

```text
rate:<ip>:minute:<yyyyMMddHHmm>
rate:<ip>:day:<yyyyMMdd>
```

超过阈值返回 429。

### 4. 服务端密钥

Redis/DCS、上游行情接口密钥只放 FunctionGraph 环境变量或云密钥管理。前端永远不放写权限密钥。

管理型接口必须使用 `Authorization: Bearer <admin-token>`，token 只放服务端环境变量：

```text
POST /api/markets/refresh
POST /api/markets/kline-batch
POST /api/markets/admin/prewarm
GET  /api/markets/debug/*
GET  /api/markets/*?raw=1
```

无 token 或 token 不匹配返回 401；服务端未配置 admin token 返回 503，避免静默放开。

### 5. 缓存优先

snapshot 响应建议缓存 30-60 秒：

```http
Cache-Control: public, max-age=30
```

若接入 CDN/API 网关缓存，优先让相同 snapshot 命中缓存，减少函数和 Redis 请求。

## 数据缓存策略

### Redis/DCS key 设计

```text
snapshot:cn:default
snapshot:cn:otc
snapshot:us:default
fund-metrics:<code>
quote:<market-symbol>
```

### TTL 建议

| 数据 | 交易中 TTL | 非交易中 TTL |
|---|---:|---:|
| snapshot | 30-60 秒 | 10-30 分钟 |
| quote | 60-120 秒 | 1 天 |
| fund-metrics | 60-120 秒 | 1 天 |
| kline | 暂不迁移 | 暂不迁移 |

### 回源顺序

```text
DCS Redis snapshot
  -> Function 内存短缓存
  -> 华为定时预热结果
  -> Cloudflare markets API fallback
  -> 上游行情源
```

第一版可以先不接 DCS，直接使用 Function 内存短缓存 + Cloudflare fallback 验证国内访问速度。

## 前端接入方案

现有 `src/app/marketsApi.js` 已支持运行时覆盖：

```js
window.__MARKETS_API_BASE__
```

可以在 `index.html` 或独立 runtime config 中设置：

```html
<script>
  window.__CN_MARKETS_API_BASE__ = 'https://<function-url>/api/markets';
  window.__MARKETS_API_BASE__ = window.__CN_MARKETS_API_BASE__;
</script>
```

更稳妥的方式是在 API client 内做双路 fallback：

```text
先请求华为云 FunctionGraph
失败/超时 -> 请求 Cloudflare Workers
```

建议超时：

```text
华为云函数：2500ms
Cloudflare fallback：原逻辑
```

## 分阶段实施

### Phase 0：POC

- 创建华为云 FunctionGraph HTTP 函数。
- 使用默认域名，不绑定自有域名。
- 实现 `/health` 和 `/api/markets/snapshot/cn-default`。
- 数据源先回源 Cloudflare `/api/markets/quotes`。
- 增加 CORS、Origin/Referer 校验、基础错误格式。

验收：

```text
curl 函数默认域名 /health 返回 200
国内浏览器访问 snapshot 明显快于直接访问 Cloudflare API
```

### Phase 1：行情中心首屏

- 接入 `snapshot:cn:default`。
- 前端行情中心优先请求华为 snapshot。
- 失败 fallback 到现有 `fetchQuotes()`。
- 保持搜索、详情、K 线仍走 Cloudflare。

验收：

```text
Playwright 打开行情中心
确认首屏 snapshot 请求命中华为云函数
确认失败 fallback 可用
```

### Phase 2：持仓总览

- 实现 `POST /api/markets/fund-metrics`。
- 持仓总览 `getNavSnapshots()` 优先走华为函数。
- OTC/场内基金数据可以先回源 Cloudflare，后续再迁本地缓存。

验收：

```text
持仓总览能加载净值/价格
华为函数失败时仍回落 Cloudflare
```

### Phase 3：DCS Redis 和定时预热

- 创建华为 DCS Redis。
- FunctionGraph 配置同 VPC 访问。
- 新增 TIMER 函数预热 snapshot。
- HTTP 函数只读 snapshot，不做重计算。

验收：

```text
snapshot 主要命中 DCS
函数执行时间稳定下降
上游请求次数显著下降
```

### Phase 4：安全和成本控制

- 接入 APIG 或网关限流。
- 接入函数日志和错误告警。
- raw/debug/刷新/预热触发入口接入管理员 Bearer token。
- 公开响应只输出规范化字段和白名单详情字段，不透传上游 raw payload。
- 统计 95/99 分位延迟、调用次数、出流量。
- 决定是否备案绑定正式域名。

## 不迁移范围

第一阶段明确不迁移：

```text
/api/markets/ask
/api/markets/ask/stream
/api/markets/news
/api/markets/earnings
/api/markets/financials
/api/notify/*
WebSocket / Durable Object
AI / Agents
```

这些继续由 Cloudflare Workers 承担。

## 风险

- 华为云默认域名可用性和跨域策略需实测。
- 国内函数访问海外 Cloudflare fallback 仍可能慢，因此最终要接 DCS/定时预热。
- 免费额度适合 POC 和小规模使用，但高并发需要限流和缓存。
- Origin/Referer 不是强安全边界，不能暴露敏感写接口。
- 绑定自有大陆域名通常需要备案。

## 最小落地任务清单

1. 新建 `workers-huawei/markets-proxy/`，实现可本地运行的 Node HTTP handler。
2. 实现统一响应格式和 CORS。
3. 实现 `/health`。
4. 实现 `/api/markets/snapshot/cn-default`，先回源 Cloudflare。
5. 前端 `marketsApi.js` 增加华为 API 优先、Cloudflare fallback。
6. Playwright 验证行情中心首屏请求华为函数。
7. 接入 `fund-metrics` 后验证持仓总览。
8. 再接 DCS Redis 和 TIMER 预热。
