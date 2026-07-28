import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const scriptPath = path.resolve("scripts/reverse_taco_model.mjs");

function runExtractor(t, html) {
  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "reverse-taco-model-"),
  );
  t.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
  const htmlPath = path.join(temporaryDirectory, "page.html");
  const csvPath = path.join(temporaryDirectory, "history.csv");
  fs.writeFileSync(htmlPath, html);

  return {
    csvPath,
    result: spawnSync(
      process.execPath,
      [scriptPath, "--html", htmlPath, "--out", csvPath],
      { encoding: "utf8" },
    ),
  };
}

test("extracts and de-duplicates the escaped RSC score series", (t) => {
  const html = String.raw`
    {\"date\":\"2026-07-26\",\"score\":80}
    {\"date\":\"2026-07-27\",\"score\":81}
    {\"date\":\"2026-07-27\",\"score\":81}
  `;
  const { csvPath, result } = runExtractor(t, html);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    fs.readFileSync(csvPath, "utf8"),
    "date,score\n2026-07-26,80\n2026-07-27,81\n",
  );
});

test("rejects a score series with a missing calendar day", (t) => {
  const html = String.raw`
    {\"date\":\"2026-07-25\",\"score\":79}
    {\"date\":\"2026-07-27\",\"score\":81}
  `;
  const { result } = runExtractor(t, html);

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /Series is not daily: expected 2026-07-26, found 2026-07-27/,
  );
});
