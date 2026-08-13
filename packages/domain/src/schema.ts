import { z } from "zod";

import type { EventStateV1, JsonValue, ValidationIssue, ValidationResult } from "./types";

const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const MAX_COLLECTION_SIZE = 10_000;
const MAX_JSON_DEPTH = 128;
const MAX_JSON_OBJECT_NODES = 100_000;

const userString = (maximum: number) => z.string().trim().max(maximum);
const requiredString = (maximum: number) => userString(maximum).min(1);
const stableId = requiredString(128);
const timestamp = requiredString(64);
const safeNonnegativeInteger = z.number().finite().int().nonnegative()
  .max(Number.MAX_SAFE_INTEGER, "Value must be a safe integer");
const moneyCents = safeNonnegativeInteger;
const positiveInteger = z.number().finite().int().positive()
  .max(Number.MAX_SAFE_INTEGER, "Value must be a safe integer");
const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema).max(MAX_COLLECTION_SIZE),
    z.record(jsonValueSchema)
  ])
);

const participantSchema = z.object({
  id: stableId,
  name: requiredString(200),
  email: userString(320),
  phone: userString(64),
  notes: userString(2_000)
}).strict();

const carEntrySchema = z.object({
  id: stableId,
  participantId: stableId,
  carNumber: positiveInteger,
  name: requiredString(200),
  categoryId: stableId,
  quantity: positiveInteger,
  active: z.boolean()
}).strict();

const nullableDuration = safeNonnegativeInteger.nullable();

const heatSchema = z.object({
  id: stableId,
  phase: z.enum(["preliminary", "final"]),
  matchNumber: positiveInteger,
  heatNumber: positiveInteger,
  lanes: z.tuple([stableId.nullable(), stableId.nullable(), stableId.nullable()]),
  status: z.enum(["scheduled", "completed", "cancelled", "rerun"]),
  winnerEntryId: stableId.nullable(),
  laneTimesMs: z.tuple([nullableDuration, nullableDuration, nullableDuration]),
  notes: userString(2_000)
}).strict().superRefine((heat, context) => {
  const assigned = heat.lanes.filter((entryId): entryId is string => entryId !== null);
  if (new Set(assigned).size !== assigned.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["lanes"], message: "A car entry may appear only once in a heat", params: { code: "duplicate_lane_entry" } });
  }
  if (heat.winnerEntryId !== null && !assigned.includes(heat.winnerEntryId)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["winnerEntryId"], message: "Winner must be assigned to this heat", params: { code: "winner_not_in_heat" } });
  }
  if (heat.status === "completed" && heat.winnerEntryId === null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["winnerEntryId"], message: "A completed heat requires a winner", params: { code: "completed_heat_requires_winner" } });
  }
  if (heat.status !== "completed" && heat.winnerEntryId !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["winnerEntryId"], message: "Only a completed heat may have a winner", params: { code: "winner_requires_completed_heat" } });
  }
});

const paymentSchema = z.object({
  id: stableId,
  participantId: stableId,
  amountCents: moneyCents,
  kind: z.enum(["payment", "refund"]),
  paidAt: timestamp,
  note: userString(500)
}).strict();

const auditEntrySchema = z.object({
  id: stableId,
  timestamp,
  action: requiredString(128),
  summary: requiredString(1_000),
  entityType: requiredString(128),
  entityId: stableId.nullable(),
  details: z.record(jsonValueSchema)
}).strict();

const tieBreakKeySchema = z.enum([
  "totalWins",
  "headToHead",
  "matchesWon",
  "averageTime",
  "bestTime",
  "laneBalance",
  "playoff",
  "carNumber"
]);

