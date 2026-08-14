import { describe, expect, test } from "vitest";
import { bracket, state } from "./test-fixtures";
import type { Heat } from "@rr3/domain";
import type { AdvancementRule } from "./types";

async function meetDomain(): Promise<any> { return import(`./${"index"}`).catch(() => null); }

function finishedBracket(id: string, stage: "qualifier" | "semifinal" | "final", count = 3) {
  const cars = Array.from({ length: count }, (_, index) => ({ id: `${id}-${index + 1}`, number: index + 1 }));
  const result = bracket(id, stage, cars);
  result.event.matches = cars.flatMap((car, index): Heat[] => Array.from({ length: count - index }, (_, win): Heat => ({
    id: `${id}-heat-${index}-${win}`, phase: "preliminary", matchNumber: index + 1, heatNumber: win + 1,
    lanes: [car.id, null, null], status: "completed", winnerEntryId: car.id, laneTimesMs: [1000 + index, null, null], notes: ""
  })));
  return result;
}

function rule(id: string, sourceBracketId: string, destinationBracketIds: string[], topN: number, capacity: number): AdvancementRule {
  return { id, version: 1, sourceBracketId, destinationBracketIds, topN, destinationCapacity: capacity, destinationOrder: destinationBracketIds, status: "active" };
}

describe("advancement progression", () => {
  test("allocates three qualifiers into a nine-car final in stable destination order", async () => {
    const domain = await meetDomain(); expect(domain).not.toBeNull(); if (!domain) return;
    const meet = state([finishedBracket("q1", "qualifier"), finishedBracket("q2", "qualifier"), finishedBracket("q3", "qualifier"), bracket("final", "final")]);
    meet.advancementRules = [rule("q1-final", "q1", ["final"], 3, 9), rule("q2-final", "q2", ["final"], 3, 9), rule("q3-final", "q3", ["final"], 3, 9)];
    let next = meet;
    for (const id of ["q1-final", "q2-final", "q3-final"]) next = domain.confirmAdvancementPure(next, id, { actorId: "organiser", confirmedAt: "2026-08-14T01:00:00Z" });
    expect(next.brackets.find((item: { id: string }) => item.id === "final")!.event.entries).toHaveLength(9);
  });

  test("balances four qualifier selections across two semifinals and permits six-car final previews", async () => {
    const domain = await meetDomain(); expect(domain).not.toBeNull(); if (!domain) return;
    const meet = state([finishedBracket("q1", "qualifier"), finishedBracket("q2", "qualifier"), finishedBracket("q3", "qualifier"), finishedBracket("q4", "qualifier"), bracket("s1", "semifinal"), bracket("s2", "semifinal"), finishedBracket("s1-results", "semifinal"), finishedBracket("s2-results", "semifinal"), bracket("final", "final")]);
    meet.advancementRules = [rule("q1-semis", "q1", ["s1", "s2"], 3, 6), rule("s1-final", "s1-results", ["final"], 3, 6), rule("s2-final", "s2-results", ["final"], 3, 6)];
    const preview = domain.previewAdvancement(meet, "q1-semis");
    expect(preview.selected.map((item: { destinationBracketId: string }) => item.destinationBracketId)).toEqual(["s1", "s2", "s1"]);
    expect(domain.previewAdvancement(meet, "s1-final").selected).toHaveLength(3);
    expect(domain.previewAdvancement(meet, "s2-final").selected).toHaveLength(3);
  });

  test("does not choose a tied cutoff by car number and reports capacity overflow", async () => {
    const domain = await meetDomain(); expect(domain).not.toBeNull(); if (!domain) return;
    const tied = bracket("q", "qualifier", [{ id: "a", number: 1 }, { id: "b", number: 2 }]);
    const meet = state([tied, bracket("f", "final", [{ id: "occupied", number: 9 }])]);
    meet.advancementRules = [rule("q-f", "q", ["f"], 1, 1)];
    const preview = domain.previewAdvancement(meet, "q-f");
    expect(preview.tiedCarIds).toEqual(["a", "b"]);
    expect(preview.selected).toEqual([]);
    expect(preview.capacityIssues).toHaveLength(1);
    expect(preview.canConfirm).toBe(false);
  });

  test("rejects duplicate advancement and requires an audit reason for manual selection", async () => {
    const domain = await meetDomain(); expect(domain).not.toBeNull(); if (!domain) return;
    const meet = state([finishedBracket("q", "qualifier"), bracket("f", "final")]);
    meet.advancementRules = [rule("q-f", "q", ["f"], 2, 9)];
    expect(() => domain.confirmAdvancementPure(meet, "q-f", { actorId: "organiser", confirmedAt: "2026-08-14T01:00:00Z", selectedCarIds: ["q-1"] })).toThrow(/reason/i);
    const next = domain.confirmAdvancementPure(meet, "q-f", { actorId: "organiser", confirmedAt: "2026-08-14T01:00:00Z" });
    expect(domain.confirmAdvancementPure(next, "q-f", { actorId: "organiser", confirmedAt: "2026-08-14T01:00:00Z" })).toBe(next);
  });

  test("marks confirmed dependent snapshots stale when upstream results are corrected", async () => {
    const domain = await meetDomain(); expect(domain).not.toBeNull(); if (!domain) return;
    const meet = state([finishedBracket("q", "qualifier"), bracket("f", "final")]);
    meet.advancementRules = [rule("q-f", "q", ["f"], 2, 9)];
    const confirmed = domain.confirmAdvancementPure(meet, "q-f", { actorId: "organiser", confirmedAt: "2026-08-14T01:00:00Z" });
    const changed = { ...confirmed, brackets: confirmed.brackets.map((item: any) => item.id === "q" ? { ...item, version: item.version + 1 } : item) };
    expect(domain.markDependentAdvancementStale(changed).advancementSnapshots[0].stale).toBe(true);
  });
});
