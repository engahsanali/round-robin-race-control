import { validateEventState, type EventStateV1, type ValidationIssue } from "@rr3/domain";
import { z } from "zod";
import { compareCodeUnits } from "./ordering";
import { validateMeetState } from "./schema";
import type { AdvancementSelection, AdvancementSnapshot, MeetStateV1 } from "./types";

export const MEET_BACKUP_FORMAT = "rr3-meet-backup" as const;
export const MEET_BACKUP_VERSION = 1 as const;
export const MEET_PRODUCT = "Round Robin Race Control Meet" as const;
export const MEET_CREATOR_CREDIT = "Made by Cesar Lacsamana and Ahsan Ali" as const;
const MAX_BACKUP_BYTES = 10_000_000;

export type AdvancementHistorySnapshot = {
  id: string; ruleId: string; sourceBracketId: string; sourceResultVersion: number; stale: boolean;
  replacedBySnapshotId: string | null; confirmedBy: string; reason: string | null; confirmedAt: string;
};
export type AdvancementHistorySelection = {
  id: string; snapshotId: string; ruleId: string; sourceBracketId: string; sourceCarId: string;
  destinationBracketId: string; destinationCarId: string | null; rank: number;
};
export type AdvancementHistory = { snapshots: AdvancementHistorySnapshot[]; selections: AdvancementHistorySelection[] };
export type PortableHostedMeetBundle = { state: MeetStateV1; history: AdvancementHistory; heatVersions: Readonly<Record<string, number>> };
export type MeetBackupManifest = {
  meetVersion: number; bracketCount: number; participantCount: number; carCount: number; heatCount: number;
  ruleCount: number; currentAdvancementSnapshotCount: number; historicalAdvancementSnapshotCount: number;
  advancementSelectionCount: number; auditEventCount: number; bundleSha256: string;
};
export type MeetPortableBackupV1 = {
  format: typeof MEET_BACKUP_FORMAT; version: typeof MEET_BACKUP_VERSION; exportedAt: string;
  product: typeof MEET_PRODUCT; creatorCredit: typeof MEET_CREATOR_CREDIT;
  source: { meetId: string; meetVersion: number; applicationVersion: string };
  manifest: MeetBackupManifest; bundle: PortableHostedMeetBundle;
};
export type MeetBackupParseResult = { ok: true; data: MeetPortableBackupV1 } | { ok: false; issues: ValidationIssue[] };
export type MeetImportWarning = { code: "unsupported_payments"; message: string };
export type MeetImportPreview =
  | { ok: true; kind: "meet-backup" | "meet-state" | "event-state"; createsNewMeet: true; state: MeetStateV1; bundle: PortableHostedMeetBundle; warnings: MeetImportWarning[] }
  | { ok: false; issues: ValidationIssue[] };

