// 存量数据迁移：旧整包只在客户端解密，交易数据写入逐行 holdings/ledger。
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
import {
  markHoldingTransactionsDirty,
  pullHoldingTransactions,
  pushHoldingTransactions
} from './holdingTransactionsSync.js';

export const ACCOUNT_MIGRATION_STATE_KEY = 'aiDcaAccountMigrationState';
export const ACCOUNT_MIGRATION_EVENT = 'account-sync:migration';
const SETTLED_STATUSES = new Set(['imported', 'skipped', 'no-legacy']);

function storage() {
  return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
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
    saveLocalMigrationState({ status: 'empty-legacy', invalidKeys: split.invalid, deprecatedKeys: split.deprecated || [] });
    return { status: 'empty-legacy', imported: [], skipped: [], invalid: split.invalid, deprecated: split.deprecated || [] };
  }

  const result = await importLegacyResources({
    resources: split.resources,
    legacyVersion: Number(remote?.version || 0),
    source: remembered?.rawKey ? 'device-key' : 'password',
    overwrite,
    end: { id: session.username || '', type: 'migration' }
  }, session);

  // 普通资源按资源对齐；持仓交易单独按行拉取/回传，绝不把 snapshot 写回账号资源。
  const [pulledResources, pulledTransactions] = await Promise.all([
    pullResources({ force: true, session }),
    pullHoldingTransactions({ force: true, session })
  ]);
  markAllResourcesDirty();
  markHoldingTransactionsDirty();
  const [pushedResources, pushedTransactions] = await Promise.all([
    pushAllResources({ session }),
    pushHoldingTransactions({ session })
  ]);

  const localState = saveLocalMigrationState({
    status: 'imported',
    legacyVersion: Number(remote?.version || 0),
    importedCount: result?.imported?.length || 0,
    importedTransactionCount: result?.imported?.find((item) => item.resource === 'holdings/ledger')?.itemCount || pulledTransactions?.remoteCount || 0,
    invalidKeys: split.invalid,
    unmappedKeys: split.unmapped,
    deprecatedKeys: split.deprecated || []
  });
  return {
    status: 'imported',
    ...result,
    pulled: { resources: pulledResources, transactions: pulledTransactions },
    pushed: { resources: pushedResources, transactions: pushedTransactions },
    localState
  };
}

export async function skipLegacyMigration({ reason = '' } = {}) {
  const session = loadCloudSession();
  if (!session?.accessToken) throw new Error('请先登录账户');
  const result = await skipLegacyMigrationOnServer({ reason, source: 'local-fresh' }, session);
  markAllResourcesDirty();
  markHoldingTransactionsDirty();
  const [pushedResources, pushedTransactions] = await Promise.all([
    pushAllResources({ force: true, session }),
    pushHoldingTransactions({ force: true, session })
  ]);
  const localState = saveLocalMigrationState({ status: 'skipped', reason });
  return { status: 'skipped', ...result, pushed: { resources: pushedResources, transactions: pushedTransactions }, localState };
}

export async function ensureLegacyMigration({
  securityPassword = '',
  useRemembered = true,
  autoMigrateWithPassword = false,
  allowAutomaticMigration = false
} = {}) {
  const session = loadCloudSession();
  if (!session?.accessToken) return null;

  // 远端 migrations/legacy 是唯一门禁来源。即使本地记过 imported/skipped/no-legacy，
  // 每次进入账号同步链路也必须重新读取服务端状态，避免新设备或服务端状态变化被本地缓存绕过。
  let status = null;
  try {
    status = await inspectLegacyMigration(session);
  } catch (err) {
    dispatch({ status: 'inspect-failed', message: err?.message || String(err) });
    return null;
  }
  if (!status) return null;

  const remoteStatus = String(status.status || '').trim().toLowerCase();
  if (SETTLED_STATUSES.has(remoteStatus)) {
    return saveLocalMigrationState({
      status: remoteStatus,
      legacy: status.legacy || null
    });
  }

  // pending 但服务端确认不存在旧密文时统一收敛为 no-legacy。
  if (!status.needsMigration || !status?.legacy?.exists) {
    return saveLocalMigrationState({ status: 'no-legacy', legacy: status.legacy || null });
  }

  // 同步安全边界已经变化，旧数据必须先经过用户明确选择；登录或后台自动同步
  // 不能仅凭记忆密钥或登录密码静默迁移。只有显式调用方同时开启本开关时才允许自动迁移。
  const canAutoMigrate = allowAutomaticMigration && (
    status.hasRememberedKey
    || (autoMigrateWithPassword && status.canMigrateHere && (securityPassword || status.cryptoKind === 'plaintext'))
  );
  if (canAutoMigrate) {
    try {
      return await runLegacyMigration({ securityPassword, useRemembered });
    } catch (err) {
      const message = err?.message || String(err);
      dispatch({ status: 'auto-failed', message, needsSecurityPassword: true });
      return { status: 'action-required', ...status, migrationError: message };
    }
  }

  dispatch({
    status: 'action-required',
    needsSecurityPassword: status.needsSecurityPassword,
    needsOriginalDevice: status.needsOriginalDevice,
    legacy: status.legacy
  });
  return { status: 'action-required', ...status };
}
