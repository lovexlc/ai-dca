# 场外基金 D1：定时批量写 + 读写分离

**状态（2026-07-26）**：净值 / 限额均由 **定时批量写**；列表与单只接口 **只读**。

---

## Admin secret（`MARKETS_ADMIN_TOKEN`）是干什么的？

它是 **运维鉴权口令**，不是业务用户登录，也 **不是** 定时任务写 D1 的必需条件。

| 用途 | 说明 |
|------|------|
| 保护 **写/探针** HTTP | 例如 `GET /d1-probe`、`POST /otc-d1-limits`、kline 批写、部分 admin 刷新 |
| 防止公网乱写 | 没有 Bearer 则 401/503，避免任何人往 D1 灌数据 |
| **可选** ocr→markets 推送 | 若 ocr-proxy 也配置同名 secret，日批可 service 调 `/otc-d1-limits`；**主路径不依赖它** |

**定时写 D1 不读这个 secret：**

- 净值：markets `scheduled` 内直接 `env.DB` + 蛋卷  
- 限额：markets `scheduled` 内 `GET` 公网/同域 `/api/fund-limit`（ocr **只读缓存**）再 `upsertOtcFundLimit`

本地 / Dashboard 里 markets **已有** `MARKETS_ADMIN_TOKEN`；ocr-proxy **可以不配**。手工灌库或探针时用：

```bash
curl -H "Authorization: Bearer $MARKETS_ADMIN_TOKEN" .../api/markets/d1-probe
curl -X POST -H "Authorization: Bearer $MARKETS_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"sync-from-cache"}' \
  .../api/markets/otc-d1-limits
```

---

## 1. 读写分离

| 路径 | 职责 | 写 D1？ |
|------|------|---------|
| markets cron 北京 19:30/20:30/21:30 | 蛋卷批量净值 → KV + D1 quote 列 | **写净值** |
| markets cron 北京 20:30 | 读 ocr fund-limit **缓存** → D1 limit 列 | **写限额** |
| ocr-proxy cron 北京 20:00 | 源站/LLM → `FUND_LIMIT_KV`（暖缓存） | 不直接写 D1（可选 push） |
| admin `POST /otc-d1-limits` | 手工 limits 或 `sync-from-cache` | **写限额**（需 secret） |
| `/list-rows`、`/quotes`、`/quote`、`GET /api/fund-limit` | 读 | **不写 D1** |

时序：ocr **20:00** 先暖限额 KV → markets **20:30** 再灌 D1（与当晚第二轮净值 sync 同刻）。

---

## 2. 写入流水线

### 净值

`syncOtcFundsTask` → KV（newer）+ `upsertOtcFundQuote`

### 限额

`syncOtcFundLimitsFromCacheTask`（`otcFundLimitSync.js`）  
→ `GET {FUND_LIMIT_API_BASE}/api/fund-limit?code=`（cache-only）  
→ `upsertOtcFundLimit`

`[vars] FUND_LIMIT_API_BASE`：prod `https://api.freebacktrack.tech`，test `https://test.freebacktrack.tech`

---

## 3. 读取

`/list-rows` OTC 优先 D1，miss 再 KV；不写库。

---

## 4. Schema / 测试

- `migrations/0002_otc_funds_full.sql`（远程已执行）  
- `node --test test/d1Probe.test.mjs test/otcFundD1.test.mjs test/otcFundLimitSync.test.mjs test/fundLimitD1Push.test.mjs`

---

## 测试环境验证（2026-07-26）

**Worker**：`ai-dca-markets-test`（`test.freebacktrack.tech/api/markets/*`）  
**D1**：`ai-dca-markets-db-test` / `otc_funds`

| 检查项 | 结果 |
|--------|------|
| `GET /d1-probe` | `ok:true`，`bound:true`，`otc_funds` 约 81–82 行 |
| OCR POST 暖限额缓存 | 81/81 HTTP 200（test ocr-proxy） |
| `POST /otc-d1-limits` `{"action":"sync-from-cache"}` | `cacheHit=81` `d1Ok=81` `miss=0` |
| `POST /otc-d1-limits` `{"action":"sync-nav"}` | `success=81` `d1Ok=81`（净值列有值） |
| OCR service binding | `env.OCR` → `https://internal/api/fund-limit?...`（与 notify 一致） |

**Admin 手工动作（需 `MARKETS_ADMIN_TOKEN`）**：

```bash
# 限额：ocr 缓存 → D1
curl -X POST -H "Authorization: Bearer $MARKETS_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"sync-from-cache"}' \
  https://test.freebacktrack.tech/api/markets/otc-d1-limits

# 净值：蛋卷 → KV + D1
curl -X POST -H "Authorization: Bearer $MARKETS_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action":"sync-nav"}' \
  https://test.freebacktrack.tech/api/markets/otc-d1-limits
```

**未做**：生产部署（需明确确认后再上）。

---

## 测试读路径切换（`OTC_READ_FROM_D1`）

`wrangler.test.toml` 设 `MARKETS_ENV=test` + `OTC_READ_FROM_D1=1`：

| 读接口 | 行为 |
|--------|------|
| `GET /quotes`、`/quote` OTC | **优先 D1**（含 `fundLimit`），miss 再 KV / 蛋卷 |
| `POST /list-rows` OTC | 已有 D1 优先（任意环境有 DB 即读） |
| 前端场外列表 | 使用 `quote.fundLimit`；仅缺限额时才打 OCR `/api/fund-limit` |

生产默认 **不** 开 `OTC_READ_FROM_D1`（除非显式设 `1`）；无 D1 数据时仍走 KV。

