import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("migration choice is stored on the authenticated users row", () => {
  const actions = read("src/app/accountDataMigrationActions.js");
  const modal = read("src/components/account-data-migration-modal.jsx");
  const entry = read("workers/account/src/entry.js");
  const userNotice = read("workers/account/src/userNotice.js");

  assert.match(actions, /\/user\/data-notice/);
  assert.match(actions, /fetchAccountDataNotice/);
  assert.match(actions, /saveAccountDataNoticeChoice/);
  assert.doesNotMatch(actions, /accountDataNoticeSeenKey/);
  assert.doesNotMatch(actions, /markAccountDataNoticeSeen/);

  assert.match(modal, /fetchAccountDataNotice/);
  assert.match(modal, /saveAccountDataNoticeChoice\('migrate', session\)/);
  assert.match(modal, /saveAccountDataNoticeChoice\('source', session\)/);
  assert.match(modal, /hasSeenAccountDataNotice\(dataNotice\)/);
  assert.ok(
    modal.indexOf("saveAccountDataNoticeChoice('source', session)") <
      modal.indexOf("window.location.assign(SOURCE_SITE_URL)"),
  );

  assert.match(entry, /DATA_NOTICE_PATH/);
  assert.match(entry, /choice: "clear"/);
  assert.match(userNotice, /ALTER TABLE users ADD COLUMN account_data_notice_choice/);
  assert.match(userNotice, /UPDATE users SET/);
  assert.match(userNotice, /FROM users WHERE id = \?/);
});
