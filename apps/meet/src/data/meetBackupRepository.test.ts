import { describe, expect, it } from "vitest";
import { serializeMeetBackup, type MeetStateV1, type PortableHostedMeetBundle } from "@rr3/meet-domain";
import { MeetBackupRepository } from "./meetBackupRepository";
import type { ConnectionStatus, DataPort, PortError, QueryRequest, RealtimeRequest } from "./meetRepository";

const ORG = "10000000-0000-4000-8000-000000000001";
const MEET = "10000000-0000-4000-8000-000000000002";
const REVISION = "10000000-0000-4000-8000-000000000003";
const REQUEST = "10000000-0000-4000-8000-000000000004";

function hostedBundle(): PortableHostedMeetBundle {
  const timestamp = "2026-08-14T10:00:00.000Z";
  const state: MeetStateV1 = {
    version: 1,
    meet: { id: MEET, name: "Hosted Meet", venue: "Track", date: "2026-08-14", status: "setup", createdAt: timestamp, updatedAt: timestamp, version: 4 },
    brackets: [{
      id: "10000000-0000-4000-8000-000000000005", name: "Qualifier", stage: "qualifier", displayOrder: 1, status: "setup", version: 1, lineage: [],
      event: {
        version: 1, event: { id: "10000000-0000-4000-8000-000000000005", name: "Qualifier", date: "2026-08-14", venue: "Track", organizer: "Officials", laneCount: 3, status: "setup", createdAt: timestamp, updatedAt: timestamp, resultSeal: "draft" },
        settings: { scheduleMode: "custom", seed: "", rankingMode: "competition", allowSharedRanks: true, tieBreakOrder: ["totalWins"], finalistCount: 0, autoSave: true, confirmWinnerChanges: true, enableTiming: true, prices: {} },
        participants: [], entries: [], matches: [], finals: [], payments: [], auditLog: [],
      },
    }],
    advancementRules: [], advancementSnapshots: [], auditLog: [],
  };
  return { state, history: { snapshots: [], selections: [] }, heatVersions: {} };
}

class FakePort implements DataPort {
  calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  results = new Map<string, unknown>();
  error: PortError | null = null;
  thrown: unknown = null;
  async query<T>(_request: QueryRequest): Promise<{ data: T[] | null; error: PortError | null }> { return { data: [], error: null }; }
  async rpc<T>(name: string, args: Record<string, unknown>): Promise<{ data: T | null; error: PortError | null }> { this.calls.push({ name, args }); if (this.thrown) { const thrown = this.thrown; this.thrown = null; throw thrown; } return { data: (this.results.get(name) ?? null) as T | null, error: this.error }; }
  subscribe(_request: RealtimeRequest, _onInvalidate: () => void, _onStatus?: (status: ConnectionStatus) => void): () => void { return () => undefined; }
}

