import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AuthoritativeWorkbook, MeetApp, OperatorConflictNotice } from "./MeetApp";
import type { MeetRepository } from "../data/meetRepository";
import { MeetStoreProvider } from "../state/MeetStore";
import { makeMeet, withSchedule } from "../test/workbookFixtures";
import type { WorkbookActions } from "../features/workbook/WorkbookWorkspace";

function actions(): WorkbookActions {
  return { saveSetup: vi.fn(async () => ({ ok: true, message: "Saved" })), saveRegistration: vi.fn(async () => ({ ok: true, message: "Saved" })), activateSchedule: vi.fn(async () => ({ ok: true, message: "Saved" })), confirmWinner: vi.fn(async () => ({ ok: true, message: "Saved" })), correctWinner: vi.fn(async () => ({ ok: true, message: "Saved" })), confirmAdvancement: vi.fn(async () => ({ ok: true, message: "Saved" })), replaceAdvancement: vi.fn(async () => ({ ok: true, message: "Saved" })) };
}

describe("Meet application shell", () => {
  it("enters read-only demo without any production auth, query, rpc or realtime call", async () => {
    const production = new Proxy({}, { get: () => vi.fn(() => { throw new Error("production call attempted"); }) }) as MeetRepository;
    render(<MeetApp productionRepository={production} auth={null} initialMode="welcome" />);
    await userEvent.click(screen.getByRole("button", { name: /explore read-only demo/i }));
    expect(screen.getByRole("heading", { name: /demo championship meet/i })).not.toBeNull();
    expect(screen.getAllByText(/read-only/i).length).toBeGreaterThan(0);
  });

  it("requires a signed-in session and active membership for official work", () => {
    render(<MeetApp productionRepository={null} auth={null} initialMode="welcome" />);
    expect(screen.getByRole("heading", { name: /sign in to meet edition/i })).not.toBeNull();
    expect(screen.queryByRole("heading", { name: /official workspace/i })).toBeNull();
  });

  it("gives officials explicit keep-draft and authoritative-reload conflict actions", async () => {
    const keepDraft = vi.fn();
    const reloadAuthoritative = vi.fn();
    render(<OperatorConflictNotice message="A remote update is waiting." onKeepDraft={keepDraft} onReloadAuthoritative={reloadAuthoritative} />);

    await userEvent.click(screen.getByRole("button", { name: /keep my draft/i }));
    await userEvent.click(screen.getByRole("button", { name: /review\/reload authoritative/i }));

    expect(screen.getByRole("alert").textContent).toContain("A remote update is waiting.");
    expect(keepDraft).toHaveBeenCalledOnce();
    expect(reloadAuthoritative).toHaveBeenCalledOnce();
  });

  it("authoritative acceptance remounts all local drafts before new versions can be submitted", async () => {
    const meet = withSchedule(makeMeet(1, 3));
    meet.brackets[0]!.event.matches[0]!.status = "completed";
    meet.brackets[0]!.event.matches[0]!.winnerEntryId = meet.brackets[0]!.event.matches[0]!.lanes[0];
    const workbookActions = actions();
    const renderWorkbook = (draftEpoch: number, version: number) => <MeetStoreProvider><AuthoritativeWorkbook draftEpoch={draftEpoch} meet={meet} heatVersions={{ [meet.brackets[0]!.event.matches[0]!.id]: version }} role="organiser" readOnly={false} actions={workbookActions} onFormDirtyChange={() => undefined} /></MeetStoreProvider>;
    const view = render(renderWorkbook(1, 3));
    await userEvent.click(screen.getByRole("button", { name: /meet setup/i }));
    await userEvent.clear(screen.getByLabelText(/meet name/i));
    await userEvent.type(screen.getByLabelText(/meet name/i), "Unsaved local name");
    view.rerender(renderWorkbook(2, 4));
    expect(screen.queryByRole("dialog", { name: /meet setup/i })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /correct result/i }));
    await userEvent.type(screen.getByLabelText(/^reason$/i), "Old correction draft");
    view.rerender(renderWorkbook(3, 5));
    expect(screen.queryByRole("dialog", { name: /correct official result/i })).toBeNull();
    expect(workbookActions.correctWinner).not.toHaveBeenCalled();
  });
});
