# ai-dca 的 Cloudflare Workers

当前域名分工：

- `freebacktrack.tech`：主站，由 GitHub Pages 承载。
- `api.freebacktrack.tech`：所有 Worker API。
- `tools.freebacktrack.tech`：只保留整站 302，跳转到 `https://freebacktrack.tech`。

当前账号已升级到 **Cloudflare Workers Paid** 套餐（0.5 USD / mo 起步价），本仓库
的 wrangler 配置都规则化开启了 Paid 套餐内置、不另收费的能力：Smart Placement、
拓宽 CPU 上限、Workers Logs / Traces、`nodejs_compat`。

其中 `ai-dca-ocr-proxy` 已切换到 **Cloudflare Workers AI** 调用本地视觉模型（默认
`@cf/meta/llama-3.2-11b-vision-instruct`），不再走外网 OpenAI 兼容服务，也不再需要
API key。Workers AI 是按 neurons 计量的服务：Workers Paid 自带每天 10,000 neurons
免费额度，超出按 $0.011 / 1k neurons 计费（Llama 3.2 11B Vision 单张图大约 30~80
neurons）。其他会额外计费的服务（Queues / DO / D1 / R2 / AI Gateway / Logpush /
Tail Worker 等）本仓库都没用。

| Worker | 路由 | 作用 |
| --- | --- | --- |
| `ai-dca-markets` | `api.freebacktrack.tech/api/markets/*` | 行情、K 线、基金指标、AI 问答。 |
| `ai-dca-notify` | `api.freebacktrack.tech/api/notify*` | 交易计划推送、持仓当日收益、场内切换信号。带 cron + KV (`NOTIFY_STATE`)。 |
| `ai-dca-ocr-proxy` | `api.freebacktrack.tech/api/*` | 调用 Workers AI 视觉模型做 OCR；同时代理东方财富净值/行情接口。 |
| `ai-dca-sync` | `api.freebacktrack.tech/api/sync/*` | 登录、同步、分析事件等云端同步 API。 |
| `freebacktrack-apex-redirect` | `tools.freebacktrack.tech/*` | 将旧 tools 域名 302 到主站，并保留 path/query。 |

## 部署

凭证从 `.env.local` 读取（`CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`）。

```bash
npm run worker:markets:deploy
npm run worker:notify:deploy
npm run worker:deploy
npx wrangler deploy --config workers/sync/wrangler.toml
npx wrangler deploy --config workers/apex-redirect/wrangler.toml
```

本地调试可用对应的 `:dev` 脚本（默认端口各不相同，不会冲突）。

## 验证

```bash
curl https://api.freebacktrack.tech/api/markets/health
curl https://api.freebacktrack.tech/api/health
curl https://api.freebacktrack.tech/api/sync/health
curl https://api.freebacktrack.tech/api/notify/health
curl -I https://tools.freebacktrack.tech/some/path?x=1
```

