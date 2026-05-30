# Project Workflow

This file defines the default execution flow for agents working in this repository.

## Default Requirement Flow

When the user gives a new requirement, follow this sequence by default:

1. Start in plan mode for every new request: state the goal, list key steps, identify affected areas and risks, then begin execution.
2. If the plan has unclear points or requires a decision, discuss it with the user first using ask-survey when available, or a direct question when ask-survey is unavailable.
3. For multi-step, multi-file, cross-module, or risky work, write the plan to `docs/<task>_plan.md` before implementation. Follow the location convention used by files such as `docs/income-dashboard-plan.md`.
4. The plan file must include the goal, a step checklist with statuses (`todo` / `in_progress` / `done`), key decisions, open confirmations, deliverables, and verification records.
5. Update the plan file immediately after each completed step: mark the status, add actual output, and append or split steps when the work changes.
6. Use Stitch to produce the page design or interaction design before coding when the requirement is product, page, or UI related.
7. Wait for the user's confirmation on the Stitch design.
8. After the design is confirmed, move directly into code implementation without asking for another confirmation.
9. After implementation, verify the result according to the frontend/backend verification rules below.
10. After verification passes, commit and push directly without asking the user for an extra confirmation.

## Scope Notes

- This workflow is the default for product and page-related requirements in this repository.
- If a requirement is purely backend, data, or infrastructure work and Stitch is not applicable, explain that briefly during the planning step and continue with the rest of the flow.
- Exception: simple answers, one-off information lookup, or one-line-level small edits may be handled directly without creating a plan file.
- If a higher-priority system, developer, or environment rule conflicts with this file, follow the higher-priority rule and then continue as close to this workflow as possible.

## Verification Requirements

- **Frontend changes**: Any change involving pages, components, styles, interaction logic, UI routing, or other frontend layers must be checked in a real browser with the cf-browser tool. Navigate with `goto`, then use `wait_for`, `screenshot`, `get_text`, or `get_markdown` to verify rendering. For interactive flows, reproduce them with `click`, `type_text`, `hover`, `scroll`, or `press_key`, then capture evidence with `screenshot`. For mobile validation, call `set_viewport` first, for example `width:390,height:844,isMobile:true,hasTouch:true`. Call `close_session` after verification.
- **Backend changes**: Any change involving services, Workers, API routes, or data-processing logic must be smoke-tested with `curl` or an equivalent script against the affected interface. Cover a normal request plus at least one error path, such as bad input, missing permission, or a boundary value. Record HTTP status codes and key response fields.
- Before production release, use the deployment environment such as GitHub Actions preview or staging when available. Prefer local smoke tests for logic that can be reproduced locally.
- Final summaries for frontend or backend changes must include verification evidence: screenshots, key rendered text, API responses, or HTTP status codes. Do not report only "verified".

## Mobile UI Guardrails

- Do not compress mobile summary cards by placing title, badge, secondary copy, and status in the same tight row.
- For mobile hero or summary cards, keep the structure layered: title block, badges/actions row, current context row, then metrics.
- Long strategy names must have explicit line-height and enough vertical spacing to wrap naturally. Do not rely on default text leading in dense cards.
- On mobile, badges should wrap to a new line before they squeeze or visually collide with the title.
- Before finalizing a mobile page, check the key summary card in browser automation and verify that text blocks are visually separated rather than stacked into one dense cluster.

## Pages Publishing Guardrail

- This repository's deployed web app is served from `docs/`, not directly from `src/`.
- After any frontend or page behavior change, do not push source-only updates.
- Always regenerate the GitHub Pages artifacts before commit/push.
- Use `npm run build` for normal frontend publishing. This is the safe default because it rebuilds `frontend-dist/` and then syncs `docs/`.
- Only running `npm run publish:pages` is acceptable when `frontend-dist/` has already been rebuilt from the exact source you are publishing.
- If the frontend bundle changed, commit the corresponding `docs/index.html`, `docs/pages/*`, and `docs/react-assets/*` updates together with the source change.
- Treat a frontend task as incomplete if the new behavior only exists in `src/` but has not been published into `docs/`.
- If the user asks to push a frontend fix, assume they expect the live Pages site to update too. Do not stop at pushing `src/` commits only.

## Local Credentials

- Store local GitHub and Cloudflare credentials in `/home/lovexl/ai-dca-stragety/.env.local`.
- Expected variables: `GITHUB_TOKEN`, `GH_TOKEN`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.
- Login shells source `/home/lovexl/ai-dca-stragety/.env.local` via `~/.local/bin/env`, so agents can use these variables directly in new shell sessions.
- Do not copy raw secret values into tracked files or commit them to the repository.

## Worker Deploy Guardrail (必读)

- **Worker 一律走 GitHub Actions 部署，不在本机或工作机执行 `wrangler deploy`。**
  - notify worker workflow：`.github/workflows/deploy-worker-notify.yml`（`cloudflare/wrangler-action@v3`，锁 `wranglerVersion: '3'`）
  - 触发：`main` 分支命中 `workers/notify/**` 或 workflow 自身改动时自动跑；也支持 Actions 页面 `Run workflow` 手动触发
  - Cloudflare 凭证存在 repo Actions secrets：`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`，不依赖本机 `.env.local`
- 修改 `workers/*` 的标准链路：`git commit` → `git push origin main` → 等 GitHub Actions run 跑出绿勾 → 取 Worker `Current Version ID`。
- `apply_patch` 成功 ≠ 已 commit；已 commit ≠ 已 push；已 push ≠ Actions 跑过；Actions 绿了 ≠ 用户能搜到（raw / CDN 缓存）。
- Worker 改动的回报必须附上四件证据：
  - 本地路径 + 行号
  - GitHub commit SHA + 以 SHA 固定的 raw 链接（不要用 `main` 分支 raw，CDN 会缓存）
  - GitHub Actions run URL（`https://github.com/<owner>/<repo>/actions/runs/<id>`）+ 状态 success
  - Worker `Current Version ID`（从 Actions 日志里 `Current Version ID:` 行取，或 wrangler API）
- 用户说“搜不到 / 未生效”时，先复核事实再回话：`git diff HEAD origin/main -- <file>` / `git log origin/main --oneline -- <file>` / 查 Actions run 日志 / `curl -I` 路由验证返回头。
- 升级 wrangler 前先确认 runner Node 版本：wrangler v4 要 Node 22+，目前 workflow 锁 v3 配 Node 20；要升 v4，同步把 `actions/setup-node` 升到 22。
- 不要在本机 1c/512Mi 上跑 `npx wrangler` / `vite` / `esbuild` 等大依赖工具——会被 OOM 或 swap 拖死。本机仅承担 MCP 网关与持久化任务。
- 详细复盘与验证清单：`docs/ops/notify-worker-deploy.md`。
