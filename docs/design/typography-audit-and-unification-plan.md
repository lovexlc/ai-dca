# AI DCA 字体现状审计与统一方案

> 状态：核心实施完成 v1（Phase 1、2 与 Phase 3 部分）
> 审计日期：2026-07-15
> 审计统计基线：`ff36db38916b3945d620406aa80a43edc5327d40`（不含未提交工作区）
> 实施基线：`576f46654b3e4c0fa7dee4162c5cc36b0118ffc2`
> 范围：生产前端、行情 Worker SVG、设计 mockup；`docs/react-assets-v2` 视为构建产物，不作为修改源

## 1. 结论先行

当前项目并没有真正加载很多字体。生产界面实际几乎全部使用一套平台系统无衬线字体，且不存在字体文件、`@font-face`、Google Fonts、字体 npm 包或字体预加载。

真正的问题有四个：

1. `#root * { font-family: ... !important }` 把所有 React 子元素强制成无衬线字体，连 `.font-mono`、`code/pre` 和行情中心局部字体也被覆盖。
2. 行情中心声明了 Inter / SF Pro，但 Inter 没有加载，这套声明当前是死配置；解除全局覆盖后又会变成跨设备不一致的隐患。
3. 字号、字重和字距没有语义 token。项目存在大量 7–10px 文本、411 处 JSX 任意像素字号，以及 550/650/750/760/780 等跨平台不稳定的字重。
4. 金融数据、证券代码和技术代码共用 `font-mono` 语义。数字对齐本应使用 `tabular-nums`，不应靠整段等宽字体解决。

建议采用“统一规则，不强求所有平台使用同一个字体文件”的方案：

- UI：一套平台原生 system font stack，覆盖标题、正文、按钮和表格。
- Data：仍使用 UI 字体，通过 `tabular-nums lining-nums` 对齐价格、金额、净值、收益率和日期。
- Code：单独的系统等宽栈，只用于代码、命令、原始 ID、日志和原始导入文本。
- 第一阶段不引入 Web Font；如果未来有明确的跨平台像素一致性或品牌诉求，再独立评估自托管 Noto Sans SC。

这与 Apple 的系统字体思路、Microsoft Fluent 的跨平台原生字体策略一致，也吸收了 Material 和 IBM Carbon 以语义 token 管理字号、行高、字重和使用场景的做法。

## 落地记录（2026-07-15）

本方案的低风险主体已经实施：

- `src/styles/tokens.css` 成为 UI、Code、字重、字号和行高的唯一 token 来源；保留旧变量 alias 兼容运行期消费者。
- 新增 `src/styles/typography.css`，建立 UI / Data / Code 语义类和紧凑型 type scale。
- 删除 `#root *`、`.font-mono`、SVG 和内联 style 字符串选择器上的全局字体 `!important`，表单控件改为 base layer 正常继承。
- 23 处业务 `font-mono` 已完成分类：金融数字、计数与证券代码归 `type-data`；命令、uniqId、原始导入文本和文件名归 `type-code`。
- 行情字体改为 `--app-font-ui` alias，删除未加载的 Inter / SF Pro 声明和三处行情/持仓代码等宽字体。
- 550 / 650 / 750 / 760 / 780 已归并为 500 / 600 / 700；行情数据继续使用等宽数字特性。
- Worker 独立 SVG 和三份设计 mockup 已统一采用同等 system-first 栈。
- 新增静态架构测试与 Playwright computed-style 测试，覆盖表单、Portal、行情、Data、Code、Tailwind mono 兼容和 Recharts SVG text。

本次有意不做全站字号重排。7–10px 可读性、移动输入框 16px、中文 `tracking` 和 411 处任意字号将在后续按页面治理，避免与字体继承变更叠加布局风险。

| 阶段 | 状态 | 实施基线 | 验证证据 |
| --- | --- | --- | --- |
| Phase 0 | 自动化基线完成；多平台人工矩阵待执行 | `576f4665` | `test/e2e/typography.spec.js` |
| Phase 1 | 完成 | `576f4665` | token、行情 alias、Worker SVG、mockup |
| Phase 2 | 完成 | `576f4665` | 23 处语义迁移、正常继承、computed style E2E |
| Phase 3 | 部分完成 | `576f4665` | 非标准字重已清理；字号/tracking 待逐页迁移 |
| Phase 4 | 部分完成 | `576f4665` | 静态守卫已落地；GM3 alias 暂保留 |

