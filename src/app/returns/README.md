# Return calculation contract

`calculateGroupReturn({ transactions, from, to, scope = 'exchange', pricesByCode,
maxPriceAgeDays = 7 })` is a pure offline calculation. Supply the **complete**
ledger, including counterpart legs outside the window and scope. No network,
storage, UI or current clock is consumed.

The requested interval is inclusive `[from, to]` in Shanghai calendar dates.
Opening valuation is the prior calendar day's close; closing valuation is `to`.
Dated prices may fall on an earlier trading day, never after the boundary.
Timezone-qualified transaction timestamps are converted to Shanghai dates.
Same-day replay uses BUY before SELL, then ID, matching the existing ledger.
Assets are keyed by `kind:venue:code`; venue defaults to an empty string.

`pricesByCode` maps an asset key (preferred) or fund code to observations:
`[{ date: '2025-01-31', price: 12.1, source: 'import', adjusted: false }]`.
Only positive finite, unadjusted historical prices are supported. An explicit
maximum price age prevents unlimited forward filling; callers with verified
holiday coverage can supply a larger bound. Current undated snapshots cannot
substitute for history. Boundary diagnostics retain actual price dates/sources.

Transactions reuse Basics normalization, preserve ID/kind/pair references and
venue, and report invalid data, missing dates, duplicate IDs and amount versus
price-times-shares differences. `amount` takes precedence over derived amount.
Fee treatment is unknown in this ledger, so valid group results are marked
`estimated`. This is a BUY/SELL price return; it does not assert dividend-inclusive
total return. Pending transactions block calculation in the selected scope.

Pairs are resolved globally as one-to-one undirected references. Same-day
eligible flows net within the selected scope. Cross-scope pair legs are excluded
from offset reporting. Valid cross-day internal pairs transfer the lesser leg
amount to a bridge from sell-day close through the day before buy-day close.
Residual leg amounts remain group flows. Dangling, ambiguous or invalid pairs
block the final rate instead of silently claiming complete internalization.

Outputs distinguish `start/endMarketValue`, `start/endBridgeValue`, and
`start/endValue`. `dailyFlows` includes original normalized transactions and
netting audit amounts; `switchPairs` and `bridgeEvents` explain the bridge.
Positive flow means investment into the group. Modified Dietz profit is closing
assets minus opening assets minus net investment. Weights assume end-of-day
flows, using actual calendar days from opening valuation to closing valuation.
Rates are decimals. Incomplete results have `returnRate: null`, `reason`, and
structured `diagnostics`; a computed genuine zero return remains zero.

The lower-level modules accept normalized transactions. `validateReturnInputs`
validates the object returned by `normalizeReturnInputs`. `buildSharesTimeline`
returns closing holdings after each ordered transaction. `resolveEffectiveWindow`
returns the requested calendar window without silently shifting dates.
`valueAtBoundary` values only nonzero holdings and never sums a partial portfolio
as a complete market value.

`calculateModifiedDietz` takes numeric start/end values, opening/closing dates
(`from`, `to`) and `cashFlows: [{ date, amount }]`. `calculateTwr` requires
consecutive daily `valuations: [{ date, value }]`, complete end-of-day flows and
optional opening/closing `from/to` constraints; sparse endpoints are insufficient.
`solveXirr([{ date, amount }])` uses investor signs (investment negative), merges
same-day cents and returns an annualized decimal rate. It reports multiple roots,
zero duration and missing signs. Root isolation includes tangent roots within
`log(1+r)` in [-30, 30]; no root in that finite range is reported explicitly.

Run deterministic tests with `node --test test/returns/`.