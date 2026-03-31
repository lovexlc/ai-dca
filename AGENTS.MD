# Project Workflow

This file defines the default execution flow for agents working in this repository.

## Default Requirement Flow

When the user gives a new requirement, follow this sequence by default:

1. Start in plan mode and confirm the requirement with the user first.
2. Use Stitch to produce the page design or interaction design before coding.
3. Wait for the user's confirmation on the Stitch design.
4. After the design is confirmed, move directly into code implementation without asking for another confirmation.
5. After implementation, use agent-browser to verify the result in the browser.
6. If agent-browser is unavailable, use the closest available browser automation or browser testing fallback and continue verification.
7. After verification passes, commit and push directly without asking the user for an extra confirmation.

## Scope Notes

- This workflow is the default for product and page-related requirements in this repository.
- If a requirement is purely backend, data, or infrastructure work and Stitch is not applicable, explain that briefly during the planning step and continue with the rest of the flow.
- If a higher-priority system, developer, or environment rule conflicts with this file, follow the higher-priority rule and then continue as close to this workflow as possible.

## Mobile UI Guardrails

- Do not compress mobile summary cards by placing title, badge, secondary copy, and status in the same tight row.
- For mobile hero or summary cards, keep the structure layered: title block, badges/actions row, current context row, then metrics.
- Long strategy names must have explicit line-height and enough vertical spacing to wrap naturally. Do not rely on default text leading in dense cards.
- On mobile, badges should wrap to a new line before they squeeze or visually collide with the title.
- Before finalizing a mobile page, check the key summary card in browser automation and verify that text blocks are visually separated rather than stacked into one dense cluster.

## Local Credentials

- Store local GitHub and Cloudflare credentials in `/home/lovexl/ai-dca-stragety/.env.local`.
- Expected variables: `GITHUB_TOKEN`, `GH_TOKEN`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.
- Login shells source `/home/lovexl/ai-dca-stragety/.env.local` via `~/.local/bin/env`, so agents can use these variables directly in new shell sessions.
- Do not copy raw secret values into tracked files or commit them to the repository.
