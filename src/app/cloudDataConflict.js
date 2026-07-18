import { loadSwitchConfigFromWorker, saveSwitchConfigToWorker } from './switchStrategySync.js';
import { getUserDataStorage, userDataStore } from './userDataStore.js';
import {
  DOMAIN_API_REGISTRY,
  TAB_RESOURCE_REGISTRY,
  serializeSyncResourceValue,
  getTabResourceDescriptor
} from './syncRegistry.js';
import {
  deleteTabResource,
  fetchTabResource,
  fetchUserDataResource,
  putTabResource
} from './authClient.js';
import { computeBackupContentHash, decryptBackupEnvelope } from './secureVault.js';

const LEGACY_HOLDINGS_STATE_KEY = 'aiDcaFundHoldingsState';
const HOLDINGS_LEDGER_KEY = 'aiDcaFundHoldingsLedger';

export const CLOUD_DATA_DOMAIN_ADAPTERS = {
  aiDcaSwitchStrategyWorkerConfig: {
    kind: 'domain',
    key: 'aiDcaSwitchStrategyWorkerConfig',
    label: '换基 Worker 配置',
    security: 'plain',
    async read() {
      return loadSwitchConfigFromWorker();
    },
    async write(value) {
      return saveSwitchConfigToWorker(parseValue(value) || {});
    }
  }
};

export const CLOUD_DATA_RESOURCE_REGISTRY = [
  ...TAB_RESOURCE_REGISTRY.map((descriptor) => ({
    ...descriptor,
    kind: 'tab',
    label: descriptor.key
  })),
  ...DOMAIN_API_REGISTRY
    .filter((descriptor) => CLOUD_DATA_DOMAIN_ADAPTERS[descriptor.key])
    .map((descriptor) => ({
      ...descriptor,
      ...CLOUD_DATA_DOMAIN_ADAPTERS[descriptor.key]
    }))
];

const registryByKey = new Map(CLOUD_DATA_RESOURCE_REGISTRY.map((descriptor) => [descriptor.key, descriptor]));

function parseValue(value) {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}

function cloneValue(value) {
  if (value == null || typeof value !== 'object') return value;
  try { return JSON.parse(JSON.stringify(value)); } catch { return value; }
}

function stableValue(value) {
  if (value === undefined) return '__undefined__';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableValue(value[key])}`).join(',')}}`;
}

function valuesEqual(left, right) {
  return stableValue(left) === stableValue(right);
}

function recordId(value, index = 0) {
  if (value && typeof value === 'object') {
    for (const key of ['id', 'transactionId', 'ruleId', 'code', 'symbol', 'key']) {
      if (value[key] != null && String(value[key]).trim()) return String(value[key]);
    }
  }
  return `index:${index}`;
}

function fieldDiffs(local, remote) {
  if (!local || typeof local !== 'object' || Array.isArray(local)
    || !remote || typeof remote !== 'object' || Array.isArray(remote)) return [];
  return [...new Set([...Object.keys(local), ...Object.keys(remote)])]
    .sort()
    .filter((name) => !valuesEqual(local[name], remote[name]))
    .map((name) => ({
      name,
      local: local[name],
      remote: remote[name],
      defaultDecision: 'cloud'
    }));
}

function findArrayContainer(local, remote) {
  if (Array.isArray(local) || Array.isArray(remote)) return { path: '', local: local || [], remote: remote || [] };
  if (!local || typeof local !== 'object' || !remote || typeof remote !== 'object') return null;
  for (const path of ['transactions', 'plans', 'lists', 'rules', 'items', 'entries']) {
    if (Array.isArray(local[path]) || Array.isArray(remote[path])) {
      return { path, local: local[path] || [], remote: remote[path] || [] };
    }
  }
  return null;
}

function rowKey(path, id) {
  return `${path || '$'}:${String(id || '')}`;
}

