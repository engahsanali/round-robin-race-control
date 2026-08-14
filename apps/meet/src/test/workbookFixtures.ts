import type { MeetStateV1 } from "@rr3/meet-domain";

const createdAt = "2026-08-14T09:00:00.000Z";
const uuid = (value: number) => `10000000-0000-4000-8000-${String(value).padStart(12, "0")}`;

export function makeMeet(bracketCount: number, carsPerBracket: number): MeetStateV1 {
  let sequence = 10;
  return {
    version: 1,
    meet: { id: uuid(1), name: "Championship Meet", venue: "Perth Raceway", date: "2026-08-14", status: "running", createdAt, updatedAt: createdAt, version: 1 },
    brackets: Array.from({ length: bracketCount }, (_, bracketIndex) => {
      const bracketId = uuid(++sequence);
      const participants = Array.from({ length: carsPerBracket }, (_, carIndex) => ({ id: uuid(++sequence), name: `Driver ${bracketIndex + 1}-${carIndex + 1}`, email: "", phone: "", notes: "" }));
      return {
        id: bracketId,
        name: `Qualifier ${bracketIndex + 1}`,
        stage: bracketIndex === bracketCount - 1 && bracketCount > 3 ? "final" as const : "qualifier" as const,
        displayOrder: bracketIndex + 1,
        status: "running" as const,
        version: 1,
        lineage: [],
        event: {
          version: 1 as const,
          event: { id: bracketId, name: `Qualifier ${bracketIndex + 1}`, date: "2026-08-14", venue: "Perth Raceway", organizer: "Meet officials", laneCount: 3 as const, status: "running" as const, createdAt, updatedAt: createdAt, resultSeal: "provisional" as const },
          settings: { scheduleMode: "custom" as const, seed: "workbook", rankingMode: "competition" as const, allowSharedRanks: true, tieBreakOrder: ["totalWins" as const], finalistCount: 3, autoSave: true, confirmWinnerChanges: true, enableTiming: true, prices: {} },
          participants,
          entries: participants.map((participant, carIndex) => ({ id: uuid(++sequence), participantId: participant.id, carNumber: carIndex + 1, name: `Car ${carIndex + 1}`, categoryId: bracketId, quantity: 1, active: true })),
          matches: [], finals: [], payments: [], auditLog: [],
        },
      };
    }),
    advancementRules: [], advancementSnapshots: [], auditLog: [],
  };
}

export function withSchedule(meet: MeetStateV1): MeetStateV1 {
  const clone = structuredClone(meet);
  const bracket = clone.brackets[0]!;
  bracket.event.matches = [{ id: uuid(999), phase: "preliminary", matchNumber: 1, heatNumber: 1, lanes: [bracket.event.entries[0]!.id, bracket.event.entries[1]!.id, bracket.event.entries[2]!.id], status: "scheduled", winnerEntryId: null, laneTimesMs: [null, null, null], notes: "" }];
  return clone;
}