## 2. 审计范围与方法

本次扫描仅统计审计基线的 committed tree，排除未提交工作区与 `docs/react-assets-v2` 构建产物，覆盖：

- `src/**/*.css|jsx|js|tsx|ts`
- `index.html` 与生产样式入口
- `workers/**` 中生成 SVG、Canvas、PDF 相关字体逻辑
- `docs/mockups/**` 中的设计参考页面
- 字体文件、远程字体、`@font-face`、预加载和字体依赖

构建后的 `docs/react-assets-v2` 只用于核对产物是否复现源码行为，不应手工修改。

静态扫描快照：

| 项目 | 结果 |
| --- | ---: |
| 本地字体文件（woff/woff2/ttf/otf/eot） | 0 |
| `@font-face` | 0 |
| 远程字体请求 | 0 |
| JSX/JS `font-mono` | 23 处 |
| JSX/JS `tabular-nums` | 269 处 |
| JSX 任意像素字号 `text-[Npx]` | 411 处 |
| JSX 中 `uppercase` 与 tracking 组合 | 约 88 处 |
| CSS 中 550/650/750/760/780 字重 | 36 处 |

其中 411 为任意 px 字号的匹配次数（包含小数），88 为同一源码行同时出现 `uppercase` 与 tracking 的行数，36 为 CSS 非标准字重的匹配次数；这些数字保留为 pre-change 基线，不随实施后代码覆盖。

## 3. 当前字体清单

| 场景 | 声明 | 位置 | 实际状态 |
| --- | --- | --- | --- |
| 全局 UI sans | `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", Arial, sans-serif` | `src/styles/app.css:44` | 当前生产主字体 |
| 全局 mono | `ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace` | `src/styles/app.css:45` | 已定义，但在 `#root` 内基本失效 |
| Tailwind v4 映射 | `--font-sans`、`--font-mono` | `src/styles/app.css:9-11` | 映射入口正确 |
| 行情中心 | `Inter, "SF Pro Text", "SF Pro Display", ...` | `src/styles/console.css:2749-2767` | 被全局规则覆盖；Inter 也未加载 |
| Recharts / SVG text | 强制使用全局 sans | `src/styles/app.css:152-157` | 当前生效，但依赖全局 `!important` |
| Worker 独立 SVG | `ui-sans-serif, system-ui, sans-serif` | `workers/markets-agent/container/skills/fund-backtest/lib/chart.js:55,62,69,74` | 独立于前端 CSS，确实生效 |
| 设计 mockup | 三套不同系统栈 | `docs/mockups/income/*.html`、`docs/mockups/hero-v6.7/index.html` | 不影响生产，但设计截图会漂移 |

生产样式只有一个入口：`src/entry-screen.jsx:7` 引入 `src/styles/app.css`，再由 `app.css:1-5` 汇入 Tailwind、tokens、topbar 和 console 样式。

### 3.1 不同平台的当前结果

当前系统栈不会让所有平台的字形完全相同，预期结果是：

| 平台 | 拉丁/数字主字体 | 简体中文通常回退到 |
| --- | --- | --- |
| macOS / iOS | SF 系统字体 | PingFang SC |
| Windows | Segoe UI | Microsoft YaHei |
| Android / Capacitor WebView | Roboto / system-ui | 系统 Noto CJK |
| Linux CI | 取决于镜像字体 | 常见为 Noto 或发行版 sans |

这种策略统一的是字体规则、层级和语义，不承诺跨操作系统的逐像素一致。

## 4. 当前问题与风险

### P0：全局级联让字体语义失效

`src/styles/app.css:138-160` 同时匹配：

```css
#root *,
code,
pre,
.font-sans,
.font-mono,
svg text,
[style*="font-family"] {
  font-family: var(--font-sans) !important;
}
```

后面的 `code/pre/kbd/samp { font-family: var(--font-mono) !important; }` 无法可靠改回等宽字体，因为 `#root *` 的选择器优先级更高，双方又都带 `!important`。

结果是：

