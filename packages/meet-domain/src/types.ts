import type { EventStateV1, JsonValue, ValidationIssue, ValidationResult } from "@rr3/domain";

export type BracketStage = "qualifier" | "semifinal" | "final";
export type MeetStatus = "setup" | "running" | "completed";

export type AdvancementLineage = {
  sourceBracketId: string;
  sourceCarId: string;
  ruleId: string;
  snapshotId: string;
};

export type BracketState = {
  id: string;
  name: string;
  stage: BracketStage;
  displayOrder: number;
  status: MeetStatus;
  version: number;
  event: EventStateV1;
  lineage: AdvancementLineage[];
};

export type AdvancementRule = {
  id: string;
  /** Defaults to 1 when legacy Meet JSON is validated. */
  version?: number;
  sourceBracketId: string;
  destinationBracketIds: string[];
  topN: number;
  destinationCapacity: number;
  destinationOrder: string[];
  status: "active" | "disabled";
};

export type AdvancementSelection = {
  sourceCarId: string;
  destinationBracketId: string;
  rank: number;
};

export type AdvancementPreview = {
  ruleId: string;
  sourceBracketId: string;
  sourceResultVersion: number;
  selected: AdvancementSelection[];
  excludedCarIds: string[];
  tiedCarIds: string[];
  duplicateCarIds: string[];
  capacityIssues: Array<{ destinationBracketId: string; available: number; required: number }>;
  staleSource: boolean;
  canConfirm: boolean;
};

export type AdvancementSnapshot = {
  id: string;
  ruleId: string;
  sourceBracketId: string;
  sourceResultVersion: number;
  selections: AdvancementSelection[];
  confirmedBy: string;
  reason: string | null;
  confirmedAt: string;
  stale: boolean;
};

export type MeetAuditEvent = {
  id: string;
  timestamp: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  reason: string | null;
  before: JsonValue;
  after: JsonValue;
};

export type MeetStateV1 = {
  version: 1;
  meet: {
    id: string;
    name: string;
    venue: string;
    date: string;
    status: MeetStatus;
    createdAt: string;
    updatedAt: string;
    version: number;
  };
  brackets: BracketState[];
  advancementRules: AdvancementRule[];
  advancementSnapshots: AdvancementSnapshot[];
  auditLog: MeetAuditEvent[];
};

export type MeetValidationIssue = ValidationIssue;
export type MeetValidationResult = ValidationResult<MeetStateV1>;

export type MeetInterchangeResult =
  | { ok: true; data: MeetStateV1 }
  | { ok: false; issues: MeetValidationIssue[] };

export type ConfirmAdvancementInput = {
  actorId: string;
  confirmedAt: string;
  selectedCarIds?: string[];
  reason?: string;
};
