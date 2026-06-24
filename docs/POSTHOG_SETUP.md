# PostHog 配置指南

## 🚀 快速开始

### 1. 注册 PostHog 账号

访问 https://posthog.com/ 注册免费账号

- 免费额度：100万事件/月
- 无需信用卡

### 2. 创建项目

1. 登录后创建新项目
2. 选择 "Web" 平台
3. 记录你的 **Project API Key**（格式：`phc_xxxxx`）

### 3. 配置环境变量

在 `.env.local` 文件中添加：

```bash
VITE_POSTHOG_API_KEY=phc_你的API_KEY
VITE_POSTHOG_HOST=https://app.posthog.com
```

### 4. 启动应用

```bash
npm run dev
```

现在所有埋点数据会自动同步到 PostHog！

---

## 📊 PostHog 功能

### 1. 事件追踪
- 所有现有埋点事件自动同步
- `session_heartbeat` - 页面停留
- `page_view` - 页面浏览
- `feature_event` - 功能使用

### 2. 用户行为分析
- **漏斗分析**：用户从进入到转化的路径
- **留存分析**：用户回访率
- **路径分析**：用户浏览路径可视化

### 3. 仪表板
登录 PostHog 后可以创建自定义仪表板：
- 页面使用率
- 核心功能使用情况
- 用户活跃度

---

## 🔍 查看数据

### 在 PostHog Dashboard

1. **Events** - 查看所有事件
2. **Insights** - 创建图表分析
3. **Persons** - 查看用户详情

### 常用查询示例

**页面使用率**：
```
Event: session_heartbeat
Group by: properties.activeTab
Date range: Last 30 days
```

**功能使用排行**：
```
Event: feature_event
Group by: properties.feature
Chart type: Bar
```

---

## 🛠️ 高级配置

### 启用会话录制

在 `src/app/posthog.js` 中修改：

```javascript
session_recording: {
  enabled: true  // 改为 true
}
```

### 自定义事件

现有埋点会自动同步，无需额外代码。

如需新增事件：

```javascript
import { trackEvent } from './app/posthog.js';

trackEvent('custom_event', {
  property1: 'value1',
  property2: 'value2'
});
```

---

## 🔒 隐私设置

PostHog 默认配置：
- ✅ 不自动捕获点击（`autocapture: false`）
- ✅ 不自动捕获页面浏览（手动控制）
- ✅ 不启用会话录制（可选开启）
- ✅ 敏感数据已过滤（见 `SENSITIVE_META_KEYS`）

---

## 🚫 禁用 PostHog

如果不想使用 PostHog：

1. 删除 `.env.local` 中的 `VITE_POSTHOG_API_KEY`
2. 或设置为 `VITE_POSTHOG_API_KEY=phc_placeholder`

应用会自动跳过 PostHog 初始化，不影响现有埋点。

---

## 📈 数据对比

| 数据源 | 优势 | 劣势 |
|--------|------|------|
| **本地 localStorage** | 实时、离线可用 | 仅单设备、无分析工具 |
| **Cloudflare Workers** | 集中存储 | 需要手动分析、无可视化 |
| **PostHog** | 专业分析、可视化、漏斗 | 依赖第三方服务 |

**建议**：三者并存
- 本地作为缓存和降级方案
- Workers 作为集中存储
- PostHog 作为分析平台

---

## 🆘 故障排除

### PostHog 未初始化

检查浏览器控制台：
```
[PostHog] 未配置 API Key，跳过初始化
```

**解决**：确认 `.env.local` 中配置了 `VITE_POSTHOG_API_KEY`

### 事件未上报

1. 打开 PostHog Dashboard > Events
2. 选择 "Live events"
3. 触发一个操作，看是否实时出现

### 开发环境测试

```javascript
// 浏览器控制台
import { trackEvent } from './app/posthog.js';
trackEvent('test_event', { test: true });
```

---

**完成！** 🎉

现在你的 AI-DCA 应用已接入 PostHog，可以进行专业的数据分析了。
