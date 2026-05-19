import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve, sep } from 'node:path';

const root = process.cwd();
const distDir = resolve(root, process.env.REACT_DIST_DIR || 'frontend-dist');
const docsDir = resolve(root, 'docs');
const publicDir = resolve(root, 'public');
const pageTemplatePath = resolve(distDir, 'index.html');
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
const buildVersion = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 12);
const rootTemplate = readFileSync(pageTemplatePath, 'utf8')
  .replaceAll('./react-assets/', './react-assets-v2/')
  // Cache-bust: 去 hash 后文件名不再变，改用 ?v=<构建时间戳> 使浏览器拉取最新资源。
  .replace(/(\.\/react-assets-v2\/[^"']+\.(?:js|css))/g, `$1?v=${buildVersion}`);
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

// 静态资源：把 public/ 下的子目录/文件同步到 docs/。
// Vite 会把 public/* 复制到 distDir，但此脚本只转发 index.html + react-assets/，
// 如果不补上这一步，public/strategy-guide/*.png 这类静态资源会在 Pages 上 404。
if (existsSync(publicDir)) {
  for (const entry of readdirSync(publicDir)) {
    if (entry === 'index.html') continue;
    const sourcePath = join(publicDir, entry);
    const targetPath = join(docsDir, entry);
    try {
      const info = statSync(sourcePath);
      if (info.isDirectory()) {
        rmSync(targetPath, { recursive: true, force: true });
        cpSync(sourcePath, targetPath, { recursive: true, force: true });
      } else if (info.isFile()) {
        cpSync(sourcePath, targetPath, { force: true });
      }
    } catch (error) {
      if (!ignoreLocalPermissionError(error, `public/${entry} sync`)) {
        throw error;
      }
    }
  }
}

// Cache-bust dynamic chunk imports inside the JS bundles.
// 去 hash 后 chunk 互相 import 的字符串（如 "./HoldingsExperience.js" 与 __vite__mapDeps 里的
// 数组）不会随内容变化，浏览器/CDN 会缓存旧 chunk。这里统一追加 ?v=。
function rewriteChunkRefs(file) {
  const original = readFileSync(file, 'utf8');
  const next = original.replace(
    /("|')(\.\/[A-Za-z0-9_\-]+\.(?:js|css))\1/g,
    (match, quote, ref) => `${quote}${ref}?v=${buildVersion}${quote}`,
  );
  if (next !== original) writeFileSync(file, next, 'utf8');
}

function walkAndRewrite(dir) {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const info = statSync(fullPath);
    if (info.isDirectory()) {
      walkAndRewrite(fullPath);
    } else if (info.isFile() && fullPath.endsWith('.js')) {
      rewriteChunkRefs(fullPath);
    }
  }
}

walkAndRewrite(docsAssetsDir);

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