- `--app-font-mono` 基本成为死 token。
- 23 处 JSX `font-mono` 只有源码语义，没有对应视觉结果。
- 行情中心、Recharts、第三方组件和内联字体都依赖强制覆盖，难以局部定制。
- `[style*="font-family"]` 是字符串包含选择器，可能误伤未来真正需要自定义字体的组件。

典型受影响位置：

- `src/pages/markets/MarketListTable.jsx:407`
- `src/pages/holdings/aggregateHoldingsColumns.jsx:41`
- `src/pages/NotifyConfigCard.jsx:137`
- `src/pages/holdings/TransactionImportModals.jsx:136`

### P1：行情字体是死配置，也是潜在回归源

`src/styles/console.css:2751` 声明 Inter / SF Pro / 中文 fallback，但：

- 项目没有加载 Inter；只有用户恰好在系统中安装时才可能命中。
- SF Pro 不是通用跨平台 Web 字体依赖。
- 当前声明被 `#root * !important` 覆盖。
- 一旦直接删除全局覆盖，安装与未安装 Inter 的设备会出现不同列宽、截断和换行。

因此解除全局强制前，必须先把 `--market-font-family` alias 到统一 UI token，或直接删除行情局部字体栈并继承全局字体。

### P1：字重在中文和跨平台环境中不稳定

`src/styles/console.css` 当前有：

- 550：2 处
- 650：16 处
- 750：16 处
- 760、780：各 1 处
- 800：63 处

同时 `src/styles/app.css:132` 使用 `font-synthesis-weight: none`。系统拉丁字体可能是可变字体，但中文 fallback 常只有有限档位，导致 650、700、750 等值在不同平台吸附到不同的最近字重，甚至多个层级最终看起来完全一样。

### P1：字号过碎，小字号对中文不友好

JSX 中最常见的是 Tailwind `text-xs` 和 `text-sm`，但又额外存在 411 处 `text-[Npx]`。任意字号从 8px 一直延伸到 44px；CSS 中还出现 7px。

高风险例子集中在移动端基金切换和行情区域：

- `src/styles/console.css:2409-2651`：大量 9px
- `src/styles/console.css:2923`：8px
- `src/styles/console.css:2964`：7px
- `src/styles/console.css:2806`：移动搜索输入框 12px

7–9px 的中文字形细节非常容易糊成一团，不应承载用户必须读取或操作的信息。移动端输入框低于 16px 还需验证 iOS Safari / WebView 聚焦自动缩放。

### P1：英文 eyebrow 样式被直接套到中文

约 88 处 JSX 将 `uppercase` 与较大的 tracking 一起使用，其中不少内容是中文，例如：

- `src/pages/NewPlanSelectionCards.jsx:43`
- `src/pages/DcaExperience.jsx:129`
- `src/pages/holdings/HoldingSummaryPanel.jsx:30,57`
- `src/pages/NotifyConfigCard.jsx:123`

`uppercase` 对中文没有作用，但 `tracking-[0.12em~0.18em]` 会把汉字机械拉开。中文标题和标签默认应为 `letter-spacing: 0`；只有纯拉丁大写 eyebrow 才保留适量字距。

### P2：字体 token 与设计 token 分离

`src/styles/tokens.css` 已经承载颜色、圆角和层级，但字体变量仍留在 `app.css:42-55`。此外，10 个 `--gm3-*-font` 变量在仓库源码中未发现消费者，可能是兼容占位或遗留配置，删除前需要先确认运行期 Web Component 是否依赖。

### P2：Data 与 Code 语义混用

证券代码、价格、金额、技术 ID、命令和 OCR 原文目前都可能使用 `font-mono`。应拆成：

- 证券代码、价格、金额：UI/Data 字体，使用等宽数字特性。
- 原始 ID、命令、日志、代码块：Code 等宽字体。

项目已有很好的基础：JSX/JS 中有 269 处 `tabular-nums`，应将它提升为统一 Data token，而不是改成整段 monospace。

## 5. 业界规范对照

### 5.1 Apple Human Interface Guidelines

Apple 的公开规范强调：

