import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const componentSource = fs.readFileSync(path.resolve(testDir, '../src/components/brand-preview-bar.jsx'), 'utf8');
const notifySource = fs.readFileSync(path.resolve(testDir, '../src/components/notify-popover.jsx'), 'utf8');

test('mobile header exposes test-style notification, account, and navigation actions', () => {
  assert.match(componentSource, /<NotifyPopover\s*\/>/);
  assert.match(componentSource, /aria-label="账户"/);
  assert.match(componentSource, /className="app-header__menu-button"/);
  assert.match(componentSource, /onClick=\{onOpenNav\}/);
});

test('notification popover loads records and keeps links inside cn notification tab', () => {
  assert.match(notifySource, /loadNotifyEvents/);
  assert.match(notifySource, /tab=notify/);
  assert.match(notifySource, /section=config/);
  assert.match(notifySource, /section=rules/);
});
