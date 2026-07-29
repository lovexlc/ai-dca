import test from 'node:test';
import assert from 'node:assert/strict';

import { queryOtcFundListPage } from '../src/otcFundD1.js';

function createDb() {
  const statements = [];
  return {
    statements,
    prepare(sql) {
      return {
        bind(...bindings) {
          statements.push({ sql, bindings });
          return {
            all: async () => ({ results: [] }),
            first: async () => ({ n: 0 }),
          };
        },
      };
    },
  };
}

test('OTC D1 list pushes quota and seven-day redemption filters into SQL', async () => {
  const db = createDb();
  const result = await queryOtcFundListPage(db, {
    symbols: ['000001'],
    filters: [
      { field: 'quotaStatus', op: 'eq', value: 'buyable' },
      { field: 'redeem7d', op: 'eq', value: 'free' },
    ],
    limit: 20,
  });

  assert.equal(result.total, 0);
  assert.equal(db.statements.length, 2);
  const pageSql = db.statements.find((statement) => /LIMIT \?/.test(statement.sql))?.sql || '';
  assert.match(pageSql, /max_purchase_per_day/);
  assert.match(pageSql, /json_each/);
  assert.match(pageSql, /redeemRules/);
});
