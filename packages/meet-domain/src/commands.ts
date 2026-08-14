import type { CarEntry, EventStateV1, Participant } from "@rr3/domain";
import { bracketFor, prepareAdvancementSelections, previewAdvancement, ruleFor, staleSnapshotIds } from "./progression";
import { validateMeetState } from "./schema";
import type { AdvancementSelection, BracketState, ConfirmAdvancementInput, MeetStateV1 } from "./types";

const MAX_REASON = 500;

export function confirmAdvancementPure(state: MeetStateV1, ruleId: string, input: ConfirmAdvancementInput): MeetStateV1 {
  assertState(state);
  const existing = state.advancementSnapshots.find((snapshot) => snapshot.ruleId === ruleId && !snapshot.stale);
  if (existing) return state;
  const preview = previewAdvancement(state, ruleId);
  const rule = ruleFor(state, ruleId);
  const isManual = input.selectedCarIds !== undefined;
  const changedSelection = input.selectedCarIds !== undefined && !sameCars(input.selectedCarIds, preview.selected.map((selection) => selection.sourceCarId));
  const reason = input.reason?.trim() ?? "";
  if (changedSelection && reason.length === 0) throw new Error("A manual advancement reason is required");
  if (reason.length > MAX_REASON) throw new Error(`Manual advancement reason must be at most ${MAX_REASON} characters`);
  const selected = input.selectedCarIds === undefined ? preview.selected : prepareAdvancementSelections(state, ruleId, input.selectedCarIds);
  if (selected.length !== rule.topN) throw new Error(`Manual advancement must select exactly ${rule.topN} cars`);
  if ((!isManual && !preview.canConfirm) || rule.status !== "active" || preview.staleSource || hasCapacityIssue(state, rule, selected)) throw new Error("Advancement preview cannot be confirmed");
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
  const audit = {
    id: `audit-${snapshotId}`, timestamp: input.confirmedAt, actorId: input.actorId,
    action: "advancement.confirmed", entityType: "advancement_snapshot", entityId: snapshotId,
    reason: reason || null,
    before: { ruleId: rule.id, selections: [] },
    after: { ruleId: rule.id, selections: selected.map((selection) => ({ ...selection })) },
  };
  const next: MeetStateV1 = {
    ...state,
    brackets: nextBrackets,
    advancementRules: state.advancementRules.map((item) => item.id === rule.id ? { ...item, version: (item.version ?? 1) + 1 } : item),
    advancementSnapshots: [...state.advancementSnapshots, snapshot], auditLog: [...state.auditLog, audit],
  };
  assertState(next);
  return next;
}

export function markDependentAdvancementStale(state: MeetStateV1): MeetStateV1 {
  const stale = staleSnapshotIds(state);
  const snapshots = state.advancementSnapshots.map((snapshot) => ({ ...snapshot, stale: stale.has(snapshot.id) }));
  return snapshots.some((snapshot, index) => snapshot.stale !== state.advancementSnapshots[index]?.stale) ? { ...state, advancementSnapshots: snapshots } : state;
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
function hasCapacityIssue(state: MeetStateV1, rule: ReturnType<typeof ruleFor>, selections: readonly AdvancementSelection[]): boolean {
  return rule.destinationOrder.some((destinationId) => bracketFor(state, destinationId).event.entries.filter((entry) => entry.active).length + selections.filter((selection) => selection.destinationBracketId === destinationId).length > rule.destinationCapacity);
}
function assertState(state: MeetStateV1): void { const valid = validateMeetState(state); if (!valid.success) throw new Error(`Invalid meet state: ${valid.issues.map((issue) => issue.message).join("; ")}`); }
