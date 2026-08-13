import { describe, expect, it } from "vitest";

import type { Heat } from "./types";
import { analyseSchedule } from "./schedule-quality";

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

describe("analyseSchedule", () => {
  it("reports appearances, lane and opponent metrics for a complete three-car match", () => {
    const report = analyseSchedule([heat()], ["car-a", "car-b", "car-c"]);

    expect(report).toMatchObject({
      status: "valid",
      errors: [],
      warnings: [],
      appearances: { "car-a": 1, "car-b": 1, "car-c": 1 },
      laneCounts: { "car-a": [1, 0, 0], "car-b": [0, 1, 0], "car-c": [0, 0, 1] },
      pairCounts: {
        '["car-a","car-b"]': 1,
        '["car-a","car-c"]': 1,
        '["car-b","car-c"]': 1
      },
      repeatedOpponentCount: 0,
      maximumPairFrequency: 1,
      repeatExcessLowerBound: 0,
      repeatExcessGap: 0,
      maximumPairFrequencyLowerBound: 1,
      maximumPairFrequencyGap: 0,
      opponentQualityStatus: "certified-optimal",
      worstPerCarRepeatBurden: 0,
      squaredRepeatBurden: 0,
      squaredPairFrequency: 3,
      appearanceImbalance: 0,
      maximumLaneSpread: 1,
      byeCounts: { "car-a": 0, "car-b": 0, "car-c": 0 },
      twoCarHeatCounts: { "car-a": 0, "car-b": 0, "car-c": 0 }
    });
  });

  it("keeps cancelled heats in the appearance analysis without treating them as results", () => {
    const report = analyseSchedule([heat({ status: "cancelled" })], ["car-a", "car-b", "car-c"]);

    expect(report.status).toBe("valid");
    expect(report.appearances).toEqual({ "car-a": 1, "car-b": 1, "car-c": 1 });
    expect(report.errors).toEqual([]);
  });

  it("marks duplicate heat IDs, duplicate lane assignments, unknown cars, and invalid winners as errors", () => {
    const report = analyseSchedule([
      heat({ lanes: ["car-a", "car-a", "car-z"], winnerEntryId: "car-not-in-heat", status: "completed" }),
      heat({ matchNumber: 2, heatNumber: 1 })
    ], ["car-a", "car-b", "car-c"]);

    expect(report.status).toBe("invalid");
    expect(report.errors).toEqual(expect.arrayContaining([
      expect.stringMatching(/duplicate heat ID/i),
      expect.stringMatching(/more than once/i),
      expect.stringMatching(/unknown active car/i),
      expect.stringMatching(/winner.*assigned.*lane/i)
    ]));
  });

  it("rejects a car assigned to more than one heat in the same match", () => {
    const report = analyseSchedule([
      heat({ id: "heat-1", lanes: ["car-a", "car-b", "car-c"] }),
      heat({ id: "heat-2", heatNumber: 2, lanes: ["car-a", "car-d", "car-e"] })
    ], ["car-a", "car-b", "car-c", "car-d", "car-e"]);

    expect(report.status).toBe("invalid");
    expect(report.errors).toEqual(expect.arrayContaining([
      expect.stringMatching(/car-a.*more than once.*match/i)
    ]));
  });

  it("reports byes and two-car participation as warnings while retaining their schedule metrics", () => {
    const report = analyseSchedule([
      heat({ lanes: ["car-a", "car-b", null] }),
      heat({ id: "heat-2", matchNumber: 2, lanes: ["car-a", "car-c", "car-b"] })
    ], ["car-a", "car-b", "car-c"]);

    expect(report.status).toBe("valid-with-warnings");
    expect(report.byeCounts).toEqual({ "car-a": 0, "car-b": 0, "car-c": 1 });
    expect(report.twoCarHeatCounts).toEqual({ "car-a": 1, "car-b": 1, "car-c": 0 });
    expect(report.warnings).toEqual(expect.arrayContaining([
      expect.stringMatching(/bye/i),
      expect.stringMatching(/two-car/i)
    ]));
  });

  it("counts a bye once when a car misses every heat in a multi-heat match", () => {
    const report = analyseSchedule([
      heat({ id: "heat-1", lanes: ["car-a", "car-b", "car-c"] }),
      heat({ id: "heat-2", heatNumber: 2, lanes: ["car-d", "car-e", "car-f"] })
    ], ["car-a", "car-b", "car-c", "car-d", "car-e", "car-f", "car-g"]);

    expect(report.status).toBe("valid-with-warnings");
    expect(report.byeCounts).toMatchObject({ "car-g": 1 });
  });

  it("counts repeated opponents using sorted stable-ID pair keys", () => {
    const report = analyseSchedule([
      heat({ lanes: ["car-b", "car-a", "car-c"] }),
      heat({ id: "heat-2", matchNumber: 2, lanes: ["car-a", "car-b", "car-c"] })
    ], ["car-a", "car-b", "car-c"]);

    expect(report.pairCounts).toEqual({
      '["car-a","car-b"]': 2,
      '["car-a","car-c"]': 2,
      '["car-b","car-c"]': 2
    });
    expect(report.repeatedOpponentCount).toBe(3);
    expect(report.maximumPairFrequency).toBe(2);
  });

  it("counts every opponent repeat beyond the first occurrence", () => {
    const report = analyseSchedule([
      heat({ id: "heat-1", matchNumber: 1 }),
      heat({ id: "heat-2", matchNumber: 2 }),
      heat({ id: "heat-3", matchNumber: 3 })
    ], ["car-a", "car-b", "car-c"]);

    expect(report.pairCounts).toEqual({
      '["car-a","car-b"]': 3,
      '["car-a","car-c"]': 3,
      '["car-b","car-c"]': 3
    });
    expect(report.repeatedOpponentCount).toBe(6);
  });

  it("certifies the forced repeats for three entrants", () => {
    const report = analyseSchedule([
      heat({ id: "heat-1", matchNumber: 1 }),
      heat({ id: "heat-2", matchNumber: 2 })
    ], ["car-a", "car-b", "car-c"]);

    expect(report).toMatchObject({
      repeatedOpponentCount: 3,
      repeatExcessLowerBound: 3,
      repeatExcessGap: 0,
      maximumPairFrequency: 2,
      maximumPairFrequencyLowerBound: 2,
      maximumPairFrequencyGap: 0,
      opponentQualityStatus: "certified-optimal",
      worstPerCarRepeatBurden: 2,
      squaredRepeatBurden: 12,
      squaredPairFrequency: 12
    });
  });

  it("certifies the four-triple schedule for four entrants", () => {
    const report = analyseSchedule([
      heat({ id: "heat-1", matchNumber: 1, lanes: ["a", "b", "c"] }),
      heat({ id: "heat-2", matchNumber: 2, lanes: ["a", "b", "d"] }),
      heat({ id: "heat-3", matchNumber: 3, lanes: ["a", "c", "d"] }),
      heat({ id: "heat-4", matchNumber: 4, lanes: ["b", "c", "d"] })
    ], ["a", "b", "c", "d"]);

    expect(report).toMatchObject({
      repeatedOpponentCount: 6,
      repeatExcessLowerBound: 6,
      repeatExcessGap: 0,
      maximumPairFrequency: 2,
      maximumPairFrequencyLowerBound: 2,
      maximumPairFrequencyGap: 0,
      opponentQualityStatus: "certified-optimal"
    });
  });

  it("certifies the seven-entrant no-repeat triple-system gold standard", () => {
    const triples: Array<[string, string, string]> = [
      ["1", "2", "3"], ["1", "4", "5"], ["1", "6", "7"],
      ["2", "4", "6"], ["2", "5", "7"], ["3", "4", "7"], ["3", "5", "6"]
    ];
    const report = analyseSchedule(triples.map((lanes, index) => heat({
      id: `fano-${index + 1}`,
      matchNumber: index + 1,
      lanes
    })), ["1", "2", "3", "4", "5", "6", "7"]);

    expect(report).toMatchObject({
      repeatedOpponentCount: 0,
      repeatExcessLowerBound: 0,
      repeatExcessGap: 0,
      maximumPairFrequency: 1,
      maximumPairFrequencyLowerBound: 1,
      maximumPairFrequencyGap: 0,
      opponentQualityStatus: "certified-optimal",
      squaredPairFrequency: 21
    });
  });

  it("uses actual pair slots for a non-divisible schedule containing a two-car heat", () => {
    const report = analyseSchedule([
      heat({ id: "heat-1", lanes: ["a", "b", "c"] }),
      heat({ id: "heat-2", heatNumber: 2, lanes: ["d", "e", null] })
    ], ["a", "b", "c", "d", "e"]);

    expect(Object.keys(report.pairCounts)).toHaveLength(4);
    expect(report).toMatchObject({
      repeatedOpponentCount: 0,
      repeatExcessLowerBound: 0,
      repeatExcessGap: 0,
      maximumPairFrequency: 1,
      maximumPairFrequencyLowerBound: 1,
      maximumPairFrequencyGap: 0,
      opponentQualityStatus: "certified-optimal",
      squaredPairFrequency: 4
    });
  });

  it("reports a nonnegative best-found gap when a schedule misses its repeat lower bound", () => {
    const report = analyseSchedule([
      heat({ id: "heat-1", matchNumber: 1, lanes: ["a", "b", "c"] }),
      heat({ id: "heat-2", matchNumber: 2, lanes: ["a", "b", "c"] })
    ], ["a", "b", "c", "d"]);

    expect(report).toMatchObject({
      repeatedOpponentCount: 3,
      repeatExcessLowerBound: 0,
      repeatExcessGap: 3,
      maximumPairFrequency: 2,
      maximumPairFrequencyLowerBound: 1,
      maximumPairFrequencyGap: 1,
      opponentQualityStatus: "best-found"
    });
  });

  it("keeps delimiter-containing stable-ID pairs distinct", () => {
    const report = analyseSchedule([
      heat({ id: "heat-1", lanes: ["a", "b::c", null] }),
      heat({ id: "heat-2", matchNumber: 2, lanes: ["a::b", "c", null] })
    ], ["a", "b::c", "a::b", "c"]);

    expect(report.pairCounts).toEqual({
      '["a","b::c"]': 1,
      '["a::b","c"]': 1
    });
    expect(report.repeatedOpponentCount).toBe(0);
    expect(report.maximumPairFrequency).toBe(1);
  });
});
