import { calculateRankings, calculateStandings } from "@rr3/domain";
import { compareCodeUnits } from "./ordering";
import type { AdvancementPreview, AdvancementRule, MeetStateV1 } from "./types";

export function previewAdvancement(state: MeetStateV1, ruleId: string): AdvancementPreview {
  const rule = state.advancementRules.find((item) => item.id === ruleId);
  if (!rule) throw new Error(`Unknown advancement rule: ${ruleId}`);
  const source = bracketFor(state, rule.sourceBracketId);
  const rankings = calculateRankings(calculateStandings(source.event, "preliminary"), source.event.settings);
  const groups = rankGroups(rankings);
  const automatic = groups.filter((group) => group.end <= rule.topN).flatMap((group) => group.rows);
  const cutoff = groups.find((group) => group.start <= rule.topN && group.end > rule.topN)?.rows ?? [];
  const candidates = [...automatic, ...cutoff];
  const selected = allocateSelections(state, rule, automatic);
  const tiedCarIds = cutoff.map((standing) => standing.carId);
  const duplicateCarIds = candidates.filter((standing) => isDuplicate(state, source.id, standing.carId)).map((standing) => standing.carId);
  const capacityCandidates = allocateSelections(state, rule, candidates);
  const capacityIssues = capacityIssuesFor(state, rule, capacityCandidates);
  const staleSource = sourceHasStaleDependency(state, source.id) || state.advancementSnapshots.some((snapshot) => snapshot.ruleId === ruleId && snapshot.stale);
  return {
    ruleId, sourceBracketId: source.id, sourceResultVersion: source.version, selected,
    excludedCarIds: rankings.filter((standing) => !selected.some((selection) => selection.sourceCarId === standing.carId)).map((standing) => standing.carId),
    tiedCarIds, duplicateCarIds, capacityIssues, staleSource,
    canConfirm: rule.status === "active" && selected.length === rule.topN && tiedCarIds.length === 0 && duplicateCarIds.length === 0 && capacityIssues.length === 0 && !staleSource
  };
}

export function eligibleAdvancementSelections(state: MeetStateV1, ruleId: string): Array<{ sourceCarId: string; rank: number }> {
  const rule = ruleFor(state, ruleId);
  const source = bracketFor(state, rule.sourceBracketId);
  const groups = rankGroups(calculateRankings(calculateStandings(source.event, "preliminary"), source.event.settings));
  return groups.filter((group) => group.end <= rule.topN || (group.start <= rule.topN && group.end > rule.topN)).flatMap((group) => group.rows).map((standing) => ({ sourceCarId: standing.carId, rank: standing.rank ?? rule.topN }));
}

/**
 * Validates the organiser's exact advancement choice against the published
 * automatic and cutoff groups, then allocates it using current destination
 * occupancy. The returned ordering is stable and is the payload sent to the
 * authoritative PostgreSQL transaction.
 */
export function prepareAdvancementSelections(state: MeetStateV1, ruleId: string, selectedIds: readonly string[]): AdvancementPreview["selected"] {
  const rule = ruleFor(state, ruleId);
  const preview = previewAdvancement(state, ruleId);
  if (rule.status !== "active" || preview.staleSource) throw new Error("Advancement preview cannot be confirmed");
  if (selectedIds.length !== rule.topN) throw new Error(`Advancement must select exactly ${rule.topN} cars`);
  if (new Set(selectedIds).size !== selectedIds.length) throw new Error("Advancement selections must be unique");

  const eligible = new Map(eligibleAdvancementSelections(state, ruleId).map((selection) => [selection.sourceCarId, selection]));
  const selectedSet = new Set(selectedIds);
  const automaticIds = preview.selected.map((selection) => selection.sourceCarId);
  if (automaticIds.some((sourceCarId) => !selectedSet.has(sourceCarId))) throw new Error("Every automatic qualifier must be selected");
  const candidates = selectedIds.map((sourceCarId) => {
    const selection = eligible.get(sourceCarId);
    if (!selection) throw new Error(`Advancement selection contains an ineligible car: ${sourceCarId}`);
    if (isDuplicate(state, preview.sourceBracketId, sourceCarId)) throw new Error(`Advancement selection is already active: ${sourceCarId}`);
    return selection;
  }).sort((left, right) => left.rank - right.rank || compareCodeUnits(left.sourceCarId, right.sourceCarId));
  const allocated = allocateSelections(state, rule, candidates);
  if (capacityIssuesFor(state, rule, allocated).length > 0) throw new Error("Advancement destination capacity is exceeded");
  return allocated;
}

