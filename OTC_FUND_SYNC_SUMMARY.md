# 场外基金数据同步功能总结

**完成日期**: 2026-06-23  
**版本**: 1.0

---

## ✅ 功能概述

为场外基金详情页新增三个核心字段，并实现 Worker 定时任务自动同步场外基金数据到 KV 缓存。

---

## 📊 新增字段

### 1. 今年以来收益率 (`ytdReturn`)
- 数据源: 蛋卷基金 API `/djapi/fund/derived/{code}`
- 字段: `nav_grlty`
- 格式: 百分比 (例: 16.04%)

### 2. 最大回撤 (`maxDrawdown`)
- 数据源: 蛋卷基金 API `/djapi/fundx/base/fund/achievement/{code}`
- 字段: `self_max_draw_down` (成立以来)
- 格式: 百分比 (例: -31.18%)

### 3. 基金规模 (`fundSize`)
- 数据源: 蛋卷基金 API `/djapi/fund/detail/{code}`
- 字段: `fund_position.asset_tot`
- 格式: 人民币元 (例: 162.99亿元)

---

## 🗂️ 支持的场外基金

### 总计: **49 只**

#### 纳斯达克100指数 (36只)
- 大成纳斯达克100: 2只 (A/C)
- 广发纳指100: 5只 (A/C/美元A/美元C/F)
- 易方达纳斯达克100: 3只 (A人民币/C人民币/A美元)
- 华安纳斯达克100: 2只 (A/C)
- 博时纳斯达克100: 4只 (A人民币/C人民币/A美元/C美元)
- 华夏纳斯达克100: 2只 (A/C)
- 嘉实纳斯达克100: 5只 (A人民币/C人民币/A美元/C美元/I人民币)
- 汇添富纳斯达克100: 2只 (A/C)
- 华泰柏瑞纳斯达克100: 2只 (A/C)
- 招商纳斯达克100: 2只 (A/C)
- 国泰纳斯达克100: 1只
- 摩根纳斯达克100: 3只 (人民币A/人民币C/美元A)
- 宝盈纳斯达克100: 2只 (A人民币/C人民币)
- 南方纳斯达克100: 1只 (I人民币)

#### 标普500指数 (13只)
- 摩根标普500: 2只 (人民币A/人民币C)
- 国泰标普500: 2只 (A人民币/C人民币)
- 华夏标普500: 2只 (A人民币/C人民币)
- 博时标普500: 3只 (A人民币/C人民币/E人民币)
- 天弘标普500: 2只 (A/C)
- 易方达标普500: 2只 (A人民币/C人民币)

---

## 🏗️ 技术实现

### 1. Worker 模块

#### `workers/markets/src/otcFundSync.js`
场外基金数据同步核心模块

**主要函数**:
- `fetchOtcFundFullData(fundCode)` - 并发拉取 3 个蛋卷 API
- `transformOtcFundData(fullData)` - 转换为标准格式
- `syncOtcFunds(fundCodes, kv, concurrency)` - 批量同步到 KV
- `getOtcFundFromCache(fundCode, kv)` - 从 KV 读取缓存
- `syncOtcFundsTask(env, fundCodes)` - 定时任务包装函数

**API 调用**:
```javascript
// 并发请求 3 个蛋卷接口
/djapi/fund/derived/{code}        // 净值和收益率
/djapi/fundx/base/fund/achievement/{code}  // 最大回撤
/djapi/fund/detail/{code}          // 基金规模
```

#### `workers/markets/src/otcFundList.js`
场外基金列表配置

```javascript
export const OTC_NASDAQ_FUNDS = [...]; // 36只
export const OTC_SP500_FUNDS = [...];  // 13只
export const OTC_ALL_FUNDS = [...];    // 49只
```

#### `workers/markets/src/index.js`
主路由逻辑修改

**`handleQuote()` 函数增强**:
1. 识别场外基金代码（去掉自动添加的 sh/sz/bj 前缀）
2. 优先从 KV 缓存读取
3. 缓存未命中时实时调用蛋卷 API
4. 将获取的数据保存到 KV（24小时过期）

**定时任务配置**:
```javascript
// 北京时间 19:30, 20:30, 21:30 (UTC 11:30, 12:30, 13:30)
if (minute === 30 && (hourUtc === 11 || hourUtc === 12 || hourUtc === 13)) {
  tasks.push(syncOtcFundsTask(env, OTC_ALL_FUNDS));
}
```

### 2. 前端展示

#### `src/pages/markets/MarketSymbolDetailPanel.jsx`
场外基金详情页显示逻辑

```javascript
const cnOtcFundExtras = market === 'cn' && isCnOtcFund ? [
  detailValueRow('今年以来', formatSignedPercent(row.ytdReturn)),
  detailValueRow('最大回撤', formatSignedPercent(row.maxDrawdown)),
  detailValueRow('基金规模', formatCnMoney(row.fundSize)),
].filter((item) => item.value !== '--' && item.value !== '-') : [];
```

---

## ⏰ 定时任务

### Cron 配置 (`wrangler.toml`)

