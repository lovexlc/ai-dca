import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { hashToken } from '../workers/notify/src/accountSettingsRoute.js';

const routeSource = await readFile(new URL('../workers/notify/src/accountSettingsRoute.js', import.meta.url), 'utf8');
const entrySource = await readFile(new URL('../workers/notify/src/accountEntry.js', import.meta.url), 'utf8');

test('account settings fast path is routed before the legacy aggregate worker', () => {
  const fastRoute = entrySource.indexOf("url.pathname === '/api/notify/settings'");
  const legacyFetch = entrySource.indexOf('notifyWorker.fetch(request, env, ctx)');
  assert.ok(fastRoute >= 0);
  assert.ok(legacyFetch > fastRoute);
});

test('account settings fast path does not call aggregate settings storage', () => {
  assert.equal(routeSource.includes('readSettings('), false);
  assert.equal(routeSource.includes('writeSettings('), false);
  assert.ok(routeSource.includes('notify_channel_bindings'));
  assert.ok(routeSource.includes("record_type = 'client-channel'"));
});

test('channel tokens use deterministic hashes and are not logged', async () => {
  const token = 'test-only-not-a-real-token';
  const first = await hashToken(token);
  const second = await hashToken(token);
  assert.equal(first, second);
  assert.equal(first.length, 64);
  assert.notEqual(first, token);
  assert.equal(routeSource.includes("console.log('[notify-settings-timing]'"), true);
  assert.equal(routeSource.includes('JSON.stringify({ totalMs: Date.now() - startedAt, ...marks, conflicts: conflicts.length, cleared: deletes.length })'), true);
});

test('same-account historical channel rows are removed on save', () => {
  assert.ok(routeSource.includes("record_id LIKE '%::bark'"));
  assert.ok(routeSource.includes("record_id LIKE '%::serverchan3'"));
  assert.ok(routeSource.includes('record_id != ?'));
});

test('ServerChan rebind requires matching SendKey', () => {
  assert.ok(routeSource.includes("oldServer.sendKey !== serverChan3.sendKey"));
  assert.ok(routeSource.includes('CHANNEL_BINDING_MISMATCH'));
  assert.ok(routeSource.includes("rebindChannel !== 'serverchan3'"));
});
