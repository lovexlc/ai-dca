import test from 'node:test';
import assert from 'node:assert/strict';

import {
  filterExchangeSwitchHoldings,
  normalizeManualSwitchCode,
  normalizeManualSwitchCodeInput
} from '../src/pages/switchStrategy/switchStrategyHoldings.js';

test('switch plans only offer exchange-traded holdings', () => {
  const holdings = [
    { code: '513100', kind: 'exchange' },
    { code: '000834', kind: 'otc' },
    { code: '021000', kind: 'qdii' },
    { code: '000001' }
  ];

  assert.deepEqual(filterExchangeSwitchHoldings(holdings), [holdings[0]]);
});

test('switch holding filter handles invalid input', () => {
  assert.deepEqual(filterExchangeSwitchHoldings(null), []);
});

test('manual switch code normalizes pasted exchange prefixes and full-width digits', () => {
  assert.equal(normalizeManualSwitchCodeInput('sh１５９５０１'), '159501');
  assert.equal(normalizeManualSwitchCode('159501'), '159501');
  assert.equal(normalizeManualSwitchCode('15950'), '');
});
