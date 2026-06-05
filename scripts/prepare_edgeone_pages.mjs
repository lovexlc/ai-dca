import { cpSync, existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const outputDir = resolve(root, process.env.EDGEONE_OUTPUT_DIR || '.edgeone-pages');
const dataDir = resolve(root, 'data');
const outputDataDir = resolve(outputDir, 'data');

if (!existsSync(outputDir)) {
  throw new Error(`Missing EdgeOne output directory: ${outputDir}`);
}

if (existsSync(dataDir)) {
  rmSync(outputDataDir, { recursive: true, force: true });
  cpSync(dataDir, outputDataDir, {
    recursive: true,
    force: true,
    filter(source) {
      return !source.includes('/holdings-nav-cache');
    }
  });
}
