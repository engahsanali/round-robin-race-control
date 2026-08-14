import { describe, expect, it, vi } from "vitest";
import { hydrateMeetState, MeetRepository, type DataPort, type PortError, type QueryRequest, type RealtimeRequest } from "./meetRepository";
import { IDS } from "../test/fixtures";

function rowsByTable(): Record<string, unknown[]> {
  return {
    meets: [{ id: IDS.meet, organisation_id: IDS.org, name: "Friday Night Meet", venue: "Perth Raceway", meet_date: "2026-08-14", status: "running", settings: {}, version: 3, created_at: "2026-08-14T09:00:00.000Z", updated_at: "2026-08-14T10:00:00.000Z" }],
    brackets: [{ id: IDS.bracket, organisation_id: IDS.org, meet_id: IDS.meet, name: "Qualifier A", stage: "qualifier", display_order: 1, status: "running", settings: { rankingMode: "competition", tieBreakOrder: ["totalWins"] }, version: 2, created_at: "2026-08-14T09:00:00.000Z", updated_at: "2026-08-14T10:00:00.000Z" }],
    participants: [{ id: IDS.participant, organisation_id: IDS.org, bracket_id: IDS.bracket, name: "Cesar", email: "", phone: "", notes: "" }],
    cars: [{ id: IDS.car, organisation_id: IDS.org, bracket_id: IDS.bracket, participant_id: IDS.participant, car_number: 7, name: "Comet", active: true, source_bracket_id: null, source_car_id: null, rule_id: null, snapshot_id: null }],
    heats: [{ id: IDS.heat, organisation_id: IDS.org, bracket_id: IDS.bracket, round_number: 1, heat_number: 1, phase: "preliminary", status: "confirmed", lane_1_car_id: IDS.car, lane_2_car_id: null, lane_3_car_id: null, winner_car_id: IDS.car, lane_1_time: 1.234, lane_2_time: null, lane_3_time: null, version: 2 }],
    advancement_rules: [], advancement_rule_destinations: [], advancement_snapshots: [], advancement_selections: [], audit_events: [],
  };
}

class FakeDataPort implements DataPort {
  calls: QueryRequest[] = [];
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  rpcResult: { data: unknown; error: PortError | null } = { data: {}, error: null };
  rpcError: unknown = null;
  queryErrorTables = new Set<string>();
  realtimeRequests: RealtimeRequest[] = [];
  constructor(readonly rows: Record<string, unknown[]> = rowsByTable()) {}
  async query<T>(request: QueryRequest): Promise<{ data: T[]; error: null }> {
    this.calls.push(request);
    if (this.queryErrorTables.has(request.table)) throw new Error("network unavailable");
    return { data: (this.rows[request.table] ?? []) as T[], error: null };
  }
  async rpc<T>(name: string, args: Record<string, unknown>): Promise<{ data: T | null; error: PortError | null }> { this.rpcCalls.push({ name, args }); if (this.rpcError) throw this.rpcError; return this.rpcResult as { data: T | null; error: PortError | null }; }
  subscribe(request: RealtimeRequest, _callback: () => void): () => void { this.realtimeRequests.push(request); return () => undefined; }
}

