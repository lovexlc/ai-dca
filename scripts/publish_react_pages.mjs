import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const distDir = resolve(root, 'frontend-dist');
const docsDir = resolve(root, 'docs');
const distPageCandidates = [
  resolve(distDir, 'pages'),
  resolve(distDir, 'frontend')
];
const distAssetsDir = resolve(distDir, 'react-assets');
const docsPagesDir = resolve(docsDir, 'pages');
const docsAssetsDir = resolve(docsDir, 'react-assets');
const distPagesDir = distPageCandidates.find((dir) => existsSync(dir));

if (!distPagesDir) {
  throw new Error(`Missing built pages directory. Checked: ${distPageCandidates.join(', ')}`);
}

mkdirSync(docsPagesDir, { recursive: true });
for (const fileName of readdirSync(distPagesDir)) {
  if (!fileName.endsWith('.html')) {
    continue;
  }
  copyFileSync(resolve(distPagesDir, fileName), resolve(docsPagesDir, fileName));
}

if (existsSync(distAssetsDir)) {
  rmSync(docsAssetsDir, { recursive: true, force: true });
  cpSync(distAssetsDir, docsAssetsDir, { recursive: true, force: true });
}
