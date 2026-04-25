import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';

const root = process.cwd();
const distDir = resolve(root, process.env.REACT_DIST_DIR || 'frontend-dist');
const docsDir = resolve(root, 'docs');
const pageTemplatePath = resolve(distDir, 'frontend', 'page.html');
const distAssetsDir = resolve(distDir, 'react-assets');
const docsAssetsDir = resolve(docsDir, 'react-assets-v2');
const dataDir = resolve(root, 'data');
const docsDataDir = resolve(docsDir, 'data');
const holdingsCacheDir = resolve(dataDir, 'holdings-nav-cache');
const docsHoldingsCacheDir = resolve(docsDir, 'holdings-nav-cache');

if (!existsSync(pageTemplatePath)) {
  throw new Error(`Missing built page template: ${pageTemplatePath}`);
}
if (!existsSync(distAssetsDir)) {
  throw new Error(`Missing built assets directory: ${distAssetsDir}`);
}

// Single-page app: index.html mounts ScreenPage which always renders WorkspacePage.
// Tabs/views are switched via ?tab= and #hash. No more pages-v2/* or manifest.json.
const rootTemplate = readFileSync(pageTemplatePath, 'utf8').replaceAll('../react-assets/', './react-assets-v2/');
writeFileSync(resolve(docsDir, 'index.html'), rootTemplate, 'utf8');

// Clear legacy build artifacts produced by previous versions of this script.
rmSync(resolve(docsDir, 'pages-v2'), { recursive: true, force: true });
rmSync(resolve(docsDir, 'catalog.html'), { force: true });
rmSync(resolve(docsDir, 'manifest.json'), { force: true });
rmSync(resolve(docsDir, 'assets'), { recursive: true, force: true });
rmSync(resolve(docsDir, 'ocr'), { recursive: true, force: true });
rmSync(resolve(docsDir, 'screenshots'), { recursive: true, force: true });

rmSync(docsAssetsDir, { recursive: true, force: true });
cpSync(distAssetsDir, docsAssetsDir, { recursive: true, force: true });

function ignoreLocalPermissionError(error, label) {
  if (error && (error.code === 'EACCES' || error.code === 'EPERM')) {
    console.warn(`Skipping ${label}: ${error.code} ${error.path || ''}`.trim());
    return true;
  }
  return false;
}

mkdirSync(docsDataDir, { recursive: true });
if (existsSync(dataDir)) {
  try {
    cpSync(dataDir, docsDataDir, {
      recursive: true,
      force: true,
      filter: (source) => source !== holdingsCacheDir && !source.startsWith(`${holdingsCacheDir}${sep}`)
    });
  } catch (error) {
    if (!ignoreLocalPermissionError(error, 'docs/data sync')) {
      throw error;
    }
  }
}

rmSync(docsHoldingsCacheDir, { recursive: true, force: true });
if (existsSync(holdingsCacheDir)) {
  cpSync(holdingsCacheDir, docsHoldingsCacheDir, { recursive: true, force: true });
}

writeFileSync(resolve(docsDir, '.nojekyll'), '', 'utf8');