describe("MeetRepository", () => {
  it("hydrates normalized rows deterministically, converts seconds to ms and separates phases", () => {
    const result = hydrateMeetState(rowsByTable(), IDS.org, IDS.meet);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.brackets[0]?.event.matches[0]?.laneTimesMs[0]).toBe(1234);
    expect(result.value.brackets[0]?.event.finals).toEqual([]);
    expect(result.value.meet.version).toBe(3);
  });

  it("rejects invalid or cross-organisation normalized data before publication", () => {
    const invalid = rowsByTable();
    invalid.cars = [{ ...(invalid.cars?.[0] as object), organisation_id: "other-org" }];
    expect(hydrateMeetState(invalid, IDS.org, IDS.meet)).toEqual({ ok: false, kind: "validation", message: expect.stringMatching(/organisation/i) });
  });

  it.each([
    ["meet status", "meets", "status", "paused"],
    ["bracket stage", "brackets", "stage", "category"],
    ["heat phase", "heats", "phase", "qualifying"],
    ["numeric version", "meets", "version", "3"],
  ])("strictly rejects unknown hosted %s instead of coercing", (_label, table, field, value) => {
    const invalid = rowsByTable();
    invalid[table] = [{ ...(invalid[table]?.[0] as object), [field]: value }];
    expect(hydrateMeetState(invalid, IDS.org, IDS.meet)).toMatchObject({ ok: false, kind: "validation" });
  });

  it("publishes complete validated advancement history while MeetStateV1 exposes only current snapshots", () => {
    const rows = rowsByTable();
    const destinationBracketId = "00000000-0000-4000-8000-000000000010";
    const ruleId = "00000000-0000-4000-8000-000000000011";
    const oldSnapshotId = "00000000-0000-4000-8000-000000000012";
    const currentSnapshotId = "00000000-0000-4000-8000-000000000013";
    const oldParticipantId = "00000000-0000-4000-8000-000000000014";
    const currentParticipantId = "00000000-0000-4000-8000-000000000015";
    const oldCarId = "00000000-0000-4000-8000-000000000016";
    const currentCarId = "00000000-0000-4000-8000-000000000017";
    rows.brackets?.push({ id: destinationBracketId, organisation_id: IDS.org, meet_id: IDS.meet, name: "Final", stage: "final", display_order: 2, status: "setup", settings: {}, version: 1, created_at: "2026-08-14T09:00:00.000Z", updated_at: "2026-08-14T10:00:00.000Z" });
    rows.participants?.push(
      { id: oldParticipantId, organisation_id: IDS.org, bracket_id: destinationBracketId, name: "Old finalist", email: "", phone: "", notes: "" },
      { id: currentParticipantId, organisation_id: IDS.org, bracket_id: destinationBracketId, name: "Current finalist", email: "", phone: "", notes: "" },
    );
    rows.cars?.push(
      { id: oldCarId, organisation_id: IDS.org, bracket_id: destinationBracketId, participant_id: oldParticipantId, car_number: 1, name: "Old finalist", active: false, source_bracket_id: IDS.bracket, source_car_id: IDS.car, rule_id: ruleId, snapshot_id: oldSnapshotId },
      { id: currentCarId, organisation_id: IDS.org, bracket_id: destinationBracketId, participant_id: currentParticipantId, car_number: 2, name: "Current finalist", active: true, source_bracket_id: IDS.bracket, source_car_id: IDS.car, rule_id: ruleId, snapshot_id: currentSnapshotId },
    );
    rows.advancement_rules = [{ id: ruleId, organisation_id: IDS.org, meet_id: IDS.meet, source_bracket_id: IDS.bracket, top_n: 1, destination_capacity: 12, status: "active", version: 2 }];
    rows.advancement_rule_destinations = [{ organisation_id: IDS.org, meet_id: IDS.meet, rule_id: ruleId, destination_bracket_id: destinationBracketId, destination_order: 1 }];
    rows.advancement_snapshots = [
      { id: oldSnapshotId, organisation_id: IDS.org, meet_id: IDS.meet, rule_id: ruleId, source_bracket_id: IDS.bracket, source_result_version: 1, stale: true, replaced_by_snapshot_id: currentSnapshotId, confirmed_by: IDS.user, reason: "Initial selection", confirmed_at: "2026-08-14T10:01:00.000Z" },
      { id: currentSnapshotId, organisation_id: IDS.org, meet_id: IDS.meet, rule_id: ruleId, source_bracket_id: IDS.bracket, source_result_version: 2, stale: false, replaced_by_snapshot_id: null, confirmed_by: IDS.user, reason: "Correction", confirmed_at: "2026-08-14T10:02:00.000Z" },
    ];
    rows.advancement_selections = [
      { id: "00000000-0000-4000-8000-000000000018", organisation_id: IDS.org, meet_id: IDS.meet, snapshot_id: oldSnapshotId, rule_id: ruleId, source_bracket_id: IDS.bracket, source_car_id: IDS.car, destination_bracket_id: destinationBracketId, destination_car_id: oldCarId, rank: 1 },
      { id: "00000000-0000-4000-8000-000000000019", organisation_id: IDS.org, meet_id: IDS.meet, snapshot_id: currentSnapshotId, rule_id: ruleId, source_bracket_id: IDS.bracket, source_car_id: IDS.car, destination_bracket_id: destinationBracketId, destination_car_id: currentCarId, rank: 1 },
    ];
    const result = hydrateMeetState(rows, IDS.org, IDS.meet);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.advancementSnapshots.map((snapshot) => snapshot.id)).toEqual([currentSnapshotId]);
    expect(result.history.snapshots.map((snapshot) => snapshot.id)).toEqual([oldSnapshotId, currentSnapshotId]);
    expect(result.history.selections).toHaveLength(2);
  });

  it("shapes every official read to one organisation and one meet", async () => {
    const port = new FakeDataPort();
    const repository = new MeetRepository(port);
    const result = await repository.loadMeet(IDS.org, IDS.meet);
    expect(result.ok).toBe(true);
    expect(port.calls.every((call) => call.filters.organisation_id === IDS.org)).toBe(true);
    expect(port.calls.find((call) => call.table === "meets")?.filters.id).toBe(IDS.meet);
  });

  it("scopes bracket-owned reads to this meet so another meet in the organisation cannot poison hydration", async () => {
    const port = new FakeDataPort();
    const repository = new MeetRepository(port);
    await repository.loadMeet(IDS.org, IDS.meet);
    for (const table of ["participants", "cars", "heats"]) {
      expect(port.calls.find((call) => call.table === table)?.filters.bracket_id).toEqual([IDS.bracket]);
    }
  });

  it("lists selected-organisation meets and exposes important mutations only through committed RPC names", async () => {
    const port = new FakeDataPort();
    const repository = new MeetRepository(port);
    expect((await repository.listMeets(IDS.org))[0]).toMatchObject({ id: IDS.meet, organisationId: IDS.org, name: "Friday Night Meet" });
    await repository.confirmHeatWinner(IDS.heat, IDS.car, { lane1: 1.234 }, 2, "00000000-0000-4000-8000-000000000081");
    await repository.confirmAdvancement("00000000-0000-4000-8000-000000000082", 4, 2, [], null, "00000000-0000-4000-8000-000000000083");
    expect(port.rpcCalls).toEqual([
      { name: "confirm_heat_winner", args: { heat_id: IDS.heat, winner_car_id: IDS.car, lane_times: { lane1: 1.234 }, expected_version: 2, request_id: "00000000-0000-4000-8000-000000000081" } },
      { name: "confirm_advancement", args: { rule_id: "00000000-0000-4000-8000-000000000082", source_result_version: 4, expected_version: 2, selections: [], reason: null, request_id: "00000000-0000-4000-8000-000000000083" } },
    ]);
  });

  it("uses the exact corrected-winner SQL contract", async () => {
    const port = new FakeDataPort();
    const repository = new MeetRepository(port);
    await repository.correctHeatWinner(IDS.heat, IDS.car, { lane1: 1.111, lane2: null }, 4, "Photo finish correction", "00000000-0000-4000-8000-000000000084");
    expect(port.rpcCalls[0]).toEqual({ name: "correct_heat_winner", args: { heat_id: IDS.heat, winner_car_id: IDS.car, lane_times: { lane1: 1.111, lane2: null }, expected_version: 4, reason: "Photo finish correction", request_id: "00000000-0000-4000-8000-000000000084" } });
  });

  it("returns committed success with an advisory when readback fails", async () => {
    const port = new FakeDataPort();
    port.rpcResult = { data: { organisation_id: IDS.org, version: 1 }, error: null };
    const repository = new MeetRepository(port);
    const receipt = await repository.execute("create_organisation", { name: "Club", slug: "club", request_id: "00000000-0000-4000-8000-000000000099" }, async () => { throw new Error("offline after commit"); });
    expect(receipt).toMatchObject({ ok: true, advisory: { kind: "readback", message: expect.any(String) } });
  });

  it("maps optimistic conflicts without mutating published state", async () => {
    const port = new FakeDataPort();
    port.rpcResult = { data: null, error: { message: "MEET_VERSION_CONFLICT" } };
    const repository = new MeetRepository(port);
    const prior = { marker: "unchanged" };
    const receipt = await repository.execute("confirm_heat_winner", { heat_id: IDS.heat, expected_version: 1, request_id: "00000000-0000-4000-8000-000000000098" });
    expect(receipt).toMatchObject({ ok: false, kind: "conflict", statePreserved: true });
    expect(prior).toEqual({ marker: "unchanged" });
  });

  it("converts a thrown RPC/network failure into a state-preserving receipt", async () => {
    const port = new FakeDataPort();
    port.rpcError = new Error("fetch failed");
    const repository = new MeetRepository(port);
    await expect(repository.confirmHeatWinner(IDS.heat, IDS.car, {}, 2, "00000000-0000-4000-8000-000000000085")).resolves.toMatchObject({ ok: false, kind: "network", statePreserved: true });
  });

  it("keeps a committed member removal successful with a do-not-retry advisory when readback fails", async () => {
    const port = new FakeDataPort();
    port.rpcResult = { data: { organisation_id: IDS.org, user_id: "user-2", removed: true }, error: null };
    port.rpcError = null;
    port.queryErrorTables.add("organisation_memberships");
    const repository = new MeetRepository(port);
    const receipt = await repository.removeMembership(IDS.org, "user-2", "No longer officiating", "00000000-0000-4000-8000-000000000086");
    expect(receipt).toMatchObject({ ok: true, advisory: { kind: "readback", message: expect.stringMatching(/do not repeat/i) } });
  });

  it("coalesces realtime bursts, validates refetches and cleans up channels and reads", async () => {
    vi.useFakeTimers();
    let invalidate: (() => void) | undefined;
    const unsubscribe = vi.fn();
    const port = new FakeDataPort();
    port.subscribe = (request: RealtimeRequest, callback: () => void) => { port.realtimeRequests.push(request); invalidate = callback; return unsubscribe; };
    const repository = new MeetRepository(port);
    const updates: string[] = [];
    const cleanup = repository.watchMeet(IDS.org, IDS.meet, { bracketIds: [IDS.bracket], onSnapshot: (value) => updates.push(value.meet.id), onStatus: () => undefined, isDirty: () => false, onDirtyUpdate: () => undefined });
    expect(port.realtimeRequests[0]).toMatchObject({
      targets: expect.arrayContaining([
        { table: "meets", filter: `id=eq.${IDS.meet}` },
        { table: "brackets", filter: `meet_id=eq.${IDS.meet}` },
        { table: "heats", filter: `bracket_id=in.(${IDS.bracket})` },
        { table: "organisation_memberships", filter: `organisation_id=eq.${IDS.org}` },
      ]),
    });
    invalidate?.(); invalidate?.(); invalidate?.();
    await vi.advanceTimersByTimeAsync(80);
    expect(updates).toEqual([IDS.meet]);
    cleanup();
    expect(unsubscribe).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