const eventStateV1CoreSchema = z.object({
  version: z.literal(1),
  event: z.object({
    id: stableId,
    name: requiredString(200),
    date: requiredString(32),
    venue: userString(200),
    organizer: userString(200),
    laneCount: z.literal(3),
    status: z.enum(["setup", "running", "completed"]),
    createdAt: timestamp,
    updatedAt: timestamp,
    resultSeal: z.enum(["draft", "provisional", "official"])
  }).strict(),
  settings: z.object({
    scheduleMode: z.enum(["template9", "template12", "template15", "custom"]),
    seed: userString(256),
    rankingMode: z.enum(["competition", "dense", "ordinal"]),
    allowSharedRanks: z.boolean(),
    tieBreakOrder: z.array(tieBreakKeySchema).max(8),
    finalistCount: z.number().finite().int().nonnegative().max(10_000),
    autoSave: z.boolean(),
    confirmWinnerChanges: z.boolean(),
    enableTiming: z.boolean(),
    prices: z.record(moneyCents)
  }).strict(),
  participants: z.array(participantSchema).max(MAX_COLLECTION_SIZE),
  entries: z.array(carEntrySchema).max(MAX_COLLECTION_SIZE),
  matches: z.array(heatSchema).max(MAX_COLLECTION_SIZE),
  finals: z.array(heatSchema).max(MAX_COLLECTION_SIZE),
  payments: z.array(paymentSchema).max(MAX_COLLECTION_SIZE),
  auditLog: z.array(auditEntrySchema).max(MAX_COLLECTION_SIZE)
}).strict().superRefine((state, context) => {
  addDuplicateIdIssues(state.participants, "participants", context);
  addDuplicateIdIssues(state.entries, "entries", context);
  addDuplicateIdIssues(state.matches, "matches", context);
  addDuplicateIdIssues(state.finals, "finals", context, new Set(state.matches.map(({ id }) => id)));
  addDuplicateIdIssues(state.payments, "payments", context);
  addDuplicateIdIssues(state.auditLog, "auditLog", context);

  const activeCarNumbers = new Map<number, number>();
  state.entries.forEach((entry, index) => {
    if (!entry.active) return;
    const firstIndex = activeCarNumbers.get(entry.carNumber);
    if (firstIndex !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["entries", index, "carNumber"],
        message: `Active car number ${entry.carNumber} duplicates entries.${firstIndex}.carNumber`,
        params: { code: "duplicate_active_car_number" }
      });
    } else {
      activeCarNumbers.set(entry.carNumber, index);
    }
  });

  const participantIds = new Set(state.participants.map(({ id }) => id));
  state.entries.forEach((entry, index) => {
    if (!participantIds.has(entry.participantId)) {
      addReferenceIssue(context, ["entries", index, "participantId"], "unknown_participant", "Car entry references an unknown participant");
    }
  });
  state.payments.forEach((payment, index) => {
    if (!participantIds.has(payment.participantId)) {
      addReferenceIssue(context, ["payments", index, "participantId"], "unknown_participant", "Payment references an unknown participant");
    }
  });

  const entryIds = new Set(state.entries.map(({ id }) => id));
  validateHeatPhases(state.matches, "matches", "preliminary", context);
  validateHeatPhases(state.finals, "finals", "final", context);
  validateHeatEntryReferences(state.matches, "matches", entryIds, context);
  validateHeatEntryReferences(state.finals, "finals", entryIds, context);
});

function validateHeatPhases(
  heats: ReadonlyArray<{ phase: "preliminary" | "final" }>,
  collection: "matches" | "finals",
  expectedPhase: "preliminary" | "final",
  context: z.RefinementCtx
): void {
  heats.forEach((heat, index) => {
    if (heat.phase !== expectedPhase) {
      addReferenceIssue(
        context,
        [collection, index, "phase"],
        "phase_mismatch",
        `${collection} heats must use the ${expectedPhase} phase`
      );
    }
  });
}

function validateHeatEntryReferences(
  heats: ReadonlyArray<{ lanes: [string | null, string | null, string | null] }>,
  collection: "matches" | "finals",
  entryIds: Set<string>,
  context: z.RefinementCtx
): void {
  heats.forEach((heat, index) => {
    heat.lanes.forEach((entryId, laneIndex) => {
      if (entryId !== null && !entryIds.has(entryId)) {
        addReferenceIssue(context, [collection, index, "lanes", laneIndex], "unknown_entry", "Heat lane references an unknown car entry");
      }
    });
  });
}

