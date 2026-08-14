import { eventStateV1Schema } from "@rr3/domain";
import { z } from "zod";
import type { JsonValue } from "@rr3/domain";
import type { AdvancementRule, MeetStateV1, MeetValidationIssue, MeetValidationResult } from "./types";

const MAX_BRACKETS = 100;
const MAX_RULES = 1_000;
const MAX_SNAPSHOTS = 10_000;
const MAX_AUDIT = 10_000;
const MAX_REASON = 500;
const id = z.string().trim().min(1).max(128);
const label = z.string().trim().min(1).max(200);
const text = (maximum: number) => z.string().trim().max(maximum);
const positive = z.number().finite().int().positive().max(Number.MAX_SAFE_INTEGER);
const nonnegative = z.number().finite().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const stage = z.enum(["qualifier", "semifinal", "final"]);
const status = z.enum(["setup", "running", "completed"]);
const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([z.string(), z.number().finite(), z.boolean(), z.null(), z.array(jsonValueSchema).max(10_000), z.record(jsonValueSchema)]));

const bracketSchema = z.object({
  id, name: label, stage, displayOrder: positive, status, version: nonnegative,
  event: eventStateV1Schema,
  lineage: z.array(z.object({ sourceBracketId: id, sourceCarId: id, ruleId: id, snapshotId: id }).strict()).max(10_000)
}).strict();

const ruleSchema = z.object({
  id, version: positive.default(1), sourceBracketId: id,
  destinationBracketIds: z.array(id).min(1).max(100),
  topN: positive.max(10_000), destinationCapacity: positive.max(10_000),
  destinationOrder: z.array(id).min(1).max(100), status: z.enum(["active", "disabled"])
}).strict().superRefine((rule, context) => {
  if (new Set(rule.destinationBracketIds).size !== rule.destinationBracketIds.length) context.addIssue(custom("duplicate_destination", ["destinationBracketIds"], "Destination brackets must be unique"));
  if (new Set(rule.destinationOrder).size !== rule.destinationOrder.length || rule.destinationOrder.length !== rule.destinationBracketIds.length || rule.destinationOrder.some((value) => !rule.destinationBracketIds.includes(value))) {
    context.addIssue(custom("invalid_destination_order", ["destinationOrder"], "Destination order must list each destination exactly once"));
  }
});

const meetStateCoreSchema = z.object({
  version: z.literal(1),
  meet: z.object({ id, name: label, venue: text(200), date: label.max(32), status, createdAt: label.max(64), updatedAt: label.max(64), version: nonnegative }).strict(),
  brackets: z.array(bracketSchema).min(1).max(MAX_BRACKETS),
  advancementRules: z.array(ruleSchema).max(MAX_RULES),
  advancementSnapshots: z.array(z.object({
    id, ruleId: id, sourceBracketId: id, sourceResultVersion: nonnegative,
    selections: z.array(z.object({ sourceCarId: id, destinationBracketId: id, rank: positive }).strict()).max(10_000),
    confirmedBy: id, reason: text(MAX_REASON).nullable(), confirmedAt: label.max(64), stale: z.boolean()
  }).strict()).max(MAX_SNAPSHOTS),
  auditLog: z.array(z.object({ id, timestamp: label.max(64), actorId: id, action: label.max(128), entityType: label.max(128), entityId: id, reason: text(MAX_REASON).nullable(), before: jsonValueSchema, after: jsonValueSchema }).strict()).max(MAX_AUDIT)
}).strict().superRefine((state, context) => {
  uniqueIds(state.brackets, "brackets", context);
  uniqueIds(state.advancementRules, "advancementRules", context);
  uniqueIds(state.advancementSnapshots, "advancementSnapshots", context);
  uniqueIds(state.auditLog, "auditLog", context);
  const brackets = new Map(state.brackets.map((bracket) => [bracket.id, bracket]));
  state.advancementRules.forEach((rule, index) => validateRule(rule, index, brackets, context));
  detectCycles(state.advancementRules, context);
  validateSnapshotAndLineageGraph(state, brackets, context);
});

export const meetStateV1Schema = z.unknown().transform((input, context): MeetStateV1 => {
  const safety = inspectMeetJsonSafety(input);
  for (const issue of safety) context.addIssue(custom(issue.code, issue.path, issue.message));
  if (safety.some((issue) => issue.code === "import_depth_limit" || issue.code === "import_node_limit")) return z.NEVER;
  const parsed = meetStateCoreSchema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) context.addIssue(issue);
    return z.NEVER;
  }
  return parsed.data;
});

export function validateMeetState(input: unknown): MeetValidationResult {
  const parsed = meetStateV1Schema.safeParse(input);
  if (parsed.success) return { success: true, data: parsed.data };
  return { success: false, issues: parsed.error.issues.map(toIssue) };
}

