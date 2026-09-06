import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentFile = fileURLToPath(import.meta.url);
const workspacePagePath = path.resolve(path.dirname(currentFile), '../src/pages/WorkspacePage.jsx');
const workspacePageSource = fs.readFileSync(workspacePagePath, 'utf8');

test('workspace page wires active tab and select handler to mobile bottom nav', () => {
  assert.match(workspacePageSource, /<MobileBottomNav[\s\S]*activeKey=\{activeTab\}/);
  assert.match(workspacePageSource, /<MobileBottomNav[\s\S]*onSelectTab=\{handleSelectTab\}/);
});

test('workspace page reuses current scenario visible tab list for mobile bottom nav', () => {
  assert.match(workspacePageSource, /<MobileBottomNav[\s\S]*visibleTabs=\{currentScenario\.visibleTabs\}/);
});
