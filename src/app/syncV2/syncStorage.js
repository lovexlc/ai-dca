const DB_NAME = 'aiDcaSyncV2';
const STORE_NAME = 'state';

function localStorageSafe() {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  return window.localStorage;
}

function canUseIndexedDb() {
  return typeof indexedDB !== 'undefined';
}

function openDb() {
  if (!canUseIndexedDb()) return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

export async function readSyncState(key) {
  const db = await openDb();
  if (db) {
    const value = await new Promise((resolve) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => resolve(null);
    });
    db.close();
    if (value != null) return value;
  }
  const ls = localStorageSafe();
  if (!ls) return null;
  try { return JSON.parse(ls.getItem(key) || 'null'); } catch { return null; }
}

export async function writeSyncState(key, value) {
  const db = await openDb();
  if (db) {
    await new Promise((resolve) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put(value, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
      transaction.onabort = () => resolve();
    });
    db.close();
  }
  const ls = localStorageSafe();
  if (ls) {
    try { ls.setItem(key, JSON.stringify(value)); } catch { /* IndexedDB remains the primary store. */ }
  }
  return value;
}

export async function deleteSyncState(key) {
  const db = await openDb();
  if (db) {
    await new Promise((resolve) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).delete(key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
      transaction.onabort = () => resolve();
    });
    db.close();
  }
  localStorageSafe()?.removeItem(key);
}
