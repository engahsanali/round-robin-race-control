import { calculateEventAccounts } from "./payments";
import { calculateRankings } from "./rankings";
import { calculateStandings } from "./results";
import type { EventStateV1 } from "./types";

export type CsvCell = string | number | boolean | null;
export type CsvRow = readonly CsvCell[];

export function toCsv(rows: readonly CsvRow[]): string {
  return rows.map((row) => row.map(encodeCell).join(",")).join("\r\n");
}

export function buildRegistrationRows(state: EventStateV1): CsvRow[] {
  const participants = new Map(state.participants.map((participant) => [participant.id, participant]));
  const rows: CsvRow[] = [[
    "Participant ID", "Participant", "Email", "Phone", "Car entry ID", "Car number", "Car", "Category", "Quantity", "Active"
  ]];
  const entries = state.entries.slice().sort((left, right) => left.carNumber - right.carNumber || compareCodeUnits(left.id, right.id));
  for (const entry of entries) {
    const participant = participants.get(entry.participantId);
    rows.push([
      entry.participantId, participant?.name ?? "", participant?.email ?? "", participant?.phone ?? "",
      entry.id, entry.carNumber, entry.name, entry.categoryId, entry.quantity, entry.active
    ]);
  }
  return rows;
}

export function buildFeesRows(state: EventStateV1): CsvRow[] {
  const participants = new Map(state.participants.map((participant) => [participant.id, participant]));
  const accounts = calculateEventAccounts(state);
  return [
    ["Participant ID", "Participant", "Charge cents", "Collected cents", "Balance cents"],
    ...accounts.participants.map((account): CsvRow => [
      account.participantId,
      participants.get(account.participantId)?.name ?? "",
      account.chargeCents,
      account.collectedCents,
      account.balanceCents
    ])
  ];
}

export function buildResultsRows(state: EventStateV1): CsvRow[] {
  const rows: CsvRow[] = [[
    "Heat ID", "Phase", "Match", "Heat", "Lane 1", "Lane 2", "Lane 3", "Status", "Winner entry ID",
    "Lane 1 time ms", "Lane 2 time ms", "Lane 3 time ms", "Notes"
  ]];
  const heats = [...state.matches, ...state.finals].sort((left, right) =>
    phaseOrder(left.phase) - phaseOrder(right.phase)
    || left.matchNumber - right.matchNumber
    || left.heatNumber - right.heatNumber
    || compareCodeUnits(left.id, right.id)
  );
  for (const heat of heats) {
    rows.push([
      heat.id, heat.phase, heat.matchNumber, heat.heatNumber, ...heat.lanes, heat.status, heat.winnerEntryId,
      ...heat.laneTimesMs, heat.notes
    ]);
  }
  return rows;
}

export function buildStandingsRows(state: EventStateV1, phase: "preliminary" | "final"): CsvRow[] {
  const rankings = calculateRankings(calculateStandings(state, phase), state.settings);
  return [
    [
      "Rank", "Tied", "Car entry ID", "Car number", "Car", "Participant ID", "Participant", "Category",
      "Total wins", "Matches won", "Completed heats", "Average time ms", "Best time ms"
    ],
    ...rankings.map((standing): CsvRow => [
      standing.rank, standing.isTied, standing.carId, standing.carNumber, standing.carName,
      standing.participantId, standing.participantName, standing.categoryId, standing.totalWins,
      standing.matchesWon, standing.completedHeats, standing.averageTimeMs, standing.bestTimeMs
    ])
  ];
}

export function buildAuditRows(state: EventStateV1): CsvRow[] {
  const entries = state.auditLog.slice().sort((left, right) =>
    compareCodeUnits(left.timestamp, right.timestamp) || compareCodeUnits(left.id, right.id)
  );
  return [
    ["Audit ID", "Timestamp", "Action", "Summary", "Entity type", "Entity ID", "Details JSON"],
    ...entries.map((entry): CsvRow => [
      entry.id, entry.timestamp, entry.action, entry.summary, entry.entityType, entry.entityId,
      stableJson(entry.details)
    ])
  ];
}

function encodeCell(value: CsvCell): string {
  const original = value === null ? "" : String(value);
  const protectedValue = /^\s*[=+\-@]/u.test(original) ? `'${original}` : original;
  return /[",\r\n]/u.test(protectedValue) ? `"${protectedValue.replaceAll('"', '""')}"` : protectedValue;
}

function phaseOrder(phase: "preliminary" | "final"): number {
  return phase === "preliminary" ? 0 : 1;
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(record).sort().map((key) => [key, sortKeys(record[key])]));
}
