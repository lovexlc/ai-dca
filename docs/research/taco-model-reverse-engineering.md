# 小隐寺 Hormuz TACO 转向分：历史数据与模型反推

分析快照：2026-07-28 UTC
目标页面：<https://data.xiaoyinsi.com/taco?range=all>

## 结论

页面不是在浏览器里逐日请求行情后计算曲线。它由 Next.js 服务端把完整的
`date/score` 序列写进 HTML/RSC，前端 JavaScript 只负责用 ECharts 画图。
本次抓包没有观察到独立的历史曲线 API。

完整序列共有 1,707 个连续的**自然日**，从 2021-11-25 到 2026-07-28；
其中最低 0 分、最高 99 分、0 分有 734 天。页面把它称为“交易日”，但序列
实际包含周末。

外层分数归一化几乎可以确定为：

```text
score = clip(round(composite_z / 2.9 * 100), 0, 100)
```

理由是原模型公开说明中的历史转向区间为 2.3–3.4 个标准差、均值约为
2.9；页面 RSC 中对应阈值是 `actionLow=79`、`pivot=100`、
`actionHigh=100`。其中 `round(2.3 / 2.9 × 100) = 79`，均值映射为
100，而 3.4 映射后超过 100 并被截断。

四个因子的方向是：

```text
composite_z = 油价压力 + 利率压力 + 航运中断压力 + 股市下跌压力
            = +Brent +UST10Y -HormuzCrossings -SP500
```

公开说明称每个因子先转成相对固定基准的加权 z-score。固定基准 z-score
展开后就是“截距 + 四个原始水平值”的线性式，这也与历史序列的拟合结果
一致；滚动 z-score 和价格变化率模型明显更差。

## 可复现的等价近似式

用 FRED 的 Brent、美国 10 年期国债收益率和 S&P 500，加上 IMF
PortWatch 的霍尔木兹每日 `n_total`，在数据共同覆盖的
2021-11-25 至 2026-07-19 上反推得到：

```text
composite_z_hat =
    0.283408
  + 0.0177304 × Brent
  + 0.170899  × UST10Y
  - 0.0000419026 × SP500
  - 0.0222134 × HormuzTotal

score_hat = clip(round(composite_z_hat / 2.9 × 100), 0, 100)
```

单位：

- `Brent`：美元/桶。
- `UST10Y`：百分数，例如 4.64，而不是 0.0464。
- `SP500`：指数点位。
- `HormuzTotal`：当日全部 AIS 过航船数，不只是油轮。

直接写成分数：

```text
score_hat = clip(round(
    9.7727
  + 0.611395 × Brent
  + 5.89306  × UST10Y
  - 0.00144492 × SP500
  - 0.765978 × HormuzTotal
), 0, 100)
```

因此在其他变量不变时，局部敏感度约为：

- Brent 每上涨 1 美元，转向分增加 0.61 分。
- 10 年期收益率每上涨 0.1 个百分点，转向分增加 0.59 分。
- S&P 500 每上涨 100 点，转向分减少 0.14 分。
- 霍尔木兹每多通行 1 艘船，转向分减少 0.77 分。

最后一项解释了 2026 年航运骤降后分数的大幅跳升。

## 验证结果

拟合只使用大于 0 的样本，因为 0 分是外层截断后的左删失值；指标则在
全部可连接日期上计算。

| 模型 | 样本数 | RMSE | MAE | R² | 完全相同 | 误差 ≤ 1 | 误差 ≤ 3 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 四因子，霍尔木兹 `n_total` | 1,698 | 1.803 | 1.016 | 0.9936 | 53.2% | 73.2% | 93.0% |
| 四因子，仅油轮 `n_tanker` | 1,698 | 4.304 | 2.698 | 0.9634 | 42.2% | 51.9% | 67.3% |
| 仅三个金融市场因子 | 1,698 | 15.626 | 12.610 | 0.5173 | 10.2% | 14.0% | 21.6% |

时间外验证没有用 2026 年验证期重新调参：仅以 2025 年正分样本拟合，
预测 2026-01-01 至 2026-02-27 的 58 天，得到 RMSE 1.259、MAE
0.828、R² 0.9772；43.1% 完全相同，81.0% 误差不超过 1 分，
98.3% 误差不超过 3 分。

这说明页面航运因子的概念口径是**全部过航船数**而不是仅油轮；公开数据
代理应使用 PortWatch `n_total`。页面实时源仍是 Windward，二者的 AIS
识别和日界线不完全相同。结果也说明线性关系不是单纯利用 2026 年航运
断崖进行的样本内过拟合。

## 能反推出什么，不能反推出什么

可以较高置信度确认：

1. 四因子、方向和 2.9 标准差到 100 分的归一化。
2. 航运因子对应全部过航船数。
3. 页面历史模型等价于固定基准的线性组合，而非滚动窗口收益率模型。
4. 上述等价式能以约 1–2 分误差复现公开历史曲线。

