import { describe, expect, it } from "vitest";

import { analyseSchedule, type Heat } from "@rr3/domain";

import { generateCustomSchedule } from "./generate";
import { mulberry32, seedToUint32 } from "./prng";

type Score = readonly [number, number, number, number, number, number, number, string];

function carIds(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `stable-car-${index + 1}`);
}

function pairKey(first: string, second: string): string {
  return JSON.stringify(first < second ? [first, second] : [second, first]);
}

function independentlyScore(heats: readonly Heat[], ids: readonly string[]): Score {
  const report = analyseSchedule(heats, ids);
  const pairCounts = new Map<string, number>();
  for (const heat of heats) {
    const assigned = heat.lanes.filter((id): id is string => id !== null);
    for (let first = 0; first < assigned.length; first += 1) {
      for (let second = first + 1; second < assigned.length; second += 1) {
        const key = pairKey(assigned[first]!, assigned[second]!);
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      }
    }
  }
  const pairFrequencies = [...pairCounts.values()];
  const weightedPairRepeatPenalty = pairFrequencies.reduce(
    (total, count) => total + Math.max(0, count - 1) + 4 * Math.max(0, count - 2),
    0
  );
  const heatsByMatch = new Map<number, Heat[]>();
  for (const heat of heats) {
    const match = heatsByMatch.get(heat.matchNumber) ?? [];
    match.push(heat);
    heatsByMatch.set(heat.matchNumber, match);
  }
  const matches = [...heatsByMatch].sort(([left], [right]) => left - right);
  let consecutiveByePenalty = 0;
  let immediateRepeatPenalty = 0;
  let previousByes = new Set<string>();
  let previousPairs = new Set<string>();
  for (const [, matchHeats] of matches) {
    const present = new Set(matchHeats.flatMap((heat) => heat.lanes.filter((id): id is string => id !== null)));
    const byes = new Set(ids.filter((id) => !present.has(id)));
    for (const id of byes) if (previousByes.has(id)) consecutiveByePenalty += 1;
    const pairs = new Set<string>();
    for (const heat of matchHeats) {
      const assigned = heat.lanes.filter((id): id is string => id !== null);
      for (let first = 0; first < assigned.length; first += 1) {
        for (let second = first + 1; second < assigned.length; second += 1) {
          pairs.add(pairKey(assigned[first]!, assigned[second]!));
        }
      }
    }
    for (const pair of pairs) if (previousPairs.has(pair)) immediateRepeatPenalty += 1;
    previousByes = byes;
    previousPairs = pairs;
  }
  return [
    report.errors.length,
    report.appearanceImbalance,
    weightedPairRepeatPenalty,
    pairFrequencies.length === 0 ? 0 : Math.max(...pairFrequencies),
    report.maximumLaneSpread,
    consecutiveByePenalty,
    immediateRepeatPenalty,
    JSON.stringify(heats.map((heat) => heat.lanes))
  ];
}

function naiveSequentialSchedule(ids: readonly string[], matches: number): Heat[] {
  const heats: Heat[] = [];
  for (let matchIndex = 0; matchIndex < matches; matchIndex += 1) {
    const usableCount = ids.length % 3 === 1 ? ids.length - 1 : ids.length;
    const assigned = ids.slice(0, usableCount);
    for (let offset = 0; offset < assigned.length; offset += 3) {
      const group = assigned.slice(offset, offset + 3);
      const lanes: Heat["lanes"] = [group[0] ?? null, group[1] ?? null, group[2] ?? null];
      heats.push({
        id: `naive-m${matchIndex + 1}-h${offset / 3 + 1}`,
        phase: "preliminary",
        matchNumber: matchIndex + 1,
        heatNumber: offset / 3 + 1,
        lanes,
        status: "scheduled",
        winnerEntryId: null,
        laneTimesMs: [null, null, null],
        notes: ""
      });
    }
  }
  return heats;
}

function compareScores(left: Score, right: Score): number {
  for (let index = 0; index < left.length; index += 1) {
    const comparison = left[index]! < right[index]! ? -1 : left[index]! > right[index]! ? 1 : 0;
    if (comparison !== 0) return comparison;
  }
  return 0;
}

describe("seeded random primitives", () => {
  it("maps equal seeds to equal uint32 values and distinguishes nearby seeds", () => {
    expect(seedToUint32("round-robin")).toBe(seedToUint32("round-robin"));
    expect(seedToUint32("round-robin")).not.toBe(seedToUint32("round-robin-2"));
    expect(seedToUint32("round-robin")).toBeGreaterThanOrEqual(0);
    expect(seedToUint32("round-robin")).toBeLessThanOrEqual(0xffff_ffff);
  });

  it("creates repeatable pseudo-random streams in the half-open unit interval", () => {
    const first = mulberry32(0x1234_5678);
    const second = mulberry32(0x1234_5678);
    const firstValues = Array.from({ length: 8 }, () => first());
    const secondValues = Array.from({ length: 8 }, () => second());

    expect(firstValues).toEqual(secondValues);
    expect(new Set(firstValues).size).toBeGreaterThan(1);
    expect(firstValues.every((value) => value >= 0 && value < 1)).toBe(true);
  });
});

