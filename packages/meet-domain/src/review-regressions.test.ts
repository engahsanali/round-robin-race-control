import type { Heat } from "@rr3/domain";
import { describe, expect, test } from "vitest";
import { bracket, state } from "./test-fixtures";

async function meetDomain(): Promise<any> { return import(`./${"index"}`).catch(() => null); }

function finishedBracket(id: string, stage: "qualifier" | "semifinal" | "final", wins: number[] = [3, 2, 1]) {
  const cars = wins.map((_, index) => ({ id: `${id}-${index + 1}`, number: index + 1 }));
  const result = bracket(id, stage, cars);
  result.event.matches = cars.flatMap((car, index): Heat[] => Array.from({ length: wins[index]! }, (_, heat): Heat => ({
    id: `${id}-${index}-${heat}`, phase: "preliminary", matchNumber: index + 1, heatNumber: heat + 1,
    lanes: [car.id, null, null], status: "completed", winnerEntryId: car.id, laneTimesMs: [1000 + index, null, null], notes: ""
  })));
  return result;
}

function rule(id: string, sourceBracketId: string, destinationBracketIds: string[], topN: number, destinationCapacity = 6, status: "active" | "disabled" = "active") {
  return { id, sourceBracketId, destinationBracketIds, destinationOrder: destinationBracketIds, topN, destinationCapacity, status };
}

