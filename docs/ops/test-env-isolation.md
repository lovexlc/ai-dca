# Test / production isolation

Goal: `test.freebacktrack.tech` and `api.freebacktrack.tech` must not share durable state.

## Topology

| Layer | Production | Test |
| --- | --- | --- |
| Frontend | HK / CN Nginx (`main`) | Pages `ai-dca-test` |
| API host | `api.freebacktrack.tech` | `test.freebacktrack.tech` |
| Workers | `ai-dca-*` | `ai-dca-*-test` |
| Markets KV | `MARKETS_KV` | `ai-dca-markets-kv-test` |
| Nav history KV | `NAV_HISTORY_KV` | `ai-dca-nav-history-test` |
| Markets R2 | `ai-dca-markets` | `ai-dca-markets-test` |
| Notify KV | `ai-dca-notify-state` | `ai-dca-notify-state-test` |
| Fund limit KV | `FUND_LIMIT_KV` | `ai-dca-fund-limit-test` |
| Sync D1 | `ai-dca-sync-db` | `ai-dca-sync-db-test` |
| Sync backup KV | `ai-dca-sync-backups` | `ai-dca-sync-backups-test` |
| Vectorize | `ai-dca-kb-v2` | `ai-dca-kb-v2-test` |

Configs: `workers/*/wrangler.test.toml`  
Deploy: `.github/workflows/deploy-test-workers.yml` on branch `test`.

## Intentionally shared

- Cloudflare account / Workers Paid pool (requests, CPU, Workers AI neurons).
- Read-only third-party credentials (e.g. Xueqiu cookie) when the same secret is put on test.

## Cron policy (test is light)

- **markets-test**: CN after-close kline batch only (`30 7 * * MON-FRI`). Production markets also dropped all US crons.
- **notify-test**: three fixed detection windows only. No per-minute WS fan-out.
- **ocr-proxy-test**: no daily fund-limit cron.

## Third-party API failure alert

`markets-test` enables a rolling alert: 10 consecutive third-party request
failures within 5 minutes trigger one admin notification. A successful request
clears the streak, and the next incident can alert again.

The test markets Worker calls the test notify Worker through a private Service
Binding. The notify Worker selects the `lovexl` client from `NOTIFY_STATE` and
delivers this alert through its `serverchan3` (Android) configuration only.
No additional GitHub Actions token is required for this alert path.

## Guard

```bash
node scripts/check_test_env_isolation.mjs
```

CI runs this before deploying test workers. It fails if any test config reuses production KV/D1/R2/Vectorize IDs or `api.freebacktrack.tech` routes.

## Seeding test R2

After isolation, kline history on test is empty until:

1. Cron runs after market close, or
2. Manual admin batch against markets-test (`/api/markets/...` kline-batch endpoints with test admin token).

Do **not** point test bindings back at production R2 to “get data faster”.
