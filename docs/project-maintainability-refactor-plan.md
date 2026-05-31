# Project Maintainability Refactor Plan

## Goal

Improve the project maintainability by increasing cohesion, reducing coupling, clarifying module ownership, and making future changes safer to test and deploy. The refactor must be incremental and behavior-preserving unless a specific behavior change is explicitly approved.

## Steps

- done: Define refactor scope, priorities, and acceptance boundaries.
- done: Audit current architecture hot spots: frontend page modules, shared app services, Workers, tests, build/publish workflow.
- done: Identify high-coupling modules and propose phased extraction targets with risk ranking.
- done: Implement phase 1 as a narrow, behavior-preserving refactor with tests/build verification.
- done: Update docs with module ownership and dependency rules.
- done: Complete the Markets watchlist maintainability phase and stop before broader refactors.

## Key Decisions

- Do not attempt a whole-repo rewrite in one pass.
- Prefer behavior-preserving extractions first: shared pure helpers, API clients, storage adapters, UI components.
- Keep frontend Pages publishing and Worker deployment guardrails intact.
- Each phase must have focused tests and build/browser verification before moving on.
- Start with the Markets page because it is one of the largest mixed-responsibility modules and was recently changed.
- Current scope is limited to extracting Markets watchlist UI and pure display helpers; data fetching and state flow stay unchanged.

## Open Confirmations

- None for phase 1.

## Deliverables

- Architecture audit with concrete coupling points.
- A phase-by-phase refactor plan.
- Phase 1 extraction:
  - `src/pages/markets/MarketListTable.jsx` owns the reusable watchlist table UI.
  - `src/pages/markets/marketDisplayUtils.js` owns shared display formatting and sortable metric helpers.
  - `src/pages/MarketsExperience.jsx` keeps page state, orchestration, overlays, and data loading.
- Phase 2 extraction:
  - `src/pages/markets/ExpandedMarketListOverlay.jsx` owns the desktop expanded watchlist overlay and overlay search UI.
  - `src/pages/markets/ListExpandButton.jsx` owns the expand/collapse icon button shared by the page and overlay.
  - `src/pages/MarketsExperience.jsx` continues to own selected market, watchlist state, search state, and all API calls.
- Phase 3 extraction:
  - `src/pages/markets/WatchlistControls.jsx` owns watchlist switching plus create/rename/delete dialog UI.
  - The Markets page now imports watchlist UI modules from `src/pages/markets/` and keeps API/data orchestration local.
- Updated maintainability docs.

## Verification

- `node --test test/*.mjs`: pass, 62 tests.
- `npm run build`: pass.
- Browser mobile `390x844` at `/?tab=markets`: watchlist table headers are `代码, 名称, 最新价, 涨跌幅, 溢价, 年内涨幅, 总份额, 费率, 趋势`; first cell `position: sticky`, `left: 0px`; table width 980, scroller width 382; first-row click selected 1 row.
- Browser desktop `1280x900` expanded watchlist: same table headers; first cell `position: sticky`, `left: 0px`; expanded overlay still renders the `基金搜索` button.
- Browser desktop watchlist selector: visible active label `默认列表`; rename button count 1; create button present.
- Screenshots: `test-results/markets-phase-mobile-watchlist-table.png`, `test-results/markets-phase-desktop-watchlist-table.png`.
