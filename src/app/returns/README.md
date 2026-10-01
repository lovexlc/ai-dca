# Fund portfolio interval returns (V2)

`calculateGroupReturn` is a pure offline API. It does not fetch history, modify the
ledger or write into the legacy `twrReturnRate` field. Supply the complete ledger,
`from`, `to` (Shanghai calendar dates), and `pricesByCode`. No list-render requests
or new price clients are introduced by this module.

Scopes: `exchange`, `otc`, `qdii`, `otc+qdii` (the OTC portfolio), and `mixed`.
Existing arrays of kinds are also accepted. Listed QDII ETFs remain exchange.
Mixed merges raw holdings and daily flows and calculates its own Dietz return;
it never averages subgroup rates or weights them by ending market values.

Assets include fund positions only, excluding cash, interest and receivables.
Daily net inflow is every BUY amount minus every SELL amount in the scope.
Pair IDs are ignored. Same-day equal trades net to zero; cross-day trades keep
both dated flows. There are no switch pairs or bridge assets in the output.
`offsetAmount` is only the daily arithmetic minimum of buys and sells.
`startValue`/`endValue` are aliases for pure fund market values.

Profit is `V1 - V0 - N`. Modified Dietz uses
`D = V0 + sum((to - flowDate) / (to - t0) * flowAmount)`, `R = profit / D`,
where `t0` is the calendar day before `from`. Trades include both window endpoints
and occur at day-end. A first-day flow in a 31-day window has weight 30/31;
a last-day flow has weight zero. A nonpositive denominator preserves independently
verifiable profit and flows but yields a null rate. Rates are unrounded decimals;
amounts are cents, shares retain up to eight decimal places and weighted denominators
are not rounded. Price-record dates never replace the actual valuation boundaries.

Prices are numeric unit NAV or unadjusted exchange closes. Entries may use `date`,
`navDate` or `priceDate` (NAV ownership date takes priority). `publishedAt` is audit
metadata, never an extra lag. `source`, `fetchedAt`, dates and quality are retained.
Asset-key entries (`kind:venue:code`) take priority over code entries. Future,
adjusted, accumulated, invalid or stale observations cannot complete a valuation.
Zero holdings need no price. Any missing nonzero asset makes the whole boundary
null, and profit/rate remain null with diagnostics.

`windowMode: 'historical'` is the deterministic default and keeps the requested
boundary. OTC/QDII must have boundary NAV or verifiable closure coverage; it does
not silently fill abnormal missing disclosures. Exchange history accepts a bounded
price age (`maxPriceAgeDays`, default 7), without changing the ledger boundary.
`closedDatesByAsset` maps asset keys to explicitly verified closed calendar dates;
every intervening date must be covered to carry NAV forward. This is supplied
calendar evidence, not an inferred global or overseas holiday calendar.

For current windows, explicitly pass `windowMode: 'current'`. Actual available
OTC/QDII NAV determines a common cutoff for OTC and mixed, including new positions
near the requested boundary and positions still held at the resulting cutoff.
Mixed truncates exchange transactions and closes to that same date. If the cutoff
precedes `from`, the result is null (`no_calculable_window`). Optional
`expectedNavDatesByAsset` supplies source/calendar-verified expected ownership dates;
a missing expected disclosure blocks with `missing_nav_disclosure`. An expected
QDII date must not be guessed by applying a universal T+1 rule. No clock is read.

Transactions require identity, valid type/date, actual shares and positive amounts.
Explicit amount wins; otherwise price times shares is used. Cost overrides never
supply flows. Fees remain estimated. OTC confirmation is rebuilt on the existing
`date` and marked estimated. `pending: true`, `status: 'pending'`, `confirmed: false`
or `confirmationDateUnknown: true` blocks an affected window (provisional/null).
Later events outside the effective window do not block that window. Missing dates
cannot be silently placed outside it. Foreign-currency inputs are rejected; no FX
conversion is inferred. Explicit unrecorded distributions/share adjustments block
publication; otherwise these are price returns based on BUY/SELL, not full total
returns including dividends. TWR and XIRR remain independent unused math utilities.