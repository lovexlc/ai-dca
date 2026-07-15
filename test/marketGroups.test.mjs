import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BASE_COLUMNS,
  DEFAULT_MARKET_COLUMNS,
} from '../src/pages/markets/marketColumns.js';
import { loadMarketGroups, normalizeMarketGroup } from '../src/pages/markets/marketGroups.js';

test('normalizeMarketGroup repairs a persisted group missing base columns', () => {
  const normalized = normalizeMarketGroup({ id: 'cn-etf', columns: ['kind'] });

  assert.deepEqual(normalized.columns, DEFAULT_MARKET_COLUMNS);
});

test('normalizeMarketGroup preserves intentional optional column choices after base columns are present', () => {
  const baseColumns = BASE_COLUMNS.map((column) => column.id);
  const normalized = normalizeMarketGroup({ id: 'cn-etf', columns: [...baseColumns, 'premium'] });

  assert.deepEqual(normalized.columns, [...baseColumns, 'premium']);
});

test('loadMarketGroups persists repaired legacy column selections', () => {
  const values = new Map([
    ['markets:groups:v1', JSON.stringify({
      groups: [{ id: 'cn-etf', name: '场内基金', market: 'cn', sourceListId: 'default', columns: ['kind'] }],
      activeGroupId: 'cn-etf',
    })],
  ]);
  const previousStorage = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };

  try {
    loadMarketGroups();
    const stored = JSON.parse(values.get('markets:groups:v1'));
    assert.deepEqual(stored.groups[0].columns, DEFAULT_MARKET_COLUMNS);
  } finally {
    if (previousStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousStorage;
  }
});
