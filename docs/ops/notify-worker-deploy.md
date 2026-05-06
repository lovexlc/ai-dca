# notify worker 部署流程

## 现行流程：GitHub Actions（推荐）

部署完全由 `.github/workflows/deploy-worker-notify.yml` 执行，runner 在 GitHub `ubuntu-latest`。

### 触发方式
- **自动**：`main` 分支上 `workers/notify/**` 或 workflow 自身有改动时 push 触发
- **手动**：仓库 Actions 页面点 “Run workflow”（`workflow_dispatch`）

### 关键 step
- `cloudflare/wrangler-action@v3`，`wranglerVersion: 3`（避开 wrangler v4 要 Node 22 的硬门槛，Actions runner 默认 Node 20）
- `command: deploy --config workers/notify/wrangler.toml`
- 凭证从 repo secrets 读取：`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`

### 部署证据
- 首次成功部署 run：https://github.com/lovexlc/ai-dca/actions/runs/25414758036
- 部署提交：`939daa9` (workflow), `a5082a6` (bark routes)
- Worker Current Version ID：`c8ba055f-df3e-4db8-8ca8-91d275b30e5c`
- 路由：`tools.freebacktrack.tech/api/notify*`

## 已废弃：本机直接 `npx wrangler deploy`

本机（1c / 512Mi）跑 npx wrangler 反复踩坑，**不再使用**。详情见下方 postmortem。

---

## Postmortem：2026-05-06 切换 CI 部署

### 背景
之前 notify worker 一直用本地 `/root/notion-local-ops-workspace/ai-dca` 工作机直接 `npm run worker:notify:deploy` 部署。本次给 worker 加完 bark 路由（commit `a5082a6`）后，准备走相同流程，结果一路踩坑。

### 时间线
1. **Node 安装 OOM**：本机原本没有 Node。`apt-get install -y nodejs`（NodeSource 20.x）触发
   `dpkg-deb: error: <decompress> subprocess was killed by signal (Killed)`，
   `cannot copy extracted data for './usr/bin/node' to '/usr/bin/node.dpkg-new': unexpected end of file`。
   原因：456Mi RAM、零 swap，dpkg 解压 node 二进制时内存被 OOM killer 杀。
2. **加 swap**：创建 `/swapfile` (2G)、`mkswap`、`swapon`、写 `/etc/fstab`。`apt-get install -y nodejs` 顺利通过，得到 `node v20.20.2 / npm 10.8.2`。
3. **wrangler v4 不兼容**：`npx wrangler@latest deploy` 报
   `Wrangler requires at least Node.js v22.0.0. You are using v20.20.2.`（wrangler 4.88 起要 Node 22+）。
4. **wrangler@3 部署卡死**：改 `npx wrangler@3 deploy`，启动后 30 分钟 stdout 一字未输出，无进程，疑似在小内存下 npx 解依赖被 swap 拖到事实失败。
5. **改走 GitHub Actions**：
   - 新建 `.github/workflows/deploy-worker-notify.yml`，用 `cloudflare/wrangler-action@v3`、固定 `wranglerVersion: '3'`
   - 通过 GitHub REST API + libsodium sealed box 上传 repo secrets
     `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`
   - push commit `939daa9`，paths 命中自动触发
   - run `25414758036` 在 ~25 秒内完成，得到 Version ID `c8ba055f-...`
6. **本机收尾**：设 `vm.swappiness=60` 持久化（`/etc/sysctl.d/99-swappiness.conf`），保留 2G swap 备用，但不再在本机做 worker 部署。

### 教训 / 守则
- **Worker 部署一律走 GitHub Actions**，本机不直接 `wrangler deploy`。Cloudflare 凭证只放在 repo secrets，不依赖工作机 `.env.local`。
- wrangler 升级前先确认 runner Node 版本：v4 要 Node 22+，目前 workflow 锁 wrangler v3，Node 20 即可。后续如要升 v4，同步把 setup-node 升到 22。
- 工作机 1c / 512Mi 跑 npx 类大依赖工具不可行；做 wrangler / vite / esbuild 这些操作至少要 1c / 2G 才稳。本机仅承担 MCP 网关 / 持久化任务即可。
- 任何在本机长跑的命令记得先确认 swap 在线（`free -h`）。
