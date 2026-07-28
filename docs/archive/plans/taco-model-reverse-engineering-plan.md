# Hormuz TACO 历史数据与计算模型反推计划

**状态（2026-07-28）**：done。完整历史数据、公开输入代理、等价模型、
消融测试、时间外验证、复现脚本和 test 情绪侧边栏均已交付。

## 目标

从 <https://data.xiaoyinsi.com/taco?range=all> 获取“转向分历史曲线”的
全部历史数据，并根据页面阈值、公开模型说明及独立市场/航运数据，反推一套
可以复现页面历史分数的计算模型。

## 步骤清单

- done：检查页面网络请求、HTML、RSC 和前端 JavaScript，确认曲线数据的
  实际交付方式。
- done：提取并去重全部 `date/score` 记录，校验日期连续性。
- done：核对页面四个因子、方向、转向阈值和历史事件。
- done：下载 FRED Brent、美国 10 年期国债收益率、S&P 500 日频数据。
- done：下载 IMF PortWatch 霍尔木兹海峡每日船舶通行数据。
- done：比较 `n_total`、`n_tanker`、无航运因子、滚动 z-score 和变化率
  等候选模型。
- done：反推固定基准线性等价式和 2.9 标准差到 100 分的外层映射。
- done：执行样本内、消融和 2026 年时间外验证。
- done：输出历史 CSV、逐日拟合 CSV、分析脚本、测试和详细报告。
- done：在 test 环境新增「情绪」侧边栏入口和 TACO 情绪监控页面，使用仓库内
  离线快照，不在页面渲染时请求外部详情接口。
- done：执行脚本语法、Node 测试、refactor guard、ESLint 和
  `git diff --check`。

## 页面数据获取结论

页面由 Next.js 服务端把完整历史序列写入 HTML/RSC，客户端 JavaScript
只负责通过 ECharts 绘图。本次抓包没有发现独立的历史曲线 API。

提取后的序列：

| 项目 | 结果 |
| --- | --- |
| 记录数 | 1,707 |
| 起始日期 | 2021-11-25 |
| 结束日期 | 2026-07-28 |
| 日期频率 | 连续自然日，包含周末 |
| 最低 / 最高 | 0 / 99 |
| 0 分天数 | 734 |

页面虽然显示“交易日”，但实际序列包含周末。

## 模型结构

Signum 的公开说明称模型由四个加权 z-score 组成：

- Brent 原油价格越高，压力越高。
- 美国 10 年期国债收益率越高，压力越高。
- S&P 500 越低，压力越高。
- 霍尔木兹船舶通行量越低，压力越高。

历史政策转向发生在 2.3–3.4 个标准差之间，平均约 2.9 个标准差。页面
RSC 中的阈值为 `actionLow=79`、`pivot=100`、`actionHigh=100`，
因此外层映射几乎可以确定为：

```text
score = clip(round(composite_z / 2.9 × 100), 0, 100)
```

验证关系：

```text
round(2.3 / 2.9 × 100) = 79
2.9 / 2.9 × 100 = 100
3.4 / 2.9 × 100 > 100，截断为 100
```

固定基准的加权 z-score 展开后等价于“截距 + 四个原始水平值”的线性式。
这与历史拟合结果一致；滚动 z-score 和价格变化率模型明显更差。

## 反推的可复现等价式

使用 FRED 市场数据和 IMF PortWatch `n_total`，在共同覆盖的
2021-11-25 至 2026-07-19 上拟合：

```text
composite_z_hat =
    0.283408
  + 0.0177304 × Brent
  + 0.170899 × UST10Y
  - 0.0000419026 × SP500
  - 0.0222134 × HormuzTotal

score_hat = clip(round(composite_z_hat / 2.9 × 100), 0, 100)
```

等价的直接分数公式：

```text
score_hat = clip(round(
    9.7727
  + 0.611395 × Brent
  + 5.89306 × UST10Y
  - 0.00144492 × SP500
  - 0.765978 × HormuzTotal
), 0, 100)
```

变量单位：

- `Brent`：美元/桶。
- `UST10Y`：百分数，例如 `4.64`，不是 `0.0464`。
- `SP500`：指数点位。
- `HormuzTotal`：当日全部 AIS 过航船数，不是仅油轮数。

局部敏感度：

| 输入变化 | 转向分变化 |
| --- | ---: |
| Brent +1 美元 | 约 +0.61 |
| 10Y +0.1 个百分点 | 约 +0.59 |
| S&P 500 +100 点 | 约 -0.14 |
| 霍尔木兹通行 +1 艘 | 约 -0.77 |

## 验证结果

拟合阶段仅使用大于 0 的日期，因为 0 是外层截断后的左删失值；评估阶段
使用全部可连接日期。

