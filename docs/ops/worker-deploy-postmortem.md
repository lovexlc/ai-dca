# Worker 改代码 / 加日志 复盘与强制 SOP

> 适用范围：本仓库内任何 Worker（`workers/*`）以及任何会被外部消费的代码改动。
> 本文是“红线”级别的工作流约束，下次不要再犯。

## 1. 这次发生了什么
- 在 `workers/ocr-proxy/src/index.js` 加了 `[ocr]` 前缀的 `console.log`，但用户在以下三个地方都搜不到：
  - 本地仓库 working tree（用户那边的副本）
  - GitHub raw 链接
  - 线上 Cloudflare Worker
- 期间多次回复“已经加了 / 已经部署”，把本地 working tree 当成既成事实，没有第一时间确认 commit / push / deploy 三件套全部到位，导致用户反复来回核对，体验非常差。

## 2. 根因
1. 本地修改 ≠ 仓库代码：`apply_patch` 改完后没有立刻 `git commit` + `git push`，远端 GitHub 仍是旧版本，用户看 raw 链接当然搜不到。
2. 本地修改 ≠ 线上 Worker 代码：`wrangler deploy` 上传的是当前磁盘文件；如果忘了某次改动后再部署，或者改完没部署，线上版本就和本地脱节，但 wrangler 仍会显示 “deploy 成功”——成功的是“上一次磁盘内容”，不是“用户期望的内容”。
3. 沟通错误：用户多次说“搜不到”，应该第一时间去 `git log` / `git diff origin/main` / 拉远端 raw 自查，而不是先“解释 / 辩解”。

## 3. 强制 SOP（任何 Worker 或会被外部消费的代码改动都必须按此执行）

### 3.1 改完立刻提交并推送
```
git status
git add -A    # 或精确加文件
git commit -m "<conventional commit message>"
git push origin main
git rev-parse HEAD     # 记录 commit SHA，作为“远端已同步”的证据
```

### 3.2 再部署 Worker（如适用）
```
npx wrangler deploy --config workers/<name>/wrangler.toml
```
记下输出里的 `Current Version ID`，作为“线上已同步”的证据。

### 3.3 回报时三件证据齐全
- 本地路径 + 行号（`apply_patch` 命中位置）
- GitHub commit SHA + **固定 SHA 的 raw 链接**（不要用 `main` 分支 raw，可能被 GitHub CDN 缓存）：
  `https://raw.githubusercontent.com/<owner>/<repo>/<COMMIT_SHA>/<path>`
- Worker Version ID + 路由

### 3.4 用户说“搜不到 / 没生效”时的第一反应
- 不要先解释 / 辩解，先复核事实：
  - `git diff HEAD origin/main -- <file>`
  - `git log origin/main --oneline -- <file>`
  - `npx wrangler deployments list --config workers/<name>/wrangler.toml`
- 拿到事实后再回话。

### 3.5 把每个阶段当作独立检查点
- `apply_patch` 成功 ≠ 已 commit
- 已 commit ≠ 已 push
- 已 push ≠ 已部署
- 已部署 ≠ 用户能搜到（GitHub raw / 浏览器 / Cloudflare 都可能有缓存或版本切换延迟）

## 4. 验证清单（每次 Worker 改动结尾必做）
- [ ] `git push` 成功，commit SHA 已记录
- [ ] `wrangler deploy` 成功，Version ID 已记录
- [ ] 用 commit SHA 固定的 raw 链接复核关键关键字（如本次的 `[ocr] calling Workers AI`）
- [ ] `wrangler tail` 触发一次真实请求，确认日志/行为符合预期
- [ ] 把以上 4 条作为结尾回复发给用户，不只是“已完成”

## 5. 日志命名约定
- 所有 worker 内置 `console.log` 必须带统一前缀，方便 grep：`[ocr]`、`[notify]`、`[webdav]` 等。
- 只打“可定位事实”：模型名、请求 ID、关键负载形状（keys / 前 240 字符采样），不要打整段图片字节或敏感字段。
