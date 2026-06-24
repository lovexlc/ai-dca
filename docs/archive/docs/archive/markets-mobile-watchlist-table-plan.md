# Markets Mobile Watchlist Table Plan

## Goal

Make the mobile app-side Markets watchlist use the same tabular layout as the expanded desktop watchlist, replacing the current card rows. The first column should stay fixed while horizontally scrolling the remaining metrics.

## Steps

- done: Inspect the existing desktop expanded watchlist table and mobile card implementation.
- done: Refactor the shared watchlist table component so mobile can render the compact table with a sticky first column.
- done: Replace mobile watchlist card rows with the compact sticky table while preserving actions and search/add affordances.
- done: Build and run focused browser checks for desktop and mobile layouts.
- done: Record verification evidence.

## Key Decisions

- Stitch is not available in this environment, so the implementation will reuse the current PC expanded watchlist table as the design source.
- The mobile table should use horizontal scrolling for metrics and `position: sticky` for the first symbol/name column.
- Keep existing watchlist actions: select symbol, remove, and AI analysis where available.

## Open Confirmations

- None.

## Deliverables

- Updated Markets watchlist mobile layout.
- Rebuilt frontend Pages artifacts if source changes require it.
- Verification notes and screenshots/text evidence.

## Verification

- `node --test test/*.mjs`: passed, 9 tests.
- `npm run build`: passed; Vite built 2733 modules and `publish_react_pages.mjs` completed.
- Mobile Playwright `390x844` on `/?tab=markets`: monitor list rendered a table with headers `代码|名称|最新价|涨跌幅|溢价|年内涨幅|总份额|费率|趋势`; first body cell computed style `position: sticky`, `left: 0px`; table width `980`, scroller width `382`; clicking the first row opened details. Screenshot: `test-results/markets-mobile-watchlist-table.png`.
- Desktop Playwright `1280x900` expanded watchlist: same headers rendered; first body cell computed style `position: sticky`, `left: 0px`. Screenshot: `test-results/markets-desktop-watchlist-expanded-table.png`.
