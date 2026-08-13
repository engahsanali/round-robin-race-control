import "fake-indexeddb/auto";

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateEventState, type EventStateV1 } from "@rr3/domain";
import { createProDatabase, type ProDatabase } from "../../persistence/db";
import { EventRepository } from "../../persistence/repository";
import { EventProvider } from "../../state/EventProvider";
import { RegistrationPage } from "./RegistrationPage";

let database: ProDatabase;
let repository: EventRepository;
let sequence = 0;

function registrationEvent(): EventStateV1 {
  const input: EventStateV1 = {
    version: 1,
    event: {
      id: "event-registration",
      name: "Registration Test",
      date: "2026-09-20",
      venue: "Community Hall",
      organizer: "Race Crew",
      laneCount: 3,
      status: "setup",
      createdAt: "2026-08-14T01:00:00.000Z",
      updatedAt: "2026-08-14T01:00:00.000Z",
      resultSeal: "draft",
    },
    settings: {
      scheduleMode: "custom",
      seed: "registration",
      rankingMode: "competition",
      allowSharedRanks: true,
      tieBreakOrder: ["totalWins", "headToHead", "playoff"],
      finalistCount: 3,
      autoSave: true,
      confirmWinnerChanges: true,
      enableTiming: false,
      prices: { standard: 1200 },
    },
    participants: [
      { id: "participant-a", name: "Ada", email: "ada@example.test", phone: "", notes: "" },
      { id: "participant-b", name: "Ben", email: "", phone: "", notes: "" },
      { id: "participant-c", name: "Cleo", email: "", phone: "", notes: "" },
      { id: "participant-d", name: "Dev", email: "", phone: "", notes: "" },
      { id: "participant-e", name: "Emi", email: "", phone: "", notes: "" },
    ],
    entries: [
      { id: "car-a", participantId: "participant-a", carNumber: 1, name: "Alpha", categoryId: "standard", quantity: 1, active: true },
      { id: "car-b", participantId: "participant-b", carNumber: 2, name: "Bravo", categoryId: "standard", quantity: 1, active: true },
      { id: "car-c", participantId: "participant-c", carNumber: 3, name: "Charlie", categoryId: "standard", quantity: 1, active: true },
      { id: "car-d", participantId: "participant-d", carNumber: 4, name: "Delta", categoryId: "standard", quantity: 1, active: true },
      { id: "car-e", participantId: "participant-e", carNumber: 5, name: "Echo", categoryId: "standard", quantity: 1, active: true },
    ],
    matches: [{
      id: "pre-m01-h01",
      phase: "preliminary",
      matchNumber: 1,
      heatNumber: 1,
      lanes: ["car-a", "car-b", "car-c"],
      status: "scheduled",
      winnerEntryId: null,
      laneTimesMs: [null, null, null],
      notes: "Scheduled registration impact",
    }],
    finals: [],
    payments: [
      { id: "payment-b", participantId: "participant-b", amountCents: 600, kind: "payment", paidAt: "2026-08-14T02:00:00.000Z", note: "Partial" },
      { id: "payment-c", participantId: "participant-c", amountCents: 1200, kind: "payment", paidAt: "2026-08-14T02:00:00.000Z", note: "Paid" },
      { id: "payment-d", participantId: "participant-d", amountCents: 1500, kind: "payment", paidAt: "2026-08-14T02:00:00.000Z", note: "Credit" },
      { id: "payment-e", participantId: "participant-e", amountCents: 1200, kind: "payment", paidAt: "2026-08-14T02:00:00.000Z", note: "Paid before refund" },
      { id: "refund-e", participantId: "participant-e", amountCents: 400, kind: "refund", paidAt: "2026-08-14T03:00:00.000Z", note: "Refund" },
    ],
    auditLog: [],
  };
  const validated = validateEventState(input);
  if (!validated.success) throw new Error("Registration fixture must be valid");
  return validated.data;
}

