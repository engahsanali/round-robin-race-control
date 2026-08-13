import { describe, expect, it } from "vitest";

import demoEvent from "../../../fixtures/demo-event.json";
import { migrateEvent, parseEventJson, serializeEvent } from "./serialization";
import type { EventStateV1 } from "./types";

function validEvent(): EventStateV1 {
  return structuredClone(demoEvent) as unknown as EventStateV1;
}

describe("event interchange", () => {
  it("serializes deterministically without changing stable IDs", () => {
    const first = validEvent();
    const reordered = JSON.parse(JSON.stringify(first)) as EventStateV1;
    reordered.settings.prices = { standard: 1200 };
    reordered.auditLog[0]!.details = { zed: 1, alpha: 2 };
    first.auditLog[0]!.details = { alpha: 2, zed: 1 };

    const serialized = serializeEvent(first);
    expect(serialized).toBe(serializeEvent(reordered));

    const parsed = parseEventJson(serialized);
    expect(parsed).toEqual({ ok: true, data: first });
    if (parsed.ok) {
      expect(parsed.data.participants.map(({ id }) => id)).toEqual(first.participants.map(({ id }) => id));
      expect(parsed.data.entries.map(({ id }) => id)).toEqual(first.entries.map(({ id }) => id));
    }
  });

  it("returns actionable issues for malformed JSON and leaves current state byte-for-byte unchanged", () => {
    const current = validEvent();
    const before = serializeEvent(current);

    const result = parseEventJson("{not json");

    expect(result).toMatchObject({ ok: false, issues: [{ code: "invalid_json" }] });
    expect(serializeEvent(current)).toBe(before);
  });

  it.each([2, 0, "1", undefined])("rejects unsupported or missing version %s", (version) => {
    const input = validEvent() as unknown as Record<string, unknown>;
    if (version === undefined) delete input.version;
    else input.version = version;

    const result = migrateEvent(input);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some(({ code }) => code === "unsupported_version")).toBe(true);
  });

  it("accepts only the explicitly supported current migration and validates its completed state", () => {
    const input = validEvent();
    const result = migrateEvent(input);

    expect(result).toEqual({ ok: true, data: input });
    expect(result.ok && result.data).not.toBe(input);
  });

  it.each(["__proto__", "constructor", "prototype"])("rejects the dangerous key %s before import", (key) => {
    const input = validEvent() as unknown as Record<string, unknown>;
    input.auditLog = [{
      ...(input.auditLog as Array<Record<string, unknown>>)[0],
      details: JSON.parse(`{"safe":{"${key}":{"polluted":true}}}`)
    }];

    const result = parseEventJson(JSON.stringify(input));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toContainEqual(expect.objectContaining({ code: "dangerous_key" }));
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it.each([
    ["duplicate IDs", (state: EventStateV1) => { state.participants.push(structuredClone(state.participants[0]!)); }],
    ["duplicate active car numbers", (state: EventStateV1) => { state.entries[1]!.carNumber = state.entries[0]!.carNumber; }],
    ["missing references", (state: EventStateV1) => { state.entries[0]!.participantId = "missing"; }],
    ["invalid winner references", (state: EventStateV1) => { state.matches[0]!.winnerEntryId = "car-not-in-heat"; }],
    ["impossible amounts", (state: EventStateV1) => { state.payments[0]!.amountCents = -1; }],
    ["impossible times", (state: EventStateV1) => { state.matches[0]!.laneTimesMs[0] = -1; }]
  ])("uses the shared event validator to reject %s", (_label, mutate) => {
    const input = validEvent();
    mutate(input);

    expect(parseEventJson(JSON.stringify(input)).ok).toBe(false);
  });
});
