import { deleteSyncState, readSyncState, writeSyncState } from './syncStorage.js';

export const SYNC_V2_OUTBOX_KEY = 'aiDcaCloudSyncV2Outbox';

function accountKey(session) {
  return `${SYNC_V2_OUTBOX_KEY}:${String(session?.userId || session?.username || 'anonymous')}`;
}

function normalizeOutbox(entries) {
  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry && entry.mutationId && entry.syncKey)
    .map((entry) => ({
      mutationId: String(entry.mutationId),
      syncKey: String(entry.syncKey),
      baseRevision: Math.max(0, Number(entry.baseRevision) || 0),
      contentHash: String(entry.contentHash || ''),
      encryptedPayload: entry.encryptedPayload || null,
      operation: entry.operation === 'delete' ? 'delete' : 'upsert',
      createdAt: String(entry.createdAt || new Date().toISOString()),
      retryCount: Math.max(0, Number(entry.retryCount) || 0),
      status: String(entry.status || 'pending')
    }));
}

export async function loadOutbox(session) {
  return normalizeOutbox(await readSyncState(accountKey(session)));
}

export async function saveOutbox(session, entries) {
  const normalized = normalizeOutbox(entries);
  if (!normalized.length) {
    await deleteSyncState(accountKey(session));
    return [];
  }
  await writeSyncState(accountKey(session), normalized);
  return normalized;
}

export async function upsertOutboxEntry(session, entry) {
  const current = await loadOutbox(session);
  const next = current.filter((item) => item.syncKey !== entry.syncKey);
  next.push(entry);
  return saveOutbox(session, next);
}

export async function removeOutboxEntry(session, mutationId) {
  const current = await loadOutbox(session);
  return saveOutbox(session, current.filter((entry) => entry.mutationId !== String(mutationId || '')));
}

export const __internals = { accountKey, normalizeOutbox };
