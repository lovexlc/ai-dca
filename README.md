# ai-dca

`ai-dca` 是一个面向纳指相关基金/ETF 的策略看板项目，当前仓库主要包含：

- React 前端工作台
- 数据抓取与静态页面发布脚本
- Cloudflare Worker:
  `ocr-proxy` 用于 OCR/识别代理
  `notify` 用于提醒同步、测试通知、定时规则检测

Android 推送接收端已经拆分到独立仓库，不再放在本项目内：

- `ai-dca-android-notify`

## 功能概览

- `加仓计划`
  查看价格走势、建仓层级、资金配置模型和策略列表
- `新建建仓计划`
  创建均线分层或固定回撤策略
- `定投计划`
  支持固定定投，或关联加仓策略后按周期总预算分批执行
- `交易计划中心`
  同步提醒规则、发送测试通知、查看最近提醒记录、管理 Bark / Android 推送
- `基金切换收益助手`
  上传截图后进行 OCR 识别，并计算切换收益

## 目录结构

```text
src/                 React 页面与前端逻辑
workers/notify/      通知 Worker
workers/ocr-proxy/   OCR 代理 Worker
scripts/             数据抓取与页面发布脚本
data/                本地数据文件
docs/                发布到静态站点的产物
frontend-dist/       本地构建产物
```

## 本地开发

要求：

- Node.js 20+
- npm
- Python 3
- 可选：Wrangler，用于本地调试 Worker

安装依赖：

```bash
npm install
```

启动前端开发环境：

```bash
npm run dev
```

构建前端：

```bash
npm run build:app
```

构建并发布静态页面产物：

```bash
npm run build
```

## 数据相关命令

抓取纳指基金/ETF 日线数据：

```bash
npm run data:fetch-nasdaq-daily
```

抓取纳指 100 基准数据：

```bash
npm run data:fetch-nasdaq-benchmark
```

## Worker 开发

本地调试 OCR 代理：

```bash
npm run worker:dev
```

本地调试通知 Worker：

```bash
npm run worker:notify:dev
```

部署 OCR 代理：

```bash
npm run worker:deploy
```

部署通知 Worker：

```bash
npm run worker:notify:deploy
```

对应环境变量示例见：

- [workers/ocr-proxy/.dev.vars.example](workers/ocr-proxy/.dev.vars.example)
- [workers/notify/.dev.vars.example](workers/notify/.dev.vars.example)

更细的 Worker 说明见：

- [workers/ocr-proxy/README.md](workers/ocr-proxy/README.md)
- [workers/notify/README.md](workers/notify/README.md)

## 发布说明

- `docs/` 和 `frontend-dist/` 都是构建产物，修改前端后通常会更新
- 通知 Worker 运行在 `tools.freebacktrack.tech/api/notify*`
- OCR Worker 运行在 `tools.freebacktrack.tech/api/*`

## 备注

- 仓库目录名当前仍为 `ai-dca-stragety`，但项目语义上就是 `ai-dca`
- Android app 已迁移到独立仓库，后续移动端推送侧变更应在 `ai-dca-android-notify` 中维护

## 社区支持

感谢 [LinuxDo](https://linux.do/) 各位佬的支持。欢迎加入 LinuxDo，这里有技术交流、AI 前沿资讯和实战经验分享。
