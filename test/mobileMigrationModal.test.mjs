import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('migration dialog is a mobile bottom sheet above app navigation', () => {
  const source = read('src/components/account-data-migration-modal.jsx');
  assert.match(source, /overlayClassName="z-\[130\]/);
  assert.match(source, /bottom-0 top-auto z-\[140\] flex/);
  assert.match(source, /max-h-\[calc\(100dvh-0\.5rem\)\]/);
  assert.match(source, /sm:top-\[50%\]/);
  assert.match(source, /safe-area-inset-bottom/);
});

test('dialog content supports a custom overlay layer', () => {
  const source = read('src/components/ui/dialog.jsx');
  assert.match(source, /overlayClassName/);
  assert.match(source, /<DialogOverlay className=\{overlayClassName\}/);
});
