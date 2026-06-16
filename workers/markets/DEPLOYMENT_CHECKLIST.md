# K线批量保存功能 - 部署检查清单

## 📋 部署前检查

### 1. 代码验证
- [x] 语法检查通过
- [x] 函数逻辑完整
- [x] 错误处理完善
- [x] 日志记录详细

### 2. 配置检查
- [ ] 确认 `wrangler.toml` 中的 cron 表达式正确
- [ ] 确认 R2 存储桶绑定 (`MARKETS_R2`)
- [ ] 确认 KV 命名空间绑定 (`MARKETS_KV`)
- [ ] 确认环境变量 `XUEQIU_COOKIE` 已设置（A股必需）

### 3. 文档准备
- [x] 功能文档完整
- [x] API 文档清晰
- [x] 测试脚本可用
- [x] 快速参考卡片

---

## 🚀 部署步骤

### Step 1: 进入目录
```bash
cd /root/codespace/ai-dca/workers/markets
```

### Step 2: 检查配置
```bash
# 查看 wrangler.toml
cat wrangler.toml | grep -A 10 "triggers"

# 确认绑定
cat wrangler.toml | grep -A 5 "r2_buckets\|kv_namespaces"
```

### Step 3: 本地测试（可选）
```bash
# 启动本地开发服务器
wrangler dev

# 在另一个终端运行测试
node test-kline-batch.js
```

### Step 4: 部署到生产环境
```bash
wrangler deploy
```

### Step 5: 验证部署
```bash
# 查看部署日志
wrangler tail

# 健康检查
curl https://tools.freebacktrack.tech/api/markets/health
```

### Step 6: 手动触发测试
```bash
# 触发美股K线保存
curl -X POST https://tools.freebacktrack.tech/api/markets/kline-batch \
  -H "Content-Type: application/json" \
  -d '{"market": "us"}'

# 等待几分钟后查看日志
wrangler tail
```

---

## ✅ 部署后验证

### 1. 功能验证
- [ ] 定时任务在预定时间自动运行
- [ ] 手动触发 API 正常工作
- [ ] K线数据成功保存到 R2
- [ ] 任务历史记录正常写入 KV

### 2. 数据验证
```bash
# 查看保存的K线数据
curl "https://tools.freebacktrack.tech/api/markets/kline/AAPL?tf=1d"
curl "https://tools.freebacktrack.tech/api/markets/kline/159513?tf=1d"
```

预期响应包含：
- `batchSaved: true` - 标识为批量保存的数据
- `candles` 数组有数据
- `generatedAt` 时间戳较新

### 3. 日志检查
在 Cloudflare Dashboard 查看：
- Workers & Pages → ai-dca-markets → Logs
- 搜索 `[kline-batch]` 查看批量保存日志
- 确认无错误或异常

### 4. R2 存储检查
在 Cloudflare Dashboard 查看：
- R2 → ai-dca-markets
- 浏览 `kline/` 目录
- 确认文件存在且大小合理（10-100KB）

---

## 📊 首次运行时间表

### 美股任务
- **时间**: UTC 22:30 (北京 06:30)
- **首次运行**: 部署后的第一个 22:30
- **持续时间**: 约 2-5 分钟
- **数据量**: ~150 个文件

### A股任务
- **时间**: UTC 07:30 (北京 15:30) 工作日
- **首次运行**: 部署后的第一个工作日 07:30
- **持续时间**: 约 1-3 分钟
- **数据量**: ~52 个文件

---

## 🔍 监控要点

### 第一周重点监控
1. **成功率**: 应该 >95%
2. **耗时**: 美股 <5分钟，A股 <3分钟
3. **错误**: 查看具体失败原因
4. **存储**: R2 使用量应在预期范围

### 常见问题排查

#### 问题：A股数据获取失败
**解决**:
```bash
# 检查雪球 Cookie
wrangler secret list

# 更新 Cookie
wrangler secret put XUEQIU_COOKIE
```

#### 问题：任务未运行
**检查**:
- Cloudflare Workers 状态
- Cron 触发器是否启用
- 时区转换是否正确

#### 问题：R2 写入失败
**检查**:
- R2 存储桶是否存在
- Worker 是否有 R2 写入权限
- 存储配额是否已满

---

## 📈 性能基准

### 预期指标
| 指标 | 美股 | A股 |
|------|------|-----|
| 股票数 | 25 | 13 |
| 周期数 | 6 | 4 |
| 总任务数 | 150 | 52 |
| 并发数 | 5 | 5 |
| 预计耗时 | 2-5分钟 | 1-3分钟 |
| 成功率 | >95% | >95% |
| 单文件大小 | 10-100KB | 10-100KB |

### 第一周观察
记录实际指标并与预期对比：
- [ ] 实际耗时: _____ 分钟
- [ ] 实际成功率: _____%
- [ ] 总存储量: _____ MB
- [ ] 平均文件大小: _____ KB

---

## 🎯 下一步行动

### 立即（部署后24小时）
- [ ] 观察第一次自动运行
- [ ] 验证数据质量
- [ ] 记录性能指标

### 一周内
- [ ] 根据实际情况调整并发数
- [ ] 优化错误处理
- [ ] 完善监控告警

### 一个月内
- [ ] 评估是否需要添加更多股票
- [ ] 考虑实现动态股票池
- [ ] 设置数据清理策略

---

## 📞 支持

如遇问题：
1. 查看日志：`wrangler tail`
2. 查看文档：`KLINE_BATCH_SAVE.md`
3. 运行测试：`node test-kline-batch.js`

---

## ✅ 签署确认

部署完成后，请确认：

- [ ] 所有检查项已完成
- [ ] 部署成功无错误
- [ ] 首次运行已验证
- [ ] 监控已设置

部署人员：_________________
部署时间：_________________
首次运行时间：_________________

---

**祝部署顺利！** 🎉