无法仅从一个最终分数唯一确定：

1. 原始模型为每个因子选择的均值、标准差和权重。在线性展开中只能识别
   `weight / standardDeviation` 及合并后的截距；三者存在无穷多组等价解。
2. 小隐寺使用的精确行情收盘时点和 Windward AIS 统计口径。
3. 2026-07-20 至 2026-07-28 的独立航运输入。PortWatch 快照只更新到
   7 月 19 日，而页面的实时卡片使用 Windward 24 小时数据。

## 实时四因子接入

test 环境不再抓取目标 TACO 页。markets Worker 按 `0 */2 * * *`（UTC）定时
通过 Cloudflare Browser Run 的 `scrape` Quick Action 读取 Windward 页面，再读取
Yahoo 的 Brent `BZ=F`、美债 10Y `^TNX`、S&P 500 `^GSPC`，在 Worker 内执行
上面的本地等价式，并把完整结果写入测试 KV 的 `taco:live`。`GET /api/markets/taco`
是只读缓存接口，缓存缺失或超过 6 小时直接返回 503，不会在前端请求路径上补拉
外部源。

Windward 运行时读取 `.dmap-panel.dmap-in .dmap-sub` 和
`.dmap-panel.dmap-out .dmap-sub` 中的 24 小时过境数，两者相加作为霍尔木兹因子；
数据日期从页面 footer 的 Windward 来源日期提取。前端每两小时重新读取 KV，缓存
不可用时保留 CSV 历史快照作为降级展示。模型系数仍是基于历史拟合的公开等价式，
历史拟合使用 PortWatch，实时输入改为 Windward，因此两种口径仍可能产生偏差。

如果用战前样本标准差把等价系数重新表示成权重，得到的量级约为：
Brent 25–28%、10Y 13–16%、S&P 500 4–5%、霍尔木兹通行 52–56%。
这是依赖标准化窗口的**估计范围**，不是已公开或可唯一证明的原始权重。

页面最新卡片的分项占比不应拿来强行求精确权重：实时 Windward 数值、
FRED 日频数据和页面历史分数的结算时点并不完全同步。

## 数据来源

- TACO 分数与页面阈值：[小隐寺 TACO 页](https://data.xiaoyinsi.com/taco?range=all)
  HTML/RSC。
- 模型结构和历史阈值：[Signum Hormuz TACO 公开报道](https://coinedition.com/signums-hormuz-taco-index-signals-possible-trump-iran-pivot-by-late-july/)。
- Brent：[FRED `DCOILBRENTEU`](https://fred.stlouisfed.org/series/DCOILBRENTEU)，
  源自美国 EIA。
- 美国 10 年期国债收益率：
  [FRED `DGS10`](https://fred.stlouisfed.org/series/DGS10)，源自美联储。
- S&P 500：[FRED `SP500`](https://fred.stlouisfed.org/series/SP500)。
- 霍尔木兹通行：[IMF PortWatch ArcGIS 接口](https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/Daily_Chokepoints_Data/FeatureServer/0/query)
  的 `Daily_Chokepoints_Data`，
  `portid='chokepoint6'`，字段 `n_total`。World Bank 的 PortWatch
  [方法说明](https://worldbank.github.io/alternative-data-for-crisis/notebooks/disruptions-business-trade/chokepoints-monitor.html)
  记录了接口、分页方式和字段定义。
- test Worker 运行时航运输入：[Windward Daily Intelligence](https://insights.windward.ai/)，
  通过 Cloudflare Browser Run 读取页面元素。

## 交付文件和复现

- `data/taco/taco-history-2026-07-28.csv`：完整 1,707 日公开分数。
- `data/taco/taco-model-fit-2026-07-19.csv`：公开输入、预测值和残差。
- `scripts/reverse_taco_model.mjs`：HTML 提取、连续性校验、候选模型拟合、
  消融比较、时间外验证和 CSV 输出。

示例：

```bash
curl -L 'https://data.xiaoyinsi.com/taco?range=all' \
  -o /tmp/taco-all.html

node scripts/reverse_taco_model.mjs \
  --html /tmp/taco-all.html \
  --out data/taco/taco-history-2026-07-28.csv \
  --fred-daily /tmp/taco-fred-daily.csv \
  --fred-sp500 /tmp/taco-fred-sp500.csv \
  --hormuz-json /tmp/taco-hormuz-0.json,/tmp/taco-hormuz-1000.json,/tmp/taco-hormuz-2000.json \
  --cutoff 2026-07-19 \
  --fit-out data/taco/taco-model-fit-2026-07-19.csv
```

PortWatch 每次最多返回 1,000 条，因此示例中的三个 JSON 文件分别是
`resultOffset=0`、`1000` 和 `2000` 的分页结果。
