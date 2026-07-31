export async function currentSyncCursor(env, userId) {
  const row = await env.DB.prepare('SELECT MAX(change_id) AS cursor FROM sync_changes_v2 WHERE user_id = ?')
    .bind(String(userId || '')).first();
  return Math.max(0, Number(row?.cursor) || 0);
}

export async function listSyncChanges(env, userId, { since = 0, limit = 100 } = {}) {
  const normalizedSince = Math.max(0, Number.isSafeInteger(Number(since)) ? Number(since) : 0);
  const normalizedLimit = Math.min(Math.max(Number(limit) || 100, 1), 100);
  const result = await env.DB.prepare(`SELECT change_id AS changeId, sync_key AS syncKey,
    revision, operation, content_hash AS contentHash, changed_at AS changedAt
    FROM sync_changes_v2 WHERE user_id = ? AND change_id > ?
    ORDER BY change_id ASC LIMIT ?`).bind(String(userId || ''), normalizedSince, normalizedLimit).all();
  const changes = (result?.results || []).map((row) => ({
    changeId: Number(row.changeId) || 0,
    syncKey: String(row.syncKey || ''),
    revision: Number(row.revision) || 0,
    operation: String(row.operation || 'upsert'),
    contentHash: String(row.contentHash || ''),
    changedAt: String(row.changedAt || '')
  }));
  return {
    cursor: changes.length ? changes[changes.length - 1].changeId : normalizedSince,
    hasMore: changes.length >= normalizedLimit,
    changes
  };
}
