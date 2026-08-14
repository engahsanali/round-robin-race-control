import { calculateRankings, calculateStandings, type CsvCell, type CsvRow } from "@rr3/domain";
import { MEET_CREATOR_CREDIT, serializeMeetBackup, type PortableHostedMeetBundle } from "./backup";
import { compareCodeUnits } from "./ordering";
import type { MeetStateV1 } from "./types";

export type MeetExportManifestEntry = { key: "meet-summary" | "bracket-summary" | "registrations"; fileName: string };
export type MeetReportAudience = "operations" | "public";
export type MeetEventPackFile = { name: string; type: string; text: string };

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

export async function buildMeetEventPack(
  bundle: PortableHostedMeetBundle,
  options: { audience: MeetReportAudience; exportedAt: string; applicationVersion: string },
): Promise<MeetEventPackFile[]> {
  const { state } = bundle;
  const files: MeetEventPackFile[] = [];
  if (options.audience === "operations") files.push({ name: "backup.json", type: "application/json", text: await serializeMeetBackup(bundle, options) });
  files.push(
    csvFile("summary.csv", buildMeetSummaryRows(state)),
    csvFile("brackets.csv", buildBracketSummaryRows(state)),
    csvFile("registrations.csv", buildRegistrationReportRows(state, options.audience)),
    csvFile("schedule.csv", buildScheduleRows(state)),
    csvFile("results.csv", buildResultRows(state, false)),
    csvFile("standings.csv", buildStandingsReportRows(state)),
    csvFile("advancement.csv", buildAdvancementRows(bundle)),
    csvFile("final-results.csv", buildResultRows(state, true)),
    csvFile("audit.csv", buildAuditReportRows(state, options.audience)),
    { name: "summary.txt", type: "text/plain", text: buildMeetTextSummary(state) },
    { name: "printable-report.html", type: "text/html", text: buildPrintableMeetHtml(state, options.audience) },
  );
  const manifest = {
    format: "rr3-meet-event-pack",
    version: 1,
    audience: options.audience,
    exportedAt: options.exportedAt,
    files: await Promise.all(files.map(async (file) => ({ name: file.name, type: file.type, bytes: new TextEncoder().encode(file.text).byteLength, sha256: await sha256(file.text) }))),
  };
  files.push({ name: "manifest.json", type: "application/json", text: `${JSON.stringify(manifest, null, 2)}\n` });
  return files;
}

export function buildRegistrationReportRows(state: MeetStateV1, audience: MeetReportAudience): CsvRow[] {
  if (audience === "operations") return buildMeetRegistrationRows(state);
  const rows: CsvRow[] = [["Bracket", "Participant", "Car number", "Car", "Active"]];
  for (const bracket of orderedBrackets(state)) {
    const participants = new Map(bracket.event.participants.map((participant) => [participant.id, participant]));
    for (const entry of orderedEntries(bracket.event.entries)) rows.push([bracket.name, participants.get(entry.participantId)?.name ?? "", entry.carNumber, entry.name, entry.active]);
  }
  return rows;
}

export function buildScheduleRows(state: MeetStateV1): CsvRow[] {
  const rows: CsvRow[] = [["Bracket", "Stage", "Heat ID", "Phase", "Match", "Heat", "Lane 1 car", "Lane 2 car", "Lane 3 car", "Status"]];
  for (const bracket of orderedBrackets(state)) for (const heat of orderedHeats(bracket.event)) rows.push([bracket.name, bracket.stage, heat.id, heat.phase, heat.matchNumber, heat.heatNumber, ...heat.lanes, heat.status]);
  return rows;
}

export function buildResultRows(state: MeetStateV1, finalsOnly: boolean): CsvRow[] {
  const rows: CsvRow[] = [["Bracket", "Stage", "Heat ID", "Phase", "Match", "Heat", "Status", "Winner car", "Lane 1 time ms", "Lane 2 time ms", "Lane 3 time ms"]];
  for (const bracket of orderedBrackets(state)) for (const heat of orderedHeats(bracket.event).filter((heat) => !finalsOnly || heat.phase === "final")) rows.push([bracket.name, bracket.stage, heat.id, heat.phase, heat.matchNumber, heat.heatNumber, heat.status, heat.winnerEntryId, ...heat.laneTimesMs]);
  return rows;
}

export function buildStandingsReportRows(state: MeetStateV1): CsvRow[] {
  const rows: CsvRow[] = [["Bracket", "Stage", "Phase", "Rank", "Tied", "Car ID", "Car number", "Car", "Participant", "Total wins", "Matches won", "Completed heats", "Average time ms", "Best time ms"]];
  for (const bracket of orderedBrackets(state)) for (const phase of ["preliminary", "final"] as const) {
    const standings = calculateRankings(calculateStandings(bracket.event, phase), bracket.event.settings);
    for (const standing of standings) rows.push([bracket.name, bracket.stage, phase, standing.rank, standing.isTied, standing.carId, standing.carNumber, standing.carName, standing.participantName, standing.totalWins, standing.matchesWon, standing.completedHeats, standing.averageTimeMs, standing.bestTimeMs]);
  }
  return rows;
}

