import type { RankedStanding } from "./rankings";

export type QualificationAction = "include-all" | "playoff" | "manual-with-reason";

export type QualificationDecision = {
  requestedCount: number;
  automaticQualifiers: RankedStanding[];
  tiedCutoffEntrants: RankedStanding[];
  allowedActions: QualificationAction[];
};

export function selectFinalists(rankings: readonly RankedStanding[], count: number): QualificationDecision {
  if (!Number.isInteger(count) || count < 0) throw new Error("Finalist count must be a non-negative integer");
  const eligible = rankings.filter(({ active, completedHeats, rank }) => active && completedHeats > 0 && rank !== null);
  if (count === 0 || eligible.length === 0) return emptyDecision(count);
  if (count >= eligible.length) {
    return { requestedCount: count, automaticQualifiers: eligible.slice(), tiedCutoffEntrants: [], allowedActions: [] };
  }

  const cutoff = eligible[count - 1];
  if (!cutoff) return emptyDecision(count);
  const cutoffGroup = eligible.filter(({ rank }) => rank === cutoff.rank);
  const cutoffStart = eligible.findIndex(({ rank }) => rank === cutoff.rank);
  const cutoffEnd = cutoffStart + cutoffGroup.length;
  if (cutoffGroup.length > 1 && cutoffStart < count && cutoffEnd > count) {
    return {
      requestedCount: count,
      automaticQualifiers: eligible.slice(0, cutoffStart),
      tiedCutoffEntrants: cutoffGroup,
      allowedActions: ["include-all", "playoff", "manual-with-reason"]
    };
  }

  return {
    requestedCount: count,
    automaticQualifiers: eligible.slice(0, count),
    tiedCutoffEntrants: [],
    allowedActions: []
  };
}

function emptyDecision(requestedCount: number): QualificationDecision {
  return { requestedCount, automaticQualifiers: [], tiedCutoffEntrants: [], allowedActions: [] };
}
