import rawSchedules from "../../../fixtures/schedules.json";

import type { SchedulePreset } from "./types";

export { eventStateV1Schema, validateEventState } from "./schema";
export type {
  AuditEntry,
  CarEntry,
  EventStateV1,
  Heat,
  JsonPrimitive,
  JsonValue,
  NumericLaneSlots,
  NumericPresetMatch,
  Participant,
  Payment,
  SchedulePreset,
  TieBreakKey,
  ValidationIssue,
  ValidationResult
} from "./types";

export const schedulePresets = {
  template9: { key: "template9", entrantCount: 9, phase: "preliminary", matches: rawSchedules.template9 as SchedulePreset["matches"] },
  template12: { key: "template12", entrantCount: 12, phase: "preliminary", matches: rawSchedules.template12 as SchedulePreset["matches"] },
  template15: { key: "template15", entrantCount: 15, phase: "preliminary", matches: rawSchedules.template15 as SchedulePreset["matches"] },
  finals15: { key: "finals15", entrantCount: 15, phase: "final", matches: rawSchedules.finals15 as SchedulePreset["matches"] }
} as const satisfies Record<string, SchedulePreset>;
