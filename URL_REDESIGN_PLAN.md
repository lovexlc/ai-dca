# 网站 URL 设计优化方案

## 当前问题

1. **基金对比功能没有 URL 参数**：无法分享对比结果，刷新后状态丢失
2. **图表配置未持久化**：图表类型、指标等设置无法通过 URL 分享
3. **部分跳转逻辑不一致**：有些地方用 sessionStorage，有些用 URL 参数

## 现有 URL 结构（已实现）

### ✅ 主导航
- 格式：`?tab={tabName}`
- 示例：`?tab=holdings`, `?tab=markets`, `?tab=tradePlans`

### ✅ 子视图（Hash）
- 格式：`?tab=tradePlans#{subView}`
- 示例：`?tab=tradePlans#home`, `?tab=tradePlans#dca`

### ✅ 基金详情
- 格式：`?tab=markets&symbol={code}`
- 示例：`?tab=markets&symbol=513050`
- 实现位置：`src/pages/markets/marketsUrlSync.js`

### ✅ 时间范围
- 格式：`?range={preset}&from={date}&to={date}`
- 示例：`?range=ytd&from=2024-01-01&to=2024-12-31`
- 实现位置：`src/app/rangeUrlSync.js`

## 需要改进的功能

### 🔴 优先级 1：基金对比（必须实现）

**问题**：用户添加了对比基金后，无法分享链接给他人查看相同的对比结果

**方案**：
```
URL 格式：?tab=markets&symbol={主基金}&compare={对比基金1},{对比基金2},{对比基金3}
示例：?tab=markets&symbol=513050&compare=159941,513100
```

**实现位置**：
- `src/pages/markets/MarketSymbolDetailPanel.jsx` - 添加 URL 同步逻辑
- `src/pages/markets/marketsUrlSync.js` - 扩展工具函数

**影响范围**：
- 仅影响行情中心的对比功能
- 不影响其他模块

### 🟡 优先级 2：图表配置（可选实现）

**问题**：用户调整图表设置后，无法分享特定的图表视图

**方案**：
```
URL 格式：?tab=markets&symbol={code}&chartType={type}&indicators={ind1},{ind2}
示例：?tab=markets&symbol=QQQ&chartType=candlestick&indicators=ma,vol
```

**参数说明**：
- `chartType`: `candlestick` | `line` | `area`
- `indicators`: 逗号分隔，如 `ma,vol,ema,rsi`
- `cnFundParam`: 中国基金专用，`price` | `nav`

**影响**：
- 改进用户体验，但不影响核心功能
- URL 会变长，但不影响功能性

### 🟢 优先级 3：持仓详情直达（可选实现）

**问题**：无法直接链接到持仓页面的特定基金详情

**方案**：
```
URL 格式：?tab=holdings&code={fundCode}
示例：?tab=holdings&code=513050
```

**实现位置**：
- `src/pages/HoldingsExperience.jsx` - 添加 URL 参数读取
- 类似 markets 的 `pendingSymbol` 处理逻辑

## 实施计划

### Phase 1: 基金对比 URL 参数（必须完成）

**任务清单**：
1. ✅ 修复 `handleSelectSymbol` - 已完成（commit c88ba1a）
2. ⬜ 扩展 `marketsUrlSync.js`，添加 `updateCompareInUrl()` 和 `clearCompareFromUrl()`
3. ⬜ 修改 `MarketSymbolDetailPanel.jsx`：
   - 初始化时从 URL 读取 `compare` 参数
   - `compareSymbols` 变化时同步到 URL
   - 清空对比时清除 URL 参数
4. ⬜ 测试：分享对比链接、刷新页面、浏览器前进后退

**预估工作量**：30-45 分钟

### Phase 2: 图表配置持久化（可选）

**任务清单**：
1. ⬜ 添加图表配置 URL 同步工具函数
2. ⬜ 修改 `MarketSymbolDetailPanel.jsx` 读取和更新图表参数
3. ⬜ 测试各种图表配置组合

**预估工作量**：60-90 分钟

### Phase 3: 持仓详情直达（可选）

**任务清单**：
1. ⬜ 修改 `HoldingsExperience.jsx` 读取 `code` 参数
2. ⬜ 添加 URL 更新逻辑
3. ⬜ 测试持仓详情跳转

**预估工作量**：30-45 分钟

## URL 参数命名规范

### 已有参数
- `tab` - 主导航 tab
- `symbol` - 基金/股票代码（行情中心主标的）
- `module` - 量化研究子模块
- `range` - 时间范围预设
- `from` / `to` - 自定义时间范围

### 新增参数
- `compare` - 对比基金列表（逗号分隔）
- `chartType` - 图表类型
- `indicators` - 指标列表（逗号分隔）
- `cnFundParam` - 中国基金参数（price/nav）
- `code` - 持仓页面基金代码

### 命名原则
1. 使用小写 + 驼峰命名
2. 列表用逗号分隔，不用编码
3. 布尔值省略表示 false，存在表示 true
4. 避免中文和特殊字符

## 向后兼容性

### 兼容性保证
- 所有新参数都是可选的
- 旧 URL 依然可以正常访问
- 不影响现有功能

### 迁移说明
- 无需数据迁移
- 用户可以继续使用旧链接
- 新功能自动启用

## 技术实现细节

### URL 同步时机
- 使用 `history.replaceState` 而非 `pushState`（不增加历史记录）
- 在状态变化后立即同步 URL
- 避免在快速连续变化时重复更新（可以考虑 debounce）

### 初始化逻辑
```javascript
// 从 URL 读取参数
const params = new URLSearchParams(window.location.search);
const [state, setState] = useState(() => {
  const param = params.get('paramName');
  return param ? parseParam(param) : defaultValue;
});

// 状态变化时同步到 URL
useEffect(() => {
  updateUrlParam(state);
}, [state]);
```

### 错误处理
- URL 参数非法时使用默认值
- 不影响页面正常加载
- Console 输出警告信息（开发模式）

## 测试计划

### 功能测试
1. 分享链接给他人能否正确显示
2. 刷新页面是否保持状态
3. 浏览器前进/后退是否正常
4. 参数非法时是否降级处理

### 兼容性测试
1. 旧链接是否依然可用
2. 缺少参数时是否正常
3. 参数顺序不同是否影响

### 性能测试
1. URL 更新是否会导致页面卡顿
2. 多参数同时变化时是否正常

## 风险评估

### 低风险
- URL 变长可能影响复制体验（但现代浏览器都支持）
- 参数过多可能降低可读性（但功能优先）

### 无风险
- 向后兼容，不影响现有用户
- 纯前端实现，不涉及后端
- 状态管理独立，不影响其他模块

## 总结

**优先实现**：基金对比 URL 参数（Phase 1）
**理由**：
1. 用户需求明确（用户提出"基金详情里就不带code"）
2. 实现成本低（30-45分钟）
3. 价值高（分享和刷新是基础需求）

**可选实现**：图表配置和持仓详情（Phase 2-3）
**理由**：
1. 提升用户体验
2. 与 Phase 1 实现逻辑类似
3. 不影响核心功能，可以后续迭代
