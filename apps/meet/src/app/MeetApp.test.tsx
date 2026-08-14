import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AuthoritativeWorkbook, MeetApp, OperatorConflictNotice } from "./MeetApp";
import type { AuthPort } from "./AuthBoundary";
import type { CommandReceipt, MeetRepository, OrganisationSummary } from "../data/meetRepository";
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

  it("closes organisation-scoped team/admin state before failed reads for the next organisation", async () => {
    const organisations: OrganisationSummary[] = [
      { id: "org-a", name: "Alpha Club", slug: "alpha", role: "owner", version: 1 },
      { id: "org-b", name: "Beta Club", slug: "beta", role: "owner", version: 1 },
    ];
    const repository = officialRepository({
      listOrganisations: async () => organisations,
      listMembers: async (organisationId: string) => organisationId === "org-a" ? [{ userId: "alpha-user", role: "viewer", displayName: "Alpha Viewer", email: null }] : Promise.reject(new Error("unavailable")),
      loadAdminOverview: async (organisationId: string) => organisationId === "org-a" ? { activeMeetCount: 1, runningMeetCount: 1, staleAdvancementCount: 0, unresolvedTieCount: 0, recentActivity: [{ id: "alpha-audit", meetId: null, action: "alpha.secret", actorId: "alpha-user", occurredAt: "2026-08-14T10:00:00Z" }] } : Promise.reject(new Error("unavailable")),
      listSecurityEvents: async (organisationId: string) => organisationId === "org-a" ? [{ id: "alpha-security", organisationId: "org-a", actorId: "alpha-user", subjectUserId: null, eventType: "alpha.sign_in", occurredAt: "2026-08-14T10:00:00Z", metadata: {} }] : Promise.reject(new Error("unavailable")),
    });
    render(<MeetApp productionRepository={repository} auth={signedInAuth()} />);
    expect(await screen.findByRole("heading", { name: "Alpha Club" })).not.toBeNull();
    expect(await screen.findByText(/alpha\.secret/i)).not.toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /open team/i }));
    expect(await screen.findByText("Alpha Viewer")).not.toBeNull();

    await userEvent.selectOptions(screen.getByLabelText(/^organisation$/i), "org-b");
    expect(await screen.findByRole("heading", { name: "Beta Club" })).not.toBeNull();
    expect(screen.queryByText("Alpha Viewer")).toBeNull();
    expect(screen.queryByText(/alpha\.secret/i)).toBeNull();
    expect(screen.queryByText(/alpha\.sign_in/i)).toBeNull();
    expect(screen.queryByRole("heading", { name: /team directory/i })).toBeNull();
    expect(await screen.findByText(/admin activity is temporarily unavailable/i)).not.toBeNull();
    expect(screen.queryByText(/alpha\.secret/i)).toBeNull();
  });

  it("reuses one request ID across uncertain failures and clears it only after a known terminal receipt", async () => {
    const requestIds: string[] = [];
    const receipts: Array<"network" | "offline" | "unknown" | "success" | "validation" | "success"> = ["network", "offline", "unknown", "success", "validation", "success"];
    const repository = officialRepository({
      saveMeetWorkbook: async (_organisationId: string, _meetId: string | null, _version: number | null, _workbook: Record<string, unknown>, requestId: string): Promise<CommandReceipt<{ meet_id: string; version: number; bracket_count: number; rule_count: number }>> => {
        requestIds.push(requestId);
        const next = receipts.shift()!;
        if (next === "success") return { ok: true, value: { meet_id: "saved-meet", version: 1, bracket_count: 1, rule_count: 0 }, requestId };
        return { ok: false, kind: next, message: `${next} failure`, requestId, statePreserved: true };
      },
    });
    render(<MeetApp productionRepository={repository} auth={signedInAuth()} />);
    expect(await screen.findByRole("heading", { name: "Alpha Club" })).not.toBeNull();
    await userEvent.click(await screen.findByRole("button", { name: /meet setup/i }));
    for (let attempt = 0; attempt < 4; attempt += 1) await userEvent.click(screen.getByRole("button", { name: /save workbook/i }));
    expect(new Set(requestIds.slice(0, 4))).toEqual(new Set([requestIds[0]!]));

    await userEvent.click(await screen.findByRole("button", { name: /meet setup/i }));
    await userEvent.click(screen.getByRole("button", { name: /save workbook/i }));
    await userEvent.click(screen.getByRole("button", { name: /save workbook/i }));
    expect(requestIds[4]).not.toBe(requestIds[3]);
    expect(requestIds[5]).not.toBe(requestIds[4]);
  });
});

function signedInAuth(): AuthPort {
  return {
    getSession: async () => ({ session: { user: { id: "official-user", email: "official@example.com" } } }),
    onAuthStateChange: () => () => undefined,
    exchangeCodeForSession: async () => ({ session: null }), signUp: async () => ({ session: null, confirmationPending: true }),
    signIn: async () => ({ session: null }), signOut: async () => undefined, requestPasswordRecovery: async () => undefined, updatePassword: async () => undefined,
  };
}

function officialRepository(overrides: Record<string, unknown> = {}): MeetRepository {
  const organisation = { id: "org-a", name: "Alpha Club", slug: "alpha", role: "owner", version: 1 } satisfies OrganisationSummary;
  return {
    listOrganisations: async () => [organisation], listMembers: async () => [], listMeets: async () => [],
    loadAdminOverview: async () => ({ activeMeetCount: 0, runningMeetCount: 0, staleAdvancementCount: 0, unresolvedTieCount: 0, recentActivity: [] }),
    listSecurityEvents: async () => [], loadMeet: async () => ({ ok: false, kind: "network", message: "refresh unavailable" }),
    watchMeet: () => () => undefined,
    saveMeetWorkbook: async (_organisationId: string, _meetId: string | null, _version: number | null, _workbook: Record<string, unknown>, requestId: string) => ({ ok: true, value: { meet_id: "saved-meet", version: 1, bracket_count: 1, rule_count: 0 }, requestId }),
    ...overrides,
  } as unknown as MeetRepository;
}
