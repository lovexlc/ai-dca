import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const readSource = (relativePath) => fs.readFileSync(path.resolve(testDir, '..', relativePath), 'utf8');

const incomeSummarySource = readSource('src/app/income/IncomeSummary.jsx');
const holdingsSource = readSource('src/pages/HoldingsExperience.jsx');
const shellSource = readSource('src/pages/holdings/HoldingsOverviewShell.jsx');
const modalSource = readSource('src/pages/holdings/TransactionImportModals.jsx');

test('desktop holdings actions expose the Excel paste entry', () => {
  assert.match(incomeSummarySource, /quickActions\.onPasteExcel/);
  assert.match(incomeSummarySource, /onClick=\{quickActions\.onPasteExcel\}/);
  assert.match(incomeSummarySource, /title="从 Excel 粘贴交易流水"/);
  assert.match(incomeSummarySource, /<span>Excel 粘贴<\/span>/);
  assert.match(incomeSummarySource, /ReceiptText/);
});

test('Excel paste entry remains wired to parser, preview, and import flow', () => {
  assert.match(holdingsSource, /onPasteExcel: openPasteModal/);
  assert.match(holdingsSource, /const result = parseExcelPaste\(text\)/);
  assert.match(shellSource, /<PasteImportModal/);
  assert.match(modalSource, /从 Excel 粘贴交易流水/);
  assert.match(modalSource, /解析预览/);
  assert.match(modalSource, /导入有效行/);
});

test('mobile holdings keeps the Excel paste action in the FAB', () => {
  assert.match(shellSource, /label: 'Excel 粘贴'/);
  assert.match(shellSource, /onClick: quickActions\.onPasteExcel/);
});
