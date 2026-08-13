import { describe, expect, it } from "vitest";

import { selectFinalists } from "./finals";
import { calculateRankings } from "./rankings";
import type { Standing } from "./results";
import type { EventStateV1 } from "./types";

function standing(carId: string, totalWins: number, overrides: Partial<Standing> = {}): Standing {
  return {
    phase: "preliminary",
    carId,
    participantId: `participant-${carId}`,
    participantName: carId,
    carNumber: Number(carId.replace(/\D/g, "")) || 99,
    carName: carId,
    categoryId: "open",
    active: true,
    matchWins: totalWins ? { "1": totalWins } : {},
    totalWins,
    matchesWon: totalWins ? 1 : 0,
    completedHeats: totalWins,
    averageTimeMs: null,
    bestTimeMs: null,
    laneBalanceScore: 0,
    headToHeadWins: {},
    recentForm: [],
    ...overrides
  };
}

const settings: EventStateV1["settings"] = {
  scheduleMode: "custom",
  seed: "finals-test",
  rankingMode: "competition",
  allowSharedRanks: true,
  tieBreakOrder: ["totalWins"],
  finalistCount: 2,
  autoSave: true,
  confirmWinnerChanges: true,
  enableTiming: false,
  prices: {}
};

describe("selectFinalists", () => {
  it("returns the requested automatic qualifiers when the cutoff is resolved", () => {
    const rankings = calculateRankings([
      standing("car-1", 3), standing("car-2", 2), standing("car-3", 1)
    ], settings);

    const decision = selectFinalists(rankings, 2);
    expect(decision.automaticQualifiers.map(({ carId }) => carId)).toEqual(["car-1", "car-2"]);
    expect(decision.tiedCutoffEntrants).toEqual([]);
    expect(decision.allowedActions).toEqual([]);
  });

  it("separates automatic qualifiers from a tie spanning the cutoff", () => {
    const rankings = calculateRankings([
      standing("car-1", 3), standing("car-2", 2), standing("car-3", 2), standing("car-4", 1)
    ], settings);

    const decision = selectFinalists(rankings, 2);
    expect(decision.automaticQualifiers.map(({ carId }) => carId)).toEqual(["car-1"]);
    expect(decision.tiedCutoffEntrants.map(({ carId }) => carId)).toEqual(["car-2", "car-3"]);
    expect(decision.allowedActions).toEqual(["include-all", "playoff", "manual-with-reason"]);
  });

  it("never qualifies inactive, empty, or unranked entries", () => {
    const rankings = calculateRankings([
      standing("car-1", 1),
      standing("car-2", 0, { completedHeats: 1 }),
      standing("car-3", 0),
      standing("car-4", 4, { active: false })
    ], settings);

    const decision = selectFinalists(rankings, 10);
    expect(decision.automaticQualifiers.map(({ carId }) => carId)).toEqual(["car-1", "car-2"]);
    expect(decision.tiedCutoffEntrants).toEqual([]);

    const emptyDecision = selectFinalists(calculateRankings([standing("car-3", 0)], settings), 3);
    expect(emptyDecision).toMatchObject({ automaticQualifiers: [], tiedCutoffEntrants: [], allowedActions: [] });
  });
});