const id = z.string().trim().min(1).max(128);
const boundedText = z.string().max(500);
const positiveSafeInteger = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const nonnegativeSafeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const historySnapshotSchema = z.object({
  id, ruleId: id, sourceBracketId: id, sourceResultVersion: nonnegativeSafeInteger, stale: z.boolean(),
  replacedBySnapshotId: id.nullable(), confirmedBy: id, reason: boundedText.nullable(), confirmedAt: z.string().min(1).max(64),
}).strict();
const historySelectionSchema = z.object({
  id, snapshotId: id, ruleId: id, sourceBracketId: id, sourceCarId: id,
  destinationBracketId: id, destinationCarId: id.nullable(), rank: positiveSafeInteger,
}).strict();
const bundleSchema = z.object({
  state: z.unknown(),
  history: z.object({ snapshots: z.array(historySnapshotSchema).max(10_000), selections: z.array(historySelectionSchema).max(100_000) }).strict(),
  heatVersions: z.record(positiveSafeInteger),
}).strict();
const manifestSchema = z.object({
  meetVersion: nonnegativeSafeInteger, bracketCount: nonnegativeSafeInteger, participantCount: nonnegativeSafeInteger,
  carCount: nonnegativeSafeInteger, heatCount: nonnegativeSafeInteger, ruleCount: nonnegativeSafeInteger,
  currentAdvancementSnapshotCount: nonnegativeSafeInteger, historicalAdvancementSnapshotCount: nonnegativeSafeInteger,
  advancementSelectionCount: nonnegativeSafeInteger, auditEventCount: nonnegativeSafeInteger,
  bundleSha256: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();
const envelopeSchema = z.object({
  format: z.literal(MEET_BACKUP_FORMAT), version: z.literal(MEET_BACKUP_VERSION), exportedAt: z.string().datetime({ offset: true }),
  product: z.literal(MEET_PRODUCT), creatorCredit: z.literal(MEET_CREATOR_CREDIT),
  source: z.object({ meetId: id, meetVersion: nonnegativeSafeInteger, applicationVersion: z.string().trim().min(1).max(64) }).strict(),
  manifest: manifestSchema, bundle: bundleSchema,
}).strict();

export async function serializeMeetBackup(
  input: PortableHostedMeetBundle,
  options: { exportedAt: string; applicationVersion: string },
): Promise<string> {
  const bundle = normalizeBundle(input);
  const bundleSha256 = await sha256Hex(canonicalJson(bundle));
  const envelope: MeetPortableBackupV1 = {
    format: MEET_BACKUP_FORMAT,
    version: MEET_BACKUP_VERSION,
    exportedAt: options.exportedAt,
    product: MEET_PRODUCT,
    creatorCredit: MEET_CREATOR_CREDIT,
    source: { meetId: bundle.state.meet.id, meetVersion: bundle.state.meet.version, applicationVersion: options.applicationVersion },
    manifest: { ...countBundle(bundle), bundleSha256 },
    bundle,
  };
  const checked = await validateEnvelope(envelope);
  if (!checked.ok) throw new Error(`Cannot serialize invalid meet backup: ${checked.issues.map((issue) => issue.message).join("; ")}`);
  return `${JSON.stringify(sortCanonical(checked.data), null, 2)}\n`;
}

export async function parseMeetBackup(text: string): Promise<MeetBackupParseResult> {
  const byteLength = new TextEncoder().encode(text).byteLength;
  if (byteLength > MAX_BACKUP_BYTES) return failure("backup_size_limit", [], `Meet backup exceeds the ${MAX_BACKUP_BYTES}-byte limit`);
  let input: unknown;
  try { input = JSON.parse(text) as unknown; } catch { return failure("invalid_json", [], "The meet backup is not valid JSON"); }
  const safety = inspectPortableJsonSafety(input);
  if (safety.length > 0) return { ok: false, issues: safety };
  return validateEnvelope(input);
}

export async function previewMeetImport(text: string): Promise<MeetImportPreview> {
  const sizeIssue = new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES;
  if (sizeIssue) return failure("backup_size_limit", [], `Meet import exceeds the ${MAX_BACKUP_BYTES}-byte limit`);
  let input: unknown;
  try { input = JSON.parse(text) as unknown; } catch { return failure("invalid_json", [], "The import file is not valid JSON"); }
  const safety = inspectPortableJsonSafety(input);
  if (safety.length > 0) return { ok: false, issues: safety };

  if (isRecord(input) && (input.format === MEET_BACKUP_FORMAT || "bundle" in input)) {
    const backup = await validateEnvelope(input);
    if (!backup.ok) return backup;
    const remapped = await remapMeetBundle(backup.data.bundle, `backup:${backup.data.manifest.bundleSha256}`);
    return { ok: true, kind: "meet-backup", createsNewMeet: true, state: remapped.state, bundle: remapped, warnings: [] };
  }
  const meet = validateMeetState(input);
  if (meet.success) {
    const remapped = await remapMeetBundle({ state: meet.data, history: historyFromCurrentState(meet.data), heatVersions: heatVersionsFromState(meet.data) }, `meet:${await sha256Hex(canonicalJson(meet.data))}`);
    return { ok: true, kind: "meet-state", createsNewMeet: true, state: remapped.state, bundle: remapped, warnings: [] };
  }
  const event = validateEventState(input);
  if (event.success) {
    const mapped = await mapEventToMeet(event.data);
    const warnings: MeetImportWarning[] = event.data.payments.length > 0 ? [{ code: "unsupported_payments", message: "Payments are preserved only in the source file and are not imported into Meet Edition." }] : [];
    return { ok: true, kind: "event-state", createsNewMeet: true, state: mapped.state, bundle: mapped, warnings };
  }
  return { ok: false, issues: [{ code: "unsupported_import", path: [], message: "The file is not a Meet backup, MeetStateV1, or EventStateV1 document" }] };
}

function normalizeBundle(input: PortableHostedMeetBundle): PortableHostedMeetBundle {
  const parsed = bundleSchema.safeParse(input);
  if (!parsed.success) throw new Error(`Invalid hosted bundle: ${parsed.error.issues[0]?.message ?? "unknown issue"}`);
  const state = validateMeetState(parsed.data.state);
  if (!state.success) throw new Error(`Invalid hosted meet state: ${state.issues[0]?.message ?? "unknown issue"}`);
  const bundle: PortableHostedMeetBundle = { state: state.data, history: parsed.data.history, heatVersions: parsed.data.heatVersions };
  const issues = validateBundleRelations(bundle);
  if (issues.length > 0) throw new Error(`Invalid advancement history: ${issues[0]!.message}`);
  return structuredClone(bundle);
}

async function validateEnvelope(input: unknown): Promise<MeetBackupParseResult> {
  const parsed = envelopeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, issues: parsed.error.issues.map(toIssue) };
  let bundle: PortableHostedMeetBundle;
  try { bundle = normalizeBundle(parsed.data.bundle as PortableHostedMeetBundle); }
  catch (cause) { return failure("invalid_backup_bundle", ["bundle"], cause instanceof Error ? cause.message : "Invalid hosted meet bundle"); }
  const expectedCounts = countBundle(bundle);
  for (const [key, value] of Object.entries(expectedCounts)) {
    if (parsed.data.manifest[key as keyof typeof expectedCounts] !== value) return failure("backup_manifest_mismatch", ["manifest", key], `Backup manifest ${key} does not match its bundle`);
  }
  if (parsed.data.source.meetId !== bundle.state.meet.id || parsed.data.source.meetVersion !== bundle.state.meet.version || parsed.data.manifest.meetVersion !== bundle.state.meet.version) {
    return failure("backup_source_mismatch", ["source"], "Backup source identity does not match its bundle");
  }
  const hash = await sha256Hex(canonicalJson(bundle));
  if (hash !== parsed.data.manifest.bundleSha256) return failure("backup_hash_mismatch", ["manifest", "bundleSha256"], "Backup checksum does not match its bundle");
  return { ok: true, data: { ...parsed.data, bundle } as MeetPortableBackupV1 };
}

function validateBundleRelations(bundle: PortableHostedMeetBundle): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const rules = new Map(bundle.state.advancementRules.map((rule) => [rule.id, rule]));
  const brackets = new Map(bundle.state.brackets.map((bracket) => [bracket.id, bracket]));
  const cars = new Map(bundle.state.brackets.flatMap((bracket) => bracket.event.entries.map((car) => [car.id, car] as const)));
  const heatIds = new Set(bundle.state.brackets.flatMap((bracket) => [...bracket.event.matches, ...bracket.event.finals].map((heat) => heat.id)));
  const snapshots = new Map<string, AdvancementHistorySnapshot>();
  bundle.history.snapshots.forEach((snapshot, index) => {
    if (snapshots.has(snapshot.id)) issues.push(issue("duplicate_history_snapshot", ["history", "snapshots", index, "id"], "Historical snapshot ids must be unique"));
    snapshots.set(snapshot.id, snapshot);
    const rule = rules.get(snapshot.ruleId);
    if (!rule || rule.sourceBracketId !== snapshot.sourceBracketId) issues.push(issue("unknown_history_rule", ["history", "snapshots", index, "ruleId"], "Historical snapshot references an unknown or mismatched rule"));
  });
  for (const [index, snapshot] of bundle.history.snapshots.entries()) {
    if (snapshot.replacedBySnapshotId) {
      const replacement = snapshots.get(snapshot.replacedBySnapshotId);
      if (!replacement || replacement.ruleId !== snapshot.ruleId || replacement.sourceBracketId !== snapshot.sourceBracketId) issues.push(issue("invalid_history_replacement", ["history", "snapshots", index, "replacedBySnapshotId"], "Historical replacement must reference a snapshot for the same rule and source"));
    }
  }
  const selectionIds = new Set<string>();
  bundle.history.selections.forEach((selection, index) => {
    if (selectionIds.has(selection.id)) issues.push(issue("duplicate_history_selection", ["history", "selections", index, "id"], "Historical selection ids must be unique"));
    selectionIds.add(selection.id);
    const snapshot = snapshots.get(selection.snapshotId);
    if (!snapshot || snapshot.ruleId !== selection.ruleId || snapshot.sourceBracketId !== selection.sourceBracketId) issues.push(issue("invalid_history_selection", ["history", "selections", index], "Historical selection does not match its snapshot"));
    if (!cars.has(selection.sourceCarId) || !brackets.has(selection.destinationBracketId) || (selection.destinationCarId && !cars.has(selection.destinationCarId))) issues.push(issue("unknown_history_entity", ["history", "selections", index], "Historical selection references an unknown car or bracket"));
  });
  for (const [index, current] of bundle.state.advancementSnapshots.entries()) {
    const historical = snapshots.get(current.id);
    if (!historical || historical.ruleId !== current.ruleId || historical.sourceBracketId !== current.sourceBracketId || historical.sourceResultVersion !== current.sourceResultVersion || historical.stale !== current.stale) issues.push(issue("current_snapshot_missing_history", ["state", "advancementSnapshots", index], "Every current snapshot must be represented in full history"));
    const currentSelections = bundle.history.selections.filter((selection) => selection.snapshotId === current.id).map(historySelectionProjection);
    if (canonicalJson(currentSelections) !== canonicalJson(current.selections)) issues.push(issue("current_selection_history_mismatch", ["state", "advancementSnapshots", index, "selections"], "Current snapshot selections must match full history"));
  }
  for (const [heatId, version] of Object.entries(bundle.heatVersions)) {
    if (!heatIds.has(heatId) || !Number.isSafeInteger(version) || version <= 0) issues.push(issue("invalid_heat_version", ["heatVersions", heatId], "Heat versions must identify a known heat with a positive safe integer"));
  }
  return issues;
}

