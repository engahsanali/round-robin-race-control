import "fake-indexeddb/auto";

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordWinner, validateEventState, type EventStateV1 } from "@rr3/domain";
import demoEventJson from "../../../../../fixtures/demo-event.json";
import { FinalsPage } from "../finals/FinalsPage";
import { ReportsPage, buildEventPack } from "../reports/ReportsPage";
import { createProDatabase, type ProDatabase } from "../../persistence/db";
import { EventRepository } from "../../persistence/repository";
import { EventProvider } from "../../state/EventProvider";
import { StandingsPage } from "./StandingsPage";

let database: ProDatabase;
let repository: EventRepository;
let sequence = 0;

function demoEvent(): EventStateV1 {
  const parsed = validateEventState(structuredClone(demoEventJson));
  if (!parsed.success) throw new Error("Demo fixture must validate");
  return parsed.data;
}

beforeEach(async () => {
  sequence += 1;
  database = createProDatabase(`rr3-pro-insights-${sequence}`);
  repository = new EventRepository(database);
  await repository.save(demoEvent(), {
    commandId: `insight-bootstrap-${sequence}`,
    timestamp: "2026-08-14T07:00:00.000Z",
    summary: "Loaded insight fixture",
  });
});

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  database.close();
  await database.delete();
});

function renderWithEvent(node: React.ReactNode) {
  let id = 0;
  return render(
    <EventProvider repository={repository} now={() => "2026-08-14T07:05:00.000Z"} createId={() => `insight-command-${sequence}-${++id}`}>
      {node}
    </EventProvider>,
  );
}

describe("Standings and Insight Studio", () => {
  it("keeps the semantic standings authoritative and explains the configured tie-break path directly", async () => {
    const user = userEvent.setup();
    renderWithEvent(<StandingsPage />);
    const table = await screen.findByRole("table", { name: "Preliminary standings" });
    expect(within(table).getByRole("row", { name: /Car 1/ }).textContent).toMatch(/1.*Sample 01 - Ada.*2/);
    expect(within(table).getByRole("row", { name: /Car 7/ }).textContent).toMatch(/2.*Sample 07 - Gia.*2/);

    await user.click(within(table).getByRole("button", { name: "Why is Car 1 ranked here?" }));
    const proof = screen.getByRole("dialog", { name: "Why Car 1 is ranked here" });
    expect(within(proof).getByText(/Competitive rank 1/)).toBeTruthy();
    expect(within(proof).getAllByRole("row").slice(1).map((row) => row.textContent?.replaceAll(/\s+/g, " "))).toEqual([
      expect.stringMatching(/totalWins.*2/i),
      expect.stringMatching(/headToHead.*1/i),
      expect.stringMatching(/matchesWon.*2/i),
      expect.stringMatching(/playoff.*not available/i),
    ]);
    await user.click(within(proof).getByRole("button", { name: "Close rank proof" }));

    await user.selectOptions(screen.getByRole("combobox", { name: "Standings phase" }), "final");
    expect(screen.getByText(/No official final result exists yet/i)).toBeTruthy();
  });

  it("pairs every insight graphic with a takeaway and accessible data", async () => {
    renderWithEvent(<StandingsPage />);
    await screen.findByRole("heading", { name: "Insight Studio" });
    for (const name of ["Leader gap", "Rank history", "Cumulative wins", "Win distribution", "Lane balance", "Head-to-head matrix", "Consistency", "Qualification cutoff"]) {
      const region = screen.getByRole("region", { name });
      expect(within(region).getByRole("img")).toBeTruthy();
      expect(within(region).getByText(/Takeaway:/)).toBeTruthy();
      expect(within(region).getByRole("table")).toBeTruthy();
    }
  });
});

describe("Finals, event pack, and replay", () => {
  it("surfaces cutoff ties and records a reasoned manual qualification without arbitrary selection", async () => {
    const user = userEvent.setup();
    const tiedCutoff = demoEvent();
    tiedCutoff.settings.tieBreakOrder = ["totalWins", "playoff"];
    await repository.save(tiedCutoff, { commandId: `cutoff-${sequence}`, timestamp: "2026-08-14T07:01:00.000Z", summary: "Configured playoff cutoff" });
    renderWithEvent(<FinalsPage />);
    await screen.findByRole("heading", { name: "Finals" });
    expect((await screen.findByRole("region", { name: "Qualification cutoff" })).textContent).toMatch(/Car 4.*Car 5.*include all.*playoff.*manual/i);
    await user.click(screen.getByRole("radio", { name: /Choose Car 4/ }));
    await user.click(screen.getByRole("button", { name: "Apply reasoned manual decision" }));
    expect(screen.getByRole("alert").textContent).toMatch(/reason is required/i);
    await user.type(screen.getByRole("textbox", { name: "Manual qualification reason" }), "Verified runoff result sheet");
    await user.click(screen.getByRole("button", { name: "Apply reasoned manual decision" }));
    await waitFor(async () => expect((await repository.load())?.auditLog.at(-1)?.summary).toMatch(/Car 4.*Verified runoff result sheet/i));
    expect(screen.getByRole("region", { name: "Final schedule" }).textContent).toMatch(/Resolved finalists:.*Car 1.*Car 7.*Car 4/i);
    expect(screen.getByRole("button", { name: "Seal official champion" })).toHaveProperty("disabled", true);
  });

  it("builds deterministic compatible Event Pack bytes and restores only after preview and confirmation", async () => {
    const current = recordWinner({ ...demoEvent(), event: { ...demoEvent().event, updatedAt: "2026-08-14T07:02:00.000Z" } }, "pre-m02-h03", "car-06");
    await repository.save(current, { commandId: `insight-result-${sequence}`, timestamp: "2026-08-14T07:02:00.000Z", summary: "Recorded result for replay" });
    const malicious = structuredClone(current);
    malicious.participants[0]!.name = "=SUM(1,1)";
    const pack = buildEventPack(malicious);
    expect(pack.map(({ name }) => name)).toEqual([
      "event.json", "registration.csv", "accounts.csv", "results.csv", "standings-preliminary.csv", "standings-finals.csv", "audit.csv", "summary.txt",
    ]);
    expect(JSON.parse(pack[0]!.text)).toEqual(malicious);
    expect(pack.find(({ name }) => name === "registration.csv")?.text).toContain("'=SUM(1,1)");
    expect(pack.find(({ name }) => name === "summary.txt")?.text).toContain("Made by Cesar Lacsamana and Ahsan Ali");

    const user = userEvent.setup();
    renderWithEvent(<ReportsPage />);
    const timeline = await screen.findByRole("region", { name: "Replay timeline" });
    expect(within(timeline).getAllByRole("listitem")).toHaveLength(2);
    await user.click(within(timeline).getByRole("button", { name: /Preview Loaded insight fixture/ }));
    expect(await within(timeline).findByText(/1 heat result will change/i)).toBeTruthy();
    await user.click(within(timeline).getByRole("button", { name: "Restore this revision" }));
    expect(within(timeline).getByText(/confirm restoration/i)).toBeTruthy();
    await user.click(within(timeline).getByRole("button", { name: "Confirm restore" }));
    await waitFor(async () => expect((await repository.load())?.matches.find(({ id }) => id === "pre-m02-h03")?.status).toBe("scheduled"));
  });
});
