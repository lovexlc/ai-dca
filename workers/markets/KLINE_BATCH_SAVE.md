# K线数据批量保存功能

> **当前策略**：定时写 R2 的 K 线 batch 仅 `30 7 * * MON-FRI`（A 股）。美股 / 纳指 ETF 定时写 R2 已关闭。

## 功能说明

为了解决雪球等接口K线数据时间窗口限制的问题，我们添加了收盘后自动批量保存K线数据的功能。

### 主要特性

1. **自动定时保存**：每天收盘后自动运行，保存主要股票的K线数据
2. **多周期支持**：支持日线、周线、月线、5分钟、15分钟、60分钟等多个时间周期
3. **双市场支持**：同时支持美股和A股市场
4. **并发控制**：限制并发请求数，避免过载
5. **错误处理**：完善的错误记录和重试机制
6. **历史记录**：保存最近10次任务执行记录

## 定时任务配置

### A股市场
- **时间**：北京时间 15:30 (UTC 07:30)
- **频率**：工作日
- **触发 cron**：`30 7 * * MON-FRI`
- **保存周期**：1d, 5m, 15m, 60m

### 美股市场
- **时间**：北京时间 06:30 (UTC 22:30)
- **频率**：每天
- **触发 cron**：~~`30 22 * * *`~~（已停用：不再写美股 K 线到 R2；`30 22` 仅刷新指数/新闻）
- **保存周期**：1d, 1w, 1mo, 5m, 15m, 60m

## 数据存储

所有K线数据保存在 Cloudflare R2 存储中：

```
kline/{market}/{symbol}/{interval}.json
```

例如：
- `kline/us/AAPL/1d.json` - 苹果股票日线
- `kline/cn/159513/5m.json` - 159513基金5分钟线

## 跟踪的股票池

### 美股 (25个)
- **指数**：^GSPC, ^DJI, ^IXIC, ^RUT
- **大盘股**：AAPL, MSFT, GOOGL, AMZN, META, TSLA, NVDA, JPM, V, WMT, JNJ, PG, DIS, NFLX
- **ETF**：SPY, QQQ, IWM, VOO, VTI

### A股 (13个)
- **指数**：000001, 399001, 399006
- **ETF**：159513, 159501, 159915, 159919, 159920, 510300, 510500, 512100, 512660, 515790

## API 接口

### 手动触发批量保存

```bash
# 保存美股K线数据
curl -X POST https://tools.freebacktrack.tech/api/markets/kline-batch \
  -H "Content-Type: application/json" \
  -d '{"market": "us"}'

# 保存A股K线数据
curl -X POST https://tools.freebacktrack.tech/api/markets/kline-batch \
  -H "Content-Type: application/json" \
  -d '{"market": "cn"}'
```

响应示例：
```json
{
  "ok": true,
  "message": "K-line batch save task started for us market",
  "market": "us",
  "timestamp": "2026-06-15T10:30:00.000Z"
}
```

### 查看任务历史

任务执行历史保存在 KV 中，可通过内部接口查询：

```javascript
// 在 Worker 内部
const history = await kvGetJson(env, 'kline-batch-history:us');
console.log(history.runs); // 最近10次运行记录
```

历史记录格式：
```json
{
  "runs": [
    {
      "timestamp": "2026-06-15T10:30:00.000Z",
      "success": 145,
      "failed": 5,
      "duration": 287,
      "errors": ["TSLA:5m - timeout", "..."]
    }
  ]
}
```

## 配置说明

在 `klineBatchSaver.js` 中可以自定义：

### 1. 股票池
```javascript
const TRACKING_SYMBOLS = {
  us: ['AAPL', 'MSFT', ...],
  cn: ['159513', '159501', ...]
};
```

### 2. 时间周期
```javascript
const KLINE_INTERVALS = {
  us: ['1d', '1w', '1mo', '5m', '15m', '60m'],
  cn: ['1d', '5m', '15m', '60m']
};
```

### 3. 并发控制
```javascript
saveKlineDataBatch(env, market, {
  concurrency: 5  // 同时请求的数量
})
```

### 4. 跳过策略
```javascript
saveKlineDataForSymbol(env, market, symbol, interval, {
  skipExisting: false  // 是否跳过最近更新的数据
})
```

## 性能优化

1. **并发限制**：默认并发数为 3-5，避免过载
2. **智能跳过**：可配置跳过最近更新的数据
3. **批量处理**：使用 `mapLimit` 控制并发
4. **错误隔离**：单个股票失败不影响其他股票

## 监控和日志

所有关键操作都有详细日志：

```
[kline-batch] Start saving us kline data
[kline-batch] Progress: 50/150
[kline-batch] Saved AAPL:1d (candleCount: 500)
[kline-batch] Failed: TSLA:5m - timeout
[kline-batch] Completed us kline batch save (success: 145, failed: 5, duration: 287s)
```

## 故障排查

### 1. 任务未运行
- 检查 cron 配置是否正确
- 查看 Cloudflare Workers 日志
- 确认时区转换是否正确

### 2. 保存失败
- 检查 R2 存储桶配置
- 查看具体错误信息
- 确认雪球 Cookie 是否有效（A股）

### 3. 数据不完整
- 检查并发数是否太高
- 查看超时设置
- 确认上游 API 限流情况

## 扩展建议

1. **增加股票池**：在 `TRACKING_SYMBOLS` 中添加更多股票
2. **自定义周期**：在 `KLINE_INTERVALS` 中添加新的时间周期
3. **条件触发**：根据市场波动情况动态调整保存频率
4. **通知机制**：任务完成后发送通知（邮件/Webhook）
5. **数据清理**：定期清理过期的历史数据

## 部署

```bash
# 进入 workers 目录
cd workers/markets

# 部署到 Cloudflare
wrangler deploy

# 查看日志
wrangler tail
```

## 测试

```bash
# 本地测试
npm run dev

# 手动触发测试
curl -X POST http://localhost:8787/api/markets/kline-batch \
  -H "Content-Type: application/json" \
  -d '{"market": "us"}'
```

## 注意事项

1. **成本控制**：R2 存储按请求和存储量计费，注意控制成本
2. **API 限流**：雪球等上游 API 有限流，需要合理控制并发
3. **时区问题**：所有 cron 使用 UTC 时间，注意转换
4. **Cookie 过期**：A股数据依赖雪球 Cookie，需要定期更新

## 相关文件

- `workers/markets/src/klineBatchSaver.js` - 批量保存逻辑
- `workers/markets/src/index.js` - Worker 入口和路由
- `workers/markets/src/storage.js` - 存储封装
- `workers/markets/wrangler.toml` - Worker 配置