function inspectPortableJsonSafety(value: unknown): ValidationIssue[] {
  const dangerous = new Set(["__proto__", "constructor", "prototype"]);
  const pending: Array<{ value: unknown; path: Array<string | number>; depth: number }> = [{ value, path: [], depth: 0 }];
  const seen = new WeakSet<object>();
  const issues: ValidationIssue[] = [];
  let nodes = 1;
  if (value !== null && typeof value === "object") seen.add(value);
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current.value === null || typeof current.value !== "object") continue;
    for (const key of Object.keys(current.value)) {
      const segment = Array.isArray(current.value) && /^\d+$/u.test(key) ? Number(key) : key;
      const path = [...current.path, segment];
      if (dangerous.has(key)) issues.push(issue("dangerous_key", path, `Unsafe object key is not allowed: ${key}`));
      if (++nodes > 100_000) return [...issues, issue("import_node_limit", path, "JSON structure exceeds the 100000-node safety limit")];
      const child = (current.value as Record<string, unknown>)[key];
      if (child !== null && typeof child === "object" && !seen.has(child)) {
        if (current.depth + 1 > 128) return [...issues, issue("import_depth_limit", path, "JSON structure exceeds the maximum depth of 128")];
        seen.add(child); pending.push({ value: child, path, depth: current.depth + 1 });
      }
    }
  }
  return issues;
}

