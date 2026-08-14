import type { CarEntry, EventStateV1, Participant } from "@rr3/domain";
import { allocateSelections, bracketFor, eligibleAdvancementSelections, previewAdvancement, ruleFor, staleSnapshotIds } from "./progression";
import { validateMeetState } from "./schema";
import type { AdvancementSelection, BracketState, ConfirmAdvancementInput, MeetStateV1 } from "./types";

const MAX_REASON = 500;

export function confirmAdvancementPure(state: MeetStateV1, ruleId: string, input: ConfirmAdvancementInput): MeetStateV1 {
  assertState(state);
  const existing = state.advancementSnapshots.find((snapshot) => snapshot.ruleId === ruleId && !snapshot.stale);
  if (existing) return state;
  const preview = previewAdvancement(state, ruleId);
  const rule = ruleFor(state, ruleId);
  const eligible = eligibleAdvancementSelections(state, ruleId);
  const selected = resolveSelections(state, rule, preview.selected, eligible, input.selectedCarIds);
  const changedSelection = input.selectedCarIds !== undefined && !sameCars(input.selectedCarIds, preview.selected.map((selection) => selection.sourceCarId));
  const reason = input.reason?.trim() ?? "";
  if (changedSelection && reason.length === 0) throw new Error("A manual advancement reason is required");
  if (reason.length > MAX_REASON) throw new Error(`Manual advancement reason must be at most ${MAX_REASON} characters`);
  if (selected.length !== rule.topN) throw new Error(`Manual advancement must select exactly ${rule.topN} cars`);
  if ((!preview.canConfirm && !changedSelection) || rule.status !== "active" || preview.staleSource || preview.duplicateCarIds.length > 0 || preview.capacityIssues.length > 0) throw new Error("Advancement preview cannot be confirmed");
  if (selected.some((selection) => state.brackets.some((bracket) => bracket.lineage.some((lineage) => lineage.sourceBracketId === preview.sourceBracketId && lineage.sourceCarId === selection.sourceCarId)))) throw new Error("Duplicate advancement is not allowed");
  const capacity = selected.reduce<Record<string, number>>((totals, selection) => ({ ...totals, [selection.destinationBracketId]: (totals[selection.destinationBracketId] ?? 0) + 1 }), {});
  for (const destinationId of rule.destinationOrder) {
    const destination = bracketFor(state, destinationId);
    if (destination.event.entries.filter((entry) => entry.active).length + (capacity[destinationId] ?? 0) > rule.destinationCapacity) throw new Error("Advancement destination capacity is exceeded");
  }
  const snapshotId = `advancement-${rule.id}-${state.advancementSnapshots.length + 1}`;
  const source = bracketFor(state, rule.sourceBracketId);
  const nextBrackets = state.brackets.map((bracket) => applySelections(bracket, source, selected, rule.id, snapshotId));
  const snapshot = { id: snapshotId, ruleId: rule.id, sourceBracketId: source.id, sourceResultVersion: source.version, selections: selected, confirmedBy: input.actorId, reason: reason || null, confirmedAt: input.confirmedAt, stale: false };
  const audit = { id: `audit-${snapshotId}`, timestamp: input.confirmedAt, actorId: input.actorId, action: "advancement.confirmed", entityType: "advancement_snapshot", entityId: snapshotId, reason: reason || null, before: { ruleId: rule.id, selectedCarIds: [] }, after: { ruleId: rule.id, selectedCarIds: selected.map((selection) => selection.sourceCarId) } };
  const next: MeetStateV1 = { ...state, brackets: nextBrackets, advancementSnapshots: [...state.advancementSnapshots, snapshot], auditLog: [...state.auditLog, audit] };
  assertState(next);
  return next;
}

export function markDependentAdvancementStale(state: MeetStateV1): MeetStateV1 {
  const stale = staleSnapshotIds(state);
  const snapshots = state.advancementSnapshots.map((snapshot) => ({ ...snapshot, stale: stale.has(snapshot.id) }));
  return snapshots.some((snapshot, index) => snapshot.stale !== state.advancementSnapshots[index]?.stale) ? { ...state, advancementSnapshots: snapshots } : state;
}

function resolveSelections(state: MeetStateV1, rule: ReturnType<typeof ruleFor>, defaultSelections: AdvancementSelection[], eligible: Array<{ sourceCarId: string; rank: number }>, manualCarIds: string[] | undefined): AdvancementSelection[] {
  if (manualCarIds === undefined) return defaultSelections;
  if (new Set(manualCarIds).size !== manualCarIds.length) throw new Error("Manual advancement selections must be unique");
  const byCar = new Map(eligible.map((selection) => [selection.sourceCarId, selection]));
  const candidates = manualCarIds.map((sourceCarId) => {
    const selection = byCar.get(sourceCarId);
    if (!selection) throw new Error(`Manual advancement selection contains ineligible car: ${sourceCarId}`);
    return selection;
  }).sort((left, right) => left.rank - right.rank || (left.sourceCarId < right.sourceCarId ? -1 : left.sourceCarId > right.sourceCarId ? 1 : 0));
  return allocateSelections(state, rule, candidates);
}

function applySelections(destination: BracketState, source: BracketState, selections: AdvancementSelection[], ruleId: string, snapshotId: string): BracketState {
  const incoming = selections.filter((selection) => selection.destinationBracketId === destination.id);
  if (incoming.length === 0) return destination;
  let nextCarNumber = Math.max(0, ...destination.event.entries.map((entry) => entry.carNumber)) + 1;
  const participants: Participant[] = [];
  const entries: CarEntry[] = [];
  for (const selection of incoming) {
    const sourceEntry = source.event.entries.find((entry) => entry.id === selection.sourceCarId);
    if (!sourceEntry) throw new Error(`Unknown source car: ${selection.sourceCarId}`);
    const sourceParticipant = source.event.participants.find((participant) => participant.id === sourceEntry.participantId);
    if (!sourceParticipant) throw new Error(`Unknown source participant: ${sourceEntry.participantId}`);
    const participantId = `advanced-${destination.id}-${sourceParticipant.id}-${snapshotId}`;
    const entryId = `advanced-${destination.id}-${sourceEntry.id}-${snapshotId}`;
    participants.push({ ...sourceParticipant, id: participantId });
    entries.push({ ...sourceEntry, id: entryId, participantId, carNumber: nextCarNumber++ });
  }
  const event: EventStateV1 = { ...destination.event, participants: [...destination.event.participants, ...participants], entries: [...destination.event.entries, ...entries] };
  return { ...destination, version: destination.version + 1, event, lineage: [...destination.lineage, ...incoming.map((selection) => ({ sourceBracketId: source.id, sourceCarId: selection.sourceCarId, ruleId, snapshotId }))] };
}

function sameCars(left: readonly string[], right: readonly string[]): boolean { return left.length === right.length && left.every((value, index) => value === right[index]); }
function assertState(state: MeetStateV1): void { const valid = validateMeetState(state); if (!valid.success) throw new Error(`Invalid meet state: ${valid.issues.map((issue) => issue.message).join("; ")}`); }
