import "fake-indexeddb/auto";

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { analyseSchedule, validateEventState, type EventStateV1, type Heat } from "@rr3/domain";
import { createProDatabase, type ProDatabase } from "../../persistence/db";
import { EventRepository } from "../../persistence/repository";
import { EventProvider } from "../../state/EventProvider";
import { QualitySummary, ScheduleLabPage } from "./ScheduleLabPage";

let database: ProDatabase;
let repository: EventRepository;
let sequence = 0;

function scheduleEvent(): EventStateV1 {
  const timestamp = "2026-08-14T04:00:00.000Z";
  const candidate: EventStateV1 = {
    version: 1,
    event: {
      id: "event-schedule-lab",
      name: "Schedule Lab Test",
      date: "2026-09-20",
      venue: "Community Hall",
      organizer: "Race Crew",
      laneCount: 3,
      status: "setup",
      createdAt: timestamp,
      updatedAt: timestamp,
      resultSeal: "draft",
    },
    settings: {
      scheduleMode: "custom",
      seed: "before-schedule-lab",
      rankingMode: "competition",
      allowSharedRanks: true,
      tieBreakOrder: ["totalWins", "headToHead", "playoff"],
      finalistCount: 3,
      autoSave: true,
      confirmWinnerChanges: true,
      enableTiming: false,
      prices: { standard: 1200 },
    },
    participants: Array.from({ length: 9 }, (_, index) => ({
      id: `participant-${index + 1}`,
      name: `Racer ${index + 1}`,
      email: "",
      phone: "",
      notes: "",
    })),
    entries: Array.from({ length: 9 }, (_, index) => ({
      id: `car-${index + 1}`,
      participantId: `participant-${index + 1}`,
      carNumber: index + 1,
      name: `Car ${index + 1}`,
      categoryId: "standard",
      quantity: 1,
      active: true,
    })),
    matches: [{
      id: "old-preliminary-heat",
      phase: "preliminary",
      matchNumber: 1,
      heatNumber: 1,
      lanes: ["car-1", "car-2", "car-3"],
      status: "scheduled",
      winnerEntryId: null,
      laneTimesMs: [null, null, null],
      notes: "Existing draw",
    }],
    finals: [],
    payments: [],
    auditLog: [],
  };
  const validated = validateEventState(candidate);
  if (!validated.success) throw new Error("Schedule fixture must be valid");
  return validated.data;
}

function scheduleEventWithActiveCars(count: number): EventStateV1 {
  const candidate = scheduleEvent();
  candidate.participants = Array.from({ length: count }, (_, index) => ({
    id: `participant-${index + 1}`,
    name: `Racer ${index + 1}`,
    email: "",
    phone: "",
    notes: "",
  }));
  candidate.entries = Array.from({ length: count }, (_, index) => ({
    id: `car-${index + 1}`,
    participantId: `participant-${index + 1}`,
    carNumber: index + 1,
    name: `Car ${index + 1}`,
    categoryId: "standard",
    quantity: 1,
    active: true,
  }));
  const validated = validateEventState(candidate);
  if (!validated.success) throw new Error("Expanded schedule fixture must be valid");
  return validated.data;
}

beforeEach(async () => {
  sequence += 1;
  database = createProDatabase(`rr3-pro-schedule-${sequence}`);
  repository = new EventRepository(database);
  await repository.save(scheduleEvent(), {
    commandId: `schedule-bootstrap-${sequence}`,
    timestamp: "2026-08-14T04:00:00.000Z",
    summary: "Schedule fixture",
  });
});

afterEach(async () => {
  cleanup();
  database.close();
  await database.delete();
});

function renderPage() {
  return render(
    <EventProvider
      repository={repository}
      now={() => "2026-08-14T05:00:00.000Z"}
      createId={() => `schedule-command-${sequence}`}
    >
      <ScheduleLabPage />
    </EventProvider>,
  );
}

async function buildNineCarPreset(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole("heading", { name: "Schedule Lab" });
  await user.click(screen.getByRole("button", { name: "Build preset candidate" }));
  return screen.getByRole("region", { name: "Selected schedule candidate" });
}