describe("review regressions", () => {
  test("balances four independent qualifier rules into two occupied six-car semifinals", async () => {
    const domain = await meetDomain(); expect(domain).not.toBeNull(); if (!domain) return;
    const meet = state(["q1", "q2", "q3", "q4"].map((id) => finishedBracket(id, "qualifier")).concat([bracket("s1", "semifinal"), bracket("s2", "semifinal")]));
    meet.advancementRules = ["q1", "q2", "q3", "q4"].map((id) => rule(`${id}-semis`, id, ["s1", "s2"], 3));
    const next = meet.advancementRules.reduce((current, item) => domain.confirmAdvancementPure(current, item.id, { actorId: "organiser", confirmedAt: "2026-08-14T01:00:00Z" }), meet);
    expect(next.brackets.find((item: { id: string }) => item.id === "s1")!.event.entries).toHaveLength(6);
    expect(next.brackets.find((item: { id: string }) => item.id === "s2")!.event.entries).toHaveLength(6);
  });

  test("only blocks a tied group that intersects the cutoff and includes the full group in capacity", async () => {
    const domain = await meetDomain(); expect(domain).not.toBeNull(); if (!domain) return;
    const inside = state([finishedBracket("inside", "qualifier", [4, 2, 2, 1]), bracket("f1", "final")]);
    inside.advancementRules = [rule("inside-final", "inside", ["f1"], 3, 9)];
    expect(domain.previewAdvancement(inside, "inside-final").selected.map((selection: { sourceCarId: string }) => selection.sourceCarId)).toEqual(["inside-1", "inside-2", "inside-3"]);
    expect(domain.previewAdvancement(inside, "inside-final").tiedCarIds).toEqual([]);

    const cutoff = state([finishedBracket("cutoff", "qualifier", [4, 2, 2, 1]), bracket("f2", "final")]);
    cutoff.advancementRules = [rule("cutoff-final", "cutoff", ["f2"], 2, 2)];
    const preview = domain.previewAdvancement(cutoff, "cutoff-final");
    expect(preview.selected.map((selection: { sourceCarId: string }) => selection.sourceCarId)).toEqual(["cutoff-1"]);
    expect(preview.tiedCarIds).toEqual(["cutoff-2", "cutoff-3"]);
    expect(preview.capacityIssues).toEqual([{ destinationBracketId: "f2", available: 2, required: 3 }]);
  });

  test("allows reasoned tied-cutoff manual choice but never bypasses disabled or capacity gates", async () => {
    const domain = await meetDomain(); expect(domain).not.toBeNull(); if (!domain) return;
    const meet = state([finishedBracket("q", "qualifier", [4, 2, 2, 1]), bracket("f", "final")]);
    meet.advancementRules = [rule("q-f", "q", ["f"], 2, 3)];
    const confirmed = domain.confirmAdvancementPure(meet, "q-f", { actorId: "organiser", confirmedAt: "2026-08-14T01:00:00Z", selectedCarIds: ["q-1", "q-2"], reason: "Chief steward decision" });
    expect(confirmed.advancementSnapshots[0]!.selections.map((selection: { sourceCarId: string }) => selection.sourceCarId)).toEqual(["q-1", "q-2"]);
    expect(() => domain.confirmAdvancementPure({ ...meet, advancementRules: [rule("q-f", "q", ["f"], 2, 3, "disabled")] }, "q-f", { actorId: "organiser", confirmedAt: "2026-08-14T01:00:00Z", selectedCarIds: ["q-1", "q-2"], reason: "No bypass" })).toThrow(/cannot be confirmed/i);
    expect(() => domain.confirmAdvancementPure(meet, "q-f", { actorId: "organiser", confirmedAt: "2026-08-14T01:00:00Z", selectedCarIds: ["q-1", "q-1"], reason: "Duplicate" })).toThrow(/unique/i);
    expect(() => domain.confirmAdvancementPure(meet, "q-f", { actorId: "organiser", confirmedAt: "2026-08-14T01:00:00Z", selectedCarIds: ["q-1"], reason: "Too few" })).toThrow(/exactly 2/i);
  });

  test("propagates stale source lineage transitively and blocks final preview", async () => {
    const domain = await meetDomain(); expect(domain).not.toBeNull(); if (!domain) return;
    const meet = state([finishedBracket("q", "qualifier"), finishedBracket("s", "semifinal"), bracket("f", "final")]);
    meet.advancementRules = [rule("q-s", "q", ["s"], 1), rule("s-f", "s", ["f"], 1)];
    const semifinal = domain.confirmAdvancementPure(meet, "q-s", { actorId: "organiser", confirmedAt: "2026-08-14T01:00:00Z" });
    const final = domain.confirmAdvancementPure(semifinal, "s-f", { actorId: "organiser", confirmedAt: "2026-08-14T01:01:00Z" });
    const corrected = { ...final, brackets: final.brackets.map((item: any) => item.id === "q" ? { ...item, version: item.version + 1 } : item) };
    const stale = domain.markDependentAdvancementStale(corrected);
    expect(stale.advancementSnapshots.map((snapshot: { stale: boolean }) => snapshot.stale)).toEqual([true, true]);
    expect(domain.previewAdvancement(stale, "s-f").staleSource).toBe(true);
  });

  test("rejects incomplete or inconsistent snapshot and lineage graph references", async () => {
    const domain = await meetDomain(); expect(domain).not.toBeNull(); if (!domain) return;
    const valid = state([finishedBracket("q", "qualifier"), bracket("f", "final")]) as any;
    valid.advancementRules = [rule("q-f", "q", ["f"], 1)];
    valid.advancementSnapshots = [{ id: "snap", ruleId: "q-f", sourceBracketId: "q", sourceResultVersion: 1, selections: [{ sourceCarId: "q-1", destinationBracketId: "f", rank: 1 }], confirmedBy: "organiser", reason: null, confirmedAt: "2026-08-14T01:00:00Z", stale: false }];
    valid.brackets[1].lineage = [{ sourceBracketId: "q", sourceCarId: "q-1", ruleId: "q-f", snapshotId: "snap" }];
    expect(domain.validateMeetState(valid).success).toBe(true);
    const invalid = structuredClone(valid);
    invalid.advancementSnapshots[0].selections.push({ sourceCarId: "unknown", destinationBracketId: "not-a-destination", rank: 1 });
    invalid.brackets[1].lineage.push({ sourceBracketId: "missing", sourceCarId: "q-1", ruleId: "missing", snapshotId: "missing" });
    expect(domain.validateMeetState(invalid).success).toBe(false);
  });

  test("uses code-unit ordering for Unicode report rows", async () => {
    const domain = await meetDomain(); expect(domain).not.toBeNull(); if (!domain) return;
    const meet = state([bracket("ä", "qualifier"), bracket("z", "qualifier")]);
    expect(domain.buildBracketSummaryRows(meet).slice(1).map((row: unknown[]) => row[0])).toEqual(["z", "ä"]);
  });
});
