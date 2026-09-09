// 兼容门面：对外保持原有 cloudSync 导出。
// 普通资源走 resourceSync；持仓交易改为 holdings/ledger 下的真实交易行同步。
// 不再整包加密上传，旧参数保留仅为兼容现有 UI。

import { buildBackupEnvelope } from './webdavBackup.js';
import { loadCloudSession } from './authSession.js';
import {
  compareRecordVersions,
  createLocalDataSnapshot,
  mergeBackupEnvelopes,
  mergePayloadValue,
  mergePayloadValueRemoteWins,
  mergeRemoteAuthoritative,
  summarizeBackupConflict
} from './syncMerge.js';
import { fetchAccountEnvelopeExport, fetchAccountManifest, fetchLegacyMigrationStatus } from './accountApi.js';
import {
  getAccountSyncSummary,
  markAllResourcesDirty,
  pullResources,
  pushAllResources,
  scheduleAccountPull,
  scheduleAccountPush,
  startAccountAutoSync,
  syncAllResources
} from './resourceSync.js';
import {
  markHoldingTransactionsDirty,
  pullHoldingTransactions,
  pushHoldingTransactions,
  startHoldingTransactionAutoSync,
  syncHoldingTransactions
} from './holdingTransactionsSync.js';
import { ensureLegacyMigration } from './legacyMigration.js';

export {
  compareRecordVersions,
  createLocalDataSnapshot,
  mergeBackupEnvelopes,
  mergePayloadValue,
  mergePayloadValueRemoteWins,
  mergeRemoteAuthoritative,
  summarizeBackupConflict
};
export { getAccountSyncSummary };

export const CLOUD_SYNC_META_KEY = 'aiDcaCloudSyncMeta';
export const CLOUD_SYNC_META_EVENT = 'cloud-sync:meta-changed';

let cloudAutoSyncStarted = false;

function storage() {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  return window.localStorage;
}

function nowIso() {
  return new Date().toISOString();
}

export function loadCloudSyncMeta() {
  const ls = storage();
  if (!ls) return null;
  try {
    const parsed = JSON.parse(ls.getItem(CLOUD_SYNC_META_KEY) || 'null');
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function saveCloudSyncMeta(meta = {}) {
  const ls = storage();
  if (!ls) return meta;
  const payload = { ...meta, savedAt: nowIso() };
  ls.setItem(CLOUD_SYNC_META_KEY, JSON.stringify(payload));
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(CLOUD_SYNC_META_EVENT, { detail: payload }));
  }
  return payload;
}

export function ensureLocalChangeBaseline() {
  const snapshot = createLocalDataSnapshot();
  const meta = loadCloudSyncMeta() || {};
  const changed = meta.localSignature !== snapshot.signature;
  if (changed) {
    saveCloudSyncMeta({ ...meta, localSignature: snapshot.signature, localKeyCount: snapshot.keyCount, localUpdatedAt: nowIso() });
  }
  return { changed, snapshot, meta };
}

function mergeSummaryIntoMeta(extra = {}) {
  const summary = getAccountSyncSummary();
  const snapshot = createLocalDataSnapshot();
  return saveCloudSyncMeta({
    ...(loadCloudSyncMeta() || {}),
    resourceCount: summary.resourceCount,
    remoteUpdatedAt: summary.remoteUpdatedAt,
    lastPullAt: summary.lastPullAt,
    lastPushAt: summary.lastPushAt,
    localSignature: snapshot.signature,
    localKeyCount: snapshot.keyCount,
    keyCount: snapshot.keyCount,
    encryption: 'none',
    ...extra
  });
}

export async function uploadEncryptedCloudBackup({ force = false } = {}) {
  const session = loadCloudSession();
  if (!session?.accessToken) throw new Error('请先登录账户');
  if (force) {
    markAllResourcesDirty();
    markHoldingTransactionsDirty();
  }
  const [resourceResult, transactionResult] = await Promise.all([
    pushAllResources({ force, session }),
    pushHoldingTransactions({ force, session })
  ]);
  const meta = mergeSummaryIntoMeta({ direction: 'upload', uploadedAt: nowIso() });
  const pushedCount = (resourceResult.pushed?.length || 0) + (transactionResult.pushed?.length || 0);
  return { skipped: pushedCount === 0, reason: pushedCount === 0 ? 'unchanged' : '', pushedCount, transactionPushedCount: transactionResult.pushed?.length || 0, failed: [...(resourceResult.failed || []), ...(transactionResult.failed || [])], updatedAt: meta.lastPushAt || nowIso(), keyCount: meta.keyCount || 0 };
}

