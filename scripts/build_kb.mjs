#!/usr/bin/env node
/**
 * 构建网站知识库。
 *
 * 1. 扫描设定的 markdown / 文本文件
 * 2. 切片（默认 800 字 / 100 字 重叠）
 * 3. 调用 Cloudflare Workers AI embedding 接口生成向量
 * 4. upsert 到 Cloudflare Vectorize 索引 (默认 ai-dca-kb)
 *
 * 需要环境变量：
 *   CLOUDFLARE_API_TOKEN  需含 Workers AI Read + Vectorize Edit 权限
 *   CLOUDFLARE_ACCOUNT_ID
 *   KB_INDEX_NAME         可选，默认 ai-dca-kb
 *   EMBED_MODEL           可选，默认 @cf/baai/bge-m3
 *   KB_DIMENSIONS         可选，默认 1024
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

if (!ACCOUNT_ID || !API_TOKEN) {
  console.error('❌ 缺少环境变量 CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN');
  process.exit(1);
}

// 要纳入知识库的文件。路径相对于仓库根。
// 补充新文档只需在这里添加一行。
const SOURCES = [
  'README.md',
  'demand.md',
  'AGENTS.MD',
  'workers/README.md',
  'docs/architecture/realtime-channel.md',
  'docs/home-redesign.md',
  'docs/ops/notify-worker-deploy.md',
  'docs/qdii-nav-rules.md',
];

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
  for (const rel of SOURCES) {
    const abs = path.join(ROOT, rel);
    let raw;
    try {
      raw = await fs.readFile(abs, 'utf8');
    } catch (err) {
      console.warn(`  跳过（读不到）：${rel}`);
      continue;
    }
    const title = extractTitle(rel, raw);
    const chunks = chunkText(raw);
    chunks.forEach((c, i) => {
      allChunks.push({
        id: sanitizeId(rel, i),
        text: c,
        metadata: {
          source: rel,
          title,
          chunkIndex: i,
          // Vectorize metadata 单条最大 10KB，戉10KB 以保证
          text: c.length > 9000 ? c.slice(0, 9000) : c,
        },
      });
    });
    console.log(`  收入：${rel}  (${raw.length} 字 → ${chunks.length} 片)`);
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
