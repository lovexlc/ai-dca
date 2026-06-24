# A股行情与净值缓存预热计划

## 目标
降低 A股行情中心对不稳定 Eastmoney 路径的依赖：Sina 继续作为 quote/K线主源；quote 失败时优先返回旧 KV 缓存；K线失败时优先返回旧 R2 缓存；增加 scheduled 预热任务，把核心 A股/ETF 的 quote、K线、净值相关数据预热到 KV/R2。

## 步骤清单
- done：检查 workers/markets 当前路由、存储、wrangler cron 配置和可复用函数。
- done：确认本地没有 ALPHA_VANTAGE_API_KEY，本轮不接 Alpha Vantage。
- in_progress：实现 quote stale cache fallback，避免 Sina 短暂失败直接影响 UI。
- todo：实现 K线 stale R2 fallback，再把 Eastmoney 降级为最后兜底。
- todo：新增 scheduled 预热核心 A股/ETF quote 与 K线缓存。
- todo：在 markets worker 内新增基金 NAV history/latest 缓存接口，并用 cron 预热常用 ETF。
- todo：执行静态检查，检查 diff。
- todo：提交 focused commit。

## 关键决策
- 不在本机执行 wrangler deploy；部署仍走 GitHub Actions。
- 不引入 Alpha Vantage；免费版额度不适合作为行情主源，且本地未发现 API key。
- 先做无新增 secret 的稳定性改造。
- Sina 是 A股 quote/K线主源；Eastmoney 降级为 K线最后兜底、基金 NAV 源通过 R2/KV 缓存隔离不稳定性。

## 待确认项
- 无。

## 产出与验证记录
- 已确认 workers/markets 绑定 MARKETS_KV 与 MARKETS_R2，可直接用于 quote/K线/NAV 缓存。
- 待补充代码路径和验证结果。
