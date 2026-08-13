import { describe, expect, it } from "vitest";

import { calculateStandings, cancelHeat, markRerun, recordWinner } from "./results";
import type { EventStateV1, Heat } from "./types";

function heat(overrides: Partial<Heat> = {}): Heat {
  return {
    id: "heat-1",
    phase: "preliminary",
    matchNumber: 1,
    heatNumber: 1,
    lanes: ["car-a", "car-b", "car-c"],
    status: "scheduled",
    winnerEntryId: null,
    laneTimesMs: [null, null, null],
    notes: "",
    ...overrides
  };
}

function eventState(overrides: Partial<EventStateV1> = {}): EventStateV1 {
  const participants = ["a", "b", "c", "d"].map((suffix) => ({
    id: `participant-${suffix}`,
    name: `Participant ${suffix.toUpperCase()}`,
    email: "",
    phone: "",
    notes: ""
  }));
  const entries = ["a", "b", "c", "d"].map((suffix, index) => ({
    id: `car-${suffix}`,
    participantId: `participant-${suffix}`,
    carNumber: index + 1,
    name: `Car ${suffix.toUpperCase()}`,
    categoryId: "open",
    quantity: 1,
    active: suffix !== "d"
  }));

  return {
    version: 1,
    event: {
      id: "event-1",
      name: "Test event",
      date: "2026-08-13",
      venue: "",
      organizer: "",
      laneCount: 3,
      status: "running",
      createdAt: "2026-08-13T00:00:00.000Z",
      updatedAt: "2026-08-13T01:00:00.000Z",
      resultSeal: "draft"
    },
    settings: {
      scheduleMode: "custom",
      seed: "test",
      rankingMode: "competition",
      allowSharedRanks: true,
      tieBreakOrder: ["totalWins"],
      finalistCount: 2,
      autoSave: true,
      confirmWinnerChanges: true,
      enableTiming: true,
      prices: {}
    },
    participants,
    entries,
    matches: [heat()],
    finals: [],
    payments: [],
    auditLog: [],
    ...overrides
  };
}

describe("result commands", () => {
  it("records one official win immutably and leaves losing cars on zero", () => {
    const original = eventState();
    const next = recordWinner(original, "heat-1", "car-a");

    expect(next).not.toBe(original);
    expect(original.matches[0]!).toMatchObject({ status: "scheduled", winnerEntryId: null });
    expect(next.matches[0]!).toMatchObject({ status: "completed", winnerEntryId: "car-a" });
    expect(next.auditLog.at(-1)).toMatchObject({
      action: "result.recorded",
      entityId: "heat-1",
      details: { previousWinnerEntryId: null, winnerEntryId: "car-a" }
    });
    expect(calculateStandings(next, "preliminary").map(({ carId, totalWins }) => [carId, totalWins])).toEqual([
      ["car-a", 1],
      ["car-b", 0],
      ["car-c", 0]
    ]);
  });

  it("requires a reason to replace a winner and audits the old winner", () => {
    const first = recordWinner(eventState(), "heat-1", "car-a");

    expect(() => recordWinner(first, "heat-1", "car-b")).toThrow(/correction reason/i);
    const corrected = recordWinner(first, "heat-1", "car-b", "Lane judge correction");

    expect(first.matches[0]!.winnerEntryId).toBe("car-a");
    expect(corrected.matches[0]!.winnerEntryId).toBe("car-b");
    expect(corrected.auditLog.at(-1)?.summary).toMatch(/car-a.*car-b.*Lane judge correction/i);
    expect(calculateStandings(corrected, "preliminary").map(({ carId, totalWins }) => [carId, totalWins])).toEqual([
      ["car-a", 0],
      ["car-b", 1],
      ["car-c", 0]
    ]);
  });

  it("treats reconfirming the existing winner as an idempotent no-op", () => {
    const first = recordWinner(eventState(), "heat-1", "car-a");

    expect(recordWinner(first, "heat-1", "car-a")).toBe(first);
  });

  it("cancels a completed heat and removes its official win", () => {
    const completed = recordWinner(eventState(), "heat-1", "car-a");
    const cancelled = cancelHeat(completed, "heat-1", "Track obstruction");

    expect(cancelled.matches[0]!).toMatchObject({ status: "cancelled", winnerEntryId: null });
    expect(cancelled.auditLog.at(-1)?.summary).toMatch(/car-a.*Track obstruction/i);
    expect(calculateStandings(cancelled, "preliminary").every(({ totalWins }) => totalWins === 0)).toBe(true);
  });

  it("marks a heat for rerun before accepting a replacement result", () => {
    const completed = recordWinner(eventState(), "heat-1", "car-a");
    const rerun = markRerun(completed, "heat-1", "False start");

    expect(rerun.matches[0]!).toMatchObject({ status: "rerun", winnerEntryId: null });
    expect(rerun.auditLog.at(-1)?.summary).toMatch(/car-a.*False start/i);
    expect(calculateStandings(rerun, "preliminary").every(({ totalWins }) => totalWins === 0)).toBe(true);

    const replacement = recordWinner(rerun, "heat-1", "car-c");
    expect(replacement.matches[0]!).toMatchObject({ status: "completed", winnerEntryId: "car-c" });
    expect(calculateStandings(replacement, "preliminary").find(({ carId }) => carId === "car-c")?.totalWins).toBe(1);
  });

  it("rejects unknown heat and car IDs plus winners not assigned to the heat", () => {
    const state = eventState();

    expect(() => recordWinner(state, "missing-heat", "car-a")).toThrow(/unknown heat/i);
    expect(() => cancelHeat(state, "missing-heat", "reason")).toThrow(/unknown heat/i);
    expect(() => recordWinner(state, "heat-1", "missing-car")).toThrow(/unknown car/i);
    expect(() => recordWinner(state, "heat-1", "car-d")).toThrow(/assigned.*heat/i);
  });

  it("projects match totals, timing, partial results, phases, and active entries only", () => {
    const state = eventState({
      matches: [
        heat({ id: "m1-h1", status: "completed", winnerEntryId: "car-a", laneTimesMs: [1000, 1100, 1200] }),
        heat({ id: "m1-h2", heatNumber: 2, lanes: ["car-a", "car-b", "car-d"], status: "completed", winnerEntryId: "car-a", laneTimesMs: [900, 1050, 1300] }),
        heat({ id: "m2-h1", matchNumber: 2, status: "completed", winnerEntryId: "car-b", laneTimesMs: [980, 950, 1250] }),
        heat({ id: "m3-h1", matchNumber: 3 })
      ],
      finals: [heat({ id: "final-h1", phase: "final", status: "completed", winnerEntryId: "car-c" })]
    });

    const standings = calculateStandings(state, "preliminary");
    expect(standings.map(({ carId }) => carId)).toEqual(["car-a", "car-b", "car-c"]);
    expect(standings.find(({ carId }) => carId === "car-a")).toMatchObject({
      matchWins: { "1": 2, "2": 0 },
      totalWins: 2,
      matchesWon: 1,
      completedHeats: 3,
      averageTimeMs: 960,
      bestTimeMs: 900,
      recentForm: ["win", "win", "loss"]
    });
    expect(calculateStandings(state, "final").find(({ carId }) => carId === "car-c")?.totalWins).toBe(1);
  });

  it("returns active zeroed standings when no result is official", () => {
    const standings = calculateStandings(eventState(), "preliminary");

    expect(standings).toHaveLength(3);
    expect(standings.every((standing) => standing.totalWins === 0 && standing.completedHeats === 0)).toBe(true);
  });
});
