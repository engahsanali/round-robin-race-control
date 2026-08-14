import { validateMeetState, type MeetStateV1 } from "@rr3/meet-domain";

const createdAt = "2026-08-14T09:00:00.000Z";
const rawDemo: MeetStateV1 = {
  version: 1,
  meet: { id: "10000000-0000-4000-8000-000000000001", name: "Demo Championship Meet", venue: "Perth Raceway", date: "2026-08-14", status: "running", createdAt, updatedAt: createdAt, version: 1 },
  brackets: [{
    id: "10000000-0000-4000-8000-000000000002", name: "Demo Qualifier", stage: "qualifier", displayOrder: 1, status: "running", version: 1, lineage: [],
    event: {
      version: 1,
      event: { id: "10000000-0000-4000-8000-000000000002", name: "Demo Qualifier", date: "2026-08-14", venue: "Perth Raceway", organizer: "Demo officials", laneCount: 3, status: "running", createdAt, updatedAt: createdAt, resultSeal: "provisional" },
      settings: { scheduleMode: "custom", seed: "meet-demo", rankingMode: "competition", allowSharedRanks: true, tieBreakOrder: ["totalWins"], finalistCount: 0, autoSave: false, confirmWinnerChanges: true, enableTiming: true, prices: {} },
      participants: [], entries: [], matches: [], finals: [], payments: [], auditLog: [],
    },
  }],
  advancementRules: [], advancementSnapshots: [], auditLog: [],
};

const parsedDemo = validateMeetState(rawDemo);
if (!parsedDemo.success) throw new Error("Compiled Meet demo is invalid");
const DEMO_MEET = parsedDemo.data;

export type DemoRepository = {
  readonly readOnly: true;
  load(): MeetStateV1;
  mutate(): { ok: false; kind: "permission"; message: string };
};

export function createDemoRepository(): DemoRepository {
  return {
    readOnly: true,
    load: () => structuredClone(DEMO_MEET),
    mutate: () => ({ ok: false, kind: "permission", message: "Demo mode is read-only." }),
  };
}
