import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isChinaMarketHoliday,
  isTradingDayShanghai,
  getShanghaiDateParts,
} from '../src/holdingsNavSupport.js';
import {
  evaluateMarketAlertRules,
  evaluateHoldingAlertRules,
} from '../src/alertRuleEvaluation.js';

const HOLIDAY_NOON = new Date('2026-10-02T10:00:00+08:00'); // 国庆休市日盘中
const TRADING_NOON = new Date('2026-09-30T10:00:00+08:00'); // 正常交易日盘中

test('2026 国庆 10/1–10/7 每天都是 A 股休市日', () => {
  for (let d = 1; d <= 7; d++) {
    const ds = `2026-10-0${d}`;
    assert.equal(isChinaMarketHoliday(ds), true, ds);
    assert.equal(isTradingDayShanghai(ds), false, ds);
  }
});

test('国庆前后交易日不受影响', () => {
  assert.equal(isChinaMarketHoliday('2026-09-30'), false);
  assert.equal(isTradingDayShanghai('2026-09-30'), true);
  assert.equal(isTradingDayShanghai('2026-10-08'), true);
  assert.equal(getShanghaiDateParts(HOLIDAY_NOON).date, '2026-10-02');
});

const exchangeRule = {
  ruleId: 'r1', symbol: '159655', fundKind: 'exchange',
  alertType: 'premium', threshold: 8,
};

function mockEnv() {
  let calls = 0;
  const env = {
    MARKETS: {
      fetch: async () => {
        calls += 1;
        return new Response(JSON.stringify({ items: [] }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      },
    },
  };
  return { env, calls: () => calls };
}

test('休市日：场内规则被跳过且 reason=market-holiday（不请求行情）', async () => {
  const { env, calls } = mockEnv();
  const res = await evaluateMarketAlertRules(env, [exchangeRule], { now: HOLIDAY_NOON });
  assert.deepEqual(res.delivered, []);
  assert.equal(res.skipped.length, 1);
  assert.equal(res.skipped[0].reason, 'market-holiday');
  assert.equal(calls(), 0, '休市日不应发起行情请求');
});

test('正常交易日：场内规则不被节假日门禁拦截（行为不变）', async () => {
  const { env, calls } = mockEnv();
  const res = await evaluateMarketAlertRules(env, [exchangeRule], { now: TRADING_NOON });
  // 规则进入评估流程（mock 返回空数据 → no-market-data），证明没被 preSkipped
  const preSkipped = (res.skipped || []).filter((s) => s.reason === 'market-holiday');
  assert.equal(preSkipped.length, 0);
  assert.equal(calls(), 1, '交易日应正常请求行情');
});

test('休市日：持仓预警直接跳过（不跑过期净值）', async () => {
  const { env, calls } = mockEnv();
  const res = await evaluateHoldingAlertRules(env, [
    { ruleId: 'h1', symbol: '159655', alertType: 'gain', threshold: 5, holdingCost: 1 },
  ], { now: HOLIDAY_NOON });
  assert.equal(res.skipped, 'market-holiday');
  assert.equal(calls(), 0, '休市日不应发起行情请求');
});
