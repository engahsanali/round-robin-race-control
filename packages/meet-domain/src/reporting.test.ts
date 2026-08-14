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

  test.each(["=1+1", " +SUM(A1)", "\t@cmd", "\r-2", "\n=3"])("neutralizes formula-capable CSV cell %j", async (value) => {
    const domain = await meetDomain();
    expect(domain.toMeetCsv([[value]])).toMatch(/^'?/u);
    expect(domain.toMeetCsv([[value]]).startsWith("'") || domain.toMeetCsv([[value]]).startsWith("\"'")).toBe(true);
  });

  test("builds deterministic operations and privacy-safe public Event Packs", async () => {
    const domain = await meetDomain();
    const meet = state([bracket("q", "qualifier", [{ id: "formula", number: 1 }])]);
    meet.meet.name = "<script>alert(1)</script> Race";
    meet.brackets[0]!.event.participants[0]!.name = "Private Driver Name";
    meet.brackets[0]!.event.participants[0]!.email = "secret@example.test";
    meet.brackets[0]!.event.participants[0]!.phone = "0400000000";
    meet.auditLog.push({ id: "audit-1", timestamp: "2026-08-14T10:00:00Z", actorId: "private-actor", action: "meet.updated", entityType: "meet", entityId: meet.meet.id, reason: "private reason", before: { private: "before" }, after: { private: "after" } });
    const hosted = { state: meet, history: { snapshots: [], selections: [] }, heatVersions: {} };

    const operations = await domain.buildMeetEventPack(hosted, { audience: "operations", exportedAt: "2026-08-14T12:00:00.000Z", applicationVersion: "0.1.0" });
    expect(operations.map((file: any) => file.name)).toEqual([
      "backup.json", "summary.csv", "brackets.csv", "registrations.csv", "schedule.csv", "results.csv", "standings.csv",
      "advancement.csv", "final-results.csv", "audit.csv", "summary.txt", "printable-report.html", "manifest.json",
    ]);
    expect(operations.find((file: any) => file.name === "registrations.csv").text).toContain("secret@example.test");
    expect(operations.find((file: any) => file.name === "registrations.csv").text).toContain("Private Driver Name");

    const publicPack = await domain.buildMeetEventPack(hosted, { audience: "public", exportedAt: "2026-08-14T12:00:00.000Z", applicationVersion: "0.1.0" });
    const publicText = publicPack.map((file: any) => file.text).join("\n");
    expect(publicPack.some((file: any) => file.name === "backup.json")).toBe(false);
    expect(publicText).not.toContain("secret@example.test");
    expect(publicText).not.toContain("0400000000");
    expect(publicText).not.toContain("Private Driver Name");
    expect(publicText).not.toContain("private-actor");
    expect(publicText).not.toContain('"private":"before"');
    const html = publicPack.find((file: any) => file.name === "printable-report.html").text;
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; Race");
    expect(html).not.toMatch(/<script\b/iu);
    expect(html).toContain("Made by Cesar Lacsamana and Ahsan Ali");
  });
});
