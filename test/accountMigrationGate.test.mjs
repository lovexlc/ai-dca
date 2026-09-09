import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  fetchAccountManifest,
  normalizeLegacyMigrationStatus
} from '../src/app/accountApi.js';
import { fetchHoldingTransactionRows } from '../src/app/holdingTransactionsApi.js';
import { fetchLatestCloudBackup } from '../src/app/authClient.js';

const session = { accessToken: 'test-token', username: 'alice' };

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

async function withMockFetch(handler, run) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: String(init.method || 'GET').toUpperCase() });
    return handler(String(url), init, calls.length - 1);
  };
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = original;
  }
}

test('pending without legacy ciphertext is normalized to no-legacy', () => {
  assert.deepEqual(
    normalizeLegacyMigrationStatus({ status: 'pending', legacy: { exists: false } }),
    { status: 'no-legacy', legacy: { exists: false }, needsMigration: false }
  );
});

test('manifest always checks migration status first', async () => {
  await withMockFetch((url) => {
    if (url.endsWith('/migrations/legacy')) return jsonResponse({ status: 'imported', legacy: { exists: true } });
    if (url.endsWith('/manifest')) return jsonResponse({ resources: [], serverTime: 'now' });
    throw new Error(`unexpected request: ${url}`);
  }, async (calls) => {
    const result = await fetchAccountManifest(session);
    assert.deepEqual(result.resources, []);
    assert.equal(calls.length, 2);
    assert.match(calls[0].url, /\/api\/account\/v1\/migrations\/legacy$/);
    assert.match(calls[1].url, /\/api\/account\/v1\/manifest$/);
  });
});

test('pending legacy blocks manifest before any new resource request', async () => {
  await withMockFetch((url) => {
    if (url.endsWith('/migrations/legacy')) {
      return jsonResponse({ status: 'pending', legacy: { exists: true, cryptoKind: 'password' } });
    }
    throw new Error(`new resource request must not run: ${url}`);
  }, async (calls) => {
    await assert.rejects(
      () => fetchAccountManifest(session),
      (error) => error?.code === 'LEGACY_MIGRATION_REQUIRED'
    );
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/migrations\/legacy$/);
  });
});

test('holding transaction rows also check migration before items endpoint', async () => {
  await withMockFetch((url) => {
    if (url.endsWith('/migrations/legacy')) return jsonResponse({ status: 'skipped', legacy: { exists: true } });
    if (url.includes('/holdings/ledger/items?')) return jsonResponse({ rows: [], nextCursor: '' });
    throw new Error(`unexpected request: ${url}`);
  }, async (calls) => {
    const result = await fetchHoldingTransactionRows({}, session);
    assert.deepEqual(result.rows, []);
    assert.equal(calls.length, 2);
    assert.match(calls[0].url, /\/migrations\/legacy$/);
    assert.match(calls[1].url, /\/holdings\/ledger\/items\?/);
  });
});

test('old sync latest is reachable only after a fresh pending+legacy check', async () => {
  await withMockFetch((url) => {
    if (url.endsWith('/api/account/v1/migrations/legacy')) {
      return jsonResponse({ status: 'pending', legacy: { exists: true, cryptoKind: 'password' } });
    }
    if (url.endsWith('/api/sync/latest')) {
      return jsonResponse({ version: 7, encryptedEnvelope: { ciphertext: 'cipher' } });
    }
    throw new Error(`unexpected request: ${url}`);
  }, async (calls) => {
    const result = await fetchLatestCloudBackup(session);
    assert.equal(result.version, 7);
    assert.equal(calls.length, 2);
    assert.match(calls[0].url, /\/api\/account\/v1\/migrations\/legacy$/);
    assert.match(calls[1].url, /\/api\/sync\/latest$/);
  });
});

test('settled migration never falls back to old sync latest', async () => {
  await withMockFetch((url) => {
    if (url.endsWith('/api/account/v1/migrations/legacy')) {
      return jsonResponse({ status: 'imported', legacy: { exists: true } });
    }
    throw new Error(`old sync endpoint must not run: ${url}`);
  }, async (calls) => {
    await assert.rejects(
      () => fetchLatestCloudBackup(session),
      (error) => error?.code === 'LEGACY_MIGRATION_NOT_REQUIRED'
    );
    assert.equal(calls.length, 1);
  });
});
