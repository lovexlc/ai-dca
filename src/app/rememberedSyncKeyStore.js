const DB_NAME = 'aiDcaSecureSyncV2';
const STORE_NAME = 'deviceKeys';
const memoryKeys = new Map();

function hasIndexedDb() {
  return typeof indexedDB !== 'undefined' && typeof indexedDB.open === 'function';
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'userId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('无法打开设备密钥存储'));
  });
}

export async function loadRememberedSyncKey(userId) {
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId) return null;
  if (!hasIndexedDb()) return memoryKeys.get(normalizedUserId) || null;
  let db;
  try {
    db = await openDatabase();
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).get(normalizedUserId);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error('无法读取设备密钥'));
    });
  } catch {
    return memoryKeys.get(normalizedUserId) || null;
  } finally {
    db?.close();
  }
}

export async function saveRememberedSyncKey(userId, key, cryptoMeta) {
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId || !key || !cryptoMeta) return;
  const record = { userId: normalizedUserId, key, cryptoMeta, savedAt: new Date().toISOString() };
  memoryKeys.set(normalizedUserId, record);
  if (!hasIndexedDb()) return;
  let db;
  try {
    db = await openDatabase();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put(record);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error('无法保存设备密钥'));
      transaction.onabort = () => reject(transaction.error || new Error('无法保存设备密钥'));
    });
  } catch {
    // The in-memory copy remains usable for this login. Do not fall back to
    // localStorage because the device key must never become exportable text.
  } finally {
    db?.close();
  }
}

export async function clearRememberedSyncKeys() {
  memoryKeys.clear();
  if (!hasIndexedDb()) return;
  let db;
  try {
    db = await openDatabase();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).clear();
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error('无法清理设备密钥'));
      transaction.onabort = () => reject(transaction.error || new Error('无法清理设备密钥'));
    });
  } catch {
    // Clearing the in-memory copy is still better than retaining a key in the
    // current page when the browser storage is unavailable.
  } finally {
    db?.close();
  }
}
