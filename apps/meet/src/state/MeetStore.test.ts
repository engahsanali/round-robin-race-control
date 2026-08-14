import { describe, expect, it } from "vitest";
import { createInitialMeetStoreState, createStoreCommandRunner, meetStoreReducer, roleCapabilities } from "./MeetStore";
import { validMeet } from "../test/fixtures";

describe("Meet store", () => {
  it("prevents duplicate pending request ids and never claims saved before success", () => {
    const requestId = "00000000-0000-4000-8000-000000000051";
    const initial = createInitialMeetStoreState();
    const pending = meetStoreReducer(initial, { type: "command.started", requestId });
    const duplicate = meetStoreReducer(pending, { type: "command.started", requestId });
    expect(pending.saveStatus).toBe("saving");
    expect(duplicate).toBe(pending);
    const saved = meetStoreReducer(pending, { type: "command.succeeded", requestId, advisory: null });
    expect(saved.saveStatus).toBe("saved");
  });

  it("preserves a validated snapshot on command failure and surfaces advisory separately", () => {
    const requestId = "00000000-0000-4000-8000-000000000052";
    const snapshot = validMeet();
    const loaded = meetStoreReducer(createInitialMeetStoreState(), { type: "snapshot.loaded", snapshot, syncedAt: "2026-08-14T10:00:00.000Z" });
    const pending = meetStoreReducer(loaded, { type: "command.started", requestId });
    const failed = meetStoreReducer(pending, { type: "command.failed", requestId, message: "Conflict" });
    expect(failed.snapshot).toEqual(snapshot);
    expect(failed.saveStatus).toBe("error");
    const retried = meetStoreReducer(failed, { type: "command.started", requestId: `${requestId.slice(0, -1)}3` });
    const advised = meetStoreReducer(retried, { type: "command.succeeded", requestId: `${requestId.slice(0, -1)}3`, advisory: "Committed; refresh needed" });
    expect(advised.advisory).toBe("Committed; refresh needed");
  });

  it("does not replace dirty form input when realtime changes arrive", () => {
    const initial = meetStoreReducer(createInitialMeetStoreState(), { type: "form.dirty", dirty: true });
    const next = meetStoreReducer(initial, { type: "realtime.snapshot", snapshot: validMeet(), syncedAt: "2026-08-14T10:01:00.000Z" });
    expect(next.snapshot).toBeNull();
    expect(next.remoteUpdatePending).toBe(true);
  });

  it("derives truthful role capabilities", () => {
    expect(roleCapabilities("owner")).toMatchObject({ manageTeam: true, configureMeet: true, recordResults: true, confirmAdvancement: true });
    expect(roleCapabilities("marshal")).toMatchObject({ manageTeam: false, configureMeet: false, recordResults: true, confirmAdvancement: false });
    expect(roleCapabilities("viewer")).toMatchObject({ manageTeam: false, configureMeet: false, recordResults: false, confirmAdvancement: false });
  });

  it("initialises selected workspace/organisation/role and resets them on boundary changes", () => {
    const official = createInitialMeetStoreState({ workspace: "official", organisationId: "org-1", role: "marshal" });
    expect(official).toMatchObject({ workspace: "official", selectedOrganisationId: "org-1", role: "marshal" });
    const demo = meetStoreReducer(official, { type: "workspace.selected", workspace: "demo" });
    expect(demo).toMatchObject({ workspace: "demo", selectedOrganisationId: null, role: null, snapshot: null });
    const signedOut = meetStoreReducer(official, { type: "session.cleared" });
    expect(signedOut).toMatchObject({ workspace: "official", selectedOrganisationId: null, role: null, snapshot: null });
  });

  it("blocks same-tick duplicate commands synchronously and clears pending even when the command throws", async () => {
    const actions: string[] = [];
    let release: ((value: { ok: true; value: {}; requestId: string }) => void) | undefined;
    const runner = createStoreCommandRunner((action) => actions.push(action.type));
    const requestId = "00000000-0000-4000-8000-000000000060";
    const first = runner<{}>(requestId, () => new Promise((resolve) => { release = resolve; }));
    const duplicate = await runner(requestId, async () => ({ ok: true, value: {}, requestId }));
    expect(duplicate).toMatchObject({ ok: false, kind: "duplicate" });
    release?.({ ok: true, value: {}, requestId });
    await first;
    const thrown = await runner("00000000-0000-4000-8000-000000000061", async () => { throw new Error("fetch failed"); });
    expect(thrown).toMatchObject({ ok: false, kind: "network", statePreserved: true });
    expect(actions).toEqual(["command.started", "command.succeeded", "command.started", "command.failed"]);
  });
});
