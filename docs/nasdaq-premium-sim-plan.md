# 纳指 ETF 溢价差量化 · 模拟盘上线计划

## 目标

把已有的纳指 ETF H/L 溢价差量化引擎（`scripts/quant_premium_runner.py`）真正跑起来，第一阶段只用**模拟盘**：实时拉取 H/L 类纳指 ETF 的盘口/IOPV，计算溢价差，触发阈值后只写模拟成交（绝不下真实委托），并把信号、成交、账户状态落盘，便于复盘。

## 范围与边界

- 纯后端 / 数据 / 运行脚本工作，与页面无关。
- 只做模拟撮合：卖一减滑点成交、买一加滑点成交，受一档量、整手、现金、持仓限制。
- 不接入券商、不发真实委托。
- 行情来源：`https://tools.freebacktrack.tech/api/markets/fund-metrics`（公开接口，无需 token）。

## 步骤清单

- done: 梳理已有引擎、示例配置、依赖与测试现状。
- done: 确认运行环境（Python 3.13、requests、PyYAML 已就绪）。
- done: 新增正式配置 `config/quant-premium.yaml`（纳指 H/L 三只 ETF）。
- done: 把模拟盘输出目录 `data/quant/` 加入 `.gitignore`。
- done: 跑一次模拟盘冒烟：`--once --allow-off-session`，验证信号/撮合/落盘。
- done: 复核输出 `state.json` / `signals.jsonl` / `orders.jsonl`。
- todo: 提交配置与文档（不提交运行态数据）。

## 关键决策

- 配置与示例分离：`config/quant-premium.example.yaml` 留作模板，正式参数放 `config/quant-premium.yaml`。
- 模拟盘默认 `only_trading_session: true`；非交易时段冒烟用 `--allow-off-session` 强制跑一遍以验证链路。
- 触发阈值沿用示例：基准为 H 类（159513），低估买入差 `intra_buy_other_pct=3.0`，卖出收敛差 `intra_sell_lower_pct=1.0`。
- 运行态产物（state/signals/orders）属于本地数据，不进版本库。

## 待确认项

- 账户初始现金 / 底仓：暂用示例值（现金 60000，159513 底仓 20000 股、513100 底仓 8000 股）。如与真实模拟盘设定不同，按用户给定值调整。
- 标的池是否要加入更多纳指 ETF。暂按示例三只。

## 验证记录

- 2026-06-14 08:48（周日休市，加 `--allow-off-session`）：
  - 正常路径：exit 0，输出 `{"triggers":0,"orders":0,"skipped":0,"cash":60000.0}`。引擎拉取实时 IOPV/盘口：159513 溢价 7.47%、513100 7.93%、159501 8.24%，gap 分别 -0.46% / -0.77%，均未达 3.0% 买入阈值，故未触发（符合预期）。落盘 `data/quant/state.json` 与 `signals.jsonl`（无触发未生成 `orders.jsonl`）。
  - 异常路径：`--config config/does-not-exist.yaml` → exit 1，`FileNotFoundError`，干净报错退出。
