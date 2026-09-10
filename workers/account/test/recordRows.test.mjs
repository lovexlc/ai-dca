import test from 'node:test';
import assert from 'node:assert/strict';
import { getResourceDescriptor } from '../src/catalog.js';
import {
  assembleResourceRows,
  splitResourceRows,
  META_RECORD_ID,
  SINGLETON_RECORD_ID
} from '../src/recordRows.js';

test('plans and DCA stores split each saved record into its own row', () => {
  const planDescriptor = getResourceDescriptor('plans/store');
  const planData = {
    source: 'test',
    version: 1,
    activePlanId: 'plan-2',
    plans: [{ id: 'plan-1', name: 'one' }, { id: 'plan-2', name: 'two' }]
  };
  const planRows = splitResourceRows(planDescriptor, planData);
  assert.deepEqual(planRows.map((row) => row.recordId), [META_RECORD_ID, 'plan-1', 'plan-2']);
  assert.deepEqual(assembleResourceRows(planDescriptor, planRows), planData);

  const dcaDescriptor = getResourceDescriptor('dca/store');
  const dcaData = { activeDcaId: 'dca-1', plans: [{ id: 'dca-1', symbol: 'QQQ' }] };
  const dcaRows = splitResourceRows(dcaDescriptor, dcaData);
  assert.deepEqual(dcaRows.map((row) => row.recordId), [META_RECORD_ID, 'dca-1']);
  assert.deepEqual(assembleResourceRows(dcaDescriptor, dcaRows), dcaData);
});

test('watchlist splits lists and individual market symbols', () => {
  const descriptor = getResourceDescriptor('markets/watchlist');
  const data = {
    activeListId: 'list-1',
    defaultsVersion: 9,
    lists: [{ id: 'list-1', name: '自选', us: ['AAPL'], cn: ['513100', '159941'] }],
    us: ['AAPL'],
    cn: ['513100', '159941']
  };
  const rows = splitResourceRows(descriptor, data);
  assert.ok(rows.some((row) => row.recordId === 'list-1'));
  assert.ok(rows.some((row) => row.recordId === 'list-1:cn:513100'));
  assert.ok(rows.some((row) => row.recordId === 'list-1:us:AAPL'));
  assert.deepEqual(assembleResourceRows(descriptor, rows), data);
});

test('switch rules split rule-code relations instead of embedding code arrays', () => {
  const descriptor = getResourceDescriptor('fund-switch/prefs');
  const data = {
    enabled: true,
    activeRuleId: 'rule-1',
    rules: [{ id: 'rule-1', name: '规则', benchmarkCodes: ['513100'], enabledCodes: ['159941'], premiumClass: { '159941': 'H' } }]
  };
  const rows = splitResourceRows(descriptor, data);
  const rule = rows.find((row) => row.recordId === 'rule-1');
  assert.deepEqual(rule.payload.benchmarkCodes, undefined);
  assert.ok(rows.some((row) => row.recordKind === 'relation' && row.recordId === 'rule-1:benchmark:513100'));
  assert.deepEqual(assembleResourceRows(descriptor, rows), data);
});

test('singleton resources remain exactly one record', () => {
  const descriptor = getResourceDescriptor('prefs/workspace');
  const data = { scenario: 'stock', homepageTab: 'markets' };
  const rows = splitResourceRows(descriptor, data);
  assert.deepEqual(rows.map((row) => row.recordId), [SINGLETON_RECORD_ID]);
  assert.deepEqual(assembleResourceRows(descriptor, rows), data);
});
