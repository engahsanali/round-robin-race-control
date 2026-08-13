import "fake-indexeddb/auto";

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseEventJson, serializeEvent, type EventStateV1 } from "@rr3/domain";
import { Link, MemoryRouter } from "react-router-dom";
import demoEvent from "../../../../../fixtures/demo-event.json";
import { AppRoutes } from "../../app/routes";
import { createProDatabase, type ProDatabase } from "../../persistence/db";
import { EventRepository } from "../../persistence/repository";
import { EventProvider } from "../../state/EventProvider";
import { RehearsalWorkspaceProvider } from "../../state/RehearsalWorkspace";
import { DashboardPage } from "../dashboard/DashboardPage";
import { RecoveryPanel } from "../shared/RecoveryPanel";
import { SetupWizard } from "./SetupWizard";

let database: ProDatabase;
let repository: EventRepository;
let sequence = 0;

beforeEach(() => {
  sequence += 1;
  database = createProDatabase(`rr3-pro-setup-${sequence}`);
  repository = new EventRepository(database, { storageManager: null });
});

afterEach(async () => {
  cleanup();
  database.close();
  await database.delete();
});

function renderWithProvider(node: React.ReactNode) {
  return render(
    <EventProvider
      repository={repository}
      now={() => "2026-08-14T06:00:00.000Z"}
      createId={() => `setup-command-${sequence}`}
    >
      <RehearsalWorkspaceProvider>{node}</RehearsalWorkspaceProvider>
    </EventProvider>,
  );
}

async function completeEventDetails(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.type(screen.getByRole("textbox", { name: "Event name" }), name);
  await user.type(screen.getByLabelText("Event date"), "2026-09-20");
  await user.type(screen.getByRole("textbox", { name: "Venue" }), "Community Hall");
  await user.type(screen.getByRole("textbox", { name: "Organizer" }), "Race Crew");
  await user.click(screen.getByRole("button", { name: "Next: Categories" }));
}

