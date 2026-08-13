import { describe, expect, it } from "vitest";

import { calculateRankings, explainRank } from "./rankings";
import type { Standing } from "./results";
import type { EventStateV1 } from "./types";

function standing(carId: string, totalWins: number, overrides: Partial<Standing> = {}): Standing {
  return {
    phase: "preliminary",
    carId,
    participantId: `participant-${carId}`,
    participantName: `Participant ${carId}`,
    carNumber: Number(carId.replace(/\D/g, "")) || 99,
    carName: `Car ${carId}`,
    categoryId: "open",
    active: true,
    matchWins: totalWins === 0 ? {} : { "1": totalWins },
    totalWins,
    matchesWon: totalWins === 0 ? 0 : 1,
    completedHeats: totalWins === 0 ? 0 : totalWins,
    averageTimeMs: null,
    bestTimeMs: null,
    laneBalanceScore: 0,
    headToHeadWins: {},
    recentForm: [],
    ...overrides
  };
}

function settings(overrides: Partial<EventStateV1["settings"]> = {}): EventStateV1["settings"] {
  return {
    scheduleMode: "custom",
    seed: "ranking-test",
    rankingMode: "competition",
    allowSharedRanks: true,
    tieBreakOrder: ["totalWins"],
    finalistCount: 3,
    autoSave: true,
    confirmWinnerChanges: true,
    enableTiming: true,
    prices: {},
    ...overrides
  };
}

describe("calculateRankings", () => {
  it("assigns competition ranks without silently using car number", () => {
    const rankings = calculateRankings([
      standing("car-4", 1),
      standing("car-3", 2),
      standing("car-1", 3),
      standing("car-2", 2)
    ], settings());

    expect(rankings.map(({ carId, rank }) => [carId, rank])).toEqual([
      ["car-1", 1],
      ["car-2", 2],
      ["car-3", 2],
      ["car-4", 4]
    ]);
    expect(rankings.filter(({ rank }) => rank === 2).every(({ isTied, displayOrderIsCompetitive }) => isTied && !displayOrderIsCompetitive)).toBe(true);
  });

  it("assigns dense ranks", () => {
    const rankings = calculateRankings([
      standing("car-1", 3), standing("car-2", 2), standing("car-3", 2), standing("car-4", 1)
    ], settings({ rankingMode: "dense" }));

    expect(rankings.map(({ rank }) => rank)).toEqual([1, 2, 2, 3]);
  });

  it("applies configured tie breaks in order", () => {
    const rankings = calculateRankings([
      standing("car-2", 2, { matchesWon: 2, averageTimeMs: 1100 }),
      standing("car-1", 2, { matchesWon: 1, averageTimeMs: 900 }),
      standing("car-3", 2, { matchesWon: 1, averageTimeMs: 1000 })
    ], settings({ tieBreakOrder: ["totalWins", "matchesWon", "averageTime"] }));

    expect(rankings.map(({ carId, rank }) => [carId, rank])).toEqual([
      ["car-2", 1],
      ["car-1", 2],
      ["car-3", 3]
    ]);
  });

  it("uses head-to-head wins within the tied group", () => {
    const rankings = calculateRankings([
      standing("car-1", 2, { headToHeadWins: { "car-2": 1, "car-3": 1 } }),
      standing("car-2", 2, { headToHeadWins: { "car-1": 0, "car-3": 1 } }),
      standing("car-3", 2, { headToHeadWins: { "car-1": 0, "car-2": 0 } })
    ], settings({ tieBreakOrder: ["totalWins", "headToHead"] }));

    expect(rankings.map(({ carId, rank }) => [carId, rank])).toEqual([
      ["car-1", 1], ["car-2", 2], ["car-3", 3]
    ]);
  });

  it("keeps unresolved ties visible while storing deterministic non-competitive UI order", () => {
    const rankings = calculateRankings([
      standing("car-z", 2, { carNumber: 1 }),
      standing("car-a", 2, { carNumber: 99 })
    ], settings());

    expect(rankings.map(({ carId, rank }) => [carId, rank])).toEqual([["car-a", 1], ["car-z", 1]]);
    expect(rankings[0]!).toMatchObject({
      isTied: true,
      tiedWithCarIds: ["car-z"],
      displayOrder: 1,
      displayOrderIsCompetitive: false
    });
    expect(rankings[0]!.displayOrderReason).toMatch(/stable ID.*non-competitive/i);
  });

  it("treats car number as competitive only when explicitly configured", () => {
    const rankings = calculateRankings([
      standing("car-a", 2, { carNumber: 9 }),
      standing("car-z", 2, { carNumber: 1 })
    ], settings({ tieBreakOrder: ["totalWins", "carNumber"] }));

    expect(rankings.map(({ carId, rank }) => [carId, rank])).toEqual([["car-z", 1], ["car-a", 2]]);
    expect(rankings.every(({ displayOrderIsCompetitive }) => displayOrderIsCompetitive)).toBe(true);
  });

  it("does not assign podium ranks before any official result", () => {
    const rankings = calculateRankings([standing("car-1", 0), standing("car-2", 0)], settings());

    expect(rankings.map(({ rank }) => rank)).toEqual([null, null]);
  });

  it("rejects ordinal ranking while configured tie breaks remain unresolved", () => {
    expect(() => calculateRankings(
      [standing("car-1", 2), standing("car-2", 2)],
      settings({ rankingMode: "ordinal", allowSharedRanks: false })
    )).toThrow(/ordinal.*resolve every tie/i);
  });

  it("explains the score and each configured ranking comparison", () => {
    const rankings = calculateRankings([
      standing("car-1", 2, { matchesWon: 2 }),
      standing("car-2", 2, { matchesWon: 1 })
    ], settings({ tieBreakOrder: ["totalWins", "matchesWon"] }));

    expect(explainRank("car-1", rankings)).toMatchObject({
      carId: "car-1",
      rank: 1,
      isTied: false,
      comparisons: [
        { key: "totalWins", value: 2 },
        { key: "matchesWon", value: 2 }
      ]
    });
    expect(() => explainRank("missing-car", rankings)).toThrow(/unknown ranked car/i);
  });
});
