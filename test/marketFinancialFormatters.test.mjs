import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  detailValueRow,
  formatCnAmount,
  formatCnMoney,
  formatFinancialCompact,
  formatRevenue,
  formatXueqiuDateMs,
} from '../src/pages/markets/marketFinancialFormatters.js';

test('market financial formatters keep CN display units stable', () => {
  assert.equal(formatRevenue(12345), '1.23 万');
  assert.equal(formatCnMoney(123456789), '1.23 亿');
  assert.equal(formatCnAmount(null), '--');
  assert.equal(formatFinancialCompact(1234567890), '1.23B');
  assert.deepEqual(detailValueRow('市值', '1.23 亿', 'tone'), { label: '市值', value: '1.23 亿', className: 'tone' });
});

test('market financial formatter renders Xueqiu millisecond dates in Shanghai timezone', () => {
  assert.equal(formatXueqiuDateMs(0), '--');
  assert.equal(formatXueqiuDateMs(Date.parse('2026-05-01T00:00:00+08:00')), '2026/5/1');
});
