# 蛋卷基金 API 接口文档

**测试基金代码**: 270042 (广发纳指100ETF联接)  
**抓取时间**: 2026-06-23  
**方法**: Playwright 真实浏览器访问 https://danjuanfunds.com/funding/270042

---

## 核心数据接口（无需登录）

### 1. 基金基本信息
**接口**: `GET /djapi/fund/{code}`  
**示例**: https://danjuanfunds.com/djapi/fund/270042

**返回数据**:
- `fd_code`: 基金代码
- `fd_name`: 基金名称
- `fd_full_name`: 基金全称
- `fd_type`: 基金类型代码
- `totshare`: 基金份额（如 "97.16亿"）
- `keeper_name`: 基金公司
- `manager_name`: 基金经理
- `fund_derived`: 内嵌净值和收益率数据
  - `unit_nav`: 单位净值
  - `nav_grtd`: 日涨跌幅
  - `nav_grlty`: 今年以来收益率
  - `nav_grl1m/3m/6m/1y`: 近期收益率

---

### 2. 基金净值和收益率（重要）
**接口**: `GET /djapi/fund/derived/{code}`  
**示例**: https://danjuanfunds.com/djapi/fund/derived/270042

**返回数据**:
- `unit_nav`: 单位净值
- `unit_acc_nav`: 累计净值
- `nav_grtd`: 日涨跌幅
- `nav_grl1w/1m/3m/6m/1y/2y/3y/5y`: 各期收益率
- `nav_grlty`: 今年以来收益率
- `nav_grbase`: 成立以来收益率
- `srank_l1m/3m/6m/lty/l1y/l3y/l5y/base`: 同类排名（如 "113/441"）
- `end_date`: 净值日期
- `updated_at`: 更新时间戳

---

### 3. 基金持仓和规模
**接口**: `GET /djapi/fund/detail/{code}`  
**示例**: https://danjuanfunds.com/djapi/fund/detail/270042

**返回数据**:
- `fund_position`:
  - `asset_tot`: 资产总额（基金规模）
  - `asset_val`: 资产净值
  - `stock_percent`: 股票占比
  - `cash_percent`: 现金占比
  - `other_percent`: 其他占比
  - `enddate`: 持仓截止日期
  - `stock_list[]`: 前10大持仓股票明细

---

### 4. **基金绩效分析（最大回撤）⭐**
**接口**: `GET /djapi/fundx/base/fund/achievement/{code}`  
**示例**: https://danjuanfunds.com/djapi/fundx/base/fund/achievement/270042

**返回数据** - 包含最大回撤！:
```json
{
  "fund_code": "270042",
  "annual_performance_list": [
    {
      "period_time": "成立以来",
      "self_nav": "932.2798",
      "self_max_draw_down": "31.18%",  // ← 最大回撤
      "standard_index_nav": "113.6007",
      "standard_index_max_draw_down": "46.70%",
      "self_nav_rank": "3/441"
    },
    {
      "period_time": "今年以来",
      "self_nav": "16.2299896806",
      "self_max_draw_down": "12.50%",  // ← 今年以来最大回撤
      "standard_index_nav": "6.7314",
      "standard_index_max_draw_down": "7.78%",
      "self_nav_rank": "113/441"
    }
  ]
}
```

---

### 5. 基金风险指标分析
**接口**: `GET /djapi/fund/base/quote/data/index/analysis/{code}`  
**示例**: https://danjuanfunds.com/djapi/fund/base/quote/data/index/analysis/270042

**返回数据**:
- `index_data[]`: 风险指标数组
  - 年化波动率
  - 年化夏普比率
  - 最大回撤
  - 风险收益比
  - 抗风险波动
- `index_tip[]`: 各指标解释说明

---

### 6. 基金净值增长曲线
**接口**: `GET /djapi/fund/growth/{code}?day={period}`  
**示例**: https://danjuanfunds.com/djapi/fund/growth/270042?day=ty

**参数**:
- `day`: 时间周期
  - `ty`: 今年以来
  - `1m`: 近1月
  - `3m`: 近3月
  - `6m`: 近6月
  - `1y`: 近1年
  - `3y`: 近3年
  - `all`: 全部

**返回数据**:
- `fund_nav_growth[]`: 净值增长曲线数据点
  - `date`: 日期
  - `nav`: 净值
  - `percentage`: 累计收益率
  - `value`: 本基金相对收益
  - `than_value`: 对比基准相对收益

---

### 7. 基金净值历史记录
**接口**: `GET /djapi/fund/nav/history/{code}?page={page}&size={size}`  
**示例**: https://danjuanfunds.com/djapi/fund/nav/history/270042?page=1&size=20

