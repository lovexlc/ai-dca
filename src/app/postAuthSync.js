// 登录后的后台单一协调入口：迁移检查 → 云自动同步 → 首次同步。
//
// 认证结果与同步结果严格分离：
// - register/login 只对本地认证服务负责，成功即算登录完成；
// - 迁移/首次同步的任何失败都不再回传为登录失败，只通过 cloud-sync 事件通知 UI；
// - D1 session 尚未从本地认证服务同步到云端时，云端接口返回 401，
//   这里在有界窗口内退避重试并广播「云同步准备中」，绝不当成密码错误，也绝不无限重试。
//
// 普通启动（ensureCloudSyncReady）与登录后同步（coordinatePostAuthSync）
// 都经由本模块调度，避免多个入口各自触发迁移检查和重复 hydrate。

import { loadCloudSession } from './authSession.js';

export const CLOUD_SYNC_PREPARING_EVENT = 'cloud-sync:preparing';
export const CLOUD_SESSION_NOT_READY_CODE = 'CLOUD_SESSION_NOT_READY';

// D1 session 传播窗口内的有界重试：1s → 2s → 4s → 8s → 16s（累计约 31s）。
// 本地 outbox 轮询 5s 一批，正常传播远早于窗口结束；窗口耗尽即停止，
// 交由用户手动同步或下一次页面加载，不做无限重试。
export const SESSION_PROPAGATION_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000];

const SETTLED_MIGRATION_STATUSES = new Set(['imported', 'skipped', 'no-legacy']);

function dispatch(name, detail = {}) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function delay(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

export function postAuthSessionIdentity(session = loadCloudSession()) {
  return `${String(session?.userId || '')}:${String(session?.accessToken || '')}`;
}

/** 会话已在本地被切换/登出时，立即放弃所有剩余步骤。 */
function assertSameSession(identity) {
  if (postAuthSessionIdentity() !== identity) {
    const error = new Error('账号已切换，停止本次登录后同步');
    error.code = 'POST_AUTH_SESSION_CHANGED';
    throw error;
  }
}

function isSessionPropagationGap(error) {
  // 只有云端账号接口的 401 才可能是「本地 session 未同步到 D1」；
  // 认证服务自身的 401（密码错误）不经过本模块。
  return Number(error?.status) === 401;
}

async function runWithSessionPropagationRetry(task, { identity, phase, session }) {
  let lastError = null;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      if (error?.code === 'POST_AUTH_SESSION_CHANGED') throw error;
      if (!isSessionPropagationGap(error)) throw error;
      lastError = error;
      if (attempt >= SESSION_PROPAGATION_RETRY_DELAYS_MS.length) break;
      dispatch(CLOUD_SYNC_PREPARING_EVENT, {
        phase,
        attempt: attempt + 1,
        session: { userId: session?.userId || '', username: session?.username || '' }
      });
      await delay(SESSION_PROPAGATION_RETRY_DELAYS_MS[attempt]);
      assertSameSession(identity);
    }
  }
  const error = new Error('云同步暂未就绪：登录会话仍在同步到云端，稍后会自动重试，也可以手动同步。');
  error.code = CLOUD_SESSION_NOT_READY_CODE;
  error.status = 401;
  error.cause = lastError;
  throw error;
}

/** 首次同步：沿用原 runInitialSync 的语义，但冲突检测修正为读取 summary。 */
async function runInitialAccountSync(cloudSync, { action, identity }) {
  assertSameSession(identity);
  const remoteMeta = await cloudSync.refreshRemoteCloudMeta();
  const hasRemoteBackup = Boolean(remoteMeta?.version);
  cloudSync.ensureLocalChangeBaseline();
  if (hasRemoteBackup) {
    const conflict = await cloudSync.prepareCloudSyncConflict();
    const summary = conflict?.summary || {};
    if (summary.hasLocalChanges) {
      const error = new Error('本机与云端数据不一致，请先选择同步方式。');
      error.isCloudSyncConflict = true;
      // 冲突弹窗按 summary 字段（summaryText/changedKeys 等）渲染；保留原始信封供手动处理。
      error.conflict = {
        ...summary,
        remoteEnvelope: conflict?.remoteEnvelope || null,
        localEnvelope: conflict?.localEnvelope || null
      };
      throw error;
    }
    const pulled = await cloudSync.restoreEncryptedCloudBackup();
    dispatch('cloud-sync:auto-restored', { result: pulled });
    return 'pulled';
  }
  const { collectBackupPayload } = await import('./webdavBackup.js');
  if (action === 'register' || collectBackupPayload().keys.length > 0) {
    const uploaded = await cloudSync.uploadEncryptedCloudBackup({ force: true });
    dispatch('cloud-sync:auto-uploaded', { result: uploaded });
    return uploaded?.skipped ? 'skipped-upload' : 'uploaded';
  }
  return 'no-remote';
}

