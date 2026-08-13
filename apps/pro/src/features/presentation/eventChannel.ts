import { calculateRankings, calculateStandings, validateEventState, type EventStateV1, type Heat } from "@rr3/domain";

const CHANNEL_NAME = "rr3.pro.live-event.v1";

export type SpectatorSnapshot = {
  kind: "rr3.spectator-snapshot";
  version: 1;
  event: { id: string; name: string; venue: string; status: EventStateV1["event"]["status"]; resultSeal: EventStateV1["event"]["resultSeal"] };
  current: SpectatorHeat | null;
  next: SpectatorHeat | null;
  latest: SpectatorHeat | null;
  standings: Array<{ carId: string; carNumber: number; carName: string; participantName: string; wins: number; rank: number | null }>;
  notices: string[];
  updatedAt: string;
};

export type SpectatorHeat = {
  id: string;
  label: string;
  status: Heat["status"];
  winner: string | null;
  lanes: Array<{ lane: number; carId: string; carNumber: number; carName: string }>;
};

export function createSpectatorSnapshot(event: EventStateV1): SpectatorSnapshot {
  const validated = validateEventState(event);
  if (!validated.success) throw new Error("Only a validated event may be presented");
  const safe = validated.data;
  const ordered = [...safe.matches, ...safe.finals].sort((a, b) => phaseOrder(a.phase) - phaseOrder(b.phase) || a.matchNumber - b.matchNumber || a.heatNumber - b.heatNumber || compareStableIds(a.id, b.id));
  const currentIndex = ordered.findIndex(({ status }) => status === "scheduled" || status === "rerun");
  const current = currentIndex >= 0 ? ordered[currentIndex] ?? null : null;
  const next = currentIndex >= 0
    ? ordered.slice(currentIndex + 1).find(({ status }) => status === "scheduled" || status === "rerun") ?? null
    : null;
  const latestResultHeatId = safe.auditLog.slice().reverse().find(({ action }) => action === "result.recorded" || action === "result.corrected")?.entityId;
  const latest = (latestResultHeatId ? ordered.find(({ id }) => id === latestResultHeatId) : null)
    ?? ordered.filter(({ status }) => status === "completed").at(-1)
    ?? null;
  const standingsPhase = safe.finals.some(({ status }) => status === "completed") ? "final" : "preliminary";
  const finalCarIds = new Set(safe.finals.flatMap(({ lanes }) => lanes.filter((carId): carId is string => carId !== null)));
  const eligibleStandings = calculateStandings(safe, standingsPhase)
    .filter((row) => standingsPhase === "preliminary" || finalCarIds.has(row.carId));
  const standings = calculateRankings(eligibleStandings, safe.settings)
    .map((row) => ({
    carId: row.carId,
    carNumber: row.carNumber,
    carName: row.carName,
    participantName: row.participantName,
    wins: row.totalWins,
    rank: row.rank,
  }));
  return {
    kind: "rr3.spectator-snapshot",
    version: 1,
    event: { id: safe.event.id, name: safe.event.name, venue: safe.event.venue, status: safe.event.status, resultSeal: safe.event.resultSeal },
    current: current ? heatSnapshot(current, safe) : null,
    next: next ? heatSnapshot(next, safe) : null,
    latest: latest ? heatSnapshot(latest, safe) : null,
    standings,
    notices: ordered.filter(({ status }) => status === "cancelled" || status === "rerun").map((heat) => `${heatLabel(heat)} is ${heat.status}`),
    updatedAt: safe.event.updatedAt,
  };
}

export function publishSpectatorSnapshot(event: EventStateV1): void {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(CHANNEL_NAME);
  channel.postMessage(createSpectatorSnapshot(event));
  channel.close();
}

export function subscribeToSpectatorSnapshots(onSnapshot: (snapshot: SpectatorSnapshot) => void): () => void {
  if (typeof BroadcastChannel === "undefined") return () => undefined;
  const channel = new BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = ({ data }) => {
    const snapshot = parseSpectatorSnapshot(data);
    if (snapshot) onSnapshot(snapshot);
  };
  channel.postMessage({ kind: "rr3.spectator-request", version: 1 });
  return () => channel.close();
}

export function subscribeToSpectatorRequests(getEvent: () => EventStateV1 | null): () => void {
  if (typeof BroadcastChannel === "undefined") return () => undefined;
  const channel = new BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = ({ data }) => {
    if (!isRecord(data) || data.kind !== "rr3.spectator-request" || data.version !== 1) return;
    const event = getEvent();
    if (event) channel.postMessage(createSpectatorSnapshot(event));
  };
  return () => channel.close();
}

function parseSpectatorSnapshot(input: unknown): SpectatorSnapshot | null {
  if (!isRecord(input) || input.kind !== "rr3.spectator-snapshot" || input.version !== 1 || !isRecord(input.event)) return null;
  if (typeof input.event.name !== "string" || typeof input.updatedAt !== "string" || !Array.isArray(input.standings) || !Array.isArray(input.notices)) return null;
  return structuredClone(input) as SpectatorSnapshot;
}

function heatSnapshot(heat: Heat, event: EventStateV1): SpectatorHeat {
  return {
    id: heat.id,
    label: heatLabel(heat),
    status: heat.status,
    winner: heat.winnerEntryId ? carLabel(heat.winnerEntryId, event) : null,
    lanes: heat.lanes.flatMap((carId, index) => {
      if (!carId) return [];
      const entry = event.entries.find(({ id }) => id === carId);
      return entry ? [{ lane: index + 1, carId, carNumber: entry.carNumber, carName: entry.name }] : [];
    }),
  };
}

function carLabel(carId: string, event: EventStateV1): string {
  const entry = event.entries.find(({ id }) => id === carId);
  return entry ? `Car ${entry.carNumber}` : "Unknown car";
}

function heatLabel(heat: Heat): string { return `${heat.phase === "final" ? "Final · " : ""}Match ${heat.matchNumber} Heat ${heat.heatNumber}`; }
function phaseOrder(phase: Heat["phase"]): number { return phase === "preliminary" ? 0 : 1; }
function compareStableIds(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
