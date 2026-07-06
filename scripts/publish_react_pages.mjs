import {
  cpSync,
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

const root = process.cwd();
const distDir = resolve(root, process.env.REACT_DIST_DIR || 'frontend-dist');
const docsDir = resolve(root, 'docs');
const publicDir = resolve(root, 'public');
const pageTemplatePath = resolve(distDir, 'index.html');
const distAssetsDir = resolve(distDir, 'react-assets');
const docsAssetsDir = resolve(docsDir, 'react-assets-v2');

if (!existsSync(pageTemplatePath)) {
  throw new Error(`Missing built page template: ${pageTemplatePath}`);
}
if (!existsSync(distAssetsDir)) {
  throw new Error(`Missing built assets directory: ${distAssetsDir}`);
}

// Single-page app: index.html mounts ScreenPage which always renders WorkspacePage.
// Tabs/views are switched via ?tab= and #hash. No more pages-v2/* or manifest.json.
const rootTemplate = readFileSync(pageTemplatePath, 'utf8')
  .replaceAll('./react-assets/', './react-assets-v2/');
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

function ignoreLocalPermissionError(error, label) {
  if (error && (error.code === 'EACCES' || error.code === 'EPERM')) {
    console.warn(`Skipping ${label}: ${error.code} ${error.path || ''}`.trim());
    return true;
  }
  return false;
}

writeFileSync(resolve(docsDir, '.nojekyll'), '', 'utf8');
