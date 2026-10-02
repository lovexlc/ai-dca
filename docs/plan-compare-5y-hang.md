# 5年对比线卡死修复 Plan

日期：2026-10-02
分支：cn

## 问题

fast.freebacktrack.tech 基金详情页，5年区间的对比线永远加载不出来，页面卡在"正在加载对比线"，表格里对比基金的溢价/价格/净值全是 --。主基金5年曲线正常。两组都复现：510300对比510500、513100对比513500。其他6个区间对比线正常。跨页面 reload 也复现。

## 根因

1. **后端**：`GET /api/markets/kline/510500?tf=1d&limit=1316&market=cn` 返回 HTTP 404 `{"error":"symbol_not_found"}`。510300 同样 404。513100/513500 正常返回 200。主基金 510300 的 5 年曲线能显示是因为浏览器 IndexedDB 里有历史缓存，不是从 live 拉的。

2. **前端**：对比基金 K 线 404 失败后，对比序列的 loading 状态没有正确收敛，UI 持续显示"正在加载对比线"，而不是进入 error 状态（应显示重试按钮）。`MarketSymbolDetailPanel.jsx` 的对比 K 线 effect 和 status 派生逻辑（约 315-390 行、671-720 行）在 K 线失败路径下，loading 标志的清除与 status 判定之间存在时序或条件缺口，导致 `comparePendingSymbols` 非空而 `compareReadyCount` 为 0 的状态被永久保持。

## 修复步骤

1. `src/pages/markets/MarketSymbolDetailPanel.jsx`
   - 对比 K 线 effect：确保所有失败路径（HTTP 404、空结果、异常）都设置 `compareErrorMap[key]=true` 且 `compareLoadingMap[key]=false`，无遗漏分支。
   - status 派生：当 klineError 为 true 且无有效 candles 时，status 必须为 'error'，不得因 navLoading 的残留状态被判定为 'loading'。loading 仅在对应 key 确有 inflight 请求时成立。
   - 检查 `compareLoadingMap` 与 `compareNavHistoryMap` 的 key 一致性，避免 key 失配导致 loading 永远为 true。

2. `src/pages/markets/marketDetailHistory.js`
   - `shouldFetchCompareKline` / `shouldFetchCompareNavHistory`：明确 idle/loading/error 三态，errorArmed 的基金不再自动重试（已有），但要保证 error 状态能正确传递到 UI。

3. 补充测试（`test/` 下对应文件）
   - 对比 K 线 404/失败时，status 收敛为 'error' 而非永久 'loading'。
   - K 线失败但净值成功时，不卡 loading，UI 显示错误态与重试入口。
   - 覆盖 510300/510500、513100/513500 的数据形态回归。

## 风险

- 修改 status 判定条件可能影响其他区间的对比展示，需回归 6 个正常区间。
- 不得新增列表页预取，不得改变缓存边界（AGENTS.md 约束）。
- Worker 端 510300/510500 K 线 404 是独立的后端问题，本次只修前端不卡死；后端 404 另行跟踪。

## 验收标准

自动：
```bash
node --test test/marketDetailHistory.test.mjs test/marketsFundMetrics.test.mjs
npm run check:refactor
npm run lint -- --quiet
git diff --check
```

fast 站手动：
- 510300 加 510500 对比，切 5 年：不再永久"正在加载对比线"，显示错误态或降级态（带重试）。
- 513100 加 513500 对比，切 5 年：同上。
- 其余 6 个区间对比功能不受影响。
- 快速切换区间、删除重加对比，不出现永久 loading。
