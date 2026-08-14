import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Meet workbook Chromium gate owns a production build server lifecycle", () => {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const config = readFileSync(new URL("../playwright.config.ts", import.meta.url), "utf8");
  const spec = readFileSync(new URL("../tests/e2e/meet-workbook.spec.ts", import.meta.url), "utf8");
  assert.match(packageJson.scripts["test:meet:workbook:e2e"] ?? "", /RR3_MEET_WORKBOOK_GATE=1/u);
  assert.match(config, /RR3_MEET_WORKBOOK_GATE/u);
  assert.doesNotMatch(spec, /test\.skip/u);
});