export function inspectMeetJsonSafety(value: unknown): MeetValidationIssue[] {
  const dangerous = new Set(["__proto__", "constructor", "prototype"]);
  const pending: Array<{ value: unknown; path: Array<string | number>; depth: number }> = [{ value, path: [], depth: 0 }];
  const discovered = new WeakSet<object>();
  const issues: MeetValidationIssue[] = [];
  let nodes = 0;
  if (value !== null && typeof value === "object") { discovered.add(value); nodes = 1; }
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current.value === null || typeof current.value !== "object") continue;
    for (const key of Object.keys(current.value)) {
      const segment = Array.isArray(current.value) && /^\d+$/u.test(key) ? Number(key) : key;
      const path = [...current.path, segment];
      if (dangerous.has(key)) issues.push({ code: "dangerous_key", path, message: `Unsafe object key is not allowed: ${key}` });
      const child = (current.value as Record<string, unknown>)[key];
      if (child !== null && typeof child === "object" && !discovered.has(child)) {
        if (current.depth + 1 > 128) return [...issues, { code: "import_depth_limit", path, message: "JSON structure exceeds the maximum depth of 128" }];
        if (++nodes > 100_000) return [...issues, { code: "import_node_limit", path, message: "JSON structure exceeds the 100000-object safety limit" }];
        discovered.add(child); pending.push({ value: child, path, depth: current.depth + 1 });
      }
    }
  }
  return issues;
}

function validateRule(rule: AdvancementRule, index: number, brackets: Map<string, { stage: z.infer<typeof stage> }>, context: z.RefinementCtx): void {
  const source = brackets.get(rule.sourceBracketId);
  if (!source) context.addIssue(custom("unknown_source_bracket", ["advancementRules", index, "sourceBracketId"], "Advancement source bracket is unknown"));
  for (const destinationId of rule.destinationBracketIds) {
    const destination = brackets.get(destinationId);
    if (!destination) context.addIssue(custom("unknown_destination_bracket", ["advancementRules", index, "destinationBracketIds"], "Advancement destination bracket is unknown"));
    if (destinationId === rule.sourceBracketId) context.addIssue(custom("self_advancement", ["advancementRules", index], "A bracket cannot advance to itself"));
    if (source && destination && stageOrder(destination.stage) <= stageOrder(source.stage)) context.addIssue(custom("invalid_stage_order", ["advancementRules", index], "Advancement must move to a later bracket stage"));
  }
}

function detectCycles(rules: readonly AdvancementRule[], context: z.RefinementCtx): void {
  const graph = new Map<string, string[]>();
  for (const rule of rules) graph.set(rule.sourceBracketId, [...(graph.get(rule.sourceBracketId) ?? []), ...rule.destinationBracketIds]);
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (node: string): boolean => {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;
    visiting.add(node);
    for (const destination of graph.get(node) ?? []) if (visit(destination)) return true;
    visiting.delete(node); visited.add(node); return false;
  };
  for (const node of graph.keys()) if (visit(node)) { context.addIssue(custom("advancement_cycle", ["advancementRules"], "Advancement graph must be acyclic")); return; }
}