function addDuplicateIdIssues(
  entities: ReadonlyArray<{ id: string }>,
  collection: "participants" | "entries" | "matches" | "finals" | "payments" | "auditLog",
  context: z.RefinementCtx,
  seen: Set<string> = new Set()
): void {
  entities.forEach((entity, index) => {
    if (seen.has(entity.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [collection, index, "id"],
        message: `Duplicate ID: ${entity.id}`,
        params: { code: "duplicate_id" }
      });
    }
    seen.add(entity.id);
  });
}

function addReferenceIssue(context: z.RefinementCtx, path: Array<string | number>, code: string, message: string): void {
  context.addIssue({ code: z.ZodIssueCode.custom, path, message, params: { code } });
}

export function inspectJsonSafety(value: unknown): ValidationIssue[] {
  const pending: Array<{ value: unknown; path: Array<string | number>; depth: number }> = [
    { value, path: [], depth: 0 }
  ];
  const discovered = new WeakSet<object>();
  const issues: ValidationIssue[] = [];
  let objectNodes = 0;
  if (value !== null && typeof value === "object") {
    discovered.add(value);
    objectNodes = 1;
  }

  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current.value === null || typeof current.value !== "object") continue;

    for (const key of Object.keys(current.value)) {
      const pathSegment = Array.isArray(current.value) && /^\d+$/.test(key) ? Number(key) : key;
      const nextPath = [...current.path, pathSegment];
      if (DANGEROUS_KEYS.has(key)) {
        issues.push({ code: "dangerous_key", path: nextPath, message: `Unsafe object key is not allowed: ${key}` });
      }
      const child = (current.value as Record<string, unknown>)[key];
      if (child !== null && typeof child === "object" && !discovered.has(child)) {
        const childDepth = current.depth + 1;
        if (childDepth > MAX_JSON_DEPTH) {
          issues.push({
            code: "import_depth_limit",
            path: nextPath,
            message: `JSON structure exceeds the maximum depth of ${MAX_JSON_DEPTH}`
          });
          return issues;
        }
        objectNodes += 1;
        if (objectNodes > MAX_JSON_OBJECT_NODES) {
          issues.push({
            code: "import_node_limit",
            path: nextPath,
            message: `JSON structure exceeds the ${MAX_JSON_OBJECT_NODES}-object safety limit`
          });
          return issues;
        }
        discovered.add(child);
        pending.push({ value: child, path: nextPath, depth: childDepth });
      }
    }
  }
  return issues;
}

export const eventStateV1Schema = z.unknown().transform((input, context): EventStateV1 => {
  const safetyIssues = inspectJsonSafety(input);
  for (const issue of safetyIssues) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: issue.path,
      message: issue.message,
      params: { code: issue.code }
    });
  }
  if (safetyIssues.some(({ code }) => code === "import_depth_limit" || code === "import_node_limit")) {
    return z.NEVER;
  }

  const coreResult = eventStateV1CoreSchema.safeParse(input);
  if (!coreResult.success) {
    for (const issue of coreResult.error.issues) context.addIssue(issue);
    return z.NEVER;
  }

  return coreResult.data;
});

function toValidationIssue(issue: z.ZodIssue): ValidationIssue {
  const customCode = issue.code === z.ZodIssueCode.custom && "params" in issue
    ? (issue.params as { code?: unknown } | undefined)?.code
    : undefined;
  return {
    code: typeof customCode === "string" ? customCode : issue.code,
    path: issue.path,
    message: issue.message
  };
}

export function validateEventState(input: unknown): ValidationResult<EventStateV1> {
  const parsed = eventStateV1Schema.safeParse(input);
  if (!parsed.success) return { success: false, issues: parsed.error.issues.map(toValidationIssue) };
  return { success: true, data: parsed.data };
}