export function allocateSelections(state: MeetStateV1, rule: AdvancementRule, candidates: ReadonlyArray<{ carId: string; rank: number | null }> | ReadonlyArray<{ sourceCarId: string; rank: number }>): AdvancementPreview["selected"] {
  const counts = new Map(rule.destinationOrder.map((id) => [id, bracketFor(state, id).event.entries.filter((entry) => entry.active).length]));
  return candidates.map((candidate) => {
    const sourceCarId = "carId" in candidate ? candidate.carId : candidate.sourceCarId;
    const rank = candidate.rank ?? rule.topN;
    const destinationBracketId = rule.destinationOrder.slice().sort((left, right) => (counts.get(left)! - counts.get(right)!) || rule.destinationOrder.indexOf(left) - rule.destinationOrder.indexOf(right))[0]!;
    counts.set(destinationBracketId, counts.get(destinationBracketId)! + 1);
    return { sourceCarId, destinationBracketId, rank };
  });
}

export function sourceHasStaleDependency(state: MeetStateV1, sourceBracketId: string): boolean {
  const staleSnapshots = staleSnapshotIds(state);
  return bracketFor(state, sourceBracketId).lineage.some((lineage) => staleSnapshots.has(lineage.snapshotId));
}

export function staleSnapshotIds(state: MeetStateV1): Set<string> {
  const stale = new Set(state.advancementSnapshots.filter((snapshot) => snapshot.stale || bracketFor(state, snapshot.sourceBracketId).version !== snapshot.sourceResultVersion).map((snapshot) => snapshot.id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const snapshot of state.advancementSnapshots) {
      if (!stale.has(snapshot.id) && bracketFor(state, snapshot.sourceBracketId).lineage.some((lineage) => stale.has(lineage.snapshotId))) { stale.add(snapshot.id); changed = true; }
    }
  }
  return stale;
}

type RankingRow = ReturnType<typeof calculateRankings>[number];
function rankGroups(rankings: readonly RankingRow[]): Array<{ start: number; end: number; rows: RankingRow[] }> {
  const groups = new Map<string, RankingRow[]>();
  for (const standing of rankings) {
    const key = standing.rank === null ? "unranked" : String(standing.rank);
    groups.set(key, [...(groups.get(key) ?? []), standing]);
  }
  return [...groups.values()].map((rows) => {
    const ordered = rows.slice().sort((left, right) => left.displayOrder - right.displayOrder || compareCodeUnits(left.carId, right.carId));
    const start = ordered[0]!.rank ?? 1;
    return { start, end: start + ordered.length - 1, rows: ordered };
  }).sort((left, right) => left.start - right.start || compareCodeUnits(left.rows[0]!.carId, right.rows[0]!.carId));
}
function isDuplicate(state: MeetStateV1, sourceBracketId: string, sourceCarId: string): boolean { return state.brackets.some((bracket) => bracket.lineage.some((lineage) => lineage.sourceBracketId === sourceBracketId && lineage.sourceCarId === sourceCarId)); }

export function ruleFor(state: MeetStateV1, ruleId: string): AdvancementRule {
  const rule = state.advancementRules.find((item) => item.id === ruleId);
  if (!rule) throw new Error(`Unknown advancement rule: ${ruleId}`);
  return rule;
}

export function bracketFor(state: MeetStateV1, bracketId: string) {
  const bracket = state.brackets.find((item) => item.id === bracketId);
  if (!bracket) throw new Error(`Unknown bracket: ${bracketId}`);
  return bracket;
}

function capacityIssuesFor(state: MeetStateV1, rule: AdvancementRule, selected: AdvancementPreview["selected"]): AdvancementPreview["capacityIssues"] {
  return rule.destinationOrder.flatMap((destinationBracketId) => {
    const bracket = bracketFor(state, destinationBracketId);
    const required = selected.filter((selection) => selection.destinationBracketId === destinationBracketId).length;
    const available = rule.destinationCapacity - bracket.event.entries.filter((entry) => entry.active).length;
    return required > available ? [{ destinationBracketId, available: Math.max(0, available), required }] : [];
  });
}
