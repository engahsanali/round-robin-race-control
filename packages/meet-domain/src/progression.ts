import { calculateRankings, calculateStandings } from "@rr3/domain";
import type { AdvancementPreview, AdvancementRule, MeetStateV1 } from "./types";

export function previewAdvancement(state: MeetStateV1, ruleId: string): AdvancementPreview {
  const rule = state.advancementRules.find((item) => item.id === ruleId);
  if (!rule) throw new Error(`Unknown advancement rule: ${ruleId}`);
  const source = bracketFor(state, rule.sourceBracketId);
  const rankings = calculateRankings(calculateStandings(source.event, "preliminary"), source.event.settings);
  const tiedCarIds = rankings.filter((standing) => standing.isTied && (standing.rank === null || standing.rank <= rule.topN)).map((standing) => standing.carId);
  const selectedRankings = rankings.filter((standing) => standing.rank !== null && standing.rank <= rule.topN && !standing.isTied);
  const selected = selectedRankings.map((standing, index) => ({
    sourceCarId: standing.carId,
    destinationBracketId: rule.destinationOrder[index % rule.destinationOrder.length]!,
    rank: standing.rank!
  }));
  const duplicateCarIds = selected.filter((selection) => state.brackets.some((bracket) => bracket.lineage.some((lineage) => lineage.sourceBracketId === source.id && lineage.sourceCarId === selection.sourceCarId))).map((selection) => selection.sourceCarId);
  const capacityCandidates = selected.length > 0 ? selected : tiedCarIds.map((sourceCarId, index) => ({ sourceCarId, destinationBracketId: rule.destinationOrder[index % rule.destinationOrder.length]!, rank: rule.topN }));
  const capacityIssues = capacityIssuesFor(state, rule, capacityCandidates);
  const staleSource = state.advancementSnapshots.some((snapshot) => snapshot.ruleId === ruleId && (snapshot.stale || snapshot.sourceResultVersion !== source.version));
  return {
    ruleId, sourceBracketId: source.id, sourceResultVersion: source.version, selected,
    excludedCarIds: rankings.filter((standing) => !selected.some((selection) => selection.sourceCarId === standing.carId)).map((standing) => standing.carId),
    tiedCarIds, duplicateCarIds, capacityIssues, staleSource,
    canConfirm: rule.status === "active" && selected.length > 0 && tiedCarIds.length === 0 && duplicateCarIds.length === 0 && capacityIssues.length === 0 && !staleSource
  };
}

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
