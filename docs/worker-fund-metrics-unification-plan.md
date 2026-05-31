# Worker Fund Metrics Unification Plan

## Goal

Unify Worker-side fund price, NAV, IOPV, and premium retrieval through the markets Worker `fund-metrics` endpoint. The only live upstream for these metrics should be the markets Worker path, which uses Xueqiu as the primary source. If Xueqiu is unavailable, intraday/minute-level live data may be missing, while historical NAV/price should continue to rely on existing KV/cache data.

## Steps

- done: Audit current Worker live metric paths and identify non-markets sources.
- done: Add a shared Worker client for `POST /api/markets/fund-metrics` and normalized legacy-compatible output.
- done: Route notify Worker live NAV/price snapshots through the shared markets metrics client, preserving KV reads.
- done: Route ocr-proxy `/api/holdings/nav` live snapshots through the shared markets metrics client, preserving edge/baseline caches.
- done: Add direct `MARKETS` service bindings so Worker-to-Worker calls avoid same-zone `/api/*` route collisions.
- done: Keep the NAV access guard focused on source/Worker code by ignoring archived generated React assets.
- done: Run syntax/tests/build or focused Worker smoke checks and record results.
- done: Deploy changed Workers directly with local Wrangler and collect version evidence.

## Decisions

- Existing KV/cache reads remain valid and are not replaced by fresh upstream calls when they are fresh enough.
- Live refreshes use `markets/fund-metrics`; old direct `latest-nav.json`, Eastmoney, and Sina branches should not be used as separate live metric sources outside markets.
- Xueqiu failure should not fan out into different live-source branches. The markets endpoint may still return cached/marked fallback fields if that is its explicit contract.

## Open Items

- None.

## Verification

- `node --check workers/notify/src/getNav.js`: passed.
- `node --check workers/notify/src/index.js`: passed.
- `node --check workers/notify/src/switchStrategy.js`: passed.
- `node --check workers/ocr-proxy/src/index.js`: passed.
- `node scripts/check_nav_access.mjs`: passed.
- `node --test test/dailyFundBreakdown.test.mjs`: passed.
- Initial production smoke found `/api/holdings/nav?codes=510300&force=1` returning item error `fund-metrics 请求失败：HTTP 405`, caused by same-zone Worker route collision. Added direct `MARKETS` service binding and will redeploy/retest.
- `wrangler deploy --config workers/notify/wrangler.toml`: success, Current Version ID `399f9282-039f-45d9-b74f-6f263c838252`.
- `wrangler deploy --config workers/ocr-proxy/wrangler.toml`: success, Current Version ID `21814b7d-918c-4e0b-87d8-ba265c39fa8e`.
- Production smoke `POST /api/markets/fund-metrics?refresh=1` with `510300,513100`: HTTP 200, `successCount=2`, `source=xueqiu-quote`, `premiumPercent` present.
- Production smoke `GET /api/holdings/nav?codes=510300&force=1`: HTTP 200, `successCount=1`, `source=xueqiu-quote`, `fundLatestNav=4.915`, `premiumPercent=0.1`.
- Production smoke `GET /api/holdings/nav?codes=abc&force=1`: HTTP 400, error `请求中缺少有效的 6 位基金代码。`.
- Production smoke `GET /api/notify/switch/test-nav`: HTTP 200, `success=true`, `data.source=xueqiu-quote`, `premiumPercent=10.39`.
