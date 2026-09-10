import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("cn entry mounts the account data migration notice", () => {
  const entry = read("src/entry-screen.jsx");
  assert.match(entry, /AccountDataMigrationModal/);
  assert.match(entry, /<AccountDataMigrationModal \/>/);
});

test("notice explains the new security boundary and offers both decisions", () => {
  const source = read("src/components/account-data-migration-modal.jsx");
  assert.match(source, /不再由安全密码进行端到端强加密/);
  assert.match(source, /传输仍使用\s*HTTPS/);
  assert.match(source, /迁移并继续使用/);
  assert.match(source, /不迁移，清空数据/);
  assert.match(source, /安全密码不会上传服务器/);
  assert.match(source, /删除全部数据/);
  assert.match(source, /isCnMigrationNoticeHost/);
});

test("destructive path requires explicit confirmation and calls the purge endpoint", () => {
  const actions = read("src/app/accountDataMigrationActions.js");
  assert.match(actions, /DELETE_ALL_SYNC_DATA/);
  assert.match(actions, /\/migrations\/legacy\/discard/);
  assert.match(actions, /purgeAccountLocalStorageKeys/);
});

test("account worker wrapper owns the purge route and legacy KV binding", () => {
  const worker = read("workers/account/src/entry.js");
  const config = read("workers/account/wrangler.toml");
  assert.match(worker, /\/api\/account\/v1\/migrations\/legacy\/discard/);
  assert.match(worker, /ACCOUNT_PURGE_CONFIRMATION/);
  assert.match(config, /main = "src\/entry\.js"/);
  assert.match(config, /binding = "SYNC_BACKUPS"/);
});