export function buildCloudConflictRows(localRaw, remoteRaw) {
  const local = parseValue(localRaw);
  const remote = parseValue(remoteRaw);
  if (local == null && remote == null) return [];
  const container = findArrayContainer(local, remote);
  if (container) {
    const localMap = new Map(container.local.map((item, index) => [recordId(item, index), item]));
    const remoteMap = new Map(container.remote.map((item, index) => [recordId(item, index), item]));
    const ids = [...new Set([...localMap.keys(), ...remoteMap.keys()])];
    return ids.reduce((rows, id) => {
      const localItem = localMap.get(id);
      const remoteItem = remoteMap.get(id);
      const kind = localItem == null ? 'remote-only' : remoteItem == null ? 'local-only' : 'changed';
      if (kind === 'changed' && valuesEqual(localItem, remoteItem)) return rows;
      rows.push({
        id,
        key: rowKey(container.path, id),
        path: container.path,
        kind,
        local: cloneValue(localItem),
        remote: cloneValue(remoteItem),
        fields: kind === 'changed' ? fieldDiffs(localItem, remoteItem) : [],
        defaultDecision: 'cloud'
      });
      return rows;
    }, []);
  }

  if (local && typeof local === 'object' && !Array.isArray(local)
    && remote && typeof remote === 'object' && !Array.isArray(remote)) {
    return fieldDiffs(local, remote).map((field) => ({
      id: field.name,
      key: `field:${field.name}`,
      path: '',
      kind: 'field',
      local: field.local,
      remote: field.remote,
      fields: [field],
      defaultDecision: 'cloud'
    }));
  }

  return valuesEqual(local, remote) ? [] : [{
    id: 'resource',
    key: 'resource',
    path: '',
    kind: 'resource',
    local: cloneValue(local),
    remote: cloneValue(remote),
    fields: [],
    defaultDecision: 'cloud'
  }];
}

function decisionFor(decisions, row) {
  const value = decisions?.[row.key] ?? decisions?.[row.id];
  if (typeof value === 'string') return { choice: value, fields: {} };
  if (value && typeof value === 'object') return { choice: value.choice || 'cloud', fields: value.fields || {} };
  return { choice: 'cloud', fields: {} };
}

function resolveArrayValue(local, remote, rows, decisions, path) {
  const localItems = Array.isArray(local) ? local : [];
  const remoteItems = Array.isArray(remote) ? remote : [];
  const localMap = new Map(localItems.map((item, index) => [recordId(item, index), item]));
  const remoteMap = new Map(remoteItems.map((item, index) => [recordId(item, index), item]));
  const result = remoteItems.map((item) => cloneValue(item));
  const remoteIndexMap = new Map(remoteItems.map((item, index) => [recordId(item, index), index]));
  const rowsForPath = rows.filter((item) => item.path === path);
  const removeIndexes = [];

  for (const row of rowsForPath) {
    const decision = decisionFor(decisions, row);
    if (row.kind === 'remote-only') {
      if (decision.choice === 'local') {
        const index = remoteIndexMap.get(row.id);
        if (index != null) removeIndexes.push(index);
      }
      continue;
    }
    if (row.kind === 'local-only') {
      if (decision.choice === 'local') {
        result.push(cloneValue(localMap.get(row.id)));
      }
      continue;
    }
    if (decision.choice !== 'local' && !Object.values(decision.fields || {}).some((value) => value === 'local')) continue;
    const remoteItem = cloneValue(remoteMap.get(row.id));
    const localItem = localMap.get(row.id);
    const next = decision.choice === 'local' ? cloneValue(localItem) : remoteItem;
    if (decision.choice !== 'local' && next && localItem && typeof next === 'object') {
      for (const field of row.fields || []) {
        if (decision.fields?.[field.name] === 'local') next[field.name] = cloneValue(localItem[field.name]);
      }
    }
    const index = remoteIndexMap.get(row.id);
    if (index != null) result[index] = next;
  }

  // Remove by the original remote indexes from right to left so multiple
  // remote-only choices cannot shift the remaining record targets.
  for (const index of [...new Set(removeIndexes)].sort((left, right) => right - left)) {
    result.splice(index, 1);
  }

  return result;
}

