import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { analyseSchedule } from "@rr3/domain";

import { generateCustomSchedule } from "./generate";

describe("generateCustomSchedule properties", () => {
  it("keeps every entrant within one lane assignment across the full supported size matrix", () => {
    for (let entrantCount = 3; entrantCount <= 24; entrantCount += 1) {
      for (let matches = 1; matches <= 10; matches += 1) {
        const ids = Array.from({ length: entrantCount }, (_, index) => `matrix/${index + 1}`);
        const generated = generateCustomSchedule(ids, {
          matches,
          seed: `matrix-${entrantCount}-${matches}`,
          restarts: 1,
          iterationsPerRestart: 1
        });

        expect(analyseSchedule(generated.heats, ids).maximumLaneSpread).toBeLessThanOrEqual(1);
        const vacantLaneCounts = [0, 1, 2].map((lane) =>
          generated.heats.filter((heat) => heat.lanes[lane] === null).length
        );
        expect(Math.max(...vacantLaneCounts) - Math.min(...vacantLaneCounts)).toBeLessThanOrEqual(1);
      }
    }
  });

  it("stays deterministic, valid, appearance-balanced, and lane-balanced for 3-24 entrants and 1-10 matches", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 3, max: 24 }),
        fc.integer({ min: 1, max: 10 }),
        fc.string({ maxLength: 24 }),
        (entrantCount, matches, seed) => {
          const ids = Array.from({ length: entrantCount }, (_, index) => `entrant/${index * 17 + 3}`);
          const options = { matches, seed, restarts: 1, iterationsPerRestart: 12 };
          const first = generateCustomSchedule(ids, options);
          const second = generateCustomSchedule(ids, options);
          const report = analyseSchedule(first.heats, ids);

          expect(first).toEqual(second);
          expect(report.status).not.toBe("invalid");
          expect(report.appearanceImbalance).toBeLessThanOrEqual(1);
          expect(report.maximumLaneSpread).toBeLessThanOrEqual(1);
          expect(first.quality).toEqual(report);
          expect([
            report.repeatExcessLowerBound,
            report.repeatExcessGap,
            report.maximumPairFrequencyLowerBound,
            report.maximumPairFrequencyGap
          ].every((value) => Number.isSafeInteger(value) && value >= 0)).toBe(true);
          expect(Object.keys(report.appearances)).toHaveLength(entrantCount);

          for (let matchNumber = 1; matchNumber <= matches; matchNumber += 1) {
            const assigned = first.heats
              .filter((heat) => heat.matchNumber === matchNumber)
              .flatMap((heat) => heat.lanes)
              .filter((id): id is string => id !== null);
            expect(new Set(assigned).size).toBe(assigned.length);
            expect(assigned.every((id) => ids.includes(id))).toBe(true);
          }
        }
      ),
      { numRuns: 80 }
    );
  });
});
