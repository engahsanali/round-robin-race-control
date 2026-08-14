import type { CsvCell, CsvRow } from "@rr3/domain";
import { compareCodeUnits } from "./ordering";
import type { MeetStateV1 } from "./types";

export type MeetExportManifestEntry = { key: "meet-summary" | "bracket-summary" | "registrations"; fileName: string };

export function toMeetCsv(rows: readonly CsvRow[]): string {
  return rows.map((row) => row.map(encodeCell).join(",")).join("\r\n");
}

export const toCsv = toMeetCsv;

export function buildMeetSummaryRows(state: MeetStateV1): CsvRow[] {
  return [["Meet ID", "Meet", "Date", "Venue", "Status", "Bracket count"], [state.meet.id, state.meet.name, state.meet.date, state.meet.venue, state.meet.status, state.brackets.length]];
}

export function buildBracketSummaryRows(state: MeetStateV1): CsvRow[] {
  return [["Bracket ID", "Bracket", "Stage", "Display order", "Status", "Entrants", "Version"], ...orderedBrackets(state).map((bracket): CsvRow => [bracket.id, bracket.name, bracket.stage, bracket.displayOrder, bracket.status, bracket.event.entries.filter((entry) => entry.active).length, bracket.version])];
}

export function buildMeetRegistrationRows(state: MeetStateV1): CsvRow[] {
  const rows: CsvRow[] = [["Bracket ID", "Bracket", "Participant ID", "Participant", "Email", "Phone", "Car entry ID", "Car number", "Car", "Active"]];
  for (const bracket of orderedBrackets(state)) {
    const participants = new Map(bracket.event.participants.map((participant) => [participant.id, participant]));
    for (const entry of bracket.event.entries.slice().sort((left, right) => left.carNumber - right.carNumber || compareCodeUnits(left.id, right.id))) {
      const participant = participants.get(entry.participantId);
      rows.push([bracket.id, bracket.name, entry.participantId, participant?.name ?? "", participant?.email ?? "", participant?.phone ?? "", entry.id, entry.carNumber, entry.name, entry.active]);
    }
  }
  return rows;
}

export function buildMeetExportManifest(_state: MeetStateV1): MeetExportManifestEntry[] {
  return [
    { key: "meet-summary", fileName: "meet-summary.csv" },
    { key: "bracket-summary", fileName: "bracket-summary.csv" },
    { key: "registrations", fileName: "registrations.csv" }
  ];
}

function orderedBrackets(state: MeetStateV1) { return state.brackets.slice().sort((left, right) => left.displayOrder - right.displayOrder || compareCodeUnits(left.id, right.id)); }
function encodeCell(value: CsvCell): string { const original = value === null ? "" : String(value); const safe = /^\s*[=+\-@]/u.test(original) ? `'${original}` : original; return /[",\r\n]/u.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe; }
