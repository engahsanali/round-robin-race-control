import { describe, expect, it } from "vitest";

import { analyseSchedule, type Heat } from "@rr3/domain";

import { compareScheduleScores, generateCustomSchedule, scoreSchedule } from "./generate";
import { mulberry32, seedToUint32 } from "./prng";

type Score = readonly [number, number, number, number, number, number, number, number, number, string];

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
  const repeatBurden = new Map(ids.map((id) => [id, 0]));
  for (const [key, count] of pairCounts) {
    const [first, second] = JSON.parse(key) as [string, string];
    const excess = Math.max(0, count - 1);
    repeatBurden.set(first, repeatBurden.get(first)! + excess);
    repeatBurden.set(second, repeatBurden.get(second)! + excess);
  }
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
    pairFrequencies.reduce((total, count) => total + Math.max(0, count - 1), 0),
    pairFrequencies.length === 0 ? 0 : Math.max(...pairFrequencies),
    Math.max(0, ...repeatBurden.values()),
    [...repeatBurden.values()].reduce((total, burden) => total + burden * burden, 0),
    pairFrequencies.reduce((total, count) => total + count * count, 0),
    consecutiveByePenalty,
    immediateRepeatPenalty,
    JSON.stringify(heats.map((heat) => [...heat.lanes].filter((id): id is string => id !== null).sort()))
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

function twoCarFrequencySchedule(ids: readonly string[], frequencies: readonly number[]): Heat[] {
  const heats: Heat[] = [];
  let pairIndex = 0;
  let matchNumber = 1;
  for (let first = 0; first < ids.length; first += 1) {
    for (let second = first + 1; second < ids.length; second += 1) {
      for (let occurrence = 0; occurrence < (frequencies[pairIndex] ?? 0); occurrence += 1) {
        heats.push({
          id: `pair-${first}-${second}-${occurrence}`,
          phase: "preliminary",
          matchNumber,
          heatNumber: 1,
          lanes: [ids[first]!, ids[second]!, null],
          status: "scheduled",
          winnerEntryId: null,
          laneTimesMs: [null, null, null],
          notes: ""
        });
        matchNumber += 1;
      }
      pairIndex += 1;
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

describe("schedule opponent objective", () => {
  const ids = ["a", "b", "c", "d", "e"];

  it("scores the full approved objective tuple independently of lanes", () => {
    const first = twoCarFrequencySchedule(ids, [3, 2, 2]);
    const laneVariant = first.map((heat) => ({ ...heat, lanes: [null, heat.lanes[1], heat.lanes[0]] as Heat["lanes"] }));

    expect(scoreSchedule(first, ids).slice(0, 7)).toEqual([0, 7, 4, 3, 4, 22, 17]);
    expect(scoreSchedule(laneVariant, ids)).toEqual(scoreSchedule(first, ids));
  });

  it("prefers a lower worst per-car burden after repeat excess and maximum frequency tie", () => {
    const concentrated = scoreSchedule(twoCarFrequencySchedule(ids, [0, 0, 3, 3, 1]), ids);
    const distributed = scoreSchedule(twoCarFrequencySchedule(ids, [3, 2, 0, 0, 2]), ids);

    expect(concentrated.slice(0, 7)).toEqual([0, 5, 4, 3, 4, 24, 19]);
    expect(distributed.slice(0, 7)).toEqual([0, 5, 4, 3, 3, 22, 17]);
    expect(compareScheduleScores(distributed, concentrated)).toBeLessThan(0);
  });

  it("uses squared repeat burden before squared pair frequency", () => {
    const concentratedBurden = scoreSchedule(twoCarFrequencySchedule(ids, [3, 3, 1]), ids);
    const distributedBurden = scoreSchedule(twoCarFrequencySchedule(ids, [3, 2, 2]), ids);

    expect(concentratedBurden.slice(0, 7)).toEqual([0, 7, 4, 3, 4, 24, 19]);
    expect(distributedBurden.slice(0, 7)).toEqual([0, 7, 4, 3, 4, 22, 17]);
    expect(compareScheduleScores(distributedBurden, concentratedBurden)).toBeLessThan(0);
  });

  it("uses squared pair frequency when all earlier objective terms tie", () => {
    const lowerSquaredFrequency = scoreSchedule(twoCarFrequencySchedule(ids, [3, 1, 1]), ids);
    const higherSquaredFrequency = scoreSchedule(twoCarFrequencySchedule(ids, [3, 1, 1, 1]), ids);

    expect(lowerSquaredFrequency.slice(0, 7)).toEqual([0, 5, 2, 3, 2, 8, 11]);
    expect(higherSquaredFrequency.slice(0, 7)).toEqual([0, 5, 2, 3, 2, 8, 12]);
    expect(compareScheduleScores(lowerSquaredFrequency, higherSquaredFrequency)).toBeLessThan(0);
  });
});

describe("generateCustomSchedule", () => {
  it("returns byte-for-byte equal output for identical ordered IDs, options, and seed", () => {
    const ids = carIds(11);
    const options = { matches: 5, seed: "deterministic-example", restarts: 4, iterationsPerRestart: 80 };

    expect(JSON.stringify(generateCustomSchedule(ids, options))).toBe(
      JSON.stringify(generateCustomSchedule(ids, options))
    );
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
    expect(report.maximumLaneSpread).toBeLessThanOrEqual(1);
    expect(generated.score).toEqual(independentlyScore(generated.heats, ids));
    expect(generated.quality).toEqual(report);
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