- 系统字体针对平台、字号和语言优化；SF Pro 是 Apple 平台系统字体。
- 尽量减少字体家族数量，过多字体会破坏信息层级和一致性。
- 小字号避免 Ultralight、Thin、Light，优先 Regular、Medium、Semibold、Bold。
- 使用系统 text styles 表达语义层级，并支持 Dynamic Type / 辅助功能字号。
- iOS/iPadOS 给出的默认/最低参考为 17pt/11pt，macOS 为 13pt/10pt。

Apple 的 pt 数值是原生平台规范，不应直接按 1:1 复制成 Web CSS px；本项目应借鉴“系统字体、语义样式、可缩放、减少字体家族”的原则。

Apple Fonts 页面只明确说明 SF Pro 覆盖 Latin、Greek、Cyrillic；不能把 SF Pro 当作中文字体方案。中文仍应交给平台 CJK fallback，这也是本方案保留 PingFang SC、Microsoft YaHei 和 Noto Sans CJK SC 的原因。

### 5.2 Google Material 3

截至本次审计，Material 3 的官方页面已更新为：

- 5 类角色：Display、Headline、Title、Body、Label。
- 30 个样式：15 个 baseline + 15 个 emphasized。
- 每个样式由 token 统一封装 font、size、line height、tracking、weight 等属性。
- Roboto 是 Android 与 M3 默认字体；Noto Sans 作为不支持字符/语言时的 fallback。
- 大字号建议行高约为字号的 1.2 倍，较小的 Body/Label 约为 1.5 倍。
- 官方明确指出一个产品不必使用整套 scale，应选择适合自身上下文的少量角色。

对本项目最有价值的不是复制 Roboto，而是采用“角色 token + 少量实际用到的层级 + Data 状态强调”的组织方式。

当前 Material 官方状态表仍把 Web Expressive 标为 unavailable，因此“30 个设计样式”不等于 Web 项目应立即实现 30 套样式；本方案只采用稳定的角色和 token 方法。

### 5.3 Microsoft Fluent 2

Fluent 2 的官方表述最直接支持本项目的系统字体方案：虽然 Segoe UI 是 Fluent 的主字体，但跨平台默认使用原生系统字体，以获得熟悉且可访问的体验。

Fluent 还为不同平台分别采用：

- Web / Windows：Segoe UI / Segoe UI Variable
- macOS / iOS：San Francisco Pro
- Android：Roboto

其 Web ramp 中，Body 1 为 14px/20px，Caption 1 为 12px/16px，并用明确的语义名称管理层级。这说明“跨平台字体可不同，但语义和比例一致”本身就是成熟设计系统的做法。

### 5.4 IBM Carbon

Carbon 用 IBM Plex 建立强品牌字体系统，但工程方法同样值得借鉴：

- 所有 font size、weight、leading 都通过 type token 管理。
- Productive 类型用于高信息密度产品，基础字号 14px，标题固定。
- Expressive 类型用于营销和长阅读，基础字号 16px，标题可随断点流式变化。
- 代码使用独立 IBM Plex Mono 栈。

AI DCA 是高密度金融工具，更接近 Carbon Productive，而不是营销型 Expressive。可以借用其紧凑层级，但不建议为了模仿 IBM 而引入 IBM Plex：中文覆盖、额外加载和品牌语气都不匹配本项目。

Carbon 当前官方 Sass 字体栈也已经在 IBM Plex 后加入 `system-ui` / Apple system fallback；当前列出的 Plex 脚本字体没有简体或繁体中文家族。这进一步说明中文产品不能只依赖品牌拉丁字体。

### 5.5 共同结论

四套规范的共同点不是“大家都用同一个字体”，而是：

1. 字体选择服务于平台、语言和可读性。
2. 字体家族数量应少，技术代码单独使用 mono。
3. 字号、行高、字重和 tracking 应绑定为语义角色，而不是页面内随手组合。
4. 正文和数据优先可读性，极轻字重与极小字号要谨慎。
5. 字体放大后仍需保持信息层级、布局和功能。

## 6. 方案对比与决策