describe("generateCustomSchedule", () => {
  it("returns byte-for-byte equal output for identical ordered IDs, options, and seed", () => {
    const ids = carIds(11);
    const options = { matches: 5, seed: "deterministic-example", restarts: 4, iterationsPerRestart: 80 };

    expect(generateCustomSchedule(ids, options)).toEqual(generateCustomSchedule(ids, options));
  });

  it("uses the seed to choose a different valid candidate", () => {
    const ids = carIds(10);
    const first = generateCustomSchedule(ids, { matches: 4, seed: "seed-a", restarts: 1, iterationsPerRestart: 1 });
    const second = generateCustomSchedule(ids, { matches: 4, seed: "seed-b", restarts: 1, iterationsPerRestart: 1 });

    expect(first.heats.map((heat) => heat.lanes)).not.toEqual(second.heats.map((heat) => heat.lanes));
  });

  it.each([3, 4, 5, 7, 8, 12, 19, 24])("creates valid stable-ID heats for %i entrants", (entrantCount) => {
    const ids = carIds(entrantCount);
    const generated = generateCustomSchedule(ids, {
      matches: 6,
      seed: `valid-${entrantCount}`,
      restarts: 2,
      iterationsPerRestart: 30
    });
    const report = analyseSchedule(generated.heats, ids);

    expect(report.status).not.toBe("invalid");
    expect(report.appearanceImbalance).toBeLessThanOrEqual(1);
    expect(generated.score).toEqual(independentlyScore(generated.heats, ids));
    expect(new Set(generated.heats.flatMap((heat) => heat.lanes).filter(Boolean))).toEqual(new Set(ids));
    for (const heat of generated.heats) {
      const assigned = heat.lanes.filter((id): id is string => id !== null);
      expect(assigned.length).toBeGreaterThanOrEqual(2);
      expect(new Set(assigned).size).toBe(assigned.length);
    }
    for (let matchNumber = 1; matchNumber <= 6; matchNumber += 1) {
      const assigned = generated.heats
        .filter((heat) => heat.matchNumber === matchNumber)
        .flatMap((heat) => heat.lanes)
        .filter((id): id is string => id !== null);
      expect(new Set(assigned).size).toBe(assigned.length);
    }
  });

  it("rotates the single bye required by four-modulo-three entrant counts", () => {
    const ids = carIds(7);
    const report = analyseSchedule(
      generateCustomSchedule(ids, { matches: 7, seed: "balanced-byes", restarts: 2, iterationsPerRestart: 40 }).heats,
      ids
    );

    expect(Object.values(report.byeCounts)).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(Object.values(report.twoCarHeatCounts)).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it("uses one two-car heat and no byes per match for two-modulo-three entrant counts", () => {
    const ids = carIds(8);
    const report = analyseSchedule(
      generateCustomSchedule(ids, { matches: 5, seed: "two-car", restarts: 2, iterationsPerRestart: 40 }).heats,
      ids
    );

    expect(Object.values(report.byeCounts)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(Object.values(report.twoCarHeatCounts).reduce((sum, count) => sum + count, 0)).toBe(10);
  });

  it("balances the vacant lane as well as entrants in two-car heats", () => {
    const ids = carIds(5);
    const generated = generateCustomSchedule(ids, {
      matches: 10,
      seed: "balanced-vacant-lane",
      restarts: 3,
      iterationsPerRestart: 60
    });
    const report = analyseSchedule(generated.heats, ids);

    expect(report.maximumLaneSpread).toBeLessThanOrEqual(1);
    const vacantLaneCounts = [0, 1, 2].map((lane) =>
      generated.heats.filter((heat) => heat.lanes[lane] === null).length
    );
    expect(Math.max(...vacantLaneCounts) - Math.min(...vacantLaneCounts)).toBeLessThanOrEqual(1);
  });

  it("preserves opaque stable IDs instead of treating array positions as identities", () => {
    const ids = ["car-900", "007", "alpha:id", "__proto__", "car-2"];
    const generated = generateCustomSchedule(ids, { matches: 3, seed: "opaque-ids", restarts: 2, iterationsPerRestart: 20 });
    const assigned = new Set(generated.heats.flatMap((heat) => heat.lanes).filter((id): id is string => id !== null));

    expect(assigned).toEqual(new Set(ids));
  });

  it("scores delimiter-containing stable IDs as distinct opponent pairs", () => {
    const ids = ["a", "b::c", "a::b", "c", "extra"];
    const generated = generateCustomSchedule(ids, {
      matches: 10,
      seed: "pair-key-collision",
      restarts: 1,
      iterationsPerRestart: 1
    });

    expect(generated.score).toEqual(independentlyScore(generated.heats, ids));
  });

  it.each([7, 8, 10, 11, 13, 16])("is lexicographically no worse than sequential grouping for %i entrants", (entrantCount) => {
    const ids = carIds(entrantCount);
    const generated = generateCustomSchedule(ids, { matches: 5, seed: `baseline-${entrantCount}` });
    const baselineScore = independentlyScore(naiveSequentialSchedule(ids, 5), ids);

    expect(compareScores(generated.score, baselineScore)).toBeLessThanOrEqual(0);
  });

  it.each([
    [carIds(2), { matches: 1, seed: "small" }],
    [carIds(25), { matches: 1, seed: "large" }],
    [["car-a", "car-a", "car-b"], { matches: 1, seed: "duplicate" }],
    [["car-a", "", "car-b"], { matches: 1, seed: "empty" }],
    [carIds(3), { matches: 0, seed: "matches" }],
    [carIds(3), { matches: 11, seed: "matches" }],
    [carIds(3), { matches: 1, seed: "restarts", restarts: 0 }],
    [carIds(3), { matches: 1, seed: "iterations", iterationsPerRestart: 0 }]
  ])("rejects unsupported or ambiguous scheduler input", (ids, options) => {
    expect(() => generateCustomSchedule(ids, options)).toThrow();
  });
});
