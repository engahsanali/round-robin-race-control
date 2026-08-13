import { describe, expect, it } from "vitest";

import demoEvent from "../../../fixtures/demo-event.json";
import schedules from "../../../fixtures/schedules.json";
import { eventStateV1Schema, validateEventState } from "./schema";

const EXPECTED_SCHEDULES = {
  template9: [
    [[1, 2, 3], [4, 5, 6], [7, 8, 9]],
    [[1, 4, 7], [2, 5, 8], [3, 6, 9]],
    [[1, 8, 6], [4, 2, 9], [7, 5, 3]],
    [[1, 5, 9], [4, 8, 3], [7, 2, 6]]
  ],
  template12: [
    [[1, 2, 3], [4, 5, 6], [7, 8, 9], [10, 11, 12]],
    [[1, 6, 11], [5, 10, 4], [9, 3, 8], [2, 7, 12]],
    [[1, 10, 8], [6, 4, 2], [11, 9, 7], [5, 3, 12]],
    [[1, 4, 7], [10, 2, 5], [8, 11, 3], [6, 9, 12]],
    [[1, 5, 9], [2, 6, 10], [3, 7, 11], [4, 8, 12]]
  ],
  template15: [
    [[1, 2, 3], [4, 5, 6], [7, 8, 9], [10, 11, 12], [13, 14, 15]],
    [[1, 12, 9], [6, 3, 14], [11, 8, 5], [2, 13, 10], [7, 4, 15]],
    [[1, 14, 13], [12, 11, 10], [9, 8, 7], [6, 5, 4], [3, 2, 15]],
    [[1, 10, 5], [14, 9, 4], [13, 8, 3], [12, 7, 2], [11, 6, 15]],
    [[1, 4, 7], [10, 13, 2], [5, 8, 11], [14, 3, 6], [9, 12, 15]],
    [[1, 6, 11], [2, 7, 12], [3, 8, 13], [4, 9, 14], [5, 10, 15]]
  ],
  finals15: [
    [[15, 1, 14], [11, 9, 7], [13, 8, 10], [5, 12, 2], [4, 6, 3]],
    [[12, 10, 4], [1, 3, 13], [6, 7, 5], [9, 2, 15], [8, 14, 11]],
    [[7, 13, 1], [2, 4, 8], [10, 11, 6], [3, 15, 12], [14, 5, 9]],
    [[5, 1, 10], [15, 8, 7], [11, 6, 3], [13, 9, 14], [4, 12, 2]],
    [[7, 3, 13], [6, 2, 15], [8, 9, 5], [12, 14, 11], [1, 10, 4]]
  ]
} as const;

function validEvent() {
  return {
    version: 1,
    event: {
      id: "event-demo",
      name: "Demo Derby",
      date: "2026-08-13",
      venue: "Community Hall",
      organizer: "Race Crew",
      laneCount: 3,
      status: "running",
      createdAt: "2026-08-13T01:00:00.000Z",
      updatedAt: "2026-08-13T02:00:00.000Z",
      resultSeal: "draft"
    },
    settings: {
      scheduleMode: "custom",
      seed: "demo-seed",
      rankingMode: "competition",
      allowSharedRanks: true,
      tieBreakOrder: ["totalWins", "headToHead", "playoff"],
      finalistCount: 3,
      autoSave: true,
      confirmWinnerChanges: true,
      enableTiming: true,
      prices: { standard: 1200 }
    },
    participants: [
      { id: "participant-1", name: "Alex Rider", email: "alex@example.com", phone: "", notes: "" },
      { id: "participant-2", name: "Bailey Chen", email: "", phone: "", notes: "" },
      { id: "participant-3", name: "Casey Jones", email: "", phone: "", notes: "" }
    ],
    entries: [
      { id: "car-1", participantId: "participant-1", carNumber: 1, name: "Comet", categoryId: "standard", quantity: 1, active: true },
      { id: "car-2", participantId: "participant-2", carNumber: 2, name: "Bolt", categoryId: "standard", quantity: 1, active: true },
      { id: "car-3", participantId: "participant-3", carNumber: 3, name: "Rocket", categoryId: "standard", quantity: 1, active: true }
    ],
    matches: [
      {
        id: "heat-preliminary-1-1",
        phase: "preliminary",
        matchNumber: 1,
        heatNumber: 1,
        lanes: ["car-1", "car-2", "car-3"],
        status: "completed",
        winnerEntryId: "car-1",
        laneTimesMs: [1200, 1300, 1400],
        notes: "Opening heat"
      }
    ],
    finals: [
      {
        id: "heat-final-1-1",
        phase: "final",
        matchNumber: 1,
        heatNumber: 1,
        lanes: ["car-1", "car-2", "car-3"],
        status: "scheduled",
        winnerEntryId: null,
        laneTimesMs: [null, null, null],
        notes: ""
      }
    ],
    payments: [
      { id: "payment-1", participantId: "participant-1", amountCents: 1200, kind: "payment", paidAt: "2026-08-13T01:30:00.000Z", note: "Paid in full" }
    ],
    auditLog: [
      { id: "audit-1", timestamp: "2026-08-13T01:00:00.000Z", action: "event.created", summary: "Event created", entityType: "event", entityId: "event-demo", details: {} }
    ]
  };
}