export function buildAdvancementRows(bundle: PortableHostedMeetBundle): CsvRow[] {
  const rows: CsvRow[] = [["Snapshot ID", "Rule ID", "Source bracket", "Source result version", "Stale", "Superseded by", "Confirmed at", "Source car", "Destination bracket", "Destination car", "Rank"]];
  const selectionsBySnapshot = new Map<string, typeof bundle.history.selections>();
  for (const selection of bundle.history.selections) selectionsBySnapshot.set(selection.snapshotId, [...(selectionsBySnapshot.get(selection.snapshotId) ?? []), selection]);
  for (const snapshot of bundle.history.snapshots.slice().sort((a, b) => compareCodeUnits(a.confirmedAt, b.confirmedAt) || compareCodeUnits(a.id, b.id))) {
    const selections = (selectionsBySnapshot.get(snapshot.id) ?? []).slice().sort((a, b) => a.rank - b.rank || compareCodeUnits(a.id, b.id));
    if (selections.length === 0) rows.push([snapshot.id, snapshot.ruleId, snapshot.sourceBracketId, snapshot.sourceResultVersion, snapshot.stale, snapshot.replacedBySnapshotId, snapshot.confirmedAt, "", "", "", ""]);
    for (const selection of selections) rows.push([snapshot.id, snapshot.ruleId, snapshot.sourceBracketId, snapshot.sourceResultVersion, snapshot.stale, snapshot.replacedBySnapshotId, snapshot.confirmedAt, selection.sourceCarId, selection.destinationBracketId, selection.destinationCarId, selection.rank]);
  }
  return rows;
}

export function buildAuditReportRows(state: MeetStateV1, audience: MeetReportAudience): CsvRow[] {
  const events = state.auditLog.slice().sort((a, b) => compareCodeUnits(a.timestamp, b.timestamp) || compareCodeUnits(a.id, b.id));
  if (audience === "public") return [["Timestamp", "Action", "Entity type", "Entity ID"], ...events.map((event): CsvRow => [event.timestamp, event.action, event.entityType, event.entityId])];
  return [["Audit ID", "Timestamp", "Actor ID", "Action", "Entity type", "Entity ID", "Reason", "Before JSON", "After JSON"], ...events.map((event): CsvRow => [event.id, event.timestamp, event.actorId, event.action, event.entityType, event.entityId, event.reason, stableJson(event.before), stableJson(event.after)])];
}

export function buildMeetTextSummary(state: MeetStateV1): string {
  const completed = state.brackets.filter((bracket) => bracket.status === "completed").length;
  return `${state.meet.name}\n${state.meet.date} · ${state.meet.venue}\nStatus: ${state.meet.status}\nBrackets: ${state.brackets.length} (${completed} completed)\n${MEET_CREATOR_CREDIT}\n`;
}

export function buildPrintableMeetHtml(state: MeetStateV1, audience: MeetReportAudience): string {
  const sheets = orderedBrackets(state).map((bracket) => {
    const participants = new Map(bracket.event.participants.map((participant) => [participant.id, participant]));
    const rows = orderedEntries(bracket.event.entries).map((entry) => `<tr><td>${escapeHtml(String(entry.carNumber))}</td><td>${escapeHtml(entry.name)}</td><td>${escapeHtml(participants.get(entry.participantId)?.name ?? "")}</td><td>${entry.active ? "Active" : "Withdrawn"}</td></tr>`).join("");
    return `<section><h2>${escapeHtml(bracket.name)} · ${escapeHtml(bracket.stage)}</h2><p>Status: ${escapeHtml(bracket.status)}</p><table><thead><tr><th>Car</th><th>Name</th><th>Participant</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></section>`;
  }).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(state.meet.name)} report</title><style>body{font-family:system-ui,sans-serif;color:#111}table{width:100%;border-collapse:collapse}th,td{border:1px solid #999;padding:.35rem;text-align:left}section{break-after:page}footer{margin-top:2rem}</style></head><body><header><h1>${escapeHtml(state.meet.name)}</h1><p>${escapeHtml(state.meet.date)} · ${escapeHtml(state.meet.venue)} · ${escapeHtml(state.meet.status)}</p><p>Report audience: ${escapeHtml(audience)}</p></header>${sheets}<footer>${MEET_CREATOR_CREDIT}</footer></body></html>\n`;
}

function orderedBrackets(state: MeetStateV1) { return state.brackets.slice().sort((left, right) => left.displayOrder - right.displayOrder || compareCodeUnits(left.id, right.id)); }
function orderedEntries(entries: MeetStateV1["brackets"][number]["event"]["entries"]) { return entries.slice().sort((left, right) => left.carNumber - right.carNumber || compareCodeUnits(left.id, right.id)); }
function orderedHeats(event: MeetStateV1["brackets"][number]["event"]) { return [...event.matches, ...event.finals].sort((left, right) => (left.phase === right.phase ? 0 : left.phase === "preliminary" ? -1 : 1) || left.matchNumber - right.matchNumber || left.heatNumber - right.heatNumber || compareCodeUnits(left.id, right.id)); }
function csvFile(name: string, rows: CsvRow[]): MeetEventPackFile { return { name, type: "text/csv", text: toMeetCsv(rows) }; }
function encodeCell(value: CsvCell): string { const original = value === null ? "" : String(value); const safe = /^[\t\r\n]|^\s*[=+\-@]/u.test(original) ? `'${original}` : original; return /[",\r\n]/u.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe; }
function stableJson(value: unknown): string { return JSON.stringify(sortJson(value)); }
function sortJson(value: unknown): unknown { if (Array.isArray(value)) return value.map(sortJson); if (value === null || typeof value !== "object") return value; const record = value as Record<string, unknown>; return Object.fromEntries(Object.keys(record).sort(compareCodeUnits).map((key) => [key, sortJson(record[key])])); }
function escapeHtml(value: string): string { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;"); }
async function sha256(text: string): Promise<string> { const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)); return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }
