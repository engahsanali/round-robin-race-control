import { validateMeetState, type MeetAuditEvent, type MeetStateV1, type PortableHostedMeetBundle } from "@rr3/meet-domain";
import type { AuditEntry, EventStateV1, Heat } from "@rr3/domain";

const NOW = "2026-08-14T09:00:00.000Z";
const uuid = (value: number) => `20000000-0000-4000-8000-${String(value).padStart(12, "0")}`;

function makeBracket(
  sequence: { value: number },
  name: string,
  stage: "qualifier" | "semifinal" | "final",
  displayOrder: number,
  carCount: number,
  status: "setup" | "running" | "completed",
) {
  const bracketId = uuid(++sequence.value);
  const participants = Array.from({ length: carCount }, (_, index) => ({
    id: uuid(++sequence.value), name: `Entrant ${displayOrder}-${index + 1}`, email: "", phone: "", notes: "",
  }));
  const entries = participants.map((participant, index) => ({
    id: uuid(++sequence.value), participantId: participant.id, carNumber: index + 1,
    name: `${name} Car ${index + 1}`, categoryId: bracketId, quantity: 1, active: true,
  }));
  const event: EventStateV1 = {
    version: 1,
    event: { id: bracketId, name, date: "2026-08-14", venue: "Perth Raceway", organizer: "Demo officials", laneCount: 3, status, createdAt: NOW, updatedAt: NOW, resultSeal: status === "completed" ? "official" : "provisional" },
    settings: { scheduleMode: "custom", seed: `demo-${displayOrder}`, rankingMode: "competition", allowSharedRanks: true, tieBreakOrder: ["totalWins"], finalistCount: 3, autoSave: false, confirmWinnerChanges: true, enableTiming: true, prices: {} },
    participants, entries, matches: [], finals: [], payments: [], auditLog: [],
  };
  return { id: bracketId, name, stage, displayOrder, status, version: displayOrder + 1, lineage: [], event };
}

function heat(sequence: { value: number }, event: EventStateV1, number: number, status: Heat["status"], winnerIndex: number | null): Heat {
  const lanes = [event.entries[number % event.entries.length]!.id, event.entries[(number + 1) % event.entries.length]!.id, event.entries[(number + 2) % event.entries.length]!.id] as Heat["lanes"];
  return {
    id: uuid(++sequence.value), phase: "preliminary", matchNumber: number + 1, heatNumber: 1, lanes, status,
    winnerEntryId: winnerIndex === null ? null : lanes[winnerIndex] ?? null, laneTimesMs: winnerIndex === null ? [null, null, null] : [1250 + number * 8, 1270 + number * 8, 1290 + number * 8], notes: "",
  };
}

function createState(): MeetStateV1 {
  const sequence = { value: 1 };
  const brackets = [
    ...Array.from({ length: 4 }, (_, index) => makeBracket(sequence, `Qualifier ${index + 1}`, "qualifier", index + 1, 12, index === 0 ? "completed" : "running")),
    ...Array.from({ length: 2 }, (_, index) => makeBracket(sequence, `Semifinal ${index + 1}`, "semifinal", index + 5, 6, index === 0 ? "running" : "setup")),
    makeBracket(sequence, "Final", "final", 7, 6, "setup"),
  ];
  // Four different winners leave a four-way tie for three qualifying places.
  brackets[0]!.event.matches = Array.from({ length: 4 }, (_, index) => heat(sequence, brackets[0]!.event, index * 3, "completed", 0));
  brackets[1]!.event.matches = [heat(sequence, brackets[1]!.event, 0, "completed", 0), heat(sequence, brackets[1]!.event, 3, "scheduled", null), heat(sequence, brackets[1]!.event, 6, "scheduled", null)];
  brackets[4]!.event.matches = [heat(sequence, brackets[4]!.event, 0, "completed", 1), heat(sequence, brackets[4]!.event, 3, "scheduled", null)];

  const semifinals = brackets.slice(4, 6).map((bracket) => bracket.id);
  const finalId = brackets[6]!.id;
  const advancementRules = [
    ...brackets.slice(0, 4).map((bracket, index) => ({ id: uuid(++sequence.value), version: 1, sourceBracketId: bracket.id, destinationBracketIds: semifinals, topN: 3, destinationCapacity: 6, destinationOrder: index % 2 ? semifinals.slice().reverse() : semifinals, status: "active" as const })),
    ...brackets.slice(4, 6).map((bracket) => ({ id: uuid(++sequence.value), version: 1, sourceBracketId: bracket.id, destinationBracketIds: [finalId], topN: 3, destinationCapacity: 6, destinationOrder: [finalId], status: "active" as const })),
  ];
  const correctionAudit: AuditEntry = { id: uuid(++sequence.value), timestamp: "2026-08-14T10:05:00.000Z", action: "winner.corrected", summary: "Demo result correction retained", entityType: "heat", entityId: brackets[1]!.event.matches[0]!.id, details: { beforeWinner: brackets[1]!.event.matches[0]!.lanes[1], afterWinner: brackets[1]!.event.matches[0]!.winnerEntryId, reason: "Finish-line review" } };
  brackets[1]!.event.auditLog.push(correctionAudit);
  const auditLog: MeetAuditEvent[] = [
    { id: uuid(++sequence.value), timestamp: "2026-08-14T10:05:00.000Z", actorId: "demo-official", action: "result.corrected", entityType: "heat", entityId: brackets[1]!.event.matches[0]!.id, reason: "Finish-line review", before: { winner: brackets[1]!.event.matches[0]!.lanes[1] }, after: { winner: brackets[1]!.event.matches[0]!.winnerEntryId } },
    { id: uuid(++sequence.value), timestamp: "2026-08-14T10:10:00.000Z", actorId: "demo-official", action: "advancement.replaced", entityType: "advancement_rule", entityId: advancementRules[1]!.id, reason: "Upstream result correction", before: { status: "stale" }, after: { status: "replaced" } },
  ];
  return { version: 1, meet: { id: uuid(1), name: "Demo Championship Meet", venue: "Perth Raceway", date: "2026-08-14", status: "running", createdAt: NOW, updatedAt: NOW, version: 8 }, brackets, advancementRules, advancementSnapshots: [], auditLog };
}

const parsed = validateMeetState(createState());
if (!parsed.success) throw new Error(`Compiled Meet demo is invalid: ${parsed.issues.map((issue) => issue.message).join("; ")}`);
const STATE = parsed.data;
const q2Rule = STATE.advancementRules[1]!;
const q2 = STATE.brackets[1]!;
const staleId = uuid(9001);
const replacedId = uuid(9002);
const history = {
  snapshots: [
    { id: staleId, ruleId: q2Rule.id, sourceBracketId: q2.id, sourceResultVersion: 2, stale: true, replacedBySnapshotId: replacedId, confirmedBy: "demo-official", reason: "Initial automatic advancement", confirmedAt: "2026-08-14T10:00:00.000Z" },
    { id: replacedId, ruleId: q2Rule.id, sourceBracketId: q2.id, sourceResultVersion: 3, stale: false, replacedBySnapshotId: null, confirmedBy: "demo-official", reason: "Replaced after finish-line review", confirmedAt: "2026-08-14T10:10:00.000Z" },
  ],
  selections: [
    { id: uuid(9011), snapshotId: staleId, ruleId: q2Rule.id, sourceBracketId: q2.id, sourceCarId: q2.event.entries[0]!.id, destinationBracketId: q2Rule.destinationOrder[0]!, destinationCarId: null, rank: 1 },
    { id: uuid(9012), snapshotId: replacedId, ruleId: q2Rule.id, sourceBracketId: q2.id, sourceCarId: q2.event.entries[0]!.id, destinationBracketId: q2Rule.destinationOrder[0]!, destinationCarId: null, rank: 1 },
  ],
};
const heatVersions = Object.fromEntries(STATE.brackets.flatMap((bracket) => [...bracket.event.matches, ...bracket.event.finals].map((item) => [item.id, item.status === "completed" ? 2 : 1])));
const DEMO_BUNDLE: PortableHostedMeetBundle = { state: STATE, history, heatVersions };

export function createDemoMeetBundle(): PortableHostedMeetBundle {
  return structuredClone(DEMO_BUNDLE);
}
