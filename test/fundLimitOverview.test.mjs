import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildFundLimitOverview,
  buildFundLimitPolicy,
  diffFundLimitOverviews
} from '../workers/ocr-proxy/src/fundLimitOverview.js';

function policy({ code, name, text, amount = 1000, status = 'limit_large' }) {
  return buildFundLimitPolicy({
    record: {
      code,
      buyStatus: status,
      maxPurchasePerDay: amount,
      sourceTitle: '调整大额申购业务限制的公告',
      effectiveDate: '2026-08-01'
    },
    preset: { symbol: code, name },
    rawRuleText: text,
    now: new Date('2026-08-10T02:00:00.000Z')
  });
}

const combinedText = '自2026年8月1日起，单日单个基金账户在全部销售机构累计申购本基金A类基金份额和C类基金份额的金额不超过1000元，申请金额予以合计。';
const separateText = '自2026年8月1日起，单日单个基金账户在全部销售机构累计申购本基金A类、C类基金份额，每类基金份额申请金额单独计算，金额不超过1000元。';

test('combined A/C quota is counted once', () => {
  const overview = buildFundLimitOverview({
    policies: [
      policy({ code: '000001', name: '示例纳指联接人民币A', text: combinedText }),
      policy({ code: '000002', name: '示例纳指联接人民币C', text: combinedText })
    ],
    asOf: '2026-08-10T02:00:00.000Z'
  });

  assert.equal(overview.quotaGroups.length, 1);
  assert.equal(overview.summary.totalByCurrency.CNY, 1000);
  assert.deepEqual(overview.quotaGroups[0].codes, ['000001', '000002']);
});

test('per-class A/C quota is counted separately', () => {
  const overview = buildFundLimitOverview({
    policies: [
      policy({ code: '000001', name: '示例纳指联接人民币A', text: separateText }),
      policy({ code: '000002', name: '示例纳指联接人民币C', text: separateText })
    ],
    asOf: '2026-08-10T02:00:00.000Z'
  });

  assert.equal(overview.quotaGroups.length, 2);
  assert.equal(overview.summary.totalByCurrency.CNY, 2000);
});

test('ambiguous share scope is excluded from the aggregate', () => {
  const item = policy({
    code: '000001',
    name: '示例纳指联接人民币A',
    text: '自2026年8月1日起，单日单个基金账户累计申购本基金金额不超过1000元。'
  });
  const overview = buildFundLimitOverview({ policies: [item] });

  assert.equal(item.eligible, false);
  assert.equal(overview.summary.totalByCurrency.CNY, undefined);
  assert.ok(item.reviewReasons.includes('share_scope_not_confirmed'));
});

test('lower daily quota produces a tighten event', () => {
  const previous = buildFundLimitOverview({
    policies: [policy({ code: '000001', name: '示例纳指联接人民币A', text: separateText, amount: 1000 })],
    asOf: '2026-08-09T12:00:00.000Z'
  });
  const current = buildFundLimitOverview({
    policies: [policy({ code: '000001', name: '示例纳指联接人民币A', text: separateText, amount: 500 })],
    asOf: '2026-08-10T12:00:00.000Z'
  });
  const events = diffFundLimitOverviews(previous, current);

  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'tighten');
  assert.equal(events[0].before.limitAmount, 1000);
  assert.equal(events[0].after.limitAmount, 500);
});