| 方案 | 跨平台字形一致 | 中文覆盖 | 首屏成本 | 布局回归风险 | 结论 |
| --- | --- | --- | --- | --- | --- |
| 平台系统字体栈 | 中 | 高 | 最低，零下载 | 低 | **现在采用** |
| 自托管 Noto Sans SC | 高 | 高 | 中文字体体积与缓存成本较高 | 中 | 品牌/像素一致性明确时再评估 |
| Inter + Noto Sans SC | 中高 | 高 | 两套字体、匹配和子集更复杂 | 中高 | 不建议作为第一阶段 |
| 直接依赖 SF Pro | 低 | 依赖平台 fallback | 非 Apple 平台不可控 | 高 | 不采用 |
| 保留当前强制 `!important` | 表面高 | 高 | 低 | 高，语义失效 | 必须治理 |

推荐系统栈不是“什么都不做”。它要求统一 token、继承规则、数字特性、字重、字号和测试矩阵；只是避免在第一阶段引入不必要的字体下载和中文子集工程。

## 7. 建议字体规范

### 7.1 字体角色

| 角色 | 字体 | 用途 |
| --- | --- | --- |
| UI | system sans | 标题、正文、按钮、表单、表格、图表标签 |
| Data | UI + `tabular-nums lining-nums` | 价格、金额、份额、净值、收益率、日期、证券代码 |
| Code | system monospace | 命令、源码、原始 ID、日志、OCR 原文 |

基金代码和股票 Symbol 默认归 Data，不再因为“看起来像代码”而归 Code。

### 7.2 建议字体栈

```css
:root {
  --app-font-ui:
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    Roboto,
    "Helvetica Neue",
    "PingFang SC",
    "Hiragino Sans GB",
    "Microsoft YaHei",
    "Noto Sans CJK SC",
    "Noto Sans SC",
    Arial,
    sans-serif;

  --app-font-code:
    ui-monospace,
    SFMono-Regular,
    Menlo,
    Monaco,
    Consolas,
    "Liberation Mono",
    monospace;
}
```

Tailwind v4 继续只做映射：

```css
@theme inline {
  --font-sans: var(--app-font-ui);
  --font-mono: var(--app-font-code);
}
```

### 7.3 建议紧凑型 type scale

以下是针对高密度中文金融产品的子集，不照搬任何一家公司的完整 scale：

| Token | 字号 / 行高 | 字重 | 用途 |
| --- | --- | --- | --- |
| `type-caption` | 11 / 16 | 400、500 | 非关键说明、更新时间、表头辅助信息 |
| `type-label` | 12 / 18 | 500、600 | 标签、紧凑表头、按钮辅助文字 |
| `type-data-compact` | 12 / 18 | 500、600 | 桌面行情表与紧凑数据 |
| `type-body-sm` | 13 / 20 | 400、500 | 卡片次级正文 |
| `type-body` | 14 / 22 | 400 | 常规正文、表单说明 |
| `type-title-sm` | 16 / 24 | 600 | 卡片标题、弹窗标题 |
| `type-title` | 20 / 28 | 600 | 页面标题 |
| `type-title-lg` | 24 / 32 | 700 | 重点区块标题 |
| `type-display-data` | 28–44 / 1.1 | 700 | 总资产等关键数字，可用 `clamp()` |

实现时使用 rem；表中仍写 px 等价值，便于设计评审。移动端可编辑输入框单独使用至少 16/24。

### 7.4 字重规则

第一轮只允许：

- 400：正文
- 500：数据与次级强调
- 600：标签、按钮、小标题
- 700：页面标题与关键数字

550、650、750、760、780 全部归并。800/900 暂不作为系统 token；若个别展示数字确有需要，应单独验证 macOS、Windows、Android 和中文 fallback 后再开放。

### 7.5 数字规则

```css
.type-data {
  font-family: var(--app-font-ui);
  font-variant-numeric: tabular-nums lining-nums;
}

.type-code,
code,
pre,
kbd,
samp {
  font-family: var(--app-font-code);
}
```

对金额和行情数字还需统一：

- 使用真正的 U+2212 minus 或统一格式化的负号，避免不同页面混用连字符。
- 验证 `—`、`+`、`−`、`%`、`¥`、`$` 与数字是否落到协调的 fallback。
- 实时更新时数字不左右跳动。

### 7.6 中文排版规则

