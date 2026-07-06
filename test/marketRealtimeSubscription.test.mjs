import { test } from 'node:test';
import assert from 'node:assert/strict';

import { selectMarketRealtimeSymbols } from '../src/pages/markets/marketRealtimeSubscription.js';

test('market realtime subscription uses selected symbol in detail mode', () => {
  assert.deepEqual(selectMarketRealtimeSymbols({
    trackedWatchSymbols: ['513100', '159513'],
    requestedWatchSymbols: ['513100', '159513'],
    visibleWatchSymbols: ['513100'],
    selectedSymbol: ' 159513 ',
    fullTableMode: true,
  }), ['159513']);
});

test('market realtime subscription uses visible tracked rows in full table mode', () => {
  assert.deepEqual(selectMarketRealtimeSymbols({
    trackedWatchSymbols: ['513100', '159513'],
    requestedWatchSymbols: ['513100', '159513'],
    visibleWatchSymbols: ['513100', '999999', '513100'],
    selectedSymbol: '',
    fullTableMode: true,
  }), ['513100']);
});

test('market realtime subscription does not fall back to all tracked rows before visibility is known', () => {
  assert.deepEqual(selectMarketRealtimeSymbols({
    trackedWatchSymbols: ['513100', '159513'],
    requestedWatchSymbols: ['513100', '159513'],
    visibleWatchSymbols: [],
    selectedSymbol: '',
    fullTableMode: true,
  }), []);
});

test('market realtime subscription uses requested symbols in regular list mode', () => {
  assert.deepEqual(selectMarketRealtimeSymbols({
    trackedWatchSymbols: ['513100', '159513', '513100'],
    requestedWatchSymbols: ['513100', '159513', '513100'],
    visibleWatchSymbols: ['513100'],
    selectedSymbol: '',
    fullTableMode: false,
  }), ['513100', '159513']);
});
