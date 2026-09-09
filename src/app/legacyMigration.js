// 存量数据迁移：把旧的「一大块加密备份」转成逐功能的明文资源。
// 密钥从不离开客户端，所以解密必须在本地完成；secureVault.js 自此只承担「解密存量」职责。
// 无法解密（换设备 / 忘记安全密码）时，可以用本机数据重新开始，旧密文保留不删。

import { fetchLatestCloudBackup } from './authClient.js';
import { loadCloudSession } from './authSession.js';
import { decryptBackupEnvelope, loadRememberedKey } from './secureVault.js';
import { splitEnvelopeIntoResources } from './accountResources.js';
import {
  fetchLegacyMigrationStatus,
  importLegacyResources,
  skipLegacyMigrationOnServer
} from './accountApi.js';
import { markAllResourcesDirty, pullResources, pushAllResources } from './resourceSync.js';

export const ACCOUNT_MIGRATION_STATE_KEY = 'aiDcaAccountMigrationState';
export const ACCOUNT_MIGRATION_EVENT = 'account-sync:migration';
const SETTLED_STATUSES = new Set(['imported', 'skipped', 'no-legacy']);

function storage() {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  return window.localStorage;
}

function dispatch(detail) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(ACCOUNT_MIGRATION_EVENT, { detail }));
}

export function loadLocalMigrationState() {
  const ls = storage();
  if (!ls) return { status: 'unknown' };
  try {
    const parsed = JSON.parse(ls.getItem(ACCOUNT_MIGRATION_STATE_KEY) || 'null');
    return parsed && typeof parsed === 'object' ? parsed : { status: 'unknown' };
  } catch {
    return { status: 'unknown' };
  }
}

function saveLocalMigrationState(patch = {}) {
  const ls = storage();
  const next = { ...loadLocalMigrationState(), ...patch, updatedAt: new Date().toISOString() };
  if (ls) ls.setItem(ACCOUNT_MIGRATION_STATE_KEY, JSON.stringify(next));
  dispatch(next);
  return next;
}

// 读取服务端迁移状态，并结合本机是否持有设备密钥，给出可执行的结论。
export async function inspectLegacyMigration(session = loadCloudSession()) {
  if (!session?.accessToken) return null;
  const status = await fetchLegacyMigrationStatus(session);
  const remembered = loadRememberedKey();
  const cryptoKind = String(status?.legacy?.cryptoKind || 'unknown');
  const hasRememberedKey = Boolean(remembered?.rawKey);
  const needsMigration = Boolean(status?.needsMigration);
  return {
    ...status,
    cryptoKind,
    hasRememberedKey,
    canMigrateHere: needsMigration && (hasRememberedKey || cryptoKind === 'password' || cryptoKind === 'plaintext'),
    needsSecurityPassword: needsMigration && !hasRememberedKey && cryptoKind === 'password',
    needsOriginalDevice: needsMigration && !hasRememberedKey && cryptoKind === 'device-key'
  };
}

// 正式迁移：本地解密 → 拆成资源 → 提交（幂等）→ 拉回本地对齐。
export async function runLegacyMigration({ securityPassword = '', useRemembered = true, overwrite = false } = {}) {
  const session = loadCloudSession();
  if (!session?.accessToken) throw new Error('请先登录账户');

  const status = await fetchLegacyMigrationStatus(session);
  if (!status?.legacy?.exists) {
    saveLocalMigrationState({ status: 'no-legacy' });
    return { status: 'no-legacy', imported: [], skipped: [] };
  }

  const remote = await fetchLatestCloudBackup(session);
  const encryptedEnvelope = remote?.encryptedEnvelope;
  if (!encryptedEnvelope?.ciphertext) {
    saveLocalMigrationState({ status: 'no-legacy' });
    return { status: 'no-legacy', imported: [], skipped: [] };
  }

  const remembered = useRemembered ? loadRememberedKey() : null;
  const secret = remembered?.rawKey ? `raw:${remembered.rawKey}` : securityPassword;
  const envelope = await decryptBackupEnvelope(encryptedEnvelope, secret);
  const split = splitEnvelopeIntoResources(envelope);
  if (!split.resourceCount) {
    saveLocalMigrationState({ status: 'empty-legacy' });
    return { status: 'empty-legacy', imported: [], skipped: [], invalid: split.invalid };
  }

  const result = await importLegacyResources({
    resources: split.resources,
    legacyVersion: Number(remote?.version || 0),
    source: remembered?.rawKey ? 'device-key' : 'password',
    overwrite,
    end: { id: session.username || '', type: 'migration' }
  }, session);

  // 导入后拉一次，让本机与云端逐资源对齐；再把本机独有项推上去。
  const pulled = await pullResources({ force: true, session });
  markAllResourcesDirty();
  await pushAllResources({ session });

  const localState = saveLocalMigrationState({
    status: 'imported',
    legacyVersion: Number(remote?.version || 0),
    importedCount: result?.imported?.length || 0,
    invalidKeys: split.invalid,
    unmappedKeys: split.unmapped
  });
  return { status: 'imported', ...result, pulled, localState };
}

// 兜底：不再要旧密文（但服务端不删），直接用本机现有数据作为新起点。
export async function skipLegacyMigration({ reason = '' } = {}) {
  const session = loadCloudSession();
  if (!session?.accessToken) throw new Error('请先登录账户');
  const result = await skipLegacyMigrationOnServer({ reason, source: 'local-fresh' }, session);
  markAllResourcesDirty();
  const pushed = await pushAllResources({ force: true, session });
  const localState = saveLocalMigrationState({ status: 'skipped', reason });
  return { status: 'skipped', ...result, pushed, localState };
}

// 启动时调用：能自动完成的就自动做，需要用户决策的只派事件给 UI。
export async function ensureLegacyMigration() {
  const session = loadCloudSession();
  if (!session?.accessToken) return null;
  const local = loadLocalMigrationState();
  if (SETTLED_STATUSES.has(String(local.status || ''))) return local;

  let status = null;
  try {
    status = await inspectLegacyMigration(session);
  } catch (err) {
    dispatch({ status: 'inspect-failed', message: err?.message || String(err) });
    return null;
  }
  if (!status) return null;

  if (!status.needsMigration) {
    return saveLocalMigrationState({ status: status.status === 'skipped' ? 'skipped' : 'no-legacy' });
  }

  // 本机有记住的设备密钥 → 无需打扰用户，直接迁移。
  if (status.hasRememberedKey) {
    try {
      return await runLegacyMigration({ useRemembered: true });
    } catch (err) {
      dispatch({ status: 'auto-failed', message: err?.message || String(err), needsSecurityPassword: true });
      return null;
    }
  }

  // 否则交给 UI：要么输安全密码，要么回原设备，要么用本机数据重新开始。
  dispatch({
    status: 'action-required',
    needsSecurityPassword: status.needsSecurityPassword,
    needsOriginalDevice: status.needsOriginalDevice,
    legacy: status.legacy
  });
  return { status: 'action-required', ...status };
}
