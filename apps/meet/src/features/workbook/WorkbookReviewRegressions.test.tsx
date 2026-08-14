import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MeetProviders } from "../../app/MeetProviders";
import { makeMeet, withSchedule } from "../../test/workbookFixtures";
import type { WorkbookActions } from "./WorkbookWorkspace";
import { WorkbookWorkspace } from "./WorkbookWorkspace";
import * as workbookModel from "./workbookModel";

const actionSet = (): WorkbookActions => ({
  saveSetup: vi.fn(async () => ({ ok: true, message: "saved" })),
  saveRegistration: vi.fn(async () => ({ ok: true, message: "saved" })),
  activateSchedule: vi.fn(async () => ({ ok: true, message: "saved" })),
  confirmWinner: vi.fn(async () => ({ ok: true, message: "saved" })),
  correctWinner: vi.fn(async () => ({ ok: true, message: "saved" })),
});

function mount(meet = withSchedule(makeMeet(2, 3)), actions = actionSet(), onFormDirtyChange?: (dirty: boolean) => void) {
  render(<MeetProviders selected={{ id: "org", name: "Club", slug: "club", role: "owner", version: 1 }}><WorkbookWorkspace meet={meet} role="owner" readOnly={false} actions={actions} onFormDirtyChange={onFormDirtyChange} /></MeetProviders>);
  return actions;
}