function countBundle(bundle: PortableHostedMeetBundle): Omit<MeetBackupManifest, "bundleSha256"> {
  const current = bundle.state.advancementSnapshots.length;
  return {
    meetVersion: bundle.state.meet.version,
    bracketCount: bundle.state.brackets.length,
    participantCount: bundle.state.brackets.reduce((count, bracket) => count + bracket.event.participants.length, 0),
    carCount: bundle.state.brackets.reduce((count, bracket) => count + bracket.event.entries.length, 0),
    heatCount: bundle.state.brackets.reduce((count, bracket) => count + bracket.event.matches.length + bracket.event.finals.length, 0),
    ruleCount: bundle.state.advancementRules.length,
    currentAdvancementSnapshotCount: current,
    historicalAdvancementSnapshotCount: bundle.history.snapshots.length - current,
    advancementSelectionCount: bundle.history.selections.length,
    auditEventCount: bundle.state.auditLog.length,
  };
}

async function mapEventToMeet(source: EventStateV1): Promise<PortableHostedMeetBundle> {
  const seed = `event:${await sha256Hex(canonicalJson(source))}`;
  const meetId = await deterministicUuid(`${seed}:meet`);
  const bracketId = await deterministicUuid(`${seed}:bracket`);
  const participantIds = await idMap(source.participants.map((participant) => participant.id), `${seed}:participant`);
  const carIds = await idMap(source.entries.map((entry) => entry.id), `${seed}:car`);
  const heatIds = await idMap([...source.matches, ...source.finals].map((heat) => heat.id), `${seed}:heat`);
  const auditIds = await idMap(source.auditLog.map((event) => event.id), `${seed}:audit`);
  const remapHeat = (heat: EventStateV1["matches"][number]) => ({ ...heat, id: heatIds.get(heat.id)!, lanes: heat.lanes.map((carId) => carId ? carIds.get(carId)! : null) as typeof heat.lanes, winnerEntryId: heat.winnerEntryId ? carIds.get(heat.winnerEntryId)! : null });
  const event: EventStateV1 = {
    ...structuredClone(source),
    event: { ...source.event, id: bracketId },
    participants: source.participants.map((participant) => ({ ...participant, id: participantIds.get(participant.id)! })),
    entries: source.entries.map((entry) => ({ ...entry, id: carIds.get(entry.id)!, participantId: participantIds.get(entry.participantId)!, categoryId: bracketId })),
    matches: source.matches.map(remapHeat), finals: source.finals.map(remapHeat), payments: [],
    auditLog: source.auditLog.map((entry) => ({ ...entry, id: auditIds.get(entry.id)!, entityId: entry.entityId ? heatIds.get(entry.entityId) ?? carIds.get(entry.entityId) ?? participantIds.get(entry.entityId) ?? entry.entityId : null })),
  };
  const meet: MeetStateV1 = {
    version: 1,
    meet: { id: meetId, name: source.event.name, venue: source.event.venue, date: source.event.date, status: source.event.status, createdAt: source.event.createdAt, updatedAt: source.event.updatedAt, version: 1 },
    brackets: [{ id: bracketId, name: source.event.name, stage: "qualifier", displayOrder: 1, status: source.event.status, version: 1, event, lineage: [] }],
    advancementRules: [], advancementSnapshots: [], auditLog: [],
  };
  return { state: meet, history: { snapshots: [], selections: [] }, heatVersions: Object.fromEntries([...source.matches, ...source.finals].map((heat) => [heatIds.get(heat.id)!, 1])) };
}

