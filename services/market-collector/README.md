# Market Collector

Shadow collector for 21 CN exchange funds used by the premium-switch workflow.

Features:
- Python 3 with pinned PyMySQL for optional TiDB replication
- Tencent batch prices
- Eastmoney `push2delay` paginated ETF reference values (`f441`, `f402`)
- Independent price and IOPV timestamps
- Server-computed premium with vendor mismatch checks
- SQLite raw samples plus deterministic 5-minute buckets
- SQLite-primary/TiDB-replica dual writes with a durable SQLite retry outbox
- Five stable logical storage slots that can be reassigned across up to five TiDB targets
- 5-minute OHLC, daily price/NAV candles, and T-1 aligned premium history
- Mini-program-compatible quote, fund-metric, kline, and home aggregate records
- SSE/SZSE trading-calendar scheduling in `Asia/Shanghai`
- Scheduled OTC snapshots for the 81-fund mini-program pool
- Nightly Worker snapshots for purchase/redemption fees, holding fees, and purchase limits

Schedule:

- Exchange quotes: A-share trading days, `09:30-11:30` and `13:00-15:30`
- OTC fund metrics: A-share trading days at `19:30`, `20:30`, and `21:30`
- Fund fees and limits: every calendar day at `22:30` (after the Worker limit-cache refresh)
- Lunch, weekends, and published exchange holidays skip collection
- `latest.json` and `health.json` shadow outputs
- File + Workers publisher with a durable local retry outbox

Replication:

- Set `publisher.backend` to `file+worker` in the runtime config.
- Export `MARKET_COLLECTOR_TOKEN` with the same value as the Workers secret.
- Each committed local snapshot is posted to `/api/markets/collector-ingest`.
- Failed publishes remain in `data/publish-outbox` and replay before the next snapshot.

Database dual write:

- Set `storage_backend` to `dual`; SQLite remains the read source and primary durable write.
- Configure one or more `storage.tidb.targets`. Every logical slot must be assigned exactly once.
- Keep TiDB credentials in root-readable password files, not in JSON configuration.
- Failed TiDB writes remain in SQLite table `replica_outbox` and replay on later cycles.
- Fee/limit snapshots use `fund_reference_snapshots` plus an independent
  `fund_reference_outbox`; TiDB tables keep the same five logical symbol slots.
- To expand from one to five TiDB clusters, backfill the affected logical-slot tables first,
  then move each slot to its new target in configuration. Symbol routing remains stable.

Run once:

```bash
python3 -m market_collector --root services/market-collector --once
```

Run one fee/limit synchronization:

```bash
python3 -m market_collector --root services/market-collector \
  --config services/market-collector/config.json --fund-reference-once
```

Run as a daemon with a JSON config:

```bash
python3 -m market_collector --root services/market-collector --config services/market-collector/config.example.json
```

Read-only verification API:

```bash
python3 -m market_collector.http_server --host 0.0.0.0 --port 18080 \
  --data-dir services/market-collector/data/shadow
```

Endpoints:

- `GET /health`
- `GET /latest`
- `GET /symbols/{code}`
- `GET /klines/{code}?interval=5m|1d&limit=500`
- `GET /nav/{code}?days=365`
- `GET /premium/{code}?interval=5m|1d&limit=500`
- `GET /fund-metrics?codes=513100,513500`
- `GET /otc/latest`
- `GET /aggregates/home-market-overview`
- `GET /aggregates/home-market-series`
- `GET /datasets/{dataset}/{key}`
