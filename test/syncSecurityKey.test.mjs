import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearRememberedKey,
  loadRememberedKey,
  saveRememberedKey
} from '../src/app/secureVault.js';

class MemoryStorage {
  constructor() { this.values = new Map(); }
  get length() { return this.values.size; }
  key(index) { return [...this.values.keys()][index] || null; }
  getItem(key) { return this.values.has(String(key)) ? this.values.get(String(key)) : null; }
  setItem(key, value) { this.values.set(String(key), String(value)); }
  removeItem(key) { this.values.delete(String(key)); }
}

test('remembered DEK is scoped to the logged-in account and never falls back across users', () => {
  const previousWindow = globalThis.window;
  const localStorage = new MemoryStorage();
  globalThis.window = { localStorage };
  try {
    saveRememberedKey('dek-user-a', { userId: 'user-a', username: 'alice' });
    assert.equal(loadRememberedKey({ userId: 'user-a' })?.rawKey, 'dek-user-a');
    assert.equal(loadRememberedKey({ userId: 'user-b' }), null);
    assert.equal(loadRememberedKey({ username: 'alice' })?.rawKey, 'dek-user-a');
    assert.equal(loadRememberedKey({ username: 'bob' }), null);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
test('corrupt remembered key is ignored and global clear removes scoped keys', () => {
  const previousWindow = globalThis.window;
  const localStorage = new MemoryStorage();
  globalThis.window = { localStorage };
  try {
    localStorage.setItem('aiDcaSecureSyncRememberedKey:user-a', '{bad-json');
    assert.equal(loadRememberedKey({ userId: 'user-a' }), null);
    saveRememberedKey('dek-user-a', { userId: 'user-a' });
    saveRememberedKey('dek-user-b', { userId: 'user-b' });
    assert.ok(localStorage.length >= 3);
    clearRememberedKey();
    assert.equal(localStorage.length, 0);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
