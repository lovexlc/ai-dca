# Quant Trading Project Plan

## Goal

Add a new quantitative simulation workspace to the React app. It should include four first-level blocks: simulated account, strategy, trading, and backtest.
Extend it with Xueqiu real-time quote/order-book polling and optional intraday simulated auto-execution.

## Checklist

- done: Find the workspace navigation and page injection points.
- done: Add pure simulation, matching, and backtest helpers.
- done: Build the React page with the four required blocks.
- done: Register the page in the main sidebar navigation.
- done: Add Xueqiu real-time quote polling and intraday auto-execution controls.
- done: Add focused tests for the core helper logic.
- done: Run local verification and record the results.

## Key Decisions

- Build the first version as a simulator using editable bid/ask/IOPV inputs, with optional Xueqiu quote/order-book refresh.
- Model matching conservatively: sell at bid minus slippage, buy at ask plus slippage, limited by level-one quantity, lot size, cash, and current holdings.
- Automatic execution writes simulated fills only. It never sends real broker orders.
- Real-time polling is off by default and can be restricted to A-share trading hours.
- Expose the quant workspace only to analytics administrators.

## Open Confirmations

- None blocking. The initial strategy template is Nasdaq ETF premium spread switching.

## Deliverables

- New app module for quant state, signal evaluation, simulated matching, and backtesting.
- Xueqiu quote/order-book normalization into simulated bid/ask/IOPV fields.
- Real-time panel for manual refresh, intraday polling, auto execution, and daily execution cap.
- New page exposed from the main workspace navigation.
- Unit tests for signal, matching, and backtest behavior.

## Verification

- `node --test test/quantTrading.test.mjs`: passed.
- Targeted `npx eslint ...`: passed with pre-existing warnings in shared files, no errors.
- `npm run check:refactor`: passed.
- `npm run build:app`: passed with existing CSS minify and chunk-size warnings.
- `npm run build`: passed and refreshed `docs/` Pages artifacts with the same existing warnings.
- `npx playwright test quant-trading-smoke.spec.js --project=chromium`: passed; verified admin `?tab=quant`, module switching, simulated buy/sell fills, and non-admin menu hiding.