describe("SetupWizard", () => {
  it("creates a validated real event through five explicit steps with multiple stable cars", async () => {
    const user = userEvent.setup();
    renderWithProvider(<SetupWizard />);

    expect(await screen.findByRole("heading", { name: "1. Event details" })).toBeTruthy();
    expect(screen.getByText("Step 1 of 5")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Next: Categories" }));
    expect(screen.getByText("Event name is required.")).toBeTruthy();
    expect(screen.getByText("Event date is required.")).toBeTruthy();

    await completeEventDetails(user, "Spring Championship");
    expect(screen.getByRole("heading", { name: "2. Categories & prices" })).toBeTruthy();
    const price = screen.getByRole("textbox", { name: "Standard price in cents" });
    await user.clear(price);
    await user.type(price, "1200.5");
    await user.click(screen.getByRole("button", { name: "Next: Entrants" }));
    expect(screen.getByText("Price must be a non-negative safe integer number of cents.")).toBeTruthy();
    await user.clear(price);
    await user.type(price, "9007199254740992");
    await user.click(screen.getByRole("button", { name: "Next: Entrants" }));
    expect(screen.getByText("Price must be a non-negative safe integer number of cents.")).toBeTruthy();
    await user.clear(price);
    await user.type(price, "1200");
    await user.click(screen.getByRole("button", { name: "Next: Entrants" }));

    expect(screen.getByRole("heading", { name: "3. Entrants & cars" })).toBeTruthy();
    await user.type(screen.getByRole("textbox", { name: "Participant name" }), "Ada Driver");
    await user.type(screen.getByRole("textbox", { name: "Car 1 name" }), "Blue Comet");
    await user.click(screen.getByRole("button", { name: "Add another car" }));
    await user.type(screen.getByRole("textbox", { name: "Car 2 name" }), "Silver Arrow");
    await user.clear(screen.getByRole("spinbutton", { name: "Car 2 number" }));
    await user.type(screen.getByRole("spinbutton", { name: "Car 2 number" }), "1");
    await user.click(screen.getByRole("button", { name: "Next: Competition" }));
    expect(screen.getByText("Active car number 1 is already used.")).toBeTruthy();
    await user.clear(screen.getByRole("spinbutton", { name: "Car 2 number" }));
    await user.type(screen.getByRole("spinbutton", { name: "Car 2 number" }), "2");
    await user.click(screen.getByRole("button", { name: "Next: Competition" }));

    expect(screen.getByRole("heading", { name: "4. Competition policy" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Review event" }));
    expect(screen.getByRole("heading", { name: "5. Review & create" })).toBeTruthy();
    expect(screen.getByText("Real event — official workspace")).toBeTruthy();
    expect(screen.getByText("2 active cars · Standard $12.00")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Create real event" }));

    expect(await screen.findByText("Spring Championship was created as a real event.")).toBeTruthy();
    const saved = await repository.load();
    expect(saved).toMatchObject({
      event: { name: "Spring Championship", status: "setup", resultSeal: "draft" },
      settings: { prices: { standard: 1200 } },
      participants: [{ name: "Ada Driver" }],
    });
    expect(saved?.entries.map(({ carNumber, name, active }) => ({ carNumber, name, active }))).toEqual([
      { carNumber: 1, name: "Blue Comet", active: true },
      { carNumber: 2, name: "Silver Arrow", active: true },
    ]);
    expect(new Set(saved?.entries.map(({ id }) => id)).size).toBe(2);
    expect(saved?.auditLog.at(-1)?.action).toBe("event.replaced");
  }, 10_000);

  it("creates a demo rehearsal in memory without replacing the official repository", async () => {
    const user = userEvent.setup();
    renderWithProvider(<SetupWizard />);

    await user.click(await screen.findByRole("radio", { name: "Demo rehearsal" }));
    await completeEventDetails(user, "Practice Night");
    await user.click(screen.getByRole("button", { name: "Next: Entrants" }));
    await user.type(screen.getByRole("textbox", { name: "Participant name" }), "Demo Driver");
    await user.type(screen.getByRole("textbox", { name: "Car 1 name" }), "Practice Car");
    await user.click(screen.getByRole("button", { name: "Next: Competition" }));
    await user.click(screen.getByRole("button", { name: "Review event" }));

    expect(screen.getByText("Demo rehearsal — isolated practice data")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Create demo rehearsal" }));
    expect(await screen.findByText("Practice Night was created as an isolated demo rehearsal.")).toBeTruthy();
    expect(await repository.load()).toBeNull();
  });
});

describe("DashboardPage and RecoveryPanel", () => {
  it("keeps rehearsal data and mutations isolated while navigating to Registration and back", async () => {
    const parsed = parseEventJson(JSON.stringify(demoEvent));
    if (!parsed.ok) throw new Error("Demo fixture must be valid");
    const official = structuredClone(parsed.data);
    official.event.id = "event-official-cross-route";
    official.event.name = "Official Cross-Route Event";
    official.participants = official.participants.map((participant) => ({
      ...participant,
      name: `Official ${participant.name}`,
    }));
    await repository.save(official, {
      commandId: "official-cross-route-bootstrap",
      timestamp: "2026-08-14T05:00:00.000Z",
      summary: "Loaded cross-route official event",
    });
    const officialBytes = serializeEvent((await repository.load())!);
    const user = userEvent.setup();

    renderWithProvider(
      <MemoryRouter>
        <nav aria-label="Test workspace routes"><Link to="/">Dashboard route</Link><Link to="/registration">Registration route</Link></nav>
        <AppRoutes />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Official Cross-Route Event")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Load demo rehearsal" }));
    await user.click(screen.getByRole("link", { name: "Registration route" }));

    expect(await screen.findByText("Sample 01 - Ada")).toBeTruthy();
    expect(screen.queryByText("Official Sample 01 - Ada")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Withdraw car 1 Sample Car 01" }));
    await user.click(within(screen.getByRole("alertdialog", { name: "Confirm car withdrawal" })).getByRole("button", { name: "Confirm withdrawal" }));
    expect(await screen.findByRole("button", { name: "Restore car 1 Sample Car 01" })).toBeTruthy();
    expect(serializeEvent((await repository.load())!)).toBe(officialBytes);

    await user.click(screen.getByRole("link", { name: "Dashboard route" }));
    expect(await screen.findByText("8 active cars")).toBeTruthy();
    expect(screen.getByText("Demo rehearsal — isolated practice")).toBeTruthy();
    expect(serializeEvent((await repository.load())!)).toBe(officialBytes);
  });
  it("loads and exits an isolated demo without replacing the recoverable official event", async () => {
    const parsed = parseEventJson(JSON.stringify(demoEvent));
    if (!parsed.ok) throw new Error("Demo fixture must be valid");
    const official = structuredClone(parsed.data);
    official.event.id = "event-official-championship";
    official.event.name = "Official Championship";
    await repository.save(official, {
      commandId: "official-bootstrap",
      timestamp: "2026-08-14T05:00:00.000Z",
      summary: "Loaded official event",
    });
    const officialBytes = serializeEvent((await repository.load())!);
    const user = userEvent.setup();

    renderWithProvider(<DashboardPage />);
    expect(await screen.findByText("Official Championship")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Load demo rehearsal" }));

    expect(screen.getByText("Demo rehearsal — isolated practice")).toBeTruthy();
    expect(screen.getByText("Nine-Car Community Demo")).toBeTruthy();
    expect(screen.getByText("Official event remains saved: Official Championship")).toBeTruthy();
    expect(serializeEvent((await repository.load())!)).toBe(officialBytes);

    await user.click(screen.getByRole("button", { name: "Return to Official Championship" }));
    expect(screen.getByText("Official Championship")).toBeTruthy();
    expect(screen.getByText("Real event — official workspace")).toBeTruthy();
    expect(serializeEvent((await repository.load())!)).toBe(officialBytes);
  });

  it("uses finals when selecting current and next heats and calculating completion", async () => {
    const parsed = parseEventJson(JSON.stringify(demoEvent));
    if (!parsed.ok) throw new Error("Demo fixture must be valid");
    const event = parsed.data;
    event.matches = event.matches.filter(({ status }) => status === "completed");
    event.finals = [
      { id: "final-complete", phase: "final", matchNumber: 1, heatNumber: 1, lanes: ["car-01", "car-02", "car-03"], status: "completed", winnerEntryId: "car-02", laneTimesMs: [null, null, null], notes: "" },
      { id: "final-current", phase: "final", matchNumber: 1, heatNumber: 2, lanes: ["car-04", "car-05", "car-06"], status: "scheduled", winnerEntryId: null, laneTimesMs: [null, null, null], notes: "" },
      { id: "final-next", phase: "final", matchNumber: 1, heatNumber: 3, lanes: ["car-07", "car-08", "car-09"], status: "scheduled", winnerEntryId: null, laneTimesMs: [null, null, null], notes: "" },
    ];
    await repository.save(event, {
      commandId: "finals-dashboard",
      timestamp: "2026-08-14T05:00:00.000Z",
      summary: "Finals underway",
    });

    renderWithProvider(<DashboardPage />);

    expect(await screen.findByText("Current heat: final-current")).toBeTruthy();
    expect(screen.getByText("Next heat: final-next")).toBeTruthy();
    expect(screen.getByText("7 of 9 heats complete")).toBeTruthy();
  });

  it("shows operational facts and accessible chart alternatives only when result data exists", async () => {
    const parsed = parseEventJson(JSON.stringify(demoEvent));
    if (!parsed.ok) throw new Error("Demo fixture must be valid");
    await repository.save(parsed.data, {
      commandId: "dashboard-bootstrap",
      timestamp: "2026-08-14T05:00:00.000Z",
      summary: "Loaded demo rehearsal",
    });

    renderWithProvider(<DashboardPage />);

    expect(await screen.findByRole("heading", { name: "Event dashboard" })).toBeTruthy();
    expect(screen.getByText("Demo rehearsal — isolated practice")).toBeTruthy();
    expect(screen.getByText("Current heat: pre-m02-h03")).toBeTruthy();
    expect(screen.getByText("Next heat: pre-m03-h01")).toBeTruthy();
    expect(screen.getByText("6 of 12 heats complete")).toBeTruthy();
    expect(screen.getByText("9 active cars")).toBeTruthy();
    expect(screen.getByText("Collected $18.00 · Outstanding $90.00")).toBeTruthy();
    expect(screen.getByText("Leaders: Car 1 and Car 7")).toBeTruthy();

    for (const name of ["Completion chart", "Payment chart", "Category chart", "Win gap chart"]) {
      expect(screen.getByRole("img", { name })).toBeTruthy();
    }
    expect(screen.getByText("Half of scheduled heats have official winners.")).toBeTruthy();
    expect(screen.getByRole("table", { name: "Dashboard chart data" })).toBeTruthy();
    expect(screen.getByText("Storage persistence: unavailable")).toBeTruthy();
    expect(screen.getByText("1 local revision available")).toBeTruthy();
    expect(screen.getByText("Portable backup: not downloaded in this session")).toBeTruthy();
    expect(screen.queryByText(/cloud sync/i)).toBeNull();
  });

  it("keeps recovery language explicit when no event or portable backup exists", async () => {
    render(
      <RecoveryPanel
        persistenceStatus="not-requested"
        snapshotCount={0}
        portableBackupStatus="not-downloaded"
      />,
    );

    const panel = screen.getByRole("region", { name: "Recovery confidence" });
    expect(within(panel).getByText("Storage persistence: not requested")).toBeTruthy();
    expect(within(panel).getByText("No local revisions yet")).toBeTruthy();
    expect(within(panel).getByText("Portable backup: not downloaded in this session")).toBeTruthy();
    expect(within(panel).getByText(/Downloaded JSON is the durable portable copy/)).toBeTruthy();
  });
});
