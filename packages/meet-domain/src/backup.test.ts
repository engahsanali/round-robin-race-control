import { describe, expect, test } from "vitest";
import { bracket, event, state } from "./test-fixtures";

async function domain(): Promise<any> { return import(`./${"index"}`); }

function bundle(meetState = state()): {
  state: ReturnType<typeof state>;
  history: { snapshots: Array<{ id: string; ruleId: string; sourceBracketId: string; sourceResultVersion: number; stale: boolean; replacedBySnapshotId: string | null; confirmedBy: string; reason: string | null; confirmedAt: string }>; selections: any[] };
  heatVersions: Record<string, number>;
} {
  return {
    state: meetState,
    history: { snapshots: [], selections: [] },
    heatVersions: {},
  };
}

function manyBracketBundle() {
  const brackets = Array.from({ length: 15 }, (_, bracketIndex) => bracket(
    `q-${String(bracketIndex + 1).padStart(2, "0")}`,
    "qualifier",
    Array.from({ length: 12 }, (_, carIndex) => ({ id: `q-${bracketIndex + 1}-car-${carIndex + 1}`, number: carIndex + 1 })),
  ));
  return bundle(state(brackets));
}

describe("Meet portable backup", () => {
  test("serializes a canonical checksummed envelope and round-trips 15 brackets with repeated car numbers", async () => {
    const api = await domain();
    const hosted = manyBracketBundle();
    const text = await api.serializeMeetBackup(hosted, {
      exportedAt: "2026-08-14T12:00:00.000Z",
      applicationVersion: "0.1.0",
    });

    expect(text.endsWith("\n")).toBe(true);
    const raw = JSON.parse(text);
    expect(raw).toMatchObject({
      format: "rr3-meet-backup",
      version: 1,
      exportedAt: "2026-08-14T12:00:00.000Z",
      product: "Round Robin Race Control Meet",
      creatorCredit: "Made by Cesar Lacsamana and Ahsan Ali",
      source: { meetId: "meet", meetVersion: 1, applicationVersion: "0.1.0" },
      manifest: { bracketCount: 15, participantCount: 180, carCount: 180 },
    });
    expect(raw.manifest.bundleSha256).toMatch(/^[a-f0-9]{64}$/u);
    const parsed = await api.parseMeetBackup(text);
    expect(parsed).toEqual({ ok: true, data: raw });
    expect(await api.serializeMeetBackup(parsed.data.bundle, {
      exportedAt: parsed.data.exportedAt,
      applicationVersion: parsed.data.source.applicationVersion,
    })).toBe(text);
  });

  test("rejects tampering, unknown envelope fields, unsafe integers and dangerous object keys", async () => {
    const api = await domain();
    const text = await api.serializeMeetBackup(bundle(), { exportedAt: "2026-08-14T12:00:00.000Z", applicationVersion: "0.1.0" });
    const tampered = JSON.parse(text);
    tampered.bundle.state.meet.name = "Tampered";
    expect((await api.parseMeetBackup(JSON.stringify(tampered))).issues.map((issue: any) => issue.code)).toContain("backup_hash_mismatch");

    const unknown = JSON.parse(text);
    unknown.unexpected = true;
    expect((await api.parseMeetBackup(JSON.stringify(unknown))).issues.map((issue: any) => issue.code)).toContain("unrecognized_keys");

    const unsafeInteger = JSON.parse(text);
    unsafeInteger.bundle.state.meet.version = Number.MAX_SAFE_INTEGER + 1;
    expect((await api.parseMeetBackup(JSON.stringify(unsafeInteger))).ok).toBe(false);

    const dangerous = text.replace('"bundle": {', '"bundle": {"__proto__":{"polluted":true},');
    expect((await api.parseMeetBackup(dangerous)).issues.map((issue: any) => issue.code)).toContain("dangerous_key");
  });

  test("rejects oversized text before parsing and invalid historical advancement relations", async () => {
    const api = await domain();
    const oversized = `{ "padding": "${"x".repeat(10_000_001)}" }`;
    expect((await api.parseMeetBackup(oversized)).issues[0].code).toBe("backup_size_limit");

    const hosted = bundle();
    hosted.history.snapshots.push({
      id: "missing-rule-snapshot", ruleId: "missing-rule", sourceBracketId: "q1", sourceResultVersion: 1,
      stale: false, replacedBySnapshotId: null, confirmedBy: "actor", reason: null, confirmedAt: "2026-08-14T12:00:00Z",
    });
    await expect(api.serializeMeetBackup(hosted, { exportedAt: "2026-08-14T12:00:00.000Z", applicationVersion: "0.1.0" })).rejects.toThrow(/history/i);
  });

  test("rejects excessive primitive nodes and nesting before envelope validation", async () => {
    const api = await domain();
    const nodeBomb = JSON.stringify({ values: Array.from({ length: 100_001 }, () => 0) });
    expect((await api.parseMeetBackup(nodeBomb)).issues[0].code).toBe("import_node_limit");
    let nested: Record<string, unknown> = {};
    const root = nested;
    for (let index = 0; index < 130; index += 1) { const child: Record<string, unknown> = {}; nested.child = child; nested = child; }
    expect((await api.parseMeetBackup(JSON.stringify(root))).issues[0].code).toBe("import_depth_limit");
  });
});

describe("Meet compatible import preview", () => {
  test("accepts a bare MeetStateV1 as a new meet with deterministic remapped ids", async () => {
    const api = await domain();
    const input = JSON.stringify(state());
    const first = await api.previewMeetImport(input);
    const second = await api.previewMeetImport(input);

    expect(first).toEqual(second);
    expect(first).toMatchObject({ ok: true, kind: "meet-state", createsNewMeet: true, warnings: [] });
    expect(first.state.meet.id).not.toBe("meet");
    expect(first.state.brackets[0].id).not.toBe("q1");
  });

  test("maps a Solo or Pro EventStateV1 to one qualifier and explicitly warns that payments are unsupported", async () => {
    const api = await domain();
    const source = event("solo-event", [{ id: "car-1", number: 7 }, { id: "car-2", number: 8 }]);
    source.payments.push({ id: "payment-1", participantId: "p-car-1", amountCents: 500, kind: "payment", paidAt: "2026-08-14T10:00:00Z", note: "Cash" });
    const result = await api.previewMeetImport(JSON.stringify(source));

    expect(result).toMatchObject({ ok: true, kind: "event-state", createsNewMeet: true });
    expect(result.warnings).toEqual([expect.objectContaining({ code: "unsupported_payments" })]);
    expect(result.state.brackets).toHaveLength(1);
    expect(result.state.brackets[0]).toMatchObject({ stage: "qualifier" });
    expect(result.state.brackets[0].event.payments).toEqual([]);
    expect(result.state.brackets[0].event.entries.map((entry: any) => entry.carNumber)).toEqual([7, 8]);
  });
});