const inFlightByUser = new Map();

/**
 * 登录/注册成功后的后台协调入口。同一账号同一时间只允许一个在途协调，
 * 重复调用（authClient 与 UI 同时触发）直接复用同一个 Promise。
 * 返回值只描述同步结果，绝不影响登录成败。
 */
export async function coordinatePostAuthSync({
  session = loadCloudSession(),
  action = 'login',
  securityPassword = ''
} = {}) {
  if (!session?.accessToken) return null;
  const key = String(session.userId || session.username || '');
  const existing = inFlightByUser.get(key);
  if (existing) return existing;

  const run = (async () => {
    const identity = postAuthSessionIdentity(session);
    try {
      const { ensureLegacyMigration } = await import('./legacyMigration.js');
      const migration = await runWithSessionPropagationRetry(
        () => ensureLegacyMigration({ securityPassword, useRemembered: true, autoMigrateWithPassword: true }),
        { identity, phase: 'migration', session }
      );
      assertSameSession(identity);
      const migrationStatus = String(migration?.status || '').trim().toLowerCase();
      if (!SETTLED_MIGRATION_STATUSES.has(migrationStatus)) {
        // 迁移弹窗由会话事件与 ACCOUNT_MIGRATION_EVENT 驱动，这里不阻塞登录结果。
        dispatch(CLOUD_SYNC_PREPARING_EVENT, {
          phase: 'migration-required',
          session: { userId: session.userId || '', username: session.username || '' }
        });
        return { status: 'migration-required', migration };
      }

      const cloudSync = await import('./cloudSync.js');
      cloudSync.startCloudAutoSync();
      const syncResult = await runWithSessionPropagationRetry(
        () => runInitialAccountSync(cloudSync, { action, identity }),
        { identity, phase: 'initial-sync', session }
      );
      return { status: 'synced', syncResult };
    } catch (error) {
      if (error?.code === 'POST_AUTH_SESSION_CHANGED') return { status: 'session-changed' };
      if (error?.isCloudSyncConflict) {
        dispatch('cloud-sync:auto-error', {
          message: error.message,
          code: 'CLOUD_SYNC_CONFLICT',
          conflict: error.conflict
        });
        return { status: 'conflict', conflict: error.conflict };
      }
      // 同步失败只作为同步状态展示，绝不影响已完成的登录结果。
      console.warn('[post-auth-sync] 登录后同步未完成', error?.code || '', error?.message || error);
      dispatch('cloud-sync:auto-error', { message: error?.message || String(error), code: error?.code || '' });
      return { status: 'error', error };
    }
  })().finally(() => { inFlightByUser.delete(key); });

  inFlightByUser.set(key, run);
  return run;
}

/**
 * 普通启动（已有本地 session）的协调入口：带传播重试的迁移检查后启动自动同步。
 * 与登录后共用同一迁移门禁与 401 有界重试语义。
 */
export async function ensureCloudSyncReady({ session = loadCloudSession() } = {}) {
  if (!session?.accessToken) return { status: 'no-session' };
  const identity = postAuthSessionIdentity(session);
  try {
    const { ensureLegacyMigration } = await import('./legacyMigration.js');
    const migration = await runWithSessionPropagationRetry(
      () => ensureLegacyMigration(),
      { identity, phase: 'migration', session }
    );
    assertSameSession(identity);
    const migrationStatus = String(migration?.status || '').trim().toLowerCase();
    if (!SETTLED_MIGRATION_STATUSES.has(migrationStatus)) {
      return { status: 'migration-required', migration };
    }
    const cloudSync = await import('./cloudSync.js');
    cloudSync.startCloudAutoSync();
    return { status: 'started' };
  } catch (error) {
    if (error?.code === 'POST_AUTH_SESSION_CHANGED') return { status: 'session-changed' };
    dispatch('cloud-sync:auto-error', { message: error?.message || String(error), code: error?.code || '' });
    return { status: 'error', error };
  }
}