export function resolveCloudConflictValue(localRaw, remoteRaw, decisions = {}) {
  const local = parseValue(localRaw);
  const remote = parseValue(remoteRaw);
  const rows = buildCloudConflictRows(localRaw, remoteRaw);
  const container = findArrayContainer(local, remote);
  if (container) {
    const resolved = resolveArrayValue(container.local, container.remote, rows, decisions, container.path);
    if (!container.path) return JSON.stringify(resolved);
    const base = cloneValue(remote && typeof remote === 'object' && !Array.isArray(remote) ? remote : {});
    base[container.path] = resolved;
    return JSON.stringify(base);
  }
  if (local && typeof local === 'object' && !Array.isArray(local)
    && remote && typeof remote === 'object' && !Array.isArray(remote)) {
    const result = cloneValue(remote);
    for (const row of rows) {
      const decision = decisionFor(decisions, row);
      if (decision.choice === 'local' && row.id) result[row.id] = cloneValue(local[row.id]);
    }
    return JSON.stringify(result);
  }
  const resourceDecision = decisions?.resource || decisions?.['$'] || 'cloud';
  return resourceDecision === 'local' ? localRaw : remoteRaw;
}

export function getCloudDataResourceDescriptor(key) {
  return registryByKey.get(String(key || '')) || getTabResourceDescriptor(key) || null;
}

export function parseCloudDataValue(value) {
  return parseValue(value);
}

export async function cloudDataContentHash(key, raw) {
  return computeBackupContentHash({
    version: 1,
    keyCount: 1,
    keys: [String(key || '')],
    payload: { [String(key || '')]: serializeSyncResourceValue(key, raw) }
  });
}

function randomMutationId() {
  const random = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
  return `cloud-data:${Date.now().toString(36)}:${random}`.slice(0, 160);
}

function withoutRememberedKey(value) {
  if (!value || typeof value !== 'object') return value;
  const next = { ...value };
  delete next.rememberedKey;
  return next;
}

function localValue(key) {
  return getUserDataStorage().getItem(key);
}

function setLocalValue(key, value) {
  const options = { persist: false, allowDuringHydration: true };
  if (value == null) getUserDataStorage().removeItem(key, options);
  else getUserDataStorage().setItem(key, String(value), options);
}

async function decryptRemoteResource(resource, key, securityPassword = '') {
  if (!resource?.encrypted) return null;
  const remembered = userDataStore.crypto?.rawKey || '';
  const envelope = await decryptBackupEnvelope(
    resource.encrypted,
    String(securityPassword || '') || (remembered ? `raw:${remembered}` : '')
  );
  const raw = envelope?.payload?.[key];
  return raw == null ? null : serializeSyncResourceValue(key, raw);
}

function hasTransactions(raw) {
  const parsed = parseValue(raw);
  return Array.isArray(parsed?.transactions) && parsed.transactions.length > 0;
}

// 旧版云端把持仓汇总和行情快照保存到 aiDcaFundHoldingsState；新版只读取
// aiDcaFundHoldingsLedger。检查云端数据时，如果新版流水为空，先把旧汇总投影成
// BUY 流水，用户选择“采用云端”时再一次性写入新版加密资源，避免迁移完成后持仓页变成空白。
async function readLegacyHoldingsProjection(session, currentRemote, securityPassword = '') {
  if (hasTransactions(currentRemote)) return null;

  let legacy;
  try {
    legacy = await fetchUserDataResource(LEGACY_HOLDINGS_STATE_KEY, session);
  } catch {
    return null;
  }
  if (!legacy?.encrypted || legacy.deleted) return null;

  let legacyRaw;
  try {
    legacyRaw = await decryptRemoteResource(legacy, LEGACY_HOLDINGS_STATE_KEY, securityPassword);
  } catch {
    return { requiresPassword: true };
  }
  const legacyState = parseValue(legacyRaw);
  if (!Array.isArray(legacyState?.rows) || legacyState.rows.length === 0) return null;

  // holdingsLedger imports userDataStore, so keep this compatibility import lazy
  // and avoid introducing an eager module cycle during application bootstrap.
  const { migrateLegacyAggregateState } = await import('./holdingsLedger.js');
  const migrated = migrateLegacyAggregateState(legacyState);
  if (!Array.isArray(migrated?.transactions) || migrated.transactions.length === 0) return null;
  const migratedRaw = serializeSyncResourceValue(HOLDINGS_LEDGER_KEY, migrated);
  return {
    raw: migratedRaw,
    legacy,
    legacyKey: LEGACY_HOLDINGS_STATE_KEY
  };
}

