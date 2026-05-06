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
- 回报时必须附上四件证据：
  - 本地路径 + 行号
  - GitHub commit SHA + 以 SHA 固定的 raw 链接（不要用 `main` 分支 raw，CDN 会缓存）
  - GitHub Actions run URL（`https://github.com/<owner>/<repo>/actions/runs/<id>`）+ 状态 success
  - Worker `Current Version ID`（从 Actions 日志里 `Current Version ID:` 行取，或 wrangler API）
- 用户说“搜不到 / 未生效”时，先复核事实再回话：`git diff HEAD origin/main -- <file>` / `git log origin/main --oneline -- <file>` / 查 Actions run 日志 / `curl -I` 路由验证返回头。
- 升级 wrangler 前先确认 runner Node 版本：wrangler v4 要 Node 22+，目前 workflow 锁 v3 配 Node 20；要升 v4，同步把 `actions/setup-node` 升到 22。
- 不要在本机 1c/512Mi 上跑 `npx wrangler` / `vite` / `esbuild` 等大依赖工具——会被 OOM 或 swap 拖死。本机仅承担 MCP 网关与持久化任务。
- 详细复盘与验证清单：`docs/ops/notify-worker-deploy.md`。
