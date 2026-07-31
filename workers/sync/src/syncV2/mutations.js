import { MAX_SYNC_MUTATION_ID_LENGTH } from './schema.js';

export function normalizeMutationId(value = '') {
  const mutationId = String(value || '').trim();
  if (!mutationId || mutationId.length > MAX_SYNC_MUTATION_ID_LENGTH) return '';
  return /^[A-Za-z0-9:_-]+$/.test(mutationId) ? mutationId : '';
}

export async function findSyncMutation(env, userId, mutationId) {
  const normalized = normalizeMutationId(mutationId);
  if (!normalized) return null;
  const row = await env.DB.prepare(`SELECT result_json AS resultJson
    FROM sync_mutations_v2 WHERE user_id = ? AND mutation_id = ?`)
    .bind(String(userId || ''), normalized).first();
  if (!row?.resultJson) return null;
  try {
    return JSON.parse(String(row.resultJson));
  } catch {
    return null;
  }
}

export async function saveSyncMutation(env, userId, mutationId, result) {
  const normalized = normalizeMutationId(mutationId);
  if (!normalized) return;
  await env.DB.prepare(`INSERT OR IGNORE INTO sync_mutations_v2
    (user_id, mutation_id, result_json, created_at) VALUES (?, ?, ?, ?)`)
    .bind(String(userId || ''), normalized, JSON.stringify(result || {}), new Date().toISOString()).run();
}

export async function pruneSyncMutations(env, { olderThanIso, limit = 1000 } = {}) {
  const cutoff = String(olderThanIso || new Date(Date.now() - 30 * 86400000).toISOString());
  const result = await env.DB.prepare(`DELETE FROM sync_mutations_v2 WHERE rowid IN (
    SELECT rowid FROM sync_mutations_v2 WHERE created_at < ? ORDER BY created_at ASC LIMIT ?
  )`).bind(cutoff, Math.max(1, Math.min(Number(limit) || 1000, 10000))).run();
  return Number(result?.meta?.changes) || 0;
}