beforeEach(async () => {
  sequence += 1;
  database = createProDatabase(`rr3-pro-registration-${sequence}`);
  repository = new EventRepository(database);
  await repository.save(registrationEvent(), {
    commandId: `registration-bootstrap-${sequence}`,
    timestamp: "2026-08-14T01:00:00.000Z",
    summary: "Registration fixture",
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
      now={() => "2026-08-14T06:00:00.000Z"}
      createId={() => `registration-command-${sequence}-${Math.random().toString(36).slice(2)}`}
    >
      <RegistrationPage />
    </EventProvider>,
  );
}

describe("RegistrationPage", () => {
  it("searches, filters, and sorts an accessible single-DOM registration table without ID drift", async () => {
    const user = userEvent.setup();
    renderPage();

    const table = await screen.findByRole("table", { name: "Registered cars" });
    expect(within(table).getAllByRole("row")).toHaveLength(6);
    expect(screen.getAllByRole("button", { name: /Edit participant/ })).toHaveLength(5);

    await user.type(screen.getByRole("searchbox", { name: "Search registration" }), "Ben");
    expect(within(table).getByText("Ben")).toBeTruthy();
    expect(within(table).queryByText("Ada")).toBeNull();
    await user.clear(screen.getByRole("searchbox", { name: "Search registration" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Sort registration" }), "car-number");
    await user.click(screen.getByRole("button", { name: "Sort descending" }));
    const dataRows = within(table).getAllByRole("row").slice(1);
    expect(within(dataRows[0]!).getByText("5")).toBeTruthy();

    const idsBefore = (await repository.load())!.entries.map(({ id }) => id);
    await user.selectOptions(screen.getByRole("combobox", { name: "Registration status" }), "withdrawn");
    expect(within(table).getAllByRole("row")).toHaveLength(1);
    expect((await repository.load())!.entries.map(({ id }) => id)).toEqual(idsBefore);
  });

  it("edits a participant with stable IDs and blocks duplicate active car numbers precisely", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("table", { name: "Registered cars" });

    await user.click(screen.getByRole("button", { name: "Edit participant Ada" }));
    const editor = screen.getByRole("form", { name: "Edit Ada" });
    const name = within(editor).getByRole("textbox", { name: "Participant name" });
    await user.clear(name);
    await user.type(name, "Ada Updated");
    const number = within(editor).getByRole("spinbutton", { name: "Alpha car number" });
    await user.clear(number);
    await user.type(number, "2");
    await user.click(within(editor).getByRole("button", { name: "Save participant" }));
    expect(within(editor).getByText("Active car number 2 is already used.")).toBeTruthy();

    await user.clear(number);
    await user.type(number, "1");
    await user.click(within(editor).getByRole("button", { name: "Save participant" }));
    expect(await screen.findByText("Ada Updated")).toBeTruthy();
    const saved = await repository.load();
    expect(saved?.participants.find(({ id }) => id === "participant-a")?.name).toBe("Ada Updated");
    expect(saved?.entries.find(({ id }) => id === "car-a")?.carNumber).toBe(1);
  });

  it("previews scheduled-race impact before withdrawal and restores the same car ID", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("table", { name: "Registered cars" });

    await user.click(screen.getByRole("button", { name: "Withdraw car 1 Alpha" }));
    const confirmation = screen.getByRole("alertdialog", { name: "Confirm car withdrawal" });
    expect(within(confirmation).getByText("Car 1 appears in 1 scheduled heat.")).toBeTruthy();
    expect((await repository.load())?.entries.find(({ id }) => id === "car-a")?.active).toBe(true);
    await user.click(within(confirmation).getByRole("button", { name: "Confirm withdrawal" }));
    expect(await screen.findByText("Withdrawn", { selector: ".status-label" })).toBeTruthy();
    expect((await repository.load())?.entries.find(({ id }) => id === "car-a")?.active).toBe(false);

    await user.click(screen.getByRole("button", { name: "Restore car 1 Alpha" }));
    await waitFor(async () => {
      expect((await repository.load())?.entries.find(({ id }) => id === "car-a")?.active).toBe(true);
    });
    expect((await repository.load())?.matches[0]?.lanes).toContain("car-a");
  });

  it("moves focus into the withdrawal alertdialog, traps background interaction, and restores focus on Escape", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("table", { name: "Registered cars" });
    const trigger = screen.getByRole("button", { name: "Withdraw car 1 Alpha" });

    await user.click(trigger);

    const confirmation = screen.getByRole("alertdialog", { name: "Confirm car withdrawal" });
    expect(document.activeElement).toBe(within(confirmation).getByRole("button", { name: "Confirm withdrawal" }));
    expect(screen.getByRole("searchbox", { name: "Search registration" }).closest("[inert]")).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog", { name: "Confirm car withdrawal" })).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect((await repository.load())?.entries.find(({ id }) => id === "car-a")?.active).toBe(true);
  });

  it("adds categories and a participant with multiple validated cars and stable collision-safe IDs", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("table", { name: "Registered cars" });

    await user.type(screen.getByRole("textbox", { name: "New category ID" }), "premium");
    await user.type(screen.getByRole("textbox", { name: "New category price in cents" }), "2000");
    await user.click(screen.getByRole("button", { name: "Add category" }));
    expect(await screen.findByRole("textbox", { name: "premium price in cents" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Add participant" }));
    const form = screen.getByRole("form", { name: "Add participant" });
    await user.click(within(form).getByRole("button", { name: "Save participant" }));
    expect(within(form).getByText("Participant name is required.")).toBeTruthy();
    await user.type(within(form).getByRole("textbox", { name: "Participant name" }), "Farah");
    await user.type(within(form).getByRole("textbox", { name: "Car 1 name" }), "Falcon");
    await user.clear(within(form).getByRole("spinbutton", { name: "Car 1 number" }));
    await user.type(within(form).getByRole("spinbutton", { name: "Car 1 number" }), "2");
    await user.click(within(form).getByRole("button", { name: "Save participant" }));
    expect(within(form).getByText("Active car number 2 is already used.")).toBeTruthy();
    await user.clear(within(form).getByRole("spinbutton", { name: "Car 1 number" }));
    await user.type(within(form).getByRole("spinbutton", { name: "Car 1 number" }), "6");
    await user.selectOptions(within(form).getByRole("combobox", { name: "Car 1 category" }), "premium");
    await user.click(within(form).getByRole("button", { name: "Add another car" }));
    await user.type(within(form).getByRole("textbox", { name: "Car 2 name" }), "Comet");
    await user.clear(within(form).getByRole("spinbutton", { name: "Car 2 number" }));
    await user.type(within(form).getByRole("spinbutton", { name: "Car 2 number" }), "7");
    await user.click(within(form).getByRole("button", { name: "Save participant" }));

    expect(await screen.findAllByText("Farah")).toHaveLength(2);
    const saved = (await repository.load())!;
    const participant = saved.participants.find(({ name }) => name === "Farah")!;
    const cars = saved.entries.filter(({ participantId }) => participantId === participant.id);
    expect(cars.map(({ carNumber, name, categoryId }) => ({ carNumber, name, categoryId }))).toEqual([
      { carNumber: 6, name: "Falcon", categoryId: "premium" },
      { carNumber: 7, name: "Comet", categoryId: "standard" },
    ]);
    expect(new Set([participant.id, ...cars.map(({ id }) => id)]).size).toBe(3);
    expect(saved.settings.prices.premium).toBe(2000);
  });

  it("rejects a category price whose full candidate account aggregation exceeds safe integers", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("table", { name: "Registered cars" });
    const before = (await repository.load())!.settings.prices.standard;
    const price = screen.getByRole("textbox", { name: "standard price in cents" });

    await user.clear(price);
    await user.type(price, String(Number.MAX_SAFE_INTEGER));
    await user.click(screen.getByRole("button", { name: "Save category prices" }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/safe integer range/i);
    expect((await repository.load())!.settings.prices.standard).toBe(before);
  });

  it("generates a collision-safe payment ID instead of deriving it from collection length", async () => {
    const seeded = (await repository.load())!;
    seeded.payments.push({
      id: "account-payment-participant-a-7",
      participantId: "participant-a",
      amountCents: 100,
      kind: "payment",
      paidAt: "2026-08-14T04:00:00.000Z",
      note: "Occupies the old length-derived ID",
    });
    await repository.save(seeded, {
      commandId: "payment-collision-seed",
      timestamp: "2026-08-14T04:00:00.000Z",
      summary: "Seed payment collision",
    });
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("table", { name: "Registered cars" });

    await user.click(screen.getByRole("button", { name: "Manage account Ada" }));
    const account = screen.getByRole("region", { name: "Ada account" });
    await user.type(within(account).getByRole("textbox", { name: "Amount in cents" }), "200");
    await user.click(within(account).getByRole("button", { name: "Record payment" }));

    await waitFor(async () => expect((await repository.load())!.payments).toHaveLength(7));
    const ids = (await repository.load())!.payments.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses current category prices and manages unpaid, partial, paid, credit, and refund accounts", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("table", { name: "Registered cars" });

    expect(screen.getByText("Ada · Unpaid · $12.00 due")).toBeTruthy();
    expect(screen.getByText("Ben · Partial · $6.00 due")).toBeTruthy();
    expect(screen.getByText("Cleo · Paid · $0.00 due")).toBeTruthy();
    expect(screen.getByText("Dev · Credit · $3.00 credit")).toBeTruthy();
    expect(screen.getByText("Emi · Refunded · $4.00 due")).toBeTruthy();

    const price = screen.getByRole("textbox", { name: "standard price in cents" });
    await user.clear(price);
    await user.type(price, "1500");
    await user.click(screen.getByRole("button", { name: "Save category prices" }));
    expect(await screen.findByText("Ada · Unpaid · $15.00 due")).toBeTruthy();
    expect((await repository.load())?.settings.prices.standard).toBe(1500);

    await user.click(screen.getByRole("button", { name: "Manage account Ada" }));
    const account = screen.getByRole("region", { name: "Ada account" });
    await user.type(within(account).getByRole("textbox", { name: "Amount in cents" }), "1500");
    await user.click(within(account).getByRole("button", { name: "Record payment" }));
    expect(await within(account).findByText("Paid · $0.00 due")).toBeTruthy();
    await user.selectOptions(within(account).getByRole("combobox", { name: "Account entry type" }), "refund");
    const amount = within(account).getByRole("textbox", { name: "Amount in cents" });
    await user.clear(amount);
    await user.type(amount, "200");
    await user.click(within(account).getByRole("button", { name: "Record refund" }));
    expect(await within(account).findByText("Refunded · $2.00 due")).toBeTruthy();
  });
});
