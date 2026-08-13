export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type TieBreakKey =
  | "totalWins"
  | "headToHead"
  | "matchesWon"
  | "averageTime"
  | "bestTime"
  | "laneBalance"
  | "playoff"
  | "carNumber";

export type Participant = {
  id: string;
  name: string;
  email: string;
  phone: string;
  notes: string;
};

export type CarEntry = {
  id: string;
  participantId: string;
  carNumber: number;
  name: string;
  categoryId: string;
  quantity: number;
  active: boolean;
};

export type Heat = {
  id: string;
  phase: "preliminary" | "final";
  matchNumber: number;
  heatNumber: number;
  lanes: [string | null, string | null, string | null];
  status: "scheduled" | "completed" | "cancelled" | "rerun";
  winnerEntryId: string | null;
  laneTimesMs: [number | null, number | null, number | null];
  notes: string;
};

export type Payment = {
  id: string;
  participantId: string;
  amountCents: number;
  kind: "payment" | "refund";
  paidAt: string;
  note: string;
};

export type AuditEntry = {
  id: string;
  timestamp: string;
  action: string;
  summary: string;
  entityType: string;
  entityId: string | null;
  details: { [key: string]: JsonValue };
};

export type NumericLaneSlots = [number, number, number];
export type NumericPresetMatch = NumericLaneSlots[];

export type SchedulePreset = {
  key: "template9" | "template12" | "template15" | "finals15";
  entrantCount: 9 | 12 | 15;
  phase: "preliminary" | "final";
  matches: NumericPresetMatch[];
};

export type ScheduleQualityReport = {
  status: "valid" | "valid-with-warnings" | "invalid";
  errors: string[];
  warnings: string[];
  appearances: Record<string, number>;
  laneCounts: Record<string, [number, number, number]>;
  pairCounts: Record<string, number>;
  repeatedOpponentCount: number;
  repeatExcessLowerBound: number;
  repeatExcessGap: number;
  maximumPairFrequency: number;
  maximumPairFrequencyLowerBound: number;
  maximumPairFrequencyGap: number;
  opponentQualityStatus: "certified-optimal" | "best-found";
  worstPerCarRepeatBurden: number;
  squaredRepeatBurden: number;
  squaredPairFrequency: number;
  appearanceImbalance: number;
  maximumLaneSpread: number;
  byeCounts: Record<string, number>;
  twoCarHeatCounts: Record<string, number>;
};

export type EventStateV1 = {
  version: 1;
  event: {
    id: string;
    name: string;
    date: string;
    venue: string;
    organizer: string;
    laneCount: 3;
    status: "setup" | "running" | "completed";
    createdAt: string;
    updatedAt: string;
    resultSeal: "draft" | "provisional" | "official";
  };
  settings: {
    scheduleMode: "template9" | "template12" | "template15" | "custom";
    seed: string;
    rankingMode: "competition" | "dense" | "ordinal";
    allowSharedRanks: boolean;
    tieBreakOrder: TieBreakKey[];
    finalistCount: number;
    autoSave: boolean;
    confirmWinnerChanges: boolean;
    enableTiming: boolean;
    prices: Record<string, number>;
  };
  participants: Participant[];
  entries: CarEntry[];
  matches: Heat[];
  finals: Heat[];
  payments: Payment[];
  auditLog: AuditEntry[];
};

export type ValidationIssue = {
  code: string;
  path: Array<string | number>;
  message: string;
};

export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; issues: ValidationIssue[] };
