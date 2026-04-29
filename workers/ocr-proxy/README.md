# OCR Proxy Worker

同源接口 `POST /api/ocr` 和 `POST /api/holdings/ocr`。前端上传截图，Worker 调用
**Cloudflare Workers AI** 本地视觉模型进行结构化提取，返回「持仓明细确认」 /
「当前持仓」表单可直接回填的 JSON。同一个 Worker 还代理东方财富/交所净值接口
（`/api/holdings/nav`）并命中 `caches.default`。

## 一、Workers AI 选型

- 默认模型：`@cf/meta/llama-3.2-11b-vision-instruct`
- 计费：Workers Paid 套餐自带每天 10,000 neurons 免费额度，超出部分按
  $0.011 / 1k neurons 计算。Llama 3.2 11B Vision 单张图约 30~80 neurons，
  10,000 neurons 在轻度使用下足以覆盖一个人的所有截图 OCR 需求。
- 换模型：改 `wrangler.toml` 中 `[vars] OCR_MODEL`，或者在 Dashboard 里覆盖该变量。
  其他可选项例如：
  - `@cf/llava-hf/llava-1.5-7b-hf`：更小、更便宜，复杂表格可能吊精度
  - `@cf/meta/llama-3.2-90b-vision-instruct`：更准但更贵

## 二、本地开发

```bash
npm run worker:dev
```

Workers AI 绑定在 `wrangler dev` 中默认远程调用 Cloudflare 生产模型（会计费）。
本地调试推荐加 `--remote` 或直接走部署后的 worker：

```bash
npx wrangler dev --config workers/ocr-proxy/wrangler.toml --remote
```

另开一个终端启动前端：

```bash
npm run dev
```

Vite 已把 `/api/*` 代理到 `http://127.0.0.1:8787`。

## 三、部署到 Cloudflare Workers

```bash
npx wrangler login        # 首次部署
npm run worker:deploy
```

首次部署后需要在 Dashboard 确认 `ai-dca-ocr-proxy` 打开了 **Workers AI** 权限。
该账号是首次使用 Workers AI，可能需要手动同意服务条款。

不再需要 `OCR_UPSTREAM_API_KEY` Secret；旧部署上可以走：

```bash
npx wrangler secret delete OCR_UPSTREAM_API_KEY --config workers/ocr-proxy/wrangler.toml
```

清除（可选）。

## 四、环境变量

`workers/ocr-proxy/wrangler.toml` 默认值：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `OCR_MODEL` | `@cf/meta/llama-3.2-11b-vision-instruct` | Workers AI 视觉模型 ID |
| `OCR_MAX_TOKENS` | `1500` | 单次推理最多生成的 token |
| `OCR_RETRY_ATTEMPTS` | `1` | 可重试错误的额外重试次数 |
| `OCR_RETRY_DELAY_MS` | `800` | 重试退避初始间隔（线性退避） |
| `HOLDINGS_NAV_CACHE_TTL_MINUTES` | `180` | 净值接口边缘缓存 TTL（与 Workers AI 无关） |

## 五、生产路由

前端调用相对路径 `/api/ocr` / `/api/holdings/ocr` / `/api/holdings/nav`。要求两者之一：

- 站点和 Worker 部署在同一个 Cloudflare 域名下，`/api/*` 路由到这个 Worker（当前走这条路）
- 或者站点本身就在 Cloudflare Pages / Workers 上

如果站点还是 `*.github.io`，`/api/ocr` 相对路径会打到 GitHub Pages 而不是 Worker。

## 六、调试提示

- `/api/health` 返回 Worker 状态和 prompt 版本。
- `/api/ocr` / `/api/holdings/ocr` 返回中 `provider` 为 `cloudflare-workers-ai`，
  `model` 是实际生效的模型 ID。如果与预期不一致，检查是否在 Dashboard 手动覆盖了
  `OCR_MODEL`。
- Workers AI 返回的 JSON 可能被包装在 ```json ... ``` 代码块里，`parseModelResponse`
  会自动剥除包装；如果出现「上游模型返回了无法解析的 JSON」，打开 Workers Logs
  看原始 `payload` 定位。
