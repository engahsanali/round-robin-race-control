import { validateEventState } from "./schema";
import type { AuditEntry, EventStateV1, Heat, JsonValue } from "./types";

export type Standing = {
  phase: "preliminary" | "final";
  carId: string;
  participantId: string;
  participantName: string;
  carNumber: number;
  carName: string;
  categoryId: string;
  active: boolean;
  matchWins: Record<string, number>;
  totalWins: number;
  matchesWon: number;
  completedHeats: number;
  averageTimeMs: number | null;
  bestTimeMs: number | null;
  laneBalanceScore: number;
  headToHeadWins: Record<string, number>;
  recentForm: Array<"win" | "loss">;
};

type HeatCollection = "matches" | "finals";
const MAX_AUDIT_ENTRIES = 10_000;
const MAX_AUDIT_REASON_LENGTH = 500;

type LocatedHeat = {
  collection: HeatCollection;
  index: number;
  heat: Heat;
};

export function recordWinner(
  state: EventStateV1,
  heatId: string,
  carId: string,
  correctionReason?: string
): EventStateV1 {
  assertValidState(state);
  if (correctionReason !== undefined) assertReasonWithinLimit(correctionReason, "Correction");
  const located = locateHeat(state, heatId);
  const car = state.entries.find(({ id }) => id === carId);
  if (!car) throw new Error(`Unknown car ID: ${carId}`);
  if (!located.heat.lanes.includes(carId)) {
    throw new Error(`Car ${carId} is not assigned to heat ${heatId}`);
  }

  const previousWinner = located.heat.winnerEntryId;
  if (located.heat.status === "completed" && previousWinner === carId) return state;
  if (previousWinner !== null && previousWinner !== carId && !hasReason(correctionReason)) {
    throw new Error("A correction reason is required when replacing an official winner");
  }

  const nextHeat: Heat = { ...located.heat, status: "completed", winnerEntryId: carId };
  const reasonText = hasReason(correctionReason) ? ` Reason: ${correctionReason.trim()}.` : "";
  const summary = previousWinner === null
    ? `Recorded winner ${carId} for heat ${heatId}.`
    : `Changed winner for heat ${heatId} from ${previousWinner} to ${carId}.${reasonText}`;

  return updateHeatAndAudit(state, located, nextHeat, {
    action: previousWinner === null ? "result.recorded" : "result.corrected",
    summary,
    details: {
      previousWinnerEntryId: previousWinner,
      winnerEntryId: carId,
      correctionReason: hasReason(correctionReason) ? correctionReason.trim() : null
    }
  });
}

export function cancelHeat(state: EventStateV1, heatId: string, reason: string): EventStateV1 {
  assertValidState(state);
  requireReason(reason, "Cancellation");
  assertReasonWithinLimit(reason, "Cancellation");
  const located = locateHeat(state, heatId);
  const previousWinner = located.heat.winnerEntryId;
  const nextHeat: Heat = { ...located.heat, status: "cancelled", winnerEntryId: null };

  return updateHeatAndAudit(state, located, nextHeat, {
    action: "heat.cancelled",
    summary: `Cancelled heat ${heatId}; removed official winner ${previousWinner ?? "none"}. Reason: ${reason.trim()}.`,
    details: { previousWinnerEntryId: previousWinner, reason: reason.trim() }
  });
}

export function markRerun(state: EventStateV1, heatId: string, reason: string): EventStateV1 {
  assertValidState(state);
  requireReason(reason, "Rerun");
  assertReasonWithinLimit(reason, "Rerun");
  const located = locateHeat(state, heatId);
  const previousWinner = located.heat.winnerEntryId;
  const nextHeat: Heat = { ...located.heat, status: "rerun", winnerEntryId: null };

  return updateHeatAndAudit(state, located, nextHeat, {
    action: "heat.rerun-marked",
    summary: `Marked heat ${heatId} for rerun; removed official winner ${previousWinner ?? "none"}. Reason: ${reason.trim()}.`,
    details: { previousWinnerEntryId: previousWinner, reason: reason.trim() }
  });
}

