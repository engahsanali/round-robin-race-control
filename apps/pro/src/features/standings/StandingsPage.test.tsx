import "fake-indexeddb/auto";

import { useEffect } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordWinner, validateEventState, type EventStateV1 } from "@rr3/domain";
import demoEventJson from "../../../../../fixtures/demo-event.json";
import { FinalsPage } from "../finals/FinalsPage";
import { ReportsPage, buildEventPack } from "../reports/ReportsPage";
import { createProDatabase, type ProDatabase } from "../../persistence/db";
import { EventRepository } from "../../persistence/repository";
import { EventProvider } from "../../state/EventProvider";
import { RehearsalWorkspaceProvider, useRehearsalWorkspace } from "../../state/RehearsalWorkspace";
import { ReplayTimeline, compareEventStates } from "../history/ReplayTimeline";
import { StandingsPage } from "./StandingsPage";

let database: ProDatabase;
let repository: EventRepository;
let sequence = 0;
let providerCommandSequence = 0;

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
  return render(
    <EventProvider repository={repository} now={() => "2026-08-14T07:05:00.000Z"} createId={() => `insight-command-${sequence}-${++providerCommandSequence}`}>
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
    expect(document.activeElement).toBe(within(proof).getByRole("button", { name: "Close rank proof" }));
    expect(within(proof).getByText(/Competitive rank 1/)).toBeTruthy();
    expect(within(proof).getAllByRole("row").slice(1).map((row) => row.textContent?.replaceAll(/\s+/g, " "))).toEqual([
      expect.stringMatching(/totalWins.*2/i),
      expect.stringMatching(/headToHead.*1/i),
      expect.stringMatching(/matchesWon.*2/i),
      expect.stringMatching(/playoff.*not available/i),
    ]);
    fireEvent(proof, new Event("cancel", { cancelable: true }));
    expect(screen.queryByRole("dialog", { name: "Why Car 1 is ranked here" })).toBeNull();
    expect(document.activeElement).toBe(within(table).getByRole("button", { name: "Why is Car 1 ranked here?" }));

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

  it("withholds unresolved ordinal ranks without crashing standings, finals, reports, replay, or insights", async () => {
    const ordinal = demoEvent();
    ordinal.settings.rankingMode = "ordinal";
    ordinal.settings.tieBreakOrder = ["totalWins", "playoff"];
    await repository.save(ordinal, { commandId: `ordinal-${sequence}`, timestamp: "2026-08-14T07:02:00.000Z", summary: "Ordinal fixture" });

    renderWithEvent(<StandingsPage />);
    expect((await screen.findByRole("status")).textContent).toMatch(/ordinal ranks are withheld.*unresolved tie/i);
    expect(screen.getByRole("table", { name: "Preliminary standings" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Rank history" })).toBeTruthy();
    cleanup();

    renderWithEvent(<FinalsPage />);
    expect(await screen.findByRole("heading", { name: "Finals" })).toBeTruthy();
    expect((await screen.findByRole("status")).textContent).toMatch(/ordinal ranks are withheld/i);
    cleanup();

    expect(() => buildEventPack(ordinal)).not.toThrow();
    const changed = structuredClone(ordinal);
    changed.event.name = "Changed ordinal event";
    expect(compareEventStates(changed, ordinal)).toMatchObject({ eventFactChanges: 1 });
  });

  it("shows every authoritative standing field and never invents a leader before results", async () => {
    const empty = demoEvent();
    empty.matches = empty.matches.map((heat) => ({ ...heat, status: "scheduled", winnerEntryId: null, laneTimesMs: [null, null, null] }));
    await repository.save(empty, { commandId: `empty-${sequence}`, timestamp: "2026-08-14T07:03:00.000Z", summary: "Empty standings fixture" });

    renderWithEvent(<StandingsPage />);
    const table = await screen.findByRole("table", { name: "Preliminary standings" });
    for (const heading of ["Match 1 wins", "Match 2 wins", "Qualification", "Recent form"]) {
      expect(within(table).getByRole("columnheader", { name: heading })).toBeTruthy();
    }
    expect(screen.getByRole("region", { name: "Leader gap" }).textContent).toMatch(/No official result yet/i);
    expect(screen.queryByText(/leads by/i)).toBeNull();
    expect(screen.getByRole("region", { name: "Qualification cutoff" }).textContent).toMatch(/provisional.*no official result/i);
  });
});

describe("Finals, event pack, and replay", () => {
  it("surfaces cutoff ties and records a reasoned manual qualification without arbitrary selection", async () => {
    const user = userEvent.setup();
    const tiedCutoff = demoEvent();
    tiedCutoff.settings.tieBreakOrder = ["totalWins", "playoff"];
    await repository.save(tiedCutoff, { commandId: `cutoff-${sequence}`, timestamp: "2026-08-14T07:01:00.000Z", summary: "Configured playoff cutoff" });
    renderWithEvent(<FinalsPage />);
    await screen.findByRole("region", { name: "Qualification cutoff" });
    expect((await screen.findByRole("region", { name: "Qualification cutoff" })).textContent).toMatch(/Car 4.*Car 5.*include all.*playoff.*manual/i);
    await user.click(screen.getByRole("checkbox", { name: /Choose Car 4/ }));
    await user.click(screen.getByRole("button", { name: "Apply reasoned manual decision" }));
    expect(screen.getByRole("alert").textContent).toMatch(/reason is required/i);
    await user.type(screen.getByRole("textbox", { name: "Manual qualification reason" }), "Verified runoff result sheet");
    await user.click(screen.getByRole("button", { name: "Apply reasoned manual decision" }));
    await waitFor(async () => expect((await repository.load())?.auditLog.at(-1)?.summary).toMatch(/Car 4.*Verified runoff result sheet/i));
    expect((await within(screen.getByRole("region", { name: "Final schedule" })).findByText(/Resolved finalists:/i)).textContent).toMatch(/Car 1.*Car 7.*Car 4/i);
    expect(screen.getByRole("button", { name: "Seal official champion" })).toHaveProperty("disabled", true);
  });

  it("requires the exact number of tied places and never treats a requested playoff as resolved", async () => {
    const user = userEvent.setup();
    const multiPlaceTie = demoEvent();
    multiPlaceTie.settings.finalistCount = 4;
    multiPlaceTie.settings.tieBreakOrder = ["totalWins", "playoff"];
    const winners = new Map([
      ["pre-m01-h01", "car-01"], ["pre-m02-h01", "car-01"], ["pre-m03-h01", "car-01"],
      ["pre-m02-h02", "car-02"], ["pre-m03-h02", "car-02"],
      ["pre-m02-h03", "car-03"], ["pre-m01-h02", "car-04"], ["pre-m03-h03", "car-05"],
    ]);
    multiPlaceTie.matches = multiPlaceTie.matches.map((heat) => {
      const winner = winners.get(heat.id) ?? null;
      return { ...heat, status: winner ? "completed" as const : "scheduled" as const, winnerEntryId: winner, laneTimesMs: [null, null, null] };
    });
    await repository.save(multiPlaceTie, { commandId: `multi-cutoff-${sequence}`, timestamp: "2026-08-14T07:04:00.000Z", summary: "Multiple cutoff places" });
    renderWithEvent(<FinalsPage />);
    await screen.findByRole("heading", { name: "Finals" });

    await user.click(await screen.findByRole("checkbox", { name: /Choose Car 3/ }));
    await user.type(screen.getByRole("textbox", { name: "Manual qualification reason" }), "Verified runoff sheet");
    await user.click(screen.getByRole("button", { name: "Apply reasoned manual decision" }));
    expect(screen.getByRole("alert").textContent).toMatch(/choose exactly 2 tied cars/i);
    await user.click(screen.getByRole("checkbox", { name: /Choose Car 4/ }));
    await user.click(screen.getByRole("button", { name: "Apply reasoned manual decision" }));
    await waitFor(async () => expect((await repository.load())?.auditLog.at(-2)?.details).toMatchObject({ qualifiedCarIds: ["car-01", "car-02", "car-03", "car-04"], resolution: "resolved" }));

    cleanup();
    const playoff = demoEvent();
    playoff.settings.tieBreakOrder = ["totalWins", "playoff"];
    await repository.save(playoff, { commandId: `playoff-${sequence}`, timestamp: "2026-08-14T07:05:00.000Z", summary: "Playoff fixture" });
    renderWithEvent(<FinalsPage />);
    await screen.findByRole("region", { name: "Qualification cutoff" });
    await user.click(screen.getByRole("button", { name: "Require playoff" }));
    expect(screen.getByRole("button", { name: "Generate and activate finals" })).toHaveProperty("disabled", true);
    expect(await within(screen.getByRole("region", { name: "Final schedule" })).findByText(/playoff.*must be resolved/i)).toBeTruthy();
  });

  it("invalidates a persisted qualification decision after its standings basis changes", async () => {
    const user = userEvent.setup();
    const tied = demoEvent();
    tied.settings.tieBreakOrder = ["totalWins", "playoff"];
    await repository.save(tied, { commandId: `stale-base-${sequence}`, timestamp: "2026-08-14T07:06:00.000Z", summary: "Stale qualification base" });
    const view = renderWithEvent(<FinalsPage />);
    await screen.findByRole("region", { name: "Qualification cutoff" });
    await user.click(screen.getByRole("checkbox", { name: /Choose Car 4/ }));
    await user.type(screen.getByRole("textbox", { name: "Manual qualification reason" }), "Verified runoff sheet");
    await user.click(screen.getByRole("button", { name: "Apply reasoned manual decision" }));
    await waitFor(async () => expect((await repository.load())?.auditLog.some(({ action }) => action === "qualification.manual-with-reason")).toBe(true));
    view.unmount();

    const changed = (await repository.load())!;
    changed.settings.finalistCount = 4;
    await repository.save(changed, { commandId: `stale-change-${sequence}`, timestamp: "2026-08-14T07:07:00.000Z", summary: "Changed finalist count" });
    renderWithEvent(<FinalsPage />);
    expect((await screen.findByRole("status")).textContent).toMatch(/previous qualification decision no longer matches/i);
    expect(screen.getByRole("button", { name: "Generate and activate finals" })).toHaveProperty("disabled", true);
  });

  it("seals a completed tied final only through a bounded reasoned manual champion audit", async () => {
    const user = userEvent.setup();
    const tiedFinal = demoEvent();
    tiedFinal.settings.tieBreakOrder = ["totalWins", "playoff"];
    tiedFinal.finals = [
      { id: "final-tie-1", phase: "final", matchNumber: 1, heatNumber: 1, lanes: ["car-01", "car-07", "car-04"], status: "completed", winnerEntryId: "car-01", laneTimesMs: [null, null, null], notes: "" },
      { id: "final-tie-2", phase: "final", matchNumber: 1, heatNumber: 2, lanes: ["car-01", "car-07", "car-04"], status: "completed", winnerEntryId: "car-07", laneTimesMs: [null, null, null], notes: "" },
    ];
    await repository.save(tiedFinal, { commandId: `champion-tie-${sequence}`, timestamp: "2026-08-14T07:08:00.000Z", summary: "Tied final fixture" });
    renderWithEvent(<FinalsPage />);
    await screen.findByRole("region", { name: "Official champion seal" });
    expect(screen.getByRole("button", { name: "Seal official champion" })).toHaveProperty("disabled", true);
    await user.click(screen.getByRole("radio", { name: /Choose Car 1 as champion/ }));
    await user.click(screen.getByRole("button", { name: "Seal reasoned manual champion" }));
    expect(screen.getByRole("alert").textContent).toMatch(/champion reason is required/i);
    await user.type(screen.getByRole("textbox", { name: "Manual champion reason" }), "Signed playoff decision sheet");
    await user.click(screen.getByRole("button", { name: "Seal reasoned manual champion" }));
    await waitFor(async () => expect((await repository.load())?.event.resultSeal).toBe("official"));
    expect((await repository.load())?.auditLog.at(-2)).toMatchObject({
      action: "champion.manual-sealed",
      details: { championCarId: "car-01", reason: "Signed playoff decision sheet" },
    });
  });

  it("builds deterministic compatible Event Pack bytes and restores only after preview and confirmation", async () => {
    const current = recordWinner({ ...demoEvent(), event: { ...demoEvent().event, updatedAt: "2026-08-14T07:02:00.000Z" } }, "pre-m02-h03", "car-06");
    await repository.save(current, { commandId: `insight-result-${sequence}`, timestamp: "2026-08-14T07:02:00.000Z", summary: "Recorded result for replay" });
    const malicious = structuredClone(current);
    malicious.participants[0]!.name = "=SUM(1,1)";
    const pack = buildEventPack(malicious);
    expect(pack.map(({ name }) => name)).toEqual([
      "event.json", "registration.csv", "accounts.csv", "schedule.csv", "results.csv", "standings-preliminary.csv", "standings-finals.csv", "audit.csv", "summary.txt", "printable-report.html",
    ]);
    expect(JSON.parse(pack[0]!.text)).toEqual(malicious);
    expect(pack.find(({ name }) => name === "registration.csv")?.text).toContain("'=SUM(1,1)");
    expect(pack.find(({ name }) => name === "summary.txt")?.text).toContain("Made by Cesar Lacsamana and Ahsan Ali");
    const printable = pack.find(({ name }) => name === "printable-report.html")?.text ?? "";
    expect(printable).toMatch(/Printable event report.*Schedule and results.*Preliminary standings.*Final standings/s);
    expect(printable).toContain("Made by Cesar Lacsamana and Ahsan Ali");

    const user = userEvent.setup();
    renderWithEvent(<ReportsPage />);
    const timeline = await screen.findByRole("region", { name: "Replay timeline" });
    expect(within(timeline).getAllByRole("listitem")).toHaveLength(2);
    await user.click(within(timeline).getByRole("button", { name: /Preview Loaded insight fixture/ }));
    expect(await within(timeline).findByText(/1 heat result/i)).toBeTruthy();
    await user.click(within(timeline).getByRole("button", { name: "Restore this revision" }));
    const dialog = screen.getByRole("alertdialog", { name: "Confirm revision restore" });
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Confirm restore" }));
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(screen.queryByRole("alertdialog", { name: "Confirm revision restore" })).toBeNull();
    expect(document.activeElement).toBe(within(timeline).getByRole("button", { name: "Restore this revision" }));
    await user.click(within(timeline).getByRole("button", { name: "Restore this revision" }));
    await user.click(within(screen.getByRole("alertdialog", { name: "Confirm revision restore" })).getByRole("button", { name: "Confirm restore" }));
    await waitFor(async () => expect((await repository.load())?.matches.find(({ id }) => id === "pre-m02-h03")?.status).toBe("scheduled"));
    await waitFor(() => expect(document.activeElement).toBe(within(timeline).getByRole("heading", { name: "Replay timeline" })));
  });

  it("previews all destructive event deltas and disables official history in rehearsal", async () => {
    const older = demoEvent();
    await repository.save(older, { commandId: `replay-old-${sequence}`, timestamp: "2026-08-14T07:09:00.000Z", summary: "Original registration" });
    const changed = structuredClone(older);
    changed.event.name = "Changed event facts";
    changed.participants[0]!.name = "Changed participant";
    changed.settings.finalistCount += 1;
    changed.payments.push({ id: `payment-replay-${sequence}`, participantId: changed.participants[0]!.id, amountCents: 100, kind: "payment", paidAt: "2026-08-14T07:10:00.000Z", note: "Replay delta" });
    await repository.save(changed, { commandId: `replay-new-${sequence}`, timestamp: "2026-08-14T07:10:00.000Z", summary: "Changed event facts" });
    const user = userEvent.setup();
    renderWithEvent(<ReplayTimeline />);
    const timeline = await screen.findByRole("region", { name: "Replay timeline" });
    await user.click(await within(timeline).findByRole("button", { name: "Preview Original registration" }));
    expect((await within(timeline).findByRole("region", { name: "Revision preview" })).textContent).toMatch(/1 event fact.*1 registration.*1 payment.*1 setting/i);
    cleanup();

    function BeginRehearsal() {
      const { begin } = useRehearsalWorkspace();
      useEffect(() => begin(demoEvent()), [begin]);
      return null;
    }
    render(
      <RehearsalWorkspaceProvider>
        <EventProvider repository={repository}>
          <BeginRehearsal />
          <ReplayTimeline />
        </EventProvider>
      </RehearsalWorkspaceProvider>,
    );
    expect(await screen.findByText(/Exit rehearsal to inspect or restore official history/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Preview/ })).toBeNull();
  });
});
