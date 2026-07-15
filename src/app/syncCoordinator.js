import {
  acquireSyncWriter,
  completeSyncDeviceMigration,
  fetchSyncV2Snapshot,
  heartbeatSyncWriter,
  loadCloudSession,
  putSyncV2Snapshot,
  registerSyncDevice,
  releaseSyncWriter,
  startSyncDeviceMigration
} from './authClient.js';
import { applyBackupEnvelope, buildBackupEnvelope, isBackupPayloadKey } from './webdavBackup.js';
import {
  computeBackupContentHash,
  decryptBackupEnvelope,
  encryptBackupEnvelope,
  loadRememberedKey,
  rememberKeyForEncryptedEnvelope,
  saveRememberedKey
} from './secureVault.js';
import { getClientEnd, getClientSessionId } from './syncClient.js';
import { TRANSIENT_SYNC_KEYS } from './syncRegistry.js';
import { hasMeaningfulLocalData, mergeMigrationEnvelopes } from './syncMigration.js';

export const SYNC_STATE_KEY = 'aiDcaCloudSyncMeta';
export const SYNC_LEASE_KEY_PREFIX = 'aiDcaSyncWriterLease';

const AUTO_UPLOAD_DELAY = 2500;
const AUTO_PULL_DELAY = 1200;
const WRITER_HEARTBEAT_DELAY = 10000;
const AUTO_PULL_INTERVAL = 60000;

let started = false;
let uploadTimer = null;
let pullTimer = null;
let heartbeatTimer = null;
let pullInterval = null;
let uploadInFlight = false;
let pullInFlight = false;
let suppressLocalObserver = false;
let lastObservedSignature = '';
let originalSetItem = null;
let originalRemoveItem = null;
let originalClear = null;

function localStorageSafe() {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try { return window.localStorage; } catch { return null; }
}

function sessionStorageSafe() {
  if (typeof window === 'undefined' || !window.sessionStorage) return null;
  try { return window.sessionStorage; } catch { return null; }
}

function nowIso() {
  return new Date().toISOString();
}

