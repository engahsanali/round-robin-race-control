import type { EventStateV1 } from "@rr3/domain";
import type { BracketState, MeetStateV1 } from "./types";

export function event(id: string, cars: Array<{ id: string; number: number }> = []): EventStateV1 {
  return {
    version: 1,
    event: { id, name: id, date: "2026-08-14", venue: "Track", organizer: "Org", laneCount: 3, status: "setup", createdAt: "2026-08-14T00:00:00Z", updatedAt: "2026-08-14T00:00:00Z", resultSeal: "draft" },
    settings: { scheduleMode: "custom", seed: "", rankingMode: "competition", allowSharedRanks: true, tieBreakOrder: ["totalWins"], finalistCount: 0, autoSave: false, confirmWinnerChanges: true, enableTiming: false, prices: {} },
    participants: cars.map((car) => ({ id: `p-${car.id}`, name: car.id, email: "", phone: "", notes: "" })),
    entries: cars.map((car) => ({ id: car.id, participantId: `p-${car.id}`, carNumber: car.number, name: car.id, categoryId: "category", quantity: 1, active: true })),
    matches: [], finals: [], payments: [], auditLog: []
  };
}

export function bracket(id: string, stage: "qualifier" | "semifinal" | "final", cars: Array<{ id: string; number: number }> = []): BracketState {
  return { id, name: id, stage, displayOrder: 1, status: "setup" as const, version: 1, event: event(`event-${id}`, cars), lineage: [] };
}

export function state(brackets: BracketState[] = [bracket("q1", "qualifier", [{ id: "q1-car", number: 7 }])]): MeetStateV1 {
  return {
    version: 1 as const,
    meet: { id: "meet", name: "Meet", venue: "Track", date: "2026-08-14", status: "setup" as const, createdAt: "2026-08-14T00:00:00Z", updatedAt: "2026-08-14T00:00:00Z", version: 1 },
    brackets, advancementRules: [], advancementSnapshots: [], auditLog: []
  };
}