describe("Meet backup repository", () => {
  it("exports one server-consistent graph and builds the checksummed portable envelope", async () => {
    const port = new FakePort();
    port.results.set("export_meet_bundle", hostedBundle());
    const receipt = await new MeetBackupRepository(port).exportBackup(ORG, MEET, 4, { exportedAt: "2026-08-14T12:00:00.000Z", applicationVersion: "0.1.0" });

    expect(port.calls).toEqual([{ name: "export_meet_bundle", args: { target_organisation_id: ORG, target_meet_id: MEET, expected_version: 4 } }]);
    expect(receipt.ok).toBe(true);
    if (receipt.ok) expect(JSON.parse(receipt.value)).toMatchObject({ format: "rr3-meet-backup", source: { meetId: MEET, meetVersion: 4 } });
  });

  it("uses bounded cursor pagination and exact checkpoint and preview RPC contracts", async () => {
    const port = new FakePort();
    port.results.set("list_meet_revisions", [{ id: REVISION, organisation_id: ORG, meet_id: MEET, sequence: 9, kind: "manual", source_meet_version: 4, label: "Before finals", reason: "Operator checkpoint", payload_sha256: "a".repeat(64), created_by: "actor", created_at: "2026-08-14T12:00:00Z" }]);
    port.results.set("create_meet_revision", { revision_id: REVISION, sequence: 9, meet_id: MEET });
    port.results.set("preview_meet_revision", { revision_id: REVISION, meet_id: MEET, source_meet_version: 4, manifest: { bracketCount: 1 } });
    const repository = new MeetBackupRepository(port);

    await repository.createCheckpoint(ORG, MEET, 4, "Before finals", "Operator checkpoint", REQUEST);
    const page = await repository.listRevisions(ORG, MEET, { limit: 25, beforeSequence: 10 });
    const preview = await repository.previewRevision(ORG, REVISION);

    expect(page).toHaveLength(1);
    expect(preview).toMatchObject({ revisionId: REVISION, sourceMeetVersion: 4 });
    expect(port.calls).toEqual([
      { name: "create_meet_revision", args: { target_organisation_id: ORG, target_meet_id: MEET, expected_version: 4, revision_kind: "manual", revision_label: "Before finals", revision_reason: "Operator checkpoint", request_id: REQUEST } },
      { name: "list_meet_revisions", args: { target_organisation_id: ORG, target_meet_id: MEET, page_size: 25, before_sequence: 10 } },
      { name: "preview_meet_revision", args: { target_organisation_id: ORG, revision_id: REVISION } },
    ]);
  });

  it("validates backup bytes before exact confirmed import and guarded restore-copy RPCs", async () => {
    const port = new FakePort();
    port.results.set("import_meet_backup", { meet_id: "new-meet", source_revision_id: REVISION, version: 1 });
    port.results.set("restore_meet_revision_copy", { meet_id: "restored-meet", source_revision_id: REVISION, version: 1 });
    const repository = new MeetBackupRepository(port);
    const text = await serializeMeetBackup(hostedBundle(), { exportedAt: "2026-08-14T12:00:00.000Z", applicationVersion: "0.1.0" });

    await repository.importAsNewMeet(ORG, text, "Verified portable recovery", true, REQUEST);
    await repository.restoreRevisionAsNewMeet(ORG, REVISION, "Restore for rerun", true, REQUEST);
    expect(port.calls).toEqual([
      { name: "import_meet_backup", args: { target_organisation_id: ORG, backup: JSON.parse(text), reason: "Verified portable recovery", confirm_import: true, request_id: REQUEST } },
      { name: "restore_meet_revision_copy", args: { target_organisation_id: ORG, revision_id: REVISION, reason: "Restore for rerun", confirm_restore: true, request_id: REQUEST } },
    ]);
  });

  it("rejects tampered imports locally without calling the backend", async () => {
    const port = new FakePort();
    const repository = new MeetBackupRepository(port);
    const text = await serializeMeetBackup(hostedBundle(), { exportedAt: "2026-08-14T12:00:00.000Z", applicationVersion: "0.1.0" });
    const tampered = JSON.parse(text); tampered.bundle.state.meet.name = "Tampered";

    const receipt = await repository.importAsNewMeet(ORG, JSON.stringify(tampered), "Unsafe", true, REQUEST);
    expect(receipt).toMatchObject({ ok: false, kind: "validation", statePreserved: true });
    expect(port.calls).toEqual([]);
  });

  it("returns discriminated validation receipts instead of throwing for invalid recovery drafts", async () => {
    const port = new FakePort();
    const repository = new MeetBackupRepository(port);
    const text = await serializeMeetBackup(hostedBundle(), { exportedAt: "2026-08-14T12:00:00.000Z", applicationVersion: "0.1.0" });

    await expect(repository.createCheckpoint(ORG, MEET, 4, "  ", "reason", REQUEST)).resolves.toMatchObject({ ok: false, kind: "validation", committed: "no", statePreserved: true, requestId: REQUEST });
    await expect(repository.importAsNewMeet(ORG, text, "  ", true, REQUEST)).resolves.toMatchObject({ ok: false, kind: "validation", committed: "no", statePreserved: true, requestId: REQUEST });
    await expect(repository.restoreRevisionAsNewMeet(ORG, REVISION, "x".repeat(501), true, REQUEST)).resolves.toMatchObject({ ok: false, kind: "validation", committed: "no", statePreserved: true, requestId: REQUEST });
    expect(port.calls).toEqual([]);
  });

  it("reports uncertain post-commit transport loss and preserves the same request id for retry resolution", async () => {
    const port = new FakePort();
    const repository = new MeetBackupRepository(port);
    port.thrown = new TypeError("fetch failed after response was lost");

    const uncertain = await repository.restoreRevisionAsNewMeet(ORG, REVISION, "Restore for rerun", true, REQUEST);
    expect(uncertain).toEqual(expect.objectContaining({ ok: false, kind: "network", committed: "unknown", requestId: REQUEST, retry: { requestId: REQUEST } }));
    expect(uncertain).not.toHaveProperty("statePreserved");

    port.results.set("restore_meet_revision_copy", { meet_id: "restored-meet", source_revision_id: REVISION, version: 1 });
    const resolved = await repository.restoreRevisionAsNewMeet(ORG, REVISION, "Restore for rerun", true, REQUEST);
    expect(resolved).toMatchObject({ ok: true, requestId: REQUEST, value: { meetId: "restored-meet" } });
    expect(port.calls.map((call) => call.args.request_id)).toEqual([REQUEST, REQUEST]);
  });

  it.each([
    { code: "NETWORK_ERROR", message: "TypeError: Failed to fetch" },
    { code: "OFFLINE", message: "The client is offline" },
  ])("treats a production-shaped $code mutation error result as uncertain", async (error) => {
    const port = new FakePort();
    port.error = error;
    const receipt = await new MeetBackupRepository(port).restoreRevisionAsNewMeet(ORG, REVISION, "Restore for rerun", true, REQUEST);

    expect(receipt).toEqual(expect.objectContaining({ ok: false, committed: "unknown", requestId: REQUEST, retry: { requestId: REQUEST } }));
    expect(receipt).not.toHaveProperty("statePreserved");
  });
});