export async function restoreEncryptedCloudBackup({ onlyIfRemoteNewer = false } = {}) {
  const session = loadCloudSession();
  if (!session?.accessToken) throw new Error('请先登录账户');
  const [resourceResult, transactionResult] = await Promise.all([
    pullResources({ force: !onlyIfRemoteNewer, session }),
    pullHoldingTransactions({ force: !onlyIfRemoteNewer, session })
  ]);
  mergeSummaryIntoMeta({ direction: 'restore', appliedAt: nowIso() });
  return { restoredKeyCount: (resourceResult.applied?.length || 0) + (transactionResult.remoteCount || 0), appliedResources: [...(resourceResult.applied || []), 'holdings/ledger'], updatedAt: nowIso() };
}

export async function mergeLocalIntoCloudBackup() {
  const session = loadCloudSession();
  if (!session?.accessToken) throw new Error('请先登录账户');
  markAllResourcesDirty();
  markHoldingTransactionsDirty();
  const [resourceResult, transactionResult] = await Promise.all([
    syncAllResources({ direction: 'both', session }),
    syncHoldingTransactions({ direction: 'both', session })
  ]);
  mergeSummaryIntoMeta({ direction: 'merge', uploadedAt: nowIso() });
  return { restoredKeyCount: (resourceResult.pulled?.applied?.length || 0) + (transactionResult.pulled?.remoteCount || 0), pushedCount: (resourceResult.pushed?.pushed?.length || 0) + (transactionResult.pushed?.pushed?.length || 0), updatedAt: nowIso() };
}

export async function overwriteCloudWithLocal() {
  markAllResourcesDirty();
  markHoldingTransactionsDirty();
  return uploadEncryptedCloudBackup({ force: true });
}

export async function pullRemoteAuthoritativeMerge() {
  return restoreEncryptedCloudBackup({ onlyIfRemoteNewer: false });
}

export async function refreshRemoteCloudMeta() {
  const session = loadCloudSession();
  if (!session?.accessToken) return null;
  // 先查迁移状态；迁移未完成时禁止读取新资源，也不回退到旧整包接口。
  const migration = await fetchLegacyMigrationStatus(session);
  if (migration?.needsMigration) {
    const meta = mergeSummaryIntoMeta({ remoteResourceCount: 0, remoteUpdatedAt: '', migrationStatus: migration?.status || 'pending', needsMigration: true });
    return { ...meta, version: 0, keyCount: 0, needsMigration: true };
  }
  const manifest = await fetchAccountManifest(session);
  const resources = Array.isArray(manifest?.resources) ? manifest.resources : [];
  const populated = resources.filter((item) => item.revision > 0 && !item.deleted);
  const updatedAt = populated.map((item) => String(item.updatedAt || '')).filter(Boolean).sort().pop() || '';
  const meta = mergeSummaryIntoMeta({ remoteResourceCount: populated.length, remoteUpdatedAt: updatedAt, migrationStatus: manifest?.migration?.status || migration?.status || '', needsMigration: false });
  return { ...meta, version: populated.length > 0 ? 1 : 0, keyCount: populated.length, needsMigration: false };
}

export async function prepareCloudSyncConflict() {
  const session = loadCloudSession();
  if (!session?.accessToken) throw new Error('请先登录账户');
  const remoteEnvelope = await fetchAccountEnvelopeExport(session);
  const localEnvelope = buildBackupEnvelope();
  const localMeta = loadCloudSyncMeta();
  const summary = summarizeBackupConflict({ localEnvelope, remoteEnvelope, remote: { version: null, updatedAt: remoteEnvelope?.exportedAt || '' }, localMeta });
  return { summary, remoteEnvelope, localEnvelope, remote: { updatedAt: remoteEnvelope?.exportedAt || '' } };
}

export function scheduleCloudAutoUpload({ changed = true } = {}) {
  if (!changed) return false;
  return scheduleAccountPush();
}

export function scheduleCloudAutoPull(options = {}) {
  return scheduleAccountPull(options);
}

export function startCloudAutoSync() {
  if (cloudAutoSyncStarted) return false;
  if (!loadCloudSession()?.accessToken) return false;
  cloudAutoSyncStarted = true;
  // 登录后必须先完成迁移状态检查；只有迁移已完成，才安装普通资源和交易行同步器。
  Promise.resolve()
    .then(() => ensureLegacyMigration())
    .then((migration) => {
      if (migration?.status === 'action-required') {
        cloudAutoSyncStarted = false;
        return false;
      }
      startAccountAutoSync();
      startHoldingTransactionAutoSync();
      return true;
    })
    .catch(() => { cloudAutoSyncStarted = false; });
  return true;
}
