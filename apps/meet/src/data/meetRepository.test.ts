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
  constructor(readonly rows: Record<string, unknown[]> = rowsByTable()) {}
  async query<T>(request: QueryRequest): Promise<{ data: T[]; error: null }> {
    this.calls.push(request);
    return { data: (this.rows[request.table] ?? []) as T[], error: null };
  }
  async rpc<T>(name: string, args: Record<string, unknown>): Promise<{ data: T | null; error: PortError | null }> { this.rpcCalls.push({ name, args }); return this.rpcResult as { data: T | null; error: PortError | null }; }
  subscribe(_request: RealtimeRequest, _callback: () => void): () => void { return () => undefined; }
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
    expect(port.rpcCalls.map((call) => call.name)).toEqual(["confirm_heat_winner", "confirm_advancement"]);
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

  it("coalesces realtime bursts, validates refetches and cleans up channels and reads", async () => {
    vi.useFakeTimers();
    let invalidate: (() => void) | undefined;
    const unsubscribe = vi.fn();
    const port = new FakeDataPort();
    port.subscribe = (_request: RealtimeRequest, callback: () => void) => { invalidate = callback; return unsubscribe; };
    const repository = new MeetRepository(port);
    const updates: string[] = [];
    const cleanup = repository.watchMeet(IDS.org, IDS.meet, { onSnapshot: (value) => updates.push(value.meet.id), onStatus: () => undefined, isDirty: () => false, onDirtyUpdate: () => undefined });
    invalidate?.(); invalidate?.(); invalidate?.();
    await vi.advanceTimersByTimeAsync(80);
    expect(updates).toEqual([IDS.meet]);
    cleanup();
    expect(unsubscribe).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
