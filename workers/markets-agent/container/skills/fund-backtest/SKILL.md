# fund_backtest

Compare historical performance of one or more tickers / funds over a chosen window.

## Inputs

- `symbols` (required): array of strings, 1-5 items
  - US/HK ticker: `QQQ`, `VOO`, `NVDA`, `0700.HK`
  - China OTC fund: 6-digit numeric code, e.g. `110011` (易方达蓝筹精选)
- `range`: `1mo` | `3mo` | `6mo` | `ytd` | `1y` (default) | `2y` | `5y` | `max`
- `interval`: `1d` (default) | `1wk` | `1mo`
- `benchmark`: optional symbol to overlay as reference line (not counted in winner)

## Output

```json
{
  "ok": true,
  "data": {
    "window": { "start": "2025-05-14", "end": "2026-05-14", "trading_points": 252, "interval": "1d" },
    "series": {
      "QQQ": { "cum_return": 0.183, "ann_return": 0.183, "vol": 0.21, "max_dd": -0.087, "sharpe": 0.87 },
      "VOO": { "cum_return": 0.121, "ann_return": 0.121, "vol": 0.16, "max_dd": -0.064, "sharpe": 0.76 }
    },
    "correlation_matrix": { "QQQ-VOO": 0.93 },
    "winner_by_total_return": "QQQ",
    "chart_svg_b64": "PHN2Zy...",
    "raw_csv_path": "/tmp/backtest-<ts>.csv"
  }
}
```

## Data sources

- US / HK Yahoo: `query1.finance.yahoo.com/v8/finance/chart` (uses `adjclose` — splits + dividends adjusted)
- A-share OTC funds: `api.fund.eastmoney.com/f10/lsjz` (单位净值 DWJZ, sorted ascending by date)

## Limitations

- No transaction costs / taxes modeled
- Yahoo data ~15min delayed during US trading hours
- Eastmoney returns 单位净值 (unit NAV); for funds with dividends, this slightly understates total return vs. 累计净值, but is sufficient for relative comparison
- 5 symbol max to keep response payload sane

## Local test

```bash
cd workers/markets-agent/container
echo '{"symbols":["QQQ","VOO"],"range":"1y","interval":"1d"}' \
  | node skills/fund-backtest/scripts/main.js \
  | jq '.data.series, .data.correlation_matrix, .data.winner_by_total_return'
```
