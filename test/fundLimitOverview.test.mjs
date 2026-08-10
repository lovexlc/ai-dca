import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildFundLimitOverview,
  buildFundLimitPolicy,
  diffFundLimitOverviews
} from '../workers/ocr-proxy/src/fundLimitOverview.js';

function policy({
  code,
  name,
  text,
  amount = 1000,
  status = 'limit_large',
  effectiveDate = '2026-08-01',
  limitChannel = null
}) {
  return buildFundLimitPolicy({
    record: {
      code,
      buyStatus: status,
      maxPurchasePerDay: amount,
      sourceTitle: '调整大额申购业务限制的公告',
      effectiveDate,
      limitChannel
    },
    preset: { symbol: code, name },
    rawRuleText: text,
    now: new Date('2026-08-10T02:00:00.000Z')
  });
}

const combinedText = '自2026年8月1日起，单日单个基金账户在全部销售机构累计申购本基金A类基金份额和C类基金份额的金额不超过1000元，申请金额予以合计。';
const separateText = '自2026年8月1日起，单日单个基金账户在全部销售机构累计申购本基金A类、C类基金份额，每类基金份额申请金额单独计算，金额不超过1000元。';
const directText = '自2026年8月1日起，单日单个基金账户在本公司直销渠道累计申购本基金A类、C类基金份额，每类基金份额申请金额单独计算，金额不超过1000元。';

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

test('personal-only limits are eligible while institutional-only limits require review', () => {
  const personal = policy({
    code: '000003',
    name: '示例个人投资人民币A',
    text: '自2026年8月1日起，个人投资者单日单个基金账户在全部销售机构累计申购本基金A类、C类基金份额，每类基金份额申请金额单独计算，金额不超过1000元。'
  });
  const institutional = policy({
    code: '000004',
    name: '示例机构投资人民币A',
    text: '自2026年8月1日起，机构投资者单日单个基金账户在全部销售机构累计申购本基金A类、C类基金份额，每类基金份额申请金额单独计算，金额不超过1000元。'
  });

  assert.equal(personal.investorScope, 'personal');
  assert.equal(personal.eligible, true);
  assert.equal(institutional.investorScope, 'institutional');
  assert.equal(institutional.eligible, false);
  assert.ok(institutional.reviewReasons.includes('investor_scope_not_eligible'));
});

test('single-order limits and future-effective rules are not counted as current daily quota', () => {
  const singleOrder = policy({
    code: '000005',
    name: '示例单笔人民币A',
    text: '自2026年8月1日起，单日单笔申购本基金，每类基金份额申请金额单独计算，金额不超过1000元，仅在本公司直销渠道办理。'
  });
  const pending = policy({
    code: '000006',
    name: '示例待生效人民币A',
    text: separateText,
    effectiveDate: '2026-08-11'
  });

  assert.equal(singleOrder.limitPeriod, 'single_transaction');
  assert.equal(singleOrder.eligible, false);
  assert.ok(singleOrder.reviewReasons.includes('not_daily_cumulative'));
  assert.equal(pending.isPending, true);
  assert.equal(pending.eligible, false);
});

test('CNY and USD totals stay separate', () => {
  const overview = buildFundLimitOverview({
    policies: [
      policy({ code: '000007', name: '示例全球配置人民币A', text: separateText, amount: 1000 }),
      policy({ code: '000008', name: '示例全球配置美元A', text: separateText, amount: 200 })
    ]
  });

  assert.equal(overview.summary.totalByCurrency.CNY, 1000);
  assert.equal(overview.summary.totalByCurrency.USD, 200);
});

test('quota changes emit tighten, suspend, resume, and scope-change events', () => {
  const active = policy({ code: '000009', name: '示例事件人民币A', text: directText, amount: 1000 });
  const tightened = policy({ code: '000009', name: '示例事件人民币A', text: directText, amount: 500 });
  const suspended = policy({ code: '000009', name: '示例事件人民币A', text: directText, amount: null, status: 'suspended' });
  const allSales = policy({ code: '000009', name: '示例事件人民币A', text: separateText, amount: 1000 });

  const initial = buildFundLimitOverview({ policies: [active], asOf: '2026-08-08T12:00:00.000Z' });
  const lower = buildFundLimitOverview({ policies: [tightened], asOf: '2026-08-09T12:00:00.000Z' });
  const stopped = buildFundLimitOverview({ policies: [suspended], asOf: '2026-08-10T12:00:00.000Z' });
  const resumed = buildFundLimitOverview({ policies: [active], asOf: '2026-08-11T12:00:00.000Z' });
  const scopeChanged = buildFundLimitOverview({ policies: [allSales], asOf: '2026-08-12T12:00:00.000Z' });

  assert.equal(diffFundLimitOverviews(initial, lower).find((event) => event.type === 'tighten')?.after.limitAmount, 500);
  assert.ok(diffFundLimitOverviews(lower, stopped).some((event) => event.type === 'suspend'));
  assert.ok(diffFundLimitOverviews(stopped, resumed).some((event) => event.type === 'resume'));
  assert.ok(diffFundLimitOverviews(resumed, scopeChanged).some((event) => event.type === 'scope_changed'));
});