export function calculateStandings(
  state: EventStateV1,
  phase: "preliminary" | "final"
): Standing[] {
  assertValidState(state);
  const heats = (phase === "preliminary" ? state.matches : state.finals)
    .filter((heat) => heat.phase === phase)
    .slice()
    .sort((left, right) => left.matchNumber - right.matchNumber || left.heatNumber - right.heatNumber || left.id.localeCompare(right.id));
  const participantById = new Map(state.participants.map((participant) => [participant.id, participant]));

  return state.entries.filter(({ active }) => active).map((entry): Standing => {
    const participant = participantById.get(entry.participantId);
    if (!participant) throw new Error(`Unknown participant ID: ${entry.participantId}`);

    const matchWins: Record<string, number> = {};
    const headToHeadWins: Record<string, number> = {};
    const laneCounts: [number, number, number] = [0, 0, 0];
    const times: number[] = [];
    const recentForm: Array<"win" | "loss"> = [];
    let completedHeats = 0;

    for (const heat of heats) {
      if (heat.status !== "completed" || heat.winnerEntryId === null) continue;
      const laneIndex = heat.lanes.indexOf(entry.id);
      if (laneIndex < 0) continue;

      const matchKey = String(heat.matchNumber);
      matchWins[matchKey] ??= 0;
      completedHeats += 1;
      laneCounts[laneIndex] = (laneCounts[laneIndex] ?? 0) + 1;
      const time = heat.laneTimesMs[laneIndex] ?? null;
      if (time !== null) times.push(time);

      if (heat.winnerEntryId === entry.id) {
        matchWins[matchKey] += 1;
        recentForm.push("win");
        for (const opponentId of heat.lanes) {
          if (opponentId !== null && opponentId !== entry.id) {
            headToHeadWins[opponentId] = (headToHeadWins[opponentId] ?? 0) + 1;
          }
        }
      } else {
        recentForm.push("loss");
      }
    }

    const totalWins = Object.values(matchWins).reduce((total, wins) => total + wins, 0);
    const maximumLaneCount = Math.max(...laneCounts);
    const minimumLaneCount = Math.min(...laneCounts);
    return {
      phase,
      carId: entry.id,
      participantId: participant.id,
      participantName: participant.name,
      carNumber: entry.carNumber,
      carName: entry.name,
      categoryId: entry.categoryId,
      active: entry.active,
      matchWins,
      totalWins,
      matchesWon: Object.values(matchWins).filter((wins) => wins > 0).length,
      completedHeats,
      averageTimeMs: times.length === 0 ? null : times.reduce((total, time) => total + time, 0) / times.length,
      bestTimeMs: times.length === 0 ? null : Math.min(...times),
      laneBalanceScore: maximumLaneCount - minimumLaneCount,
      headToHeadWins,
      recentForm
    };
  });
}

function assertValidState(state: EventStateV1): void {
  const result = validateEventState(state);
  if (result.success) return;
  const summary = result.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
  throw new Error(`Invalid event state: ${summary}`);
}

function locateHeat(state: EventStateV1, heatId: string): LocatedHeat {
  const matchIndex = state.matches.findIndex(({ id }) => id === heatId);
  const match = state.matches[matchIndex];
  if (matchIndex >= 0 && match) return { collection: "matches", index: matchIndex, heat: match };
  const finalIndex = state.finals.findIndex(({ id }) => id === heatId);
  const final = state.finals[finalIndex];
  if (finalIndex >= 0 && final) return { collection: "finals", index: finalIndex, heat: final };
  throw new Error(`Unknown heat ID: ${heatId}`);
}

function updateHeatAndAudit(
  state: EventStateV1,
  located: LocatedHeat,
  heat: Heat,
  audit: { action: string; summary: string; details: Record<string, JsonValue> }
): EventStateV1 {
  if (state.auditLog.length >= MAX_AUDIT_ENTRIES) {
    throw new Error(`Audit log has reached its ${MAX_AUDIT_ENTRIES}-entry capacity`);
  }
  const collection = state[located.collection].map((existing, index) => index === located.index ? heat : existing);
  const auditEntry = createAuditEntry(state, heat.id, audit);
  const nextState: EventStateV1 = {
    ...state,
    [located.collection]: collection,
    auditLog: [...state.auditLog, auditEntry]
  };
  assertValidState(nextState);
  return nextState;
}

function createAuditEntry(
  state: EventStateV1,
  heatId: string,
  audit: { action: string; summary: string; details: Record<string, JsonValue> }
): AuditEntry {
  const prefix = `audit-${audit.action.replaceAll(".", "-")}-${stableHash(heatId)}`;
  let sequence = state.auditLog.length + 1;
  let id = `${prefix}-${sequence}`;
  const existingIds = new Set(state.auditLog.map((entry) => entry.id));
  while (existingIds.has(id)) id = `${prefix}-${++sequence}`;
  return {
    id,
    timestamp: state.event.updatedAt,
    action: audit.action,
    summary: audit.summary,
    entityType: "heat",
    entityId: heatId,
    details: audit.details
  };
}

function hasReason(reason: string | undefined): reason is string {
  return typeof reason === "string" && reason.trim().length > 0;
}

function requireReason(reason: string, label: string): void {
  if (!hasReason(reason)) throw new Error(`${label} reason is required`);
}

function assertReasonWithinLimit(reason: string, label: string): void {
  if (reason.trim().length > MAX_AUDIT_REASON_LENGTH) {
    throw new Error(`${label} reason must be at most ${MAX_AUDIT_REASON_LENGTH} characters`);
  }
}

function stableHash(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16_777_619);
  }
  return (hash >>> 0).toString(36);
}
