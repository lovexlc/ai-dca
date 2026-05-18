# App large-number layout fix plan

## Goal
Fix mobile layout overflow/truncation issues when portfolio, P&L, shares, market value, and transaction amounts become very large. The screenshot issue is in 持仓分析, but the fix should be applied consistently across similar app-side portfolio/income surfaces.

## Scope reviewed
- `src/app/income/IncomeBreakdownPage.jsx`
- `src/app/income/IncomeSummary.jsx`
- `src/app/income/IncomeDetailPage.jsx`
- `src/app/income/DailyFundBreakdown.jsx`
- `src/app/income/IncomeTransactionsPage.jsx`
- `src/app/income/IncomeLiquidationPage.jsx`
- `src/pages/HoldingsExperience.jsx`

## Fix strategy
- Add `min-w-0` to grid/flex containers and children that hold long numeric content.
- Use `truncate`, `whitespace-nowrap`, and `tabular-nums` on large currency / percentage / share values.
- Use `minmax(0, 1fr)` grid tracks where side-by-side numeric columns previously could force overflow.
- Reduce some mobile font sizes while preserving larger `sm` breakpoints.
- Keep all data calculations and formatting logic unchanged.

## Status
- [done] Locate affected app-side portfolio/income UI areas.
- [done] Apply consistent large-number overflow protections.
- [done] Fix existing legend swatch inline style JSX while touching `IncomeBreakdownPage.jsx`.
- [done] Run targeted ESLint on changed source files: passed with 0 errors; existing warnings remain in pre-existing files.
- [skipped] Node build: skipped per user request “别用node build”.
- [done] Browser verification: unavailable in this agent connection set; no browser MCP connector is exposed in `connections.ts`.

## Verification commands
```bash
npx eslint src/app/income/IncomeBreakdownPage.jsx src/app/income/IncomeSummary.jsx src/app/income/IncomeDetailPage.jsx src/app/income/DailyFundBreakdown.jsx src/app/income/IncomeTransactionsPage.jsx src/app/income/IncomeLiquidationPage.jsx src/pages/HoldingsExperience.jsx
```

Result: exit code 0, 0 errors, existing warnings only.