| 模型 | 样本数 | RMSE | MAE | R² | 完全相同 | 误差 ≤ 1 | 误差 ≤ 3 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 四因子 + `n_total` | 1,698 | 1.803 | 1.016 | 0.9936 | 53.2% | 73.2% | 93.0% |
| 四因子 + `n_tanker` | 1,698 | 4.304 | 2.698 | 0.9634 | 42.2% | 51.9% | 67.3% |
| 仅三个金融市场因子 | 1,698 | 15.626 | 12.610 | 0.5173 | 10.2% | 14.0% | 21.6% |

时间外验证：

- 训练期：2025-01-01 至 2025-12-31。
- 验证期：2026-01-01 至 2026-02-27，共 58 天。
- RMSE 1.259，MAE 0.828，R² 0.9772。
- 43.1% 完全相同，81.0% 误差不超过 1 分，98.3% 误差不超过 3 分。

结论：航运因子的概念口径是全部过航船数，而非仅油轮；PortWatch
`n_total` 是合适的公开数据代理。时间外结果也排除了仅利用 2026 年航运
断崖进行样本内过拟合的主要疑虑。

## 权重估计与识别边界

从最终总分只能识别 `weight / standardDeviation` 和合并后的截距，
无法唯一拆出每项的原始均值、标准差和权重。

如果使用战前样本标准差重新表示，权重量级约为：

| 因子 | 估计范围 |
| --- | ---: |
| Brent | 25–28% |
| 美国 10Y | 13–16% |
| S&P 500 | 4–5% |
| 霍尔木兹通行 | 52–56% |

这些是依赖标准化窗口的估计范围，不是可唯一证明的 Signum 原始权重。

另外，页面实时航运源是 Windward，而公开复现使用 IMF PortWatch；
两者的 AIS 识别规则、日界线和发布时间不完全一致。PortWatch 快照只更新
到 2026-07-19，因此 7 月 20–28 日只提取了页面分数，没有用于独立输入
拟合。

## 数据来源

- 页面分数和阈值：
  <https://data.xiaoyinsi.com/taco?range=all>
- Signum 模型结构和历史阈值：
  <https://coinedition.com/signums-hormuz-taco-index-signals-possible-trump-iran-pivot-by-late-july/>
- Brent：
  <https://fred.stlouisfed.org/series/DCOILBRENTEU>
- 美国 10 年期国债收益率：
  <https://fred.stlouisfed.org/series/DGS10>
- S&P 500：
  <https://fred.stlouisfed.org/series/SP500>
- IMF PortWatch ArcGIS：
  <https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/Daily_Chokepoints_Data/FeatureServer/0/query>
- World Bank PortWatch 方法说明：
  <https://worldbank.github.io/alternative-data-for-crisis/notebooks/disruptions-business-trade/chokepoints-monitor.html>
- Windward 实时通行数据：
  <https://insights.windward.ai/>

## 产出

- `data/taco/taco-history-2026-07-28.csv`
  - 全部 1,707 个页面历史分数。
- `data/taco/taco-model-fit-2026-07-19.csv`
  - 公开输入、模型预测和逐日残差。
- `scripts/reverse_taco_model.mjs`
  - RSC 提取、连续性校验、候选模型、消融比较、时间外验证和 CSV 输出。
- `test/reverseTacoModel.test.mjs`
  - 覆盖 RSC 重复记录去重和历史序列缺日拒绝。
- `docs/research/taco-model-reverse-engineering.md`
  - 完整研究报告。
- `src/pages/SentimentExperience.jsx`
  - test-only 情绪监控页面：当前分数、四因子、历史曲线、事件点和模型解释。
- `src/app/tacoSentimentData.js`
  - 离线快照、历史 CSV 解析、模型元数据和历史事件。
- `src/app/environment.js`
  - test hostname 判断，确保生产侧边栏不显示情绪入口。
- `test/e2e/sentiment-sidebar.spec.js`
  - test host 情绪侧边栏和 TACO 页面验收。

## 复现命令

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

PortWatch 每次最多返回 1,000 条记录，因此霍尔木兹 JSON 需要按
`resultOffset=0`、`1000`、`2000` 分页。

## 验证记录

- `node --check scripts/reverse_taco_model.mjs`：passed。
- `node --test test/reverseTacoModel.test.mjs`：passed。
- `npm run check:refactor`：passed。
- `npm run lint -- --quiet`：passed。
- `npm run build:app`：passed。
- `PLAYWRIGHT_BASE_URL=http://test.localhost:4173 npx playwright test sentiment-sidebar.spec.js --project=chromium`：passed。
- 生产 host 隔离检查：`127.0.0.1` 不显示「情绪」入口，并回到默认首页。
- `git diff --check`：passed。

## 后续可选项

- todo：如果取得 Windward 的完整历史 API，替换 PortWatch 代理并重新拟合，
  检查误差能否进一步收敛。
- todo：连续保存页面每日因子占比快照，以增加识别原始基准和精确权重所需的
  独立约束。
- todo：若业务要在站内使用该指标，将公式实现为独立纯函数，并增加固定样本
  回归测试；不得在列表页为每个标的预取详情级历史数据。
