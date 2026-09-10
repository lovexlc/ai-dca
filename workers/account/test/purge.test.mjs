import assert from "node:assert/strict";
import test from "node:test";

import { ACCOUNT_PURGE_CONFIRMATION, purgeAccountData } from "../src/purge.js";

test("purge confirmation token is explicit", () => {
  assert.equal(ACCOUNT_PURGE_CONFIRMATION, "DELETE_ALL_SYNC_DATA");
});

test("purge removes KV mirror and every account data table", async () => {
  const statements = [];
  const deletedKvKeys = [];
  const env = {
    SYNC_BACKUPS: {
      async delete(key) {
        deletedKvKeys.push(key);
      },
    },
    DB: {
      prepare(sql) {
        const entry = { sql, value: "" };
        return {
          bind(value) {
            entry.value = value;
            return {
              first: async () => ({ kvKey: "backup:usr_1" }),
              _entry: entry,
            };
          },
        };
      },
      async batch(items) {
        statements.push(...items.map((item) => item._entry));
        return items.map(() => ({ meta: { changes: 1 } }));
      },
    },
  };

  const result = await purgeAccountData(env, "usr_1");
  assert.deepEqual(deletedKvKeys, ["backup:usr_1"]);
  assert.equal(result.deletedRows, 7);
  assert.equal(statements.length, 7);
  assert.ok(statements.every((item) => item.value === "usr_1"));
  assert.match(
    statements.map((item) => item.sql).join("\n"),
    /DELETE FROM backups WHERE user_id = \?/,
  );
  assert.match(
    statements.map((item) => item.sql).join("\n"),
    /DELETE FROM account_resources WHERE user_id = \?/,
  );
  assert.match(
    statements.map((item) => item.sql).join("\n"),
    /DELETE FROM account_holdings_transactions WHERE user_id = \?/,
  );
});