- 中文标题、标签和正文默认 `letter-spacing: 0`。
- 纯拉丁大写 eyebrow 才允许 `0.08em–0.12em`；中英文混排不统一套 `uppercase tracking-*`。
- 多行中文正文行高约 1.5；紧凑单行数据约 1.35–1.5。
- 11px 只用于非关键元信息；可交互文字、主要数据和移动端文本原则上至少 12px。
- 7–9px 不承载用户必须读取或操作的信息。
- 保留 `index.html:2` 的 `lang="zh-CN"`。

## 8. 低风险迁移方案

### Phase 0：建立基线

实施状态：自动化 computed-style 基线已完成；跨操作系统人工截图矩阵待执行。

在改变字体继承前先固定：

- 行情列表、持仓表、总资产卡、详情页、表单和 Radix 弹层的截图。
- 关键元素的 computed style。
- 长中文基金名、`513100`、`QQQ`、`1.111`、`8.888`、百分号和货币符号样例。

不要在同一个改动中同时调整字体、固定列宽和列对齐。

### Phase 1：统一来源，不改变视觉

实施状态：已完成。

1. 把 `--app-font-ui`、`--app-font-code`、字号、行高、字重 token 移入 `src/styles/tokens.css`。
2. 保留 `app.css` 中的 Tailwind `@theme inline` 映射。
3. 将 `--market-font-family` alias 到 `--app-font-ui`，或删除行情局部 family 让其继承。
4. Worker SVG 使用文档化的同等 system stack 字面量；它无法读取前端 CSS 变量。
5. Mockup 统一引用同一份字体策略，避免评审截图漂移。

这一阶段不改变 Tailwind 内置 `text-xs` / `text-sm` 的全局含义，它们已有数百处使用，一次重定义会造成全站重排。

### Phase 2：先分类，再移除强制覆盖

实施状态：已完成。

1. 审核 23 处 `font-mono`：
   - 原始 ID、命令、日志、代码块保留 Code。
   - 证券代码、价格、金额改为 Data。
2. 删除 `#root *`、`.font-mono` 与 `[style*="font-family"]` 上的 sans `!important`。
3. 改为正常继承：

```css
html,
body {
  font-family: var(--app-font-ui);
}

button,
input,
select,
textarea {
  font-family: inherit;
}
```

4. Recharts / SVG 若确有第三方内联字体冲突，使用明确且局部的选择器适配，不再强制整个 `#root`。
5. 验证通过 portal 挂到 `body` 的 Radix 弹层仍继承 UI 字体。

### Phase 3：治理层级漂移

实施状态：部分完成。非标准字重与 Data / Code 高频语义已完成；字号和中文 tracking 按页面继续迁移。

建议按高频路径迁移：

1. `src/components/ui/table.jsx` 与 DataTable
2. 行情列表、行情卡片和详情
3. 持仓表、持仓详情和收益页
4. 表单、弹窗和通知页
5. 低频页面与 mockup

治理内容：

- 550/650/750/760/780 归并为标准字重。
- 中文 `tracking-[0.12em+]` 清零或替换为语义 label。
- 必须读取的 7–10px 文本提升到 token。
- 将散落的 `text-[Npx]` 逐步换成语义类；不要求一次清完 411 处。

可用 `html[data-typography="v2"]` 做短期灰度开关，便于对比和回滚。

### Phase 4：删除遗留并固化守卫

实施状态：行情死配置与静态守卫已完成；GM3 alias 暂时保留作运行期兼容。

- 删除行情 Inter / SF Pro 死配置。
- 确认后删除无消费者的 GM3 字体兼容变量。
- 构建时生成 `docs/react-assets-v2`，不手工编辑构建产物。
- 增加静态检查，禁止新的字体栈、非标准字重和全局 font `!important`。

## 9. 验收标准

### 9.1 自动化

已增加 computed-style E2E：

- body、button、input、table、Recharts SVG text、Radix portal 使用 UI token。
- `.type-code` / `code` 与 UI 字体不同。
- `.type-data` 的 `fontVariantNumeric` 包含 `tabular-nums`。
- `await document.fonts.ready` 后再做布局和截图断言。

移动端可编辑输入框 computed `font-size >= 16px` 将随具体输入组件迁移补充，当前不使用高风险的全局字号覆盖。

已增加静态守卫：

