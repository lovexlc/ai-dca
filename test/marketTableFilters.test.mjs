import test from 'node:test';
import assert from 'node:assert/strict';
import {
  matchesTextFilterConditions,
  normalizeTextFilterConditions,
} from '../src/pages/markets/marketTableFilters.js';

test('text filters keep compatibility with a single string condition', () => {
  assert.deepEqual(normalizeTextFilterConditions(' 华夏 纳斯达克 '), ['华夏 纳斯达克']);
  assert.equal(matchesTextFilterConditions('华夏纳斯达克100', '纳斯达克'), true);
  assert.equal(matchesTextFilterConditions('华夏纳斯达克100', '标普'), false);
});

test('text filters require every configured condition to match', () => {
  assert.deepEqual(normalizeTextFilterConditions(['华夏', '', '纳斯达克']), ['华夏', '纳斯达克']);
  assert.equal(matchesTextFilterConditions('华夏纳斯达克100', ['华夏', '纳斯达克']), true);
  assert.equal(matchesTextFilterConditions('华夏标普500', ['华夏', '纳斯达克']), false);
  assert.equal(matchesTextFilterConditions('华夏纳斯达克100', []), true);
});