function eventWithDangerousAndOrdinaryIssues() {
  const input = validEvent();
  input.event.id = "";
  input.matches[0]!.phase = "final";
  input.auditLog[0]!.details = {
    nested: JSON.parse('{"__proto__":{"polluted":true}}')
  };
  return input;
}

describe("validateEventState", () => {
  it("accepts the mixed canonical demo event", () => {
    expect(validateEventState(demoEvent)).toMatchObject({ success: true });
  });

  it("keeps all four canonical fixture arrays exactly equal to the supplied immutable values", () => {
    expect(schedules).toEqual(EXPECTED_SCHEDULES);
  });

  it("accepts schema version 1 and returns normalized data without mutating the input", () => {
    const input = validEvent();
    input.event.name = "  Demo Derby  ";
    input.participants[0]!.name = "  Alex Rider  ";
    const before = structuredClone(input);

    const result = validateEventState(input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.version).toBe(1);
      expect(result.data.event.name).toBe("Demo Derby");
      expect(result.data.participants[0]?.name).toBe("Alex Rider");
    }
    expect(input).toEqual(before);
  });

  it("requires a non-empty stable ID for every entity", () => {
    const input = validEvent();
    input.participants[0]!.id = "   ";
    input.entries[0]!.id = "";
    input.matches[0]!.id = " ";
    input.finals[0]!.id = "";
    input.payments[0]!.id = "";
    input.auditLog[0]!.id = "";

    const result = validateEventState(input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.map((issue) => issue.path.join("."))).toEqual(expect.arrayContaining([
        "participants.0.id",
        "entries.0.id",
        "matches.0.id",
        "finals.0.id",
        "payments.0.id",
        "auditLog.0.id"
      ]));
    }
  });

  it("rejects duplicate active car numbers while allowing an inactive historical duplicate", () => {
    const activeDuplicate = validEvent();
    activeDuplicate.entries[1]!.carNumber = 1;

    const rejected = validateEventState(activeDuplicate);
    expect(rejected.success).toBe(false);
    if (!rejected.success) {
      expect(rejected.issues.some((issue) => issue.code === "duplicate_active_car_number")).toBe(true);
    }

    activeDuplicate.entries[1]!.active = false;
    expect(validateEventState(activeDuplicate).success).toBe(true);
  });

  it("rejects unsupported schema versions", () => {
    const input = { ...validEvent(), version: 2 };

    const result = validateEventState(input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.some((issue) => issue.path.join(".") === "version")).toBe(true);
    }
  });

  it("rejects a winner that is not assigned to the heat", () => {
    const input = validEvent();
    input.matches[0]!.winnerEntryId = "car-not-in-this-heat";

    const result = validateEventState(input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.some((issue) => issue.code === "winner_not_in_heat")).toBe(true);
    }
  });

  it("rejects final-phase heats in the preliminary matches collection", () => {
    const input = validEvent();
    input.matches[0]!.phase = "final";

    const result = validateEventState(input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues).toContainEqual(expect.objectContaining({
        code: "phase_mismatch",
        path: ["matches", 0, "phase"]
      }));
    }
  });

  it("rejects preliminary-phase heats in the finals collection", () => {
    const input = validEvent();
    input.finals[0]!.phase = "preliminary";

    const result = validateEventState(input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues).toContainEqual(expect.objectContaining({
        code: "phase_mismatch",
        path: ["finals", 0, "phase"]
      }));
    }
  });

  it.each([
    ["participants", "participant-1"],
    ["entries", "car-1"],
    ["matches", "heat-preliminary-1-1"],
    ["finals", "heat-final-1-1"],
    ["payments", "payment-1"],
    ["auditLog", "audit-1"]
  ] as const)("rejects duplicate IDs in %s", (collection, duplicateId) => {
    const input = validEvent();
    const item = structuredClone(input[collection][0]!);
    item.id = duplicateId;
    input[collection].push(item as never);

    const result = validateEventState(input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.some((issue) => issue.code === "duplicate_id" && issue.path[0] === collection)).toBe(true);
    }
  });

  it("rejects a heat ID reused between preliminary and finals collections", () => {
    const input = validEvent();
    input.finals[0]!.id = input.matches[0]!.id;

    const result = validateEventState(input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.some((issue) => issue.code === "duplicate_id" && issue.path[0] === "finals")).toBe(true);
    }
  });

  it.each([
    ["negative category price", (input: ReturnType<typeof validEvent>) => { input.settings.prices.standard = -1; }],
    ["NaN category price", (input: ReturnType<typeof validEvent>) => { input.settings.prices.standard = Number.NaN; }],
    ["negative payment", (input: ReturnType<typeof validEvent>) => { input.payments[0]!.amountCents = -1; }],
    ["NaN payment", (input: ReturnType<typeof validEvent>) => { input.payments[0]!.amountCents = Number.NaN; }]
  ] as const)("rejects %s", (_label, mutate) => {
    const input = validEvent();
    mutate(input);

    expect(validateEventState(input).success).toBe(false);
  });

  it.each(["__proto__", "constructor", "prototype"])("recursively rejects the dangerous key %s", (dangerousKey) => {
    const input = validEvent();
    const dangerousContainer = JSON.parse(`{"${dangerousKey}":{"polluted":true}}`);
    input.auditLog[0]!.details = { safe: { nested: dangerousContainer } };

    const result = validateEventState(input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.some((issue) => issue.code === "dangerous_key" && issue.path.at(-1) === dangerousKey)).toBe(true);
    }
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it.each(["__proto__", "constructor", "prototype"])("the exported Zod schema recursively rejects the dangerous key %s", (dangerousKey) => {
    const input = validEvent();
    const dangerousContainer = JSON.parse(`{"${dangerousKey}":{"polluted":true}}`);
    input.auditLog[0]!.details = { safe: { nested: dangerousContainer } };

    const result = eventStateV1Schema.safeParse(input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(expect.objectContaining({
        code: "custom",
        path: ["auditLog", 0, "details", "safe", "nested", dangerousKey]
      }));
    }
    expect(() => eventStateV1Schema.parse(input)).toThrow();
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it("the exported Zod schema aggregates dangerous-key and ordinary validation issues", () => {
    const result = eventStateV1Schema.safeParse(eventWithDangerousAndOrdinaryIssues());

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({
          code: "custom",
          path: ["auditLog", 0, "details", "nested", "__proto__"]
        }),
        expect.objectContaining({
          code: "too_small",
          path: ["event", "id"]
        }),
        expect.objectContaining({
          code: "custom",
          path: ["matches", 0, "phase"]
        })
      ]));
    }
  });

  it("validateEventState aggregates dangerous-key and ordinary validation issues", () => {
    const result = validateEventState(eventWithDangerousAndOrdinaryIssues());

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({
          code: "dangerous_key",
          path: ["auditLog", 0, "details", "nested", "__proto__"]
        }),
        expect.objectContaining({
          code: "too_small",
          path: ["event", "id"]
        }),
        expect.objectContaining({
          code: "phase_mismatch",
          path: ["matches", 0, "phase"]
        })
      ]));
    }
  });

  it("returns all actionable validation issues in one result", () => {
    const input = validEvent();
    input.event.id = "";
    input.event.name = "x".repeat(201);
    input.entries[0]!.carNumber = 0;
    input.settings.finalistCount = -1;

    const result = validateEventState(input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.length).toBeGreaterThanOrEqual(4);
    }
  });
});
