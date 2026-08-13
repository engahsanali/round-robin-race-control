import { describe, expect, it } from "vitest";

import demoEvent from "../../../fixtures/demo-event.json";
import {
  buildAuditRows,
  buildFeesRows,
  buildRegistrationRows,
  buildResultsRows,
  buildStandingsRows,
  toCsv
} from "./csv";
import type { EventStateV1 } from "./types";

describe("safe CSV", () => {
  it("uses CRLF, preserves Unicode, and escapes commas, quotes, CR, and LF", () => {
    expect(toCsv([
      ["plain", "César 🏁", "comma,value", "say \"go\"", "line\nfeed", "carriage\rreturn"],
      [null, 42, true, false]
    ])).toBe("plain,César 🏁,\"comma,value\",\"say \"\"go\"\"\",\"line\nfeed\",\"carriage\rreturn\"\r\n,42,true,false");
  });

  it.each([
    ["=2+2", "'=2+2"],
    ["+cmd", "'+cmd"],
    ["-10+2", "'-10+2"],
    ["@SUM(A1)", "'@SUM(A1)"],
    ["  =HYPERLINK(\"x\")", "\"'  =HYPERLINK(\"\"x\"\")\""],
    ["\t+1", "'\t+1"]
  ])(
    "prefixes formula-capable text without executing or reinterpreting it: %s",
    (value, expected) => {
      expect(toCsv([[value]])).toBe(expected);
    }
  );

  it("does not alter harmless signs that occur after ordinary text", () => {
    expect(toCsv([["car-1", "email@example.test", "  ordinary - text"]])).toBe("car-1,email@example.test,  ordinary - text");
  });

  it("builds deterministic registration, fees, results, standings, and audit rows", () => {
    const state = structuredClone(demoEvent) as unknown as EventStateV1;

    const reports = [
      buildRegistrationRows(state),
      buildFeesRows(state),
      buildResultsRows(state),
      buildStandingsRows(state, "preliminary"),
      buildAuditRows(state)
    ];

    for (const rows of reports) {
      expect(rows.length).toBeGreaterThan(1);
      expect(toCsv(rows)).toBe(toCsv(structuredClone(rows)));
    }
    expect(buildRegistrationRows(state)[1]).toEqual(expect.arrayContaining(["participant-01", "car-01", 1]));
    expect(buildFeesRows(state)[1]).toEqual(expect.arrayContaining(["participant-01", 1200, 1200, 0]));
    expect(buildResultsRows(state)[1]).toEqual(expect.arrayContaining(["pre-m01-h01", "car-01"]));
    expect(buildStandingsRows(state, "preliminary")[1]).toEqual(expect.arrayContaining(["car-01", 2]));
    expect(buildAuditRows(state)[1]).toEqual(expect.arrayContaining(["audit-demo-created"]));
  });

  it("protects user text emitted by report builders from spreadsheet formulas", () => {
    const state = structuredClone(demoEvent) as unknown as EventStateV1;
    state.participants[0]!.name = " =HYPERLINK(\"https://example.test\")";

    const csv = toCsv(buildRegistrationRows(state));

    expect(csv).toContain("' =HYPERLINK");
  });

  it("serializes audit detail keys deterministically", () => {
    const first = structuredClone(demoEvent) as unknown as EventStateV1;
    const second = structuredClone(demoEvent) as unknown as EventStateV1;
    first.auditLog[0]!.details = { alpha: 1, nested: { beta: 2, gamma: 3 } };
    second.auditLog[0]!.details = { nested: { gamma: 3, beta: 2 }, alpha: 1 };

    expect(toCsv(buildAuditRows(first))).toBe(toCsv(buildAuditRows(second)));
  });

  it("orders Unicode IDs by locale-independent UTF-16 code units", () => {
    const state = structuredClone(demoEvent) as unknown as EventStateV1;
    state.entries = state.entries.slice(0, 2);
    state.entries[0]!.id = "entry-ä";
    state.entries[1]!.id = "entry-z";
    state.entries[0]!.carNumber = 1;
    state.entries[1]!.carNumber = 1;
    state.matches = state.matches.slice(0, 2);
    state.matches[0]!.id = "heat-ä";
    state.matches[1]!.id = "heat-z";
    state.matches[0]!.matchNumber = 1;
    state.matches[1]!.matchNumber = 1;
    state.matches[0]!.heatNumber = 1;
    state.matches[1]!.heatNumber = 1;
    state.auditLog[0]!.id = "audit-ä";
    state.auditLog[1]!.id = "audit-z";
    state.auditLog[0]!.timestamp = "2026-08-13T01:00:00.000Z";
    state.auditLog[1]!.timestamp = "2026-08-13T01:00:00.000Z";

    expect(buildRegistrationRows(state).slice(1).map((row) => row[4])).toEqual(["entry-z", "entry-ä"]);
    expect(buildResultsRows(state).slice(1).map((row) => row[0])).toEqual(["heat-z", "heat-ä"]);
    expect(buildAuditRows(state).slice(1).map((row) => row[0])).toEqual(["audit-z", "audit-ä"]);
  });
});
