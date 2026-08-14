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
const workbookFixtures = JSON.parse(
  await readFile(path.join(import.meta.dirname, "fixtures", "meet-workbook-negative.json"), "utf8"),
);

test("accepts the checked-in Meet migration security contract", async () => {
  const result = await verifier.verifyMeetMigrations(migrationsDir);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(result.schemaVersion, 9);
});

for (const fixture of [
  { name: "replacement lacks downstream-result block", find: "'MEET_DOWNSTREAM_RESULTS_EXIST'", replace: "'MEET_DOWNSTREAM_RESULTS_MISSING'", code: "missing_downstream_result_guard" },
  { name: "replacement leaves pending outgoing-car heats", find: "delete from public.heats heat", replace: "select * from public.heats heat", code: "missing_pending_schedule_cleanup" },
  { name: "winner wrappers accept inactive assigned cars", find: "perform private_meet.assert_heat_cars_active(heat_id, winner_car_id);", replace: "perform 1;", code: "missing_inactive_car_guard" },
  { name: "advancement audit omits selection arrays", find: "jsonb_build_object('selections', current_selections)", replace: "jsonb_build_object('selection_count', jsonb_array_length(current_selections))", code: "missing_advancement_selection_audit" },
  { name: "admin RPC is not owner admin constrained", find: "array['owner', 'admin']", replace: "array['owner', 'admin', 'organiser']", code: "unsafe_admin_read_model" },
]) {
  test(`advancement accountability invariant rejects ${fixture.name}`, async () => {
    assert.equal(typeof verifier.verifyAdvancementAccountabilityInvariant, "function");
    const source = await readFile(path.join(migrationsDir, "202608140009_advancement_accountability.sql"), "utf8");
    const issues = verifier.verifyAdvancementAccountabilityInvariant(source.replace(fixture.find, fixture.replace));
    assert.ok(issues.some((issue) => issue.code === fixture.code), `${fixture.name} should report ${fixture.code}; got ${JSON.stringify(issues)}`);
  });
}

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
        "202608140007_meet_workbook_commands.sql",
        "202608140008_registration_audit_reassignment.sql",
        "202608140009_advancement_accountability.sql",
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

for (const fixture of workbookFixtures) {
  test(`workbook invariant rejects ${fixture.name}`, () => {
    assert.equal(typeof verifier.verifyWorkbookCommandInvariant, "function");
    const issues = verifier.verifyWorkbookCommandInvariant(fixture.sql);
    assert.ok(
      issues.some((issue) => issue.code === fixture.expectedCode),
      `${fixture.name} should report ${fixture.expectedCode}; got ${JSON.stringify(issues)}`,
    );
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
