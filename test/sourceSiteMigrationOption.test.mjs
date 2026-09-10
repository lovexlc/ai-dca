import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(
  path.join(root, "src/components/account-data-migration-modal.jsx"),
  "utf8",
);

test("migration notice offers the source site as a third option", () => {
  assert.match(source, /title="使用源站"/);
  assert.match(source, /https:\/\/freebacktrack\.tech/);
  assert.match(source, /window\.location\.assign\(SOURCE_SITE_URL\)/);
  assert.match(source, /mode === ["']source["']/);
});

test("notice explains holdings privacy and the source-site deadline", () => {
  assert.match(
    source,
    /包括持仓数据在内的账号数据不再由安全密码进行端到端强加密/,
  );
  assert.match(source, /不会售卖您的持仓数据/);
  assert.match(source, /不会将其用于服务端分析、用户画像或广告用途/);
  assert.match(source, /请选择清空或切回源站使用/);
  assert.match(source, /源站暂时保留现有同步方式/);
  assert.match(source, /30\s*天后迁移至未加密逻辑/);
});
