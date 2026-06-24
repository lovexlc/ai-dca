# 埋点数据分析指南

## 快速开始

### 方法 1: 从浏览器导出数据（推荐）

1. 打开网站（已登录状态）
2. 按 F12 打开控制台
3. 粘贴并运行以下代码：

```javascript
const events = JSON.parse(localStorage.getItem("aiDcaAnalyticsEvents_v1") || "[]");
const data = { events, exportedAt: new Date().toISOString() };
console.log(`导出 ${events.length} 条事件`);
const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
const url = URL.createObjectURL(blob);
const a = document.createElement("a");
a.href = url;
a.download = "analytics-export.json";
a.click();
console.log("✅ 数据已导出");
```

4. 将下载的 `analytics-export.json` 放到项目根目录
5. 运行分析脚本：

```bash
node scripts/analyze-analytics.mjs
```

### 方法 2: 从 Cloudflare Workers 查询

```bash
# 查询 D1 数据库
wrangler d1 execute notify-db --command "SELECT * FROM client_settings WHERE id = 'your-client-id'"

# 或通过 Worker API
curl -X POST https://your-worker.workers.dev/api/notify/analytics \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## 输出文件

- `DATA_ANALYSIS_REPORT.md` - 完整分析报告
- 包含页面使用率、核心功能、低频功能建议

## 分析指标

- **session_heartbeat**: 页面停留心跳，用于计算使用率
- **activeTab**: 当前活跃页面标识
- **使用率**: 该页面心跳数 / 总心跳数 * 100%

## 决策标准

- **核心功能**: 使用率 ≥ 10%
- **重要功能**: 使用率 5% - 10%
- **正常功能**: 使用率 1% - 5%
- **低频功能**: 使用率 < 1%（考虑移除）