function validateSnapshotAndLineageGraph(state: MeetStateV1, brackets: Map<string, BracketStateLike>, context: z.RefinementCtx): void {
  const rules = new Map(state.advancementRules.map((rule) => [rule.id, rule]));
  const snapshots = new Map(state.advancementSnapshots.map((snapshot) => [snapshot.id, snapshot]));
  const selectionKeys = new Set<string>();
  const advancedSourceSnapshots = new Map<string, string>();
  state.advancementSnapshots.forEach((snapshot, snapshotIndex) => {
    const rule = rules.get(snapshot.ruleId);
    if (!rule) { context.addIssue(custom("unknown_snapshot_rule", ["advancementSnapshots", snapshotIndex, "ruleId"], "Snapshot references an unknown advancement rule")); return; }
    if (snapshot.sourceBracketId !== rule.sourceBracketId) context.addIssue(custom("snapshot_source_mismatch", ["advancementSnapshots", snapshotIndex, "sourceBracketId"], "Snapshot source must match its rule source"));
    const source = brackets.get(snapshot.sourceBracketId);
    if (!source) context.addIssue(custom("unknown_snapshot_source", ["advancementSnapshots", snapshotIndex, "sourceBracketId"], "Snapshot source bracket is unknown"));
    const selected = new Set<string>();
    snapshot.selections.forEach((selection, selectionIndex) => {
      const selectionPath = ["advancementSnapshots", snapshotIndex, "selections", selectionIndex];
      if (selected.has(selection.sourceCarId)) context.addIssue(custom("duplicate_snapshot_selection", selectionPath, "A source car may appear only once in a snapshot"));
      selected.add(selection.sourceCarId);
      const advancementKey = `${snapshot.sourceBracketId}\u0000${selection.sourceCarId}`;
      const previousSnapshot = advancedSourceSnapshots.get(advancementKey);
      if (previousSnapshot !== undefined && previousSnapshot !== snapshot.id) context.addIssue(custom("duplicate_cross_snapshot_advancement", selectionPath, "A source car may not advance more than once for the same rule and source"));
      advancedSourceSnapshots.set(advancementKey, snapshot.id);
      if (source && !source.event.entries.some((entry) => entry.id === selection.sourceCarId)) context.addIssue(custom("unknown_snapshot_source_car", [...selectionPath, "sourceCarId"], "Snapshot selection references an unknown source car"));
      if (!rule.destinationBracketIds.includes(selection.destinationBracketId)) context.addIssue(custom("invalid_snapshot_destination", [...selectionPath, "destinationBracketId"], "Snapshot selection destination is not allowed by its rule"));
      if (!brackets.has(selection.destinationBracketId)) context.addIssue(custom("unknown_snapshot_destination", [...selectionPath, "destinationBracketId"], "Snapshot selection destination bracket is unknown"));
      selectionKeys.add(`${snapshot.id}\u0000${selection.sourceCarId}\u0000${selection.destinationBracketId}`);
    });
  });
  const lineageKeys = new Set<string>();
  state.brackets.forEach((bracket, bracketIndex) => bracket.lineage.forEach((lineage, lineageIndex) => {
    const path = ["brackets", bracketIndex, "lineage", lineageIndex];
    const key = `${lineage.snapshotId}\u0000${lineage.sourceCarId}\u0000${bracket.id}`;
    if (lineageKeys.has(key)) context.addIssue(custom("duplicate_lineage", path, "Duplicate advancement lineage is not allowed"));
    lineageKeys.add(key);
    const source = brackets.get(lineage.sourceBracketId);
    const rule = rules.get(lineage.ruleId);
    const snapshot = snapshots.get(lineage.snapshotId);
    if (!source) context.addIssue(custom("unknown_lineage_source", [...path, "sourceBracketId"], "Lineage source bracket is unknown"));
    else if (!source.event.entries.some((entry) => entry.id === lineage.sourceCarId)) context.addIssue(custom("unknown_lineage_source_car", [...path, "sourceCarId"], "Lineage source car is unknown"));
    if (!rule) context.addIssue(custom("unknown_lineage_rule", [...path, "ruleId"], "Lineage rule is unknown"));
    if (!snapshot) context.addIssue(custom("unknown_lineage_snapshot", [...path, "snapshotId"], "Lineage snapshot is unknown"));
    if (rule && rule.sourceBracketId !== lineage.sourceBracketId) context.addIssue(custom("lineage_rule_source_mismatch", path, "Lineage source must match its rule source"));
    if (snapshot && (snapshot.ruleId !== lineage.ruleId || snapshot.sourceBracketId !== lineage.sourceBracketId)) context.addIssue(custom("lineage_snapshot_mismatch", path, "Lineage must match its snapshot rule and source"));
    if (!selectionKeys.has(key)) context.addIssue(custom("lineage_missing_snapshot_selection", path, "Lineage must correspond to a snapshot selection for this destination"));
  }));
  for (const key of selectionKeys) if (!lineageKeys.has(key)) context.addIssue(custom("snapshot_selection_missing_lineage", ["advancementSnapshots"], "Every snapshot selection must have destination lineage"));
}

type BracketStateLike = { stage: z.infer<typeof stage>; event: { entries: Array<{ id: string }> } };

function uniqueIds(items: readonly { id: string }[], path: string, context: z.RefinementCtx): void {
  const known = new Set<string>();
  items.forEach((item, index) => { if (known.has(item.id)) context.addIssue(custom("duplicate_id", [path, index, "id"], `Duplicate ID: ${item.id}`)); known.add(item.id); });
}
function stageOrder(value: z.infer<typeof stage>): number { return value === "qualifier" ? 0 : value === "semifinal" ? 1 : 2; }
function custom(code: string, path: Array<string | number>, message: string): z.IssueData { return { code: z.ZodIssueCode.custom, path, message, params: { code } }; }
function toIssue(issue: z.ZodIssue): MeetValidationIssue { const value = issue.code === z.ZodIssueCode.custom ? (issue.params as { code?: unknown } | undefined)?.code : undefined; return { code: typeof value === "string" ? value : issue.code, path: issue.path, message: issue.message }; }