**返回数据**:
- 分页的净值历史数据

---

### 8. 基金胜率统计
**接口**: `GET /djapi/fundx/base/fund/win/rate/{code}`  
**示例**: https://danjuanfunds.com/djapi/fundx/base/fund/win/rate/270042

**返回数据**:
- 基金持有不同期限的胜率统计

---

### 9. 基金盈利比率
**接口**: `GET /djapi/fundx/base/fund/profit/ratio/{code}`  
**示例**: https://danjuanfunds.com/djapi/fundx/base/fund/profit/ratio/270042

**返回数据**:
- 盈利概率和盈亏比分析

---

### 10. 基金资产配置占比
**接口**: `GET /djapi/fundx/base/fund/record/asset/percent?fund_code={code}`  
**示例**: https://danjuanfunds.com/djapi/fundx/base/fund/record/asset/percent?fund_code=270042

**返回数据**:
- 资产配置历史变化数据

---

### 11. 基金经理列表
**接口**: `GET /djapi/fundx/base/fund/record/manager/list?fund_code={code}&post_status=1`  
**示例**: https://danjuanfunds.com/djapi/fundx/base/fund/record/manager/list?fund_code=270042&post_status=1

**返回数据**:
- 历任基金经理信息

---

### 12. 基金交易日期
**接口**: `GET /djapi/fund/order/v2/trade_date?fd_code={code}`  
**示例**: https://danjuanfunds.com/djapi/fund/order/v2/trade_date?fd_code=270042

**返回数据**:
- `buy_query_date`: 买入确认查询日期
- `sale_confirm_date`: 卖出确认日期
- `withdraw_date`: 赎回到账天数

---

### 13. 定投收益测算
**接口**: `GET /djapi/fundx/autoinvest/quote/yield/list?fd_code={code}`  
**示例**: https://danjuanfunds.com/djapi/fundx/autoinvest/quote/yield/list?fd_code=270042

**返回数据**:
- `recent_yields[]`: 定投收益率
  - 近1年/2年/3年/5年定投收益

---

## 需要登录的接口

以下接口返回 `{"result_code": 300001, "message": "请重新登录"}`：

- `/djapi/fund/risk/{code}` - 风险评级
- `/djapi/fund/indicator/{code}` - 评级指标
- `/djapi/fund/portfolio/{code}` - 组合持仓
- `/djapi/plan/{code}` - 组合计划
- `/djapi/v2/plan/{code}` - 组合计划 v2
- `/djapi/v3/plan/{code}` - 组合计划 v3

---

## 定时任务推荐采集接口

### 高频采集（每小时/每日）
1. **`/djapi/fund/derived/{code}`** - 净值和收益率（最重要）
2. **`/djapi/fund/{code}`** - 基本信息（包含内嵌净值）
3. **`/djapi/fundx/base/fund/achievement/{code}`** - 绩效和最大回撤

### 低频采集（每周/每月）
4. **`/djapi/fund/detail/{code}`** - 持仓和规模（季报更新）
5. **`/djapi/fund/base/quote/data/index/analysis/{code}`** - 风险指标
6. **`/djapi/fundx/base/fund/win/rate/{code}`** - 胜率统计
7. **`/djapi/fundx/base/fund/profit/ratio/{code}`** - 盈利比率

### 按需采集（用户查看时）
8. **`/djapi/fund/growth/{code}?day=ty`** - 净值增长曲线
9. **`/djapi/fund/nav/history/{code}?page=1&size=20`** - 净值历史
10. **`/djapi/fundx/autoinvest/quote/yield/list?fd_code={code}`** - 定投收益

---

## 请求头配置

```javascript
{
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
  "Referer": "https://danjuanfunds.com/",
  "Accept": "application/json",
  "Accept-Language": "zh-CN,zh;q=0.9"
}
```

---

## 注意事项

1. ✅ 所有 `/djapi/fundx/*` 接口都**不需要登录**
2. ✅ 最大回撤数据在 `/djapi/fundx/base/fund/achievement/{code}` 中
3. ⚠️ 基金规模数据（`asset_tot`）通常按季度更新
4. ⚠️ 部分接口有缓存，建议设置 `cf: { cacheTtl: 300 }`
5. 🔥 建议使用 Worker 定时任务每日同步数据到 D1 数据库

---

## 适用场景

**场外基金详情页需要的数据**：
- ✅ 今年以来收益率：`derived.nav_grlty`
- ✅ 最大回撤：`achievement.self_max_draw_down`
- ✅ 基金规模：`detail.fund_position.asset_tot`
- ✅ 单位净值：`derived.unit_nav`
- ✅ 日涨跌幅：`derived.nav_grtd`

全部数据已可通过公开 API 获取！
