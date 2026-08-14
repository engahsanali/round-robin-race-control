import { describe, expect, test } from "vitest";
import { bracket, state } from "./test-fixtures";

async function meetDomain(): Promise<any> { return import(`./${"index"}`).catch(() => null); }

describe("Meet reporting", () => {
  test("builds deterministic meet and bracket summaries", async () => {
    const domain = await meetDomain(); expect(domain).not.toBeNull(); if (!domain) return;
    const meet = state([bracket("q2", "qualifier", [{ id: "b", number: 2 }]), bracket("q1", "qualifier", [{ id: "a", number: 1 }])]);
    meet.brackets[0]!.displayOrder = 2;
    expect(domain.buildMeetSummaryRows(meet)).toEqual([
      ["Meet ID", "Meet", "Date", "Venue", "Status", "Bracket count"],
      ["meet", "Meet", "2026-08-14", "Track", "setup", 2]
    ]);
    expect(domain.buildBracketSummaryRows(meet).slice(1).map((row: unknown[]) => row[0])).toEqual(["q1", "q2"]);
  });

  test("escapes spreadsheet formulas in every Meet CSV export and creates a stable manifest", async () => {
    const domain = await meetDomain(); expect(domain).not.toBeNull(); if (!domain) return;
    const meet = state([bracket("q", "qualifier", [{ id: "formula", number: 1 }])]);
    meet.brackets[0]!.event.participants[0]!.name = "=HYPERLINK(\"https://bad.example\")";
    const csv = domain.toMeetCsv(domain.buildMeetRegistrationRows(meet));
    expect(csv).toContain("'=HYPERLINK");
    expect(domain.buildMeetExportManifest(meet)).toEqual([
      { key: "meet-summary", fileName: "meet-summary.csv" },
      { key: "bracket-summary", fileName: "bracket-summary.csv" },
      { key: "registrations", fileName: "registrations.csv" }
    ]);
  });
});
