import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import * as verifier from "./verify-meet-migrations.mjs";

const root = path.resolve(import.meta.dirname, "..");
const migrationsDir = path.join(root, "supabase", "migrations");
const fixtures = JSON.parse(
  await readFile(path.join(import.meta.dirname, "fixtures", "meet-migrations-negative.json"), "utf8"),
);
const reviewFixtures = JSON.parse(
  await readFile(path.join(import.meta.dirname, "fixtures", "meet-review-negative.json"), "utf8"),
);
const reviewRound2Fixtures = JSON.parse(
  await readFile(path.join(import.meta.dirname, "fixtures", "meet-review-round2-negative.json"), "utf8"),
);
const reviewRound3Fixtures = JSON.parse(
  await readFile(path.join(import.meta.dirname, "fixtures", "meet-review-round3-negative.json"), "utf8"),
);

test("accepts the checked-in Meet migration security contract", async () => {
  const result = await verifier.verifyMeetMigrations(migrationsDir);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(result.schemaVersion, 6);
});

for (const fixture of fixtures) {
  test(`rejects ${fixture.name}`, async () => {
    const temporary = await mkdtemp(path.join(tmpdir(), "rr3-meet-migrations-"));
    try {
      for (const fileName of [
        "202608140001_meet_core.sql",
        "202608140002_meet_rls.sql",
        "202608140003_meet_commands.sql",
        "202608140004_meet_review_hardening.sql",
        "202608140005_meet_ranking_and_access_hardening.sql",
        "202608140006_meet_preliminary_and_identity_hardening.sql",
      ]) {
        const original = await readFile(path.join(migrationsDir, fileName), "utf8");
        const mutated = fileName === fixture.file
          ? replaceExactlyOnce(original, fixture.find, fixture.replace, fixture.name)
          : original;
        await writeFile(path.join(temporary, fileName), mutated, "utf8");
      }

      const result = await verifier.verifyMeetMigrations(temporary);
      assert.equal(result.ok, false);
      assert.ok(
        result.issues.some((issue) => issue.code === fixture.expectedCode),
        `${fixture.name} should report ${fixture.expectedCode}; got ${JSON.stringify(result.issues)}`,
      );
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });
}

for (const fixture of reviewFixtures) {
  test(`review invariant rejects ${fixture.name}`, () => {
    assert.equal(typeof verifier.verifyReviewInvariant, "function", "review invariant verifier must be exported");
    const issues = verifier.verifyReviewInvariant(fixture.sql);
    assert.ok(
      issues.some((issue) => issue.code === fixture.expectedCode),
      `${fixture.name} should report ${fixture.expectedCode}; got ${JSON.stringify(issues)}`,
    );
  });
}

for (const fixture of reviewRound2Fixtures) {
  test(`review round 2 invariant rejects ${fixture.name}`, () => {
    assert.equal(typeof verifier.verifyReviewRound2Invariant, "function", "review round 2 verifier must be exported");
    const issues = verifier.verifyReviewRound2Invariant(fixture.sql);
    assert.ok(
      issues.some((issue) => issue.code === fixture.expectedCode),
      `${fixture.name} should report ${fixture.expectedCode}; got ${JSON.stringify(issues)}`,
    );
  });
}

for (const fixture of reviewRound3Fixtures) {
  test(`review round 3 invariant rejects ${fixture.name}`, () => {
    assert.equal(typeof verifier.verifyReviewRound3Invariant, "function", "review round 3 verifier must be exported");
    const issues = verifier.verifyReviewRound3Invariant(fixture.sql);
    assert.ok(
      issues.some((issue) => issue.code === fixture.expectedCode),
      `${fixture.name} should report ${fixture.expectedCode}; got ${JSON.stringify(issues)}`,
    );
  });
}

function replaceExactlyOnce(source, find, replacement, name) {
  const first = source.indexOf(find);
  assert.notEqual(first, -1, `${name}: fixture target is missing`);
  assert.equal(source.indexOf(find, first + find.length), -1, `${name}: fixture target is ambiguous`);
  return `${source.slice(0, first)}${replacement}${source.slice(first + find.length)}`;
}
