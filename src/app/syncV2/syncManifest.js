import { readSyncState, writeSyncState } from './syncStorage.js';

export const SYNC_V2_MANIFEST_KEY = 'aiDcaCloudSyncV2Manifest';

function accountKey(session) {
  return `${SYNC_V2_MANIFEST_KEY}:${String(session?.userId || session?.username || 'anonymous')}`;
}

export function normalizeManifest(value = {}) {
  const documents = value?.documents && typeof value.documents === 'object' ? value.documents : {};
  return {
    cursor: Math.max(0, Number(value?.cursor) || 0),
    documents: Object.entries(documents).reduce((out, [key, doc]) => {
      if (!key || !doc || typeof doc !== 'object') return out;
      out[key] = {
        revision: Math.max(0, Number(doc.revision) || 0),
        contentHash: String(doc.contentHash || ''),
        updatedAt: String(doc.updatedAt || ''),
        deleted: Boolean(doc.deleted)
      };
      return out;
    }, {})
  };
}

export async function loadManifest(session) {
  return normalizeManifest(await readSyncState(accountKey(session)));
}

export async function saveManifest(session, manifest) {
  return writeSyncState(accountKey(session), normalizeManifest(manifest));
}

export function setManifestDocument(manifest, syncKey, document = {}) {
  const next = normalizeManifest(manifest);
  next.documents[syncKey] = {
    revision: Math.max(0, Number(document.revision) || 0),
    contentHash: String(document.contentHash || ''),
    updatedAt: String(document.updatedAt || ''),
    deleted: Boolean(document.deleted)
  };
  return next;
}

export const __internals = { accountKey };