```toml
[triggers]
crons = [
  "30 11 * * MON-FRI",  # 北京 19:30 - 第一轮同步
  "30 12 * * MON-FRI",  # 北京 20:30 - 第二轮同步
  "30 13 * * MON-FRI"   # 北京 21:30 - 第三轮同步
]
```

### 同步策略

- **执行时间**: 北京时间 19:30/20:30/21:30（A股收盘后）
- **并发控制**: 3个基金同时请求，避免 API 限流
- **失败重试**: 单个基金失败不影响其他基金同步
- **数据时效**: KV 缓存 24 小时自动过期

---

## 💾 KV 存储

### 存储格式

**Key**: `otc_fund:{fundCode}`  
**Value**: JSON 格式的完整数据（包含 3 个 API 的原始响应）  
**TTL**: 86400 秒 (24小时)

### 数据结构示例

```json
{
  "code": "270042",
  "timestamp": 1782215428782,
  "derived": { "unit_nav": 8.49, "nav_grlty": 16.04, ... },
  "achievement": { 
    "annual_performance_list": [
      { "period_time": "成立以来", "self_max_draw_down": "31.18%" }
    ]
  },
  "detail": { 
    "fund_position": { "asset_tot": 16298884929.61 }
  },
  "errors": []
}
```

---

## 🔄 数据流程

```
用户请求场外基金
       ↓
检查 KV 缓存
       ↓
   缓存命中? ←─ YES ─→ 返回缓存数据 (cached=true)
       ↓
      NO
       ↓
实时调用蛋卷 API
       ↓
并发拉取 3 个接口
       ↓
转换为标准格式
       ↓
保存到 KV 缓存
       ↓
返回数据 (cached=false)
```

---

## 📈 性能优化

1. **KV 缓存**: 避免频繁调用外部 API
2. **并发请求**: 3 个蛋卷 API 并发拉取，减少等待时间
3. **批量同步**: 定时任务分 3 个时间点执行，每次 3 个并发
4. **懒加载**: 未在 KV 中的基金实时拉取并缓存
5. **TTL 过期**: 24 小时自动过期，确保数据新鲜度

---

## 🧪 测试结果

### API 测试
- ✅ 所有 49 只基金数据获取成功
- ✅ 今年以来收益率、最大回撤、基金规模字段完整
- ✅ 缓存命中率正常 (第二次请求 cached=true)

### 定时任务
- ✅ 3 个 cron 定时任务配置正确
- ✅ Worker 日志显示同步任务正常执行
- ✅ KV 存储数据完整，过期时间正确

### 前端展示
- ✅ 场外基金详情页正确显示三个新字段
- ✅ 数据格式化正确（百分比、金额）
- ✅ 与场内基金区分显示

---

## 📝 注意事项

1. **场外基金代码识别**:
   - 场外基金代码是 6 位数字，不带 sh/sz/bj 前缀
   - Worker 需要特殊处理去掉 `classifySymbol` 自动添加的前缀

2. **蛋卷 API 限制**:
   - 无需登录，但建议控制请求频率
   - 并发不超过 5 个请求/秒

3. **KV 同步策略**:
   - 定时任务在 A 股收盘后执行，确保净值已更新
   - 分 3 次执行是为了容错（某次失败不影响整体）

4. **前端监控列表**:
   - Worker 的 `OTC_ALL_FUNDS` 需要与前端 `CN_OTC_WATCHLIST_PRESETS` 保持同步
   - 新增基金需要同时更新两处

---

## 🔗 相关文件

### Worker
- `workers/markets/src/otcFundSync.js` - 同步核心逻辑
- `workers/markets/src/otcFundList.js` - 基金列表配置
- `workers/markets/src/index.js` - 主路由修改
- `workers/markets/wrangler.toml` - Cron 定时任务配置

### 前端
- `src/pages/markets/MarketSymbolDetailPanel.jsx` - 详情页显示
- `src/app/marketsApi.js` - CN_OTC_WATCHLIST_PRESETS 配置

### 文档
- `DANJUAN_API_ENDPOINTS.md` - 蛋卷 API 接口文档
- `OTC_FUND_SYNC_SUMMARY.md` - 本总结文档

---

## 🚀 部署状态

- ✅ Worker 已部署到生产环境
- ✅ 前端已构建并发布
- ✅ KV 缓存已初始化
- ✅ 定时任务已激活

**Worker Version**: 4704fdec-11c1-448d-8020-5e3ea477b247  
**部署时间**: 2026-06-23 11:56 UTC

---

## 📊 数据示例

```json
{
  "code": "270042",
  "name": "广发纳指100ETF联接(QDII)人民币A",
  "ytdReturn": 16.0359201946,
  "maxDrawdown": 31.18,
  "fundSize": 16298884929.61,
  "latestNav": 8.49,
  "latestNavDate": "2026-06-22",
  "source": "danjuan",
  "cached": true,
  "_cacheTime": 1782215428782
}
```

---

**总结**: 场外基金数据同步功能已全部实现并部署上线，支持 49 只纳指和标普场外基金，提供今年以来收益率、最大回撤、基金规模三个核心指标。
