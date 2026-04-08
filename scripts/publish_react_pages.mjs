import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HOME_SCREEN_ID, buildSiteManifest, screens } from '../src/app/screens.js';

const root = process.cwd();
const distDir = resolve(root, process.env.REACT_DIST_DIR || 'frontend-dist');
const docsDir = resolve(root, 'docs');
const pageTemplatePath = resolve(distDir, 'frontend', 'page.html');
const catalogPath = resolve(distDir, 'frontend', 'catalog.html');
const distAssetsDir = resolve(distDir, 'react-assets');
const docsPagesDir = resolve(docsDir, 'pages-v2');
const docsAssetsDir = resolve(docsDir, 'react-assets-v2');
const dataDir = resolve(root, 'data');
const holdingsCacheDir = resolve(dataDir, 'holdings-nav-cache');
const docsHoldingsCacheDir = resolve(docsDir, 'holdings-nav-cache');

if (!existsSync(pageTemplatePath)) {
  throw new Error(`Missing built page template: ${pageTemplatePath}`);
}

if (!existsSync(catalogPath)) {
  throw new Error(`Missing built catalog page: ${catalogPath}`);
}

if (!existsSync(distAssetsDir)) {
  throw new Error(`Missing built assets directory: ${distAssetsDir}`);
}

const baseTemplate = readFileSync(pageTemplatePath, 'utf8');
const pageScriptLine = "window.__SCREEN_ID__ = '__SCREEN_ID__';";
const withScreenId = (html, screenId) => html.replace(pageScriptLine, `window.__SCREEN_ID__ = '${screenId}';`);
const nestedTemplate = baseTemplate.replaceAll('../react-assets/', '../react-assets-v2/');
const rootTemplate = baseTemplate.replaceAll('../react-assets/', './react-assets-v2/');
const rootCatalog = readFileSync(catalogPath, 'utf8').replaceAll('../react-assets/', './react-assets-v2/');

rmSync(docsPagesDir, { recursive: true, force: true });
mkdirSync(docsPagesDir, { recursive: true });

for (const screen of screens) {
  if (screen.id === HOME_SCREEN_ID) {
    continue;
  }
  writeFileSync(resolve(docsPagesDir, `${screen.id}.html`), withScreenId(nestedTemplate, screen.id), 'utf8');
}

writeFileSync(resolve(docsDir, 'index.html'), withScreenId(rootTemplate, HOME_SCREEN_ID), 'utf8');
writeFileSync(resolve(docsDir, 'catalog.html'), rootCatalog, 'utf8');

rmSync(docsAssetsDir, { recursive: true, force: true });
cpSync(distAssetsDir, docsAssetsDir, { recursive: true, force: true });

rmSync(docsHoldingsCacheDir, { recursive: true, force: true });
if (existsSync(holdingsCacheDir)) {
  cpSync(holdingsCacheDir, docsHoldingsCacheDir, { recursive: true, force: true });
}

rmSync(resolve(docsDir, 'assets'), { recursive: true, force: true });
rmSync(resolve(docsDir, 'ocr'), { recursive: true, force: true });
rmSync(resolve(docsDir, 'screenshots'), { recursive: true, force: true });

writeFileSync(resolve(docsDir, 'manifest.json'), `${JSON.stringify(buildSiteManifest(), null, 2)}
`, 'utf8');
writeFileSync(resolve(docsDir, '.nojekyll'), '', 'utf8');
