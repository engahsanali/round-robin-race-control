import type { MeetStateV1 } from "@rr3/meet-domain";

export const IDS = {
  user: "00000000-0000-4000-8000-000000000001",
  org: "00000000-0000-4000-8000-000000000002",
  meet: "00000000-0000-4000-8000-000000000003",
  bracket: "00000000-0000-4000-8000-000000000004",
  participant: "00000000-0000-4000-8000-000000000005",
  car: "00000000-0000-4000-8000-000000000006",
  heat: "00000000-0000-4000-8000-000000000007",
} as const;

export function validMeet(): MeetStateV1 {
  return {
    version: 1,
    meet: {
      id: IDS.meet,
      name: "Friday Night Meet",
      venue: "Perth Raceway",
      date: "2026-08-14",
      status: "running",
      createdAt: "2026-08-14T09:00:00.000Z",
      updatedAt: "2026-08-14T10:00:00.000Z",
      version: 3,
    },
    brackets: [{
      id: IDS.bracket,
      name: "Qualifier A",
      stage: "qualifier",
      displayOrder: 1,
      status: "running",
      version: 2,
      lineage: [],
      event: {
        version: 1,
        event: {
          id: IDS.bracket,
          name: "Qualifier A",
          date: "2026-08-14",
          venue: "Perth Raceway",
          organizer: "Meet officials",
          laneCount: 3,
          status: "running",
          createdAt: "2026-08-14T09:00:00.000Z",
          updatedAt: "2026-08-14T10:00:00.000Z",
          resultSeal: "provisional",
        },
        settings: {
          scheduleMode: "custom",
          seed: "meet-hosted",
          rankingMode: "competition",
          allowSharedRanks: true,
          tieBreakOrder: ["totalWins"],
          finalistCount: 0,
          autoSave: true,
          confirmWinnerChanges: true,
          enableTiming: true,
          prices: {},
        },
        participants: [{ id: IDS.participant, name: "Cesar", email: "", phone: "", notes: "" }],
        entries: [{ id: IDS.car, participantId: IDS.participant, carNumber: 7, name: "Comet", categoryId: IDS.bracket, quantity: 1, active: true }],
        matches: [],
        finals: [],
        payments: [],
        auditLog: [],
      },
    }],
    advancementRules: [],
    advancementSnapshots: [],
    auditLog: [],
  };
}
