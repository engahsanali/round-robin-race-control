import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { analyseSchedule } from "@rr3/domain";

import { generateCustomSchedule } from "./generate";

describe("generateCustomSchedule properties", () => {
  it("stays deterministic, valid, and appearance-balanced for 3-24 entrants and 1-10 matches", () => {
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
