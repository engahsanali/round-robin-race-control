import { describe, expect, it } from "vitest";

import { calculateEventAccounts, calculateParticipantAccount } from "./payments";
import type { EventStateV1 } from "./types";

function eventState(): EventStateV1 {
  return {
    version: 1,
    event: {
      id: "event-1", name: "Accounts", date: "2026-08-13", venue: "", organizer: "",
      laneCount: 3, status: "setup", createdAt: "2026-08-13T00:00:00.000Z",
      updatedAt: "2026-08-13T00:00:00.000Z", resultSeal: "draft"
    },
    settings: {
      scheduleMode: "custom", seed: "accounts", rankingMode: "competition", allowSharedRanks: true,
      tieBreakOrder: ["totalWins"], finalistCount: 3, autoSave: true, confirmWinnerChanges: true,
      enableTiming: false, prices: { standard: 1250, premium: 2000 }
    },
    participants: [
      { id: "participant-a", name: "Ada", email: "", phone: "", notes: "" },
      { id: "participant-b", name: "Ben", email: "", phone: "", notes: "" }
    ],
    entries: [
      { id: "car-a", participantId: "participant-a", carNumber: 1, name: "A", categoryId: "standard", quantity: 2, active: true },
      { id: "car-b", participantId: "participant-b", carNumber: 2, name: "B", categoryId: "premium", quantity: 1, active: true }
    ],
    matches: [], finals: [], payments: [], auditLog: []
  };
}

describe("participant accounts", () => {
  it.each([
    ["unpaid", [], 2500],
    ["partially paid", [{ id: "p1", amountCents: 1000, kind: "payment" as const }], 1500],
    ["paid exactly", [{ id: "p1", amountCents: 2500, kind: "payment" as const }], 0],
    ["overpaid", [{ id: "p1", amountCents: 3000, kind: "payment" as const }], -500],
    ["refunded", [
      { id: "p1", amountCents: 2500, kind: "payment" as const },
      { id: "r1", amountCents: 400, kind: "refund" as const }
    ], 400]
  ])("calculates an %s balance from integer-cent charges and signed payment records", (_label, records, expectedBalance) => {
    const state = eventState();
    state.payments = records.map((record) => ({
      ...record,
      participantId: "participant-a",
      paidAt: "2026-08-13T01:00:00.000Z",
      note: ""
    }));

    expect(calculateParticipantAccount(state, "participant-a")).toEqual({
      participantId: "participant-a",
      chargeCents: 2500,
      collectedCents: 2500 - expectedBalance,
      balanceCents: expectedBalance
    });
  });

  it("uses the currently configured category price when prices change", () => {
    const state = eventState();
    state.settings.prices.standard = 1500;

    expect(calculateParticipantAccount(state, "participant-a").chargeCents).toBe(3000);
  });

  it("returns deterministic participant accounts and event totals", () => {
    const state = eventState();
    state.payments = [{
      id: "p1", participantId: "participant-a", amountCents: 500, kind: "payment",
      paidAt: "2026-08-13T01:00:00.000Z", note: ""
    }];

    expect(calculateEventAccounts(state)).toEqual({
      participants: [
        { participantId: "participant-a", chargeCents: 2500, collectedCents: 500, balanceCents: 2000 },
        { participantId: "participant-b", chargeCents: 2000, collectedCents: 0, balanceCents: 2000 }
      ],
      chargeCents: 4500,
      collectedCents: 500,
      balanceCents: 4000
    });
  });

  it("rejects a missing participant", () => {
    expect(() => calculateParticipantAccount(eventState(), "missing")).toThrow(/unknown participant/i);
  });

  it.each([
    ["missing category price", (state: EventStateV1) => { delete state.settings.prices.standard; }],
    ["zero quantity", (state: EventStateV1) => { state.entries[0]!.quantity = 0; }],
    ["fractional quantity", (state: EventStateV1) => { state.entries[0]!.quantity = 1.5; }],
    ["fractional category price", (state: EventStateV1) => { state.settings.prices.standard = 12.5; }],
    ["fractional payment", (state: EventStateV1) => {
      state.payments.push({ id: "p1", participantId: "participant-a", amountCents: 10.5, kind: "payment", paidAt: "2026-08-13T01:00:00.000Z", note: "" });
    }]
  ])("rejects impossible accounting input: %s", (_label, mutate) => {
    const state = eventState();
    mutate(state);

    expect(() => calculateParticipantAccount(state, "participant-a")).toThrow();
  });
});
