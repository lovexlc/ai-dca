import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readSource = (relativePath) => fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');

const holdingsSource = readSource('src/pages/HoldingsExperience.jsx');
const draftPanelSource = readSource('src/pages/holdings/TransactionDraftPanel.jsx');
const syncSource = readSource('src/app/holdingTransactionsSync.js');
const mutationSource = readSource('src/app/holdingTransactionMutations.js');

test('交易保存和删除等待云端接口完成，并接入全局用户处理中状态', () => {
  assert.match(holdingsSource, /persistHoldingTransactionMutation/);
  assert.match(mutationSource, /runAccountUserAction\(\{/);
  assert.match(mutationSource, /await pushHoldingTransactions\(\{ session, force: true, deletedIds \}\)/);
  assert.match(holdingsSource, /async function handleDeleteTransaction/);
  assert.match(draftPanelSource, /useAccountResourceBusy\('holdings\/ledger'\)/);
  assert.match(draftPanelSource, /const ok = await onDeleteTransaction\?\.\(draft\.id\)/);
  assert.match(draftPanelSource, /处理中…/);
});

test('主动删除交易会把明确的交易 id 传给同步器', () => {
  assert.match(syncSource, /deletedIds = \[\]/);
  assert.match(syncSource, /const requestedDeletedIds = new Set/);
  assert.match(syncSource, /const deletionIds = new Set\(\[\.\.\.\(previous\.knownIds \|\| \[\]\), \.\.\.requestedDeletedIds\]\)/);
  assert.match(syncSource, /const baseRevision = Number\(known\?\.revision \?\? remote\?\.revision \?\? 0\)/);
});
