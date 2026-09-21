import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const readSource = (relativePath) => fs.readFileSync(path.resolve(testDir, '..', relativePath), 'utf8');

const workspaceSource = readSource('src/pages/WorkspacePage.jsx');
const scenariosSource = readSource('src/app/scenarios.js');
const mobileNavSource = readSource('src/components/mobile-bottom-nav.jsx');

test('articles tab points to the cn article archive', () => {
  assert.match(workspaceSource, /const ARTICLES_URL = 'https:\/\/fast\.freebacktrack\.tech\/wechat\//);
  assert.match(workspaceSource, /key: ARTICLES_TAB_KEY, label: '文章', href: ARTICLES_URL/);
  assert.match(workspaceSource, /window\.location\.assign\(ARTICLES_URL\)/);
});

test('articles tab is visible in the cn scenario and mobile nav', () => {
  assert.match(scenariosSource, /visibleTabs: \[[^\]]*'articles'/);
  assert.match(mobileNavSource, /articles: BookOpen/);
});
