import { describe, expect, it } from "vitest";
import { createInitialMeetStoreState, createStoreCommandRunner, meetStoreReducer, roleCapabilities } from "./MeetStore";
import { validMeet } from "../test/fixtures";
import type { HostedMeetBundle } from "../data/meetRepository";

function bundle(snapshot = validMeet()): HostedMeetBundle {
  return {
    state: snapshot,
    history: {
      snapshots: [{ id: "snapshot-old", ruleId: "rule", sourceBracketId: "source", sourceResultVersion: 1, stale: true, replacedBySnapshotId: "snapshot-current", confirmedBy: "official", reason: "Appeal", confirmedAt: "2026-08-14T09:00:00Z" }],
      selections: [{ id: "selection-old", snapshotId: "snapshot-old", ruleId: "rule", sourceBracketId: "source", sourceCarId: "car", destinationBracketId: "final", destinationCarId: "old-car", rank: 1 }],
    },
    heatVersions: { heat: 3 },
  };
}

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
    const current = bundle();
    const initial = meetStoreReducer(meetStoreReducer(createInitialMeetStoreState(), { type: "bundle.loaded", bundle: current, syncedAt: "2026-08-14T10:00:00.000Z" }), { type: "form.dirty", dirty: true });
    const remote = bundle({ ...validMeet(), meet: { ...validMeet().meet, version: 4 } });
    const next = meetStoreReducer(initial, { type: "realtime.bundle", bundle: remote, syncedAt: "2026-08-14T10:01:00.000Z" });
    expect(next.bundle).toEqual(current);
    expect(next.bundle?.heatVersions).toEqual({ heat: 3 });
    expect(next.queuedRemoteBundle).toEqual(remote);
    expect(next.conflict).toMatchObject({ kind: "dirty-realtime" });
    const applied = meetStoreReducer(next, { type: "remote-update.applied" });
    expect(applied.bundle).toEqual(remote);
    expect(applied.snapshot).toEqual(remote.state);
    expect(applied).toMatchObject({ queuedRemoteBundle: null, conflict: null, formDirty: false });
  });

  it("keeps the entire applied bundle atomic until the operator accepts the queued remote bundle", () => {
    const current = bundle();
    const remote = bundle({ ...validMeet(), meet: { ...validMeet().meet, version: 4 } });
    remote.heatVersions = { heat: 4 };
    let state = meetStoreReducer(createInitialMeetStoreState(), { type: "bundle.loaded", bundle: current, syncedAt: "2026-08-14T10:00:00.000Z" });
    state = meetStoreReducer(state, { type: "form.dirty", dirty: true });
    state = meetStoreReducer(state, { type: "realtime.bundle", bundle: remote, syncedAt: "2026-08-14T10:01:00.000Z" });

    expect(state.snapshot?.meet.version).toBe(3);
    expect(state.bundle?.heatVersions).toEqual({ heat: 3 });
    expect(state.queuedRemoteBundle?.heatVersions).toEqual({ heat: 4 });

    const accepted = meetStoreReducer(state, { type: "remote-update.accepted" });
    expect(accepted.snapshot?.meet.version).toBe(4);
    expect(accepted.bundle?.heatVersions).toEqual({ heat: 4 });
    expect(accepted).toMatchObject({ queuedRemoteBundle: null, formDirty: false, conflict: null });
  });

  it("lets an operator explicitly keep a dirty local draft without partially applying the queued bundle", () => {
    const current = bundle();
    const remote = bundle({ ...validMeet(), meet: { ...validMeet().meet, version: 4 } });
    remote.heatVersions = { heat: 4 };
    let state = meetStoreReducer(createInitialMeetStoreState(), { type: "bundle.loaded", bundle: current, syncedAt: "2026-08-14T10:00:00.000Z" });
    state = meetStoreReducer(state, { type: "form.dirty", dirty: true });
    state = meetStoreReducer(state, { type: "realtime.bundle", bundle: remote, syncedAt: "2026-08-14T10:01:00.000Z" });

    const kept = meetStoreReducer(state, { type: "remote-update.discarded" });
    expect(kept.bundle).toEqual(current);
    expect(kept.bundle?.heatVersions).toEqual({ heat: 3 });
    expect(kept).toMatchObject({ queuedRemoteBundle: null, formDirty: true, conflict: null });
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

  it("retains an explicit optimistic conflict instead of reducing it to a generic save error", async () => {
    const dispatched: Parameters<typeof meetStoreReducer>[1][] = [];
    const runner = createStoreCommandRunner((action) => dispatched.push(action));
    await runner("conflict-request", async () => ({ ok: false, kind: "conflict", requestId: "conflict-request", statePreserved: true, message: "Refresh before retrying." }));
    const final = dispatched.reduce(meetStoreReducer, createInitialMeetStoreState());
    expect(final.conflict).toEqual({ kind: "optimistic", message: "Refresh before retrying." });
    expect(final.snapshot).toBeNull();
  });
});
