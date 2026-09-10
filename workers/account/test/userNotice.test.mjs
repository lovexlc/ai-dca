import assert from "node:assert/strict";
import test from "node:test";

import {
  ACCOUNT_DATA_NOTICE_VERSION,
  normalizeAccountDataNotice,
  readAccountDataNotice,
  writeAccountDataNotice,
} from "../src/userNotice.js";

function createEnv() {
  const statements = [];
  const row = {
    noticeVersion: "",
    choice: "",
    updatedAt: "",
  };
  const DB = {
    prepare(sql) {
      const statement = {
        sql,
        values: [],
        bind(...values) {
          statement.values = values;
          return statement;
        },
        async run() {
          statements.push({ sql, values: statement.values });
          if (/^ALTER TABLE users/i.test(sql)) return { meta: { changes: 0 } };
          if (/UPDATE users SET/i.test(sql)) {
            [row.noticeVersion, row.choice, row.updatedAt] = statement.values;
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        },
        async first() {
          statements.push({ sql, values: statement.values });
          return { ...row };
        },
      };
      return statement;
    },
  };
  return { env: { DB }, statements, row };
}

test("normalizes only supported account-level choices", () => {
  assert.deepEqual(
    normalizeAccountDataNotice({
      account_data_notice_version: ACCOUNT_DATA_NOTICE_VERSION,
      account_data_notice_choice: "source",
      account_data_notice_updated_at: "2026-09-10T08:00:00.000Z",
    }),
    {
      noticeVersion: ACCOUNT_DATA_NOTICE_VERSION,
      choice: "source",
      updatedAt: "2026-09-10T08:00:00.000Z",
    },
  );
  assert.equal(normalizeAccountDataNotice({ choice: "unknown" }).choice, "");
});

test("writes and reads the choice on the users row", async () => {
  const { env, statements } = createEnv();
  const saved = await writeAccountDataNotice(env, "usr_1", {
    choice: "source",
    updatedAt: "2026-09-10T08:00:00.000Z",
  });
  assert.equal(saved.noticeVersion, ACCOUNT_DATA_NOTICE_VERSION);
  assert.equal(saved.choice, "source");
  const loaded = await readAccountDataNotice(env, "usr_1");
  assert.deepEqual(loaded, saved);
  const sql = statements.map((item) => item.sql).join("\n");
  assert.match(sql, /ALTER TABLE users ADD COLUMN account_data_notice_choice/);
  assert.match(sql, /UPDATE users SET/);
  assert.match(sql, /FROM users WHERE id = \?/);
});

test("rejects unsupported choices", async () => {
  const { env } = createEnv();
  await assert.rejects(
    () => writeAccountDataNotice(env, "usr_1", { choice: "later" }),
    (error) => error?.code === "INVALID_NOTICE_CHOICE",
  );
});