function isOnline() {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

function dispatch(name, detail = {}) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function loadState() {
  const storage = localStorageSafe();
  if (!storage) return {};
  try {
    const value = JSON.parse(storage.getItem(SYNC_STATE_KEY) || '{}');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

function saveState(next = {}) {
  const storage = localStorageSafe();
  if (!storage) return next;
  const state = { ...next, savedAt: nowIso() };
  storage.setItem(SYNC_STATE_KEY, JSON.stringify(state));
  dispatch('cloud-sync:meta-changed', { meta: state });
  return state;
}

function currentEnd() {
  return getClientEnd();
}

function rememberedForSession(session) {
  return loadRememberedKey({ userId: session?.userId, username: session?.username });
}

function leaseStorageKey(session, deviceId = currentEnd().id, sessionId = getClientSessionId()) {
  return `${SYNC_LEASE_KEY_PREFIX}:${encodeURIComponent(String(session?.userId || session?.username || 'unknown'))}:${encodeURIComponent(deviceId)}:${encodeURIComponent(sessionId)}`;
}

function loadLease(session, deviceId = currentEnd().id, sessionId = getClientSessionId()) {
  const storage = sessionStorageSafe();
  if (!storage) return null;
  try {
    const parsed = JSON.parse(storage.getItem(leaseStorageKey(session, deviceId, sessionId)) || 'null');
    if (!parsed?.writerToken || parsed.deviceId !== deviceId || (parsed.sessionId && parsed.sessionId !== sessionId)) return null;
    if (Date.parse(String(parsed.expiresAt || '')) <= Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveLease(session, lease) {
  const storage = sessionStorageSafe();
  if (!storage || !lease?.writerToken || !lease.deviceId) return lease;
  storage.setItem(leaseStorageKey(session, lease.deviceId, lease.sessionId || getClientSessionId()), JSON.stringify({ ...lease, savedAt: nowIso() }));
  return lease;
}

function clearLease(session, deviceId = currentEnd().id, sessionId = getClientSessionId()) {
  sessionStorageSafe()?.removeItem(leaseStorageKey(session, deviceId, sessionId));
}

function syncError(message, code, extra = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, extra);
  return error;
}

function networkGuard() {
  if (!isOnline()) {
    const error = syncError('当前处于离线状态，请联网后同步', 'OFFLINE');
    dispatch('cloud-sync:needs-network', { message: error.message, code: error.code });
    throw error;
  }
}

function passwordGuard(session, securityPassword = '') {
  const remembered = rememberedForSession(session);
  if (remembered?.rawKey) return remembered;
  if (String(securityPassword || '').length >= 8) return null;
  const error = syncError('该设备尚未解锁，请输入安全密码后同步', 'SECURITY_PASSWORD_REQUIRED');
  dispatch('cloud-sync:needs-security-password', { message: error.message, code: error.code });
  throw error;
}

async function decryptRemote(remote, session, securityPassword = '') {
  if (!remote?.encryptedEnvelope?.ciphertext) return null;
  const remembered = rememberedForSession(session);
  const secret = remembered?.rawKey ? `raw:${remembered.rawKey}` : securityPassword;
  const envelope = await decryptBackupEnvelope(remote.encryptedEnvelope, secret);
  if (!remembered?.rawKey && securityPassword) {
    await rememberKeyForEncryptedEnvelope(remote.encryptedEnvelope, securityPassword, {
      userId: session.userId,
      username: session.username,
      version: remote.revision ?? remote.version ?? null
    });
  }
  return envelope;
}

async function encryptLocal(envelope, session, securityPassword = '') {
  const remembered = rememberedForSession(session);
  const rememberedV3 = Boolean(remembered?.rawKey && remembered?.crypto?.wrappedDek);
  if (remembered?.rawKey && !rememberedV3 && !securityPassword) {
    throw syncError('本设备的旧密钥需要输入安全密码后升级，密钥不会上传服务器', 'SECURITY_PASSWORD_REQUIRED');
  }
  const encrypted = await encryptBackupEnvelope(envelope, securityPassword, {
    // v2 旧 raw key 没有 wrappedDek 时必须用密码重建 v3，避免新设备无法解密。
    rawKey: rememberedV3 ? remembered.rawKey : '',
    cryptoMeta: rememberedV3 ? remembered.crypto : null,
    rememberDevice: true
  });
  if (encrypted.rememberedKey) {
    saveRememberedKey(encrypted.rememberedKey, {
      userId: session.userId,
      username: session.username,
      version: encrypted.version,
      crypto: encrypted.crypto
    });
  }
  return encrypted;
}

function encryptedPayload(encrypted) {
  return {
    version: encrypted.version,
    source: encrypted.source,
    crypto: encrypted.crypto,
    meta: encrypted.meta,
    ciphertext: encrypted.ciphertext
  };
}

function localSignature(envelope) {
  const payload = envelope?.payload && typeof envelope.payload === 'object' ? envelope.payload : {};
  const keys = Object.keys(payload).sort();
  return JSON.stringify(keys.map((key) => [key, payload[key]]));
}

async function setAppliedState(state, remote, envelope, { direction = 'pull', revision = remote?.revision ?? remote?.version ?? 0 } = {}) {
  const signature = localSignature(envelope || { payload: {} });
  const hash = envelope ? await computeBackupContentHash(envelope) : '';
  lastObservedSignature = signature;
  return saveState({
    ...state,
    mode: 'v2',
    initialized: true,
    revision: Number(revision) || 0,
    appliedRevision: Number(revision) || 0,
    remoteRevision: Number(revision) || 0,
    updatedAt: remote?.updatedAt || state.updatedAt || '',
    remoteUpdatedAt: remote?.updatedAt || state.remoteUpdatedAt || '',
    remoteContentHash: remote?.contentHash || remote?.encryptedEnvelope?.meta?.contentHash || hash,
    appliedContentHash: remote?.contentHash || remote?.encryptedEnvelope?.meta?.contentHash || hash,
    localSignature: signature,
    uploadedSignature: signature,
    localKeyCount: envelope?.keyCount || 0,
    keyCount: envelope?.keyCount || 0,
    pendingUpload: false,
    direction
  });
}

async function applyRemoteSnapshot(remote, session, securityPassword, state = {}) {
  const envelope = await decryptRemote(remote, session, securityPassword);
  if (!envelope) return saveState({ ...state, mode: 'v2', initialized: true, revision: Number(remote?.revision) || 0, pendingUpload: false, direction: 'pull-empty' });
  suppressLocalObserver = true;
  try {
    applyBackupEnvelope(envelope, { wipePrefix: true });
  } finally {
    suppressLocalObserver = false;
  }
  return setAppliedState(state, remote, envelope, { direction: 'pull' });
}

async function registerCurrentDevice(session, envelope) {
  const end = currentEnd();
  const result = await registerSyncDevice({
    deviceId: end.id,
    deviceType: end.type,
    sessionId: end.sessionId,
    hasLocalData: hasMeaningfulLocalData(envelope),
    localSignature: localSignature(envelope)
  }, session);
  return { result, end };
}

async function fetchCurrentSnapshot(session, end = currentEnd()) {
  return fetchSyncV2Snapshot({ deviceId: end.id, deviceType: end.type, sessionId: end.sessionId }, session);
}

async function acquireWriter({ session, takeover = false, end = currentEnd() } = {}) {
  const existing = loadLease(session, end.id);
  if (existing && !takeover) return existing;
  try {
    const result = await acquireSyncWriter({ deviceId: end.id, deviceType: end.type, sessionId: end.sessionId, takeover }, session);
    const lease = saveLease(session, {
      ...result,
      writerToken: result.writerToken,
      deviceId: end.id,
      deviceType: end.type,
      sessionId: end.sessionId
    });
    const state = loadState();
    saveState({
      ...state,
      writerDeviceId: end.id,
      writerDeviceType: end.type,
      writerExpiresAt: lease.expiresAt,
      readOnly: false,
      readOnlyReason: '',
      revision: Number(result.revision) || Number(state.revision) || 0
    });
    dispatch('cloud-sync:writer-acquired', { lease, takeover: Boolean(takeover) });
    return lease;
  } catch (error) {
    if (error?.status === 409 && error?.data?.code === 'WRITER_BUSY') {
      const state = loadState();
      saveState({ ...state, readOnly: true, readOnlyReason: 'writer-busy', writer: error.data.writer || null });
      dispatch('cloud-sync:writer-required', { writer: error.data.writer || null, message: '当前设备是只读端，接管编辑权后才能保存数据' });
    }
    throw error;
  }
}

async function heartbeatCurrentWriter(session) {
  const end = currentEnd();
  const lease = loadLease(session, end.id);
  if (!lease) return null;
  try {
    const result = await heartbeatSyncWriter({ deviceId: end.id, sessionId: end.sessionId, writerToken: lease.writerToken }, session);
    const next = saveLease(session, { ...lease, ...result, writerToken: lease.writerToken });
    const state = loadState();
    saveState({ ...state, writerDeviceId: end.id, writerExpiresAt: next.expiresAt, readOnly: false, readOnlyReason: '' });
    return next;
  } catch (error) {
    clearLease(session, end.id);
    const state = loadState();
    saveState({ ...state, readOnly: true, readOnlyReason: 'writer-lease-lost', writerExpiresAt: '' });
    dispatch('cloud-sync:writer-lost', { message: error?.message || '编辑权已失效', code: error?.data?.code || error?.code || 'WRITER_LEASE_LOST' });
    return null;
  }
}

export async function releaseCurrentWriter(session = loadCloudSession()) {
  if (!session?.accessToken || !isOnline()) return false;
  const end = currentEnd();
  const lease = loadLease(session, end.id);
  if (!lease) return false;
  try {
    await releaseSyncWriter({ deviceId: end.id, sessionId: end.sessionId, writerToken: lease.writerToken }, session);
  } catch {
    // 会话关闭时租约自然过期，不阻塞退出。
  }
  clearLease(session, end.id);
  return true;
}

async function putLocalSnapshot({ session, securityPassword = '', baseRevision, envelope, state, migration = false } = {}) {
  const end = currentEnd();
  const lease = loadLease(session, end.id) || await acquireWriter({ session, end });
  const encrypted = await encryptLocal(envelope, session, securityPassword);
  let result;
  try {
    result = await putSyncV2Snapshot({
      deviceId: end.id,
      deviceType: end.type,
      sessionId: end.sessionId,
      writerToken: lease.writerToken,
      baseRevision: Number(baseRevision) || 0,
      migration,
      end,
      encryptedEnvelope: encryptedPayload(encrypted)
    }, session);
  } catch (error) {
    if (error?.status === 409 && ['WRITER_LEASE_LOST', 'REVISION_MISMATCH'].includes(error?.data?.code)) {
      clearLease(session, end.id);
      const nextState = loadState();
      saveState({ ...nextState, readOnly: true, readOnlyReason: error.data.code, writer: error.data.writer || null });
      dispatch('cloud-sync:writer-lost', { message: error.data.message || error.message, code: error.data.code, writer: error.data.writer || null });
    }
    throw error;
  }
  const nextState = await setAppliedState(state, result, envelope, { direction: migration ? 'migration-upload' : 'upload', revision: result.revision ?? result.version });
  dispatch('cloud-sync:auto-uploaded', { result, migration });
  return { ...result, state: nextState, encrypted };
}

async function migrateLegacyDevice({ session, securityPassword = '', rememberDevice = true, registration, snapshot, localEnvelope, state } = {}) {
  const localHasData = hasMeaningfulLocalData(localEnvelope);
  await startSyncDeviceMigration({ deviceId: currentEnd().id }, session);
  let merged = localEnvelope;
  if (snapshot.encryptedEnvelope?.ciphertext) {
    passwordGuard(session, securityPassword);
    const remoteEnvelope = await decryptRemote(snapshot, session, securityPassword);
    merged = localHasData ? mergeMigrationEnvelopes(remoteEnvelope, localEnvelope) : remoteEnvelope;
  }
  if (localHasData || !snapshot.encryptedEnvelope?.ciphertext) {
    passwordGuard(session, securityPassword);
    const lease = await acquireWriter({ session, end: currentEnd() });
    const uploaded = await putLocalSnapshot({
      session,
      securityPassword,
      baseRevision: snapshot.revision,
      envelope: merged,
      state,
      migration: true
    });
    snapshot = await fetchCurrentSnapshot(session);
    if (Number(snapshot.revision) !== Number(uploaded.revision)) {
      throw syncError('归集后校验失败，请保持联网并重试', 'MIGRATION_VERIFY_FAILED');
    }
    suppressLocalObserver = true;
    try { applyBackupEnvelope(merged, { wipePrefix: true }); } finally { suppressLocalObserver = false; }
    await completeSyncDeviceMigration({ deviceId: currentEnd().id, accountComplete: false }, session);
    const nextState = await setAppliedState(state, snapshot, merged, { direction: 'migration', revision: snapshot.revision });
    dispatch('cloud-sync:migration-completed', { device: registration?.device, revision: snapshot.revision });
    return { migrated: true, uploaded: true, pulled: false, revision: snapshot.revision, state: nextState, lease };
  }
  const nextState = await applyRemoteSnapshot(snapshot, session, securityPassword, state);
  await completeSyncDeviceMigration({ deviceId: currentEnd().id, accountComplete: false }, session);
  dispatch('cloud-sync:migration-completed', { device: registration?.device, revision: snapshot.revision });
  return { migrated: true, uploaded: false, pulled: true, revision: snapshot.revision, state: nextState };
}

export async function initializeCloudSync({ securityPassword = '', rememberDevice = true } = {}) {
  const session = loadCloudSession();
  if (!session?.accessToken) throw syncError('请先登录账户', 'AUTH_REQUIRED');
  networkGuard();
  const localEnvelope = buildBackupEnvelope();
  const persistedState = loadState();
  const state = persistedState.userId && persistedState.userId !== session.userId
    ? { userId: session.userId }
    : { ...persistedState, userId: session.userId };
  const registration = await registerCurrentDevice(session, localEnvelope);
  let snapshot = await fetchCurrentSnapshot(session, registration.end);
  if (registration.result?.device?.needsMigration) {
    return migrateLegacyDevice({ session, securityPassword, rememberDevice, registration: registration.result, snapshot, localEnvelope, state });
  }
  const localHasData = hasMeaningfulLocalData(localEnvelope);
  if (snapshot.encryptedEnvelope?.ciphertext && (!state.initialized || Number(snapshot.revision) > Number(state.revision || 0))) {
    passwordGuard(session, securityPassword);
    const applied = await applyRemoteSnapshot(snapshot, session, securityPassword, state);
    const result = saveState({
      ...applied,
      readOnly: Boolean(snapshot.writer && !snapshot.writer.isCurrentDevice),
      readOnlyReason: snapshot.writer && !snapshot.writer.isCurrentDevice ? 'writer-busy' : '',
      writer: snapshot.writer || null
    });
    await completeSyncDeviceMigration({ deviceId: registration.end.id, accountComplete: false }, session).catch(() => {});
    dispatch('cloud-sync:auto-restored', { result });
    return { pulled: true, uploaded: false, revision: snapshot.revision, state: result };
  }
  if (!snapshot.encryptedEnvelope?.ciphertext && localHasData) {
    passwordGuard(session, securityPassword);
    const uploaded = await putLocalSnapshot({ session, securityPassword, baseRevision: snapshot.revision, envelope: localEnvelope, state, migration: false });
    await completeSyncDeviceMigration({ deviceId: registration.end.id, accountComplete: false }, session).catch(() => {});
    return { pulled: false, uploaded: true, revision: uploaded.revision, state: uploaded.state };
  }
  const nextState = saveState({
    ...state,
    mode: 'v2',
    initialized: true,
    revision: Number(snapshot.revision) || 0,
    remoteRevision: Number(snapshot.revision) || 0,
    updatedAt: snapshot.updatedAt || '',
    remoteUpdatedAt: snapshot.updatedAt || '',
    remoteContentHash: snapshot.contentHash || '',
    localSignature: localSignature(localEnvelope),
    pendingUpload: false,
    readOnly: Boolean(snapshot.writer && !snapshot.writer.isCurrentDevice),
    writer: snapshot.writer || null,
    direction: 'check'
  });
  return { pulled: false, uploaded: false, revision: snapshot.revision, state: nextState, readOnly: nextState.readOnly };
}

export async function pullCloudSnapshot({ securityPassword = '', force = false } = {}) {
  const session = loadCloudSession();
  if (!session?.accessToken) throw syncError('请登录后同步', 'AUTH_REQUIRED');
  networkGuard();
  passwordGuard(session, securityPassword);
  const end = currentEnd();
  const snapshot = await fetchCurrentSnapshot(session, end);
  if (!snapshot.encryptedEnvelope?.ciphertext) {
    const state = saveState({ ...loadState(), mode: 'v2', initialized: true, revision: Number(snapshot.revision) || 0, direction: 'pull-empty' });
    return { pulled: false, empty: true, revision: snapshot.revision, state };
  }
  const appliedState = await applyRemoteSnapshot(snapshot, session, securityPassword, loadState());
  const state = saveState({
    ...appliedState,
    readOnly: Boolean(snapshot.writer && !snapshot.writer.isCurrentDevice),
    readOnlyReason: snapshot.writer && !snapshot.writer.isCurrentDevice ? 'writer-busy' : '',
    writer: snapshot.writer || null,
    pendingUpload: force ? false : appliedState.pendingUpload
  });
  dispatch('cloud-sync:auto-pulled', { result: state });
  return { pulled: true, revision: snapshot.revision, state };
}

export async function pushCloudSnapshot({ securityPassword = '', takeover = false, force = false } = {}) {
  const session = loadCloudSession();
  if (!session?.accessToken) throw syncError('请登录后同步', 'AUTH_REQUIRED');
  networkGuard();
  passwordGuard(session, securityPassword);
  const localEnvelope = buildBackupEnvelope();
  const state = loadState();
  const signature = localSignature(localEnvelope);
  if (!force && state.uploadedSignature === signature && state.pendingUpload !== true) {
    return { skipped: true, reason: 'unchanged-local-data', revision: state.revision || 0, state };
  }
  if (!force && state.readOnly === true && !loadLease(session, currentEnd().id, currentEnd().sessionId)) {
    const error = syncError('当前设备为只读端，请先接管编辑权后再保存', 'WRITER_REQUIRED', { writer: state.writer || null });
    dispatch('cloud-sync:writer-required', { writer: state.writer || null, message: error.message, code: error.code });
    throw error;
  }
  const end = currentEnd();
  const snapshot = await fetchCurrentSnapshot(session, end);
  const lease = loadLease(session, end.id);
  if (lease && Number(snapshot.revision) !== Number(state.revision || snapshot.revision)) {
    clearLease(session, end.id);
    const error = syncError('云端版本已变化，当前设备已切为只读，请先拉取', 'REVISION_MISMATCH', { data: { code: 'REVISION_MISMATCH', currentRevision: snapshot.revision } });
    dispatch('cloud-sync:writer-lost', { message: error.message, code: error.code });
    throw error;
  }
  const writer = await acquireWriter({ session, takeover, end });
  const uploaded = await putLocalSnapshot({
    session,
    securityPassword,
    baseRevision: snapshot.revision,
    envelope: localEnvelope,
    state,
    migration: false
  });
  return { ...uploaded, writer };
}

export async function syncNow({ securityPassword = '', takeover = false, reason = 'manual' } = {}) {
  const session = loadCloudSession();
  if (!session?.accessToken) {
    dispatch('cloud-sync:needs-login', { message: '请登录后同步', code: 'AUTH_REQUIRED' });
    throw syncError('请登录后同步', 'AUTH_REQUIRED');
  }
  networkGuard();
  const state = loadState();
  const localEnvelope = buildBackupEnvelope();
  const registration = await registerCurrentDevice(session, localEnvelope);
  const snapshot = await fetchCurrentSnapshot(session, registration.end);
  if (registration.result?.device?.needsMigration) {
    return migrateLegacyDevice({ session, securityPassword, registration: registration.result, snapshot, localEnvelope, state });
  }
  const signature = localSignature(localEnvelope);
  const localHasUnsavedChanges = Boolean(state.pendingUpload || (state.uploadedSignature && signature !== state.uploadedSignature));
  if (takeover && reason === 'takeover') {
    passwordGuard(session, securityPassword);
    return pushCloudSnapshot({ securityPassword, takeover: true, force: true });
  }
  if (snapshot.encryptedEnvelope?.ciphertext && (!state.initialized || Number(snapshot.revision) > Number(state.revision || 0))) {
    if (localHasUnsavedChanges && !takeover) {
      const error = syncError('本机还有未同步修改，请先接管编辑权或放弃本机修改', 'REVISION_MISMATCH', {
        data: { code: 'REVISION_MISMATCH', currentRevision: snapshot.revision }
      });
      saveState({ ...state, readOnly: true, readOnlyReason: 'local-unsaved', writer: snapshot.writer || null });
      dispatch('cloud-sync:writer-required', { message: error.message, code: error.code, writer: snapshot.writer || null });
      throw error;
    }
    passwordGuard(session, securityPassword);
    return pullCloudSnapshot({ securityPassword });
  }
  if (!snapshot.encryptedEnvelope?.ciphertext && !hasMeaningfulLocalData(localEnvelope) && !localHasUnsavedChanges && reason !== 'takeover') {
    const nextState = saveState({ ...state, mode: 'v2', initialized: true, revision: Number(snapshot.revision) || 0, remoteRevision: Number(snapshot.revision) || 0, direction: 'check-empty' });
    return { skipped: true, reason: 'empty-local-data', revision: snapshot.revision, state: nextState };
  }
  if (signature !== state.uploadedSignature || state.pendingUpload || reason === 'takeover') {
    passwordGuard(session, securityPassword);
    return pushCloudSnapshot({ securityPassword, takeover, force: reason === 'takeover' });
  }
  const nextState = saveState({ ...state, mode: 'v2', initialized: true, revision: Number(snapshot.revision) || 0, remoteRevision: Number(snapshot.revision) || 0, writer: snapshot.writer || null, readOnly: Boolean(snapshot.writer && !snapshot.writer.isCurrentDevice), direction: 'check' });
  return { skipped: true, reason: 'up-to-date', revision: snapshot.revision, state: nextState };
}

export async function takeOverEditing({ securityPassword = '' } = {}) {
  return syncNow({ securityPassword, takeover: true, reason: 'takeover' });
}

export function getSyncStatus() {
  const session = loadCloudSession();
  const end = currentEnd();
  const state = loadState();
  const remembered = rememberedForSession(session);
  const lease = session?.accessToken ? loadLease(session, end.id) : null;
  return {
    ...state,
    loggedIn: Boolean(session?.accessToken),
    hasRememberedKey: Boolean(remembered?.rawKey),
    deviceId: end.id,
    deviceType: end.type,
    isWriter: Boolean(lease),
    readOnly: state.readOnly === true || (!lease && Boolean(session?.accessToken)),
    online: isOnline()
  };
}

function observeLocalMutation() {
  if (suppressLocalObserver) return false;
  const envelope = buildBackupEnvelope();
  const signature = localSignature(envelope);
  if (signature === lastObservedSignature) return false;
  lastObservedSignature = signature;
  const state = loadState();
  saveState({ ...state, localSignature: signature, localKeyCount: envelope.keyCount, pendingUpload: true, direction: 'local-change' });
  return true;
}

export function scheduleCloudAutoUpload({ delay = AUTO_UPLOAD_DELAY, changed = true } = {}) {
  if (!changed || typeof window === 'undefined') return false;
  window.clearTimeout(uploadTimer);
  uploadTimer = window.setTimeout(async () => {
    if (uploadInFlight || pullInFlight) return;
    const session = loadCloudSession();
    if (!session?.accessToken) {
      dispatch('cloud-sync:needs-login', { message: '登录后同步', code: 'AUTH_REQUIRED' });
      return;
    }
    const currentState = loadState();
    if (currentState.readOnly) {
      try {
        await pullCloudSnapshot({ securityPassword: '', force: true });
      } catch (error) {
        dispatch('cloud-sync:auto-error', { message: error?.message || String(error), code: error?.data?.code || error?.code || '' });
      }
      return;
    }
    if (!rememberedForSession(session)?.rawKey) {
      dispatch('cloud-sync:needs-security-password', { message: '请输入安全密码后同步', code: 'SECURITY_PASSWORD_REQUIRED' });
      return;
    }
    if (!isOnline()) {
      dispatch('cloud-sync:needs-network', { message: '联网后同步', code: 'OFFLINE' });
      return;
    }
    uploadInFlight = true;
    dispatch('cloud-sync:auto-upload-started', {});
    try {
      await syncNow({ securityPassword: '', takeover: false, reason: 'auto-upload' });
    } catch (error) {
      dispatch('cloud-sync:auto-error', { message: error?.message || String(error), code: error?.data?.code || error?.code || '' });
    } finally {
      uploadInFlight = false;
    }
  }, delay);
  return true;
}

export function scheduleCloudAutoPull({ delay = AUTO_PULL_DELAY } = {}) {
  if (typeof window === 'undefined') return false;
  window.clearTimeout(pullTimer);
  pullTimer = window.setTimeout(async () => {
    if (uploadInFlight || pullInFlight || !isOnline()) return;
    const session = loadCloudSession();
    if (!session?.accessToken || !rememberedForSession(session)?.rawKey) return;
    pullInFlight = true;
    try {
      const localEnvelope = buildBackupEnvelope();
      const registration = await registerCurrentDevice(session, localEnvelope);
      if (registration.result?.device?.needsMigration) {
        await initializeCloudSync({ securityPassword: '' });
        return;
      }
      const end = registration.end;
      const remote = await fetchCurrentSnapshot(session, end);
      const state = loadState();
      if (!remote.encryptedEnvelope?.ciphertext || Number(remote.revision) <= Number(state.revision || 0)) return;
      const currentEnvelope = buildBackupEnvelope();
      const currentSignature = localSignature(currentEnvelope);
      if (state.pendingUpload || (state.uploadedSignature && currentSignature !== state.uploadedSignature)) {
        saveState({ ...state, readOnly: true, readOnlyReason: 'local-unsaved', writer: remote.writer || null });
        dispatch('cloud-sync:writer-required', { message: '本机还有未同步修改，请先接管编辑权或放弃本机修改', code: 'REVISION_MISMATCH', writer: remote.writer || null });
        return;
      }
      await pullCloudSnapshot({ securityPassword: '' });
    } catch (error) {
      dispatch('cloud-sync:auto-error', { message: error?.message || String(error), code: error?.data?.code || error?.code || '' });
    } finally {
      pullInFlight = false;
    }
  }, delay);
  return true;
}

async function heartbeatLoop() {
  const session = loadCloudSession();
  if (session?.accessToken && isOnline()) await heartbeatCurrentWriter(session);
}

export function startSyncCoordinator() {
  if (typeof window === 'undefined' || !window.localStorage || !window.Storage || started) return;
  started = true;
  const initial = buildBackupEnvelope();
  lastObservedSignature = localSignature(initial);
  const proto = window.Storage.prototype;
  originalSetItem = proto.setItem;
  originalRemoveItem = proto.removeItem;
  originalClear = proto.clear;
  proto.setItem = function patchedSetItem(key, value) {
    const before = this === window.localStorage && isBackupPayloadKey(key) ? this.getItem(key) : null;
    const result = originalSetItem.call(this, key, value);
    if (this === window.localStorage && isBackupPayloadKey(key) && before !== String(value)) {
      if (observeLocalMutation()) scheduleCloudAutoUpload({ changed: true });
    }
    return result;
  };
  proto.removeItem = function patchedRemoveItem(key) {
    const tracked = this === window.localStorage && isBackupPayloadKey(key);
    const hadValue = tracked && this.getItem(key) !== null;
    const result = originalRemoveItem.call(this, key);
    if (hadValue && observeLocalMutation()) scheduleCloudAutoUpload({ changed: true });
    return result;
  };
  proto.clear = function patchedClear() {
    const before = this === window.localStorage ? localSignature(buildBackupEnvelope()) : '';
    const result = originalClear.call(this);
    if (this === window.localStorage && before !== localSignature(buildBackupEnvelope()) && observeLocalMutation()) scheduleCloudAutoUpload({ changed: true });
    return result;
  };
  window.addEventListener('storage', (event) => {
    if (event.key && (isBackupPayloadKey(event.key) || TRANSIENT_SYNC_KEYS.has(event.key))) {
      if (isBackupPayloadKey(event.key)) scheduleCloudAutoPull({ delay: 0 });
    }
  });
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleCloudAutoPull();
  });
  window.addEventListener('focus', () => scheduleCloudAutoPull());
  window.addEventListener('online', () => {
    dispatch('cloud-sync:online', { message: '网络已恢复，可同步' });
    scheduleCloudAutoPull({ delay: 0 });
    scheduleCloudAutoUpload({ delay: 0, changed: Boolean(loadState().pendingUpload) });
  });
  heartbeatTimer = window.setInterval(() => { heartbeatLoop().catch(() => {}); }, WRITER_HEARTBEAT_DELAY);
  pullInterval = window.setInterval(() => scheduleCloudAutoPull({ delay: 0 }), AUTO_PULL_INTERVAL);
  const session = loadCloudSession();
  if (!session?.accessToken) dispatch('cloud-sync:needs-login', { message: '登录后同步', code: 'AUTH_REQUIRED' });
  else if (!rememberedForSession(session)?.rawKey) dispatch('cloud-sync:needs-security-password', { message: '请输入安全密码后同步', code: 'SECURITY_PASSWORD_REQUIRED' });
  else scheduleCloudAutoPull();
  return { heartbeatTimer, pullInterval };
}
