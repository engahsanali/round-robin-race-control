import "fake-indexeddb/auto";

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validateEventState, type EventStateV1 } from "@rr3/domain";
import demoEventJson from "../../../../../fixtures/demo-event.json";
import { PresentationPage } from "../presentation/PresentationPage";
import { createProDatabase, type ProDatabase } from "../../persistence/db";
import { EventRepository } from "../../persistence/repository";
import { EventProvider } from "../../state/EventProvider";
import { RaceCommandPage } from "./RaceCommandPage";

let database: ProDatabase;
let repository: EventRepository;
let sequence = 0;

class TestBroadcastChannel {
  static channels = new Map<string, Set<TestBroadcastChannel>>();
  onmessage: ((event: MessageEvent) => void) | null = null;
  readonly name: string;

  constructor(name: string) {
    this.name = name;
    const group = TestBroadcastChannel.channels.get(name) ?? new Set<TestBroadcastChannel>();
    group.add(this);
    TestBroadcastChannel.channels.set(name, group);
  }

  postMessage(data: unknown) {
    for (const channel of TestBroadcastChannel.channels.get(this.name) ?? []) {
      if (channel !== this) channel.onmessage?.(new MessageEvent("message", { data: structuredClone(data) }));
    }
  }

  close() {
    TestBroadcastChannel.channels.get(this.name)?.delete(this);
  }
}

function demoEvent(): EventStateV1 {
  const result = validateEventState(structuredClone(demoEventJson));
  if (!result.success) throw new Error("Canonical demo fixture must validate");
  return result.data;
}

beforeEach(async () => {
  sequence += 1;
  TestBroadcastChannel.channels.clear();
  vi.stubGlobal("BroadcastChannel", TestBroadcastChannel);
  database = createProDatabase(`rr3-pro-race-${sequence}`);
  repository = new EventRepository(database);
  await repository.save(demoEvent(), {
    commandId: `race-bootstrap-${sequence}`,
    timestamp: "2026-08-14T06:00:00.000Z",
    summary: "Race fixture",
  });
});

afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  database.close();
  await database.delete();
});

function renderRace(extra?: React.ReactNode) {
  let id = 0;
  return render(
    <EventProvider
      repository={repository}
      now={() => "2026-08-14T06:01:02.000Z"}
      createId={() => `race-command-${sequence}-${++id}`}
    >
      <RaceCommandPage />
      {extra}
    </EventProvider>,
  );
}

