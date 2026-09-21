import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const readSource = (relativePath) => fs.readFileSync(path.resolve(testDir, '..', relativePath), 'utf8');

const screensSource = readSource('src/app/screens.js');
const workspaceSource = readSource('src/pages/WorkspacePage.jsx');
const articlePageSource = readSource('src/pages/ArticlesExperience.jsx');
const scenariosSource = readSource('src/app/scenarios.js');
const mobileNavSource = readSource('src/components/mobile-bottom-nav.jsx');

test('articles is an internal workspace tab', () => {
  assert.match(screensSource, /articles: \{ label: '文章', hrefKey: 'articles' \}/);
  assert.match(screensSource, /articles: .*hrefKey: 'articles'/);
  assert.match(workspaceSource, /case 'articles':[\s\S]*<ArticlesExperience/);
  assert.doesNotMatch(workspaceSource, /window\.location\.assign\([^)]*wechat/);
});

test('articles page embeds the cn article archive', () => {
  assert.match(articlePageSource, /const ARTICLES_URL = 'https:\/\/fast\.freebacktrack\.tech\/wechat\//);
  assert.match(articlePageSource, /<iframe/);
  assert.match(articlePageSource, /src=\{ARTICLES_URL\}/);
  assert.match(articlePageSource, /公众号历史文章/);
});

test('articles tab is visible in the cn scenario and mobile nav', () => {
  assert.match(scenariosSource, /visibleTabs: \[[^\]]*'articles'/);
  assert.match(mobileNavSource, /articles: BookOpen/);
});