function normalizeRemoteValue(key, raw) {
  if (raw == null) return null;
  return typeof raw === 'string' ? serializeSyncResourceValue(key, raw) : JSON.stringify(raw);
}

async function readResource(session, descriptor, securityPassword = '') {
  const key = descriptor.key;
  const localRaw = localValue(key);
  if (descriptor.kind === 'domain') {
    const remoteObject = await descriptor.read();
    const remoteRaw = remoteObject == null ? null : JSON.stringify(remoteObject);
    const localHash = localRaw == null ? '' : await cloudDataContentHash(key, localRaw);
    const remoteHash = remoteRaw == null ? '' : await cloudDataContentHash(key, remoteRaw);
    return buildResourceResult(descriptor, localRaw, remoteRaw, {
      revision: 0,
      contentHash: remoteHash,
      security: 'plain',
      localHash
    });
  }

  const remote = await fetchTabResource(descriptor.tab, descriptor.resource, session);
  let remoteRaw = null;
  let requiresPassword = false;
  if (!remote?.deleted) {
    if (descriptor.security === 'plain') remoteRaw = normalizeRemoteValue(key, remote?.data);
    else if (remote?.encrypted) {
      try {
        remoteRaw = await decryptRemoteResource(remote, key, securityPassword);
      } catch {
        requiresPassword = true;
      }
    }
  }
  const localHash = localRaw == null ? '' : await cloudDataContentHash(key, localRaw);
  const legacyProjection = key === HOLDINGS_LEDGER_KEY
    ? await readLegacyHoldingsProjection(session, remoteRaw, securityPassword)
    : null;
  const effectiveRemoteRaw = legacyProjection?.raw || remoteRaw;
  const result = buildResourceResult(descriptor, localRaw, effectiveRemoteRaw, {
    ...remote,
    localHash,
    requiresPassword: requiresPassword || Boolean(legacyProjection?.requiresPassword),
    security: descriptor.security
  });
  result.remote = remote;
  result.requiresPassword = requiresPassword || Boolean(legacyProjection?.requiresPassword);
  if (legacyProjection?.raw) {
    result.legacySource = true;
    result.legacyKey = legacyProjection.legacyKey;
    result.legacyResource = legacyProjection.legacy;
  }
  return result;
}

function buildResourceResult(descriptor, localRaw, remoteRaw, meta = {}) {
  const localExists = localRaw != null;
  const remoteExists = remoteRaw != null || Boolean(meta.contentHash) || Boolean(meta.encrypted);
  let status = 'matched';
  if (localExists && !remoteExists) status = 'local-only';
  else if (!localExists && remoteExists) status = 'cloud-only';
  else if (meta.requiresPassword) status = 'conflict';
  else if (localExists && remoteExists && !valuesEqual(parseValue(localRaw), parseValue(remoteRaw))) status = 'conflict';
  const rows = status !== 'matched' && !meta.requiresPassword
    ? buildCloudConflictRows(localRaw, remoteRaw)
    : [];
  return {
    key: descriptor.key,
    descriptor,
    localRaw,
    remoteRaw,
    remote: meta.remote || meta,
    status,
    rows,
    requiresPassword: Boolean(meta.requiresPassword),
    localHash: String(meta.localHash || ''),
    cloudHash: String(meta.contentHash || ''),
    revision: Number(meta.revision) || 0
  };
}

export async function inspectCloudData(session, { securityPassword = '' } = {}) {
  if (!session?.accessToken) throw Object.assign(new Error('请先登录账户'), { code: 'AUTH_REQUIRED' });
  const resources = [];
  for (const descriptor of CLOUD_DATA_RESOURCE_REGISTRY) {
    try {
      resources.push(await readResource(session, descriptor, securityPassword));
    } catch (error) {
      resources.push({
        key: descriptor.key,
        descriptor,
        localRaw: localValue(descriptor.key),
        remoteRaw: null,
        remote: null,
        status: 'unavailable',
        rows: [],
        requiresPassword: false,
        error: error?.message || '资源读取失败',
        localHash: '',
        cloudHash: '',
        revision: 0
      });
    }
  }
  return resources;
}

