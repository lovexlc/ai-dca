import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseExcelPaste } from '../src/app/holdingsLedgerPaste.js';
import {
  isGhostTransaction,
  normalizeFundCode,
  sanitizeTransactions
} from '../src/app/holdingsLedgerBasics.js';
import { PRIMARY_TAB_ORDER, PRIMARY_TAB_META, createPageLinks } from '../src/app/screens.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const readSource = (relativePath) => fs.readFileSync(path.resolve(testDir, '..', relativePath), 'utf8');

test('normalizeFundCode rejects date strings and prevents ghost codes', () => {
  assert.equal(normalizeFundCode('2026-9-1'), '', 'YYYY-M-D 不得转化为伪基金代码');
  assert.equal(normalizeFundCode('2026-09-15'), '', 'YYYY-MM-DD 不得转化为伪基金代码');
  assert.equal(normalizeFundCode('2026/9/1'), '', 'YYYY/M/D 不得转化为伪基金代码');
  assert.equal(normalizeFundCode('2026/09/15'), '', 'YYYY/MM/DD 不得转化为伪基金代码');
  assert.equal(normalizeFundCode('2026.09.15'), '', 'YYYY.MM.DD 不得转化为伪基金代码');
  assert.equal(normalizeFundCode('2026年9月1日'), '', '中文日期不得转化为伪基金代码');

  // 正常 6 位数字代码应完整保留
  assert.equal(normalizeFundCode('270042'), '270042');
  assert.equal(normalizeFundCode('513100'), '513100');
  assert.equal(normalizeFundCode('000001'), '000001');
  assert.equal(normalizeFundCode(' 159632 '), '159632');
});

test('isGhostTransaction identifies ghost codes accurately', () => {
  assert.equal(isGhostTransaction({ code: '202691' }), true);
  assert.equal(isGhostTransaction({ code: '260901' }), true);
  assert.equal(isGhostTransaction({ code: '202609', date: '' }), true);
  assert.equal(isGhostTransaction({ code: '270042', date: '2026-09-15' }), false);
  assert.equal(isGhostTransaction({ code: '513100', date: '2026-09-16' }), false);
});

test('sanitizeTransactions automatically purges ghost transactions', () => {
  const input = [
    { id: '1', code: '270042', name: '广发纳斯达克100', type: 'BUY', date: '2026-09-15', price: 7.9888, shares: 10 },
    { id: 'ghost-1', code: '202691', name: '买入', type: 'BUY', date: '', price: 1, shares: 100 },
    { id: 'ghost-2', code: '260901', name: '买入', type: 'BUY', date: '', price: 1, shares: 100 },
    { id: '2', code: '513100', name: '纳指科技ETF', type: 'BUY', date: '2026-09-16', price: 2.22, shares: 500 }
  ];

  const cleaned = sanitizeTransactions(input);
  assert.equal(cleaned.length, 2, '应自动清洗剔除幽灵流水');
  assert.deepEqual(cleaned.map(t => t.code), ['270042', '513100']);
});

test('parseExcelPaste: heuristic inference handles headerless date-first data without generating 202691', () => {
  const pasteText = '2026-9-15\t270042\tQDII基金\t买入\t7.9888\t11.61';
  const result = parseExcelPaste(pasteText);

  assert.equal(result.rows.length, 1);
  const draft = result.rows[0].draft;
  assert.equal(draft.code, '270042', '代码应精准识别为 270042，绝不能是 202691');
  assert.equal(draft.date, '2026-09-15', '日期应精准识别为 2026-09-15');
  assert.equal(draft.type, 'BUY');
  assert.equal(draft.price, 7.9888);
  assert.equal(draft.shares, 11.61);
  assert.equal(draft.kind, 'qdii');
  assert.deepEqual(result.rows[0].errors, {});
});

test('parseExcelPaste: handles common broker export headers with amount support', () => {
  const pasteText = [
    '成交日期\t证券代码\t证券名称\t业务名称\t成交价\t成交金额',
    '2026-09-16\t513100\t纳指科技ETF\t买入\t2.0000\t1000'
  ].join('\n');

  const result = parseExcelPaste(pasteText);
  assert.equal(result.headerDetected, true);
  assert.equal(result.rows.length, 1);
  const draft = result.rows[0].draft;
  assert.equal(draft.code, '513100');
  assert.equal(draft.date, '2026-09-16');
  assert.equal(draft.type, 'BUY');
  assert.equal(draft.price, 2.0);
  assert.equal(draft.amount, 1000);
  assert.equal(draft.shares, 500, '应根据成交金额与成交价自动推导出 500 份额');
});

test('DataRepair tab and buttons are properly integrated across screens', () => {
  // screens.js
  assert.ok(PRIMARY_TAB_ORDER.includes('dataRepair'), 'PRIMARY_TAB_ORDER 需收录 dataRepair');
  assert.equal(PRIMARY_TAB_META.dataRepair?.label, '数据修复');
  const links = createPageLinks();
  assert.ok(links.dataRepair.includes('tab=dataRepair'));

  // WorkspacePage.jsx
  const workspaceSource = readSource('src/pages/WorkspacePage.jsx');
  assert.match(workspaceSource, /DataRepairExperience/);
  assert.match(workspaceSource, /case 'dataRepair':/);
  assert.match(workspaceSource, /dataRepair:\s*Wrench/);

  // IncomeSummary.jsx
  const incomeSummarySource = readSource('src/app/income/IncomeSummary.jsx');
  assert.match(incomeSummarySource, /quickActions\.onDataRepair/);
  assert.match(incomeSummarySource, /<span>数据修复<\/span>/);

  // HoldingsOverviewShell.jsx
  const shellSource = readSource('src/pages/holdings/HoldingsOverviewShell.jsx');
  assert.match(shellSource, /onInstallDemoData,/);
  assert.match(shellSource, /onInstallDemoData=\{onInstallDemoData\}/);
});