async function remapMeetBundle(bundle: PortableHostedMeetBundle, seed: string): Promise<PortableHostedMeetBundle> {
  const ids = collectOwnedIds(bundle);
  const mapping = await idMap(ids, seed);
  const remap = (value: string | null) => value === null ? null : mapping.get(value) ?? value;
  const state = structuredClone(bundle.state);
  state.meet.id = remap(state.meet.id)!;
  for (const bracket of state.brackets) {
    bracket.id = remap(bracket.id)!; bracket.event.event.id = remap(bracket.event.event.id)!;
    bracket.event.participants = bracket.event.participants.map((participant) => ({ ...participant, id: remap(participant.id)! }));
    bracket.event.entries = bracket.event.entries.map((entry) => ({ ...entry, id: remap(entry.id)!, participantId: remap(entry.participantId)!, categoryId: remap(entry.categoryId) ?? entry.categoryId }));
    const remapHeat = (heat: EventStateV1["matches"][number]) => ({ ...heat, id: remap(heat.id)!, lanes: heat.lanes.map(remap) as typeof heat.lanes, winnerEntryId: remap(heat.winnerEntryId) });
    bracket.event.matches = bracket.event.matches.map(remapHeat); bracket.event.finals = bracket.event.finals.map(remapHeat);
    bracket.event.auditLog = bracket.event.auditLog.map((entry) => ({ ...entry, id: remap(entry.id)!, entityId: remap(entry.entityId) }));
    bracket.lineage = bracket.lineage.map((lineage) => ({ sourceBracketId: remap(lineage.sourceBracketId)!, sourceCarId: remap(lineage.sourceCarId)!, ruleId: remap(lineage.ruleId)!, snapshotId: remap(lineage.snapshotId)! }));
  }
  state.advancementRules = state.advancementRules.map((rule) => ({ ...rule, id: remap(rule.id)!, sourceBracketId: remap(rule.sourceBracketId)!, destinationBracketIds: rule.destinationBracketIds.map((idValue) => remap(idValue)!), destinationOrder: rule.destinationOrder.map((idValue) => remap(idValue)!) }));
  state.advancementSnapshots = state.advancementSnapshots.map((snapshot) => ({ ...snapshot, id: remap(snapshot.id)!, ruleId: remap(snapshot.ruleId)!, sourceBracketId: remap(snapshot.sourceBracketId)!, selections: snapshot.selections.map((selection) => ({ ...selection, sourceCarId: remap(selection.sourceCarId)!, destinationBracketId: remap(selection.destinationBracketId)! })) }));
  state.auditLog = state.auditLog.map((event) => ({ ...event, id: remap(event.id)!, entityId: remap(event.entityId)! }));
  const history = {
    snapshots: bundle.history.snapshots.map((snapshot) => ({ ...snapshot, id: remap(snapshot.id)!, ruleId: remap(snapshot.ruleId)!, sourceBracketId: remap(snapshot.sourceBracketId)!, replacedBySnapshotId: remap(snapshot.replacedBySnapshotId) })),
    selections: bundle.history.selections.map((selection) => ({ ...selection, id: remap(selection.id)!, snapshotId: remap(selection.snapshotId)!, ruleId: remap(selection.ruleId)!, sourceBracketId: remap(selection.sourceBracketId)!, sourceCarId: remap(selection.sourceCarId)!, destinationBracketId: remap(selection.destinationBracketId)!, destinationCarId: remap(selection.destinationCarId) })),
  };
  return { state, history, heatVersions: Object.fromEntries(Object.entries(bundle.heatVersions).map(([heatId, version]) => [remap(heatId)!, version])) };
}

