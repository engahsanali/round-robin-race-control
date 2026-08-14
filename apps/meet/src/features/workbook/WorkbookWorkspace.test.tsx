import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { makeMeet, withSchedule } from "../../test/workbookFixtures";
import { MeetProviders } from "../../app/MeetProviders";
import type { WorkbookActions } from "./WorkbookWorkspace";
import { WorkbookWorkspace } from "./WorkbookWorkspace";

const actions = (): WorkbookActions => ({
  saveSetup: vi.fn(async () => ({ ok: true, message: "Workbook saved." })),
  saveRegistration: vi.fn(async () => ({ ok: true, message: "Registration saved." })),
  activateSchedule: vi.fn(async () => ({ ok: true, message: "Schedule activated." })),
  confirmWinner: vi.fn(async () => ({ ok: true, message: "Winner confirmed." })),
  correctWinner: vi.fn(async () => ({ ok: true, message: "Winner corrected." })),
  confirmAdvancement: vi.fn(async () => ({ ok: true, message: "Advancement confirmed." })),
  replaceAdvancement: vi.fn(async () => ({ ok: true, message: "Advancement replaced." })),
});

function renderWorkbook(options: { meet?: ReturnType<typeof makeMeet>; role?: "owner" | "organiser" | "marshal" | "viewer"; readOnly?: boolean; actions?: WorkbookActions } = {}) {
  const role = options.role ?? "owner";
  render(
    <MeetProviders selected={{ id: "org", name: "Track Club", slug: "track", role, version: 1 }}>
      <WorkbookWorkspace meet={options.meet ?? makeMeet(15, 12)} role={role} readOnly={options.readOnly ?? false} actions={options.actions ?? actions()} />
    </MeetProviders>,
  );
}

describe("single-page Meet workbook", () => {
  it("mounts 15 anchored summaries but lazy-renders only the selected sheet details", () => {
    renderWorkbook();
    expect(screen.getAllByTestId("bracket-sheet")).toHaveLength(15);
    expect(screen.getAllByRole("heading", { name: /cars and participants/i })).toHaveLength(1);
    expect(screen.getAllByText(/12 active cars/i)).toHaveLength(15);
    expect(document.querySelectorAll(".table-scroll").length).toBeGreaterThan(0);
    expect(document.querySelector(".workbook-page")).not.toBeNull();
  });

  it("uses bracket, round and heat terminology with anchored navigation and a text-equivalent progression table", async () => {
    renderWorkbook({ meet: makeMeet(3, 3) });
    expect(screen.queryByText(/^match$/i)).toBeNull();
    expect(screen.getByRole("table", { name: /progression connections/i })).not.toBeNull();
    await userEvent.click(screen.getByRole("link", { name: /qualifier 2/i }));
    expect(document.querySelectorAll('[id^="bracket-"]')[1]).not.toBeNull();
  });

  it("opens accessible setup and registration dialogs and returns focus on Escape", async () => {
    renderWorkbook({ meet: makeMeet(2, 3) });
    const setup = screen.getByRole("button", { name: /meet setup/i });
    await userEvent.click(setup);
    expect(screen.getByRole("dialog", { name: /meet setup/i })).not.toBeNull();
    expect(screen.getByRole("dialog", { name: /meet setup/i }).contains(document.activeElement)).toBe(true);
    await userEvent.keyboard("{Escape}");
    expect(document.activeElement).toBe(setup);

    await userEvent.click(screen.getByRole("button", { name: /registration/i }));
    expect(screen.getByRole("dialog", { name: /registration/i })).not.toBeNull();
  });

  it("configures new brackets and a forward progression edge from the one setup sheet", async () => {
    const commands = actions();
    renderWorkbook({ meet: makeMeet(2, 3), actions: commands });
    await userEvent.click(screen.getByRole("button", { name: /meet setup/i }));
    const dialog = screen.getByRole("dialog", { name: /meet setup/i });
    await userEvent.click(within(dialog).getByRole("button", { name: /add bracket/i }));
    expect(within(dialog).getAllByLabelText(/bracket \d+ name/i)).toHaveLength(3);
    await userEvent.click(within(dialog).getByRole("button", { name: /add progression rule/i }));
    expect(within(dialog).getAllByText(/top n advance/i).length).toBeGreaterThan(0);
    await userEvent.click(within(dialog).getByRole("button", { name: /save workbook/i }));
    expect(commands.saveSetup).toHaveBeenCalledWith(expect.objectContaining({ brackets: expect.arrayContaining([expect.objectContaining({ displayOrder: 3 })]), advancementRules: expect.arrayContaining([expect.objectContaining({ topN: 3 })]) }));
  });

  it("shows no rank before results, then supports lane keyboard confirmation and reasoned correction", async () => {
    const meet = withSchedule(makeMeet(1, 3));
    const commands = actions();
    renderWorkbook({ meet, actions: commands });
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    await userEvent.keyboard("1{Enter}");
    expect(commands.confirmWinner).toHaveBeenCalledWith(expect.objectContaining({ lane: 1, expectedVersion: 1 }));

    meet.brackets[0]!.event.matches[0]!.status = "completed";
    meet.brackets[0]!.event.matches[0]!.winnerEntryId = meet.brackets[0]!.event.matches[0]!.lanes[0];
    renderWorkbook({ meet, actions: commands });
    await userEvent.click(screen.getByRole("button", { name: /correct result/i }));
    const correction = screen.getByRole("dialog", { name: /correct official result/i });
    await userEvent.type(within(correction).getByLabelText(/reason/i), "Finish camera review");
    await userEvent.click(within(correction).getByRole("button", { name: /save correction/i }));
    expect(commands.correctWinner).toHaveBeenCalledWith(expect.objectContaining({ reason: "Finish camera review" }));
  });

  it("enforces role controls, supports expand all and exposes printable all-sheet credit", async () => {
    renderWorkbook({ meet: makeMeet(3, 3), role: "viewer", readOnly: true });
    expect(screen.queryByRole("button", { name: /activate schedule/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /confirm winner/i })).toBeNull();
    expect(screen.getByText(/read-only viewer/i)).not.toBeNull();
    expect(screen.getByText("Made by Cesar Lacsamana and Ahsan Ali")).not.toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /expand all/i }));
    expect(screen.getAllByRole("heading", { name: /cars and participants/i })).toHaveLength(3);
  });
});
