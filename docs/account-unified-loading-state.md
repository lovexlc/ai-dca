# 账号操作的统一加载态

## 一、转发层确认结论

目标：确认「用户相关操作」（列表/数据加载、删除、保存/更新）都汇聚到 `src/app/accountApi.js`，底层统一走 `src/app/apiTransport.js` 的 `fetchWithGetRetry`。

| 类别 | 入口 | 结论 |
| --- | --- | --- |
| 转发层 | `accountApi.js` 的内部 `request()` → `performRequest()` → `fetchWithGetRetry` | ✅ 所有导出函数都从这一个出口发请求；资源类请求再经 `requestAccountResource()` 过一遍登录态 + `assertLegacyMigrationSettled` 门禁 |
| 列表/数据加载 | `fetchAccountManifest`、`fetchAccountBundle`、`fetchAccountResource`、`fetchAccountResourceHistory` | ✅ 全部走转发层 |
| 列表/数据加载（同步器） | `resourceSync.js`（`pullAccountResources` 等）、`cloudSync.js` | ✅ 只调用 `accountApi` 导出函数，自己不发请求 |
| 列表/数据加载（交易行） | `holdingTransactionsSync.js` → `holdingTransactionsApi.fetchHoldingTransactionRows` | ⚠️→✅ 原先 `holdingTransactionsApi.js` 自己拼 base + 裸 `fetch`，**绕过了 `fetchWithGetRetry`**（没有 GET 重试）。本次改为复用 `accountApi.sendAccountApiRequest` |
| 删除 | `deleteAccountResource`、`deleteAccountResourceItem`、`deleteHoldingTransaction` | ✅ 走转发层 |
| 保存/更新 | `putAccountResource`、`patchAccountResource`、`putAccountResourceItem`、`putHoldingTransaction` | ✅ 走转发层 |
| 迁移相关 | `fetchLegacyMigrationStatus`、`importLegacyResources`、`skipLegacyMigrationOnServer` | ✅ 走转发层 |
| 迁移相关（数据处理选择 / 清空） | `accountDataMigrationActions.js` 的 `/user/data-notice`、`/migrations/legacy/discard` | ⚠️→✅ 原先是裸 `fetch`（只复用了 `getAccountApiBase()`）。本次改为 `sendAccountApiRequest` |

两点需要注意的事实（与原计划描述略有差异）：

- `syncClient.js` 与 `accountManager.js` **没有任何网络入口**：前者只有客户端标识/端信息等纯函数，后者是 localStorage + 资金分配计算。拉取入口实际在 `resourceSync.js` 与 `holdingTransactionsSync.js`。
- 各页面（持仓、交易流水、建仓计划、定投、卖出计划、通知规则、自选清单）的删除按钮**不直接调用** `deleteAccountResource`：它们改写本地 `localStorage`，由 `resourceSync` / `holdingTransactionsSync` 劫持 `Storage.prototype` 后防抖 2.5s 推送。因此这些删除是最终一致的，按钮本身没有请求态可用。

## 二、统一加载态

- `src/app/accountLoadingState.js`：唯一状态源。
  - 三类操作：`load`（GET）/ `save`（PUT/PATCH/POST）/ `delete`（DELETE）。
  - 快照字段：`busy`、`userBusy`、`backgroundBusy`、`loading`、`saving`、`deleting`、`counts`、`kind`、`label`、`resources`、`operations`。
  - 快照对象被冻结且只在状态变化时换引用，可直接喂给 `useSyncExternalStore`。
  - 文案由资源名自动推导：`descriptorForResource('trades/ledger').label` → `正在加载交易流水`；非资源路径（`/manifest`、`/bundle`、`/migrations/legacy` 等）有专门文案。
- `accountApi.js` 的 `request()` 出口自动 `trackAccountOperation(...)`，**不需要每个调用点手写 loading**。失败也会在 `finally` 里结束加载态。
- `src/hooks/useAccountLoading.js`：`useAccountLoading()` 读全局快照，`useAccountResourceBusy(resource, kind?)` 读单个资源。
- `src/components/account-loading-indicator.jsx`：全局顶部指示器，挂在 `console-layout.jsx` 外壳里。用户触发的操作立即显示；纯后台轮询延迟 600ms 才显示，避免 60s 轮询导致闪烁。

### 页面接入方式

1. 只读状态：`const { deleting, saving } = useAccountLoading()`，或 `useAccountResourceBusy('trades/ledger', 'delete')`。
2. 只写本地存储的按钮（多数删除按钮）：用 `runAccountUserAction` 包住整个动作，用户立刻看到反馈，期间发出的账号请求会继承「用户操作」标记。

```js
import { runAccountUserAction } from '../hooks/useAccountLoading.js';

await runAccountUserAction({ kind: 'delete', resource: 'trades/ledger', label: '正在删除交易流水' }, async () => {
  removeTradeFromLocalLedger(tradeId); // 触发自动同步推送
});
```

## 三、前端约束（新增代码请遵守）

- 账号相关请求只能走 `accountApi.js`；其它模块需要自定义路径时用 `sendAccountApiRequest(path, { method, token, body, headers })`。
- 除 `apiTransport.js` 外，账号相关模块不得出现裸 `fetch(`；`test/accountApiForwarding.test.mjs` 会扫描并报错。
- 页面不要再自建账号请求的 `loading` state，统一读 `useAccountLoading()`。

## 四、测试

- `test/accountLoadingState.test.mjs`：文案推导、加载/保存/删除三类状态的登记与清空、失败路径、GET 瞬时失败重试一次（证明确实走 `fetchWithGetRetry`）、用户操作与后台轮询的区分、订阅/退订。
- `test/accountApiForwarding.test.mjs`：转发层边界的源码扫描。
- 运行：`npm run test:unit`
