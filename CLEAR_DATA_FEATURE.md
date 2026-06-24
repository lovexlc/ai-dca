# 清除所有数据功能

## 需求背景

用户反馈注册后不知道点哪里了生成了测试数据，无法清除。猜测是之前的 Demo 数据功能导致。

## 功能说明

在持仓总览页面增加"清除所有数据"按钮，用于清除所有本地存储的数据。

### 清除范围

- 持仓交易记录 (`aiDcaFundHoldingsLedger`)
- 账户分配 (`aiDcaAccountAssignments`)
- 成本记录 (`aiDcaTradeLedger`, `aiDcaTradeLedgerArchive`)
- 持仓提醒 (`aiDcaHoldingAlerts`)
- 计划数据 (`aiDcaPlanState`, `aiDcaPlanStore`)
- 定投数据 (`aiDcaDcaState`, `aiDcaDcaStore`)
- 卖出计划 (`aiDcaSellPlanDraft`, `aiDcaSellPlanStore`)
- Demo 数据标记 (`aiDcaDemoDataMeta`)
- 自选列表 (`markets:watchlist:v1`)

### 安全措施

1. **二次确认弹窗**：点击按钮后弹出确认对话框
2. **数据统计展示**：显示即将清除的数据量
   - X 笔交易记录
   - X 只基金持仓
   - X 笔成本记录
3. **不可恢复警告**：明确提示用户此操作不可恢复

### UI 设计

**位置**：
- **PC 端**：持仓总览顶部右侧快捷操作区，在"复制表格"按钮左侧
- **移动端**：右下角 FAB (浮动操作按钮) 菜单中，在所有操作项底部

**样式**：
- 图标：垃圾桶图标 (Trash2)
- 颜色：
  - PC 端：默认灰色，悬停时变红色（警示）
  - 移动端：红色文字 + 红色边框，悬停时红色背景
- 文字："清除数据"

## 技术实现

### 文件修改

1. **`/src/app/clearAllData.js`** (新建)
   - `clearAllLocalData()`: 执行清除操作
   - `getDataStats()`: 统计数据量
   - `getClearDataConfirmMessage()`: 生成确认消息

2. **`/src/pages/HoldingsExperience.jsx`**
   - 新增 `handleClearAllData()` 函数
   - 传递 `onClearAllData` 回调到 quickActions

3. **`/src/app/income/IncomeSummary.jsx`**
   - 导入 Trash2 图标
   - 在 PC 端快捷操作区添加"清除数据"按钮

4. **`/src/pages/holdings/HoldingsOverviewShell.jsx`**
   - 导入 Trash2 图标
   - 在移动端 FAB 菜单中添加"清除数据"选项（variant: 'danger'）

5. **`/src/components/FloatingActionButton.jsx`**
   - 支持 danger 变体样式（红色文字 + 边框）

### 埋点追踪

- `holdings.clear_all_data_cancel`: 用户取消清除
- `holdings.clear_all_data` (success/error): 清除操作结果

## 测试步骤

### PC 端测试

1. 打开持仓总览页面（桌面浏览器）
2. 如果没有数据，先生成 Demo 数据或手动添加一些交易
3. 点击右上角"清除数据"按钮（垃圾桶图标）
4. 查看确认对话框内容是否正确显示数据统计
5. 点击"确认"后，验证：
   - 所有持仓数据已清空
   - 页面显示成功提示
   - 刷新页面后数据仍为空
6. 验证取消操作：点击"清除数据" → 点击"取消"，数据不应被清除
7. 验证悬停效果：鼠标悬停在按钮上时，按钮应变红色

### 移动端测试

1. 打开持仓总览页面（手机浏览器或缩小窗口至移动端视图）
2. 点击右下角圆形浮动按钮（+号）
3. 查看展开的菜单中是否有"清除数据"选项（红色文字 + 边框）
4. 点击"清除数据"
5. 验证确认对话框和清除流程与 PC 端一致
6. 验证菜单关闭：清除操作完成后菜单应自动关闭

## 部署说明

此功能已通过构建检查，可直接部署。

## 注意事项

- 此操作不会清除用户账号相关数据（如登录状态、云同步配置等）
- 如果用户已开启云同步，清除本地数据后可通过重新登录恢复
- PC 端和移动端均已添加按钮，移动端通过 FAB 菜单访问
- 移动端使用红色样式突出显示危险操作

## 后续优化

1. ~~考虑在移动端 FAB 菜单中添加此功能~~ ✅ 已完成
2. 添加更精细的数据清除选项（仅清除 Demo 数据、仅清除持仓等）
3. 在清除前提示用户备份数据或使用云同步
4. 添加清除历史记录功能（记录清除时间和原因）