function collectOwnedIds(bundle: PortableHostedMeetBundle): string[] {
  const ids = [bundle.state.meet.id];
  for (const bracket of bundle.state.brackets) {
    ids.push(bracket.id, bracket.event.event.id, ...bracket.event.participants.map(({ id }) => id), ...bracket.event.entries.map(({ id }) => id), ...bracket.event.matches.map(({ id }) => id), ...bracket.event.finals.map(({ id }) => id), ...bracket.event.auditLog.map(({ id }) => id));
  }
  ids.push(...bundle.state.advancementRules.map(({ id }) => id), ...bundle.state.advancementSnapshots.map(({ id }) => id), ...bundle.state.auditLog.map(({ id }) => id), ...bundle.history.snapshots.map(({ id }) => id), ...bundle.history.selections.map(({ id }) => id));
  return [...new Set(ids)].sort(compareCodeUnits);
}

function historyFromCurrentState(state: MeetStateV1): AdvancementHistory {
  return {
    snapshots: state.advancementSnapshots.map((snapshot) => ({ id: snapshot.id, ruleId: snapshot.ruleId, sourceBracketId: snapshot.sourceBracketId, sourceResultVersion: snapshot.sourceResultVersion, stale: snapshot.stale, replacedBySnapshotId: null, confirmedBy: snapshot.confirmedBy, reason: snapshot.reason, confirmedAt: snapshot.confirmedAt })),
    selections: state.advancementSnapshots.flatMap((snapshot) => snapshot.selections.map((selection, index) => ({ id: `${snapshot.id}-selection-${index + 1}`, snapshotId: snapshot.id, ruleId: snapshot.ruleId, sourceBracketId: snapshot.sourceBracketId, sourceCarId: selection.sourceCarId, destinationBracketId: selection.destinationBracketId, destinationCarId: null, rank: selection.rank }))),
  };
}
function heatVersionsFromState(state: MeetStateV1): Record<string, number> { return Object.fromEntries(state.brackets.flatMap((bracket) => [...bracket.event.matches, ...bracket.event.finals].map((heat) => [heat.id, 1]))); }
function historySelectionProjection(selection: AdvancementHistorySelection): AdvancementSelection { return { sourceCarId: selection.sourceCarId, destinationBracketId: selection.destinationBracketId, rank: selection.rank }; }
function canonicalJson(value: unknown): string { return JSON.stringify(sortCanonical(value)); }
export function sortCanonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortCanonical);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort(compareCodeUnits).map((key) => [key, sortCanonical(value[key])]));
}
async function sha256Hex(text: string): Promise<string> { const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)); return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }
async function deterministicUuid(seed: string): Promise<string> { const hex = await sha256Hex(seed); return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${((Number.parseInt(hex[16]!, 16) & 3) | 8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`; }
async function idMap(values: readonly string[], seed: string): Promise<Map<string, string>> { const pairs = await Promise.all([...new Set(values)].sort(compareCodeUnits).map(async (value) => [value, await deterministicUuid(`${seed}:${value}`)] as const)); return new Map(pairs); }
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function issue(code: string, path: Array<string | number>, message: string): ValidationIssue { return { code, path, message }; }
function failure(code: string, path: Array<string | number>, message: string): { ok: false; issues: ValidationIssue[] } { return { ok: false, issues: [issue(code, path, message)] }; }
function toIssue(value: z.ZodIssue): ValidationIssue { return { code: value.code, path: value.path, message: value.message }; }
