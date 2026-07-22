import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  installPreloadErrorRecovery,
  preloadErrorRecoveryInternals
} from '../src/app/preloadErrorRecovery.js';

function createWindow() {
  const listeners = new Map();
  const values = new Map();
  let reloadCount = 0;
  return {
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
    sessionStorage: {
      getItem(key) {
        return values.has(key) ? values.get(key) : null;
      },
      setItem(key, value) {
        values.set(key, value);
      }
    },
    location: {
      reload() {
        reloadCount += 1;
      }
    },
    dispatch(type, event) {
      listeners.get(type)?.(event);
    },
    get reloadCount() {
      return reloadCount;
    },
    get listenerCount() {
      return listeners.size;
    },
    values
  };
}

test('preload recovery reloads once and suppresses the first chunk error', () => {
  const windowRef = createWindow();
  let prevented = 0;
  const cleanup = installPreloadErrorRecovery({ windowRef, now: () => 1_000 });

  windowRef.dispatch('vite:preloadError', { preventDefault: () => { prevented += 1; } });

  assert.equal(windowRef.reloadCount, 1);
  assert.equal(prevented, 1);
  assert.equal(windowRef.values.get(preloadErrorRecoveryInternals.storageKey), '1000');
  cleanup();
  assert.equal(windowRef.listenerCount, 0);
});

test('preload recovery does not enter a reload loop during the cooldown', () => {
  const windowRef = createWindow();
  let nowMs = 1_000;
  let prevented = 0;
  installPreloadErrorRecovery({ windowRef, now: () => nowMs });

  windowRef.dispatch('vite:preloadError', { preventDefault: () => { prevented += 1; } });
  nowMs += preloadErrorRecoveryInternals.cooldownMs - 1;
  windowRef.dispatch('vite:preloadError', { preventDefault: () => { prevented += 1; } });

  assert.equal(windowRef.reloadCount, 1);
  assert.equal(prevented, 1);

  nowMs += 2;
  windowRef.dispatch('vite:preloadError', { preventDefault: () => { prevented += 1; } });
  assert.equal(windowRef.reloadCount, 2);
  assert.equal(prevented, 2);
});

test('preload recovery skips reload when session storage is unavailable', () => {
  const windowRef = createWindow();
  Object.defineProperty(windowRef, 'sessionStorage', {
    get() {
      throw new Error('blocked');
    }
  });
  let prevented = 0;
  installPreloadErrorRecovery({ windowRef, now: () => 1_000 });

  windowRef.dispatch('vite:preloadError', { preventDefault: () => { prevented += 1; } });

  assert.equal(windowRef.reloadCount, 0);
  assert.equal(prevented, 0);
});
