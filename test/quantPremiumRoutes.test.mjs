import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  QUANT_PREMIUM_CONFIG_PREFIX,
  buildQuantPremiumSwitchConfig,
  normalizeQuantPremiumConfig
} from '../workers/notify/src/quantPremiumRoutes.js';
import { quantPremiumPaperStateKey } from '../workers/notify/src/premiumPaperTrading.js';
import { getRunnableSwitchRules } from '../workers/notify/src/switchStrategy.js';

test('quant premium config normalizes arbitrary H/L symbols without holdings', () => {
  const config = normalizeQuantPremiumConfig({
    enabled: true,
    highCodes: '159513, 513100',
    lowCodes: '159501 159513 513100',
    activeSide: 'all',
    intraSellLowerPct: '0.8',
    intraBuyOtherPct: '4.2'
  });

  assert.deepEqual(config.highCodes, ['159513', '513100']);
  assert.deepEqual(config.lowCodes, ['159501']);
  assert.equal(config.activeSide, 'all');
  assert.equal(config.intraSellLowerPct, 0.8);
  assert.equal(config.intraBuyOtherPct, 4.2);

  const switchConfig = buildQuantPremiumSwitchConfig(config);
  assert.equal(switchConfig.enabled, true);
  assert.deepEqual(switchConfig.benchmarkCodes, ['159513', '513100', '159501']);
  assert.deepEqual(switchConfig.enabledCodes, []);
  assert.equal(switchConfig.premiumClass['159513'], 'H');
  assert.equal(switchConfig.premiumClass['159501'], 'L');
  assert.equal(getRunnableSwitchRules(switchConfig).length, 1);
});

test('quant premium state keys are isolated from holding switch keys', () => {
  assert.equal(QUANT_PREMIUM_CONFIG_PREFIX, 'quant:premium:config:');
  assert.equal(quantPremiumPaperStateKey('client-a'), 'quant:premium:paper:state:client-a');
  assert.equal(quantPremiumPaperStateKey('client-a').startsWith('switch:'), false);
});