describe("RaceCommandPage", () => {
  it("records lane-only keyboard results and times atomically, auto-advances, and undoes from its receipt", async () => {
    const user = userEvent.setup();
    renderRace();
    const heading = await screen.findByRole("heading", { name: "Race Command Center" });
    expect((await screen.findByRole("region", { name: "Current heat" })).textContent).toMatch(/Match 2.*Heat 3/);

    await user.clear(screen.getByRole("spinbutton", { name: "Lane 1 time in seconds" }));
    await user.type(screen.getByRole("spinbutton", { name: "Lane 1 time in seconds" }), "1.110");
    await user.clear(screen.getByRole("spinbutton", { name: "Lane 2 time in seconds" }));
    await user.type(screen.getByRole("spinbutton", { name: "Lane 2 time in seconds" }), "1.020");
    await user.clear(screen.getByRole("spinbutton", { name: "Lane 3 time in seconds" }));
    await user.type(screen.getByRole("spinbutton", { name: "Lane 3 time in seconds" }), "1.090");
    heading.focus();
    fireEvent.keyDown(window, { key: "2" });
    expect(screen.getByRole("status", { name: "Pending result" }).textContent).toMatch(/Lane 2.*Car 6/);
    fireEvent.keyDown(window, { key: "Enter" });

    const receipt = await screen.findByRole("region", { name: "Result receipt" });
    expect(within(receipt).getByText(/Recorded Car 6.*Match 2.*Heat 3/i)).toBeTruthy();
    expect(within(receipt).getByText(/06:01:02/)).toBeTruthy();
    await waitFor(async () => {
      expect((await repository.load())?.matches.find(({ id }) => id === "pre-m02-h03")).toMatchObject({
        status: "completed",
        winnerEntryId: "car-06",
        laneTimesMs: [1110, 1020, 1090],
      });
    });
    expect(screen.getByRole("region", { name: "Current heat" }).textContent).toMatch(/Match 3.*Heat 1/);

    await user.click(within(receipt).getByRole("button", { name: "Undo this result" }));
    await waitFor(async () => expect((await repository.load())?.matches.find(({ id }) => id === "pre-m02-h03")?.status).toBe("scheduled"));
    await waitFor(() => expect(screen.getByRole("status", { name: "Command status" }).textContent).toMatch(/restored/i));
  });

  it("queues delayed and held heats, supports heat navigation, and requires reasons for corrections, reruns, and cancellations", async () => {
    const user = userEvent.setup();
    renderRace();
    await screen.findByRole("heading", { name: "Race Command Center" });
    await screen.findByRole("region", { name: "Current heat" });

    await user.click(screen.getByRole("button", { name: "Mark current heat delayed" }));
    const issues = screen.getByRole("region", { name: "Issue queue" });
    expect(within(issues).getByRole("button", { name: /Match 2 Heat 3.*delayed/i })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Mark current heat held" }));
    expect(within(issues).getByRole("button", { name: /Match 2 Heat 3.*held/i })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Previous heat" }));
    expect(screen.getByRole("region", { name: "Current heat" }).textContent).toMatch(/Match 2.*Heat 2.*completed/i);

    await user.click(screen.getByRole("button", { name: /Lane 1.*Car 2/i }));
    await user.click(screen.getByRole("button", { name: "Confirm result" }));
    expect(screen.getByRole("alert").textContent).toMatch(/correction reason is required/i);
    await user.type(screen.getByRole("textbox", { name: "Official change reason" }), "Finish camera review");
    await user.click(screen.getByRole("button", { name: "Confirm result" }));
    await screen.findByText(/Changed winner.*Car 2/i);
    expect((await repository.load())?.matches.find(({ id }) => id === "pre-m02-h02")?.winnerEntryId).toBe("car-02");

    await user.type(screen.getByRole("textbox", { name: "Heat action reason" }), "Track obstruction");
    await user.click(screen.getByRole("button", { name: "Mark heat for rerun" }));
    await waitFor(async () => expect((await repository.load())?.matches.find(({ id }) => id === "pre-m02-h02")?.status).toBe("rerun"));
    await user.clear(screen.getByRole("textbox", { name: "Heat action reason" }));
    await user.type(screen.getByRole("textbox", { name: "Heat action reason" }), "Sensor failure");
    await user.click(screen.getByRole("button", { name: "Cancel heat" }));
    await waitFor(async () => expect((await repository.load())?.matches.find(({ id }) => id === "pre-m02-h02")?.status).toBe("cancelled"));
  });

  it("keeps speech opt-in, exposes wake-lock state and reacquires after returning visible", async () => {
    const user = userEvent.setup();
    const release = vi.fn().mockResolvedValue(undefined);
    const request = vi.fn().mockResolvedValue({ released: false, release, addEventListener: vi.fn() });
    Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request } });
    const speak = vi.fn();
    const cancel = vi.fn();
    vi.stubGlobal("SpeechSynthesisUtterance", class { text: string; constructor(text: string) { this.text = text; } });
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { speak, cancel } });
    renderRace();
    await screen.findByRole("heading", { name: "Race Command Center" });
    await screen.findByRole("region", { name: "Current heat" });

    await user.click(screen.getByRole("button", { name: "Call current heat" }));
    expect(speak).toHaveBeenCalledTimes(0);
    await user.click(screen.getByRole("button", { name: "Enable announcer" }));
    await user.click(screen.getByRole("button", { name: "Call current heat" }));
    expect((speak.mock.calls[0]?.[0] as { text: string }).text).toMatch(/Match 2, Heat 3.*Lane 1, Car 3.*Lane 2, Car 6.*Lane 3, Car 9/);
    await user.click(screen.getByRole("button", { name: "Disable announcer" }));
    expect(cancel).toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Enable wake lock" }));
    expect(await screen.findByRole("status", { name: "Wake lock status" })).toHaveProperty("textContent", expect.stringMatching(/active/i));
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    fireEvent(document, new Event("visibilitychange"));
    await waitFor(() => expect(release).toHaveBeenCalledTimes(1));
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    fireEvent(document, new Event("visibilitychange"));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  });

  it("broadcasts sanitized committed state to a read-only presentation without moving its focused rotation control", async () => {
    const user = userEvent.setup();
    renderRace(<PresentationPage />);
    const heading = await screen.findByRole("heading", { name: "Race Command Center" });
    await screen.findByRole("region", { name: "Current heat" });
    expect(screen.getByText(/same browser and device/i)).toBeTruthy();
    const pause = screen.getByRole("button", { name: "Pause rotation" });
    pause.focus();
    heading.focus();
    fireEvent.keyDown(window, { key: "2" });
    fireEvent.keyDown(window, { key: "Enter" });

    await screen.findByRole("heading", { name: "Spectator Board" });
    expect(await screen.findByText(/Latest result.*Car 6/i)).toBeTruthy();
    expect(screen.queryByText("ada@example.test")).toBeNull();
    pause.focus();
    await user.click(pause);
    expect(document.activeElement).toBe(pause);
    await user.click(screen.getByRole("button", { name: "Next presentation panel" }));
    expect(screen.getByRole("status", { name: "Rotation status" }).textContent).toMatch(/paused/i);
    const spectatorBoard = screen.getByRole("region", { name: "Spectator Board" });
    expect(within(spectatorBoard).queryByRole("button", { name: /record|cancel|rerun/i })).toBeNull();
  });
});
