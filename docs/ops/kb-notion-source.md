# 知识库 · Notion 数据源接入

KB 现在除了仓库内 markdown + ai-dca-andriod 仓库 markdown，还会同步一个 Notion 父页下的所有子页，作为可由产品/运营**直接在 Notion 编辑**的知识源。

## 数据流

```
Notion 页面树  ──┐
                  ├──► scripts/build_kb.mjs ──► Cloudflare Vectorize (ai-dca-kb)
仓库 docs/**.md ─┤                                ▲
ai-dca-andriod ─┘                                │
                                                  │
                Worker (ocr-proxy) ───────────────┘
                       /api/ai-chat 检索回答
```

构建脚本：`scripts/build_kb.mjs`
触发：`.github/workflows/build-knowledge-base.yml`
- 关键 markdown / 脚本 push 到 main 时即触发
- 每天 UTC 18:00（= Asia/Shanghai 02:00）定时跑一次，专门给 Notion 拉新内容
- 也支持 `workflow_dispatch` 手动触发

## 一次性配置（只做一次）

### 1. 创建 Notion Internal Integration

1. 打开 https://www.notion.so/profile/integrations
2. 「+ New integration」→ 类型选 **Internal**
3. Workspace 选当前工作区；名字随意，如 `ai-dca-kb-sync`
4. Capabilities：勾选 **Read content**（其它都不需要）
5. 创建后复制 Internal Integration Secret（`secret_xxx...`）

### 2. 在 Notion 里搭知识库父页

1. 在工作区任何位置新建一页，作为 KB 根页（例如「ai-dca 知识库」）
2. 把所有要进 KB 的内容做成它的**子页**（子页内可再嵌一层孙页，最多读到第 2 层）
3. 在该根页右上角「⋯」→「Connections」→ 添加上一步创建的 integration
   - 注意要 share 给 integration，否则 API 读不到
4. 复制根页 URL 末尾的 32 位 ID（带不带短横线都行，例如 `https://www.notion.so/xxx-1234abcd...` 中最后那一段）

### 3. 在 GitHub 仓库加两个 Secret

Settings → Secrets and variables → Actions → New repository secret：

| Name | Value |
| --- | --- |
| `NOTION_API_KEY` | 第 1 步复制的 Internal Integration Secret |
| `NOTION_KB_ROOT_PAGE_ID` | 第 2 步复制的根页 ID |

### 4. 验证

手动跑一次 workflow：Actions → 「Build AI knowledge base」→ Run workflow → main。
看 step 「Build knowledge base」日志里应有：

```
→ Notion KB 根页面：xxx (max depth 2)
  发现 N 个 Notion 子页
  收入：notion/<标题>  (X 字)
```

## 日常使用

- 直接在 Notion 增删改子页内容即可
- 改动要么等当晚 02:00 自动同步，要么手动跑一次 `workflow_dispatch`
- 想看哪些页被收入：跑完看 workflow summary 或 build 日志

## 已知限制

- 只读纯文本类 block：段落/标题/列表/待办/引用/代码块/divider/callout/toggle。表格、嵌入、数据库 view 暂不抽取，需要时再扩展 `blocksToMarkdown`。
- 默认递归 2 层（根 → 子 → 孙）。需要更深可设 `NOTION_MAX_DEPTH` 环境变量。
- 子页 / 孙页里若再有 `child_page` 块只是挂为单独页面单独抽取，不会嵌套合并。
- 这条管道是**追加**到现有数据源里，原仓库 markdown 仍在 KB 中。如果哪天想完全切到 Notion，删掉 `scripts/build_kb.mjs` 顶部的 `SOURCES` 数组里的项即可。
