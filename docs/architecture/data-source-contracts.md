# 数据源与领域边界

本文档记录前端和 Workers 的唯一数据入口，避免同一功能在浏览器、页面组件和 Worker 中各自实现一套口径。

## 行情与搜索

- 列表行情统一调用 `src/app/marketsApi.js` 的 `fetchQuotes` / `fetchWorkerQuotes`，入口为 `markets` Worker 的 `/quotes`。
- 单标的行情复用同一个 Worker `/quotes` 与 `quote:<code>` 缓存；`/quote/:symbol` 只作为批量接口缺失时的兼容兜底。
- K 线统一调用 Worker `/kline/:symbol`，历史大对象由 Worker/R2 处理；列表只消费 `highPoint` 等小元数据。
- 标的搜索统一调用 Worker `/search`。浏览器直连腾讯 Smartbox、Eastmoney K 线和直连行情缓存不再属于生产数据链路。

CN 行情的源站策略由 `workers/markets/src/marketRuntime.js` 统一维护：雪球优先、腾讯兜底；K 线按 Worker 的统一回退策略执行。页面不应重新选择源站。

## 基金数据

- 场内基金实时快照由 `markets` Worker 的 `/quotes` 和 `ExchangeFundHub` 提供；排序列表读取同一份快照。
- 场外基金列表读取 D1 的完整行数据；同步任务负责写入 D1。列表页不再为每只基金额外请求详情级费用/限额接口。
- 场外列表的管理费、赎回费和申购限额来自 D1 列表行；只有用户打开基金比较详情后，才按需使用 OCR Worker 的 `/api/fund-fee`、`/api/fund-limit`。前端网络契约集中在应用层客户端中，列表加载器不再调用详情级费率接口。
- 实时净值快照与历史净值序列是两个有意分层的领域：前者服务列表/持仓刷新，后者服务详情和收益计算，不合并成列表批量历史请求。
- 净值服务实现统一放在 `workers/shared/src/fundNavService.js`：notify 的 `getNav.js` 仅作为兼容 re-export，OCR 不得反向依赖 notify Worker 内部文件。

## 场内/场外识别

代码前缀只能作为无歧义代码的兜底。`161130` 等代码可能同时存在场内 LOF 和场外联接基金，必须优先使用 `fundVenue` / `fundKind` / `assetType` 等上下文；没有上下文时才保留场内专用旧入口的兼容判断。前端展示与回测入口统一复用 `isCnExchangeFundRow`，不要在页面内复制前缀集合。

## 依赖方向

页面负责编排和展示，应用层客户端负责请求、缓存键和响应归一化，Worker 负责源站、并发和服务端缓存，共享域模块只承载跨 Worker 的纯数据服务。新增字段时应沿“Worker schema → 应用层客户端 → 页面模型”向下传递，避免组件直接拼接源站 URL 或重新解释同一字段。