- UI 字体栈只允许在 token 文件定义一次。
- 禁止重新出现行情局部 Inter / SF Pro 栈。
- 禁止 `#root * { font-family: ... !important }`。
- 禁止新增 550/650/750/760/780。
- 关键行情数字必须使用 Data/tabular 语义。

### 9.2 视觉矩阵

至少覆盖：

- macOS Safari：SF + PingFang SC
- Windows Edge/Chrome：Segoe UI + Microsoft YaHei
- Android Chrome 与 Capacitor WebView
- 1440×900 桌面与 390×844 手机
- 浏览器 200% 缩放与系统大字体

重点页面：行情列表/详情、持仓列表/详情、收益总览、输入弹窗、Recharts tooltip。

Linux CI 截图只能证明 Linux 字体结果，不能替代 macOS、Windows 和 Android 验收。

### 9.3 布局专项

字体变更后必须确认：

- 长中文基金名的省略与换行没有改变关键操作区。
- 固定列宽表格无新增横向溢出。
- `1.111` 与 `8.888` 的数据列宽一致，实时刷新不跳动。
- 货币符号、正负号、百分号和破折号没有异常 fallback。
- 200% 放大时没有文字遮挡、截断导致的信息或功能丢失。

## 10. 建议实施顺序与工作量

| 优先级 | 工作 | 预期风险 |
| --- | --- | --- |
| P0 | token 搬迁、行情 family alias、建立 computed-style 基线 | 低 |
| P0 | 分类 `font-mono`，移除 `#root * !important` | 中，需视觉回归 |
| P1 | Data token、标准字重、中文 tracking 治理 | 中，可分页面迁移 |
| P1 | 7–10px 可读性与移动输入框治理 | 中，可能影响布局密度 |
| P2 | Mockup、Worker SVG、GM3 遗留清理 | 低 |
| 独立项目 | 自托管 Noto Sans SC / 品牌字体 | 高，需性能与字体子集评估 |

## 11. 官方参考资料

以下资料均于 2026-07-15 核对：

1. [Apple Human Interface Guidelines — Typography](https://developer.apple.com/design/human-interface-guidelines/typography)
2. [Apple Developer — Fonts for Apple platforms](https://developer.apple.com/fonts/)
3. [WebKit — Using the System Font in Web Content](https://webkit.org/blog/3709/using-the-system-font-in-web-content/)
4. [Material Design 3 — Typography overview](https://m3.material.io/styles/typography/overview)
5. [Material Design 3 — Fonts](https://m3.material.io/styles/typography/fonts)
6. [Material Design 3 — Type scale and tokens](https://m3.material.io/styles/typography/type-scale-tokens)
7. [Material Design 3 — Applying type](https://m3.material.io/styles/typography/applying-type)
8. [Material Web — Official baseline type-scale tokens](https://github.com/material-components/material-web/blob/main/tokens/versions/v0_192/_md-sys-typescale.scss)
9. [Microsoft Fluent 2 — Typography](https://fluent2.microsoft.design/typography)
10. [IBM Carbon — Typography overview](https://carbondesignsystem.com/elements/typography/overview/)
11. [IBM Carbon — Type sets](https://carbondesignsystem.com/elements/typography/type-sets/)
12. [IBM Carbon source — Font family stack](https://github.com/carbon-design-system/carbon/blob/main/packages/type/scss/_font-family.scss)
13. [IBM Carbon source — Type style tokens](https://github.com/carbon-design-system/carbon/blob/main/packages/type/scss/_styles.scss)
14. [W3C WCAG 2.2 — Understanding 1.4.4 Resize Text](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html)

## 12. 后续范围

当前实现统一的是字体来源、语义与继承规则，不承诺 macOS、Windows、Android 使用完全相同的字形。后续工作包括：

- 分页面治理 7–10px 文本、移动输入框和中文 tracking，不与本轮字体继承改动叠加重排。
- 在 macOS Safari、Windows Edge、Android WebView 完成人工视觉矩阵；Linux CI 结果不能替代真实平台。
- 确认没有运行期 Web Component 消费后，再删除 GM3 字体兼容变量。
- 仅在品牌或逐像素一致性成为明确需求时，独立评估自托管 Noto Sans SC 与字体子集策略。