async function writeTabResource(session, resource, value, securityPassword = '') {
  const descriptor = resource.descriptor;
  const remote = resource.remote || {};
  const baseRevision = Number(resource.revision) || 0;
  const mutationId = randomMutationId();
  if (value == null) {
    if (descriptor.kind === 'domain') return null;
    return deleteTabResource(descriptor.tab, descriptor.resource, {
      baseRevision,
      mutationId,
      schemaVersion: 1
    }, session);
  }
  if (descriptor.kind === 'domain') return descriptor.write(value);
  const contentHash = await cloudDataContentHash(descriptor.key, value);
  if (descriptor.security === 'encrypted') {
    if (securityPassword) userDataStore.crypto.securityPassword = String(securityPassword);
    const encrypted = await userDataStore.encryptResource(descriptor.key, value, userDataStore.crypto);
    return putTabResource(descriptor.tab, descriptor.resource, {
      baseRevision,
      mutationId,
      schemaVersion: 1,
      contentHash,
      encrypted: withoutRememberedKey(encrypted)
    }, session);
  }
  return putTabResource(descriptor.tab, descriptor.resource, {
    baseRevision,
    mutationId,
    schemaVersion: 1,
    contentHash,
    data: serializeSyncResourceValue(descriptor.key, value)
  }, session);
}

export async function applyCloudDataChoices(session, resources, choices = {}, { securityPassword = '' } = {}) {
  const results = [];
  for (const resource of resources) {
    if (resource.status === 'matched') continue;
    const key = resource.key;
    const choice = choices[key] || {};
    let nextValue;
    if (resource.status === 'conflict') {
      if (resource.remoteRaw == null && resource.requiresPassword) {
        throw Object.assign(new Error('查看交易记录冲突需要安全密码'), { code: 'SECURITY_PASSWORD_REQUIRED', key });
      }
      nextValue = resolveCloudConflictValue(resource.localRaw, resource.remoteRaw, choice.decisions || choice);
    } else if (resource.status === 'local-only') {
      nextValue = choice.choice === 'local' ? resource.localRaw : null;
    } else if (resource.status === 'cloud-only') {
      nextValue = choice.choice === 'local' ? null : resource.remoteRaw;
    }
    const decisionValues = resource.status === 'conflict'
      ? Object.values(choice.decisions || choice).flatMap((value) => (
        typeof value === 'string' ? [value] : value && typeof value === 'object' ? [value.choice, ...Object.values(value.fields || {})] : []
      ))
      : [choice.choice];
    const hasLocalDecision = decisionValues.includes('local');
    if (resource.descriptor.security === 'encrypted' && securityPassword) {
      userDataStore.crypto.securityPassword = String(securityPassword);
    }
    const shouldWriteRemote = resource.status === 'local-only'
      ? choice.choice === 'local'
      : resource.status === 'cloud-only'
        ? choice.choice === 'local' || Boolean(resource.legacySource)
        : hasLocalDecision || Boolean(resource.legacySource && !hasLocalDecision);
    const result = shouldWriteRemote ? await writeTabResource(session, resource, nextValue, securityPassword) : null;
    setLocalValue(key, nextValue);
    results.push({ key, value: nextValue, result });
  }
  return results;
}

export function summarizeCloudDataResources(resources = []) {
  return resources.reduce((summary, resource) => {
    const status = String(resource?.status || 'matched');
    summary.total += 1;
    if (status === 'matched') summary.matched += 1;
    if (status === 'conflict') summary.conflicts += 1;
    if (status === 'local-only') summary.localOnly += 1;
    if (status === 'cloud-only') summary.cloudOnly += 1;
    return summary;
  }, { total: 0, matched: 0, conflicts: 0, localOnly: 0, cloudOnly: 0 });
}

export const __internals = {
  parseValue,
  stableValue,
  findArrayContainer,
  fieldDiffs,
  recordId,
  decisionFor,
  buildResourceResult
};
