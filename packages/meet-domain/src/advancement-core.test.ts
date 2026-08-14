import { describe, expect, test } from "vitest";
import type { Heat } from "@rr3/domain";
import { bracket, state } from "./test-fixtures";
import { confirmAdvancementPure, parseMeetJson, prepareAdvancementSelections, serializeMeet, validateMeetState } from "./index";

function completed(id: string, count = 3) {
  const cars = Array.from({ length: count }, (_, index) => ({ id: `${id}-${index + 1}`, number: index + 1 }));
  const result = bracket(id, "qualifier", cars);
  result.event.matches = cars.flatMap((car, index): Heat[] => Array.from({ length: count - index }, (_, heatIndex) => ({
    id: `${id}-heat-${index}-${heatIndex}`, phase: "preliminary", matchNumber: index + 1, heatNumber: heatIndex + 1,
    lanes: [car.id, null, null], status: "completed", winnerEntryId: car.id,
    laneTimesMs: [1000 + index, null, null], notes: "",
  })));
  return result;
}

function rule(id: string, source: string, destinations: string[], topN: number) {
  return { id, sourceBracketId: source, destinationBracketIds: destinations, destinationOrder: destinations, topN, destinationCapacity: 6, status: "active" as const, version: 1 };
}

describe("Meet advancement core contract", () => {
  test("normalizes a legacy rule without a version to version 1 and rejects unsafe versions", () => {
    const legacy = state([completed("q"), bracket("f", "final")]);
    const legacyRule = { ...rule("q-f", "q", ["f"], 3) } as Record<string, unknown>;
    delete legacyRule.version;
    const parsed = parseMeetJson(JSON.stringify({ ...legacy, advancementRules: [legacyRule] }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data.advancementRules[0]?.version).toBe(1);
      const normalized = serializeMeet(parsed.data);
      expect(normalized).toContain('"version": 1');
      expect(parseMeetJson(normalized)).toEqual(parsed);
    }

    for (const version of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(validateMeetState({ ...legacy, advancementRules: [{ ...rule("q-f", "q", ["f"], 3), version }] }).success).toBe(false);
    }
  });

  test("requires all automatic qualifiers and an exact explicit choice from a tied cutoff", () => {
    const source = completed("q", 3);
    source.event.matches = [
      { id: "h1", phase: "preliminary", matchNumber: 1, heatNumber: 1, lanes: ["q-1", "q-2", null], status: "completed", winnerEntryId: "q-1", laneTimesMs: [1000, 1100, null], notes: "" },
      { id: "h2", phase: "preliminary", matchNumber: 2, heatNumber: 1, lanes: ["q-1", "q-3", null], status: "completed", winnerEntryId: "q-1", laneTimesMs: [1000, 1100, null], notes: "" },
    ];
    const meet = state([source, bracket("f", "final")]);
    meet.advancementRules = [rule("q-f", "q", ["f"], 2)];

    expect(() => prepareAdvancementSelections(meet, "q-f", ["q-2", "q-3"])).toThrow(/automatic/i);
    expect(() => prepareAdvancementSelections(meet, "q-f", ["q-1"])).toThrow(/exactly 2/i);
    expect(prepareAdvancementSelections(meet, "q-f", ["q-1", "q-3"]).map((selection) => selection.sourceCarId)).toEqual(["q-1", "q-3"]);
  });

  test("allocates four top-three qualifier groups 6/6 using current destination occupancy", () => {
    let meet = state([completed("q1"), completed("q2"), completed("q3"), completed("q4"), bracket("s1", "semifinal"), bracket("s2", "semifinal")]);
    meet.advancementRules = ["q1", "q2", "q3", "q4"].map((source) => rule(`${source}-semis`, source, ["s1", "s2"], 3));
    for (const source of ["q1", "q2", "q3", "q4"]) {
      const selections = prepareAdvancementSelections(meet, `${source}-semis`, [`${source}-1`, `${source}-2`, `${source}-3`]);
      meet = confirmAdvancementPure(meet, `${source}-semis`, { actorId: "organiser", confirmedAt: `2026-08-14T0${source.slice(1)}:00:00Z`, selectedCarIds: selections.map((selection) => selection.sourceCarId) });
    }
    expect(meet.brackets.find((item) => item.id === "s1")?.event.entries.filter((entry) => entry.active)).toHaveLength(6);
    expect(meet.brackets.find((item) => item.id === "s2")?.event.entries.filter((entry) => entry.active)).toHaveLength(6);
    expect(meet.advancementRules.map((item) => item.version)).toEqual([2, 2, 2, 2]);
    expect(meet.auditLog[0]?.before).toEqual({ ruleId: "q1-semis", selections: [] });
    expect(meet.auditLog[0]?.after).toEqual({
      ruleId: "q1-semis",
      selections: [
        { sourceCarId: "q1-1", destinationBracketId: "s1", rank: 1 },
        { sourceCarId: "q1-2", destinationBracketId: "s2", rank: 2 },
        { sourceCarId: "q1-3", destinationBracketId: "s1", rank: 3 },
      ],
    });
  });
});
