# 雪球行情接入 markets Worker 计划

## 目标
- 将雪球完整 Cookie 支持的 `stock.xueqiu.com` 接口接入 `ai-dca-markets` Worker，A 股 quote/K 线优先使用雪球。
- 当雪球 Cookie 过期或不可用时通知管理员，并自动降级使用新浪源。
- 东方财富仅保留搜索用途，不再作为行情/K 线 fallback。

## 步骤清单
- [done] 梳理 markets Worker 当前 quote/K 线/search 数据流与通知能力。
- [done] 新增雪球 quote/K 线 fetcher 与归一化逻辑。
- [done] 接入 Cookie 失效通知与限频，失败时降级新浪。
- [done] 移除东方财富 quote/K 线 fallback，仅保留搜索。
- [done] 本地语法/烟测验证。
  - node/npm 不在当前环境，使用 git diff --check 与静态引用检查替代。
- [in_progress] 提交并推送，触发 Worker GitHub Actions 部署。
- [todo] 检查 Actions 与线上 Worker 版本。

## 关键决策
- Cookie 不入仓库，运行时从 Worker Secret `XUEQIU_COOKIE` 读取。
- 管理员通知优先通过 `MARKETS_ADMIN_NOTIFY_WEBHOOK` webhook；没有配置 webhook 时只记录日志，不阻断降级。
- 雪球失败时 quote/K 线降级到新浪源；东方财富只用于 `/search?market=cn`。

## 待确认项
- 生产环境需要在 Cloudflare Worker secret 中配置 `XUEQIU_COOKIE`。
- 若要实际推送管理员通知，需要配置 `MARKETS_ADMIN_NOTIFY_WEBHOOK` 或后续指定现有通知 Worker 的内部接口。

## 产出与验证记录
- 已完成代码实现：A 股 quote/K 线/指数/涨跌榜优先雪球，失败降级新浪；东方财富只保留 search。

- `git diff --check` 通过。
- 当前环境未提供 node/npm/bun，无法本地执行 JS 语法检查或 Worker dev；已做静态括号/引用/敏感信息检查。
