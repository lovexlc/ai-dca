import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const notifySyncSource = await readFile(new URL('../src/app/notifySync.js', import.meta.url), 'utf8');
const resourceSource = await readFile(new URL('../workers/notify/src/accountResourceSettings.js', import.meta.url), 'utf8');
const deliverySource = await readFile(new URL('../workers/notify/src/accountDeliveryRoute.js', import.meta.url), 'utf8');
const statusSource = await readFile(new URL('../workers/notify/src/accountReadRoutes.js', import.meta.url), 'utf8');

test('notification channel writes use account resource item CRUD', () => {
  assert.match(notifySyncSource, /putAccountResourceItem\('notify\/client-config', 'channel:bark'/);
  assert.match(notifySyncSource, /putAccountResourceItem\('notify\/client-config', 'channel:serverchan3'/);
  assert.match(notifySyncSource, /deleteAccountResourceItem\('notify\/client-config', 'channel:bark'/);
  assert.match(notifySyncSource, /deleteAccountResourceItem\('notify\/client-config', 'channel:serverchan3'/);
  assert.equal(notifySyncSource.includes("requestNotify('/settings'"), false);
});

test('notify runtime reads account resource rows before legacy channel rows', () => {
  assert.match(resourceSource, /account_resource_records/);
  assert.match(deliverySource, /readAccountResourceNotifySettings/);
  assert.match(statusSource, /readAccountResourceNotifySettings/);
});
