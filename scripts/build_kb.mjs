#!/usr/bin/env node
/**
 * 构建网站知识库（仅 Notion 数据源）。
 *
 * 1. 从 Notion 根页面递归拉取子页（child_page）
 * 2. 切片（默认 800 字 / 100 字 重叠）
 * 3. 调用 Cloudflare Workers AI embedding 接口生成向量
 * 4. upsert 到 Cloudflare Vectorize 索引 (默认 ai-dca-kb)
 *
 * 必需环境变量：
 *   CLOUDFLARE_API_TOKEN  需含 Workers AI Read + Vectorize Edit 权限
 *   CLOUDFLARE_ACCOUNT_ID
 *   NOTION_API_KEY            Notion internal integration token
 *   NOTION_KB_ROOT_PAGE_ID    KB 根页面 ID（必须把该页 share 给上面的 integration）
 *
 * 可选环境变量：
 *   KB_INDEX_NAME         可选，默认 ai-dca-kb
 *   EMBED_MODEL           可选，默认 @cf/baai/bge-m3
 *   KB_DIMENSIONS         可选，默认 1024
 *   NOTION_VERSION            可选，默认 2022-06-28
 *   NOTION_MAX_DEPTH          可选，默认 2（根页面 -> 子页 -> 孙页）
 *
 * 首次运行会自动创建索引（如果不存在）。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const INDEX_NAME = process.env.KB_INDEX_NAME || 'ai-dca-kb';
const EMBED_MODEL = process.env.EMBED_MODEL || '@cf/baai/bge-m3';
const DIMENSIONS = Number(process.env.KB_DIMENSIONS) || 1024;
const CHUNK_SIZE = Number(process.env.KB_CHUNK_SIZE) || 800;
const CHUNK_OVERLAP = Number(process.env.KB_CHUNK_OVERLAP) || 100;

const NOTION_API_KEY = process.env.NOTION_API_KEY || '';
const NOTION_KB_ROOT_PAGE_ID = process.env.NOTION_KB_ROOT_PAGE_ID || '';
const NOTION_VERSION = process.env.NOTION_VERSION || '2022-06-28';
const NOTION_MAX_DEPTH = Number(process.env.NOTION_MAX_DEPTH) || 2;

if (!ACCOUNT_ID || !API_TOKEN) {
  console.error('❌ 缺少环境变量 CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN');
  process.exit(1);
}

if (!NOTION_API_KEY || !NOTION_KB_ROOT_PAGE_ID) {
  console.error('❌ 缺少环境变量 NOTION_API_KEY / NOTION_KB_ROOT_PAGE_ID');
  process.exit(1);
}

// === Notion KB 数据源（可选） ===
// 用户在 Notion 里建一个父页面，把所有 KB 子页放在它下面。
// 配上 NOTION_API_KEY + NOTION_KB_ROOT_PAGE_ID 后，本脚本会递归拉取 child_page，
// 转为 markdown 后纳入 KB。文档结构尽量扁平，深度默认 2 层。
const NOTION_API = 'https://api.notion.com/v1';

async function notionFetch(pathname) {
  const res = await fetch(`${NOTION_API}${pathname}`, {
    headers: {
      Authorization: `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': NOTION_VERSION,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Notion API ${pathname} 失败 (${res.status}): ${text}`);
  }
  return res.json();
}

async function listAllChildren(blockId) {
  const all = [];
  let cursor;
  do {
    const params = new URLSearchParams({ page_size: '100' });
    if (cursor) params.set('start_cursor', cursor);
    const data = await notionFetch(`/blocks/${blockId}/children?${params.toString()}`);
    all.push(...(data.results || []));
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return all;
}

function richTextToString(rich) {
  if (!Array.isArray(rich)) return '';
  return rich.map((t) => t.plain_text || '').join('');
}

async function blocksToMarkdown(blocks, depth = 0) {
  const lines = [];
  const indent = '  '.repeat(depth);
  for (const block of blocks) {
    let line = '';
    switch (block.type) {
      case 'paragraph':
        line = indent + richTextToString(block.paragraph?.rich_text);
        break;
      case 'heading_1':
        line = `${indent}# ${richTextToString(block.heading_1?.rich_text)}`;
        break;
      case 'heading_2':
        line = `${indent}## ${richTextToString(block.heading_2?.rich_text)}`;
        break;
      case 'heading_3':
        line = `${indent}### ${richTextToString(block.heading_3?.rich_text)}`;
        break;
      case 'bulleted_list_item':
        line = `${indent}- ${richTextToString(block.bulleted_list_item?.rich_text)}`;
        break;
      case 'numbered_list_item':
        line = `${indent}1. ${richTextToString(block.numbered_list_item?.rich_text)}`;
        break;
      case 'to_do': {
        const checked = block.to_do?.checked ? 'x' : ' ';
        line = `${indent}- [${checked}] ${richTextToString(block.to_do?.rich_text)}`;
        break;
      }
      case 'toggle':
        line = `${indent}- ${richTextToString(block.toggle?.rich_text)}`;
        break;
      case 'quote':
        line = `${indent}> ${richTextToString(block.quote?.rich_text)}`;
        break;
      case 'code': {
        const lang = block.code?.language || '';
        const code = richTextToString(block.code?.rich_text);
        line = `${indent}\`\`\`${lang}\n${code}\n${indent}\`\`\``;
        break;
      }
      case 'divider':
        line = `${indent}---`;
        break;
      case 'callout': {
        const emoji = block.callout?.icon?.emoji || '💡';
        line = `${indent}> ${emoji} ${richTextToString(block.callout?.rich_text)}`;
        break;
      }
      case 'child_page':
        // 子页另外独立抽取，这里不重复包含
        continue;
      default: {
        const rt = block[block.type]?.rich_text;
        if (Array.isArray(rt)) line = indent + richTextToString(rt);
      }
    }
    if (line) lines.push(line);
    if (block.has_children && block.type !== 'child_page') {
      const children = await listAllChildren(block.id);
      const sub = await blocksToMarkdown(children, depth + 1);
      if (sub) lines.push(sub);
    }
  }
  return lines.join('\n');
}

async function getPageTitle(pageId) {
  try {
    const data = await notionFetch(`/pages/${pageId}`);
    const props = data.properties || {};
    for (const val of Object.values(props)) {
      if (val?.type === 'title') return richTextToString(val.title);
    }
  } catch (err) {
    console.warn(`  警告：取 page title 失败 ${pageId}: ${err.message}`);
  }
  return pageId;
}

async function collectNotionPages(rootPageId, maxDepth, depth = 0, acc = []) {
  if (depth >= maxDepth) return acc;
  const blocks = await listAllChildren(rootPageId);
  for (const b of blocks) {
    if (b.type === 'child_page') {
      acc.push({ id: b.id, title: b.child_page?.title || b.id });
      await collectNotionPages(b.id, maxDepth, depth + 1, acc);
    }
  }
  return acc;
}

async function buildNotionDocs() {
  console.log(`→ Notion KB 根页面：${NOTION_KB_ROOT_PAGE_ID} (max depth ${NOTION_MAX_DEPTH})`);
  const pages = await collectNotionPages(NOTION_KB_ROOT_PAGE_ID, NOTION_MAX_DEPTH);
  console.log(`  发现 ${pages.length} 个 Notion 子页`);
  const out = [];
  for (const p of pages) {
    try {
      const blocks = await listAllChildren(p.id);
      const body = await blocksToMarkdown(blocks);
      const title = (p.title && p.title.trim()) || (await getPageTitle(p.id));
      const text = `# ${title}\n\n${body}`.trim();
      if (!text || text.length < 10) {
        console.warn(`  跳过（内容过短）：notion/${title}`);
        continue;
      }
      const idSafe = p.id.replace(/-/g, '');
      out.push({
        label: `notion/${idSafe}`,
        title,
        text,
      });
      console.log(`  收入：notion/${title.slice(0, 40)}  (${text.length} 字)`);
    } catch (err) {
      console.warn(`  跳过 Notion 页 ${p.id}: ${err.message}`);
    }
  }
  return out;
}

const CF_BASE = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}`;

async function cfFetch(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      ...(init.headers || {}),
    },
  });
  return res;
}

async function ensureIndex() {
  const res = await cfFetch(`${CF_BASE}/vectorize/v2/indexes/${INDEX_NAME}`);
  if (res.status === 200) {
    console.log(`✓ Vectorize 索引已存在：${INDEX_NAME}`);
    return;
  }
  if (res.status !== 404) {
    const text = await res.text();
    throw new Error(`检查索引失败 (${res.status}): ${text}`);
  }
  console.log(`… 索引不存在，创建 ${INDEX_NAME} (dim=${DIMENSIONS}, metric=cosine)`);
  const createRes = await cfFetch(`${CF_BASE}/vectorize/v2/indexes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: INDEX_NAME,
      description: 'ai-dca 网站知识库（文档 + 界面说明）',
      config: { dimensions: DIMENSIONS, metric: 'cosine' },
    }),
  });
  if (!createRes.ok) {
    const text = await createRes.text();
    throw new Error(`创建索引失败 (${createRes.status}): ${text}`);
  }
  console.log(`✓ 创建索引 ${INDEX_NAME} 完成`);
}

function sanitizeId(rel, idx) {
  return `${rel.replace(/[^a-zA-Z0-9]/g, '_')}__${idx}`;
}

function extractTitle(rel, raw) {
  const m = raw.match(/^#\s+(.+)$/m);
  if (m) return m[1].trim().slice(0, 200);
  return rel;
}

function chunkText(text, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  if (!text) return [];
  if (text.length <= size) return [text];
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    const end = Math.min(i + size, text.length);
    chunks.push(text.slice(i, end));
    if (end >= text.length) break;
    i = end - overlap;
    if (i < 0) i = 0;
  }
  return chunks;
}

async function embedBatch(texts) {
  const url = `${CF_BASE}/ai/run/${EMBED_MODEL}`;
  const res = await cfFetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: texts }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`embedding 失败 (${res.status}): ${text}`);
  }
  const data = await res.json();
  // Workers AI REST: { result: { shape, data: [[...]] }, success, errors, messages }
  const out =
    (data?.result?.data && Array.isArray(data.result.data) && data.result.data) ||
    (Array.isArray(data?.data) && data.data) ||
    [];
  if (out.length !== texts.length) {
    throw new Error(`embedding 返回数量不匹配：expected ${texts.length}, got ${out.length}`);
  }
  return out;
}

async function upsertVectors(vectors) {
  if (vectors.length === 0) return;
  const ndjson = vectors.map((v) => JSON.stringify(v)).join('\n');
  const url = `${CF_BASE}/vectorize/v2/indexes/${INDEX_NAME}/upsert`;
  const res = await cfFetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-ndjson' },
    body: ndjson,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`upsert 失败 (${res.status}): ${text}`);
  }
}

async function main() {
  console.log(`→ 仓库根：${ROOT}`);
  console.log(`→ Vectorize 索引：${INDEX_NAME} (dim=${DIMENSIONS})`);
  console.log(`→ Embedding 模型：${EMBED_MODEL}`);
  console.log(`→ 切片：${CHUNK_SIZE} / overlap ${CHUNK_OVERLAP}`);

  await ensureIndex();

  const allChunks = [];
  const notionDocs = await buildNotionDocs();
  for (const doc of notionDocs) {
    const chunks = chunkText(doc.text);
    chunks.forEach((c, i) => {
      allChunks.push({
        id: sanitizeId(doc.label, i),
        text: c,
        metadata: {
          source: `notion/${doc.title}`,
          title: doc.title,
          chunkIndex: i,
          text: c.length > 9000 ? c.slice(0, 9000) : c,
        },
      });
    });
    console.log(`  切片：notion/${doc.title}  (${doc.text.length} 字 → ${chunks.length} 片)`);
  }

  if (allChunks.length === 0) {
    console.error('❌ 没有可读文件，中止。');
    process.exit(1);
  }

  console.log(`\n→ 生成 embeddings：共 ${allChunks.length} 片`);
  const BATCH = 20;
  const vectors = [];
  for (let i = 0; i < allChunks.length; i += BATCH) {
    const batch = allChunks.slice(i, i + BATCH);
    const embeds = await embedBatch(batch.map((c) => c.text));
    batch.forEach((c, j) => {
      const values = embeds[j];
      if (!Array.isArray(values) || values.length !== DIMENSIONS) {
        throw new Error(
          `embedding 维度不匹配（期待 ${DIMENSIONS}，得到 ${values?.length}），请检查 EMBED_MODEL / KB_DIMENSIONS`,
        );
      }
      vectors.push({ id: c.id, values, metadata: c.metadata });
    });
    console.log(`  embedded ${Math.min(i + BATCH, allChunks.length)}/${allChunks.length}`);
  }

  console.log(`\n→ upsert 到 Vectorize：共 ${vectors.length} 条`);
  const UP_BATCH = 100;
  for (let i = 0; i < vectors.length; i += UP_BATCH) {
    await upsertVectors(vectors.slice(i, i + UP_BATCH));
    console.log(`  upserted ${Math.min(i + UP_BATCH, vectors.length)}/${vectors.length}`);
  }

  console.log('\n✓ 知识库构建完成。');
}

main().catch((err) => {
  console.error('\n❌ 构建失败：', err && err.message ? err.message : err);
  process.exit(1);
});
