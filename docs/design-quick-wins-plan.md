# Design quick wins plan

## Goal
Apply the highest-impact visual quick wins from the screenshot design report for 美股策略助手 without changing business logic.

## Scope
- Global shell / sidebar / ticker readability
- Shared card, tabs, table, button defaults
- Strategy guide warning banner and section spacing
- Holdings empty states and primary action color

## Steps
- [done] Inspect current shell, shared UI, data table, holdings summary, and strategy guide files.
- [done] Implement quick UI wins: spacing, tables, warning banner, add button color, empty states, ticker readability, tab active states, tabular numbers.
- [done] Run focused lint / smoke checks.
- [done] Commit and push a focused UI polish commit.

## Decisions
- Keep changes tactical and low-risk; avoid deep responsive table rewrites in this pass.
- Use indigo as primary brand action color instead of red/rose for neutral create actions.
- Keep GitHub Actions as build/publish source of truth; local full Vite build is not required.

## Validation log
- `npx eslint src/components/experience-ui.jsx src/components/ui/table.jsx src/components/data-table/data-table.jsx src/pages/StrategyGuideExperience.jsx src/pages/HoldingsExperience.jsx src/app/holdingsHelpers.js src/styles/app.css src/styles/console.css` completed with 0 errors. Existing warnings remain in `HoldingsExperience.jsx`; CSS files are ignored by ESLint config.