describe("ScheduleLabPage", () => {
  it("gates custom generation outside the shared scheduler's 3–24 active-car range", async () => {
    await repository.save(scheduleEventWithActiveCars(25), {
      commandId: "schedule-25-car-proof",
      timestamp: "2026-08-14T04:30:00.000Z",
      summary: "Load 25-car gate fixture",
    });
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("heading", { name: "Schedule Lab" });

    await user.click(screen.getByRole("radio", { name: "Custom seeded search" }));

    expect(screen.getByRole("alert").textContent).toMatch(/custom schedules support 3–24 active cars.*25 available/i);
    expect((screen.getByRole("button", { name: "Generate three candidates" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("table", { name: "Schedule candidate comparison" })).toBeNull();
  });

  it("uses exact preset gates and a stable, manually swappable slot mapping", async () => {
    const user = userEvent.setup();
    renderPage();
    const candidate = await buildNineCarPreset(user);

    expect(within(candidate).getByText("4 matches · 12 heats")).toBeTruthy();
    const heatTable = within(candidate).getByRole("table", { name: "Schedule heat preview" });
    expect(within(heatTable).getAllByRole("row")).toHaveLength(13);
    expect(within(heatTable).getAllByRole("row")[1]?.textContent).toMatch(/Match 1.*Heat 1.*Car 1.*Car 2.*Car 3/);

    await user.selectOptions(screen.getByRole("combobox", { name: "Slot 1 car" }), "car-9");
    expect((screen.getByRole("combobox", { name: "Slot 9 car" }) as HTMLSelectElement).value).toBe("car-1");
    await user.click(screen.getByRole("button", { name: "Build preset candidate" }));
    expect(within(screen.getByRole("table", { name: "Schedule heat preview" })).getAllByRole("row")[1]?.textContent)
      .toMatch(/Car 9.*Car 2.*Car 3/);

    await user.selectOptions(screen.getByRole("combobox", { name: "Exact preset" }), "template12");
    expect(screen.getByRole("alert").textContent).toMatch(/requires exactly 12 active cars.*9 available/i);
    expect((screen.getByRole("button", { name: "Build preset candidate" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Activate selected schedule" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("generates three deterministic immutable candidates and compares the full lexicographic objectives", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("heading", { name: "Schedule Lab" });
    await user.click(screen.getByRole("radio", { name: "Custom seeded search" }));
    const seed = screen.getByRole("textbox", { name: "Schedule seed" });
    await user.clear(seed);
    await user.type(seed, "community-night");
    await user.clear(screen.getByRole("spinbutton", { name: "Matches" }));
    await user.type(screen.getByRole("spinbutton", { name: "Matches" }), "4");
    await user.click(screen.getByRole("button", { name: "Generate three candidates" }));

    const comparison = screen.getByRole("table", { name: "Schedule candidate comparison" });
    expect(within(comparison).getAllByRole("row")).toHaveLength(4);
    for (const objective of [
      "Invalid heats", "Appearance imbalance", "Repeat excess", "Maximum pair frequency",
      "Worst repeat burden", "Squared repeat burden", "Squared pair frequency",
      "Consecutive byes", "Immediate repeat opponents",
    ]) expect(within(comparison).getByRole("columnheader", { name: objective })).toBeTruthy();
    expect(within(comparison).queryByText(/overall score|fairness score/i)).toBeNull();
    expect(within(comparison).getByText("community-night")).toBeTruthy();
    expect(within(comparison).getByText("community-night-2")).toBeTruthy();
    expect(within(comparison).getByText("community-night-3")).toBeTruthy();

    await user.click(within(comparison).getByRole("radio", { name: "Choose candidate 2" }));
    const signature = screen.getByLabelText("Selected schedule signature").textContent;
    await user.clear(seed);
    await user.type(seed, "uncommitted-edit");
    expect(screen.getByLabelText("Selected schedule seed").textContent).toBe("community-night-2");
    expect(screen.getByLabelText("Selected schedule signature").textContent).toBe(signature);
    await user.clear(seed);
    await user.type(seed, "community-night");
    await user.click(screen.getByRole("button", { name: "Generate three candidates" }));
    await user.click(within(screen.getByRole("table", { name: "Schedule candidate comparison" }))
      .getByRole("radio", { name: "Choose candidate 2" }));
    expect(screen.getByLabelText("Selected schedule signature").textContent).toBe(signature);
  }, 15_000);

  it("explains every quality dimension with semantic pair and lane alternatives", async () => {
    const user = userEvent.setup();
    renderPage();
    const candidate = await buildNineCarPreset(user);

    expect(within(candidate).getByRole("heading", { name: "Valid" })).toBeTruthy();
    expect(within(candidate).getByText(/Repeat excess: Certified optimal · actual 0 · lower bound 0 · gap 0/)).toBeTruthy();
    expect(within(candidate).getByText(/Maximum pair frequency: Certified optimal · actual 1 · lower bound 1 · gap 0/)).toBeTruthy();
    expect(within(candidate).getByText(/Appearance imbalance 0/)).toBeTruthy();
    expect(within(candidate).getByText(/Worst repeat burden 0/)).toBeTruthy();
    expect(within(candidate).getByText(/Bye assignments 0 · two-car participations 0/)).toBeTruthy();

    const pairTable = within(candidate).getByRole("table", { name: "Opponent pair frequency" });
    expect(within(pairTable).getAllByRole("row")).toHaveLength(37);
    expect(within(candidate).getByRole("img", { name: /opponent network.*36 pair connections.*no repeated pair/i })).toBeTruthy();
    await user.selectOptions(within(candidate).getByRole("combobox", { name: "Opponent pair filter" }), "repeated");
    expect(within(pairTable).getAllByRole("row")).toHaveLength(1);
    expect(within(candidate).getByText("No opponent pairs match this filter.")).toBeTruthy();

    const laneTable = within(candidate).getByRole("table", { name: "Lane balance data" });
    const carOne = within(laneTable).getByRole("row", { name: /Car 1/ });
    expect(carOne.textContent).toMatch(/4.*0.*0.*4/);
    expect(within(candidate).getByText(/Maximum lane spread 4/)).toBeTruthy();
  });

  it("scopes optimality to each objective when only repeat excess reaches its lower bound", () => {
    const groups = [
      [["car-1", "car-2", "car-3"], ["car-4", "car-5", "car-6"]],
      [["car-1", "car-2", "car-4"], ["car-3", "car-5", "car-6"]],
      [["car-1", "car-2", "car-5"], ["car-3", "car-4", "car-6"]],
      [["car-1", "car-2", "car-6"], ["car-3", "car-4", "car-5"]],
    ] as const;
    const heats: Heat[] = groups.flatMap((match, matchIndex) => match.map((lanes, heatIndex) => ({
      id: `mixed-gap-m${matchIndex + 1}-h${heatIndex + 1}`,
      phase: "preliminary" as const,
      matchNumber: matchIndex + 1,
      heatNumber: heatIndex + 1,
      lanes: [...lanes],
      status: "scheduled" as const,
      winnerEntryId: null,
      laneTimesMs: [null, null, null],
      notes: "",
    })));
    const quality = analyseSchedule(heats, Array.from({ length: 6 }, (_, index) => `car-${index + 1}`));

    expect(quality).toMatchObject({
      status: "valid",
      repeatExcessGap: 0,
      maximumPairFrequency: 4,
      maximumPairFrequencyLowerBound: 2,
      maximumPairFrequencyGap: 2,
    });
    render(<QualitySummary quality={quality} />);

    const certificate = screen.getByRole("region", { name: "Schedule quality certificate" });
    expect(within(certificate).getByRole("heading", { name: "Valid" })).toBeTruthy();
    expect(within(certificate).queryByRole("heading", { name: "Certified optimal" })).toBeNull();
    expect(within(certificate).getByText("Repeat excess: Certified optimal · actual 9 · lower bound 9 · gap 0")).toBeTruthy();
    expect(within(certificate).getByText("Maximum pair frequency: Best found · actual 4 · lower bound 2 · gap 2")).toBeTruthy();
  });

  it("labels a warning-bearing valid schedule as Valid with warnings", async () => {
    await repository.save(scheduleEventWithActiveCars(10), {
      commandId: "schedule-warning-proof",
      timestamp: "2026-08-14T04:30:00.000Z",
      summary: "Load warning fixture",
    });
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("heading", { name: "Schedule Lab" });
    await user.click(screen.getByRole("radio", { name: "Custom seeded search" }));
    await user.click(screen.getByRole("button", { name: "Generate three candidates" }));

    const certificate = await screen.findByRole("region", { name: "Schedule quality certificate" });
    expect(within(certificate).getByRole("heading", { name: "Valid with warnings" })).toBeTruthy();
    expect(within(certificate).queryByRole("heading", { name: "Certified optimal" })).toBeNull();
    expect(within(certificate).getAllByText(/bye assignment/i).length).toBeGreaterThan(0);
  });

  it("previews destructive impact and activates only a validated candidate", async () => {
    const user = userEvent.setup();
    renderPage();
    await buildNineCarPreset(user);
    await user.click(screen.getByRole("button", { name: "Activate selected schedule" }));

    const confirmation = screen.getByRole("alertdialog", { name: "Confirm schedule activation" });
    expect(document.activeElement).toBe(within(confirmation).getByRole("button", { name: "Confirm activation" }));
    expect(screen.getByRole("heading", { name: "Schedule Lab" }).closest("[inert]")).toBeTruthy();
    expect(within(confirmation).getByText(/replace 1 existing preliminary heat with 12 validated heats/i)).toBeTruthy();
    expect(within(confirmation).getByText(/recovery snapshot/i)).toBeTruthy();
    expect((await repository.load())?.matches).toHaveLength(1);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog", { name: "Confirm schedule activation" })).toBeNull();
    const activationTrigger = screen.getByRole("button", { name: "Activate selected schedule" });
    expect(document.activeElement).toBe(activationTrigger);

    await user.click(activationTrigger);
    const reopened = screen.getByRole("alertdialog", { name: "Confirm schedule activation" });
    await user.click(within(reopened).getByRole("button", { name: "Confirm activation" }));

    await waitFor(async () => expect((await repository.load())?.matches).toHaveLength(12));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("status", { name: "Schedule activation status" })));
    const saved = (await repository.load())!;
    expect(saved.matches[0]).toMatchObject({
      id: "preset-template9-match-1-heat-1",
      lanes: ["car-1", "car-2", "car-3"],
    });
    expect(saved.settings).toMatchObject({ scheduleMode: "template9", seed: "" });
    expect(saved.auditLog.at(-1)?.summary).toMatch(/Activated template9 schedule/i);
  });
});
