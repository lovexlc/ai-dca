# A股行情 ETF 功能补齐计划

## 目标
- A股选项具备与美股选项一致的核心交互：左侧列表点击后，中间详情覆盖原内容，右侧研究面板聚焦对应标的。
- A股默认监控列表内置纳指 ETF 与标普 500 ETF。

## 步骤清单
- [done] 检查行情中心 watchlist 与详情交互实现。
- [done] 增加 A股默认 ETF 列表与本地 watchlist 迁移。
- [done] 打开 A股侧边搜索/列表功能，保留美股财报/财务等仅美股能力边界。
- [done] 本地检查并提交推送。

## 实现记录
- `markets:watchlist:v1` 增加一次性默认迁移版本，A股默认加入：
  - `513100` 纳指 ETF
  - `513500` 标普 500 ETF
- 默认迁移只在无版本或旧版本时补齐；用户后续删除默认标的后不会反复被重新添加。
- A股侧边栏已打开与美股相同的搜索/添加入口。
- A股监控列表点击后复用既有详情面板：中间区域覆盖原内容，右侧研究面板聚焦当前标的。
- A股详情保留概览/走势图/研究入口；财报/财务 tab 继续仅美股显示。

## 验证记录
- `npx eslint src/app/marketsApi.js src/pages/MarketsExperience.jsx`：通过，0 errors；保留既有 warning。
- `git diff --check -- src/app/marketsApi.js src/pages/MarketsExperience.jsx docs/markets-cn-etf-parity-plan.md`：通过。
- `npm run lint -- src/app/marketsApi.js src/pages/MarketsExperience.jsx` 会被项目既有全局 lint error 阻断；本次文件的 focused eslint 已通过。
- `npm run build:app` 默认 Node 堆内存 OOM；提高堆内存的本地构建在工具超时时间内未返回。最终以前端 GitHub Pages Action 为准。

## 热修记录：513xxx ETF 前缀识别
- 问题：`513100` / `513500` 裸代码被自动识别为 `sz513100` / `sz513500`，东方财富 secid 错误，导致报价和 K 线返回空数据。
- 修复：A股裸代码识别中将 `51` / `56` / `58` 开头 ETF/基金映射为上交所 `sh`；`15` 等继续按深交所 `sz`。
- 影响：A股行情页默认的纳指 ETF、标普 500 ETF 会走正确的 `sh513100` / `sh513500` 数据源。