describe("reviewed workbook interactions", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("never treats Enter on buttons, links or a modal descendant as a race confirmation", async () => {
    const actions = mount();
    const expand = screen.getByRole("button", { name: /expand all/i });
    expand.focus();
    await userEvent.keyboard("{Enter}");
    const link = screen.getByRole("link", { name: /qualifier 2/i });
    link.focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.click(screen.getByRole("button", { name: /meet setup/i }));
    screen.getByRole("button", { name: /save workbook/i }).focus();
    await userEvent.keyboard("{Enter}");
    expect(actions.confirmWinner).not.toHaveBeenCalled();
  });

  it("edits, filters and sorts registration while blocking protected withdrawals", async () => {
    const meet = withSchedule(makeMeet(1, 3));
    meet.brackets[0]!.lineage = [{ sourceBracketId: "source", sourceCarId: "car", ruleId: "rule", snapshotId: "snapshot" }];
    mount(meet);
    expect(screen.getByLabelText(/car status/i)).not.toBeNull();
    expect(screen.getByLabelText(/sort cars/i)).not.toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /registration/i }));
    const dialog = screen.getByRole("dialog", { name: /registration/i });
    expect(within(dialog).getByLabelText(/car 1 participant/i)).not.toBeNull();
    await userEvent.click(within(dialog).getByRole("button", { name: /withdraw car #1/i }));
    expect(screen.queryByRole("alertdialog", { name: /withdraw car #1/i })).toBeNull();
    expect(screen.getByRole("alert").textContent).toMatch(/replace.*schedule.*review.*advancement first/i);
  });

  it("truthfully describes upsert registration and reason-confirms an unscheduled status change", async () => {
    const actions = mount(makeMeet(1, 3));
    await userEvent.click(screen.getByRole("button", { name: /registration/i }));
    const dialog = screen.getByRole("dialog", { name: /registration/i });
    expect(within(dialog).getByRole("button", { name: /validate and save rows/i })).not.toBeNull();
    expect(within(dialog).getByText(/submitted rows add\/update; unlisted existing rows remain/i)).not.toBeNull();
    await userEvent.click(within(dialog).getByRole("button", { name: /withdraw car #1/i }));
    const confirmation = screen.getByRole("alertdialog", { name: /withdraw car #1/i });
    const confirm = within(confirmation).getByRole("button", { name: /confirm status change/i });
    expect(confirm.hasAttribute("disabled")).toBe(true);
    await userEvent.type(within(confirmation).getByLabelText(/^reason$/i), "  Car failed scrutineering  ");
    const enabledConfirm = within(confirmation).getByRole("button", { name: /confirm status change/i });
    expect(enabledConfirm.hasAttribute("disabled")).toBe(false);
    await userEvent.click(enabledConfirm);
    expect(within(dialog).getByRole("button", { name: /restore car #1/i })).not.toBeNull();
    await userEvent.click(within(dialog).getByRole("button", { name: /validate and save rows/i }));
    expect(actions.saveRegistration).toHaveBeenCalledWith(expect.objectContaining({
      rows: expect.arrayContaining([expect.objectContaining({ active: false, reason: "Car failed scrutineering" })]),
    }));
  });

  it("marks setup, registration and schedule drafts dirty and clears only on explicit cancel or success", async () => {
    const dirty = vi.fn();
    mount(makeMeet(1, 3), actionSet(), dirty);

    await userEvent.click(screen.getByRole("button", { name: /meet setup/i }));
    await userEvent.type(screen.getByLabelText(/meet name/i), " revised");
    expect(dirty).toHaveBeenLastCalledWith(true);
    await userEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(dirty).toHaveBeenLastCalledWith(false);

    await userEvent.click(screen.getByRole("button", { name: /registration/i }));
    await userEvent.type(screen.getByLabelText(/car 1 participant/i), " revised");
    expect(dirty).toHaveBeenLastCalledWith(true);
    await userEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(dirty).toHaveBeenLastCalledWith(false);

    await userEvent.click(screen.getByRole("button", { name: /generate candidate/i }));
    expect(dirty).toHaveBeenLastCalledWith(true);
    await userEvent.click(screen.getByRole("button", { name: /activate schedule/i }));
    expect(dirty).toHaveBeenLastCalledWith(false);
  });

  it("keeps a failed correction draft dirty and clears it after explicit cancel", async () => {
    const meet = withSchedule(makeMeet(1, 3));
    const heat = meet.brackets[0]!.event.matches[0]!;
    heat.status = "completed";
    heat.winnerEntryId = heat.lanes[0];
    const actions = actionSet();
    actions.correctWinner = vi.fn(async () => ({ ok: false, message: "conflict" }));
    const dirty = vi.fn();
    mount(meet, actions, dirty);

    await userEvent.click(screen.getByRole("button", { name: /correct result/i }));
    await userEvent.type(screen.getByLabelText(/^reason$/i), "Camera review");
    expect(dirty).toHaveBeenLastCalledWith(true);
    await userEvent.click(screen.getByRole("button", { name: /save correction/i }));
    expect(dirty).toHaveBeenLastCalledWith(true);
    await userEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(dirty).toHaveBeenLastCalledWith(false);
  });

  it("requires an official replacement reason and shows the full quality certificate", async () => {
    const meet = withSchedule(makeMeet(1, 9));
    mount(meet);
    await userEvent.click(screen.getByRole("button", { name: /generate candidate/i }));
    expect(screen.getByText(/appearances/i)).not.toBeNull();
    expect(screen.getByText(/byes/i)).not.toBeNull();
    expect(screen.getByText(/max car repeat burden/i)).not.toBeNull();
    const activate = screen.getByRole("button", { name: /activate schedule/i });
    expect(activate.hasAttribute("disabled")).toBe(true);
    await userEvent.type(screen.getByLabelText(/replacement reason/i), "Camera-approved redraw");
    expect(activate.hasAttribute("disabled")).toBe(false);
  });

  it("selects any completed heat for a reasoned correction", async () => {
    const meet = withSchedule(makeMeet(1, 3));
    const first = meet.brackets[0]!.event.matches[0]!;
    first.status = "completed"; first.winnerEntryId = first.lanes[0];
    const second = { ...first, id: "10000000-0000-4000-8000-000000009998", heatNumber: 2, winnerEntryId: first.lanes[1] };
    meet.brackets[0]!.event.matches.push(second);
    const actions = mount(meet);
    await userEvent.click(screen.getByRole("button", { name: /correct result/i }));
    await userEvent.selectOptions(screen.getByLabelText(/completed heat/i), second.id);
    await userEvent.type(screen.getByLabelText(/^reason$/i), "Finish camera appeal");
    await userEvent.click(screen.getByRole("button", { name: /save correction/i }));
    expect(actions.correctWinner).toHaveBeenCalledWith(expect.objectContaining({ heatId: second.id }));
  });

  it("supports multi-destination setup controls and safe removal", async () => {
    mount(makeMeet(3, 3));
    await userEvent.click(screen.getByRole("button", { name: /meet setup/i }));
    const dialog = screen.getByRole("dialog", { name: /meet setup/i });
    await userEvent.click(within(dialog).getByRole("button", { name: /add bracket/i }));
    await userEvent.click(within(dialog).getByRole("button", { name: /add progression rule/i }));
    expect(within(dialog).getByLabelText(/destination brackets/i).hasAttribute("multiple")).toBe(true);
    expect(within(dialog).getByLabelText(/destination capacity/i)).not.toBeNull();
    expect(within(dialog).getByLabelText(/rule status/i)).not.toBeNull();
    expect(within(dialog).getByRole("button", { name: /remove rule 1/i })).not.toBeNull();
    expect(within(dialog).getByRole("button", { name: /remove bracket 4/i })).not.toBeNull();
  });

  it("inerts the entire app, traps pointer focus and restores the trigger", async () => {
    mount();
    const trigger = screen.getByRole("button", { name: /meet setup/i });
    await userEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: /meet setup/i });
    const outside = screen.getByRole("button", { name: /expand all/i });
    expect(outside.closest("[inert]")).not.toBeNull();
    outside.focus();
    expect(dialog.contains(document.activeElement)).toBe(true);
    await userEvent.keyboard("{Escape}");
    expect(document.activeElement).toBe(trigger);
  });

  it("expands, scrolls and focuses an anchored bracket heading", async () => {
    if (!("scrollIntoView" in HTMLElement.prototype)) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: () => undefined });
    const scroll = vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => undefined);
    mount();
    await userEvent.click(screen.getByRole("link", { name: /qualifier 2/i }));
    const heading = screen.getByRole("heading", { name: "Qualifier 2" });
    expect(document.activeElement).toBe(heading);
    expect(scroll).toHaveBeenCalled();
    expect(screen.getAllByRole("heading", { name: /cars and participants/i })).toHaveLength(2);
  });

  it("calculates standings only inside selected or expanded detail boundaries", () => {
    const selector = vi.spyOn(workbookModel, "selectBracketView");
    mount(makeMeet(15, 12));
    expect(selector).toHaveBeenCalledTimes(1);
  });

  it("waits two frames to print all, then restores the selected layout", async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    mount(makeMeet(3, 3));
    await userEvent.click(screen.getByRole("button", { name: /print all/i }));
    expect(print).not.toHaveBeenCalled();
    await act(async () => { frames.shift()?.(0); });
    expect(print).not.toHaveBeenCalled();
    await act(async () => { frames.shift()?.(16); });
    expect(print).toHaveBeenCalledOnce();
    expect(screen.getAllByRole("heading", { name: /cars and participants/i })).toHaveLength(1);
  });

  it("renders a labelled semantic SVG progression and unique keyboard help targets", async () => {
    mount(makeMeet(3, 3));
    expect(screen.getByRole("img", { name: /qualifier.*semifinal.*final/i })).not.toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /expand all/i }));
    const ids = [...document.querySelectorAll('[id^="keyboard-help-"]')].map((node) => node.id);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
  });
});
