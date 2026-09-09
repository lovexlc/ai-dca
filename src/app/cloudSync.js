// 兼容门面：对外保持原有 cloudSync 导出，内部已改为逐功能资源同步（resourceSync.js）。
// 不再整包加密上传：旧签名里的 securityPassword / rememberDevice 参数保留但已忽略（待 UI 清理）。
// 合并算法已拆到 syncMerge.js；现有测试仍可从本文件导入。

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
import { fetchAccountEnvelopeExport, fetchAccountManifest } from './accountApi.js';
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

// 记住本机数据的基线签名，用于展示「本机有未同步变更」。
export function ensureLocalChangeBaseline() {
  const snapshot = createLocalDataSnapshot();
  const meta = loadCloudSyncMeta() || {};
  const changed = meta.localSignature !== snapshot.signature;
  if (changed) {
    saveCloudSyncMeta({
      ...meta,
      localSignature: snapshot.signature,
      localKeyCount: snapshot.keyCount,
      localUpdatedAt: nowIso()
    });
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

// 上行：逐资源推送本地变更（参数名保持不变以兼容现有 UI）。
export async function uploadEncryptedCloudBackup({ force = false } = {}) {
  const session = loadCloudSession();
  if (!session?.accessToken) throw new Error('请先登录账户');
  if (force) markAllResourcesDirty();
  const result = await pushAllResources({ force, session });
  const meta = mergeSummaryIntoMeta({ direction: 'upload', uploadedAt: nowIso() });
  const pushedCount = result.pushed?.length || 0;
  return {
    skipped: pushedCount === 0,
    reason: pushedCount === 0 ? 'unchanged' : '',
    pushedCount,
    failed: result.failed || [],
    updatedAt: meta.lastPushAt || nowIso(),
    keyCount: meta.keyCount || 0
  };
}

// 下行：远端权威拉取（保留本机独有项）。
export async function restoreEncryptedCloudBackup({ onlyIfRemoteNewer = false } = {}) {
  const session = loadCloudSession();
  if (!session?.accessToken) throw new Error('请先登录账户');
  const result = await pullResources({ force: !onlyIfRemoteNewer, session });
  mergeSummaryIntoMeta({ direction: 'restore', appliedAt: nowIso() });
  return {
    restoredKeyCount: result.applied?.length || 0,
    appliedResources: result.applied || [],
    updatedAt: nowIso()
  };
}

export async function mergeLocalIntoCloudBackup() {
  const session = loadCloudSession();
  if (!session?.accessToken) throw new Error('请先登录账户');
  markAllResourcesDirty();
  const result = await syncAllResources({ direction: 'both', session });
  mergeSummaryIntoMeta({ direction: 'merge', uploadedAt: nowIso() });
  return {
    restoredKeyCount: result.pulled?.applied?.length || 0,
    pushedCount: result.pushed?.pushed?.length || 0,
    updatedAt: nowIso()
  };
}

export async function overwriteCloudWithLocal() {
  markAllResourcesDirty();
  return uploadEncryptedCloudBackup({ force: true });
}

export async function pullRemoteAuthoritativeMerge() {
  return restoreEncryptedCloudBackup({ onlyIfRemoteNewer: false });
}

export async function refreshRemoteCloudMeta() {
  const session = loadCloudSession();
  if (!session?.accessToken) return null;
  const manifest = await fetchAccountManifest(session);
  const resources = Array.isArray(manifest?.resources) ? manifest.resources : [];
  const populated = resources.filter((item) => item.revision > 0 && !item.deleted);
  const updatedAt = populated.map((item) => String(item.updatedAt || '')).filter(Boolean).sort().pop() || '';
  return mergeSummaryIntoMeta({
    remoteResourceCount: populated.length,
    remoteUpdatedAt: updatedAt,
    migrationStatus: manifest?.migration?.status || ''
  });
}

// 冲突预览：从服务端拉一份明文 envelope，复用旧的差异汇总展示。
export async function prepareCloudSyncConflict() {
  const session = loadCloudSession();
  if (!session?.accessToken) throw new Error('请先登录账户');
  const remoteEnvelope = await fetchAccountEnvelopeExport(session);
  const localEnvelope = buildBackupEnvelope();
  const localMeta = loadCloudSyncMeta();
  const summary = summarizeBackupConflict({
    localEnvelope,
    remoteEnvelope,
    remote: { version: null, updatedAt: remoteEnvelope?.exportedAt || '' },
    localMeta
  });
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
  const started = startAccountAutoSync();
  // 登录后自动判断存量迁移（能自动完成则完成，否则派事件给 UI）。
  Promise.resolve()
    .then(() => ensureLegacyMigration())
    .catch(() => {});
  return started;
}
